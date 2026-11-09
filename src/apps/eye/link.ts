/**
 * A bank's frames and its screen. Every touch frame owns its eye and keeps working on its own;
 * while it hears the screen's beacon it sends its eye state there. The screen draws each
 * column's view from the latest state it heard, or the column's starting gallery eye when it
 * hears nothing.
 */
import type { Channel } from "../../core/types";
import {
  type BeaconMsg,
  decodeBeacon,
  decodeEye,
  encodeBeacon,
  type EyeMsg,
  MAX_POS,
  TOPIC,
} from "./wire";

export const BEACON_MS = 250;
/** A beacon not heard for this long has gone. */
export const BEACON_GRACE_MS = 3000;
/** A frame not heard from for this long shows its starting gallery eye on the screen. */
export const STALE_MS = 4000;
/** Fewest ms between two messages from one frame that are taken. */
export const EYE_GAP_MS = 60;
const MAX_SENDERS = 64;

export interface Watch {
  /** The screen's frame id while its beacon keeps coming, else null. */
  screen(): string | null;
  dispose(): void;
}

/** A touch frame listening for its screen. */
export const createWatch = (net: Channel, side: number, now: () => number): Watch => {
  let screen: string | null = null;
  let at = Number.NEGATIVE_INFINITY;
  const off = net.on(TOPIC.beacon, (data, from) => {
    const m = decodeBeacon(data);
    if (!m || m.s !== side) return;
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role !== "screen" || (peer.side ?? 0) !== side) return;
    screen = from;
    at = now();
  });
  return {
    screen() {
      if (screen === null || now() - at > BEACON_GRACE_MS) return null;
      if (net.online && !net.peers().some((p) => p.frame === screen)) return null;
      return screen;
    },
    dispose() {
      off();
      screen = null;
    },
  };
};

export const sendEye = (net: Channel, to: string, m: EyeMsg): boolean => {
  if (!net.online) return false;
  net.send(TOPIC.eye, m, to);
  return true;
};

export const sendBeacon = (net: Channel, side: number): boolean => {
  if (!net.online) return false;
  net.send(TOPIC.beacon, encodeBeacon({ s: side } satisfies BeaconMsg));
  return true;
};

export interface Heard {
  frame: string;
  /** From the roster, not the message. */
  pos: number;
  msg: EyeMsg;
  at: number;
}

export interface Inbox {
  get(frame: string): Heard | undefined;
  /** Frames heard from within STALE_MS. */
  fresh(): Heard[];
  dispose(): void;
}

/**
 * The screen hearing touch frames. Only frames on its side in the roster count, at most one
 * message from each every EYE_GAP_MS.
 */
export const createInbox = (
  net: Channel,
  me: { side: number; frame: string },
  now: () => number,
): Inbox => {
  const heard = new Map<string, Heard>();
  const off = net.on(TOPIC.eye, (data, from) => {
    if (from === me.frame) return;
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role === "screen" || (peer.side ?? 0) !== me.side) return;
    if (!Number.isInteger(peer.pos) || peer.pos < 0 || peer.pos > MAX_POS) return;
    const m = decodeEye(data);
    if (!m) return;
    const t = now();
    const prev = heard.get(from);
    if (prev && t - prev.at < EYE_GAP_MS) return;
    heard.delete(from);
    heard.set(from, { frame: from, pos: peer.pos, msg: m, at: t });
    if (heard.size > MAX_SENDERS) {
      const first = heard.keys().next().value;
      if (first !== undefined) heard.delete(first);
    }
  });
  return {
    get(frame) {
      return heard.get(frame);
    },
    fresh() {
      const t = now();
      const out: Heard[] = [];
      for (const [id, h] of heard) {
        if (t - h.at <= STALE_MS) out.push(h);
        else if (t - h.at > 60_000) heard.delete(id);
      }
      return out;
    },
    dispose() {
      off();
      heard.clear();
    },
  };
};
