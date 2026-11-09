import { describe, expect, it } from "vitest";
import { type Config, PAD_COOLDOWN_MS, readConfig } from "../../../src/apps/fireworks/config";
import { createPads, type LaunchIntent } from "../../../src/apps/fireworks/pad";
import { aimKnob, layoutPads, type PadFrame } from "../../../src/apps/fireworks/pads";
import { COLOR_CHOICES, isPictogram, padShapes, SHAPE } from "../../../src/apps/fireworks/recipe";
import { createRng } from "../../../src/core/rng";

const panel: PadFrame = { kind: "panel", width: 1080, height: 1920, span: 1 };

const setup = (config: Config = readConfig("build", {}), flight = 0) => {
  const layouts = layoutPads(panel, config);
  let t = 10_000;
  const launched: LaunchIntent[] = [];
  const pads = createPads({
    layouts,
    config,
    globalPad: (i) => i + 2,
    now: () => t,
    rng: createRng("pads"),
    narrow: true,
    launch: (i) => {
      launched.push(i);
      return flight;
    },
  });
  const p = layouts[0]!;
  const tube = { x: p.tube.x, y: p.tube.base - p.tube.length * 0.4 };
  let id = 1;
  const tap = (x: number, y: number) => {
    const n = id++;
    pads.down(n, x, y, false);
    pads.up(n, x, y);
  };
  const drag = (pts: { x: number; y: number }[]) => {
    const n = id++;
    pads.down(n, pts[0]!.x, pts[0]!.y, false);
    for (const q of pts.slice(1)) pads.move(n, q.x, q.y);
    const last = pts.at(-1)!;
    pads.up(n, last.x, last.y);
  };
  return {
    pads,
    p,
    tube,
    tap,
    drag,
    launched,
    advance: (ms: number) => {
      t += ms;
    },
  };
};

describe("fireworks pads", () => {
  it("launches on a tap of the tube, with the pad's own colour to start", () => {
    const s = setup();
    s.tap(s.tube.x, s.tube.y);
    expect(s.launched).toHaveLength(1);
    expect(s.launched[0]).toMatchObject({
      pad: 0,
      angle: 0,
      recipe: { color: 2, shape: SHAPE.peony },
    });
  });

  it("allows one launch per 1.2 s and one shell in flight per pad", () => {
    const s = setup(readConfig("build", {}), 3000);
    s.tap(s.tube.x, s.tube.y);
    s.advance(500);
    s.tap(s.tube.x, s.tube.y);
    expect(s.launched).toHaveLength(1);
    expect(s.pads.looks()[0]!.refusedAt).toBeGreaterThan(0);
    s.advance(PAD_COOLDOWN_MS);
    s.tap(s.tube.x, s.tube.y);
    expect(s.launched).toHaveLength(1);
    // The screen's echo says it burst: free to go again.
    s.pads.landed(0);
    s.tap(s.tube.x, s.tube.y);
    expect(s.launched).toHaveLength(2);
  });

  it("launches as soon as a swipe up from the tube goes far enough", () => {
    const s = setup();
    const n = 99;
    s.pads.down(n, s.tube.x, s.tube.y, false);
    s.pads.move(n, s.tube.x, s.tube.y - 40);
    expect(s.launched).toHaveLength(0);
    s.pads.move(n, s.tube.x + 10, s.tube.y - 120);
    expect(s.launched).toHaveLength(1);
    s.pads.up(n, s.tube.x, s.tube.y - 300);
    expect(s.launched).toHaveLength(1);
  });

  it("cycles colour, shape and size on their buttons", () => {
    const s = setup();
    const c = s.p.color!;
    for (let i = 0; i < COLOR_CHOICES; i++) s.tap(c.x, c.y);
    expect(s.pads.looks()[0]!.recipe.color).toBe(2);
    s.tap(c.x, c.y);
    expect(s.pads.looks()[0]!.recipe.color).toBe(3);
    const shapes = padShapes(true);
    for (let i = 0; i < shapes.length - 1; i++) s.tap(s.p.shape!.x, s.p.shape!.y);
    expect(s.pads.looks()[0]!.recipe.shape).toBe(shapes.at(-1));
    expect(isPictogram(shapes.at(-1)!)).toBe(true);
    s.tap(s.p.size!.x, s.p.size!.y);
    expect(s.pads.looks()[0]!.recipe.size).toBe(1);
    s.tap(s.tube.x, s.tube.y);
    expect(s.launched[0]!.recipe).toEqual({ color: 3, shape: shapes.at(-1), size: 1 });
  });

  it("offers no pictograms when they're turned off", () => {
    const s = setup(readConfig("build", { pictograms: false }));
    const seen = new Set<number>();
    for (let i = 0; i < 12; i++) {
      s.tap(s.p.shape!.x, s.p.shape!.y);
      seen.add(s.pads.looks()[0]!.recipe.shape);
    }
    expect([...seen].some(isPictogram)).toBe(false);
  });

  it("tilts the tube with the aim handle, and eases back upright when left alone", () => {
    const s = setup();
    const a = s.p.aim!;
    const from = aimKnob(a, 0);
    const to = aimKnob(a, 0.25);
    s.drag([from, to]);
    expect(s.pads.looks()[0]!.angle).toBeCloseTo(0.25, 6);
    s.tap(s.tube.x, s.tube.y);
    expect(s.launched[0]!.angle).toBeCloseTo(0.25, 6);
    s.advance(25_000);
    for (let i = 0; i < 200; i++) s.pads.looks();
    expect(s.pads.looks()[0]!.angle).toBe(0);
  });

  it("goes back to the pad's starting recipe after a minute untouched, or on reset", () => {
    const s = setup();
    s.tap(s.p.color!.x, s.p.color!.y);
    expect(s.pads.looks()[0]!.recipe.color).toBe(3);
    s.advance(61_000);
    expect(s.pads.looks()[0]!.recipe.color).toBe(2);
    s.tap(s.p.color!.x, s.p.color!.y);
    s.pads.resetPad(0);
    expect(s.pads.looks()[0]!.recipe.color).toBe(2);
  });

  it("flicks: aims and sizes by the drag, and a tap on the tube sends a small one up", () => {
    const s = setup(readConfig("flick", {}));
    s.drag([
      { x: 540, y: 1800 },
      { x: 600, y: 1500 },
      { x: 700, y: 1100 },
    ]);
    expect(s.launched).toHaveLength(1);
    const f = s.launched[0]!;
    expect(f.angle).toBeGreaterThan(0.1);
    expect(f.recipe.size).toBeGreaterThan(0.5);
    // Flick shells are the pad's colour.
    expect(f.recipe.color).toBe(2);
    s.advance(PAD_COOLDOWN_MS + 10);
    s.tap(s.tube.x, s.tube.y);
    expect(s.launched).toHaveLength(2);
    expect(s.launched[1]!.angle).toBe(0);
    expect(s.launched[1]!.recipe.size).toBeLessThan(0.3);
    // Downwards is not a flick.
    s.advance(PAD_COOLDOWN_MS + 10);
    s.drag([
      { x: 540, y: 1200 },
      { x: 540, y: 1700 },
    ]);
    expect(s.launched).toHaveLength(2);
  });

  it("picks shape and size for colour-only recipes", () => {
    const s = setup(readConfig("build", { recipe: "colour" }));
    const shapes = new Set<number>();
    for (let i = 0; i < 30; i++) {
      s.tap(s.tube.x, s.tube.y);
      s.advance(PAD_COOLDOWN_MS + 1);
    }
    for (const l of s.launched) shapes.add(l.recipe.shape);
    expect(shapes.size).toBeGreaterThan(2);
  });
});
