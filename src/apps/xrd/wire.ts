/**
 * Messages between a bank's touch frames and its screen. Everything that arrives is checked field
 * by field and dropped whole if anything is out of range or of the wrong type, because any page
 * on the public site can join a room it guesses.
 *
 * - `state`: a touch frame's cards, to the screen: each card's slot along the bank, its chapter,
 *   that chapter's state (a few integers, checked against the chapter's own ranges), how long ago
 *   its controls were last touched (ms, in steps of 100), whether by a person, and whether its
 *   "So" line is earned. About ten times
 *   a second while touched, once a second otherwise.
 * - `beacon`: the screen to everyone, four times a second, so frames know where to send.
 */
import { MAX_STATE } from "./chapter";
import { CHAPTER_COUNT } from "./ids";

export const TOPIC = { state: "xr:state", beacon: "xr:beacon" } as const;

export const MAX_POS = 63;
export const MAX_SLOT = 127;
export const MAX_CARDS = 2;
/** Ages are sent in steps of this, and capped. */
export const AGE_STEP = 100;
export const MAX_AGE = 600_000;
/** No chapter state value is bigger than this either way. */
export const MAX_VALUE = 1_000_000;

export interface CardMsg {
  /** Slot along the bank: frames left to right, a pair's halves in turn. */
  s: number;
  /** Chapter, an index into CHAPTER_IDS. */
  k: number;
  /** The chapter's state. */
  v: number[];
  /** ms since its controls were last touched, or -1 never. */
  a: number;
  /** 1 when that touch was a person's. */
  h: 0 | 1;
  /** 1 while a finger is on a control. */
  d: 0 | 1;
  /** 1 once the chapter's "So" line is earned (absent from older frames: 0). */
  e?: 0 | 1;
}

export interface StateMsg {
  p: number;
  c: CardMsg[];
}

export interface BeaconMsg {
  /** Side of the bank (0 or 1). */
  s: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

const bit = (v: unknown): v is 0 | 1 => v === 0 || v === 1;

export const ageOf = (ms: number): number =>
  Number.isFinite(ms) ? Math.min(MAX_AGE, Math.max(0, Math.round(ms / AGE_STEP) * AGE_STEP)) : -1;

export const encodeState = (pos: number, cards: readonly CardMsg[]): StateMsg => ({
  p: Math.max(0, Math.min(MAX_POS, Math.round(pos))),
  c: cards.slice(0, MAX_CARDS).map((c) => ({ ...c, v: [...c.v] })),
});

/**
 * Check a state message. `check` checks one chapter's values against its ranges and returns
 * them, or null to drop the whole message.
 */
export const decodeState = (
  data: unknown,
  check: (chapter: number, v: unknown) => readonly number[] | null,
): StateMsg | null => {
  if (!isObject(data)) return null;
  if (!int(data.p, 0, MAX_POS)) return null;
  const cards = data.c;
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > MAX_CARDS) return null;
  const out: CardMsg[] = [];
  for (const c of cards) {
    if (!isObject(c)) return null;
    if (!int(c.s, 0, MAX_SLOT) || !int(c.k, 0, CHAPTER_COUNT - 1)) return null;
    if (!(c.a === -1 || int(c.a, 0, MAX_AGE)) || !bit(c.h) || !bit(c.d)) return null;
    if (c.e !== undefined && !bit(c.e)) return null;
    if (!Array.isArray(c.v) || c.v.length > MAX_STATE) return null;
    if (!c.v.every((x) => int(x, -MAX_VALUE, MAX_VALUE))) return null;
    const v = check(c.k, c.v);
    if (!v) return null;
    out.push({ s: c.s, k: c.k, v: [...v], a: c.a, h: c.h, d: c.d, e: c.e === 1 ? 1 : 0 });
  }
  return { p: data.p, c: out };
};

export const encodeBeacon = (side: number): BeaconMsg => ({ s: side === 1 ? 1 : 0 });

export const decodeBeacon = (data: unknown): BeaconMsg | null => {
  if (!isObject(data) || !int(data.s, 0, 1)) return null;
  return { s: data.s };
};
