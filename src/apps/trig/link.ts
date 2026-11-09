/**
 * A bank's frames and its screen. Every touch frame owns its angle and keeps working on its
 * own; while it hears the screen's beacon it sends its angle there. The screen draws a frame
 * that is on the bank's slow turn from the shared clock itself, so the travelling wave needs
 * no messages, and a frame turning its own angle from the frame's messages.
 */
import type { Channel } from "../../core/types";
import {
  type AngleMsg,
  decodeAngle,
  decodeBeacon,
  encodeAngle,
  encodeBeacon,
  FLAG,
  MAX_POS,
  TOPIC,
  unquantAngle,
} from "./wire";

export const BEACON_MS = 250;
/** A beacon not heard for this long has gone. */
export const BEACON_GRACE_MS = 3000;
/** A frame not heard from for this long is taken to be on the slow turn. */
export const STALE_MS = 3000;
/** Fewest ms between two angles from one frame that are taken. */
export const ANGLE_GAP_MS = 30;
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

export const sendAngle = (net: Channel, to: string, m: AngleMsg): boolean => {
  if (!net.online) return false;
  net.send(TOPIC.angle, encodeAngle(m), to);
  return true;
};

export const sendBeacon = (net: Channel, side: number): boolean => {
  if (!net.online) return false;
  net.send(TOPIC.beacon, encodeBeacon({ s: side }));
  return true;
};

export interface Heard {
  frame: string;
  /** From the roster, not the message. */
  pos: number;
  theta: number;
  flags: number;
  n: number;
  at: number;
  /** When its finger went down (the latest press), and when one was last seen down. */
  heldStart: number;
  heldLast: number;
  personAt: number;
}

export interface Inbox {
  get(frame: string): Heard | undefined;
  /** Frames heard from within STALE_MS. */
  fresh(): Heard[];
  dispose(): void;
}

/**
 * The screen hearing touch frames. Only frames on its side in the roster count, at most one
 * message from each every ANGLE_GAP_MS.
 */
export const createInbox = (
  net: Channel,
  me: { side: number; frame: string },
  now: () => number,
): Inbox => {
  const heard = new Map<string, Heard>();
  const off = net.on(TOPIC.angle, (data, from) => {
    if (from === me.frame) return;
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role === "screen" || (peer.side ?? 0) !== me.side) return;
    if (!Number.isInteger(peer.pos) || peer.pos < 0 || peer.pos > MAX_POS) return;
    const m = decodeAngle(data);
    if (!m) return;
    const t = now();
    const prev = heard.get(from);
    if (prev && t - prev.at < ANGLE_GAP_MS) return;
    const held = (m.f & FLAG.held) !== 0;
    const wasHeld = prev ? (prev.flags & FLAG.held) !== 0 : false;
    const next: Heard = {
      frame: from,
      pos: peer.pos,
      theta: unquantAngle(m.a),
      flags: m.f,
      n: m.n,
      at: t,
      heldStart: held && !wasHeld ? t : (prev?.heldStart ?? Number.NEGATIVE_INFINITY),
      heldLast: held ? t : (prev?.heldLast ?? Number.NEGATIVE_INFINITY),
      personAt: m.f & FLAG.person ? t : (prev?.personAt ?? Number.NEGATIVE_INFINITY),
    };
    heard.delete(from);
    heard.set(from, next);
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
