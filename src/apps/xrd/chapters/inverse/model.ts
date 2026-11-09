/**
 * Chapter 7's model, pure so the tests and the screen share it. A flat crystal: N by N repeats of
 * a rectangular cell a by b, turned. Its pattern's spots sit 1/a and 1/b apart along the same
 * turned axes, so squashing the crystal one way spreads the spots the other way; a crystal L
 * across gives spots about 1/L wide.
 */
import { type Atoms, atomWriter } from "../../engine/model";
import type { PatternJob } from "../../engine/pattern";

/** Cell edges, Å. */
export const A_MIN = 2.5;
export const A_MAX = 8;
/** Repeats along each edge. Ten of the widest cells, turned, still fit the 128 Å grid. */
export const N_MIN = 2;
export const N_MAX = 10;
/** Real-space Å per engine pixel at any grid size, so the 256 and 512 pictures match. */
export const A_PER_PX = 0.5;
export const Z = 13;
export const SIGMA = 0.4;
/** How lopsided the cell must be before the pattern has visibly gone the other way. */
export const SQUASHED = 1.6;

export interface InverseState {
  a: number;
  b: number;
  /** Degrees, counterclockwise, 0 to 360. */
  turn: number;
  repeats: number;
}

export const START: InverseState = { a: 4.5, b: 4.5, turn: 0, repeats: 6 };

/** The children's shape tiles: tall, square, wide. */
export const SHAPES: readonly { a: number; b: number }[] = [
  { a: 3.2, b: 6.4 },
  { a: 4.5, b: 4.5 },
  { a: 6.4, b: 3.2 },
];

export const STATE_RANGES: readonly (readonly [number, number])[] = [
  [A_MIN * 20, A_MAX * 20],
  [A_MIN * 20, A_MAX * 20],
  [0, 359],
  [N_MIN, N_MAX],
];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const wrap360 = (d: number) => ((d % 360) + 360) % 360;

export const clean = (s: InverseState): InverseState => ({
  a: clamp(s.a, A_MIN, A_MAX),
  b: clamp(s.b, A_MIN, A_MAX),
  turn: wrap360(s.turn),
  repeats: Math.round(clamp(s.repeats, N_MIN, N_MAX)),
});

export const encode = (s: InverseState): number[] => {
  const c = clean(s);
  return [Math.round(c.a * 20), Math.round(c.b * 20), Math.round(c.turn) % 360, c.repeats];
};

export const decode = (v: readonly number[]): InverseState =>
  clean({
    a: (v[0] ?? 90) / 20,
    b: (v[1] ?? 90) / 20,
    turn: v[2] ?? 0,
    repeats: v[3] ?? START.repeats,
  });

export const squashed = (s: InverseState): boolean =>
  Math.max(s.a, s.b) / Math.min(s.a, s.b) >= SQUASHED - 1e-9;

/** Which shape tile a state matches, or -1. */
export const shapeOf = (s: InverseState): number =>
  SHAPES.findIndex((p) => Math.abs(p.a - s.a) < 0.05 && Math.abs(p.b - s.b) < 0.05);

/** Width of the crystal along its narrower edge, Å: the size its spots' width follows. */
export const sizeOf = (s: InverseState): number => s.repeats * Math.min(s.a, s.b);

/**
 * Each repeat's share of the light: full in the middle, easing off over the outer repeats, so the
 * crystal's hard edges don't streak the pattern. Two repeats stay equal.
 */
export const taper = (i: number, n: number): number => {
  if (n <= 2) return 1;
  const t = (i + 0.5) / n;
  return Math.sin(Math.PI * t) ** 0.6;
};

/** The crystal's atoms, centred on the origin, turned counterclockwise by `turn`. */
export const crystalAtoms = (s: InverseState): Atoms => {
  const c = clean(s);
  const n = c.repeats;
  const th = (c.turn * Math.PI) / 180;
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const out = atomWriter(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const u = (i - (n - 1) / 2) * c.a;
      const v = (j - (n - 1) / 2) * c.b;
      out.push(u * cs - v * sn, u * sn + v * cs, Z * taper(i, n) * taper(j, n), SIGMA);
    }
  }
  return out.done();
};

/** The beam stop grows with the straight-through beam's width, which is a spot's width. */
export const stopOf = (s: InverseState): number =>
  Math.max(0.035, Math.min(0.09, 0.6 / sizeOf(clean(s))));

export const patternJob = (s: InverseState, n: number): PatternJob => ({
  op: "pattern",
  n,
  span: n * A_PER_PX,
  source: { atoms: crystalAtoms(s) },
  scale: "sqrt",
  stop: stopOf(s),
});

export const jobKey = (s: InverseState, n: number): string => `${n}:${encode(s).join(",")}`;

/** The pattern's two step arrows, Å⁻¹: 1/a along the turned a edge, 1/b along b. */
export const steps = (s: InverseState): { as: [number, number]; bs: [number, number] } => {
  const th = (s.turn * Math.PI) / 180;
  return {
    as: [Math.cos(th) / s.a, Math.sin(th) / s.a],
    bs: [-Math.sin(th) / s.b, Math.cos(th) / s.b],
  };
};

/** A screen with nobody touching: squash and stretch, turn, then fewer and more repeats. */
export const playAt = (t: number): InverseState => {
  const k = (t / 4) % 6;
  const phase = Math.floor(k);
  const f = 0.5 - 0.5 * Math.cos(Math.PI * (k - phase));
  const lerp = (x: number, y: number) => x + (y - x) * f;
  const sq = SHAPES[1]!;
  const wide = SHAPES[2]!;
  const tall = SHAPES[0]!;
  switch (phase) {
    case 0:
      return clean({ a: lerp(sq.a, wide.a), b: lerp(sq.b, wide.b), turn: 0, repeats: 6 });
    case 1:
      return clean({ a: wide.a, b: wide.b, turn: lerp(0, 30), repeats: 6 });
    case 2:
      return clean({ a: lerp(wide.a, tall.a), b: lerp(wide.b, tall.b), turn: 30, repeats: 6 });
    case 3:
      return clean({ a: tall.a, b: tall.b, turn: lerp(30, 0), repeats: Math.round(lerp(6, 2)) });
    case 4:
      return clean({ a: lerp(tall.a, sq.a), b: lerp(tall.b, sq.b), turn: 0, repeats: 2 });
    default:
      return clean({ a: sq.a, b: sq.b, turn: 0, repeats: Math.round(lerp(2, 6)) });
  }
};
