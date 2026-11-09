/**
 * Seeded terrain for one lane: a polyline from ridge to ridge with two or three flat landing
 * pads. The widest pad scores one star, the narrowest three. Pure.
 */
import type { Rng } from "../../core/types";
import type { CrewSpec, Layout } from "./layout";

export interface LandingPad {
  x0: number;
  x1: number;
  y: number;
  stars: number;
}

export interface Terrain {
  /** Polyline vertices, x increasing, from the lane's left end to its right. */
  xs: Float32Array;
  ys: Float32Array;
  pads: LandingPad[];
  /** Where every run on this terrain starts. */
  spawn: { x: number; vx: number };
}

export interface TerrainInput {
  lane: { x0: number; x1: number };
  ground: { top: number; bottom: number };
  craft: number;
  noLand: readonly (readonly [number, number])[];
  /** Speed scale (drop over the reference drop), for the start drift. */
  q: number;
}

/** The terrain input for one crew's lane. `q` is the speed scale (`Physics.q`). */
export const terrainInputOf = (layout: Layout, spec: CrewSpec, q: number): TerrainInput => ({
  lane: spec.lane,
  ground: layout.ground,
  craft: layout.craft,
  noLand: spec.noLand,
  q,
});

/** Pad widths in craft sizes, by stars. */
export const PAD_WIDTH: Record<number, number> = { 1: 2.5, 2: 1.85, 3: 1.35 };
const MIN_GAP = 0.6;
const EDGE = 0.5;
/** Polyline vertices are about this far apart, in craft sizes. */
const STEP = 0.32;
/** Most vertices one lane can have, so a very wide lane can't grow the arrays without bound. */
export const MAX_VERTS = 512;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Usable x intervals: the lane less its ends and the no-landing ranges. */
const intervals = (input: TerrainInput): [number, number][] => {
  const S = input.craft;
  let out: [number, number][] = [[input.lane.x0 + EDGE * S, input.lane.x1 - EDGE * S]];
  for (const [a0, a1] of input.noLand) {
    const b0 = a0 - 0.3 * S;
    const b1 = a1 + 0.3 * S;
    const next: [number, number][] = [];
    for (const [x0, x1] of out) {
      if (b1 <= x0 || b0 >= x1) next.push([x0, x1]);
      else {
        if (b0 > x0) next.push([x0, b0]);
        if (b1 < x1) next.push([b1, x1]);
      }
    }
    out = next;
  }
  return out.filter(([a, b]) => b > a);
};

const placePads = (rng: Rng, input: TerrainInput): LandingPad[] => {
  const S = input.craft;
  const spans = intervals(input).sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
  const span = spans[0];
  if (!span) return [];
  const length = span[1] - span[0];
  const fits = (stars: number[]) =>
    stars.reduce((sum, s) => sum + PAD_WIDTH[s]! * S, 0) + (stars.length - 1) * MIN_GAP * S <=
    length;
  let stars = [1, 2, 3];
  if (!fits(stars)) stars = [1, 3];
  if (!fits(stars)) stars = [2];
  if (!fits(stars)) return [];
  // Shuffle so the best pad isn't always in the same place.
  for (let i = stars.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [stars[i], stars[j]] = [stars[j]!, stars[i]!];
  }
  const widths = stars.map((s) => PAD_WIDTH[s]! * S);
  const free = length - widths.reduce((a, b) => a + b, 0) - (stars.length - 1) * MIN_GAP * S;
  const weights = Array.from({ length: stars.length + 1 }, () => rng.range(0.3, 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const { top, bottom } = input.ground;
  const band = bottom - top;
  let x = span[0];
  return stars.map((s, i) => {
    x += (free * weights[i]!) / total + (i > 0 ? MIN_GAP * S : 0);
    const x0 = x;
    x += widths[i]!;
    // The narrowest pad tends to sit higher, on a mesa.
    const lift = s === 3 ? rng.range(0.15, 0.55) : rng.range(0, 0.45);
    const y = bottom - 0.1 * band - lift * band;
    // Rounded like the polyline's Float32 vertices, so a pad and the ground under it agree.
    return {
      x0: Math.fround(x0),
      x1: Math.fround(x0 + widths[i]!),
      y: Math.fround(clamp(y, top + 0.3 * band, bottom - 0.08 * band)),
      stars: s,
    };
  });
};

export const generateTerrain = (rng: Rng, input: TerrainInput): Terrain => {
  const S = input.craft;
  const { x0: L0, x1: L1 } = input.lane;
  const { top, bottom } = input.ground;
  const pads = placePads(rng.fork("pads"), input);
  const hills = rng.fork("hills");

  // Fixed points: ridges at both lane ends and each pad with a little drop at its edges.
  const fixed: { x: number; y: number }[] = [{ x: L0, y: top }];
  const sorted = [...pads].sort((a, b) => a.x0 - b.x0);
  for (const p of sorted) {
    const lip = Math.min(bottom, p.y + 0.14 * S);
    fixed.push({ x: p.x0 - 0.22 * S, y: lip }, { x: p.x0, y: p.y }, { x: p.x1, y: p.y });
    fixed.push({ x: p.x1 + 0.22 * S, y: lip });
  }
  fixed.push({ x: L1, y: top });

  const xs: number[] = [];
  const ys: number[] = [];
  const push = (x: number, y: number) => {
    if (xs.length >= MAX_VERTS) return;
    xs.push(x);
    ys.push(y);
  };
  /** Midpoint displacement between two fixed points, kept inside the band. */
  const fill = (ax: number, ay: number, bx: number, by: number, depth: number) => {
    const len = bx - ax;
    if (len <= STEP * S || depth > 9) return;
    const mx = (ax + bx) / 2;
    const rough = depth === 0 ? 0.42 : 0.5;
    const my = clamp((ay + by) / 2 + hills.range(-1, 1) * len * rough * 0.5, top, bottom);
    fill(ax, ay, mx, my, depth + 1);
    push(mx, my);
    fill(mx, my, bx, by, depth + 1);
  };
  for (let i = 0; i < fixed.length; i++) {
    const a = fixed[i]!;
    push(a.x, a.y);
    const b = fixed[i + 1];
    if (!b) break;
    const onPad = sorted.some((p) => a.x === p.x0 && b.x === p.x1);
    const isLip = sorted.some(
      (p) => (a.x === p.x0 - 0.22 * S && b.x === p.x0) || (a.x === p.x1 && b.x === p.x1 + 0.22 * S),
    );
    if (!onPad && !isLip) fill(a.x, a.y, b.x, b.y, 0);
  }

  // Ground right beside a pad stays below it, so the pad reads as a platform.
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    if (sorted.some((p) => x >= p.x0 && x <= p.x1)) continue;
    for (const p of sorted) {
      const near = (x < p.x0 && p.x0 - x < 0.7 * S) || (x > p.x1 && x - p.x1 < 0.7 * S);
      if (near) ys[i] = Math.max(ys[i]!, Math.min(bottom, p.y + 0.12 * S));
    }
  }

  // Start near a pad, most often the wide one, so a crew that only brakes can still land; the
  // better pads take steering.
  const spawnRng = rng.fork("spawn");
  const weights = pads.map((p) => (p.stars === 1 ? 2 : 1));
  let pick = spawnRng.next() * weights.reduce((a, b) => a + b, 0);
  const near = pads.find((_, i) => (pick -= weights[i]!) <= 0) ?? pads[0];
  const centre = near ? (near.x0 + near.x1) / 2 : (L0 + L1) / 2;
  const sx = clamp(centre + spawnRng.range(-1.1, 1.1) * S, L0 + S, L1 - S);
  const vx = (spawnRng.next() < 0.5 ? -1 : 1) * spawnRng.range(6, 18) * input.q;
  return {
    xs: Float32Array.from(xs),
    ys: Float32Array.from(ys),
    pads,
    spawn: { x: sx, vx },
  };
};

/** Index of the segment containing x (clamped to the ends). */
const segment = (t: Terrain, x: number): number => {
  const xs = t.xs;
  let lo = 0;
  let hi = xs.length - 1;
  if (hi < 1) return 0;
  if (x <= xs[0]!) return 0;
  if (x >= xs[hi]!) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  return lo;
};

/** Terrain surface y at x. */
export const heightAt = (t: Terrain, x: number): number => {
  const n = t.xs.length;
  if (n === 0) return Number.POSITIVE_INFINITY;
  if (n === 1) return t.ys[0]!;
  const i = segment(t, x);
  const x0 = t.xs[i]!;
  const x1 = t.xs[i + 1]!;
  const f = x1 > x0 ? clamp((x - x0) / (x1 - x0), 0, 1) : 0;
  return t.ys[i]! + (t.ys[i + 1]! - t.ys[i]!) * f;
};

/** Highest point (least y) of the surface between two x positions. */
export const peakBetween = (t: Terrain, a: number, b: number): number => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let y = Math.min(heightAt(t, lo), heightAt(t, hi));
  for (let i = 0; i < t.xs.length; i++) {
    const x = t.xs[i]!;
    if (x > lo && x < hi) y = Math.min(y, t.ys[i]!);
  }
  return y;
};

/** Whether a circle touches the surface (or is under it). */
export const circleHits = (t: Terrain, cx: number, cy: number, r: number): boolean => {
  if (cy + r < peakBetween(t, cx - r, cx + r)) return false;
  if (cy >= heightAt(t, cx)) return true;
  const n = t.xs.length;
  const r2 = r * r;
  const first = segment(t, cx - r);
  for (let i = first; i < n - 1; i++) {
    const ax = t.xs[i]!;
    if (ax > cx + r) break;
    const ay = t.ys[i]!;
    const bx = t.xs[i + 1]!;
    const by = t.ys[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const f = len2 > 0 ? clamp(((cx - ax) * dx + (cy - ay) * dy) / len2, 0, 1) : 0;
    const px = ax + dx * f - cx;
    const py = ay + dy * f - cy;
    if (px * px + py * py <= r2) return true;
  }
  return false;
};

/** The landing pad whose flat top holds both x positions, if any. */
export const padUnder = (t: Terrain, a: number, b: number): LandingPad | null => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (const p of t.pads) if (lo >= p.x0 && hi <= p.x1) return p;
  return null;
};
