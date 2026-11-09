/**
 * X-Ray Diffraction: an interactive poster in eleven chapters on how X-rays show us the atoms
 * inside a crystal.
 *
 * - ids.ts, captions.ts   the chapters, and every word a visitor reads
 * - chapter.ts            the chapter contract; chapters/<id>/ each chapter
 * - card.ts, layout.ts    the poster shell and where everything goes; controls.ts the controls kit
 * - formula.ts            linked formulas; hand.ts the ghost hand; draw.ts canvas helpers
 * - engine/               the diffraction engine (FFT of flat models, in a worker)
 * - crystals.ts, machine.ts  crystal data and the diffractometer's geometry
 * - layer3d.ts            the frame's one 3D renderer; maps.ts the simulated maps
 * - frame.ts, screen.ts   a touch frame and a screen; banner.ts the machine drawn flat
 * - shares.ts, relay.ts   which chapters a bank frame shows, and the attract schedules
 * - wire.ts, link.ts      messages between a bank and its screen; perform.ts demos and bots
 */
import type { AppContext, AppInstance } from "../../core/types";
import { mountFrame } from "./frame";
import { mountScreen } from "./screen";

export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "screen" || ctx.setup.role === "screen" ? mountScreen(ctx) : mountFrame(ctx);
