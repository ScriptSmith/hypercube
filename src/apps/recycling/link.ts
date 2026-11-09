/**
 * Who talks to whom in a bank. The screen is authoritative for what drops where, the pace and
 * the park; it beacons four times a second. A touch frame counts its screen as there only while
 * the beacons keep coming (and, when the room is up, the roster lists it), so a screen that
 * crashes or is unplugged is noticed within about 3 s, and the frame then feeds itself. While the
 * room is between hubs the screen's last word stands a little longer, so a quick hub change
 * doesn't make every frame start its own plant.
 */
import type { Channel, PeerInfo } from "../../core/types";
import {
  type BeaconMsg,
  decodeBeacon,
  decodeDrop,
  decodeFull,
  decodeLoad,
  decodeSorted,
  type DropMsg,
  encodeBeacon,
  encodeDrop,
  encodeFull,
  type FullMsg,
  type LoadMsg,
  type SortedMsg,
  TOPIC,
} from "./wire";

export const BEACON_MS = 250;
/** A screen not heard from for this long has gone. */
export const BEACON_GRACE_MS = 3000;
/** While the room is offline, the screen's word stands at most this much longer. */
const OFFLINE_EXTRA_MS = 3000;
const MAX_SENDERS = 64;

const sideOf = (p: PeerInfo) => p.side ?? 0;

export interface Uplink {
  /** The screen above this frame, while it answers. */
  screen(): string | null;
  /** Its last beacon, while it answers. */
  beacon(): BeaconMsg | null;
  load(m: LoadMsg): boolean;
  sorted(m: SortedMsg): boolean;
  full(m: FullMsg): boolean;
  dispose(): void;
}

export const createUplink = (
  net: Channel,
  side: number,
  now: () => number,
  onDrop: (m: DropMsg) => void,
): Uplink => {
  let heard: { from: string; at: number; msg: BeaconMsg } | null = null;
  const offs = [
    net.on(TOPIC.beacon, (data, from) => {
      const m = decodeBeacon(data);
      if (!m || m.s !== side) return;
      const peer = net.peers().find((p) => p.frame === from);
      if (!peer || peer.role !== "screen" || sideOf(peer) !== side) return;
      heard = { from, at: now(), msg: m };
    }),
    net.on(TOPIC.drop, (data, from) => {
      // Drops come only from the screen this frame follows (or, before its first beacon, any
      // screen on this side the roster lists).
      const peer = net.peers().find((p) => p.frame === from);
      if (!peer || peer.role !== "screen" || sideOf(peer) !== side) return;
      if (heard && heard.from !== from && screen() !== null) return;
      const m = decodeDrop(data);
      if (m) onDrop(m);
    }),
  ];
  const screen = (): string | null => {
    const t = now();
    if (!heard) return null;
    if (!net.online) return t - heard.at <= BEACON_GRACE_MS + OFFLINE_EXTRA_MS ? heard.from : null;
    if (t - heard.at > BEACON_GRACE_MS) return null;
    const from = heard.from;
    if (!net.peers().some((p) => p.frame === from && p.role === "screen")) return null;
    return from;
  };
  const send = (topic: string, data: unknown) => {
    const to = screen();
    if (!to || !net.online) return false;
    net.send(topic, data, to);
    return true;
  };
  return {
    screen,
    beacon() {
      return screen() && heard ? heard.msg : null;
    },
    load: (m) => send(TOPIC.load, m),
    sorted: (m) => send(TOPIC.sorted, m),
    full: (m) => send(TOPIC.full, encodeFull(m)),
    dispose() {
      for (const off of offs) off();
      heard = null;
    },
  };
};

/** Messages a screen takes from one frame, per second. */
export const RATE = { load: 4, sorted: 8, full: 3 } as const;

export interface DownHandlers {
  load(m: LoadMsg, column: number): void;
  sorted(m: SortedMsg, column: number, from: string): void;
  full(m: FullMsg, column: number, peer: PeerInfo): void;
}

export interface Downlink {
  /** Touch frames on this screen's side. */
  stations(): PeerInfo[];
  /** Send the beacon when it is due. */
  tick(m: Omit<BeaconMsg, "s">): void;
  drop(to: string, m: DropMsg): void;
  dispose(): void;
}

export const createDownlink = (
  net: Channel,
  opts: { side: number; count: () => number; now: () => number },
  on: DownHandlers,
): Downlink => {
  const buckets = new Map<string, { at: number; n: number }>();
  let beaconAt = Number.NEGATIVE_INFINITY;
  const stations = () => net.peers().filter((p) => p.role !== "screen" && sideOf(p) === opts.side);

  /** The sender, if it is a touch frame below this screen and within its rate for `topic`. */
  const admit = (from: string, topic: keyof typeof RATE): PeerInfo | null => {
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role === "screen" || sideOf(peer) !== opts.side) return null;
    const key = `${topic}:${from}`;
    const t = opts.now();
    const b = buckets.get(key);
    if (b && t - b.at < 1000) {
      if (b.n >= RATE[topic]) return null;
      b.n++;
    } else {
      buckets.delete(key);
      buckets.set(key, { at: t, n: 1 });
      if (buckets.size > MAX_SENDERS * 3) {
        const first = buckets.keys().next().value;
        if (first !== undefined) buckets.delete(first);
      }
    }
    return peer;
  };
  const columnOf = (peer: PeerInfo): number | null => {
    const columns = Math.max(1, opts.count(), ...stations().map((p) => p.pos + 1));
    return Number.isInteger(peer.pos) && peer.pos >= 0 && peer.pos < columns ? peer.pos : null;
  };

  const offs = [
    net.on(TOPIC.load, (data, from) => {
      const peer = admit(from, "load");
      const m = peer ? decodeLoad(data) : null;
      const c = peer ? columnOf(peer) : null;
      if (m && c !== null) on.load(m, c);
    }),
    net.on(TOPIC.sorted, (data, from) => {
      const peer = admit(from, "sorted");
      const m = peer ? decodeSorted(data) : null;
      const c = peer ? columnOf(peer) : null;
      if (m && c !== null) on.sorted(m, c, from);
    }),
    net.on(TOPIC.full, (data, from) => {
      const peer = admit(from, "full");
      const m = peer ? decodeFull(data) : null;
      const c = peer ? columnOf(peer) : null;
      if (peer && m && c !== null) on.full(m, c, peer);
    }),
  ];

  return {
    stations,
    tick(m) {
      const t = opts.now();
      if (!net.online || t - beaconAt < BEACON_MS) return;
      beaconAt = t;
      net.send(TOPIC.beacon, encodeBeacon({ ...m, s: opts.side }));
    },
    drop(to, m) {
      if (net.online) net.send(TOPIC.drop, encodeDrop(m), to);
    },
    dispose() {
      for (const off of offs) off();
      buckets.clear();
    },
  };
};
