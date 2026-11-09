/**
 * Unit Circle. A point turns round a circle of radius 1: its height is sin θ, its width cos θ,
 * and where the radius made longer meets the line x = 1, the height is tan θ. Unrolled to the
 * side, the heights trace the waves.
 *
 * - maths.ts     angles, exact values at the special angles, formatting, the slow turn
 * - angle.ts     one circle's angle: fingers, the wheel's coast, detents, returning to the turn
 * - controls.ts  fingers on the point, the ring, the wheel and the graph (layout.ts)
 * - walk.ts, show.ts  the walk-through's steps and what a frame shows
 * - draw.ts, text.ts  the picture, readout and captions
 * - frame.ts     a touch frame; screen.ts the screen; link.ts and wire.ts between them
 * - bots.ts      injected touches
 */
import type { AppContext, AppInstance } from "../../core/types";
import { mountFrame } from "./frame";
import { mountScreen } from "./screen";

export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "screen" || ctx.setup.role === "screen" ? mountScreen(ctx) : mountFrame(ctx);
