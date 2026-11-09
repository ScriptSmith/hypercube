/**
 * Options, the colour code and the app's timings.
 *
 * The colour code never changes meaning: the incident beam blue, scattered beams magenta,
 * real-space things (atoms, planes, hardware) green, reciprocal-space things (spots, rings, S,
 * maps) orange. They are the nearest colours in the shared palette, and
 * nothing else in the app uses them.
 */
import { PALETTE } from "../../core/ui/palette";
import type { OptionValues } from "../../core/types";
import { type ChapterId, isChapterId } from "./ids";

export type MathsMode = "button" | "open" | "off";
export type WallSet = "highlights" | "first" | "last";
export type TubeId = "copper" | "cobalt" | "molybdenum";

export interface Config {
  maths: MathsMode;
  /** Where a solo frame starts and returns to; null tours every chapter. */
  chapter: ChapterId | null;
  set: WallSet;
  maps: boolean;
  tube: TubeId;
}

export const readConfig = (o: OptionValues): Config => ({
  maths: o.maths === "open" || o.maths === "off" ? o.maths : "button",
  chapter: isChapterId(o.chapter) ? o.chapter : null,
  set: o.set === "first" || o.set === "last" ? o.set : "highlights",
  maps: o.maps !== false,
  tube: o.wavelength === "cobalt" || o.wavelength === "molybdenum" ? o.wavelength : "copper",
});

/** Kα1 lines, Å, for all three tubes (NIST X-ray transition energies, Deslattes et al. 2003). */
export const TUBES: Record<TubeId, { lambda: number; symbol: string }> = {
  copper: { lambda: 1.5406, symbol: "Cu" },
  cobalt: { lambda: 1.789, symbol: "Co" },
  molybdenum: { lambda: 0.7093, symbol: "Mo" },
};
export const TUBE_IDS: readonly TubeId[] = ["copper", "cobalt", "molybdenum"];

/** The colour code. */
export const COLOR = {
  beam: PALETTE.players[0]!,
  scattered: PALETTE.players[2]!,
  real: PALETTE.players[5]!,
  recip: PALETTE.players[4]!,
  /** Angles (θ, ω and the like), in no space of their own. */
  angle: PALETTE.players[3]!,
  /** The thing being explained right now: the extra path, the So line, the Maths button. */
  accent: PALETTE.accent,
  ink: "#eef2f8",
  muted: "#9aa6bd",
  faint: "#5b6680",
  panel: "rgba(12,18,32,0.88)",
  well: "#0a0f1b",
  edge: "rgba(150,175,220,0.26)",
  background: PALETTE.background,
} as const;

export const BACKGROUND =
  "radial-gradient(ellipse 120% 70% at 50% 0%, #101a30 0%, #080c18 55%, #05070d 100%)";

export const HZ = 60;

/** A person's touch on a card keeps bots and demos off that card this long. */
export const BOT_YIELD_MS = 30_000;
/** Attract: each chapter's turn in a relay, and the rest after a solo demo. */
export const TURN_MS = 12_000;
export const REST_MS = 10_000;
/** The screen's own run at the end of a bank relay. */
export const SCREEN_RUN_MS = 20_000;

/** Touch targets, venue px. */
export const MIN_TARGET = 120;
export const MIN_TARGET_WALL = 150;
/** On a pair, controls stay this share of the pair's width from the seam. */
export const SEAM_SHARE = 0.2;
