import type { Box, Geometry, WorldConfig } from "./config";
import type { WorldSpec } from "./gpu/sim";
import { type Island, islandFor, type WeatherSpec } from "./weather";

/** Everything about the world that follows from the frame, the options and a seed. */
export interface Scene {
  world: WorldSpec;
  weather: WeatherSpec;
  /** Delta sea edge in cells: columns x0 to x1 hold the sea at `level`. */
  sea: { x0: number; x1: number; level: number } | null;
  plantScale: number;
  condenseY: number;
  evaporation: number;
  erosion: number;
  /** The floor lets everything through (the screen above a bank has an open bottom). */
  openFloor: boolean;
  /** Where pieces and gadgets may go, in venue px. */
  bounds: Box;
}

/** Three islands across the screen above a bank; the middle one has the volcano. */
const skyIslands = (W: number, H: number): Island[] =>
  [
    [0.18, 0.5, 0.09, false],
    [0.5, 0.62, 0.12, true],
    [0.82, 0.46, 0.08, false],
  ].map(([fx, fy, fw, volcano]) => {
    const hw = Math.round(W * (fw as number));
    const hh = Math.max(4, Math.round(H * 0.045));
    return {
      cx: Math.round(W * (fx as number)),
      cy: Math.round(H * (fy as number)),
      hw,
      hh,
      cone: volcano
        ? [
            Math.round(hw * 0.1),
            Math.round(hw * 0.4),
            Math.round(hh * 1.7),
            Math.max(2, Math.round(hw * 0.05)),
          ]
        : [0, 1, 0, 0],
    };
  });

export const buildScene = (
  config: WorldConfig,
  g: Geometry,
  seed: number,
  rand: () => number,
): Scene => {
  const W = g.gridW;
  const H = g.gridH;
  const plantScale = Math.min(1.8, Math.max(0.5, H / 500));
  const delta = config.variant === "delta";
  const wall = config.kind === "wall";
  const screen = config.kind === "screen";
  const islands = screen
    ? skyIslands(W, H)
    : wall && !delta && config.weather
      ? [islandFor(W, H)]
      : [];

  let terrain: [number, number, number, number];
  let sea: Scene["sea"] = null;
  let spring: WeatherSpec["spring"] = null;
  if (delta && !screen) {
    const cliffX = W * 0.2;
    const cliffH = H * (wall ? 0.48 : 0.42);
    const level = H * 0.14;
    terrain = [cliffX, cliffH, W * 0.7, level];
    sea = { x0: W - 6, x1: W, level };
    // Above the cliff's five-cell sand cap, a little in from the edge.
    spring = { x: cliffX - Math.max(4, W * 0.02), y: cliffH + 5 + Math.max(2, 24 / g.cell) };
  } else {
    terrain = [H * 0.075, H * 0.05, W * (0.3 + rand() * 0.4), W * 0.085];
  }

  const world: WorldSpec = {
    variant: screen ? "sky" : config.variant,
    seed,
    islands: islands.map((i) => ({ at: [i.cx, i.cy, i.hw, i.hh], cone: i.cone })),
    terrain,
    plantScale,
  };

  const clouds = wall ? 5 : screen ? 5 : config.kind === "pair" ? 3 : 2;
  const size: [number, number] = (
    wall || screen ? [0.042, 0.079] : config.kind === "pair" ? [0.1, 0.18] : [0.14, 0.23]
  ).map((f) => f * W) as [number, number];
  const weather: WeatherSpec = {
    gridW: W,
    gridH: H,
    cell: g.cell,
    cloudBand: wall ? [0.82, 0.92] : [0.86, 0.93],
    clouds,
    cloudSize: size,
    volcano: islands.find((i) => i.cone[2] > 0) ?? null,
    spring,
    sky: config.weather || screen,
  };

  return {
    world,
    weather,
    sea,
    plantScale,
    condenseY: H * 0.72,
    evaporation: delta ? 0.00006 : 0.00012,
    erosion: delta ? 0.003 : 0,
    openFloor: screen,
    bounds: { x: 0, y: 0, width: g.width, height: g.height },
  };
};
