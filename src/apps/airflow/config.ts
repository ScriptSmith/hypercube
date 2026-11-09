import type { FrameKind, OptionValues } from "../../core/types";
import { MAX_SHAPES } from "./lattice";

export type View = "smoke" | "speed" | "swirl";
export const VIEWS: readonly View[] = ["smoke", "speed", "swirl"];

/** The wind presets as positions of the wind slider (0 gentle to 1 strong). */
export const WINDS = { gentle: 0.1, steady: 0.5, strong: 0.9 } as const;
export type WindName = keyof typeof WINDS;

export interface Config {
  hands: boolean;
  wind: number;
  view: View;
  shapes: number;
  arrows: boolean;
}

export const readConfig = (variant: string, options: OptionValues, kind: FrameKind): Config => {
  const wind = WINDS[String(options.wind) as WindName] ?? WINDS.steady;
  const view = VIEWS.includes(options.view as View) ? (options.view as View) : "smoke";
  const raw = Number(options.shapes);
  const wanted = Number.isFinite(raw) ? Math.round(raw) : 3;
  // Only the wall takes a number of shapes; the kiosk has two and each updraft one.
  const shapes =
    kind === "wall" ? Math.min(MAX_SHAPES, Math.max(1, wanted)) : kind === "kiosk" ? 2 : 1;
  return {
    hands: variant === "hands",
    wind,
    view,
    shapes,
    arrows: options.arrows !== false,
  };
};

// ---- Flow ---------------------------------------------------------------------------------

/**
 * Inlet speed (lattice units) at the slider's ends. Air speeds up to two or three times this
 * round a broadside plate's edges and in its eddies; above about 0.08 those reach Mach numbers
 * where the lattice turns grid-scale noise into the eddies (checked against the CPU reference).
 */
export const U_GENTLE = 0.03;
export const U_STRONG = 0.08;
/** Reynolds number (on the disc's diameter) at the slider's ends: steady wakes up to strong eddies. */
export const RE_GENTLE = 30;
export const RE_STRONG = 600;
/**
 * Lowest relaxation time used. Closer to 1/2 the regularised collision still holds, but
 * checkerboard noise starts to show on coarse grids (checked against the CPU reference).
 */
export const TAU_MIN = 0.515;
export const SMAGORINSKY = 0.16;
/**
 * Relaxation time of the stress's trace: a large bulk viscosity, so the sound that shedding
 * eddies, moving shapes and fingers make dies away instead of ringing between the inlet and the
 * outlet (it rippled the smoke upstream and shook the force arrows).
 */
export const BULK_TAU = 1;
/** Relaxation time at the end of the sponge beyond the outlet. */
export const SPONGE_TAU = 1;
/** Hidden columns beyond the outlet edge, as a share of the visible ones, holding the sponge. */
export const EXHAUST = 0.14;
/** Weight of each step in the per-cell force average (about 40 steps). */
export const FORCE_EMA = 0.025;

/** Inlet speed for a wind, times the frame kind's `speed` (see KindSpec). */
export const speedOf = (wind: number, factor = 1): number =>
  (U_GENTLE + (U_STRONG - U_GENTLE) * Math.min(1, Math.max(0, wind))) * factor;

export const reynoldsOf = (wind: number): number =>
  RE_GENTLE * (RE_STRONG / RE_GENTLE) ** Math.min(1, Math.max(0, wind));

/** Relaxation time for a wind, given the disc's diameter in cells and the kind's speed. */
export const tauOf = (wind: number, disc: number, factor = 1): number =>
  Math.max(TAU_MIN, 0.5 + (3 * speedOf(wind, factor) * disc) / reynoldsOf(wind));

/** The speed the views and plumes measure against: the steady wind's. */
export const U_REF = speedOf(WINDS.steady);

// ---- Sizes and timing, per frame kind -----------------------------------------------------

export interface KindSpec {
  /** Venue px per lattice cell at res 1. */
  cell: number;
  /** Seconds for steady air to cross the visible tunnel. */
  crossing: number;
  /** Shape size (venue px per 100 outline units). */
  shape: number;
  /** Finger obstacle radius, venue px. */
  finger: number;
  handle: number;
  knob: number;
  tile: number;
  /** Venue px between the rakes' smoke streaks. */
  streak: number;
  /**
   * Inlet speed relative to the slider's: an updraft's shape fills a third of its chimney, and
   * the air squeezing past it would otherwise reach speeds where the lattice turns noisy.
   */
  speed: number;
  /**
   * The size steps visitors can choose, as multiples of `shape`. The largest is the largest at
   * which the lattice stays healthy at the strong wind on the coarsest grid (a broadside plate
   * then blocks about half a tunnel or 70 % of a chimney), and a narrow lane caps it lower (see
   * layout.ts); the smallest keeps the disc six cells across on the coarsest grid.
   */
  sizes: readonly number[];
  /** Side of the bigger and smaller buttons, venue px. */
  sizeButton: number;
}

const SIZES = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3] as const;
/** Up to twice the usual size (the kiosk and panels). */
const SIZES_2 = SIZES.slice(0, 6);
/** A size change eases over this long: a solid that grows at once is a small explosion. */
export const SIZE_S = 0.4;

/** The step of `sizes` closest to `factor`. */
export const nearestStep = (sizes: readonly number[], factor: number): number => {
  let best = 0;
  sizes.forEach((v, i) => {
    if (Math.abs(v - factor) < Math.abs((sizes[best] ?? 1) - factor)) best = i;
  });
  return best;
};

export const KINDS: Record<FrameKind, KindSpec> = {
  wall: {
    cell: 7,
    crossing: 9,
    shape: 440,
    finger: 70,
    handle: 180,
    knob: 170,
    tile: 150,
    streak: 150,
    speed: 1,
    sizes: SIZES,
    sizeButton: 150,
  },
  kiosk: {
    cell: 4,
    crossing: 5,
    shape: 250,
    finger: 50,
    handle: 150,
    knob: 140,
    tile: 120,
    streak: 72,
    speed: 1,
    sizes: SIZES_2,
    sizeButton: 120,
  },
  panel: {
    cell: 5,
    crossing: 4.5,
    shape: 300,
    finger: 56,
    handle: 160,
    knob: 150,
    tile: 150,
    streak: 64,
    speed: 0.75,
    sizes: SIZES_2,
    sizeButton: 120,
  },
  pair: {
    cell: 5,
    crossing: 4.5,
    shape: 300,
    finger: 56,
    handle: 160,
    knob: 150,
    tile: 150,
    streak: 64,
    speed: 0.75,
    sizes: SIZES_2,
    sizeButton: 120,
  },
  screen: {
    cell: 6,
    crossing: 18,
    shape: 0,
    finger: 0,
    handle: 0,
    knob: 0,
    tile: 0,
    streak: 120,
    speed: 1,
    sizes: [1],
    sizeButton: 0,
  },
  sphere: {
    cell: 6,
    crossing: 18,
    shape: 0,
    finger: 0,
    handle: 0,
    knob: 0,
    tile: 0,
    streak: 120,
    speed: 1,
    sizes: [1],
    sizeButton: 0,
  },
};

/** The disc's diameter in outline units (its outline radius is 36). */
export const DISC_UNITS = 72;

/** Plume samples per panel's width (a merged frame sends this many per panel). */
export const PLUME_SAMPLES = 40;
/** Plumes go to the screen this often. */
export const PLUME_HZ = 12;
/** Plume velocities are bytes spanning this many steady winds either way. */
export const PLUME_RANGE = 3;
/** The screen's inflow speed (lattice) for a plume rising at the steady wind. */
export const SCREEN_UREF = 0.06;
/** A frame whose plumes stop for this long gets the default updraft again. */
export const PLUME_TIMEOUT_MS = 2000;

/**
 * The fan starts from still air and spins up over this many lattice steps (or seconds, if
 * those come first): starting at full speed sends a sound wave down the tunnel that leaves a
 * slow ripple near the inlet (checked against the CPU reference).
 */
export const RAMP_STEPS = 600;
export const RAMP_S = 30;

/**
 * Smoke fades to half in this many seconds of the air's time, so eddies that trap it clear in
 * time. The screen's air takes 18 s to rise, so its smoke lasts longer.
 */
export const SMOKE_HALF_LIFE_S = 14;
export const SCREEN_SMOKE_HALF_LIFE_S = 30;
