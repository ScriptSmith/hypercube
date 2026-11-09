/**
 * Light Bench. Lamps send beams across a dark bench; visitors place mirrors, filters, prisms,
 * lenses and splitters in sockets and turn them to light every crystal. On a bank the light
 * runs from panel to panel and up to crystals on the screen.
 *
 * - spectrum.ts  wavelengths, colour bands, glass; trace.ts the ray tracer; pieces.ts geometry
 * - layout.ts    sockets, trays and lamp spots; puzzle.ts puzzles and scenes; generate.ts making them
 * - bench.ts     one bench's pieces and touches; bots.ts bots and the attract hand
 * - chain.ts     a bank's chain of puzzles; link.ts light between frames; rounds.ts the bank's round
 * - wire.ts      bank messages; sky.ts the screen's crystals; draw.ts and view.ts drawing
 * - touch.ts     a touch frame; screen.ts the screen above a bank
 */
import type { AppContext, AppInstance } from "../../core/types";
import { readConfig } from "./config";
import { mountScreen } from "./screen";
import { mountTouch } from "./touch";

export const mount = (ctx: AppContext): AppInstance => {
  const cfg = readConfig(ctx.options, ctx.variant);
  if (ctx.frame.kind === "screen" || ctx.setup.role === "screen") return mountScreen(ctx, cfg);
  return mountTouch(ctx, cfg);
};
