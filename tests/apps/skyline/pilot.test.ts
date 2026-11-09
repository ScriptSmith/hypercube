import { describe, expect, it } from "vitest";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { Variant } from "../../../src/apps/skyline/config";
import { createCrane, type World } from "../../../src/apps/skyline/crane";
import { layoutFor, screenLayout } from "../../../src/apps/skyline/layout";
import { createPilot, profile } from "../../../src/apps/skyline/pilot";
import { createRng } from "../../../src/core/rng";
import { DT, rig } from "./helpers";

/** The default wall, with the tops of adult and child reach on it. */
const WALL = {
  width: VENUE_SIZE.wall.width,
  height: VENUE_SIZE.wall.height,
  reachTop: {
    adult: VENUE_SIZE.wall.height * (1 - DEFAULT_REACH.wall.adult),
    child: VENUE_SIZE.wall.height * (1 - DEFAULT_REACH.wall.child),
  },
};
const SCREEN = VENUE_SIZE.screen;

/** Run a crane on its autopilot (or a bot's sloppy one) with blocks arriving as fast as they fit. */
const run = (
  o: {
    seed: string;
    world?: World;
    variant?: Variant;
    assist?: boolean;
    wind?: boolean;
    sloppy?: boolean;
  },
  seconds: number,
  until: (c: ReturnType<typeof createCrane>) => boolean,
) => {
  const crane = o.world
    ? createCrane({
        world: o.world,
        variant: o.variant ?? "build",
        assist: o.assist ?? true,
        wind: o.wind ?? false,
        rng: createRng(o.seed),
        prebuilt: false,
      })
    : rig(o.seed, o).crane;
  const pilot = createPilot({
    rng: createRng(`${o.seed}:p`),
    sloppy: o.sloppy,
    hand: {
      aim: (x, y) => crane.setTargetNorm(x, y),
      release: () => crane.release(),
      rest: () => {},
    },
  });
  const feed = createRng(`${o.seed}:feed`);
  let t = 0;
  for (; t < seconds && !until(crane); t += DT) {
    if (crane.canRequest()) crane.request(feed.next() < 0.15 ? 3 : feed.int(3));
    pilot.update(DT, crane.readout());
    crane.step(DT);
    crane.events.length = 0;
  }
  return { crane, pilot, t };
};

const finished = (n: number) => (c: ReturnType<typeof createCrane>) => c.counts.finished >= n;

describe("skyline autopilot", () => {
  it("finishes a building on every seed, with or without the assist, in wind", () => {
    for (let i = 0; i < 8; i++) {
      const seed = `auto-${i}`;
      const assist = i % 2 === 0;
      const { crane, pilot, t } = run({ seed, assist, wind: i % 3 === 0 }, 600, finished(1));
      expect(crane.counts.finished, `${seed} assist ${assist}`).toBeGreaterThanOrEqual(1);
      // Blocks average under 18 s each with the assist, and not much longer without it.
      expect(t / Math.max(1, crane.counts.placed), seed).toBeLessThan(assist ? 18 : 25);
      // It only lets go away from a slot to put back a roof that fits nowhere yet.
      expect(crane.counts.dropped, seed).toBeLessThanOrEqual(pilot.stats.parks);
    }
  });

  it("keeps building as a sloppy bot, its early drops finding their way back", () => {
    const { crane, pilot } = run({ seed: "sloppy", sloppy: true }, 900, finished(2));
    expect(crane.counts.finished).toBeGreaterThanOrEqual(2);
    expect(pilot.stats.early + crane.counts.dropped).toBeGreaterThanOrEqual(0);
  });

  it("builds in every layout's world, solo and on a bank's screen", () => {
    const worlds: { name: string; world: World }[] = [];
    const kinds = [
      { kind: "panel", width: 1080, height: 1920, reachTop: { adult: 0, child: 1056 }, seams: [] },
      {
        kind: "pair",
        width: 2160,
        height: 1920,
        reachTop: { adult: 0, child: 1056 },
        seams: [1080],
      },
      {
        kind: "wall",
        ...WALL,
        seams: [],
      },
      { kind: "kiosk", width: 1920, height: 1080, reachTop: { adult: 0, child: 0 }, seams: [] },
    ] as const;
    for (const k of kinds) {
      for (const cranes of k.kind === "wall" ? [2, 3] : [1]) {
        const l = layoutFor({ ...k, seams: [...k.seams], cranes, variant: "build" });
        l.cranes.forEach((c, i) =>
          worlds.push({ name: `${k.kind}${cranes} ${i}`, world: c.world }),
        );
      }
    }
    for (const n of [6, 4]) {
      const cols = Array.from({ length: n }, (_, i) => ({
        pos: i,
        crane: 0,
        from: i / n,
        width: 1 / n,
        liftAt: 0.9,
        mast: "left" as const,
      }));
      worlds.push({
        name: `screen${n}`,
        world: screenLayout(SCREEN.width, SCREEN.height, cols, "build").cranes[0]!.world,
      });
    }
    for (const { name, world } of worlds) {
      const { crane } = run({ seed: name, world }, 900, finished(1));
      expect(crane.counts.finished, name).toBeGreaterThanOrEqual(1);
    }
  });

  it("stacks a tall tower in every layout's world", () => {
    const tall = layoutFor({
      kind: "wall",
      ...WALL,
      seams: [],
      cranes: 3,
      variant: "tall",
    });
    const panel = layoutFor({
      kind: "panel",
      width: 1080,
      height: 1920,
      reachTop: { adult: 0, child: 1056 },
      seams: [],
      cranes: 1,
      variant: "tall",
    });
    const cols = Array.from({ length: 6 }, (_, i) => ({
      pos: i,
      crane: 0,
      from: i / 6,
      width: 1 / 6,
      liftAt: 0.9,
      mast: "left" as const,
    }));
    const screen = screenLayout(SCREEN.width, SCREEN.height, cols, "tall");
    for (const [name, world] of [
      ["wall", tall.cranes[1]!.world],
      ["panel", panel.cranes[0]!.world],
      ["screen", screen.cranes[3]!.world],
    ] as const) {
      const { crane } = run(
        { seed: name, world, variant: "tall" },
        900,
        (c) => (c.tower?.blocks.length ?? 0) >= 8,
      );
      expect(crane.tower!.blocks.length, name).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("skyline move profile", () => {
  it("ends where it should, within its limits", () => {
    for (const d of [0.05, -0.3, 0.9]) {
      const p = profile(d, 0.4, 0.5);
      expect(p.at(p.total)).toBeCloseTo(d, 9);
      expect(p.at(0)).toBe(0);
      let maxV = 0;
      for (let t = 0; t < p.total; t += 0.01)
        maxV = Math.max(maxV, Math.abs(p.at(t + 0.01) - p.at(t)) / 0.01);
      expect(maxV).toBeLessThanOrEqual(0.4 + 1e-6);
    }
  });
});
