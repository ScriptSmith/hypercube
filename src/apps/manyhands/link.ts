/**
 * Who talks to whom in a bank. A touch frame sends its parts and a heartbeat to the screen on its
 * own side (`leader()` could pick one frame for both sides of a corner), and listens for that
 * screen's `build`, which doubles as its beacon: a screen counts as present only while its builds
 * keep coming and the roster lists it, so one that crashes is noticed within a few seconds even
 * while the hub still lists it.
 */
import type { Channel, PeerInfo } from "../../core/types";
import { BUILD_EVERY_MS, HEARTBEAT_MS, SCREEN_GRACE_MS } from "./config";
import {
  type BeatMsg,
  type BuildMsg,
  decodeBeat,
  decodeBuild,
  decodePart,
  encodeBeat,
  encodeBuild,
  encodePart,
  type PartMsg,
  TOPIC,
} from "./wire";

const sideOf = (p: PeerInfo) => p.side ?? 0;
/** While the room is offline (changing hub), beacon ages stand still for at most this long. */
const FREEZE_MS = 500;
/**
 * A screen whose builds are overdue still counts until this frame has looked this many more
 * times: the simulator runs every frame on one thread, and builds that queued while this frame's
 * own loop was held up arrive in those looks.
 */
const AWAKE_LOOKS = 6;
const LOOK_MS = 20;
/** Parts a second a screen takes from one frame, and the burst it allows. */
const PART_RATE = 6;
const PART_BURST = 12;

export interface Uplink {
  /** The screen above this frame while it is answering, else null. */
  screen(): string | null;
  /** The latest build from that screen. */
  readonly build: BuildMsg | null;
  /** Send a part to the screen. False when there is none. */
  sendPart(m: PartMsg): boolean;
  /** Send the heartbeat when it is due. */
  tick(beat: () => BeatMsg): void;
  /** Debug and tests: hold every outgoing part this long first. */
  lag: number;
  readonly sent: number;
  dispose(): void;
}

export const createUplink = (net: Channel, side: number, now: () => number): Uplink => {
  const heard = new Map<string, { at: number; staleAt: number | null }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let latest: BuildMsg | null = null;
  let latestFrom: string | null = null;
  let offlineSince: number | null = null;
  let looks = 0;
  let lookedAt = Number.NEGATIVE_INFINITY;
  let beatAt = Number.NEGATIVE_INFINITY;
  let sent = 0;
  let lag = 0;

  const off = net.on(TOPIC.build, (data, from) => {
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role !== "screen" || sideOf(peer) !== side) return;
    const m = decodeBuild(data);
    if (!m) return;
    heard.set(from, { at: now(), staleAt: null });
    if (heard.size > 4) {
      const first = heard.keys().next().value;
      if (first !== undefined) heard.delete(first);
    }
    latest = m;
    latestFrom = from;
  });

  const screen = (): string | null => {
    const t = now();
    if (t - lookedAt >= LOOK_MS) {
      looks++;
      lookedAt = t;
    }
    if (!net.online) offlineSince ??= t;
    else if (offlineSince !== null) {
      const gap = Math.min(FREEZE_MS, t - offlineSince);
      for (const h of heard.values()) h.at += gap;
      offlineSince = null;
    }
    const ref = offlineSince === null ? t : t - Math.min(FREEZE_MS, t - offlineSince);
    const peers = offlineSince === null ? net.peers() : null;
    let best: string | null = null;
    let at = Number.NEGATIVE_INFINITY;
    for (const [frame, h] of heard) {
      if (h.at <= at) continue;
      if (ref - h.at > SCREEN_GRACE_MS) {
        h.staleAt ??= looks;
        if (looks - h.staleAt >= AWAKE_LOOKS) continue;
      } else {
        h.staleAt = null;
      }
      if (peers && !peers.some((p) => p.frame === frame && p.role === "screen")) continue;
      best = frame;
      at = h.at;
    }
    return best;
  };

  return {
    screen,
    get build() {
      return latestFrom !== null && latestFrom === screen() ? latest : null;
    },
    sendPart(m) {
      const to = screen();
      if (!to || !net.online) return false;
      const data = encodePart(m);
      sent++;
      if (lag > 0) {
        const id = setTimeout(() => {
          timers.delete(id);
          net.send(TOPIC.part, data, to);
        }, lag);
        timers.add(id);
        if (timers.size > 64) {
          const first = timers.values().next().value;
          if (first !== undefined) {
            clearTimeout(first);
            timers.delete(first);
          }
        }
      } else {
        net.send(TOPIC.part, data, to);
      }
      return true;
    },
    tick(beat) {
      const t = now();
      if (t - beatAt < HEARTBEAT_MS || !net.online) return;
      const to = screen();
      if (!to) return;
      beatAt = t;
      net.send(TOPIC.beat, encodeBeat(beat()), to);
    },
    get lag() {
      return lag;
    },
    set lag(ms: number) {
      lag = Math.max(0, Math.min(5000, ms));
    },
    get sent() {
      return sent;
    },
    dispose() {
      off();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      heard.clear();
    },
  };
};

export interface DownlinkHandlers {
  part(m: PartMsg, from: string, peer: PeerInfo): void;
  beat(m: BeatMsg, from: string, peer: PeerInfo): void;
}

export interface Downlink {
  /** Send the build when it is due or has changed. */
  tick(build: () => BuildMsg): void;
  changed(): void;
  /** Touch frames on this screen's side. */
  stations(): PeerInfo[];
  readonly received: number;
  readonly dropped: number;
  dispose(): void;
}

export const createDownlink = (
  net: Channel,
  side: number,
  now: () => number,
  on: DownlinkHandlers,
): Downlink => {
  const buckets = new Map<string, { tokens: number; at: number }>();
  let dirty = true;
  let sentAt = Number.NEGATIVE_INFINITY;
  let received = 0;
  let dropped = 0;
  const below = (from: string) => {
    const peer = net.peers().find((p) => p.frame === from);
    return peer && peer.role !== "screen" && sideOf(peer) === side ? peer : null;
  };
  const spend = (from: string) => {
    const t = now();
    let b = buckets.get(from);
    if (!b) {
      b = { tokens: PART_BURST, at: t };
      buckets.set(from, b);
      while (buckets.size > 128) {
        const first = buckets.keys().next().value;
        if (first === undefined) break;
        buckets.delete(first);
      }
    }
    b.tokens = Math.min(PART_BURST, b.tokens + ((t - b.at) / 1000) * PART_RATE);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens--;
    return true;
  };
  const offs = [
    net.on(TOPIC.part, (data, from) => {
      const peer = below(from);
      const m = peer ? decodePart(data) : null;
      if (!peer || !m || !spend(from)) {
        dropped++;
        return;
      }
      received++;
      on.part(m, from, peer);
    }),
    net.on(TOPIC.beat, (data, from) => {
      const peer = below(from);
      const m = peer ? decodeBeat(data) : null;
      if (peer && m) on.beat(m, from, peer);
    }),
  ];
  return {
    tick(build) {
      const t = now();
      if (!net.online) return;
      if (t - sentAt < BUILD_EVERY_MS && !(dirty && t - sentAt >= 150)) return;
      sentAt = t;
      dirty = false;
      net.send(TOPIC.build, encodeBuild(build()));
    },
    changed() {
      dirty = true;
    },
    stations: () => net.peers().filter((p) => p.role !== "screen" && sideOf(p) === side),
    get received() {
      return received;
    },
    get dropped() {
      return dropped;
    },
    dispose() {
      for (const off of offs) off();
      buckets.clear();
    },
  };
};
