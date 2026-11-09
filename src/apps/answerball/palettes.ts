/**
 * Looks for the ball, in sRGB as they would be picked from a photograph: the moulded body, the
 * liquid behind the window, the die's faces and its raised letters. Every body is dark, so the
 * window and its answer are what people see. On a wall the balls stand in a dark studio whose
 * backdrop's paper is `room`, a muted shade that goes with the rest.
 */
export type PaletteId = "night" | "violet" | "teal";

export interface Palette {
  body: string;
  liquid: string;
  die: string;
  ink: string;
  room: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  night: { body: "#1b1c20", liquid: "#0b1a52", die: "#2b33a8", ink: "#eef0f6", room: "#5a6680" },
  violet: { body: "#21182a", liquid: "#1c0e48", die: "#5a2aa6", ink: "#f3eef8", room: "#6a5a80" },
  teal: { body: "#14201f", liquid: "#062f3f", die: "#127c8c", ink: "#eef7f6", room: "#527478" },
};

export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];

export const paletteOf = (id: unknown): Palette =>
  PALETTES[(PALETTE_IDS as unknown[]).includes(id) ? (id as PaletteId) : "night"];
