import type { OptionValues } from "../../core/types";

export type Herons = "off" | "few" | "many";
export type Mutation = "small" | "big";

export interface Config {
  herons: Herons;
  mutation: Mutation;
  /** Ponds along a wall. */
  ponds: number;
  tree: boolean;
}

const HERONS: readonly Herons[] = ["off", "few", "many"];

export const readConfig = (o: OptionValues): Config => {
  const ponds = typeof o.ponds === "number" && Number.isFinite(o.ponds) ? o.ponds : 3;
  return {
    herons: HERONS.includes(o.herons as Herons) ? (o.herons as Herons) : "few",
    mutation: o.mutation === "big" ? "big" : "small",
    ponds: Math.round(Math.min(4, Math.max(1, ponds))),
    tree: o.tree !== false,
  };
};

/** Standard deviation of each gene's change from parent to young (genes run 0 to 1). */
export const MUTATION_SD: Record<Mutation, number> = { small: 0.075, big: 0.14 };
/** Share of hatchlings that differ from their parent three times as much as most. */
export const SPORT_SHARE = 0.15;

/**
 * Seconds between automatic heron strikes in a pond of `PANEL_FISH`, for a fish that stands out
 * by `SEEK_AT`. A heron finds a conspicuous fish sooner and a hidden one later: the time scales
 * with (SEEK_AT / standout) squared, within `SEEK_MIN` and `SEEK_MAX` times. So herons feast
 * after a floor change and hunt slowly once the pond is hidden. Bigger ponds get more herons.
 */
export const HERON_EVERY: Record<Herons, number> = { off: Infinity, few: 1.8, many: 0.9 };
export const SEEK_AT = 0.8;
export const SEEK_MIN = 0.12;
export const SEEK_MAX = 3;
/** Automatic herons in a pond wait this long after a person last caught a fish there. */
export const HERON_YIELD_S = 6;
/** How long an automatic heron eyes its fish before it strikes. */
export const HERON_AIM_S = 0.45;
/** Fish an automatic heron compares before choosing the one that stands out most. */
export const HERON_LOOKS = 8;

/** A fish lives this long, seconds, unless caught. */
export const LIFE_MIN_S = 90;
export const LIFE_MAX_S = 120;
/** A death is replaced by a hatchling this long afterwards, seconds. */
export const BIRTH_MIN_S = 1;
export const BIRTH_MAX_S = 2;
/** Taps catch nothing while a pond holds fewer than this share of its fish. */
export const MIN_SHARE = 0.5;
/** Fish a pond may hold above its target, from migrants. */
export const OVERFLOW = 6;

/** A floor change sweeps across the pond in this long, seconds. */
export const SWEEP_S = 5;
/** With nobody playing, a pond changes its floor about this often, seconds. */
export const ATTRACT_FLOOR_S = 200;
/** A pond counts as played while a person touched it this recently, seconds. */
export const PEOPLE_S = 45;

/** Average seconds between migrants leaving a pond, per open edge. */
export const MIGRATE_EVERY_S = 45;

/** Venue px a tap may land from a fish and still catch it. */
export const SNAP = 140;
/** One hand bouncing: a second tap this close (venue px) this soon (s) after a catch is ignored. */
export const HAND_PX = 110;
export const HAND_S = 0.35;

/** Fish per pond. */
export const PANEL_FISH = 22;
export const wallFish = (ponds: number): number =>
  Math.round(Math.min(64, Math.max(30, 120 / Math.max(1, ponds))));

/** Lineage kept, ms: older history collapses into lines that run off the top. */
export const HORIZON_MS = 15 * 60_000;
/** Most nodes a family tree keeps, by where it is drawn. */
export const TREE_CAP = { panel: 900, wall: 2000, screen: 3500 } as const;

/** Bank messages. */
export const POND_EVERY_MS = 2000;
export const BEACON_EVERY_MS = 1000;
/** A panel without a beacon from its screen for this long draws its own tree. */
export const SCREEN_GRACE_MS = 3000;
/** The screen drops a frame's fish this long after its last `pond`. */
export const DROP_MS = 6000;
/** A migrant no frame claims within this long has died on the way. */
export const TRANSIT_MS = 6000;
/** Ancestors carried with a migrant. */
export const MIGRANT_CHAIN = 8;
