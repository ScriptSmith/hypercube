import type { AppContext, AppInstance } from "../../core/types";
import { mountScreen } from "./screen";
import { mountTouch } from "./touch";

/**
 * Gravity Sandbox: slingshots fling rocks, planets, gas giants and stars into a universe where
 * every massive body pulls every other. A bank's screen holds the universe for the frames below.
 */
export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "screen" || ctx.setup.role === "screen" ? mountScreen(ctx) : mountTouch(ctx);
