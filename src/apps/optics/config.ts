import type { OptionValues } from "../../core/types";

export type Start = "easy" | "medium";

export interface Config {
  /** Puzzles with prisms, filters and coloured crystals; false keeps to white light. */
  colour: boolean;
  start: Start;
  /** Benches side by side on a wall. */
  benches: number;
  sandbox: boolean;
}

export const readConfig = (o: OptionValues, variant: string): Config => ({
  colour: o.colour !== false,
  start: o.start === "medium" ? "medium" : "easy",
  benches: typeof o.benches === "number" ? Math.max(1, Math.min(3, Math.round(o.benches))) : 2,
  sandbox: variant === "sandbox",
});

/** A press that moves less than this (venue px) and lifts sooner than TAP_MS is a tap. */
export const TAP_SLOP = 34;
export const TAP_MS = 550;
/** A piece dropped within this share of the socket spacing of a free socket goes into it. */
export const SNAP = 0.62;
/** Hold on a bench's reset control. */
export const RESET_HOLD_MS = 1500;
/** A rotation ring stays bright this long after its piece was last touched. */
export const ACTIVE_MS = 8000;

/** Crystals take about this long to brighten or fade. */
export const GLOW_MS = 300;
/** From the last crystal lighting to the next puzzle sliding in, in solo setups. */
export const CELEBRATE_MS = 2600;
/** The next puzzle's fade out and in. */
export const SLIDE_MS = 900;

/** Bots and the attract hand: seconds of rest between moves. */
export const BOT_REST: readonly [number, number] = [0.7, 1.5];
export const GHOST_REST: readonly [number, number] = [1.4, 2.4];
/** A bot leaves a bench alone for this long after a person touches it. */
export const BOT_YIELD_MS = 15_000;
/** Chance a bot turns a piece the wrong way first. */
export const BOT_WRONG = 0.18;

/** Bank: edge beams at most this often, and at least this often as a heartbeat. */
export const BEAM_MIN_MS = 50;
export const BEAM_BEAT_MS = 1000;
/** Incoming beams expire this long after their last message. */
export const BEAM_EXPIRE_MS = 2000;
/** Light that has crossed more frames than this is dropped, so light bouncing between two frames settles. */
export const MAX_HOPS = 12;
/** The leader announces the round this often, and frames report their state this often. */
export const ROUND_BEAT_MS = 1000;
/** A frame that hears no round for this long carries on alone. */
export const ROUND_LOST_MS = 4500;
/** A new leader listens this long before announcing, to pick up the bank's round. */
export const LEADER_SETTLE_MS = 2500;
/** A new round can't be through sooner than this, while old light is still about. */
export const ROUND_SETTLE_MS = 3000;
/** The bank's celebration before the next round. */
export const BANK_CHEER_MS = 4500;
/** Every frame solved but the light not through for this long: move on anyway. */
export const BANK_STUCK_MS = 20_000;
/** Every present frame solved while some frame is missing: move on after this long. */
export const BANK_ALONE_MS = 3000;
/** A round nobody is playing moves on after this long, so attract never sticks on one puzzle. */
export const BANK_IDLE_ROUND_MS = 180_000;
/** The screen's finale. */
export const FINALE_MS = 6500;
