/**
 * Chapter 2's physics: two equal waves, the second pushed along by φ, add to a wave of height
 * 2A|cos(φ/2)|, which is 2A|cos(πΔ/λ)| for a push of Δ = φλ/2π; a detector sees the brightness,
 * which goes as the height squared. Two sources a distance apart draw fringes: at each point the
 * waves arrive having travelled r₁ and r₂, so the brightness there is cos²(π(r₂ − r₁)/λ + φ/2).
 * Pure.
 */

const DEG = Math.PI / 180;

/** Height of the sum of two waves of height 1 with the second pushed by φ (degrees). */
export const sumHeight = (phiDeg: number): number => 2 * Math.abs(Math.cos((phiDeg * DEG) / 2));

/** Brightness of the sum, as a share of the brightest (both in step). */
export const brightness = (phiDeg: number): number => Math.cos((phiDeg * DEG) / 2) ** 2;

/** The push φ as a share of one wavelength, 0 to 1. */
export const pushInWaves = (phiDeg: number): number => (((phiDeg % 360) + 360) % 360) / 360;

/** How far φ is from `target` round the circle, degrees, 0 to 180. */
export const apart = (phiDeg: number, target: number): number => {
  const d = (((phiDeg - target) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};

/** Within this many degrees, the waves count as in step or as half a wave apart. */
export const NEAR = 12;
/** Let go within this many degrees of in step or half a wave apart and the dial settles there. */
export const DETENT = 16;

export type Extreme = "add" | "cancel";
export const extremeAt = (phiDeg: number, near = NEAR): Extreme | null =>
  apart(phiDeg, 0) <= near ? "add" : apart(phiDeg, 180) <= near ? "cancel" : null;

/**
 * Brightness at a point r₁ and r₂ from the two sources (same units as λ), the second source
 * pushed by φ: cos²(π(r₂ − r₁)/λ + φ/2).
 */
export const fringe = (r1: number, r2: number, lambda: number, phiDeg: number): number =>
  Math.cos((Math.PI * (r2 - r1)) / lambda + (phiDeg * DEG) / 2) ** 2;

/** The two waves added at a point at time phase ωt: each cos(kr − ωt), the second plus φ. */
export const field = (r1: number, r2: number, k: number, wt: number, phiRad: number): number =>
  Math.cos(k * r1 - wt) + Math.cos(k * r2 - wt + phiRad);

export const START = { phi: 60, lam: 100 } as const;

/** The screen's state: φ in whole degrees, and the wavelength as a percentage of the usual one. */
export const STATE_RANGES = [
  [0, 359],
  [60, 160],
] as const;

export interface InterferenceState {
  phi: number;
  /** The wavelength, % of the usual. */
  lam: number;
}

export const encode = (s: InterferenceState): number[] => [
  Math.round(((s.phi % 360) + 360) % 360) % 360,
  Math.max(60, Math.min(160, Math.round(s.lam))),
];

export const decode = (v: readonly number[]): InterferenceState => ({
  phi: v[0] ?? START.phi,
  lam: v[1] ?? START.lam,
});
