import type { OptionValues } from "../../core/types";

export type Density = "easy" | "normal" | "hard";
export type Counts = "mixed" | "digits" | "dots";

export interface Config {
  density: Density;
  counts: Counts;
  flags: boolean;
  /** Chebyshev radius of the sand a sting blows back over. */
  sting: 1 | 2;
}

export const DENSITIES: readonly Density[] = ["easy", "normal", "hard"];

/** Share of cells that hide a bluebottle, in the child rows and the rows above them. */
export const DENSITY: Readonly<Record<Density, { low: number; high: number }>> = {
  easy: { low: 0.06, high: 0.13 },
  normal: { low: 0.08, high: 0.18 },
  hard: { low: 0.1, high: 0.22 },
};

export const isDensity = (v: unknown): v is Density =>
  v === "easy" || v === "normal" || v === "hard";

export const readConfig = (o: OptionValues): Config => ({
  density: isDensity(o.density) ? o.density : "normal",
  counts: o.counts === "digits" || o.counts === "dots" ? o.counts : "mixed",
  flags: o.flags !== false,
  sting: o.sting === "big" ? 2 : 1,
});

/** Venue px. Touch on the wall is imprecise, so cells are never smaller than this anywhere. */
export const CELL = 135;
/** Columns in one crab region: one panel's width. */
export const REGION_COLS = 8;
/** About one opening per this many columns. */
export const OPENING_EVERY = 6;

/** A press held this long plants a flag. */
export const HOLD_MS = 600;
/** The fill ring shows only after this, so quick taps don't flash it. */
export const RING_DELAY_MS = 140;
/** A touch that slides further than this share of a cell before release does nothing. */
export const SLIP = 0.4;
/** Hold on the wash control. */
export const WASH_HOLD_MS = 1500;

/** From a cleared patch to the next one: the celebration, then the tide. */
export const CLEAR_GAP_MS = 7000;
/** From a wash to the next patch. */
export const WASH_GAP_MS = 2600;
/** The tide's sweep over the beach, at the end of either gap. */
export const TIDE_MS = 1800;

/** A wash from one frame is refused while another frame's visitors dug this recently. */
export const WASH_GUARD_MS = 15_000;
/** ...and an idle frame's wash while they dug within the default idle time. */
export const IDLE_GUARD_MS = 60_000;
/** A region with no deducible safe cell for this long gets a crab. */
export const STUCK_MS = 2500;
/** A region with no progress at all for this long gets a crab as a hint. */
export const QUIET_MS = 20_000;
/** Crabs dig for an absent frame's region this often. */
export const ABSENT_CRAB_MS = 1400;
/** Time from a crab's hint to its dig, while it scuttles to the cell. */
export const CRAB_WALK_MS = 900;
/** The leader looks for stuck regions this often. */
export const CRAB_CHECK_MS = 500;

/** Bank heartbeat, and how long a silent frame counts as present. */
export const BEAT_MS = 1000;
export const BEAT_LOST_MS = 3500;
/** A bank frame with nobody else in its group for this long starts a beach of its own. */
export const ALONE_MS = 5000;
/** A joining frame that hears no patch for this long, and leads, starts one. */
export const JOIN_WAIT_MS = 1500;
/** A joining frame that still has no patch after this long plays alone and tries again later. */
export const JOIN_GIVE_UP_MS = 9000;
/** A frame playing alone rejoins its bank once nobody has touched it for this long. */
export const REJOIN_IDLE_MS = 15_000;
/** ...and not more often than this. */
export const REJOIN_EVERY_MS = 20_000;
/** Two frames on different patches for this long settle on the leader's. */
export const DISAGREE_MS = 2500;
/** At most this many events in one sync chunk. */
export const CHUNK = 200;
/** A patch's event log holds at most this many events per cell. */
export const LOG_PER_CELL = 4;
/** Wash events kept per patch, beyond the cap. */
export const MAX_WASHES = 64;
/** Events for the next patch held until it begins. */
export const MAX_EARLY = 400;

/** Attract bot cadence, seconds between moves. */
export const ATTRACT_REST: readonly [number, number] = [0.9, 1.5];
/** Test and demo bots. */
export const BOT_REST: readonly [number, number] = [0.5, 1.1];
/** A bot yields to people for this long after their last touch. */
export const BOT_YIELD_MS = 15_000;
