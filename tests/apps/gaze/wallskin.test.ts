import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import {
  createSkinCycle,
  itaOf,
  labToLinear,
  SKIN,
  SKIN_ORDER,
  SKIN_TONES,
} from "../../../src/apps/gaze/wallskin";

const STEP = 1 / 10;

describe("gaze on a wall: skin tones", () => {
  it("run from very light to very dark skin, evenly spaced", () => {
    const itas = SKIN_TONES.map(itaOf);
    // Very light is above 55 degrees and dark below -30.
    expect(itas[0]).toBeGreaterThan(55);
    expect(itas.at(-1)).toBeLessThan(-55);
    const gaps = itas.slice(1).map((v, i) => itas[i]! - v);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 6);
    for (let i = 1; i < SKIN_TONES.length; i++) {
      expect(SKIN_TONES[i]!.l).toBeLessThan(SKIN_TONES[i - 1]!.l);
    }
    expect(SKIN_TONES[0]!.l).toBeGreaterThan(70);
    expect(SKIN_TONES.at(-1)!.l).toBeLessThan(30);
  });

  it("are all skin colours: warm, red over green over blue, never grey or garish", () => {
    for (const t of SKIN_TONES) {
      const hue = (Math.atan2(t.b, t.a) * 180) / Math.PI;
      expect(hue).toBeGreaterThan(45);
      expect(hue).toBeLessThan(65);
      expect(Math.hypot(t.a, t.b)).toBeGreaterThan(12);
      expect(Math.hypot(t.a, t.b)).toBeLessThan(26);
      const [r, g, b] = labToLinear(t);
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
      expect(b).toBeGreaterThan(0);
      expect(r).toBeLessThan(1);
    }
  });

  it("visit every tone once a cycle, stepping between near neighbours", () => {
    expect([...SKIN_ORDER].sort((a, b) => a - b)).toEqual(SKIN_TONES.map((_, i) => i));
    for (let i = 0; i < SKIN_ORDER.length; i++) {
      const next = SKIN_ORDER[(i + 1) % SKIN_ORDER.length]!;
      expect(Math.abs(next - SKIN_ORDER[i]!)).toBeLessThanOrEqual(2);
    }
  });

  it("hold every tone for the same time, over minutes, starting anywhere", () => {
    const cycle = SKIN_ORDER.length * (SKIN.hold + SKIN.blend);
    expect(SKIN.hold).toBeGreaterThanOrEqual(30);
    expect(cycle).toBeGreaterThan(5 * 60);
    const skin = createSkinCycle(createRng("even"));
    const held = SKIN_TONES.map(() => 0);
    let biggest = 0;
    let before = skin.colour;
    for (let t = 0; t < 3 * cycle; t += STEP) {
      skin.step(STEP);
      if (skin.mix === 0) held[skin.from]! += STEP;
      const c = skin.colour;
      biggest = Math.max(biggest, ...c.map((v, i) => Math.abs(v - before[i]!) / STEP));
      before = c;
    }
    for (const h of held) expect(h).toBeCloseTo(3 * SKIN.hold, -1);
    // Slowly: never more than a few per cent of full brightness a second.
    expect(biggest).toBeLessThan(0.03);

    const starts = new Set<number>();
    for (let i = 0; i < 24; i++) starts.add(createSkinCycle(createRng(`start-${i}`)).from);
    expect(starts.size).toBeGreaterThanOrEqual(5);
  });
});
