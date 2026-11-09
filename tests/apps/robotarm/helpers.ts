import { benchFor } from "../../../src/apps/robotarm/bench";
import { type Cell, createCell } from "../../../src/apps/robotarm/cell";
import { type Config, readConfig, type Variant } from "../../../src/apps/robotarm/config";
import { createControls } from "../../../src/apps/robotarm/controls";
import { createDirectHand, createDriver, type Driver } from "../../../src/apps/robotarm/driver";
import { type Layout, layoutFor, type LayoutInput } from "../../../src/apps/robotarm/layout";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { createRng } from "../../../src/core/rng";
import type { FrameKind } from "../../../src/core/types";

export const DT = 1 / 60;

export const KINDS: FrameKind[] = ["panel", "pair", "kiosk", "wall"];

/** The default venue's size and reach for each kind. */
export const layoutInput = (kind: FrameKind, over: Partial<LayoutInput> = {}): LayoutInput => {
  const { width, height } = VENUE_SIZE[kind];
  const reach = DEFAULT_REACH[kind];
  return {
    kind,
    width,
    height,
    reachTop: { adult: height * (1 - reach.adult), child: height * (1 - reach.child) },
    seams: kind === "pair" ? [width / 2] : [],
    arms: kind === "wall" ? 2 : 1,
    ...over,
  };
};

export const layoutOf = (kind: FrameKind, arms?: number): Layout =>
  layoutFor(layoutInput(kind, arms === undefined ? {} : { arms }));

export const cellOf = (
  variant: Variant = "tidy",
  seed = "test",
  over: Partial<Config> = {},
  lift = false,
): Cell =>
  createCell({
    index: 0,
    bench: benchFor(variant, lift),
    config: { ...readConfig(variant, {}), ...over },
    rng: createRng(seed),
  });

export interface Rig {
  cell: Cell;
  layout: Layout;
  driver: Driver;
  time: () => number;
  run(seconds: number, each?: () => void): void;
}

/** One arm on a panel, driven by the autopilot through the controls, as bots drive it. */
export const rig = (
  variant: Variant = "tidy",
  seed = "test",
  opts: {
    kind?: FrameKind;
    restAtHome?: boolean;
    speed?: "normal" | "slow";
    lift?: boolean;
    liftEvery?: number;
  } = {},
): Rig => {
  const cell = cellOf(variant, seed, opts.speed ? { speed: opts.speed } : {}, opts.lift ?? false);
  const layout = layoutOf(opts.kind ?? "panel", 1);
  const controls = createControls([cell], layout);
  let ms = 0;
  const now = () => ms;
  const driver = createDriver({
    cell,
    layout: () => layout.cells[0],
    hand: createDirectHand(controls, "bot", now),
    rng: createRng(`${seed}:driver`),
    speed: opts.speed === "slow" ? 0.6 : 1,
    restAtHome: opts.restAtHome ?? false,
    liftEvery: opts.liftEvery ?? 1,
  });
  return {
    cell,
    layout,
    driver,
    time: now,
    run(seconds, each) {
      const n = Math.round(seconds / DT);
      for (let i = 0; i < n; i++) {
        ms += DT * 1000;
        driver.update(DT);
        cell.step(DT);
        each?.();
      }
    },
  };
};
