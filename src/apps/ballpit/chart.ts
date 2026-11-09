/**
 * One question's bar chart made of balls. Each tube's column is a packed part (whole balls on a
 * hex lattice inside the glass, lattice.ts, drawn as a pattern, no physics) under a live part
 * (pile.ts) that new balls fall onto. When a tube's live part passes its budget, its lowest balls
 * fold into the next row of the packed part.
 *
 * Scale: column height follows the count. At scale k a row holds about n0 * 2^(k/2) balls, so
 * each step up roughly halves the height of every column at once (all tubes share the scale).
 * The scale steps up before the tallest column would leave its tube, and the balls shrink
 * smoothly. Past `kMax` the balls stop shrinking and each ball stands for 2, 4, 8... votes.
 *
 * A question change drains every ball out of the bottom, and a start (or attract) pours the
 * question's totals so far in: the packed part rises while the top balls rain in from the mouth.
 */
import { DRAIN_MS, POUR_MS } from "./config";
import { createLattice, type Lattice } from "./lattice";
import { createPile, type Pile } from "./pile";
import { shapeOf, type TubeShape } from "./shape";

export interface TubeGeom {
  answer: number;
  /** Inside of the glass, venue px. `top` is the mouth. */
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface ChartSpec {
  tubes: readonly TubeGeom[];
  /** Balls across a tube at scale 0. */
  n0: number;
  kMax?: number;
  /** Live balls per tube. */
  liveCap: number;
  /** Venue px/s². */
  gravity: number;
}

export interface ChartTube {
  readonly geom: TubeGeom;
  readonly shape: TubeShape;
  readonly pile: Pile;
  /** Balls in the packed part, always whole rows. */
  packed: number;
  /** The packed part's balls as drawn: rises to `packed` during a pour. */
  shown: number;
  flights: number;
  drops: number;
  /** How far the packed part has fallen during a drain, venue px. */
  drainOff: number;
  drainV: number;
}

export type ChartState = "show" | "drain" | "pour";

export interface Chart {
  readonly tubes: readonly ChartTube[];
  readonly state: ChartState;
  readonly k: number;
  /** Votes per ball. */
  readonly m: number;
  /** Balls across an "a" row, and the live balls' radius now (animating after a scale change). */
  readonly n: number;
  readonly r: number;
  /** The packed lattice at the current scale, with x measured from a tube's `x0`. */
  readonly lattice: Lattice;
  /** Target votes per answer. */
  setCounts(votes: readonly number[]): void;
  /** A ball is on its way to `answer`. False when it shouldn't land (draining). */
  flightOut(answer: number): boolean;
  /** A ball reached the outlet above the mouth at (x, y) moving (vx, vy) px/s. */
  land(answer: number, x: number, y: number, vx: number, vy: number): void;
  /** Drain whatever is there, then pour `votes` in. */
  pour(votes: readonly number[]): void;
  step(dt: number): void;
  /** Highest point of a tube's drawn packed balls, venue y. */
  packedTop(i: number): number;
  /** Height a column of `votes` would reach at the current scale, venue px. */
  heightFor(votes: number): number;
  /** Something is moving: balls awake, drains, pours, drops, a scale change. */
  readonly busy: boolean;
  readonly bodies: number;
  /** For tests and admin: the scale grew this many times. */
  readonly grown: number;
  dispose(): void;
}

/** A live pile is looser than the packed lattice by about this much (measured with pile.ts). */
const LOOSE = 1.22;
/** A pour or a new scale aims to fill at most this much of a tube; past FULL the scale steps up. */
const FIT = 0.78;
const FULL = 0.9;
const DROP_MS = 70;
const POUR_DROP_MS = 32;
const SCALE_MS = 900;
const MAX_DROPS = 400;
/**
 * The packed part's top rises at most this many tube heights a second, and this many ball radii
 * a step, so the pile above it is pushed up gently instead of being flung.
 */
const RISE = 0.6;
const RISE_R = 0.3;

export const ballsAcross = (n0: number, k: number): number => Math.round(n0 * 2 ** (k / 2));

export const createChart = (spec: ChartSpec): Chart => {
  const kMax = spec.kMax ?? 8;
  const g0 = spec.tubes[0];
  const width = g0 ? g0.x1 - g0.x0 : 100;
  const height = g0 ? g0.bottom - g0.top : 100;
  const bottom = g0 ? g0.bottom : 100;
  // Every tube in a chart has the same size, so one lattice per scale serves them all.
  const local: TubeShape = shapeOf({ x0: 0, x1: width, bottom });
  const lattices = new Map<number, Lattice>();
  const latticeOf = (nn: number): Lattice => {
    let l = lattices.get(nn);
    if (!l) {
      l = createLattice(local, nn);
      lattices.set(nn, l);
    }
    return l;
  };

  let k = 0;
  let n = ballsAcross(spec.n0, 0);
  let lat = latticeOf(n);
  let r = lat.r;
  let rFrom = r;
  let rTo = r;
  let rT = 1;
  let m = 1;
  let state: ChartState = "show";
  let pourT = 1;
  let drainMs = 0;
  let dropClock = 0;
  let grown = 0;
  let tintSeed = 1;
  let target: number[] = spec.tubes.map(() => 0);
  let pending: number[] | null = null;

  const tubes: ChartTube[] = spec.tubes.map((geom) => {
    const shape = shapeOf(geom);
    return {
      geom,
      shape,
      pile: createPile(Math.max(1, spec.liveCap + 8), r, shape),
      packed: 0,
      shown: 0,
      flights: 0,
      drops: 0,
      drainOff: 0,
      drainV: 0,
    };
  });

  const floorOf = (t: ChartTube) => lat.floor(t.shown);
  /** Balls the packed part may grow by in a step: the floor rises at a bounded speed. */
  const riseOf = (dt: number) => {
    const px = Math.min(RISE * height * dt, RISE_R * lat.r);
    return Math.max(1, Math.round((px / lat.rowH) * n));
  };
  const nextTint = () => {
    tintSeed = (tintSeed * 1103515245 + 12345) & 0x7fffffff;
    return tintSeed % 3;
  };

  /** Column height for `balls` balls on lattice `l`, with a live top. */
  const heightAt = (balls: number, l: Lattice) => {
    const top = Math.min(balls, spec.liveCap);
    return bottom - l.floor(balls - top + top * LOOSE);
  };

  const scaleFor = (kk: number) => {
    const nn = ballsAcross(spec.n0, Math.min(kk, kMax));
    return { l: latticeOf(nn), mm: 2 ** Math.max(0, kk - kMax) };
  };

  /** Smallest scale at which every column of `votes` fits within `fill` of the tube. */
  const fitScale = (votes: readonly number[], fill: number, from = 0) => {
    const most = Math.max(0, ...votes);
    let kk = from;
    for (; kk < kMax + 24; kk++) {
      const { l, mm } = scaleFor(kk);
      if (heightAt(Math.floor(most / mm), l) <= fill * height) break;
    }
    return kk;
  };

  const represented = (t: ChartTube) => t.packed + t.pile.n + t.drops + t.flights;

  /** No ball near the mouth, so a new one won't land on top of the last. */
  const mouthClear = (t: ChartTube) => {
    const p = t.pile;
    const limit = t.geom.top + 2.4 * p.r;
    for (let i = 0; i < p.n; i++) if (p.y[i]! < limit) return false;
    return true;
  };

  const setScale = (kk: number, animate: boolean) => {
    const s = scaleFor(kk);
    const mChanged = s.mm !== m;
    k = kk;
    lat = s.l;
    n = lat.n;
    m = s.mm;
    rFrom = r;
    rTo = lat.r;
    rT = animate ? 0 : 1;
    if (!animate) r = rTo;
    for (const t of tubes) {
      // Keep whole rows of the new lattice packed; the rest falls in from the top.
      const keep = lat.whole(t.packed);
      t.drops = Math.min(MAX_DROPS, t.drops + (t.packed - keep));
      t.packed = keep;
      t.shown = Math.min(t.shown, keep);
      t.pile.wake();
    }
    return mChanged;
  };

  /** Grow the scale while the tallest column is near the top of its tube. */
  const checkScale = () => {
    if (state === "drain") return;
    let most = 0;
    for (const t of tubes) most = Math.max(most, represented(t));
    if (heightAt(most, lat) <= FULL * height) return;
    const votes = tubes.map((t, i) => Math.max(target[i]! * m, represented(t) * m));
    const kk = Math.max(k + 1, fitScale(votes, FIT, k + 1));
    grown++;
    if (setScale(kk, true)) chart.pour(target.map((b) => b * m));
  };

  const startPour = (votes: readonly number[]) => {
    setScale(fitScale(votes, FIT), false);
    target = votes.map((v) => Math.floor(Math.max(0, v) / m));
    state = "pour";
    pourT = 0;
    for (const [i, t] of tubes.entries()) {
      const b = target[i] ?? 0;
      t.pile.clear();
      t.pile.open = false;
      t.pile.r = r;
      t.drainOff = 0;
      t.drainV = 0;
      t.flights = 0;
      const rain = Math.min(b, Math.max(3 * n, 12), spec.liveCap);
      t.packed = lat.whole(b - rain);
      t.drops = Math.min(MAX_DROPS, b - t.packed);
      t.shown = 0;
    }
  };

  const chart: Chart = {
    tubes,
    get state() {
      return state;
    },
    get k() {
      return k;
    },
    get m() {
      return m;
    },
    get n() {
      return n;
    },
    get r() {
      return r;
    },
    get lattice() {
      return lat;
    },
    get grown() {
      return grown;
    },
    setCounts(votes) {
      const want = tubes.map((_, i) => Math.floor(Math.max(0, votes[i] ?? 0) / m));
      if (state === "drain") {
        pending = votes.slice();
        target = want;
        return;
      }
      target = want;
      for (const [i, t] of tubes.entries()) {
        if (t.packed + t.pile.n + t.drops > want[i]!) {
          chart.pour(votes);
          return;
        }
      }
      for (const [i, t] of tubes.entries()) {
        const deficit = want[i]! - represented(t);
        if (deficit <= 0) continue;
        // A big jump (catching up with the room) goes straight into the packed rows.
        const spare = deficit - Math.max(n, 6);
        const rows = spare > 0 ? lat.whole(t.packed + spare) - t.packed : 0;
        t.packed += rows;
        t.drops = Math.min(MAX_DROPS, t.drops + deficit - rows);
        if (rows > 0) t.pile.wake();
      }
      checkScale();
    },
    flightOut(answer) {
      const t = tubes[answer];
      if (!t || state === "drain") return false;
      t.flights++;
      return true;
    },
    land(answer, x, y, vx, vy) {
      const t = tubes[answer];
      if (!t) return;
      t.flights = Math.max(0, t.flights - 1);
      if (state === "drain") return;
      if (t.packed + t.pile.n + t.drops >= (target[answer] ?? 0)) return;
      const g = t.geom;
      // A little sideways nudge, so balls landing in the same spot roll off each other.
      const nudge = ((nextTint() - 1) * 0.35 + (tintSeed % 13) / 13 - 0.5) * r;
      const cx = Math.min(g.x1 - r, Math.max(g.x0 + r, x + nudge));
      const ok =
        mouthClear(t) &&
        t.pile.add(cx, Math.min(y, g.top + r), vx * 0.3, Math.max(0, vy), nextTint());
      if (!ok) t.drops = Math.min(MAX_DROPS, t.drops + 1);
    },
    pour(votes) {
      const empty = tubes.every((t) => t.packed + t.pile.n === 0);
      if (empty || state === "drain") {
        if (state === "drain") pending = votes.slice();
        else startPour(votes);
        return;
      }
      pending = votes.slice();
      state = "drain";
      drainMs = 0;
      for (const t of tubes) {
        t.pile.open = true;
        t.pile.exitY = t.geom.bottom + 2 * r;
        t.pile.wake();
        t.drops = 0;
        t.drainOff = 0;
        t.drainV = 0;
      }
    },
    step(dt) {
      if (rT < 1) {
        rT = Math.min(1, rT + (dt * 1000) / SCALE_MS);
        const e = rT * rT * (3 - 2 * rT);
        r = rFrom + (rTo - rFrom) * e;
      }
      const g = spec.gravity;
      if (state === "drain") {
        drainMs += dt * 1000;
        // A ball caught on something never holds up the next question for long.
        let empty = true;
        for (const t of tubes) {
          t.drainV += g * dt;
          t.drainOff += t.drainV * dt;
          t.pile.r = r;
          t.pile.step(dt, g);
          if (t.pile.n > 0 || t.drainOff < bottom - lat.top(t.shown) + 2 * r) empty = false;
        }
        if (empty || drainMs > DRAIN_MS * 2) {
          state = "show";
          for (const t of tubes) {
            t.packed = 0;
            t.shown = 0;
            t.pile.clear();
            t.pile.open = false;
          }
          const next = pending ?? target.map((b) => b * m);
          pending = null;
          startPour(next);
        }
        return;
      }
      if (state === "pour") {
        pourT = Math.min(1, pourT + (dt * 1000) / POUR_MS);
        const e = 1 - (1 - pourT) ** 3;
        for (const t of tubes) t.shown = Math.round(t.packed * e);
        if (pourT >= 1) state = "show";
      } else {
        const rise = riseOf(dt);
        for (const t of tubes)
          t.shown = t.shown < t.packed ? Math.min(t.packed, t.shown + rise) : t.packed;
      }
      dropClock += dt * 1000;
      const every = state === "pour" ? POUR_DROP_MS : DROP_MS;
      const spawn = dropClock >= every;
      if (spawn) dropClock = 0;
      for (const t of tubes) {
        const p = t.pile;
        p.r = r;
        p.floor = floorOf(t);
        // A long queue (a rush of votes) goes straight into whole packed rows.
        if (t.drops > 3 * n) {
          const rows = lat.whole(t.packed + t.drops - 2 * n) - t.packed;
          if (rows > 0) {
            t.drops -= rows;
            t.packed += rows;
            p.wake();
          }
        }
        if (spawn && t.drops > 0 && p.n < p.cap && mouthClear(t)) {
          const gm = t.geom;
          const span = Math.max(0, gm.x1 - gm.x0 - 2 * r);
          const x = gm.x0 + r + ((tintSeed % 97) / 97) * span;
          if (p.add(x, gm.top + r, 0, 600, nextTint())) t.drops--;
        }
        p.step(dt, g);
        const next = lat.cap(lat.rowOf(t.packed).j);
        if (p.n > spec.liveCap && p.n - next >= Math.min(spec.liveCap / 2, spec.liveCap - next)) {
          t.packed += p.foldLowest(next);
        }
      }
      checkScale();
    },
    packedTop(i) {
      const t = tubes[i];
      return t ? lat.top(t.shown) : bottom;
    },
    heightFor(votes) {
      return heightAt(Math.floor(Math.max(0, votes) / m), lat);
    },
    get busy() {
      if (state !== "show" || rT < 1) return true;
      return tubes.some((t) => t.drops > 0 || t.flights > 0 || t.pile.awake > 0);
    },
    get bodies() {
      let b = 0;
      for (const t of tubes) b += t.pile.n;
      return b;
    },
    dispose() {
      for (const t of tubes) t.pile.clear();
      lattices.clear();
    },
  };
  return chart;
};
