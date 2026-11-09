/**
 * Messages between a bank's touch frames and the screen above them. Positions are in a crane's
 * pad box (0..1 across the trolley's travel, 0..1 up to the top of the hook's work), sent as
 * thousandths. Everything that arrives is checked field by field and dropped whole if anything
 * is out of range, because any page on the public site can join a room it guesses.
 *
 * Frame to screen (to the screen on its side only):
 * - `pad`: where a finger aims a crane's hook, up to 15 times a second while held, and once
 *   more when it lifts (`h` 0). `c` is the crane on the frame: 0, or 1 for a pair's right half.
 * - `rel`: the release button. `blk`: a block that rode the lift out of the frame's top edge.
 * - `exit`: where the frame's lift leaves its top edge and how wide it is (shares of the
 *   frame's width), when the screen is first heard and every few seconds.
 *
 * Screen to each frame (addressed to it):
 * - `st` about five times a second: each of its cranes as the screen simulates it. It doubles as
 *   the screen's beacon. `geo` once a second and whenever a crane's lot changes: the shapes on
 *   the pad's little picture, and where the screen's mast stands, so the frame's mast foot
 *   carries straight on up.
 */

export const TOPIC = {
  pad: "sk:pad",
  rel: "sk:rel",
  blk: "sk:blk",
  exit: "sk:exit",
  st: "sk:st",
  geo: "sk:geo",
} as const;

export const MAX_POS = 63;
/** Shapes on a pad's picture: a tall tower's blocks, or a lot's slots, plus the yard. */
export const MAX_SLOTS = 64;
export const MAX_YARD = 8;

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const q = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
/** Box positions may sit a little outside 0..1 (a lot beyond the trolley's travel). */
const LO = -1000;
const HI = 2000;

export interface PadMsg {
  c: number;
  x: number;
  y: number;
  /** 1 while a finger is down. */
  h: number;
  /** 1 when a bot's finger. */
  b: number;
}

export const encodePad = (m: PadMsg): PadMsg => ({
  c: q(m.c, 0, 1),
  x: q(m.x, 0, 1000),
  y: q(m.y, 0, 1000),
  h: m.h ? 1 : 0,
  b: m.b ? 1 : 0,
});

export const decodePad = (d: unknown): PadMsg | null => {
  if (!isObject(d)) return null;
  const { c, x, y, h, b } = d;
  if (!int(c, 0, 1) || !int(x, 0, 1000) || !int(y, 0, 1000) || !int(h, 0, 1) || !int(b, 0, 1)) {
    return null;
  }
  return { c, x, y, h, b };
};

export interface RelMsg {
  c: number;
  b: number;
}

export const decodeRel = (d: unknown): RelMsg | null => {
  if (!isObject(d)) return null;
  const { c, b } = d;
  if (!int(c, 0, 1) || !int(b, 0, 1)) return null;
  return { c, b };
};

export interface BlkMsg {
  c: number;
  /** Block kind. */
  k: number;
  /** 1 when a person sent it. */
  h: number;
}

export const decodeBlk = (d: unknown): BlkMsg | null => {
  if (!isObject(d)) return null;
  const { c, k, h } = d;
  if (!int(c, 0, 1) || !int(k, 0, 3) || !int(h, 0, 1)) return null;
  return { c, k, h };
};

export interface ExitMsg {
  c: number;
  /** Centre and width of the lift where it leaves the frame, thousandths of the frame's width. */
  u: number;
  w: number;
}

export const MAX_EXIT_W = 400;

export const encodeExit = (m: ExitMsg): ExitMsg => ({
  c: q(m.c, 0, 1),
  u: q(m.u, 0, 1000),
  w: q(m.w, 0, MAX_EXIT_W),
});

export const decodeExit = (d: unknown): ExitMsg | null => {
  if (!isObject(d)) return null;
  const { c, u, w } = d;
  if (!int(c, 0, 1) || !int(u, 0, 1000) || !int(w, 0, MAX_EXIT_W)) return null;
  return { c, u, w };
};

/** One crane as the screen sees it. Positions in box thousandths; -1 where there is none. */
export interface CraneState {
  c: number;
  /** Geometry generation this state's `f` refers to. */
  g: number;
  tr: number;
  hx: number;
  hy: number;
  /** Carried block's centre, or -1 when not carrying. */
  lx: number;
  ly: number;
  /** Carried kind, or -1. */
  k: number;
  tx: number;
  ty: number;
  /** Who drives: 0 autopilot, 1 a person, 2 a bot. */
  d: number;
  /** Each slot's kind ("0" to "3") or "-" when empty, in `geo` order. */
  f: string;
  /** Each yard slot's kind or "-". */
  yd: string;
  /** Blocks the yard can still take. */
  fr: number;
  /** Readout hints for bots: pick, drop and park targets (-1 for none), carry height. */
  px: number;
  py: number;
  dx: number;
  dy: number;
  qx: number;
  qy: number;
  cy: number;
  /** Swing in milliradians, period in centiseconds. */
  sw: number;
  pe: number;
  /** Trolley speed and acceleration, hoist speed, block height, jitter: box thousandths. */
  vx: number;
  ax: number;
  vy: number;
  un: number;
  j: number;
  /** The carried block is where the hook lets go by itself. */
  z: number;
  /** Where the carried block would snap, for the guide line, or -1. */
  gx: number;
  gy: number;
}

export interface StMsg {
  s: number;
  cr: CraneState[];
}

const STATE_INTS: [keyof CraneState, number, number][] = [
  ["c", 0, 1],
  ["g", 0, 1_000_000],
  ["tr", LO, HI],
  ["hx", LO, HI],
  ["hy", LO, HI],
  ["lx", LO, HI],
  ["ly", LO, HI],
  ["k", -1, 3],
  ["tx", LO, HI],
  ["ty", LO, HI],
  ["d", 0, 2],
  ["fr", 0, 9],
  ["px", LO, HI],
  ["py", LO, HI],
  ["dx", LO, HI],
  ["dy", LO, HI],
  ["qx", LO, HI],
  ["qy", LO, HI],
  ["cy", LO, HI],
  ["sw", 0, 10_000],
  ["pe", 0, 10_000],
  ["vx", 0, 100_000],
  ["ax", 0, 100_000],
  ["vy", 0, 100_000],
  ["un", 0, 1000],
  ["j", 0, 1000],
  ["z", 0, 1],
  ["gx", LO, HI],
  ["gy", LO, HI],
];

const KINDS = /^[-0-3]*$/;

export const decodeCraneState = (d: unknown): CraneState | null => {
  if (!isObject(d)) return null;
  for (const [key, lo, hi] of STATE_INTS) if (!int(d[key], lo, hi)) return null;
  const { f, yd } = d;
  if (typeof f !== "string" || f.length > MAX_SLOTS || !KINDS.test(f)) return null;
  if (typeof yd !== "string" || yd.length > MAX_YARD || !KINDS.test(yd)) return null;
  const out = {} as Record<string, unknown>;
  for (const [key] of STATE_INTS) out[key] = d[key];
  out.f = f;
  out.yd = yd;
  return out as unknown as CraneState;
};

export const decodeSt = (d: unknown): StMsg | null => {
  if (!isObject(d)) return null;
  const { s, cr } = d;
  if (!int(s, 0, 1) || !Array.isArray(cr) || cr.length < 1 || cr.length > 2) return null;
  const list: CraneState[] = [];
  for (const c of cr) {
    const m = decodeCraneState(c);
    if (!m) return null;
    list.push(m);
  }
  return { s, cr: list };
};

export interface CraneGeo {
  c: number;
  g: number;
  /** Block size in box thousandths. */
  bw: number;
  bh: number;
  /** Slot (or tower block) bottom-left corners, x then y, box thousandths. */
  sl: number[];
  /** "1" for each slot that is a top slot (roofs fit), else "0". */
  tp: string;
  /** "1" for each slot drawn rounded (the round tower). */
  rd: string;
  /** Yard slot centres, box thousandths. */
  yx: number[];
  /** Where the screen's mast stands and how wide it is, thousandths of the lane's width. */
  mu: number;
  mw: number;
}

export interface GeoMsg {
  s: number;
  cr: CraneGeo[];
}

const BITS = /^[01]*$/;

export const decodeCraneGeo = (d: unknown): CraneGeo | null => {
  if (!isObject(d)) return null;
  const { c, g, bw, bh, sl, tp, rd, yx, mu, mw } = d;
  if (!int(c, 0, 1) || !int(g, 0, 1_000_000) || !int(bw, 1, 1000) || !int(bh, 1, 1000)) {
    return null;
  }
  if (!int(mu, 0, 1000) || !int(mw, 0, 400)) return null;
  if (!Array.isArray(sl) || sl.length % 2 !== 0 || sl.length > 2 * MAX_SLOTS) return null;
  if (!sl.every((v) => int(v, LO, HI))) return null;
  const n = sl.length / 2;
  if (typeof tp !== "string" || tp.length !== n || !BITS.test(tp)) return null;
  if (typeof rd !== "string" || rd.length !== n || !BITS.test(rd)) return null;
  if (!Array.isArray(yx) || yx.length > MAX_YARD || !yx.every((v) => int(v, LO, HI))) return null;
  return { c, g, bw, bh, sl: [...sl], tp, rd, yx: [...yx], mu, mw };
};

export const decodeGeo = (d: unknown): GeoMsg | null => {
  if (!isObject(d)) return null;
  const { s, cr } = d;
  if (!int(s, 0, 1) || !Array.isArray(cr) || cr.length < 1 || cr.length > 2) return null;
  const list: CraneGeo[] = [];
  for (const c of cr) {
    const m = decodeCraneGeo(c);
    if (!m) return null;
    list.push(m);
  }
  return { s, cr: list };
};
