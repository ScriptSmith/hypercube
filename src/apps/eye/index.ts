/**
 * Eye Lab. A cut-away eye in 3D: change its length, its cornea, its age and the light, see where
 * light focuses and how a scene looks through it, tap its parts, and see how conditions show up.
 *
 * - optics.ts    the schematic eye (Le Grand, Navarro, Anderson, Watson and Yellott)
 * - model.ts     one eye's state and what follows from it; kernel.ts, effects.ts blur and effects
 * - captions.ts  every factual sentence a visitor can read, each with its published source
 * - text.ts      which captions show; tour.ts the attract tour
 * - anatomy.ts, eye3d.ts  the 3D eye; scene.ts, sight.ts the simulated views
 * - layout.ts, controls.ts, ui.ts  where things go, touches, the DOM
 * - frame.ts     a touch frame; screen.ts the screen; link.ts and wire.ts between them
 * - bots.ts      injected touches
 */
import type { AppContext, AppInstance } from "../../core/types";
import { mountFrame } from "./frame";
import { mountScreen } from "./screen";

export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "screen" || ctx.setup.role === "screen" ? mountScreen(ctx) : mountFrame(ctx);
