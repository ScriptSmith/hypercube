/**
 * The live balls of one tube: a small position-based solver of our own. Balls fall under gravity
 * (Verlet), and contacts, walls and the floor are resolved by moving overlapping balls apart a few
 * times a step. Balls only meet balls in their own tube, and every ball in a tube has the same
 * radius, so the pair search is a sweep along y. A ball that has barely moved for a while sleeps:
 * it stops integrating and acts as a fixed obstacle until a fast ball hits it. Sleeping is what
 * lets a deep pile stand still.
 *
 * Coordinates are venue px with y down. Balls are held by the tube's outline (shape.ts): its walls
 * and rounded bottom. `floor` is the surface they rest on above the packed part of the column,
 * which may be inside the rounded bottom; with `open` set the bottom and floor are gone and balls
 * leave past `exitY`.
 */
import type { TubeShape } from "./shape";

export interface Pile {
  readonly n: number;
  readonly cap: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly tint: Uint8Array;
  readonly asleep: Uint8Array;
  r: number;
  readonly shape: TubeShape;
  floor: number;
  open: boolean;
  exitY: number;
  /** Add a ball with a velocity in px/s. False when full. */
  add(x: number, y: number, vx: number, vy: number, tint: number): boolean;
  step(dt: number, g: number): void;
  /** Remove up to `k` of the lowest balls; returns how many went. */
  foldLowest(k: number): number;
  /** Remove every ball. */
  clear(): void;
  wake(): void;
  /** Balls still moving. */
  readonly awake: number;
  /** Lowest y any ball's top reaches (the column's top), or `floor` when empty. */
  top(): number;
}

const ITER = 8;
/** Share of a contact's correction the lower ball takes. */
const LOW_SHARE = 0.3;
/** Velocity kept each step in free flight, and when touching something. */
const AIR = 0.995;
const CONTACT = 0.86;
/** A ball moving less than this fraction of r per step is still; this many still steps and it sleeps. */
const STILL = 0.03;
const SLEEP_STEPS = 15;
/** A ball moving faster than this fraction of r per step wakes a sleeper it hits. */
const WAKE = 0.18;
const MAX_SUBSTEPS = 4;
/** Fastest a ball moves in one substep, as a fraction of r, so corrections can't fling it. */
const MAX_STEP = 1.2;

const clampAbs = (v: number, m: number) => (v > m ? m : v < -m ? -m : v);

export const createPile = (
  cap: number,
  r: number,
  shape: TubeShape,
  floor = shape.bottom,
): Pile => {
  const x = new Float64Array(cap);
  const y = new Float64Array(cap);
  const px = new Float64Array(cap);
  const py = new Float64Array(cap);
  const tint = new Uint8Array(cap);
  const asleep = new Uint8Array(cap);
  const still = new Uint16Array(cap);
  const touch = new Uint8Array(cap);
  const order = new Int32Array(cap);
  let n = 0;
  let lastFloor = floor;

  const move = (i: number, dx: number, dy: number) => {
    x[i]! += dx;
    y[i]! += dy;
  };

  const wakeBall = (i: number) => {
    if (!asleep[i]) return;
    asleep[i] = 0;
    still[i] = 0;
    px[i] = x[i]!;
    py[i] = y[i]!;
  };

  const removeAt = (i: number) => {
    const last = n - 1;
    if (i !== last) {
      x[i] = x[last]!;
      y[i] = y[last]!;
      px[i] = px[last]!;
      py[i] = py[last]!;
      tint[i] = tint[last]!;
      asleep[i] = asleep[last]!;
      still[i] = still[last]!;
    }
    n = last;
  };

  const sortByY = () => {
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = 1; i < n; i++) {
      const v = order[i]!;
      const vy = y[v]!;
      let j = i - 1;
      while (j >= 0 && y[order[j]!]! > vy) {
        order[j + 1] = order[j]!;
        j--;
      }
      order[j + 1] = v;
    }
  };

  /** Moves every awake ball back inside the walls, the rounded bottom and the floor. */
  const contain = (pile: Pile) => {
    const r = pile.r;
    const s = pile.shape;
    const left = s.x0 + r;
    const right = Math.max(left, s.x1 - r);
    const cl = s.x0 + s.rad;
    const cr = s.x1 - s.rad;
    const cy = s.bottom - s.rad;
    const lim = Math.max(0, s.rad - r);
    const lowest = s.bottom - r;
    const floorY = pile.floor - r;
    for (let i = 0; i < n; i++) {
      if (asleep[i]) continue;
      let bx = x[i]!;
      let by = y[i]!;
      let hit = false;
      if (bx < left) {
        bx = left;
        hit = true;
      } else if (bx > right) {
        bx = right;
        hit = true;
      }
      if (!pile.open) {
        if (by > cy) {
          const ax = bx < cl ? cl : bx > cr ? cr : bx;
          if (ax !== bx) {
            const dx = bx - ax;
            const dy = by - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 > lim * lim) {
              const k = lim / Math.sqrt(d2);
              bx = ax + dx * k;
              by = cy + dy * k;
              hit = true;
            }
          } else if (by > lowest) {
            by = lowest;
            hit = true;
          }
        }
        if (by > floorY) {
          by = floorY;
          hit = true;
        }
      }
      if (hit) {
        x[i] = bx;
        y[i] = by;
        touch[i] = 1;
      }
    }
  };

  /**
   * Contacts are resolved from the bottom of the pile up, and the lower ball of a pair moves less
   * than the upper one (not at all in the last pass), so a stack stiffens in a few passes instead
   * of sagging under its own weight. The outline has the last word, so no ball ends a step
   * outside the glass.
   */
  const solve = (pile: Pile) => {
    const r = pile.r;
    const d2min = 4 * r * r;
    const wakeStep = WAKE * r;
    for (let it = 0; it < ITER; it++) {
      const low = it === ITER - 1 ? 0 : LOW_SHARE;
      contain(pile);
      for (let a = n - 1; a > 0; a--) {
        const i = order[a]!;
        for (let b = a - 1; b >= 0; b--) {
          const j = order[b]!;
          const dy = y[i]! - y[j]!;
          if (dy >= 2 * r) break;
          if (asleep[i] && asleep[j]) continue;
          const dx = x[j]! - x[i]!;
          const d2 = dx * dx + dy * dy;
          if (d2 >= d2min) continue;
          let d = Math.sqrt(d2);
          let nx: number;
          let ny: number;
          if (d < 1e-6) {
            // Exactly on top of each other: part them sideways, alternating by index.
            nx = (i + j) % 2 ? 1 : -1;
            ny = 0;
            d = 0;
          } else {
            nx = dx / d;
            ny = -dy / d;
          }
          // (nx, ny) points from the lower ball i to the upper ball j.
          const over = 2 * r - d;
          touch[i] = 1;
          touch[j] = 1;
          let share = low;
          if (asleep[i]) {
            const sp = Math.abs(x[j]! - px[j]!) + Math.abs(y[j]! - py[j]!);
            if (sp > wakeStep) wakeBall(i);
            else share = 0;
          } else if (asleep[j]) {
            const sp = Math.abs(x[i]! - px[i]!) + Math.abs(y[i]! - py[i]!);
            if (sp > wakeStep) wakeBall(j);
            else share = 1;
          }
          move(i, -nx * over * share, -ny * over * share);
          move(j, nx * over * (1 - share), ny * over * (1 - share));
        }
      }
    }
    contain(pile);
  };

  const pile: Pile = {
    get n() {
      return n;
    },
    cap,
    x,
    y,
    tint,
    asleep,
    r,
    shape,
    floor,
    open: false,
    exitY: shape.bottom,
    add(bx, by, vx, vy, t) {
      if (n >= cap || !Number.isFinite(bx) || !Number.isFinite(by)) return false;
      x[n] = bx;
      y[n] = by;
      // The first step's velocity, from px/s at 60 Hz.
      px[n] = bx - vx / 60;
      py[n] = by - vy / 60;
      tint[n] = t;
      asleep[n] = 0;
      still[n] = 0;
      n++;
      return true;
    },
    step(dt, g) {
      // Sleepers ignore the floor, so a rising floor wakes the pile to carry it up.
      if (pile.floor < lastFloor - 1e-6) pile.wake();
      lastFloor = pile.floor;
      if (n === 0) return;
      let fastest = 0;
      for (let i = 0; i < n; i++) {
        if (asleep[i]) continue;
        const v = Math.abs(x[i]! - px[i]!) + Math.abs(y[i]! - py[i]!) + g * dt * dt;
        if (v > fastest) fastest = v;
      }
      if (fastest === 0) return;
      const subs = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(fastest / (0.8 * pile.r))));
      const h = dt / subs;
      const scale = 1 / subs;
      for (let sub = 0; sub < subs; sub++) {
        for (let i = 0; i < n; i++) {
          if (asleep[i]) continue;
          // The stored step is one full dt; substeps walk it in parts.
          const cap = MAX_STEP * pile.r;
          const vx = clampAbs((x[i]! - px[i]!) * (sub === 0 ? scale : 1) * AIR, cap);
          const vy = clampAbs((y[i]! - py[i]!) * (sub === 0 ? scale : 1) * AIR, cap);
          px[i] = x[i]!;
          py[i] = y[i]!;
          x[i]! += vx;
          y[i]! += vy + g * h * h;
          touch[i] = 0;
        }
        sortByY();
        solve(pile);
        for (let i = 0; i < n; i++) {
          if (asleep[i] || !touch[i]) continue;
          px[i] = x[i]! - (x[i]! - px[i]!) * CONTACT;
          py[i] = y[i]! - (y[i]! - py[i]!) * CONTACT;
        }
      }
      // Back to one full dt of velocity for the next step.
      const still2 = (STILL * pile.r) ** 2;
      for (let i = n - 1; i >= 0; i--) {
        if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!)) {
          removeAt(i);
          continue;
        }
        if (pile.open && y[i]! - pile.r > pile.exitY) {
          removeAt(i);
          continue;
        }
        if (asleep[i]) continue;
        if (subs > 1) {
          px[i] = x[i]! - (x[i]! - px[i]!) * subs;
          py[i] = y[i]! - (y[i]! - py[i]!) * subs;
        }
        const vx = x[i]! - px[i]!;
        const vy = y[i]! - py[i]!;
        if (vx * vx + vy * vy < still2 && touch[i]) {
          if (++still[i]! >= SLEEP_STEPS) {
            asleep[i] = 1;
            px[i] = x[i]!;
            py[i] = y[i]!;
          }
        } else still[i] = 0;
      }
    },
    foldLowest(k) {
      let removed = 0;
      while (removed < k && n > 0) {
        let low = 0;
        for (let i = 1; i < n; i++) if (y[i]! > y[low]!) low = i;
        removeAt(low);
        removed++;
      }
      if (removed > 0) pile.wake();
      return removed;
    },
    clear() {
      n = 0;
    },
    wake() {
      for (let i = 0; i < n; i++) wakeBall(i);
    },
    get awake() {
      let a = 0;
      for (let i = 0; i < n; i++) if (!asleep[i]) a++;
      return a;
    },
    top() {
      let t = pile.floor;
      for (let i = 0; i < n; i++) t = Math.min(t, y[i]! - pile.r);
      return t;
    },
  };
  return pile;
};
