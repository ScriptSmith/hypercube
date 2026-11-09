/**
 * Options, variants and the numbers the simulation runs on. World units are block widths; y is
 * up from the ground. Times are seconds unless a name ends in MS.
 */
import type { OptionValues } from "../../core/types";

export type Variant = "build" | "tall";

export interface Config {
  variant: Variant;
  cranes: number;
  wind: boolean;
  assist: boolean;
}

export const readConfig = (variant: string, options: OptionValues): Config => {
  const cranes = Number(options.cranes);
  return {
    variant: variant === "tall" ? "tall" : "build",
    cranes: Number.isFinite(cranes) ? Math.max(2, Math.min(3, Math.round(cranes))) : 3,
    wind: options.wind === "light",
    assist: options.assist !== false,
  };
};

export const HZ = 60;

/** A block is one unit wide and this tall. */
export const BH = 0.7;
/** Drawn a little narrower than a slot, so neighbours read as separate blocks. */
export const BLOCK_DRAW_W = 0.94;
/** From the hook point down to the top of a carried block. */
export const SLING = 0.3;
/** The trolley's sheave hangs this far below the jib. */
export const SHEAVE = 0.28;
/** Units per second squared: stronger than real, so swings are quick enough to play with. A 3-unit cable swings once every 2.7 s. */
export const G = 16;

/** Kinds of block. Roofs fit only top slots; floors fit any slot. */
export const KIND = { plain: 0, glass: 1, balcony: 2, roof: 3 } as const;
export const KIND_COUNT = 4;

export const TROLLEY = { speed: 4.2, accel: 5 };
/** Hoist speed grows with the crane's height, so a long cable doesn't take forever. */
export const HOIST = { speed: 2.8, perUnit: 0.1, accel: 5 };
/** Swing damping per second: a little on its own, much more with the assist on. */
export const DAMP = { free: 0.1, assist: 1.6 };
/** The swing never goes past this, so nothing blows up at the cable's limits. */
export const MAX_SWING = 1.15;
export const MIN_CABLE = 0.35;

/** Letting go snaps a block into a free slot this close (block centre to slot centre). */
export const SNAP = { dx: 0.62, below: 0.32, above: BH * 1.8 };
/** Held still this close for AUTO_HOLD, the hook lets go by itself. */
export const AUTO = { dx: 0.32, below: 0.3, above: 0.32, speed: 0.7, hold: 0.45 };
/** The hook catches a yard block when lowered this close to it (hook point to block top). */
export const ATTACH = { dx: 0.42, below: SLING * 0.5 - 0.04, above: SLING + 0.38 };
/** Carried blocks and the empty hook only collide over the middle of their width. */
export const COLLIDE_HALF = 0.3;
/** How long a snapped block takes to settle into its slot. */
export const SETTLE_S = 0.32;
/** How long a caught block takes to swing up onto its sling. */
export const CATCH_S = 0.22;

/** Tallest tower: blocks may sit this far off the one below; further and they don't snap. */
export const TALL_OFFSET = 0.45;
export const TALL_SNAP_DX = 0.6;
/** A leaning tower wobbles for this long before its top tumbles. */
export const WOBBLE_S = 1.3;

export const YARD_MAX = 4;
/** Blocks in the air at once per crane (falling, sliding back). More go straight to the yard. */
export const MAX_LOOSE = 16;
/** Seconds for a block to ride the lift from the buttons to the yard. */
export const LIFT_S = 2.2;
/** Blocks riding one lift at once. */
export const LIFT_MAX = 2;

/** A finished building stays this long before the oldest comes down (one lot: much longer). */
export const HOLD_S = 5;
export const HOLD_ONE_LOT_S = 25;
/** One block comes off a building this often while it is taken apart. */
export const CLEAR_STEP_S = 0.36;
export const CELEBRATE_S = 3;

/** A crane nobody has touched for this long drives itself. */
export const AUTO_AFTER_MS = 10_000;
/** A bot stands back this long after a person touches its crane. */
export const BOT_YIELD_MS = 20_000;
/** Blocks arrive by themselves this often per crane in attract, while the yard has room. */
export const SELF_FEED_MS = 7_000;
/** After a person sends a block, the attract feed waits this long. */
export const FEED_QUIET_MS = 20_000;

/** Sky: day to dusk to night and back, over this long, on the shared clock. */
export const DAY_MS = 10 * 60 * 1000;
