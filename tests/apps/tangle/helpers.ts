import { type Arena, arenaParams, createArena, type Start } from "../../../src/apps/tangle/arena";
import type { Config } from "../../../src/apps/tangle/config";
import { createRng } from "../../../src/core/rng";

export const testConfig = (over: Partial<Config> = {}): Config => ({
  variant: "trails",
  speed: "normal",
  roundMs: 60_000,
  gaps: false,
  trail: "round",
  edges: "solid",
  fill: 2,
  wallStations: 8,
  perFrame: 1,
  ...over,
});

/**
 * A wall-sized arena: full-size lines (16 wide, 320 per second, radius 100); grid snakes 24 wide
 * on lanes of 48.
 */
export const wallArena = (over: Partial<Parameters<typeof createArena>[0]> = {}): Arena =>
  createArena({
    width: 6400,
    height: 1800,
    params: arenaParams(6400, 1800, over.variant),
    variant: "trails",
    gaps: false,
    trail: "round",
    edges: "solid",
    rng: createRng("test"),
    ...over,
  });

export const up = (x: number, y: number): Start => ({ x, y, heading: -Math.PI / 2 });
export const right = (x: number, y: number): Start => ({ x, y, heading: 0 });
export const left = (x: number, y: number): Start => ({ x, y, heading: Math.PI });
export const down = (x: number, y: number): Start => ({ x, y, heading: Math.PI / 2 });

/** Step until `done` or `max` ticks; returns the ticks taken. */
export const run = (arena: Arena, max: number, done: () => boolean = () => false): number => {
  for (let i = 1; i <= max; i++) {
    arena.step();
    if (done()) return i;
  }
  return max;
};
