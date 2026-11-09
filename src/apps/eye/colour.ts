/**
 * Colour vision deficiency as a picture filter, acting on linear RGB.
 *
 * - sRGB decoding and encoding from W3C CSS Color 4.
 * - The dichromat end: Viénot, Brettel and Mollon's 1999 linear-RGB matrices, as Sidorchuk and
 *   colleagues 2025 print them. Machado and colleagues' precomputed matrices aren't used, and
 *   recomputing them needs the measured spectra of the display's primaries.
 * - Severity: Machado's model makes an anomalous cone a blend of the normal cone and the cone it
 *   is replaced by in dichromacy (Eqs. 17 and 18, La = α L + (1 - α) k M), so cone signals, and
 *   before Machado's per-row normalisation the simulation matrix, blend linearly between normal
 *   and dichromat. Here severity s blends the identity and the dichromat matrix: s = 0 is no
 *   change and s = 1 is dichromacy. An approximation, as every such simulation is.
 */

export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type CvdType = "protan" | "deutan";

/** Rows top to bottom, applied to linear (R, G, B) column vectors. */
export const VIENOT: Record<CvdType, Mat3> = {
  protan: [0.1124, 0.8876, 0, 0.1124, 0.8876, 0, 0.004, -0.004, 1],
  deutan: [0.2928, 0.7072, 0, 0.2928, 0.7072, 0, -0.0223, 0.0223, 1],
};

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** The simulation matrix for `type` at severity `s` (0 to 1). */
export const cvdMatrix = (type: CvdType, s: number): Mat3 => {
  const k = Math.min(1, Math.max(0, s));
  const d = VIENOT[type];
  return IDENTITY.map((v, i) => v * (1 - k) + d[i]! * k) as unknown as Mat3;
};

export const applyMat3 = (
  m: Mat3,
  rgb: readonly [number, number, number],
): [number, number, number] => [
  m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2],
  m[3] * rgb[0] + m[4] * rgb[1] + m[5] * rgb[2],
  m[6] * rgb[0] + m[7] * rgb[1] + m[8] * rgb[2],
];

/** sRGB component (0 to 1) to linear light (W3C CSS Color 4). */
export const toLinear = (c: number): number => {
  const a = Math.abs(c);
  const v = a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4;
  return Math.sign(c) * v;
};

/** Linear light to an sRGB component (W3C CSS Color 4). */
export const toSrgb = (c: number): number => {
  const a = Math.abs(c);
  const v = a > 0.0031308 ? 1.055 * a ** (1 / 2.4) - 0.055 : 12.92 * a;
  return Math.sign(c) * v;
};

/** A `#rrggbb` colour through the filter, for drawing the cone mosaic and tests. */
export const simulateHex = (hex: string, type: CvdType, s: number): string => {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const rgb: [number, number, number] = [
    toLinear(((n >> 16) & 255) / 255),
    toLinear(((n >> 8) & 255) / 255),
    toLinear((n & 255) / 255),
  ];
  const out = applyMat3(cvdMatrix(type, s), rgb).map((v) =>
    Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255),
  );
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};
