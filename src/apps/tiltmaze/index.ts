/**
 * Tilt Maze. Wires the pieces together:
 *
 * - maze.ts      our own maze generator; physics.ts the rolling ball; board.ts one board's story
 * - pilot.ts     the autopilot (demonstration, bots, a lever nobody holds); bots.ts its fingers
 * - layout.ts    where boards, pads and the run go; controls.ts touches on pads and levers
 * - boardcam.ts  each board's fixed camera; boardview.ts its 3D scene; overlay.ts the pads
 * - runplan.ts   the marble run's shape; run.ts its balls; runview.ts its 3D scene
 * - glass.ts     glass coordinates, so a bank's tubes carry on up into the screen (view3d)
 * - frame.ts     a touch frame; screen.ts the screen; wire.ts and link.ts the bank's messages
 */
import type { AppContext, AppInstance } from "../../core/types";
import { mountFrame } from "./frame";
import { mountScreen } from "./screen";

export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "screen" || ctx.setup.role === "screen" ? mountScreen(ctx) : mountFrame(ctx);
