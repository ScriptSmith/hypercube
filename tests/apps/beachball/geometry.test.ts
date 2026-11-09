import { describe, expect, it } from "vitest";
import {
  CAP_RADIUS,
  GORE_WIDTH,
  GORES,
  regionOf,
  SAND_POLAR,
  sandCentre,
  SEAM_HALF,
} from "../../../src/apps/beachball/geometry";
import { BALL_GLSL } from "../../../src/apps/beachball/shader";
import { createRng } from "../../../src/core/rng";
import { direction, type Vec3 } from "../../../src/core/sphere";

const randomDirection = (rng: { range(a: number, b: number): number }): Vec3 => {
  const z = rng.range(-1, 1);
  const phi = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(phi), z, r * Math.sin(phi)];
};

describe("beach ball construction", () => {
  it("puts every direction on exactly one gore or cap, in the right shares", () => {
    const rng = createRng("regions");
    const n = 200_000;
    const gores = Array.from({ length: GORES }, () => 0);
    let top = 0;
    let bottom = 0;
    for (let i = 0; i < n; i++) {
      const r = regionOf(randomDirection(rng));
      if (r.kind === "cap") {
        if (r.pole === 1) top++;
        else bottom++;
      } else if (Number.isInteger(r.index) && r.index >= 0 && r.index < GORES) {
        gores[r.index]!++;
      }
    }
    // A cap of angular radius c covers (1 - cos c) / 2 of the sphere.
    const capShare = (1 - Math.cos(CAP_RADIUS)) / 2;
    expect(top / n).toBeCloseTo(capShare, 2);
    expect(bottom / n).toBeCloseTo(capShare, 2);
    for (const g of gores) expect(g / n).toBeCloseTo((1 - 2 * capShare) / GORES, 2);
    expect(top + bottom + gores.reduce((a, b) => a + b, 0)).toBe(n);
  });

  it("joins the gores round the back without a gap", () => {
    expect(regionOf(direction(0, -Math.PI))).toEqual({ kind: "gore", index: 0 });
    expect(regionOf(direction(0, Math.PI - 1e-9))).toEqual({ kind: "gore", index: GORES - 1 });
    expect(regionOf(direction(0, Math.PI))).toEqual({ kind: "gore", index: 0 });
    for (let i = 0; i < GORES; i++) {
      const lon = -Math.PI + (i + 0.5) * GORE_WIDTH;
      expect(regionOf(direction(0.3, lon))).toEqual({ kind: "gore", index: i });
    }
  });

  it("caps both poles", () => {
    expect(regionOf([0, 1, 0])).toEqual({ kind: "cap", pole: 1 });
    expect(regionOf([0, -1, 0])).toEqual({ kind: "cap", pole: -1 });
    const justOut = Math.PI / 2 - CAP_RADIUS - 1e-6;
    expect(regionOf(direction(justOut, 1)).kind).toBe("gore");
    expect(regionOf(direction(-justOut, 1)).kind).toBe("gore");
  });

  it("keeps the sand on the vinyl beside a cap, not on it", () => {
    const c = sandCentre();
    expect(Math.hypot(...c)).toBeCloseTo(1, 12);
    expect(SAND_POLAR).toBeGreaterThan(CAP_RADIUS);
    expect(regionOf(c).kind).toBe("gore");
  });

  it("gives the shader the same numbers", () => {
    expect(BALL_GLSL).toContain(`CAP_R = ${CAP_RADIUS}`);
    expect(BALL_GLSL).toContain(`SEAM_HALF = ${SEAM_HALF}`);
    expect(BALL_GLSL).toContain(`GORE_W = ${GORE_WIDTH}`);
    expect(BALL_GLSL).toContain(`uniform vec3 uGore[${GORES}]`);
  });
});
