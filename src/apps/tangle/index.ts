/**
 * Tangle. Glowing lines steered at constant speed; touch a trail and you stop. Edges wrap
 * round to the opposite side unless they are set solid. `snake` and `grid` play by snake rules,
 * `grid` on a lane grid with four direction pads.
 *
 * - config.ts    options and timings
 * - arena.ts     the simulation (grid.ts holds the occupancy grid, wrap.ts the wrapping
 *                geometry), bot.ts the bots
 * - match.ts     lobby, countdown, rounds and placings, for any arena
 * - layout.ts    stations and pads on a touch frame; slots.ts where lines start
 * - seating.ts   platform stations, pads.ts the turn and direction pads
 * - game.ts      an arena played on the touch frame itself
 * - touch.ts     a touch frame: playing alone, or a bank's steering pad (link.ts)
 * - screen.ts    a bank's screen, which holds the arena; protocol.ts its messages
 * - view.ts      drawing an arena (glview.ts WebGL2, particles.ts sparks); deck.ts the pads
 */
import type { AppContext, AppInstance } from "../../core/types";
import { readConfig } from "./config";
import { mountScreen } from "./screen";
import { mountTouch } from "./touch";

export const mount = (ctx: AppContext): AppInstance => {
  const cfg = readConfig(ctx.variant, ctx.options);
  if (ctx.setup.role === "screen" || ctx.frame.kind === "screen") return mountScreen(ctx, cfg);
  return mountTouch(ctx, cfg);
};
