/**
 * A small reader for the GTFS-realtime VehiclePositions feed: just the fields this app uses.
 * Everything else, including fields added to the spec later, is skipped by wire type.
 *
 * FeedMessage    1 header, 2 entity (repeated)
 * FeedHeader     3 timestamp
 * FeedEntity     1 id, 2 is_deleted, 4 vehicle
 * VehiclePosition 1 trip, 2 position, 5 timestamp, 8 vehicle
 * TripDescriptor 1 trip_id, 5 route_id, 6 direction_id
 * Position       1 latitude (float), 2 longitude (float), 3 bearing (float), 5 speed (float)
 * VehicleDescriptor 1 id, 2 label
 */

export interface RawVehicle {
  /** The entity id, else the vehicle id. Stable for a vehicle across fetches. */
  id: string;
  tripId: string | null;
  routeId: string | null;
  /** 0 or 1, or -1 when the feed leaves it out. */
  direction: number;
  lat: number;
  lon: number;
  /** Degrees clockwise from north, or -1 when absent. */
  bearing: number;
  /** Metres a second, or -1 when absent. */
  speed: number;
  /** Unix seconds of the position, or 0 when absent. */
  timestamp: number;
  /** Runtime only: vehicle labels can be names and are never stored or sent. */
  label: string | null;
}

export interface Feed {
  /** Unix seconds from the header, or 0. */
  timestamp: number;
  vehicles: RawVehicle[];
}

/** A bigger feed than any real one; the rest is ignored. */
export const MAX_ENTITIES = 6000;
const MAX_STRING = 256;

export class FeedError extends Error {}

const utf8 = new TextDecoder();

class Reader {
  pos: number;
  constructor(
    readonly buf: Uint8Array,
    readonly view: DataView,
    start: number,
    readonly end: number,
  ) {
    this.pos = start;
  }

  varint(): number {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new FeedError("truncated varint");
      const b = this.buf[this.pos++]!;
      // Multiplication keeps values up to 2^53 exact, which covers timestamps and lengths.
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
    }
    throw new FeedError("varint too long");
  }

  float(): number {
    if (this.pos + 4 > this.end) throw new FeedError("truncated float");
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** A length-delimited field: returns its end, leaving `pos` at its start. */
  bytes(): number {
    const len = this.varint();
    const end = this.pos + len;
    if (end > this.end) throw new FeedError("truncated field");
    return end;
  }

  string(): string {
    const end = this.bytes();
    const s = utf8.decode(this.buf.subarray(this.pos, Math.min(end, this.pos + MAX_STRING)));
    this.pos = end;
    return s;
  }

  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.advance(8);
    else if (wire === 2) this.pos = this.bytes();
    else if (wire === 5) this.advance(4);
    else throw new FeedError(`unsupported wire type ${wire}`);
  }

  advance(n: number): void {
    if (this.pos + n > this.end) throw new FeedError("truncated field");
    this.pos += n;
  }

  /** Call `field(number, wire)` for each field up to `end`; it must consume or return false. */
  fields(end: number, field: (n: number, wire: number) => boolean): void {
    while (this.pos < end) {
      const key = this.varint();
      const n = Math.floor(key / 8);
      const wire = key & 7;
      if (n === 0) throw new FeedError("field number 0");
      if (!field(n, wire)) this.skip(wire);
    }
    if (this.pos !== end) throw new FeedError("field overran its message");
  }

  /** Read a nested message of wire type 2 with `field`. */
  message(wire: number, field: (n: number, wire: number) => boolean): void {
    if (wire !== 2) throw new FeedError("expected a message");
    this.fields(this.bytes(), field);
  }
}

const finite = (v: number): boolean => Number.isFinite(v);

/** Decode a VehiclePositions feed. Throws FeedError on malformed or truncated input. */
export const decodeFeed = (input: ArrayBuffer | Uint8Array): Feed => {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const r = new Reader(buf, view, 0, buf.length);
  const feed: Feed = { timestamp: 0, vehicles: [] };
  let entities = 0;

  r.fields(buf.length, (n, wire) => {
    if (n === 1 && wire === 2) {
      r.message(wire, (h, hw) => {
        if (h === 3 && hw === 0) {
          feed.timestamp = r.varint();
          return true;
        }
        return false;
      });
      return true;
    }
    if (n === 2 && wire === 2) {
      entities++;
      if (entities > MAX_ENTITIES) {
        r.skip(wire);
        return true;
      }
      const v = readEntity(r);
      if (v) feed.vehicles.push(v);
      return true;
    }
    return false;
  });
  return feed;
};

const readEntity = (r: Reader): RawVehicle | null => {
  let id = "";
  let deleted = false;
  let vehicleId = "";
  let hasPosition = false;
  const v: RawVehicle = {
    id: "",
    tripId: null,
    routeId: null,
    direction: -1,
    lat: Number.NaN,
    lon: Number.NaN,
    bearing: -1,
    speed: -1,
    timestamp: 0,
    label: null,
  };
  r.message(2, (n, wire) => {
    if (n === 1 && wire === 2) {
      id = r.string();
      return true;
    }
    if (n === 2 && wire === 0) {
      deleted = r.varint() !== 0;
      return true;
    }
    if (n !== 4 || wire !== 2) return false;
    r.message(wire, (f, fw) => {
      if (f === 1 && fw === 2) {
        r.message(fw, (t, tw) => {
          if (t === 1 && tw === 2) v.tripId = r.string();
          else if (t === 5 && tw === 2) v.routeId = r.string();
          else if (t === 6 && tw === 0) v.direction = r.varint() === 1 ? 1 : 0;
          else return false;
          return true;
        });
        return true;
      }
      if (f === 2 && fw === 2) {
        hasPosition = true;
        r.message(fw, (p, pw) => {
          if (pw !== 5) return false;
          const x = r.float();
          if (p === 1) v.lat = x;
          else if (p === 2) v.lon = x;
          else if (p === 3 && finite(x) && x >= 0 && x <= 360) v.bearing = x % 360;
          else if (p === 5 && finite(x) && x >= 0 && x < 100) v.speed = x;
          return true;
        });
        return true;
      }
      if (f === 5 && fw === 0) {
        v.timestamp = r.varint();
        return true;
      }
      if (f === 8 && fw === 2) {
        r.message(fw, (d, dw) => {
          if (d === 1 && dw === 2) vehicleId = r.string();
          else if (d === 2 && dw === 2) v.label = r.string();
          else return false;
          return true;
        });
        return true;
      }
      return false;
    });
    return true;
  });
  v.id = id || vehicleId;
  if (deleted || !v.id || !hasPosition) return null;
  if (!finite(v.lat) || !finite(v.lon) || Math.abs(v.lat) > 90 || Math.abs(v.lon) > 180) {
    return null;
  }
  return v;
};
