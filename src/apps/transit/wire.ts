/**
 * Messages within the app's group, checked field by field on arrival (any page on the public site
 * can join a room it guesses, so anything out of range drops the whole message).
 *
 * - `snap` (leader to the group, after each fetch): the region's vehicles, in chunks small enough
 *   for one message each. A chunk is self-contained: the feed time `t`, the route ids it uses `r`,
 *   and seven integers per vehicle in `v`: key (a hash of the feed's vehicle id), x and y in metres
 *   from the region's corner, an index into `r`, direction (0, 1 or 2 for unknown), bearing as a
 *   byte (255 for unknown) and the fix's age in seconds before `t`.
 * - `pick` (a kiosk to the group): it chose featured line `line`; walls highlight it in palette
 *   colour `color` without moving their camera.
 */
import { inRegion, inRegionLonLat, toLocalX, toLocalY } from "./geo";
import { routeBase } from "./gtfs";
import type { Feed } from "./pbf";
import type { Snapshot, SnapVehicle } from "./replay";
import { lineById } from "./routes";

export const TOPIC = { snap: "tr:snap", pick: "tr:pick" } as const;

/** JSON bytes per chunk, well under the room's 16 KB message limit with the envelope. */
export const CHUNK_BYTES = 12_000;
export const FIELDS = 7;
const MAX_ROUTES = 400;
const MAX_VEHICLES_PER_CHUNK = 1000;
const MAX_AGE_S = 3600;
const ROUTE_ID = /^[A-Za-z0-9_.]{1,12}$/;

export interface SnapChunk {
  s: number;
  t: number;
  r: string[];
  v: number[];
}

/** FNV-1a: a stable positive 32-bit key for a feed vehicle id. */
export const vehicleKey = (id: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
};

const bearingByte = (deg: number): number =>
  deg >= 0 && deg <= 360 ? Math.round(((deg % 360) / 360) * 254) : 255;
const fromByte = (b: number): number => (b === 255 ? -1 : (b / 254) * 360);

/** Split a snapshot into chunks of at most CHUNK_BYTES of JSON each. */
export const encodeSnapshot = (snap: Snapshot, seq: number): SnapChunk[] => {
  const chunks: SnapChunk[] = [];
  const t = Math.round(snap.t);
  let chunk: SnapChunk | null = null;
  let index = new Map<string, number>();
  let bytes = 0;
  for (const v of snap.vehicles) {
    if (!ROUTE_ID.test(v.route)) continue;
    const x = Math.round(v.x);
    const y = Math.round(v.y);
    const dir = v.dir === 0 || v.dir === 1 ? v.dir : 2;
    const b = bearingByte(v.bearing);
    const age = Math.max(0, Math.min(MAX_AGE_S, Math.round(t - v.ts)));
    // Field text plus commas; the route index counts as three digits.
    const cost = `${v.key},${x},${y},000,${dir},${b},${age},`.length;
    const routeCost = v.route.length + 3;
    const fresh = !chunk || !index.has(v.route);
    if (!chunk || bytes + cost + (fresh ? routeCost : 0) > CHUNK_BYTES) {
      chunk = { s: seq, t, r: [], v: [] };
      chunks.push(chunk);
      index = new Map();
      bytes = 40;
    }
    let ri = index.get(v.route);
    if (ri === undefined) {
      ri = chunk.r.length;
      chunk.r.push(v.route);
      index.set(v.route, ri);
      bytes += routeCost;
    }
    chunk.v.push(v.key, x, y, ri, dir, b, age);
    bytes += cost;
  }
  return chunks;
};

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** A received chunk as a (partial) snapshot, or null when anything is out of range. */
export const decodeChunk = (data: unknown): Snapshot | null => {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Partial<SnapChunk>;
  if (!int(d.s, 0, 2 ** 31) || !int(d.t, 1e9, 1e10)) return null;
  if (!Array.isArray(d.r) || d.r.length > MAX_ROUTES) return null;
  if (!Array.isArray(d.v) || d.v.length % FIELDS !== 0) return null;
  if (d.v.length / FIELDS > MAX_VEHICLES_PER_CHUNK) return null;
  const routes = d.r;
  if (!routes.every((r) => typeof r === "string" && ROUTE_ID.test(r))) return null;
  const vehicles: SnapVehicle[] = [];
  const v = d.v;
  for (let i = 0; i < v.length; i += FIELDS) {
    const [key, x, y, ri, dir, b, age] = v.slice(i, i + FIELDS);
    if (!int(key, 1, 2 ** 32 - 1) || !int(x, -5000, 1e6) || !int(y, -5000, 1e6)) return null;
    if (!int(ri, 0, routes.length - 1) || !int(dir, 0, 2) || !int(b, 0, 255)) return null;
    if (!int(age, 0, MAX_AGE_S) || !inRegion(x, y, 5000)) return null;
    vehicles.push({
      key,
      route: routes[ri] as string,
      dir: dir === 2 ? -1 : dir,
      x,
      y,
      bearing: fromByte(b),
      ts: d.t - age,
    });
  }
  return { t: d.t, vehicles, source: "live" };
};

export interface PickMsg {
  line: string;
  color: number;
}

export const decodePick = (data: unknown): PickMsg | null => {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Partial<PickMsg>;
  if (typeof d.line !== "string" || !lineById(d.line)) return null;
  if (!int(d.color, 0, 7)) return null;
  return { line: d.line, color: d.color };
};

/**
 * The region's vehicles from a decoded feed. `tripDirection` (from the day's trips) supplies the
 * direction the feed leaves out. Vehicle ids become keys and labels are dropped here.
 */
export const feedToSnapshot = (
  feed: Feed,
  nowS: number,
  tripDirection?: ReadonlyMap<string, number>,
): Snapshot => {
  const t = feed.timestamp || Math.round(nowS);
  const vehicles: SnapVehicle[] = [];
  for (const v of feed.vehicles) {
    if (!v.routeId || !inRegionLonLat(v.lon, v.lat)) continue;
    const route = routeBase(v.routeId);
    if (!ROUTE_ID.test(route)) continue;
    let dir = v.direction;
    if (dir < 0 && v.tripId) dir = tripDirection?.get(v.tripId) ?? -1;
    vehicles.push({
      key: vehicleKey(v.id),
      route,
      dir,
      x: toLocalX(v.lon),
      y: toLocalY(v.lat),
      bearing: v.bearing,
      ts: v.timestamp > 0 && v.timestamp <= t + 60 ? v.timestamp : t,
    });
  }
  return { t, vehicles, source: "live" };
};
