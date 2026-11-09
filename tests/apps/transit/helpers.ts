/**
 * A tiny protobuf writer for building GTFS-realtime feeds by hand in tests (unit and e2e), and a
 * fake network channel.
 */
import type { Channel, PeerInfo } from "../../../src/core/types";

type Part = Uint8Array;

const concat = (parts: Part[]): Uint8Array => {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export const varint = (v: number): Uint8Array => {
  const out: number[] = [];
  let x = v;
  while (x >= 0x80) {
    out.push((x % 128) | 0x80);
    x = Math.floor(x / 128);
  }
  out.push(x);
  return Uint8Array.from(out);
};

const key = (field: number, wire: number) => varint(field * 8 + wire);

export const pb = {
  varint: (field: number, v: number) => concat([key(field, 0), varint(v)]),
  float: (field: number, v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    return concat([key(field, 5), b]);
  },
  double: (field: number, v: number) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    return concat([key(field, 1), b]);
  },
  bytes: (field: number, b: Uint8Array) => concat([key(field, 2), varint(b.length), b]),
  string: (field: number, s: string) => pb.bytes(field, new TextEncoder().encode(s)),
  message: (field: number, ...parts: Part[]) => pb.bytes(field, concat(parts)),
  concat,
};

export interface TestVehicle {
  id: string;
  trip?: string;
  route?: string;
  direction?: number;
  lat: number;
  lon: number;
  bearing?: number;
  speed?: number;
  timestamp?: number;
  label?: string;
}

/** A VehiclePositions feed with the given header time and vehicles. */
export const buildFeed = (timestamp: number, vehicles: TestVehicle[], extra: Part[] = []) =>
  concat([
    pb.message(1, pb.string(1, "2.0"), pb.varint(2, 0), pb.varint(3, timestamp)),
    ...vehicles.map((v) =>
      pb.message(
        2,
        pb.string(1, v.id),
        pb.message(
          4,
          pb.message(
            1,
            ...(v.trip ? [pb.string(1, v.trip)] : []),
            ...(v.route ? [pb.string(5, v.route)] : []),
            ...(v.direction !== undefined ? [pb.varint(6, v.direction)] : []),
          ),
          pb.message(
            2,
            pb.float(1, v.lat),
            pb.float(2, v.lon),
            ...(v.bearing !== undefined ? [pb.float(3, v.bearing)] : []),
            ...(v.speed !== undefined ? [pb.float(5, v.speed)] : []),
          ),
          ...(v.timestamp !== undefined ? [pb.varint(5, v.timestamp)] : []),
          pb.message(8, pb.string(1, `veh-${v.id}`), ...(v.label ? [pb.string(2, v.label)] : [])),
        ),
      ),
    ),
    ...extra,
  ]);

export const peer = (frame: string, extra: Partial<PeerInfo> = {}): PeerInfo => ({
  frame,
  app: "transit",
  group: "main",
  kind: "wall",
  role: "solo",
  pos: 0,
  ...extra,
});

/** A channel whose sends are recorded and whose handlers tests can call. */
export const fakeNet = (self = "me", leader: string | null = "me") => {
  const handlers = new Map<string, ((data: unknown, from: string) => void)[]>();
  const sent: { topic: string; data: unknown; to?: string }[] = [];
  const net: Channel = {
    online: true,
    self,
    peers: () => [peer(self)],
    leader: () => leader,
    send(topic, data, to) {
      sent.push({ topic, data, to });
    },
    on(topic, cb) {
      const list = handlers.get(topic) ?? [];
      list.push(cb);
      handlers.set(topic, list);
      return () =>
        handlers.set(
          topic,
          (handlers.get(topic) ?? []).filter((h) => h !== cb),
        );
    },
    onPeers: () => () => {},
  };
  const deliver = (topic: string, data: unknown, from: string) => {
    for (const h of handlers.get(topic) ?? []) h(data, from);
  };
  return { net, sent, deliver };
};
