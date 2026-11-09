/**
 * Treetop Race. Wires the pieces together:
 *
 * - config.ts   rules, options and the shared numbers
 * - course.ts   the seeded course; race.ts the race cadence on the shared clock
 * - flight.ts   a glider's physics; pilot.ts bot pilots; ghost.ts the solo panel's ghost runs
 * - wire.ts     bank messages; board.ts what a frame knows about the race, and the leader's job
 * - placing.ts  placings
 * - panel.ts    a touch frame: lanes, stations, input; lanes.ts drawing them; layout.ts where
 *               lanes go
 * - screen.ts   the screen above a bank: progress columns and the pack view (packcam.ts)
 * - wall.ts     a wall: the bank and its screen in one frame over an in-frame bus (localbus.ts),
 *               with the race shown above the lanes (overview.ts)
 * - art.ts      the sprite atlas; gl.ts the sprite batcher; scene.ts drawing a view of the course
 */
import type { AppContext, AppInstance } from "../../core/types";
import { readConfig } from "./config";
import { mountPanel } from "./panel";
import { mountScreen } from "./screen";
import { mountWall } from "./wall";

export const mount = (ctx: AppContext): AppInstance => {
  const cfg = readConfig(ctx.variant, ctx.options);
  if (ctx.setup.role === "screen" || ctx.frame.kind === "screen") return mountScreen(ctx, cfg);
  if (ctx.frame.kind === "wall") return mountWall(ctx, cfg);
  return mountPanel(ctx, cfg);
};
