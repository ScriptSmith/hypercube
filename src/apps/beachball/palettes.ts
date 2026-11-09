/**
 * Printed vinyl colours, in sRGB as they would be picked from a photograph. The gores go round
 * the ball in this order. No palette uses red or yellow at all, so red can never sit beside
 * yellow (the lifesaving rule).
 */
export type PaletteId = "classic" | "ocean" | "sunset";

export interface Palette {
  gores: readonly [string, string, string, string, string, string];
  cap: string;
  valve: string;
}

const WHITE = "#ece8de";

export const PALETTES: Record<PaletteId, Palette> = {
  classic: {
    gores: ["#2161c2", WHITE, "#2f9c55", WHITE, "#f2861f", WHITE],
    cap: "#efece4",
    valve: "#d9e2e6",
  },
  ocean: {
    gores: ["#1d3577", "#3ccdc4", WHITE, "#138784", "#58ade6", WHITE],
    cap: "#efece4",
    valve: "#d9e2e6",
  },
  sunset: {
    gores: ["#ef7db8", "#f2861f", "#7a4cc2", WHITE, "#cc3096", WHITE],
    cap: "#efece4",
    valve: "#e4dde6",
  },
};

export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];

export const paletteOf = (id: unknown): Palette =>
  PALETTES[(PALETTE_IDS as unknown[]).includes(id) ? (id as PaletteId) : "classic"];

/** Hue in degrees and chroma (0 to 1) of a `#rrggbb` colour. */
export const hueChroma = (hex: string): { hue: number; chroma: number } => {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  if (c === 0) return { hue: 0, chroma: 0 };
  let h: number;
  if (max === r) h = ((g - b) / c) % 6;
  else if (max === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  return { hue: (h * 60 + 360) % 360, chroma: c };
};

/** Enough colour to read as a colour rather than a tinted white or grey. */
const COLOURFUL = 0.2;

export const isRed = (hex: string): boolean => {
  const { hue, chroma } = hueChroma(hex);
  return chroma >= COLOURFUL && (hue >= 345 || hue <= 18);
};

export const isYellow = (hex: string): boolean => {
  const { hue, chroma } = hueChroma(hex);
  return chroma >= COLOURFUL && hue >= 42 && hue <= 72;
};
