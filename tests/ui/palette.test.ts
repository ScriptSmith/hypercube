import { describe, expect, it } from "vitest";
import { PALETTE, withAlpha } from "../../src/core/ui/palette";

// Colour-vision simulation (Machado, Oliveira and Fernandes 2009, severity 1) in linear sRGB,
// with distances measured in OKLab.
const SIM: Record<string, number[] | null> = {
  normal: null,
  protanopia: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039,
  ],
};

const linear = (hex: string) =>
  [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

const simulate = ([r, g, b]: number[], m: number[] | null) =>
  m
    ? [0, 1, 2].map((i) =>
        Math.min(1, Math.max(0, m[i * 3]! * r! + m[i * 3 + 1]! * g! + m[i * 3 + 2]! * b!)),
      )
    : [r!, g!, b!];

const oklab = ([r, g, b]: number[]) => {
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const luminance = (hex: string) => {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** Smallest OKLab distance between any two of the first `n` player colours under `m`. */
const minDistance = (n: number, m: number[] | null) => {
  const pts = PALETTE.players.slice(0, n).map((c) => oklab(simulate(linear(c), m)));
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      min = Math.min(min, Math.hypot(...pts[i]!.map((v, k) => v - pts[j]![k]!)));
    }
  }
  return min;
};

describe("palette", () => {
  it("has eight distinct, well-formed player colours", () => {
    expect(PALETTE.players).toHaveLength(8);
    expect(new Set(PALETTE.players).size).toBe(8);
    for (const c of PALETTE.players) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps every player colour readable on the background", () => {
    for (const c of PALETTE.players) {
      expect(contrast(c, PALETTE.background)).toBeGreaterThanOrEqual(6);
    }
    expect(contrast(PALETTE.foreground, PALETTE.background)).toBeGreaterThanOrEqual(15);
    expect(contrast(PALETTE.muted, PALETTE.background)).toBeGreaterThanOrEqual(4.5);
  });

  // Thresholds in OKLab units: about 0.02 is a just-noticeable difference.
  it.each(Object.entries(SIM))("keeps players apart under %s", (_, m) => {
    expect(minDistance(2, m)).toBeGreaterThan(0.25);
    expect(minDistance(4, m)).toBeGreaterThan(0.15);
    expect(minDistance(6, m)).toBeGreaterThan(0.09);
    expect(minDistance(8, m)).toBeGreaterThan(0.06);
  });

  it("adds alpha to hex colours", () => {
    expect(withAlpha("#ff8000", 0.5)).toBe("rgba(255,128,0,0.5)");
    expect(withAlpha("#fff", 2)).toBe("rgba(255,255,255,1)");
    expect(withAlpha("red", 0.5)).toBe("red");
  });
});
