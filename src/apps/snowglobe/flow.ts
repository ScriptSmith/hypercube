/**
 * How the liquid moves: nearly still between shakes, and after a jolt a slosh, a swirl round the
 * globe, a roll that rises up the glass and sinks through the middle, and eddies, all dying away
 * over a few seconds. Velocities are in design metres a second (see `mound.ts`).
 */
import { R } from "./mound";
import type { Rng } from "../../core/types";

/** A shake as the liquid feels it. */
export interface Stir {
  at: number;
  strength: number;
  dir: number;
  spin: 1 | -1;
}

/** The liquid's state at one moment, summed over recent shakes. */
export interface FlowState {
  /** Swirl round the vertical axis, radians a second. */
  swirl: number;
  /** The roll's speed at the middle, m/s. */
  roll: number;
  /** Eddies' speed, m/s. */
  eddies: number;
  /** Slosh, m/s across. */
  sloshX: number;
  sloshZ: number;
  /** How thick the snow is in the water, 0 to 1. */
  murk: number;
  /** How far the inside is tipped by the jolt, radians, about a horizontal axis. */
  tilt: number;
  tiltAxisX: number;
  tiltAxisZ: number;
  /** About how fast the liquid moves anywhere, m/s; snow settles only below `STIR_LIMIT`. */
  stir: number;
}

/** Above this the liquid is too lively for snow to settle. */
export const STIR_LIMIT = 0.2;
/** Eddies that never quite stop, so falling snow drifts a little. */
const CALM_EDDIES = 0.012;
const JOLT_HZ = 1.3;
const JOLT_DECAY = 0.7;
const TILT = (2.2 * Math.PI) / 180;
const SLOSH = 1.1;
const SWIRL = 0.95;
const SWIRL_DECAY = 6;
const ROLL = 0.9;
const ROLL_DECAY = 3.2;
const EDDIES = 0.5;
const EDDY_DECAY = 3.5;
/** The murk rises over a third of a second, holds past the swap moment, then clears. */
const MURK_RISE = 0.35;
const MURK_HOLD = 1.8;
const MURK_CLEAR = 3.5;
/** Shakes older than this no longer move anything. */
export const STIR_SPAN = 45;

const rise = (tau: number, k: number) => 1 - Math.exp(-tau / k);

export const murkOf = (tau: number, strength: number): number => {
  if (tau < 0) return 0;
  const m =
    rise(tau, MURK_RISE) * (tau < MURK_HOLD ? 1 : Math.exp(-(tau - MURK_HOLD) / MURK_CLEAR));
  return Math.min(1, m * strength);
};

export const flowAt = (stirs: readonly Stir[], t: number, out: FlowState): FlowState => {
  out.swirl = 0;
  out.roll = 0;
  out.eddies = CALM_EDDIES;
  out.sloshX = 0;
  out.sloshZ = 0;
  out.murk = 0;
  out.tilt = 0;
  out.tiltAxisX = 1;
  out.tiltAxisZ = 0;
  for (const s of stirs) {
    const tau = t - s.at;
    if (tau < 0 || tau > STIR_SPAN) continue;
    const k = s.strength;
    const jolt = tau < 4 ? Math.exp(-tau / JOLT_DECAY) : 0;
    const w = 2 * Math.PI * JOLT_HZ;
    const dx = Math.sin(s.dir);
    const dz = Math.cos(s.dir);
    const slosh = -SLOSH * k * Math.cos(w * tau) * jolt;
    out.sloshX += slosh * dx;
    out.sloshZ += slosh * dz;
    // The inside tips towards the jolt and back: about the horizontal axis across it.
    const tilt = TILT * k * Math.sin(w * tau) * jolt;
    if (Math.abs(tilt) > Math.abs(out.tilt)) {
      out.tilt = tilt;
      out.tiltAxisX = dz;
      out.tiltAxisZ = -dx;
    }
    out.swirl += s.spin * SWIRL * k * rise(tau, 0.5) * Math.exp(-tau / SWIRL_DECAY);
    out.roll += ROLL * k * rise(tau, 0.4) * Math.exp(-tau / ROLL_DECAY);
    out.eddies += EDDIES * k * Math.exp(-tau / EDDY_DECAY);
    out.murk = Math.max(out.murk, murkOf(tau, k));
  }
  out.stir =
    Math.abs(out.swirl) * R * 0.8 +
    out.roll +
    out.eddies -
    CALM_EDDIES +
    Math.hypot(out.sloshX, out.sloshZ);
  return out;
};

export const emptyFlow = (): FlowState => ({
  swirl: 0,
  roll: 0,
  eddies: CALM_EDDIES,
  sloshX: 0,
  sloshZ: 0,
  murk: 0,
  tilt: 0,
  tiltAxisX: 1,
  tiltAxisZ: 0,
  stir: 0,
});

/** Eddies: the curl of a few slow waves, so they neither gather nor spread the snow. */
export interface Eddies {
  /** Per wave: k (3), its curl direction k × a (3), drift rate, phase. */
  readonly waves: Float32Array;
  readonly count: number;
}

const EDDY_WAVES = 6;

export const createEddies = (rng: Rng): Eddies => {
  const waves = new Float32Array(EDDY_WAVES * 8);
  for (let i = 0; i < EDDY_WAVES; i++) {
    // A wavelength of two to four metres: eddies the size of the globe's insides.
    const len = rng.range(1.6, 3.2);
    const th = rng.range(0, Math.PI * 2);
    const ph = Math.acos(rng.range(-1, 1));
    const kx = len * Math.sin(ph) * Math.cos(th);
    const ky = len * Math.cos(ph);
    const kz = len * Math.sin(ph) * Math.sin(th);
    // Any amplitude across k; the velocity is along k × a, normalised.
    const ax = rng.range(-1, 1);
    const ay = rng.range(-1, 1);
    const az = rng.range(-1, 1);
    let cx = ky * az - kz * ay;
    let cy = kz * ax - kx * az;
    let cz = kx * ay - ky * ax;
    const n = Math.hypot(cx, cy, cz) || 1;
    cx /= n;
    cy /= n;
    cz /= n;
    waves.set([kx, ky, kz, cx, cy, cz, rng.range(0.15, 0.45), rng.range(0, Math.PI * 2)], i * 8);
  }
  return { waves, count: EDDY_WAVES };
};

/**
 * The liquid's velocity at (x, y, z), centre-relative design metres, written to `out`. Each
 * wave's amplitude is scaled so the eddies' typical speed is `f.eddies`.
 */
export const velocityAt = (
  f: FlowState,
  e: Eddies,
  t: number,
  x: number,
  y: number,
  z: number,
  out: Float32Array,
): void => {
  let ux = f.sloshX + f.swirl * z;
  let uy = 0;
  let uz = f.sloshZ - f.swirl * x;
  if (f.roll > 1e-4) {
    // A spherical vortex turned over: rising by the glass, sinking through the middle, with
    // no flow through the glass.
    const qx = x / R;
    const qy = y / R;
    const qz = z / R;
    const r = f.roll;
    ux -= r * qx * qy;
    uz -= r * qz * qy;
    uy -= r * (1 - 2 * (qx * qx + qz * qz) - qy * qy);
  }
  const amp = f.eddies * 0.6;
  const w = e.waves;
  // Between shakes the eddies are slower than a flake's own sway; leave them out.
  const count = amp < 0.01 ? 0 : e.count;
  for (let i = 0; i < count; i++) {
    const o = i * 8;
    const c = Math.cos(w[o]! * x + w[o + 1]! * y + w[o + 2]! * z + w[o + 6]! * t + w[o + 7]!);
    ux += amp * w[o + 3]! * c;
    uy += amp * w[o + 4]! * c;
    uz += amp * w[o + 5]! * c;
  }
  out[0] = ux;
  out[1] = uy;
  out[2] = uz;
};
