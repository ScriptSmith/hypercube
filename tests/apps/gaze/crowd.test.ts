import { describe, expect, it } from "vitest";
import { createCrowd, MAX_PEOPLE, UPPER } from "../../../src/apps/gaze/crowd";
import { angle, elevation } from "../../../src/apps/gaze/geom";
import { createRng } from "../../../src/core/rng";
import { DEG, sphereInfo } from "../../../src/core/sphere";

describe("crowd", () => {
  it("comes and goes, stays in the room and never grows past its limit", () => {
    const crowd = createCrowd(createRng("crowd"), sphereInfo());
    const ids = new Set<number>();
    let fewest = 99;
    let most = 0;
    for (let i = 0; i < 60 * 60 * 30; i++) {
      crowd.step(1 / 30);
      fewest = Math.min(fewest, crowd.people.length);
      most = Math.max(most, crowd.people.length);
      if (i % 30) continue;
      for (const p of crowd.people) {
        ids.add(p.id);
        expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(crowd.room + 1.01);
      }
    }
    expect(most).toBeLessThanOrEqual(MAX_PEOPLE);
    expect(most - fewest).toBeGreaterThan(3);
    expect(ids.size).toBeGreaterThan(40);
  });

  it("puts people on the floor below the ball, from straight under it to across the room", () => {
    const crowd = createCrowd(createRng("below"), sphereInfo());
    let steepest = 0;
    let shallowest = -90;
    for (let i = 0; i < 60 * 60 * 10; i++) {
      crowd.step(1 / 30);
      if (i % 15) continue;
      for (const p of crowd.people) {
        if (p.upper) continue;
        const e = elevation(crowd.direction(p)) / DEG;
        expect(e).toBeLessThan(0);
        steepest = Math.min(steepest, e);
        shallowest = Math.max(shallowest, e);
      }
    }
    expect(steepest).toBeLessThan(-70);
    expect(shallowest).toBeGreaterThan(-25);
  });

  it("seats people on a gallery with their eyes about level with the ball", () => {
    const s = sphereInfo();
    const crowd = createCrowd(createRng("upper"), s);
    const sitting = new Map<number, number>();
    let nearest = Infinity;
    let furthest = 0;
    let steepest = 0;
    let longest = 0;
    let most = 0;
    let groups = 0;
    let samples = 0;
    for (let i = 0; i < 20 * 60 * 10; i++) {
      crowd.step(1 / 10);
      let here = 0;
      for (const p of crowd.people) {
        if (!p.upper) continue;
        if (!p.leaving) here++;
        // On the gallery, never out over the floor below.
        const r = Math.hypot(p.x, p.z);
        nearest = Math.min(nearest, r);
        furthest = Math.max(furthest, r);
        steepest = Math.max(steepest, Math.abs(elevation(crowd.direction(p))));
        if (p.eye < p.tall * 0.8) {
          const t = (sitting.get(p.id) ?? 0) + 1 / 10;
          sitting.set(p.id, t);
          longest = Math.max(longest, t);
        }
      }
      most = Math.max(most, here);
      if (i % 10) continue;
      // Some sit beside someone else.
      const seats = crowd.people.filter((p) => p.upper && p.wait > 0);
      samples++;
      if (seats.some((p) => seats.some((q) => q !== p && Math.hypot(p.x - q.x, p.z - q.z) < 1.5))) {
        groups++;
      }
    }
    expect(nearest).toBeGreaterThanOrEqual(s.radius + UPPER.clear - 1e-6);
    expect(furthest).toBeLessThanOrEqual(crowd.room * UPPER.outer + 1e-6);
    expect(steepest / DEG).toBeLessThan(7);
    expect(crowd.upperFloor).toBeCloseTo(s.centreY - UPPER.belowCentre);
    expect(most).toBeLessThanOrEqual(UPPER.most);
    expect(most).toBeGreaterThan(UPPER.fewest);
    // People sit for minutes.
    expect(longest).toBeGreaterThan(60);
    expect(groups / samples).toBeGreaterThan(0.3);
  });

  it("empties the gallery when it is turned off", () => {
    const crowd = createCrowd(createRng("empty"), sphereInfo());
    expect(crowd.people.some((p) => p.upper)).toBe(true);
    crowd.setUpper(false);
    for (let i = 0; i < 60 * 10 && crowd.people.some((p) => p.upper); i++) crowd.step(1 / 10);
    expect(crowd.people.some((p) => p.upper)).toBe(false);
    for (let i = 0; i < 60 * 5 * 10; i++) crowd.step(1 / 10);
    expect(crowd.people.some((p) => p.upper)).toBe(false);
    const off = createCrowd(createRng("off"), sphereInfo(), false);
    for (let i = 0; i < 60 * 5 * 10; i++) off.step(1 / 10);
    expect(off.people.some((p) => p.upper)).toBe(false);
  });
});

describe("people's parts", () => {
  it("puts the eyes, mouth and body where they are on a person", () => {
    const crowd = createCrowd(createRng("parts"), sphereInfo());
    const p = crowd.place(3, 4, 1.6, 10);
    const d = crowd.distance(p);
    const across = angle(crowd.direction(p, "leftEye"), crowd.direction(p, "rightEye"));
    expect(across).toBeCloseTo(0.064 / d, 3);
    const mouth = angle(crowd.direction(p), crowd.direction(p, "mouth"));
    expect(mouth).toBeGreaterThan(0.05 / d);
    expect(mouth).toBeLessThan(0.1 / d);
    expect(elevation(crowd.direction(p, "feet"))).toBeLessThan(
      elevation(crowd.direction(p, "chest")),
    );
    expect(elevation(crowd.direction(p, "chest"))).toBeLessThan(elevation(crowd.direction(p)));
    // Someone placed stays put while they wait.
    for (let i = 0; i < 30 * 5; i++) crowd.step(1 / 30);
    expect(crowd.find(p.id)?.x).toBe(3);
  });
});
