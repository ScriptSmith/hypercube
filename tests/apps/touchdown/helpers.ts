import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { type Config, readConfig, type Variant } from "../../../src/apps/touchdown/config";
import { createCrew, type Crew, type CrewEvent } from "../../../src/apps/touchdown/crew";
import { type Layout, layoutFor, type LayoutInput } from "../../../src/apps/touchdown/layout";
import { createRng } from "../../../src/core/rng";
import type { FrameKind } from "../../../src/core/types";

export const DT = 1 / 120;

/** Venue size and default reach tops (adult, child) per kind. */
const SIZES: Record<string, [number, number, number, number]> = Object.fromEntries(
  (["panel", "pair", "kiosk", "wall"] as const).map((kind) => {
    const { width, height } = VENUE_SIZE[kind];
    const reach = DEFAULT_REACH[kind];
    return [kind, [width, height, height * (1 - reach.adult), height * (1 - reach.child)]];
  }),
);

export const KINDS: FrameKind[] = ["panel", "pair", "kiosk", "wall"];

export const layoutInput = (
  kind: FrameKind,
  variant: Variant = "duo",
  over: Partial<LayoutInput> = {},
): LayoutInput => {
  const [width, height, adult, child] = SIZES[kind]!;
  return {
    kind,
    width,
    height,
    reachTop: { adult, child },
    seams: kind === "pair" ? [width / 2] : [],
    variant,
    crews: kind === "wall" ? 3 : 1,
    ...over,
  };
};

export const layoutOf = (kind: FrameKind, variant: Variant = "duo", crews?: number): Layout =>
  layoutFor(layoutInput(kind, variant, crews === undefined ? {} : { crews }));

export const config = (variant: Variant = "duo", over: Partial<Config> = {}): Config => ({
  ...readConfig(variant, {}),
  ...over,
});

export interface TestCrew {
  crew: Crew;
  layout: Layout;
  events: CrewEvent[];
}

export const crewOf = (
  kind: FrameKind = "pair",
  variant: Variant = "duo",
  over: Partial<Config> = {},
  seed = "test",
): TestCrew => {
  const layout = layoutOf(kind, variant);
  const events: CrewEvent[] = [];
  const crew = createCrew({
    spec: layout.crews[0]!,
    layout,
    config: config(variant, over),
    rng: createRng(seed),
    events,
  });
  return { crew, layout, events };
};

/** Step a crew for `seconds`, with `now` in ms advancing alongside; returns the final `now`. */
export const run = (
  crew: Crew,
  seconds: number,
  start = 0,
  each?: (now: number, t: number) => void,
): number => {
  let now = start;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    each?.(now, i * DT);
    crew.step(DT, now);
    now += DT * 1000;
  }
  return now;
};

/** Step until the run is no longer flying (or `max` seconds pass); returns seconds taken. */
export const flyUntilContact = (crew: Crew, start = 0, max = 120): number => {
  let t = 0;
  let now = start;
  while (crew.phase === "flying" && t < max) {
    crew.step(DT, now);
    now += DT * 1000;
    t += DT;
  }
  return t;
};
