import type { OptionValues } from "../../core/types";

export type Variant = "trails" | "snake" | "grid";
export type Speed = "slow" | "normal" | "fast";
export type TrailMode = "round" | "fade";
/** `wrap`: lines leave by one edge and come back at the opposite one. `solid`: edges stop lines. */
export type Edges = "wrap" | "solid";

export interface Config {
  variant: Variant;
  speed: Speed;
  /** Round time limit. */
  roundMs: number;
  gaps: boolean;
  trail: TrailMode;
  edges: Edges;
  /** Minimum lines per round with people in it, topped up with bots. */
  fill: number;
  /** Stations along the bottom of a wall. */
  wallStations: number;
  /** Stations per panel, or per half of a pair, in a bank. */
  perFrame: 1 | 2;
}

/** Simulation rate of every arena. */
export const HZ = 120;

export const SPEED_FACTOR: Readonly<Record<Speed, number>> = { slow: 0.72, normal: 1, fast: 1.3 };

/** The first person to press Start opens a lobby this long. */
export const LOBBY_MS = 6000;
/** Each later joiner extends the lobby by this much... */
export const LOBBY_EXTRA_MS = 3000;
/** ...up to this long from when it opened. */
export const LOBBY_MAX_MS = 12_000;
export const COUNTDOWN_MS = 3000;
/** Pause before a round with no people in it. */
export const BOT_LOBBY_MS = 1500;
/** Results stay up this long before the next lobby; the last WIPE_MS of it wipes the trails. */
export const OVER_MS = 4500;
export const WIPE_MS = 900;
/** How long the winner's colour floods the arena. */
export const FLOOD_MS = 1600;
/** A bot round cut short by someone joining wipes this quickly. */
export const INTERRUPT_MS = 700;

/** From this far into a round, every line speeds up by SPEEDUP_PER_S of its speed each second. */
export const SPEEDUP_AFTER_S = 30;
export const SPEEDUP_PER_S = 0.02;
/** Fading trails disappear this long after they were laid. */
export const FADE_S = 15;
/** Seconds between gaps in a trail. */
export const GAP_EVERY_S: readonly [number, number] = [2, 3];
/** Gap length in trail widths: room for another line to slip through. */
export const GAP_WIDTHS = 5;

/** `snake` and `grid` both play by snake rules. */
export const snakeRules = (v: Variant): boolean => v !== "trails";

export const SNAKE = {
  /** Body length in segments (one trail width each) after a (re)spawn. */
  start: 24,
  grow: 10,
  max: 400,
  respawnMs: 2000,
  /** After respawning a snake passes through everything for this long. */
  ghostMs: 600,
} as const;

/**
 * `grid` snakes are GRID.thick times a line's width and run on lane cells GRID.lane of their
 * own widths across, so a turn has a few times longer to land in the right lane than on
 * trail-wide cells. Their body lengths count lane cells, about as long as a `snake` body.
 */
export const GRID = { thick: 1.5, lane: 2, start: 8, grow: 4, max: 140 } as const;

/** Drawn sprite radii, in trail widths: a moving head, and a food dot before it throbs. */
export const HEAD_SIZE = 4.4;
export const FOOD_SIZE = 4;
/**
 * A head eats food this close, in trail widths: where the edge of its white disc (0.29 of its
 * sprite) meets the outside of the dot's ring (0.47 of its sprite, up to 12% larger as it throbs),
 * so a snake never visibly runs through a ring and leaves it. On the grid this is 1.65 lanes:
 * a head in the next lane, or turning at the cell diagonal to the dot, eats; two lanes over does
 * not.
 */
export const EAT_REACH = 0.29 * HEAD_SIZE + 0.47 * FOOD_SIZE * 1.12;

/** Body lengths for a variant with snake rules. */
export const snakeSize = (v: Variant): { start: number; grow: number; max: number } =>
  v === "grid" ? GRID : SNAKE;

/** Longer than the longest round plus a lobby, so a player waiting for the next round keeps the seat. */
export const PLAY_TIMEOUT_MS = 120_000;
/** Lines in a round of `trails`: one alone would win at once. */
export const MIN_LINES = 2;
/** Upper bound on lines in one arena (owner ids are one byte). */
export const MAX_LINES = 24;

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export const readConfig = (variant: string, o: OptionValues): Config => {
  const speed = o.speed === "slow" || o.speed === "fast" ? o.speed : "normal";
  const stations = Number(o.stations);
  return {
    variant: variant === "snake" || variant === "grid" ? variant : "trails",
    speed,
    roundMs: Math.min(90, Math.max(30, num(o.round, 60))) * 1000,
    gaps: o.gaps !== false,
    trail: o.trail === "fade" ? "fade" : "round",
    edges: o.edges === "solid" ? "solid" : "wrap",
    fill: Math.min(4, Math.max(0, Math.round(num(o.fill, 2)))),
    wallStations: stations === 4 || stations === 6 ? stations : 8,
    perFrame: String(o.perFrame) === "2" ? 2 : 1,
  };
};
