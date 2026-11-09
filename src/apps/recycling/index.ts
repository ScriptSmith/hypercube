/**
 * Recycling Rush. Mixed rubbish tumbles out of a plant onto belts; visitors pick items up and
 * throw or drop them into the right bin. Full bins rise to the plant and become things in a park.
 *
 * - items.ts    what goes in which bin, with a reason per item (the rules to review)
 * - layout.ts   where the lines, belts, tubes and bins go on each kind of frame
 * - world.ts    a frame's items, belts and bins; physics.ts the motion shared with the screen
 * - frame.ts    a touch frame: its own plant when alone, fed by the screen in a bank
 * - plant.ts    the screen's model: drops, full bins rising, the park; screen.ts draws it
 * - render.ts   drawing a touch frame; pictures.ts our own pictures
 * - bots.ts     injected touches; ghost.ts the attract mode's hand
 */
import type { AppContext, AppInstance } from "../../core/types";
import { mountFrame } from "./frame";
import { mountScreen } from "./screen";

export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "screen" || ctx.setup.role === "screen" ? mountScreen(ctx) : mountFrame(ctx);
