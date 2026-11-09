/**
 * Messages between a bank's touch frames and its screen. Touch frames send what their keys,
 * glide strips, sliders and maps are doing; the screen owns the plate and reports what rings and
 * how the plate is set. Every decoder checks every field and returns null for anything else.
 */
export const TOPIC_NOTE = "ch:note";
export const TOPIC_GLIDE = "ch:glide";
export const TOPIC_KNOB = "ch:knob";
export const TOPIC_PLATE = "ch:plate";
export const TOPIC_SPRINKLE = "ch:sprinkle";

/** Held notes and glides repeat this often, as a heartbeat. */
export const HEARTBEAT_MS = 500;
/** Glide updates while a strip is held go at most this often. */
export const GLIDE_HZ = 15;
/** The screen reports its plate this often, and more often while someone turns a knob. */
export const PLATE_MS = 500;
export const PLATE_BUSY_MS = 160;
/** A touch frame with no plate report for this long plays its own plate. */
export const SCREEN_TIMEOUT_MS = 3000;
/** The screen sprinkles at most this often at the touch frames' request. */
export const SPRINKLE_GAP_MS = 8000;
/** Messages stamped further than this from the receiver's clock are refused. */
export const MAX_SKEW_MS = 10_000;

const MAX_KEY = 255;
const MAX_MODE = 63;
const MAX_STRIP = 31;
const MAX_FREQ = 1000;
const MAX_RINGING = 8;

export interface NoteMsg {
  /** Key number along the bank. */
  k: number;
  /** The mode it plays. */
  m: number;
  on: boolean;
  /** Shared clock time. */
  t: number;
  /** Played by a bot, so the screen doesn't count it as a visitor. */
  a: boolean;
}

export interface GlideMsg {
  /** Strip number along the bank (one per panel). */
  g: number;
  /** Relative frequency. */
  f: number;
  on: boolean;
  t: number;
  a: boolean;
}

/** Knobs: 0 stretch, 1 damping, 2 the drive point. */
export const KNOB_CODES = ["stretch", "damping", "at"] as const;

export interface KnobMsg {
  /** Which knob (see KNOB_CODES). */
  c: number;
  /** Stretch or damping (0 to 1), or the drive point's u. */
  x: number;
  /** The drive point's v; 0 otherwise. */
  y: number;
  /** A finger still holds it. */
  on: boolean;
  /** Shared clock time the touch began: the latest touch wins. */
  s: number;
  t: number;
  a: boolean;
}

export interface PlateMsg {
  /** Ringing modes with their amplitude's in-step and quarter-cycle parts in hundredths. */
  m: [number, number, number][];
  /** The screen's own glide frequency (its attract tune), or -1. */
  f: number;
  /** True while the screen plays its attract tune. */
  a: boolean;
  /** Stretch and damping in thousandths. */
  s: number;
  d: number;
  /** The drive point in thousandths. */
  p: [number, number];
  /** The plate's long side runs across. */
  w: boolean;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const decodeNote = (data: unknown): NoteMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const { k, m, on, t, a } = d;
  if (!int(k, 0, MAX_KEY) || !int(m, 0, MAX_MODE) || typeof on !== "boolean" || !finite(t)) {
    return null;
  }
  if (typeof a !== "boolean") return null;
  return { k, m, on, t, a };
};

export const decodeGlide = (data: unknown): GlideMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const { g, f, on, t, a } = d;
  if (!int(g, 0, MAX_STRIP) || !finite(f) || f <= 0 || f > MAX_FREQ) return null;
  if (typeof on !== "boolean" || !finite(t) || typeof a !== "boolean") return null;
  return { g, f, on, t, a };
};

export const decodeKnob = (data: unknown): KnobMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const { c, x, y, on, s, t, a } = d;
  if (!int(c, 0, KNOB_CODES.length - 1) || !finite(x) || !finite(y)) return null;
  if (Math.abs(x) > 1 || Math.abs(y) > 1) return null;
  if (typeof on !== "boolean" || !finite(s) || !finite(t) || typeof a !== "boolean") return null;
  if (s > t + 1) return null;
  return { c, x, y, on, s, t, a };
};

export const decodePlate = (data: unknown): PlateMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const { m, f, a, s, p, w } = d;
  const damping = d.d;
  if (!Array.isArray(m) || m.length > MAX_RINGING || !finite(f) || typeof a !== "boolean") {
    return null;
  }
  if (!int(s, 0, 1000) || !int(damping, 0, 1000) || typeof w !== "boolean") return null;
  if (!Array.isArray(p) || p.length !== 2 || !int(p[0], -1000, 1000) || !int(p[1], -1000, 1000)) {
    return null;
  }
  const rows: [number, number, number][] = [];
  for (const row of m) {
    if (!Array.isArray(row) || row.length !== 3) return null;
    const [mode, re, im] = row as unknown[];
    if (!int(mode, 0, MAX_MODE) || !int(re, -400, 400) || !int(im, -400, 400)) return null;
    rows.push([mode, re, im]);
  }
  if (f !== -1 && (f <= 0 || f > MAX_FREQ)) return null;
  return { m: rows, f, a, s, d: damping, p: [p[0], p[1]], w };
};

const hundredths = (v: number) => Math.max(-400, Math.min(400, Math.round(v * 100)));
const thousandths = (v: number, lo: number) => Math.max(lo, Math.min(1000, Math.round(v * 1000)));

export const encodePlate = (
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  order: readonly number[],
  f: number | null,
  attract: boolean,
  knobs: { stretch: number; damping: number; at: { u: number; v: number }; wide: boolean },
): PlateMsg => ({
  m: order
    .slice(0, MAX_RINGING)
    .map((i) => [i, hundredths(re[i] ?? 0), hundredths(im[i] ?? 0)] as [number, number, number])
    .filter(([, r, i]) => r !== 0 || i !== 0),
  f: f === null ? -1 : Math.round(f * 1000) / 1000,
  a: attract,
  s: thousandths(knobs.stretch, 0),
  d: thousandths(knobs.damping, 0),
  p: [thousandths(knobs.at.u, -1000), thousandths(knobs.at.v, -1000)],
  w: knobs.wide,
});

/** True when a message stamped `t` is close enough to `now` (both on the shared clock). */
export const fresh = (t: number, now: number): boolean => Math.abs(t - now) <= MAX_SKEW_MS;
