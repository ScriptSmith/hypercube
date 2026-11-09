/**
 * One colour per harmonic, the same on its controls, its thread, its circle in the picture and
 * its stripes in the cloth: a wheel from warm (low harmonics) to cool (high), all bright on the
 * dark background.
 */
export const HARMONIC_COLOURS = [
  "#ff6f61",
  "#ffa040",
  "#ffd447",
  "#b8e65c",
  "#55e08f",
  "#3fd8d0",
  "#55b6ff",
  "#7b8cff",
  "#b07dff",
  "#f274d8",
] as const;

/** Harmonic k's colour (k from 1). */
export const colourOf = (k: number): string =>
  HARMONIC_COLOURS[
    (((Math.round(k) - 1) % HARMONIC_COLOURS.length) + HARMONIC_COLOURS.length) %
      HARMONIC_COLOURS.length
  ]!;

export const BACKGROUND =
  "radial-gradient(ellipse 90% 70% at 50% 35%, #141a33 0%, #0a0e1f 55%, #04060c 100%)";

/** The summed wave and the target's ghost. */
export const WAVE = "#f4f1ea";
export const GHOST = "#9fb0d8";
export const GLOW = "#fff3c4";

export const rgba = (hex: string, a: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
};

/** Mix a colour towards white (k > 0) or black (k < 0). */
export const shade = (hex: string, k: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};
