import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import { createEddies, emptyFlow, flowAt, type Stir } from "../../../src/apps/snowglobe/flow";
import { createMaterials } from "../../../src/apps/snowglobe/kit";
import { FOOT_Y, GLASS_MARGIN, R, RIM_Y } from "../../../src/apps/snowglobe/mound";
import { SCENE_MAKERS } from "../../../src/apps/snowglobe/scenes";
import {
  createSnow,
  FLOATING,
  levelFor,
  PILED,
  RESTING,
  type Snow,
} from "../../../src/apps/snowglobe/snow";

const STILL = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const DT = 1 / 30;
const COUNTS = { flakes: 1500, fines: 500 };

const setup = (seed: string, scene: keyof typeof SCENE_MAKERS = "cabin") => {
  const eddies = createEddies(createRng(`${seed}:eddies`));
  const snow = createSnow(createRng(seed), eddies, COUNTS);
  const built = SCENE_MAKERS[scene](createRng("models"), createMaterials());
  snow.setTerrain(built.terrain);
  return { snow, eddies, built };
};

/** Run from `from` to `to` seconds with these shakes, calling `each` once a second. */
const run = (snow: Snow, stirs: Stir[], from: number, to: number, each?: (t: number) => void) => {
  const flow = emptyFlow();
  let next = Math.ceil(from);
  for (let t = from; t < to; t += DT) {
    for (const s of stirs) if (s.at >= t && s.at < t + DT) snow.lift(s.at, s.strength);
    flowAt(stirs, t, flow);
    snow.step(DT, t, flow, STILL);
    if (each && t >= next) {
      each(t);
      next++;
    }
  }
};

const tally = (snow: Snow) => {
  const c = { floating: 0, resting: 0, piled: 0 };
  for (let i = 0; i < snow.count; i++) {
    if (snow.state[i] === FLOATING) c.floating++;
    else if (snow.state[i] === RESTING) c.resting++;
    else if (snow.state[i] === PILED) c.piled++;
  }
  return c;
};

describe("snowglobe snow", () => {
  it("keeps every flake inside the glass and every count adding up", { timeout: 60_000 }, () => {
    const { snow } = setup("inside");
    snow.scatter(STILL);
    const stirs: Stir[] = [
      { at: 5, strength: 1.1, dir: 0.3, spin: 1 },
      { at: 70, strength: 0.8, dir: 2.3, spin: -1 },
    ];
    run(snow, stirs, 0, 120, () => {
      for (let i = 0; i < snow.count; i++) {
        const o = i * 3;
        const d = Math.hypot(snow.pos[o]!, snow.pos[o + 1]!, snow.pos[o + 2]!);
        expect(d).toBeLessThanOrEqual(R - GLASS_MARGIN + 1e-3);
      }
      const c = tally(snow);
      expect(c).toEqual(snow.counts);
      expect(c.floating + c.resting + c.piled).toBe(snow.count);
    });
  });

  it(
    "settles every chip within 75 s of a shake, and every fine bit within 150 s",
    {
      timeout: 60_000,
    },
    () => {
      const { snow } = setup("settle");
      snow.scatter(STILL);
      const shake: Stir = { at: 1, strength: 1.15, dir: 1, spin: 1 };
      const lastAfloat = new Float64Array(snow.count);
      run(snow, [shake], 0, 1 + 160, (t) => {
        for (let i = 0; i < snow.count; i++) if (snow.state[i] === FLOATING) lastAfloat[i] = t;
      });
      let chips = 0;
      let fines = 0;
      for (let i = 0; i < snow.count; i++) {
        const after = lastAfloat[i]! - shake.at;
        if (i < COUNTS.flakes) chips = Math.max(chips, after);
        else fines = Math.max(fines, after);
      }
      expect(chips).toBeLessThanOrEqual(75);
      expect(fines).toBeLessThanOrEqual(150);
      expect(snow.counts.floating).toBe(0);
    },
  );

  it("builds the pile while calm and lifts it all on a shake", { timeout: 60_000 }, () => {
    const { snow } = setup("pile");
    snow.scatter(STILL);
    const before = snow.counts.piled;
    run(snow, [], 0, 60);
    expect(snow.counts.piled).toBeGreaterThan(before);
    const top = Math.max(...snow.level);
    expect(top).toBeGreaterThan(FOOT_Y + 0.1);
    expect(top).toBeLessThan(RIM_Y);
    run(snow, [{ at: 60.5, strength: 1, dir: 0, spin: 1 }], 60, 63);
    expect(snow.counts.piled).toBe(0);
    expect(snow.counts.resting).toBe(0);
    expect(Math.max(...snow.level)).toBeCloseTo(FOOT_Y, 5);
  });

  it("lets snow slide off a roof or a tree in a clump", { timeout: 60_000 }, () => {
    const eddies = createEddies(createRng("shed:eddies"));
    const snow = createSnow(createRng("shed"), eddies);
    snow.setTerrain(SCENE_MAKERS.cabin(createRng("models"), createMaterials()).terrain);
    snow.scatter(STILL);
    run(snow, [], 0, 90);
    const before = snow.counts.resting;
    let moved = 0;
    for (let i = 0; i < 20 && moved === 0; i++) moved = snow.shed(90);
    expect(moved).toBeGreaterThan(0);
    // Within a second they have all left, though a few others may land meanwhile.
    run(snow, [], 90, 91);
    expect(snow.counts.resting).toBeLessThanOrEqual(before - moved + 10);
    expect(snow.counts.resting).toBeLessThan(before);
  });

  it("gives a pile that rises with its snow", () => {
    let prev = levelFor(0);
    expect(prev).toBe(FOOT_Y);
    for (let v = 0.001; v < 0.05; v += 0.001) {
      const l = levelFor(v);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
    expect(levelFor(10)).toBe(RIM_Y);
  });
});
