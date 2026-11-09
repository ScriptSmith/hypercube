/**
 * Chapter 5's state: the machine's dials, and what the detector sees at a setting. Pure.
 */
import { TUBE_IDS, TUBES, type TubeId } from "../../config";
import { CRYSTALS, type CrystalId } from "../../crystals";
import {
  DIAL_RANGE,
  apply,
  detectorFor,
  detectorHit,
  FLAT,
  type DetectorKind,
  type LatticePoint,
  latticePoints,
  leavesSurface,
  type MachineState,
  mul,
  orientFor,
  PRESETS,
  SHELL,
  sphereGap,
  stageMatrix,
} from "../../machine";

/** The sample on chapter 5's stage: aluminium, its (1 1 1) layers flat. */
export const SAMPLE: CrystalId = "aluminium";

/**
 * The curved strip's preset, turned on to 17°, so a short turn of the wheel brings the first
 * flash ((1 1 1) at 22.5° under cobalt) rather than 15° of turning from the preset's 7.5°.
 */
export const START: MachineState = { ...PRESETS.strip.state, omega: 17 };

/** Integer state for the screen: tenths of a degree and of a mm, λ in ten-thousandths of an Å. */
export const STATE_RANGES = [
  [DIAL_RANGE.omega[0] * 10, DIAL_RANGE.omega[1] * 10],
  [DIAL_RANGE.chi[0] * 10, DIAL_RANGE.chi[1] * 10],
  [DIAL_RANGE.phi[0] * 10, DIAL_RANGE.phi[1] * 10],
  [DIAL_RANGE.armTwoTheta[0] * 10, DIAL_RANGE.armTwoTheta[1] * 10],
  [DIAL_RANGE.distance[0] * 10, DIAL_RANGE.distance[1] * 10],
  [0, 1],
  [5000, 20000],
] as const;

const clampTo = (v: number, r: readonly [number, number]) =>
  Math.max(r[0], Math.min(r[1], Math.round(v)));

export const encode = (s: MachineState): number[] => [
  clampTo(s.omega * 10, STATE_RANGES[0]),
  clampTo(s.chi * 10, STATE_RANGES[1]),
  clampTo(s.phi * 10, STATE_RANGES[2]),
  clampTo(s.armTwoTheta * 10, STATE_RANGES[3]),
  clampTo(s.distance * 10, STATE_RANGES[4]),
  s.detector === "plate" ? 1 : 0,
  clampTo(s.lambda * 10000, STATE_RANGES[6]),
];

export const decode = (v: readonly number[]): MachineState => ({
  omega: (v[0] ?? 75) / 10,
  chi: (v[1] ?? 0) / 10,
  phi: (v[2] ?? 0) / 10,
  armTwoTheta: (v[3] ?? 700) / 10,
  distance: (v[4] ?? 2800) / 10,
  detector: v[5] === 1 ? "plate" : "strip",
  lambda: (v[6] ?? 17890) / 10000,
});

/** A preset's setting: each detector kind loads its own preset's numbers. */
export const presetFor = (kind: DetectorKind): MachineState => ({ ...PRESETS[kind].state });

/** The tube whose Kα1 line is λ, or null for any other wavelength. */
export const tubeOf = (lambda: number): TubeId | null =>
  TUBE_IDS.find((t) => Math.abs(TUBES[t].lambda - lambda) < 1e-4) ?? null;

/**
 * The tube whose metal gives λ: its Kα1 line, or near it, as copper's two Kα lines averaged,
 * 1.5419 Å (Hölzer et al. 1997). Null for no tube's.
 */
export const tubeNear = (lambda: number): TubeId | null =>
  TUBE_IDS.find((t) => Math.abs(TUBES[t].lambda - lambda) < 0.01) ?? null;

const pointsCache = new Map<string, LatticePoint[]>();
const pointsFor = (lambda: number): LatticePoint[] => {
  const maxS = Math.min(2.2, 2 / lambda);
  const key = maxS.toFixed(2);
  let p = pointsCache.get(key);
  if (!p) {
    if (pointsCache.size > 8) pointsCache.clear();
    p = latticePoints(CRYSTALS[SAMPLE], maxS, 600);
    pointsCache.set(key, p);
  }
  return p;
};

/** A flash at a setting: where it lands on the detector (if it does), its 2θ, how bright. */
export interface Lit {
  hit: { fu: number; fv: number } | null;
  twoTheta: number;
  /** In-plane angle of the scattered ray, degrees: where a side view draws it. */
  psi: number;
  strength: number;
}

/**
 * Points on the sphere now. `near` widens the shell so points about to flash show dimly (a still
 * picture of a turning machine), strength falling off with distance.
 */
export const litAt = (s: MachineState, near = 1): Lit[] => {
  const c = CRYSTALS[SAMPLE];
  const det = detectorFor(s.detector, s.distance);
  const orient = orientFor(c, FLAT[SAMPLE]);
  const R = mul(stageMatrix({ omega: s.omega, chi: s.chi, phi: s.phi }), orient);
  const k0 = 1 / s.lambda;
  const shell = SHELL * k0 * near;
  const out: Lit[] = [];
  for (const p of pointsFor(s.lambda)) {
    const g = apply(R, p.g);
    const gap = Math.abs(sphereGap(g, s.lambda));
    if (gap > shell) continue;
    const sOut: [number, number, number] = [g[0] + k0, g[1], g[2]];
    // A ray heading down into the crystal is absorbed, so it is never drawn.
    if (!leavesSurface(s, sOut)) continue;
    const len = Math.hypot(sOut[0], sOut[1], sOut[2]) || 1;
    const hit = detectorHit(det, s.armTwoTheta, sOut);
    out.push({
      hit: hit ? { fu: hit.fu, fv: hit.fv } : null,
      twoTheta: (Math.acos(Math.max(-1, Math.min(1, sOut[0] / len))) * 180) / Math.PI,
      psi: (Math.atan2(sOut[1], sOut[0]) * 180) / Math.PI,
      strength: 1 - gap / shell,
    });
  }
  return out;
};

/** Spots on the detector now: points on the sphere that land on it. */
export const spotsAt = (s: MachineState): { fu: number; fv: number; strength: number }[] =>
  litAt(s)
    .filter((f) => f.hit)
    .map((f) => ({ fu: f.hit!.fu, fv: f.hit!.fv, strength: f.strength }));
