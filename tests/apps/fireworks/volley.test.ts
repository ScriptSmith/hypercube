import { describe, expect, it } from "vitest";
import type { LaunchRequest } from "../../../src/apps/fireworks/director";
import { SHAPE } from "../../../src/apps/fireworks/recipe";
import { bankSky } from "../../../src/apps/fireworks/sky";
import { cascadeNeeds, createVolleyTracker } from "../../../src/apps/fireworks/volley";
import { screenDirector, W } from "./helpers";

const sky = bankSky(W, 0);
const req = (pad: number, t0: number, seed = pad + 1): LaunchRequest => ({
  x: 540 + pad * 1080,
  y: -1530,
  angle: 0,
  v: sky.v,
  g: sky.g,
  t0,
  color: pad % 6,
  shape: SHAPE.peony,
  size: 0.5,
  seed,
  frame: `p${pad}`,
  pad: 0,
  exitU: 0.5,
  key: `p${pad}:0`,
});

describe("fireworks volleys", () => {
  it("counts distinct pads launching within a second, in any arrival order", () => {
    const v = createVolleyTracker();
    expect(v.add({ t: 1000, key: "a", shell: 1 })).toHaveLength(1);
    expect(v.add({ t: 1900, key: "b", shell: 2 })).toHaveLength(2);
    // A late arrival from before the others counts the ones within a second of its own time.
    expect(
      v
        .add({ t: 850, key: "c", shell: 3 })
        .map((l) => l.key)
        .sort(),
    ).toEqual(["a", "c"]);
    // The same pad twice counts once.
    expect(
      v
        .add({ t: 1950, key: "b", shell: 4 })
        .map((l) => l.key)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(v.add({ t: 5000, key: "d", shell: 5 })).toHaveLength(1);
  });

  it("asks for half the pads for a cascade, and never fewer than two", () => {
    expect(cascadeNeeds(10)).toBe(5);
    expect(cascadeNeeds(5)).toBe(3);
    expect(cascadeNeeds(2)).toBe(2);
    expect(cascadeNeeds(1)).toBe(2);
  });

  it("boosts three shells launched together and rings them once", () => {
    const { engine, director } = screenDirector();
    const shells = [0, 2, 4].map((p, i) => director.launch(req(p, 10_000 + i * 300)));
    for (const s of shells) {
      expect(s.boost).toBeGreaterThan(1);
      expect(s.volley).toBe(shells[0]!.volley);
    }
    const rings = engine.bursts.slots.filter((b) => b.live && b.shape === SHAPE.glitter);
    expect(rings).toHaveLength(1);
    // After every member has burst.
    expect(rings[0]!.t0).toBeGreaterThan(Math.max(...shells.map((s) => s.tb)));
    // A fourth joins: still one ring, moved to cover it.
    director.launch(req(5, 10_800));
    expect(engine.bursts.slots.filter((b) => b.live && b.shape === SHAPE.glitter)).toHaveLength(1);
  });

  it("leaves two shells alone", () => {
    const { engine, director } = screenDirector();
    const a = director.launch(req(0, 20_000));
    const b = director.launch(req(1, 20_500));
    expect(a.boost).toBe(1);
    expect(b.boost).toBe(1);
    expect(engine.bursts.live).toBe(0);
  });

  it("adds a cascade along the top when half the pads launch together, then rests", () => {
    const { engine, director } = screenDirector();
    for (let p = 0; p < 5; p++) director.launch(req(p, 30_000 + p * 150));
    const cascades = () => engine.bursts.slots.filter((b) => b.live && b.shape === SHAPE.cascade);
    expect(cascades().length).toBeGreaterThan(0);
    for (const c of cascades()) expect(c.y).toBeGreaterThan(sky.height * 0.85);
    const n = cascades().length;
    for (let p = 5; p < 10; p++) director.launch(req(p, 31_500 + p * 100));
    expect(cascades().length).toBe(n);
  });

  it("does nothing special with volleys turned off", () => {
    const { engine, director } = screenDirector(null, 0, null, { volley: false });
    const shells = [0, 1, 2, 3, 4, 5].map((p) => director.launch(req(p, 40_000 + p * 100)));
    expect(shells.every((s) => s.boost === 1)).toBe(true);
    expect(engine.bursts.live).toBe(0);
  });
});
