import type { AppContext, AppInstance } from "../../core/types";
import { mountBowl } from "./bowlapp";
import { mountWall } from "./wall";

/** The ball is a bowl seen from all round; a wall is the front glass of a tank. */
export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "wall" ? mountWall(ctx) : mountBowl(ctx);
