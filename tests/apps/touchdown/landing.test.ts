import { describe, expect, it } from "vitest";
import {
  type Craft,
  contactOf,
  FOOT,
  NO_THRUST,
  physicsFor,
  stepCraft,
} from "../../../src/apps/touchdown/craft";
import type { Terrain } from "../../../src/apps/touchdown/terrain";
import { crewOf, DT, flyUntilContact, layoutOf } from "./helpers";

const layout = layoutOf("pair");
const p = physicsFor(layout, layout.crews[0]!.lane, "gentle");
const S = p.S;

/** Rough ground at 1450 with one flat two-star pad from 900 to 1300 at 1300. */
const terrain: Terrain = {
  xs: Float32Array.from([0, 600, 860, 900, 1300, 1340, 1700, 2160]),
  ys: Float32Array.from([1200, 1450, 1340, 1300, 1300, 1340, 1450, 1200]),
  pads: [{ x0: 900, x1: 1300, y: 1300, stars: 2 }],
  spawn: { x: 1100, vx: 0 },
};

/** A craft with its feet just above `groundY` at x, moving down at vy. */
const above = (x: number, groundY: number, vy: number, a = 0, vx = 0): Craft => ({
  x,
  y: groundY - FOOT.y * S - 2,
  vx,
  vy,
  a,
  w: 0,
});

/** Step without engines until something touches; return what. */
const descend = (c: Craft) => {
  for (let i = 0; i < 2000; i++) {
    stepCraft(c, NO_THRUST, p, 0, DT);
    // Keep the test's speeds: this is about the touchdown rules, not the fall.
    const hit = contactOf(c, terrain, p);
    if (hit) return hit;
  }
  return null;
};

describe("touchdown landing rules", () => {
  it("lands a gentle, upright descent onto a pad", () => {
    const hit = descend(above(1100, 1300, p.landVy * 0.5));
    expect(hit).toEqual({ kind: "land", pad: terrain.pads[0] });
  });

  it("bumps a fast descent", () => {
    expect(descend(above(1100, 1300, p.landVy * 1.6))).toEqual({ kind: "bump", why: "fast" });
  });

  it("bumps when tilted past 12 degrees", () => {
    const hit = descend(above(1100, 1300, p.landVy * 0.4, (16 * Math.PI) / 180));
    expect(hit).toEqual({ kind: "bump", why: "tilt" });
    const ok = descend(above(1100, 1300, p.landVy * 0.4, (8 * Math.PI) / 180));
    expect(ok?.kind).toBe("land");
  });

  it("bumps when sliding sideways too fast", () => {
    const hit = descend(above(1100, 1300, p.landVy * 0.4, 0, p.landVx * 1.8));
    expect(hit).toEqual({ kind: "bump", why: "sideways" });
  });

  it("bumps when a foot is off the pad", () => {
    const edge = 1300 - FOOT.x * S + 20;
    expect(descend(above(edge, 1300, p.landVy * 0.4))?.kind).toBe("bump");
    expect(descend(above(700, 1420, p.landVy * 0.4))?.kind).toBe("bump");
  });

  it("is clear of the ground while the feet are above it", () => {
    expect(contactOf(above(1100, 1300, 0), terrain, p)).toBeNull();
  });

  it("settles a landing on the pad, then starts the next run", () => {
    const { crew, events } = crewOf("pair");
    crew.touched(true, 0);
    // Put the craft just over the middle of a pad, coming down gently.
    const pad = crew.terrain.pads[0]!;
    crew.craft.x = (pad.x0 + pad.x1) / 2;
    crew.craft.y = pad.y - FOOT.y * crew.physics.S - 3;
    crew.craft.vy = crew.physics.landVy * 0.5;
    flyUntilContact(crew);
    expect(crew.phase).toBe("landed");
    expect(crew.outcome?.stars).toBe(pad.stars);
    expect(events.some((e) => e.kind === "land")).toBe(true);
    for (let i = 0; i < 120; i++) crew.step(DT, 1000);
    expect(crew.craft.a).toBeCloseTo(0, 6);
    expect(crew.craft.y).toBeCloseTo(pad.y - FOOT.y * crew.physics.S, 3);
    const run = crew.run;
    for (let i = 0; i < 4 * 120; i++) crew.step(DT, 2000);
    expect(crew.run).toBe(run + 1);
    expect(crew.phase).toBe("flying");
  });

  it("bounces and tips a bump over, without breaking anything apart", () => {
    const { crew, events } = crewOf("pair");
    crew.touched(true, 0);
    flyUntilContact(crew);
    expect(crew.phase).toBe("bumped");
    for (let i = 0; i < 1.5 * 120; i++) crew.step(DT, 1000);
    expect(Math.abs(crew.craft.a)).toBeGreaterThan(1.3);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["bump", "tipped"]));
  });
});
