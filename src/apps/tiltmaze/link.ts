/**
 * Who talks to whom in a bank. A touch frame sends a `drop` to the screen on its side for each
 * ball that starts up its tube; the screen beacons four times a second and announces each new
 * level epoch. A frame counts its screen as there only while the beacons keep coming (and, when
 * the room is up, the roster lists it), so a screen that crashes or is unplugged is noticed in
 * about 3 s and the frame then shows its own jar. While the room is between hubs the screen's
 * last word stands a little longer, so a quick hub change doesn't swap every frame's jar.
 */
import type { Channel, PeerInfo } from "../../core/types";
import {
  type BeaconMsg,
  decodeBeacon,
  decodeDrop,
  decodeLevel,
  type DropMsg,
  encodeBeacon,
  encodeDrop,
  encodeLevel,
  TOPIC,
} from "./wire";

export const BEACON_MS = 250;
/** A screen not heard from for this long has gone. */
export const BEACON_GRACE_MS = 3000;
/** While the room is offline, the screen's word stands at most this much longer. */
const OFFLINE_EXTRA_MS = 3000;
/** Drops a screen takes from one frame per second. */
export const DROP_RATE = 4;
const MAX_SENDERS = 64;

const sideOf = (p: PeerInfo) => p.side ?? 0;

export interface Uplink {
  /** The screen above this frame, while it answers. */
  screen(): string | null;
  /** Its last beacon, while it answers. */
  beacon(): BeaconMsg | null;
  drop(m: DropMsg): boolean;
  readonly sent: number;
  dispose(): void;
}

export const createUplink = (
  net: Channel,
  side: number,
  now: () => number,
  onLevel: (epoch: number) => void,
): Uplink => {
  let heard: { from: string; at: number; msg: BeaconMsg } | null = null;
  let sent = 0;
  const fromScreen = (from: string) => {
    const peer = net.peers().find((p) => p.frame === from);
    return !!peer && peer.role === "screen" && sideOf(peer) === side;
  };
  const offs = [
    net.on(TOPIC.beacon, (data, from) => {
      const m = decodeBeacon(data);
      if (!m || m.s !== side || !fromScreen(from)) return;
      heard = { from, at: now(), msg: m };
      onLevel(m.e);
    }),
    net.on(TOPIC.level, (data, from) => {
      const m = decodeLevel(data);
      if (!m || m.s !== side || !fromScreen(from)) return;
      onLevel(m.e);
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
  return {
    screen,
    beacon() {
      return screen() && heard ? heard.msg : null;
    },
    drop(m) {
      const to = screen();
      if (!to || !net.online) return false;
      net.send(TOPIC.drop, encodeDrop(m), to);
      sent++;
      return true;
    },
    get sent() {
      return sent;
    },
    dispose() {
      for (const off of offs) off();
      heard = null;
    },
  };
};

export interface Downlink {
  /** Touch frames on this screen's side. */
  stations(): PeerInfo[];
  /** Send the beacon when it is due. */
  tick(m: Omit<BeaconMsg, "s">): void;
  level(epoch: number): void;
  dispose(): void;
}

export const createDownlink = (
  net: Channel,
  opts: { side: number; count: () => number; now: () => number },
  onDrop: (m: DropMsg, column: number, peer: PeerInfo) => void,
): Downlink => {
  const buckets = new Map<string, { at: number; n: number }>();
  let beaconAt = Number.NEGATIVE_INFINITY;
  const stations = () => net.peers().filter((p) => p.role !== "screen" && sideOf(p) === opts.side);

  const admit = (from: string): PeerInfo | null => {
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role === "screen" || sideOf(peer) !== opts.side) return null;
    if (peer.kind !== "panel" && peer.kind !== "pair") return null;
    const t = opts.now();
    const b = buckets.get(from);
    if (b && t - b.at < 1000) {
      if (b.n >= DROP_RATE) return null;
      b.n++;
    } else {
      buckets.delete(from);
      buckets.set(from, { at: t, n: 1 });
      if (buckets.size > MAX_SENDERS) {
        const first = buckets.keys().next().value;
        if (first !== undefined) buckets.delete(first);
      }
    }
    return peer;
  };

  const off = net.on(TOPIC.drop, (data, from) => {
    const peer = admit(from);
    if (!peer) return;
    const m = decodeDrop(data);
    if (!m) return;
    const columns = Math.max(1, opts.count(), ...stations().map((p) => p.pos + 1));
    if (!Number.isInteger(peer.pos) || peer.pos < 0 || peer.pos >= columns) return;
    onDrop(m, peer.pos, peer);
  });

  return {
    stations,
    tick(m) {
      const t = opts.now();
      if (!net.online || t - beaconAt < BEACON_MS) return;
      beaconAt = t;
      net.send(TOPIC.beacon, encodeBeacon({ ...m, s: opts.side }));
    },
    level(epoch) {
      if (net.online) net.send(TOPIC.level, encodeLevel({ s: opts.side, e: epoch }));
    },
    dispose() {
      off();
      buckets.clear();
    },
  };
};
