/**
 * Who follows whom in a bank. The screen is in charge while it answers: it hears every touch
 * frame's harmonics and sends the beacon. Touch frames follow the best beacon they hear: the
 * screen on their side, or else a touch frame further left. A frame that has heard nothing
 * better for a few seconds takes charge itself, so a bank whose screen is gone still plays:
 * the leftmost frame runs the rules and the others follow it. When the screen comes back its
 * beacon wins again.
 *
 * A beacon counts only while it keeps coming and the roster lists its sender in the role it
 * claims. While the room is between hubs the last word stands a little longer, so a quick hub
 * change doesn't make every frame take charge at once.
 */
import type { Channel, PeerInfo } from "../../core/types";
import { perFrame } from "./layout";
import {
  type BeaconMsg,
  decodeBeacon,
  decodeState,
  encodeBeacon,
  encodeState,
  type StateEntry,
  type StateMsg,
  TOPIC,
} from "./wire";

export const BEACON_MS = 250;
/** A beacon not heard for this long has gone. */
export const BEACON_GRACE_MS = 3000;
/** While the room is offline, the last beacon stands at most this much longer. */
const OFFLINE_EXTRA_MS = 3000;
/** Harmonics whose frame hasn't been heard from for this long go auto. */
export const STALE_MS = 3000;
/** Fewest ms between two states from one frame that are taken. */
export const STATE_GAP_MS = 30;
const MAX_SENDERS = 64;

const sideOf = (p: PeerInfo) => p.side ?? 0;

export interface Heard {
  from: string;
  screen: boolean;
  pos: number;
  at: number;
  msg: BeaconMsg;
}

export interface Follow {
  /** The best beacon heard recently, or null. */
  followed(): Heard | null;
  /** When a better beacon than this frame's own was last heard (or the frame started). */
  readonly lastBetter: number;
  dispose(): void;
}

/** A touch frame listening for the beacons it should follow. */
export const createFollow = (
  net: Channel,
  me: { side: number; pos: number },
  now: () => number,
): Follow => {
  const heard = new Map<string, Heard>();
  let lastBetter = now();
  let offlineSince: number | null = null;

  const off = net.on(TOPIC.beacon, (data, from) => {
    const m = decodeBeacon(data);
    if (!m || m.s !== me.side) return;
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || sideOf(peer) !== me.side) return;
    const screen = peer.role === "screen";
    if (screen !== (m.c === 1)) return;
    // Only a screen, or a frame further left, is worth following.
    if (!screen && !(peer.pos < me.pos)) return;
    heard.delete(from);
    heard.set(from, { from, screen, pos: peer.pos, at: now(), msg: m });
    if (heard.size > MAX_SENDERS) {
      const first = heard.keys().next().value;
      if (first !== undefined) heard.delete(first);
    }
  });

  const fresh = (h: Heard, t: number) => {
    const grace = BEACON_GRACE_MS + (offlineSince !== null ? OFFLINE_EXTRA_MS : 0);
    if (t - h.at > grace) return false;
    // Online, the sender must still be in the roster.
    if (net.online) return net.peers().some((p) => p.frame === h.from);
    return true;
  };

  const followed = (): Heard | null => {
    const t = now();
    if (!net.online) offlineSince ??= t;
    else offlineSince = null;
    let best: Heard | null = null;
    for (const [id, h] of heard) {
      if (!fresh(h, t)) {
        if (t - h.at > BEACON_GRACE_MS + OFFLINE_EXTRA_MS) heard.delete(id);
        continue;
      }
      if (!best || (h.screen && !best.screen) || (h.screen === best.screen && h.pos < best.pos)) {
        best = h;
      }
    }
    if (best) lastBetter = Math.max(lastBetter, best.at);
    return best;
  };

  return {
    followed,
    get lastBetter() {
      return lastBetter;
    },
    dispose() {
      off();
      heard.clear();
    },
  };
};

export const sendState = (net: Channel, to: string, m: StateMsg): boolean => {
  if (!net.online) return false;
  net.send(TOPIC.state, encodeState(m), to);
  return true;
};

export const sendBeacon = (net: Channel, m: BeaconMsg): boolean => {
  if (!net.online) return false;
  net.send(TOPIC.beacon, encodeBeacon(m));
  return true;
};

/** Harmonic numbers a touch frame may set: one per panel, from its position in the bank. */
export const harmonicsOf = (peer: PeerInfo): { first: number; count: number } => {
  const m = perFrame(peer.kind);
  return { first: peer.pos * m + 1, count: m };
};

export interface Inbox {
  /** When each harmonic (by index, k - 1) was last heard of. */
  heardAt(i: number): number;
  dispose(): void;
}

/**
 * The frame in charge, taking touch frames' states. Only frames on its side, below or beside
 * it, in the roster may send, each only for its own harmonics, at most one message every
 * STATE_GAP_MS. The roster's position is the frame's own; the message's is ignored.
 */
export const createInbox = (
  net: Channel,
  me: { side: number; frame: string },
  now: () => number,
  onEntry: (i: number, e: StateEntry, from: string) => void,
): Inbox => {
  const lastBy = new Map<string, number>();
  const heard = new Map<number, number>();
  const off = net.on(TOPIC.state, (data, from) => {
    if (from === me.frame) return;
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role === "screen" || sideOf(peer) !== me.side) return;
    if (!Number.isInteger(peer.pos) || peer.pos < 0) return;
    const m = decodeState(data);
    if (!m) return;
    const t = now();
    const last = lastBy.get(from);
    if (last !== undefined && t - last < STATE_GAP_MS) return;
    lastBy.delete(from);
    lastBy.set(from, t);
    if (lastBy.size > MAX_SENDERS) {
      const first = lastBy.keys().next().value;
      if (first !== undefined) lastBy.delete(first);
    }
    const own = harmonicsOf(peer);
    for (const e of m.h) {
      if (e.k < own.first || e.k >= own.first + own.count) continue;
      const i = e.k - 1;
      heard.set(i, t);
      onEntry(i, e, from);
    }
  });
  return {
    heardAt(i) {
      return heard.get(i) ?? Number.NEGATIVE_INFINITY;
    },
    dispose() {
      off();
      lastBy.clear();
      heard.clear();
    },
  };
};
