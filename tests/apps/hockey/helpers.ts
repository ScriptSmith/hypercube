import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { type GameConfig, MATCH_MS } from "../../../src/apps/hockey/config";
import type { LayoutInput } from "../../../src/apps/hockey/layout";
import type { FrameKind } from "../../../src/core/types";

const WALL = VENUE_SIZE.wall;

const SIZES: Record<string, [number, number, number, number]> = {
  panel: [1080, 1920, 0, 960],
  pair: [2160, 1920, 0, 960],
  kiosk: [1920, 1080, 0, 0],
  wall: [
    WALL.width,
    WALL.height,
    WALL.height * (1 - DEFAULT_REACH.wall.adult),
    WALL.height * (1 - DEFAULT_REACH.wall.child),
  ],
};

/** Layout input for a frame kind at venue size with the default reach. */
export const layoutInput = (kind: FrameKind, over: Partial<LayoutInput> = {}): LayoutInput => {
  const [width, height, adult, child] = SIZES[kind]!;
  return {
    kind,
    width,
    height,
    reachTop: { adult, child },
    seams: kind === "pair" ? [width / 2] : [],
    versus: false,
    side: 0,
    childLane: false,
    variant: "hockey",
    speed: 1,
    ...over,
  };
};

/** A game config with defaults, for tests. */
export const testConfig = (over: Partial<GameConfig> = {}): GameConfig => ({
  variant: "hockey",
  pucks: 2,
  speed: 1,
  target: 7,
  childLane: false,
  wall: "tables",
  players: 3,
  matchMs: MATCH_MS,
  ...over,
});
