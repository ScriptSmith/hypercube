/**
 * Pinball. Wires the pieces together:
 *
 * - config.ts     rules, options and the shared numbers
 * - physics.ts    the ball solver: walls, arcs, posts, bumpers, flippers, sensors
 * - layout.ts     the table as data; path.ts scripted motion along tubes
 * - table.ts      one table's game: balls, saves, scoring, deck shots, bonus balls
 * - bot.ts        bot players; pads.ts the touch pads
 * - tableframe.ts a touch frame: stations, input, bots, network; tableview.ts draws it
 * - deck.ts       the screen's upper deck; screen.ts runs it; deckview.ts draws it
 * - deckgeo.ts    the deck's layout on a screen; bandgeo.ts the same pieces in a band on a wall
 * - link.ts and wire.ts  messages between tables and the screen
 * - wall.ts       a wall: tables along the bottom and the deck above (wallgeo.ts), in one frame
 * - tablehud.ts   what the 2D and 3D table views share: the scene and the pads, score and HUD
 *
 * Themed variants (3D, with toys of their own in the middle of the playfield):
 *
 * - toys.ts and devices.ts  how a theme's toys plug into a table, and the devices they use
 * - themes/       one folder per theme: rules (index.ts) and look (look.ts), listed in
 *                 themes/index.ts and themes/looks.ts
 * - view3d/       the 3D table and deck views, the camera rule, the shared kit and plain parts
 */
import type { AppContext, AppInstance } from "../../core/types";
import { readConfig } from "./config";
import { mountScreen } from "./screen";
import { mountTables } from "./tableframe";
import { mountWall } from "./wall";

export const mount = (ctx: AppContext): AppInstance => {
  const cfg = readConfig(ctx.variant, ctx.options);
  if (ctx.setup.role === "screen" || ctx.frame.kind === "screen") return mountScreen(ctx, cfg);
  if (ctx.frame.kind === "wall") return mountWall(ctx, cfg);
  return mountTables(ctx, cfg);
};
