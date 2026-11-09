import { describe, expect, it } from "vitest";
import { HELPER_AFTER_MS } from "../../../src/apps/touchdown/config";
import { FOOT, wrap } from "../../../src/apps/touchdown/craft";
import { crewOf, run } from "./helpers";

describe("touchdown helper for a lone visitor", () => {
  it("takes the other engine after one pad is held for 3 s", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    crew.setHeld("left", true);
    let now = run(crew, (HELPER_AFTER_MS - 500) / 1000, 0);
    expect(crew.helping).toBeNull();
    now = run(crew, 1, now);
    expect(crew.helping).toBe(1);
    // Gentle assist never lets one engine turn it upside down, and the helper levels it.
    let worst = 0;
    now = run(crew, 2, now, () => {
      worst = Math.max(worst, Math.abs(wrap(crew.craft.a)));
    });
    expect(worst).toBeLessThan((80 * Math.PI) / 180);
    worst = 0;
    run(crew, 10, now, () => {
      worst = Math.max(worst, Math.abs(wrap(crew.craft.a)));
    });
    expect(worst).toBeLessThan((15 * Math.PI) / 180);
    expect(crew.craft.y).toBeLessThan(900);
  });

  it("works for either side", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    crew.setHeld("right", true);
    run(crew, 4, 0);
    expect(crew.helping).toBe(0);
  });

  it("without it, one engine alone spins the craft over", () => {
    const { crew } = crewOf("pair", "duo", { assist: "off" });
    crew.touched(true, 0);
    crew.setHeld("left", true);
    run(crew, 2.9, 0);
    expect(crew.craft.a).toBeGreaterThan(Math.PI / 2);
  });

  it("lets go when someone takes its pad", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    crew.setHeld("left", true);
    const now = run(crew, 4, 0);
    expect(crew.helping).toBe(1);
    crew.setHeld("right", true);
    run(crew, 0.1, now);
    expect(crew.helping).toBeNull();
  });

  it("doesn't come when the other pad was used lately", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    crew.setHeld("right", true);
    let now = run(crew, 0.5, 0);
    crew.setHeld("right", false);
    crew.setHeld("left", true);
    now = run(crew, 5, now);
    expect(crew.helping).toBeNull();
  });

  it("lets go when the visitor leaves", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    crew.setHeld("left", true);
    let now = run(crew, 4, 0);
    crew.setHeld("left", false);
    now = run(crew, 9, now);
    expect(crew.helping).toBeNull();
  });

  it("caps a helped landing at two stars", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    crew.setHeld("left", true);
    const now = run(crew, 4, 0);
    expect(crew.helping).toBe(1);
    const pad = crew.terrain.pads.find((p) => p.stars === 3)!;
    crew.setHeld("left", false);
    crew.craft.x = (pad.x0 + pad.x1) / 2;
    crew.craft.y = pad.y - FOOT.y * crew.physics.S - 3;
    crew.craft.vx = 0;
    crew.craft.vy = crew.physics.landVy * 0.5;
    crew.craft.a = 0;
    crew.craft.w = 0;
    run(crew, 0.5, now);
    expect(crew.outcome?.kind).toBe("land");
    expect(crew.outcome?.stars).toBe(2);
  });

  it("is not part of the crew variant", () => {
    const { crew } = crewOf("pair", "crew");
    crew.touched(true, 0);
    crew.setHeld("main", true);
    run(crew, 5, 0);
    expect(crew.helping).toBeNull();
  });
});
