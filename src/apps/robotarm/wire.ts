/**
 * Messages between a bank's frames and its screen. Everything that arrives is checked field by
 * field and dropped whole if anything is out of range, because any page on the public site can
 * join a room it guesses.
 *
 * - `up`: a touch frame to the screen above it, once for each piece its lift sends up.
 * - `need`: the screen to every frame, about once a second: which colours its picture still
 *   wants. It doubles as the screen's beacon; frames show their lift only while it keeps coming.
 * - `exit`: a touch frame to the screen: where its lift's beam leaves the frame's top edge and
 *   how wide it is, so the screen carries the same beam on. Sent when the screen is first heard,
 *   whenever the beam moves (someone turned the view) and every few seconds.
 */

export const TOPIC = { up: "ra:up", need: "ra:need", exit: "ra:exit" } as const;

export const MAX_POS = 63;

export interface UpMsg {
  /** Colour index, 0 to 2. */
  c: number;
  /** 0 block, 1 ball. */
  k: number;
  /** The frame's position in its bank. */
  p: number;
  /** Where the piece left the frame, thousandths of its width from the left. */
  u: number;
  /** 1 when a person sent it. */
  h: number;
}

export interface NeedMsg {
  /** Side of the bank (0 or 1). */
  s: number;
  /** Squares still wanted per colour. */
  n: [number, number, number];
  /** Picture index and share filled, in hundredths. */
  pic: number;
  f: number;
}

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const encodeUp = (m: UpMsg): UpMsg => ({
  c: m.c,
  k: m.k,
  p: Math.max(0, Math.min(MAX_POS, Math.round(m.p))),
  u: Math.max(0, Math.min(1000, Math.round(m.u))),
  h: m.h ? 1 : 0,
});

export const decodeUp = (d: unknown): UpMsg | null => {
  if (!isObject(d)) return null;
  const { c, k, p, u, h } = d;
  if (!int(c, 0, 2) || !int(k, 0, 1) || !int(p, 0, MAX_POS) || !int(u, 0, 1000) || !int(h, 0, 1)) {
    return null;
  }
  return { c, k, p, u, h };
};

export const encodeNeed = (m: NeedMsg): NeedMsg => ({
  s: m.s === 1 ? 1 : 0,
  n: [0, 1, 2].map((i) => Math.max(0, Math.min(999, Math.round(m.n[i] ?? 0)))) as [
    number,
    number,
    number,
  ],
  pic: Math.max(0, Math.min(63, Math.round(m.pic))),
  f: Math.max(0, Math.min(100, Math.round(m.f))),
});

export const decodeNeed = (d: unknown): NeedMsg | null => {
  if (!isObject(d)) return null;
  const { s, n, pic, f } = d;
  if (!int(s, 0, 1) || !int(pic, 0, 63) || !int(f, 0, 100)) return null;
  if (!Array.isArray(n) || n.length !== 3 || !n.every((x) => int(x, 0, 999))) return null;
  return { s, n: [n[0], n[1], n[2]] as [number, number, number], pic, f };
};

export interface ExitMsg {
  p: number;
  /** Centre and width, thousandths of the frame's width; width 0 when the beam is off the frame. */
  u: number;
  w: number;
}

/** Widest beam a frame may report, thousandths of its width. */
export const MAX_BEAM_W = 400;

export const encodeExit = (m: ExitMsg): ExitMsg => ({
  p: Math.max(0, Math.min(MAX_POS, Math.round(m.p))),
  u: Math.max(0, Math.min(1000, Math.round(m.u))),
  w: Math.max(0, Math.min(MAX_BEAM_W, Math.round(m.w))),
});

export const decodeExit = (d: unknown): ExitMsg | null => {
  if (!isObject(d)) return null;
  const { p, u, w } = d;
  if (!int(p, 0, MAX_POS) || !int(u, 0, 1000) || !int(w, 0, MAX_BEAM_W)) return null;
  return { p, u, w };
};
