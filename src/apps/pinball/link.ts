/**
 * Who talks to whom in a bank. A table finds the screen by its beacon (sent every BEACON_MS), not
 * by `leader()`, and counts it as gone once the beacons stop for SCREEN_GRACE_MS or the room goes
 * offline: its deck lane then turns back into the orbit. The screen hears from every touch frame
 * in its group.
 */
import type { Channel, PeerInfo } from "../../core/types";
import {
  decodeDown,
  decodeGift,
  decodePts,
  decodeScore,
  decodeUp,
  type DownMsg,
  encodeDown,
  encodeGift,
  encodeUp,
  type GiftMsg,
  type PtsMsg,
  type ScoreMsg,
  TOPIC,
  type UpMsg,
} from "./wire";

export const BEACON_MS = 600;
/** A screen whose beacons stop for this long has gone. */
export const SCREEN_GRACE_MS = 2000;
/** `up` messages a screen takes from one frame per second at most. */
const UP_RATE = 10;
/** Up messages further than this from the screen's clock are refused. */
export const MAX_SKEW_MS = 6000;

export interface Uplink {
  /** The screen above this frame, while it is answering. */
  screen(): string | null;
  /** Send a deck shot; false when there is no screen to send it to. */
  up(m: UpMsg): boolean;
  score(m: ScoreMsg): void;
  /** For tests: hold back `up` messages this many ms. */
  lag: number;
  dispose(): void;
}

export const createUplink = (
  net: Channel,
  now: () => number,
  on: { down(m: DownMsg): void; pts(m: PtsMsg): void; gift(m: GiftMsg): void },
): Uplink => {
  const heard = new Map<string, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  const isScreen = (frame: string) =>
    net.peers().some((p) => p.frame === frame && p.role === "screen");
  const screen = (): string | null => {
    if (!net.online) return null;
    const t = now();
    let best: string | null = null;
    let at = -Infinity;
    for (const [frame, when] of heard) {
      if (t - when > SCREEN_GRACE_MS || when <= at || !isScreen(frame)) continue;
      best = frame;
      at = when;
    }
    return best;
  };
  const offs = [
    net.on(TOPIC.hi, (_data, from) => {
      if (!isScreen(from)) return;
      heard.delete(from);
      heard.set(from, now());
      while (heard.size > 4) {
        const first = heard.keys().next().value;
        if (first === undefined) break;
        heard.delete(first);
      }
    }),
    net.on(TOPIC.down, (data, from) => {
      if (from !== screen()) return;
      const m = decodeDown(data);
      if (m) on.down(m);
    }),
    net.on(TOPIC.pts, (data, from) => {
      if (from !== screen()) return;
      const m = decodePts(data);
      if (m) on.pts(m);
    }),
    net.on(TOPIC.gift, (data, from) => {
      if (from !== screen()) return;
      const m = decodeGift(data);
      if (m) on.gift(m);
    }),
  ];
  const link: Uplink = {
    screen,
    lag: 0,
    up(m) {
      const to = screen();
      if (!to) return false;
      const data = encodeUp(m);
      if (link.lag <= 0) {
        net.send(TOPIC.up, data, to);
        return true;
      }
      const id = setTimeout(() => {
        timers.delete(id);
        if (!disposed) net.send(TOPIC.up, data, to);
      }, link.lag);
      timers.add(id);
      return true;
    },
    score(m) {
      const to = screen();
      if (to) net.send(TOPIC.score, m, to);
    },
    dispose() {
      disposed = true;
      for (const off of offs) off();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      heard.clear();
    },
  };
  return link;
};

export interface Downlink {
  /** Touch frames in the group. */
  stations(): PeerInfo[];
  /** Send the beacon when it is due. */
  tick(): void;
  down(to: string, m: DownMsg): void;
  pts(to: string, m: PtsMsg): void;
  gift(to: string, m: GiftMsg): void;
  dispose(): void;
}

export const createDownlink = (
  net: Channel,
  opts: { now: () => number; clock: () => number },
  on: { up(m: UpMsg, from: PeerInfo): void; score(m: ScoreMsg, from: PeerInfo): void },
): Downlink => {
  const buckets = new Map<string, { tokens: number; at: number }>();
  let beaconAt = -Infinity;
  const stations = () => net.peers().filter((p) => p.role !== "screen");
  const peer = (frame: string) => net.peers().find((p) => p.frame === frame && p.role !== "screen");
  const spend = (from: string) => {
    const t = opts.now();
    let b = buckets.get(from);
    if (!b) {
      b = { tokens: UP_RATE, at: t };
      buckets.set(from, b);
      if (buckets.size > 64) {
        const first = buckets.keys().next().value;
        if (first !== undefined) buckets.delete(first);
      }
    }
    b.tokens = Math.min(UP_RATE, b.tokens + ((t - b.at) / 1000) * UP_RATE);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens--;
    return true;
  };
  const offs = [
    net.on(TOPIC.up, (data, from) => {
      const p = peer(from);
      if (!p) return;
      const m = decodeUp(data);
      if (!m || Math.abs(m.t - opts.clock()) > MAX_SKEW_MS || !spend(from)) return;
      on.up(m, p);
    }),
    net.on(TOPIC.score, (data, from) => {
      const p = peer(from);
      if (!p) return;
      const m = decodeScore(data);
      if (m) on.score(m, p);
    }),
  ];
  return {
    stations,
    tick() {
      const t = opts.now();
      if (!net.online || t - beaconAt < BEACON_MS) return;
      beaconAt = t;
      net.send(TOPIC.hi, {});
    },
    down(to, m) {
      if (net.online) net.send(TOPIC.down, encodeDown(m), to);
    },
    pts(to, m) {
      if (net.online && m.p.length > 0) net.send(TOPIC.pts, m, to);
    },
    gift(to, m) {
      if (net.online) net.send(TOPIC.gift, encodeGift(m), to);
    },
    dispose() {
      for (const off of offs) off();
      buckets.clear();
    },
  };
};
