import type { AppContext, AppInstance } from "../../core/types";
import { mountTransit } from "./app";

export const mount = (ctx: AppContext): AppInstance => mountTransit(ctx);
