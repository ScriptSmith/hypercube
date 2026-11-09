/**
 * The sky a frame's kites fly in, and how its sky units map onto venue px. Kites fly in sky units
 * (1 is the sky's height); anchors sit on the sky's bottom edge (`y = 0`), above their controls.
 *
 * - Bank: the sky is the screen above the bank, which spans the bank exactly. World x runs from
 *   the bank's left edge; one sky unit is the screen's height in the touch frames' venue px,
 *   worked out from `count` and the venue profile alone, so every frame agrees without messages.
 *   The bottom edge is the touch frames' top edge.
 * - Local: the frame's own sky above its controls, from the top of the frame down to the layout's
 *   horizon.
 */
import { bankFraction } from "../../core/layout";
import { activeVenue } from "../../core/venue";
import type { SkyBounds, StuntWindow } from "./kite";
import type { Layout } from "./layout";

export interface SkyFrame {
  mode: "bank" | "local";
  /** Venue px of the frame per sky unit. */
  scale: number;
  /** Frame px x of world x = 0, and frame px y of the sky's bottom edge. */
  originX: number;
  baseY: number;
  /** World width, sky units. */
  width: number;
  bounds: SkyBounds;
  /** Kite size, sky units. */
  kite: number;
  /** Ring radius, sky units. */
  ring: number;
  window: StuntWindow;
  /** Wind and ring position for world x: the fraction across the bank, or across this sky. */
  fOf(x: number): number;
}

/** Screen height over width, from the venue profile. */
export const screenAspect = (): number => {
  const screen = activeVenue().screen;
  return screen.height / screen.width;
};
/** Kite size and ring radius on the screen, in screen heights. */
export const BANK_KITE = 0.062;
export const BANK_RING = 0.07;
/** Tree tops along the sky's bottom, sky units. */
export const FLOOR = 0.07;

export const windowFor = (patchWidth: number): StuntWindow => {
  const a = Math.min(0.8, Math.max(0.3, 2.2 * patchWidth));
  return { a, b: 0.92, shift: 0.3 * a };
};

export const boundsFor = (width: number, kite: number): SkyBounds => ({
  xmin: kite * 0.6,
  xmax: width - kite * 0.6,
  floor: FLOOR,
  top: 1 - kite * 0.45,
});

export interface BankPlace {
  pos: number;
  count: number;
}

/** The screen's sky for a touch frame at `place` in a bank of frames like this one. */
export const bankSky = (layout: Layout, place: BankPlace): SkyFrame => {
  const fw = layout.width;
  const count = Math.max(1, place.count, place.pos + 1);
  const bankW = count * fw;
  const scale = bankW * screenAspect();
  const width = bankW / scale;
  const pw = (layout.patches[0] ? layout.patches[0].x1 - layout.patches[0].x0 : fw) / scale;
  return {
    mode: "bank",
    scale,
    originX: -place.pos * fw,
    baseY: 0,
    width,
    bounds: boundsFor(width, BANK_KITE),
    kite: BANK_KITE,
    ring: BANK_RING,
    window: windowFor(pw),
    fOf: (x) => x / width,
  };
};

/**
 * The frame's own sky. In a bank the wind is still read at the frame's place along the bank, so
 * its kites keep the bank's gusts while the screen is away.
 */
export const localSky = (layout: Layout, place: BankPlace | null): SkyFrame => {
  const scale = Math.max(1, layout.horizon);
  const width = layout.width / scale;
  const kite = layout.kitePx / scale;
  const pw =
    (layout.patches[0] ? layout.patches[0].x1 - layout.patches[0].x0 : layout.width) / scale;
  const count = place ? Math.max(1, place.count, place.pos + 1) : 1;
  return {
    mode: "local",
    scale,
    originX: 0,
    baseY: layout.horizon,
    width,
    bounds: boundsFor(width, kite),
    kite,
    ring: Math.max(kite * 0.75, 0.09),
    window: windowFor(pw),
    fOf: place ? (x) => bankFraction(place.pos, x / width, count) : (x) => x / width,
  };
};

/** World x of a frame px x. */
export const worldX = (sky: SkyFrame, px: number): number => (px - sky.originX) / sky.scale;
/** Frame px of a world point. */
export const frameX = (sky: SkyFrame, x: number): number => sky.originX + x * sky.scale;
export const frameY = (sky: SkyFrame, y: number): number => sky.baseY - y * sky.scale;

/**
 * Where a line from a grip `depth` px below the sky's bottom edge, at frame x `gx`, to a kite at
 * frame px (kx, ky) crosses that edge, leaning no more than `maxLean` px. Its continuation on the
 * screen then starts where the panel's part ends.
 */
export const exitX = (
  gx: number,
  depth: number,
  kx: number,
  ky: number,
  baseY: number,
  maxLean: number,
): number => {
  const rise = baseY - ky + depth;
  const lean = rise > 1 ? ((kx - gx) * depth) / rise : 0;
  return gx + Math.max(-maxLean, Math.min(maxLean, lean));
};

/**
 * The screen's own sky, for kites it flies itself while no touch frame is sending: `width` sky
 * units wide (its aspect), anchors spread over `columns` columns.
 */
export const screenSky = (width: number, columns: number): SkyFrame => ({
  mode: "bank",
  scale: 1,
  originX: 0,
  baseY: 0,
  width,
  bounds: boundsFor(width, BANK_KITE),
  kite: BANK_KITE,
  ring: BANK_RING,
  window: windowFor(width / Math.max(1, columns)),
  fOf: (x) => x / width,
});
