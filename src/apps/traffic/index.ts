/**
 * Traffic. A one-lane ring road where cars follow each other as drivers do; touch a car and
 * it brakes, and the jam it starts travels backwards long after it has moved on. A time-space
 * diagram above the road draws every car's path, so jams show as stripes slanting back.
 *
 * - model.ts    the ring: the Intelligent Driver Model with lag and noise, smart cars
 * - driver.ts   a ring run in step with the shared clock; config.ts options and timings
 * - layout.ts   roads, diagrams and controls on each kind of frame
 * - diagram.ts  the time-space diagram; art.ts and scene.ts drawing
 * - touch.ts    a touch frame (its own ring, or a stretch of a bank's); screen.ts the screen
 * - link.ts, feed.ts, wire.ts   the bank: one host runs the ring and streams it to the rest
 * - versus.ts   two walls with identical rings throwing slowdowns at each other
 * - bots.ts     injected touches
 */
import type { AppContext, AppInstance } from "../../core/types";
import { readConfig } from "./config";
import { mountScreen } from "./screen";
import { mountTouch } from "./touch";
import { mountVersus } from "./versus";

export const mount = (ctx: AppContext): AppInstance => {
  const cfg = readConfig(ctx.options);
  if (ctx.setup.role === "screen" || ctx.frame.kind === "screen") return mountScreen(ctx, cfg);
  if (ctx.setup.name === "versus") return mountVersus(ctx, cfg);
  return mountTouch(ctx, cfg);
};
