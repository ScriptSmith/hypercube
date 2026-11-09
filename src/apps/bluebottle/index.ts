/**
 * Bluebottle Beach. Visitors dig a long strip of sand together; each dug cell shows how many
 * bluebottles are next to it, a hold plants a flag, and a sting only blows sand back over.
 * Every patch can be cleared by reasoning alone, and a crab helps whenever it can't.
 *
 * - board.ts     grid, specs and patch identity; generate.ts the no-guess generator
 * - solver.ts    the logic solver, shared by the generator, the crabs and the bots
 * - patch.ts     one patch: its event log, replayed in order; crab.ts where crabs dig
 * - shore.ts     the patch in play and, in a bank, how the frames agree on it (protocol.ts)
 * - touch.ts     a touch frame; screen.ts the screen above a bank
 * - view.ts      the sand cells; sky.ts the sea and the HUD; art.ts the drawings
 * - layout.ts    where everything goes; bots.ts the bots and the attract digger
 */
import type { AppContext, AppInstance } from "../../core/types";
import { readConfig } from "./config";
import { mountScreen } from "./screen";
import { mountTouch } from "./touch";

export const mount = (ctx: AppContext): AppInstance => {
  const cfg = readConfig(ctx.options);
  const bank = ctx.setup.name === "bank";
  if (ctx.frame.kind === "screen" || ctx.setup.role === "screen")
    return mountScreen(ctx, cfg, bank);
  return mountTouch(ctx, cfg, bank);
};
