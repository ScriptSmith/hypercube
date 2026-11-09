/**
 * The snow: a fixed number of flakes, each sinking slowly through the liquid, swaying and
 * tumbling, carried by the flow when the globe is shaken. A flake that lands on the scene rests
 * there (and turns with it); one that reaches the trough round the mound's foot joins the pile
 * against the glass. A shake lifts every flake back into the water. Settling is a state of a
 * flake, never a new flake. Positions are centre-relative design metres (see `mound.ts`).
 */
import type { Rng } from "../../core/types";
import { type Eddies, type FlowState, STIR_LIMIT, velocityAt } from "./flow";
import {
  FOOT_RHO,
  FOOT_Y,
  flankRho,
  GLASS_MARGIN,
  glassRho,
  R,
  RIM_RHO,
  RIM_Y,
  troughVolume,
} from "./mound";
import type { Terrain } from "./terrain";

export const FLOATING = 0;
export const RESTING = 1;
export const PILED = 2;

export interface SnowCounts {
  /** Chips: the snow everyone sees. */
  flakes: number;
  /** Fine bits that sink slowly and keep a little snow drifting between shakes. */
  fines: number;
}
export const DEFAULT_COUNTS: SnowCounts = { flakes: 4200, fines: 1400 };

/** Sinking speeds, m/s, for chips and fines. */
export const FLAKE_SINK: readonly [number, number] = [0.1, 0.22];
export const FINE_SINK: readonly [number, number] = [0.045, 0.07];
/** Pile bins round the globe. */
export const PILE_BINS = 64;
/** Volume one flake adds to the pile, m³: a pile's worth of snow, not a chip's. */
export const PILE_VOLUME = 0.00013;
/** Seconds over which a shake lifts the snow off, top first. */
const LIFT_SPAN = 0.55;
const DRAG = 0.28;
/** Snow lies on anything less steep than this (rise over run); in water it clings well. */
const SLIDE_SLOPE = 1.45;
/** A flake that has slid or bumped about for this many steps lies down where it is. */
const RESTLESS = 90;
/**
 * A flake this close above the pile, or the bottom of the trough when there is no pile yet,
 * has reached it: the glass and the flank stop it sinking any further there.
 */
const PILE_SKIN = 0.05;

/** The inside's orientation: world = m · local, row by row. */
export type Pose = Float64Array;

export interface Snow {
  readonly count: number;
  readonly fines: number;
  readonly state: Uint8Array;
  /** World positions while floating; scene-local while resting. */
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly size: Float32Array;
  /** Each flake's tumble axis while floating, a unit vector. */
  readonly axis: Float32Array;
  /** Its tumble angle while floating. */
  readonly angle: Float32Array;
  /** How it lies while resting: the angle round, and how far askew. */
  readonly lie: Float32Array;
  readonly pile: Float32Array;
  /** The pile's surface height in each bin. */
  readonly level: Float32Array;
  readonly counts: { floating: number; resting: number; piled: number };
  setTerrain(t: Terrain): void;
  step(dt: number, time: number, flow: FlowState, pose: Pose): void;
  /** Lift every resting and piled flake into the water from `time`, for a shake. */
  lift(time: number, strength: number): void;
  /** Let some snow slide off one roof or tree, if any has enough. */
  shed(time: number): number;
  /** Spread the snow as if it had been falling a while, for the start. */
  scatter(pose: Pose): void;
}

/** Pile volume per radian at each of `LEVEL_STEPS` heights from the foot to the rim. */
const LEVEL_STEPS = 96;
const levelTable = (() => {
  const t = new Float32Array(LEVEL_STEPS + 1);
  for (let i = 0; i <= LEVEL_STEPS; i++)
    t[i] = troughVolume(FOOT_Y + ((RIM_Y - FOOT_Y) * i) / LEVEL_STEPS);
  return t;
})();

/** The height a bin's pile reaches with `volume` m³ in it. */
export const levelFor = (volume: number): number => {
  const perRad = volume / ((2 * Math.PI) / PILE_BINS);
  if (perRad <= 0) return FOOT_Y;
  for (let i = 1; i <= LEVEL_STEPS; i++) {
    const v = levelTable[i]!;
    if (v >= perRad) {
      const a = levelTable[i - 1]!;
      const f = (perRad - a) / Math.max(1e-9, v - a);
      return FOOT_Y + ((RIM_Y - FOOT_Y) * (i - 1 + f)) / LEVEL_STEPS;
    }
  }
  return RIM_Y;
};

const binOf = (x: number, z: number): number => {
  const a = Math.atan2(x, z);
  const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * PILE_BINS);
  return b < 0 ? 0 : b >= PILE_BINS ? PILE_BINS - 1 : b;
};

export const createSnow = (rng: Rng, eddies: Eddies, counts: SnowCounts = DEFAULT_COUNTS): Snow => {
  const n = counts.flakes + counts.fines;
  const state = new Uint8Array(n);
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const axis = new Float32Array(n * 3);
  const angle = new Float32Array(n);
  const lie = new Float32Array(n * 2);
  const sink = new Float32Array(n);
  /** Sway: amplitude, rate, phase, direction. */
  const sway = new Float32Array(n * 4);
  const spin = new Float32Array(n);
  /** Which collider a resting flake lies on (0 the ground), or the pile bin of a piled one. */
  const where = new Uint16Array(n);
  /** When a lifted flake leaves its place, or -1. */
  const release = new Float32Array(n).fill(-1);
  /** Steps a floating flake has spent sliding or bumping against something. */
  const contact = new Uint8Array(n);
  /** The lowest a flake can sink in the trough, where the flank meets the glass. */
  const troughFloor = -Math.sqrt((R - GLASS_MARGIN) ** 2 - FOOT_RHO ** 2);
  const pile = new Float32Array(PILE_BINS);
  const level = new Float32Array(PILE_BINS).fill(FOOT_Y);
  const tally = { floating: n, resting: 0, piled: 0 };
  let terrain: Terrain | null = null;

  for (let i = 0; i < n; i++) {
    const fine = i >= counts.flakes;
    const [lo, hi] = fine ? FINE_SINK : FLAKE_SINK;
    // Most chips sink near the middle of the range; a few are slower or quicker.
    const u = (rng.next() + rng.next()) / 2;
    sink[i] = lo + (hi - lo) * u;
    size[i] = fine ? rng.range(0.013, 0.022) : rng.range(0.034, 0.066);
    sway[i * 4] = fine ? rng.range(0.03, 0.07) : rng.range(0.02, 0.06);
    sway[i * 4 + 1] = rng.range(1.1, 2.6);
    sway[i * 4 + 2] = rng.range(0, Math.PI * 2);
    sway[i * 4 + 3] = rng.range(0, Math.PI * 2);
    spin[i] = rng.range(0.6, 2.8) * (rng.next() < 0.5 ? -1 : 1);
    const th = rng.range(0, Math.PI * 2);
    const ct = rng.range(-1, 1);
    const st = Math.sqrt(1 - ct * ct);
    axis.set([st * Math.cos(th), ct, st * Math.sin(th)], i * 3);
    angle[i] = rng.range(0, Math.PI * 2);
  }

  const smoothLevels = () => {
    for (let b = 0; b < PILE_BINS; b++) {
      let v = 0;
      let w = 0;
      for (let k = -3; k <= 3; k++) {
        const wt = 4 - Math.abs(k);
        v += wt * pile[(b + k + PILE_BINS) % PILE_BINS]!;
        w += wt;
      }
      level[b] = levelFor((v / w) * PILE_VOLUME);
    }
  };

  const toLocal = (m: Pose, x: number, y: number, z: number, out: Float32Array) => {
    out[0] = m[0]! * x + m[3]! * y + m[6]! * z;
    out[1] = m[1]! * x + m[4]! * y + m[7]! * z;
    out[2] = m[2]! * x + m[5]! * y + m[8]! * z;
  };
  const toWorld = (m: Pose, x: number, y: number, z: number, out: Float32Array) => {
    out[0] = m[0]! * x + m[1]! * y + m[2]! * z;
    out[1] = m[3]! * x + m[4]! * y + m[5]! * z;
    out[2] = m[6]! * x + m[7]! * y + m[8]! * z;
  };

  const u = new Float32Array(3);
  const l = new Float32Array(3);
  const w = new Float32Array(3);
  const dh = new Float32Array(2);

  const rest = (i: number, lx: number, ly: number, lz: number, on: number) => {
    const o = i * 3;
    state[i] = RESTING;
    tally.floating--;
    tally.resting++;
    pos[o] = lx;
    pos[o + 1] = ly + size[i]! * 0.08;
    pos[o + 2] = lz;
    vel[o] = vel[o + 1] = vel[o + 2] = 0;
    where[i] = on;
    // Lying flat, at any angle round, a little askew.
    lie[i * 2] = rng.range(0, Math.PI * 2);
    lie[i * 2 + 1] = rng.range(-0.35, 0.35);
  };

  const toPile = (i: number, x: number, z: number) => {
    const b = binOf(x, z);
    state[i] = PILED;
    tally.floating--;
    tally.piled++;
    where[i] = b;
    pile[b] = pile[b]! + 1;
  };

  /** Back into the water at world (x, y, z), moving (vx, vy, vz). */
  const float = (
    i: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
  ) => {
    const o = i * 3;
    if (state[i] === RESTING) tally.resting--;
    else if (state[i] === PILED) {
      tally.piled--;
      pile[where[i]!] = Math.max(0, pile[where[i]!]! - 1);
    }
    if (state[i] !== FLOATING) tally.floating++;
    state[i] = FLOATING;
    contact[i] = 0;
    pos[o] = x;
    pos[o + 1] = y;
    pos[o + 2] = z;
    vel[o] = vx;
    vel[o + 1] = vy;
    vel[o + 2] = vz;
  };

  const leave = (i: number, pose: Pose) => {
    const o = i * 3;
    if (state[i] === RESTING) {
      toWorld(pose, pos[o]!, pos[o + 1]! + 0.02, pos[o + 2]!, w);
      const a = rng.range(0, Math.PI * 2);
      const s = rng.range(0.1, 0.45);
      float(i, w[0]!, w[1]!, w[2]!, Math.sin(a) * s, rng.range(0.5, 1.4), Math.cos(a) * s);
      return;
    }
    // Somewhere in its bin's pile, flung up the glass.
    const b = where[i]!;
    const top = level[b]!;
    const y = rng.range(FOOT_Y + 0.03, Math.max(FOOT_Y + 0.04, top));
    const f = flankRho(y);
    const g = glassRho(y) - GLASS_MARGIN;
    const rho = rng.range(Math.min(f + 0.02, g), g);
    const a = -Math.PI + ((b + rng.next()) / PILE_BINS) * 2 * Math.PI;
    const s = rng.range(0.2, 0.6);
    float(
      i,
      rho * Math.sin(a),
      y,
      rho * Math.cos(a),
      Math.sin(a) * s,
      rng.range(0.8, 1.8),
      Math.cos(a) * s,
    );
  };

  let lastLevels = -1;

  return {
    count: n,
    fines: counts.fines,
    state,
    pos,
    vel,
    size,
    axis,
    angle,
    lie,
    pile,
    level,
    counts: tally,
    setTerrain(t) {
      terrain = t;
    },
    step(dt, time, flow, pose) {
      const t = terrain;
      const lively = flow.stir > STIR_LIMIT;
      const keep = 1 - Math.exp(-dt / DRAG);
      const inner = R - GLASS_MARGIN;
      // Lifted flakes leave their places when their moment comes.
      if (tally.floating < n) {
        for (let i = 0; i < n; i++) {
          if (state[i] !== FLOATING && release[i]! >= 0 && time >= release[i]!) {
            release[i] = -1;
            leave(i, pose);
          }
        }
      }
      for (let i = 0; i < n; i++) {
        if (state[i] !== FLOATING) continue;
        const o = i * 3;
        const x0 = pos[o]!;
        const y0 = pos[o + 1]!;
        const z0 = pos[o + 2]!;
        velocityAt(flow, eddies, time, x0, y0, z0, u);
        const so = i * 4;
        const ph = sway[so + 1]! * time + sway[so + 2]!;
        const sw = sway[so]! * Math.sin(ph);
        const dir = sway[so + 3]! + 0.1 * time;
        // A tumbling chip sinks faster edge-on, slower flat: a falling leaf's rhythm.
        const fall = sink[i]! * (1 + 0.3 * Math.cos(2 * ph));
        let vx = vel[o]! + (u[0]! + sw * Math.cos(dir) - vel[o]!) * keep;
        let vy = vel[o + 1]! + (u[1]! - fall - vel[o + 1]!) * keep;
        let vz = vel[o + 2]! + (u[2]! + sw * Math.sin(dir) - vel[o + 2]!) * keep;
        let x = x0 + vx * dt;
        let y = y0 + vy * dt;
        let z = z0 + vz * dt;
        angle[i] = angle[i]! + spin[i]! * (1 + 3 * Math.min(1, flow.stir)) * dt;

        // The glass: slide along it.
        const d = Math.hypot(x, y, z);
        if (d > inner) {
          const k = inner / d;
          x *= k;
          y *= k;
          z *= k;
          const nx = x / inner;
          const ny = y / inner;
          const nz = z / inner;
          const out = vx * nx + vy * ny + vz * nz;
          if (out > 0) {
            vx -= out * nx;
            vy -= out * ny;
            vz -= out * nz;
          }
        }

        toLocal(pose, x, y, z, l);
        const lx = l[0]!;
        const ly = l[1]!;
        const lz = l[2]!;
        const rho = Math.hypot(lx, lz);
        if (ly <= RIM_Y) {
          // Beside the flank, in the trough.
          const f = flankRho(ly);
          if (rho < f) {
            const k = (f + 0.004) / Math.max(1e-6, rho);
            toWorld(pose, lx * k, ly, lz * k, w);
            x = w[0]!;
            y = w[1]!;
            z = w[2]!;
            const nx = lx / Math.max(1e-6, rho);
            const nz = lz / Math.max(1e-6, rho);
            toLocal(pose, vx, vy, vz, l);
            const inward = l[0]! * nx + l[2]! * nz;
            if (inward < 0) {
              toWorld(pose, l[0]! - inward * nx, l[1]!, l[2]! - inward * nz, w);
              vx = w[0]!;
              vy = w[1]!;
              vz = w[2]!;
            }
          }
          const b = binOf(x, z);
          const top = Math.max(level[b]!, troughFloor) + PILE_SKIN;
          if (y < top) {
            if (!lively) {
              toPile(i, x, z);
              continue;
            }
            if (y < top - PILE_SKIN) {
              y = top - PILE_SKIN + 0.01;
              if (vy < 0) vy = -vy * 0.5;
            }
          }
        } else if (t && rho <= RIM_RHO + 0.02) {
          const h = t.top(lx, lz);
          if (ly < h) {
            const deep = h - ly;
            if (deep > Math.max(0.05, Math.abs(vy) * dt * 3)) {
              // Came in through a wall: stay outside it and drop down beside it.
              x = x0;
              z = z0;
              vx *= -0.2;
              vz *= -0.2;
              toLocal(pose, x, y, z, l);
              const h2 = t.top(l[0]!, l[2]!);
              if (l[1]! < h2) {
                toWorld(pose, l[0]!, h2 + 0.005, l[2]!, w);
                x = w[0]!;
                y = w[1]!;
                z = w[2]!;
              }
            } else if (!lively && (t.slope(lx, lz) < SLIDE_SLOPE || contact[i]! >= RESTLESS)) {
              rest(i, lx, h, lz, t.id(lx, lz));
              continue;
            } else {
              if (!lively) contact[i] = contact[i]! + 1;
              // Too steep or too lively: slip downhill, or bounce.
              t.downhill(lx, lz, dh);
              const push = lively ? 0 : 0.25;
              toWorld(pose, lx + dh[0]! * 0.01, h + 0.006, lz + dh[1]! * 0.01, w);
              x = w[0]!;
              y = w[1]!;
              z = w[2]!;
              toWorld(pose, dh[0]! * push, 0, dh[1]! * push, l);
              vx = lively ? vx : l[0]!;
              vz = lively ? vz : l[2]!;
              vy = lively ? Math.abs(vy) * 0.5 : 0;
            }
          }
        }
        // Whatever pushed it last, it stays inside the glass.
        const end = Math.hypot(x, y, z);
        if (end > inner) {
          const k = inner / end;
          x *= k;
          y *= k;
          z *= k;
        }
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        vel[o] = vx;
        vel[o + 1] = vy;
        vel[o + 2] = vz;
      }
      // The pile's surface follows its snow, a few times a second.
      const tick = Math.floor(time * 8);
      if (tick !== lastLevels) {
        lastLevels = tick;
        smoothLevels();
      }
    },
    lift(time, strength) {
      for (let i = 0; i < n; i++) {
        if (state[i] === FLOATING) continue;
        // The top of the pile goes first; a gentle shake leaves some behind on the roofs.
        if (state[i] === RESTING && where[i] !== 0 && strength < 0.85 && rng.next() < 0.3) continue;
        release[i] = time + rng.next() * LIFT_SPAN;
      }
    },
    shed(time) {
      if (!terrain) return 0;
      const on = new Uint16Array(256);
      for (let i = 0; i < n; i++) if (state[i] === RESTING && release[i]! < 0) on[where[i]!]!++;
      const ready: number[] = [];
      for (let k = 1; k < on.length; k++) if (terrain.sheds[k] && on[k]! >= 14) ready.push(k);
      if (ready.length === 0) return 0;
      const k = rng.pick(ready);
      let moved = 0;
      for (let i = 0; i < n; i++) {
        if (state[i] !== RESTING || where[i] !== k || release[i]! >= 0) continue;
        if (rng.next() < 0.6) {
          release[i] = time + rng.next() * 0.4;
          moved++;
        }
      }
      return moved;
    },
    scatter(pose) {
      // Half the chips fallen, the rest in the water with the slower ones higher up.
      for (let i = 0; i < n; i++) {
        const fine = i >= counts.flakes;
        const fallen = fine ? rng.next() < 0.25 : rng.next() < 0.55;
        let x = 0;
        let y = 0;
        let z = 0;
        for (let tries = 0; tries < 20; tries++) {
          x = rng.range(-1, 1) * (R - 0.1);
          z = rng.range(-1, 1) * (R - 0.1);
          y = rng.range(-1.2, 1) * (R - 0.1);
          if (Math.hypot(x, y, z) < R - 0.1) break;
        }
        const o = i * 3;
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        vel[o] = 0;
        vel[o + 1] = -sink[i]!;
        vel[o + 2] = 0;
        if (!fallen || !terrain) continue;
        toLocal(pose, x, y, z, l);
        const rho = Math.hypot(l[0]!, l[2]!);
        if (rho <= RIM_RHO) {
          const h = terrain.top(l[0]!, l[2]!);
          if (h > -Infinity && terrain.slope(l[0]!, l[2]!) < SLIDE_SLOPE) {
            rest(i, l[0]!, h, l[2]!, terrain.id(l[0]!, l[2]!));
          }
        } else {
          toPile(i, x, z);
        }
      }
      smoothLevels();
    },
  };
};
