/**
 * A bank's frames and its screen. Every touch frame is complete on its own; while it hears the
 * screen's beacon it also sends its cards' states there. The screen keeps the latest state heard
 * for each slot and draws from those; a screen that hears no frames runs as a lone screen.
 */
import type { Channel } from "../../core/types";
import { CHAPTERS } from "./chapters";
import { checkState } from "./chapter";
import { CHAPTER_IDS } from "./ids";
import {
  type CardMsg,
  decodeBeacon,
  decodeState,
  encodeBeacon,
  encodeState,
  MAX_POS,
  TOPIC,
} from "./wire";

export const BEACON_MS = 250;
/** A beacon not heard for this long has gone. */
export const BEACON_GRACE_MS = 3000;
/** A slot not heard from for this long is stale. */
export const STALE_MS = 4000;
/** Fewest ms between two states from one frame that are taken. */
export const STATE_GAP_MS = 60;
/** Send gaps, ms: while touched, and otherwise. */
export const SEND_BUSY_MS = 100;
export const SEND_IDLE_MS = 1000;
const MAX_SENDERS = 64;

/** Check a chapter's values against its own ranges. */
export const checkChapter = (k: number, v: unknown): readonly number[] | null => {
  const id = CHAPTER_IDS[k];
  return id ? checkState(CHAPTERS[id], v) : null;
};

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

export const sendState = (
  net: Channel,
  to: string,
  pos: number,
  cards: readonly CardMsg[],
): boolean => {
  if (!net.online || cards.length === 0) return false;
  net.send(TOPIC.state, encodeState(pos, cards), to);
  return true;
};

export const sendBeacon = (net: Channel, side: number): boolean => {
  if (!net.online) return false;
  net.send(TOPIC.beacon, encodeBeacon(side));
  return true;
};

export interface Heard {
  frame: string;
  /** From the roster, not the message. */
  pos: number;
  card: CardMsg;
  /** Local ms it arrived, and when its controls were last touched (local ms, or -Infinity). */
  at: number;
  touchedAt: number;
}

export interface Inbox {
  /** Every slot heard within STALE_MS, by slot. */
  fresh(): Map<number, Heard>;
  dispose(): void;
}

/** The screen hearing its bank. Only frames on its side in the roster count. */
export const createInbox = (
  net: Channel,
  me: { side: number; frame: string },
  now: () => number,
): Inbox => {
  const heard = new Map<string, { at: number; cards: Heard[] }>();
  const off = net.on(TOPIC.state, (data, from) => {
    if (from === me.frame) return;
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role === "screen" || (peer.side ?? 0) !== me.side) return;
    if (!Number.isInteger(peer.pos) || peer.pos < 0 || peer.pos > MAX_POS) return;
    const t = now();
    const prev = heard.get(from);
    if (prev && t - prev.at < STATE_GAP_MS) return;
    const m = decodeState(data, checkChapter);
    if (!m) return;
    heard.delete(from);
    heard.set(from, {
      at: t,
      cards: m.c.map((card) => ({
        frame: from,
        pos: peer.pos,
        card,
        at: t,
        touchedAt: card.a < 0 ? Number.NEGATIVE_INFINITY : t - card.a,
      })),
    });
    if (heard.size > MAX_SENDERS) {
      const first = heard.keys().next().value;
      if (first !== undefined) heard.delete(first);
    }
  });
  return {
    fresh() {
      const t = now();
      const out = new Map<number, Heard>();
      for (const [id, h] of heard) {
        if (t - h.at > 60_000) heard.delete(id);
        else if (t - h.at <= STALE_MS) for (const c of h.cards) out.set(c.card.s, c);
      }
      return out;
    },
    dispose() {
      off();
      heard.clear();
    },
  };
};
