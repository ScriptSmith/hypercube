/**
 * Skin colours for the ball, in sRGB. Each is a bright colour no person's skin is, with the
 * darker tone it shades to, an ink for the brows, mouth and outlines, and a tint for the cheeks.
 */
export type ColourId = "yellow" | "blue" | "green";

export interface Palette {
  skin: string;
  /** The skin in shade, round the back of the head and under the chin. */
  deep: string;
  /** The soft highlight on the forehead. */
  glow: string;
  ink: string;
  cheek: string;
  hand: string;
}

export const PALETTES: Record<ColourId, Palette> = {
  yellow: {
    skin: "#f2bb2e",
    deep: "#d98a14",
    glow: "#ffe08a",
    ink: "#4a2a10",
    cheek: "#ee8a4a",
    hand: "#fbd768",
  },
  blue: {
    skin: "#45a6ee",
    deep: "#2470c6",
    glow: "#a9dcff",
    ink: "#112a52",
    cheek: "#8f8cf0",
    hand: "#86cbf8",
  },
  green: {
    skin: "#5cc552",
    deep: "#2f9644",
    glow: "#b9f09a",
    ink: "#133c20",
    cheek: "#c7d94a",
    hand: "#93e07f",
  },
};

export const COLOUR_IDS = Object.keys(PALETTES) as ColourId[];

export const colourOf = (id: unknown): ColourId =>
  (COLOUR_IDS as unknown[]).includes(id) ? (id as ColourId) : "yellow";

/** Relative luminance (0 to 1) of a `#rrggbb` colour. */
export const luminance = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
