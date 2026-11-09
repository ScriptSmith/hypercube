import type { Palette } from "../types";

/**
 * Player colours are ordered so that any prefix stays distinct: the first two under every
 * common colour-vision deficiency by a wide margin, the first four and six comfortably, all
 * eight at least noticeably (checked in tests/ui/palette.test.ts). Each has at least 6:1
 * contrast on the background, so they work as strokes on it and as fills behind dark icons.
 */
export const PALETTE: Palette = {
  background: "#05070d",
  foreground: "#f2f5fa",
  muted: "#8a94a8",
  accent: "#ffcc33",
  danger: "#ff5a4f",
  players: [
    "#6fa4fc", // blue
    "#f0e82a", // yellow
    "#fb5c99", // pink
    "#6cf7f8", // cyan
    "#f29b1d", // orange
    "#89da9b", // green
    "#ad83d1", // purple
    "#ff4a3d", // red
  ],
};

/** `#rrggbb` (or `#rgb`) to `rgba(...)` with the given alpha. Other strings pass through. */
export const withAlpha = (color: string, alpha: number): string => {
  const hex = color.trim().replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, "#$1$1$2$2$3$3");
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return color;
  const n = Number.parseInt(hex.slice(1), 16);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
