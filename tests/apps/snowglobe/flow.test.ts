import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import {
  createEddies,
  emptyFlow,
  flowAt,
  murkOf,
  STIR_LIMIT,
  type Stir,
  velocityAt,
} from "../../../src/apps/snowglobe/flow";
import { R } from "../../../src/apps/snowglobe/mound";
import { SWAP_AFTER } from "../../../src/apps/snowglobe/show";

const shake: Stir = { at: 10, strength: 1, dir: 0.7, spin: 1 };

describe("snowglobe flow", () => {
  it("is thickest with snow at the moment a scene changes", () => {
    // A change of scene always gets a full shake.
    for (const strength of [1, 1.15]) expect(murkOf(SWAP_AFTER, strength)).toBeGreaterThan(0.97);
    expect(murkOf(0, 1)).toBe(0);
    expect(murkOf(-1, 1)).toBe(0);
    expect(murkOf(20, 1)).toBeLessThan(0.02);
  });

  it("jolts, swirls and calms below the settling speed within fifteen seconds", () => {
    const f = emptyFlow();
    flowAt([shake], shake.at + 0.3, f);
    expect(f.stir).toBeGreaterThan(1);
    expect(Math.abs(f.tilt)).toBeGreaterThan(0);
    flowAt([shake], shake.at + 2, f);
    expect(Math.abs(f.swirl)).toBeGreaterThan(0.3);
    flowAt([shake], shake.at + 15, f);
    expect(f.stir).toBeLessThan(STIR_LIMIT);
    flowAt([shake], shake.at + 60, f);
    expect(f.murk).toBe(0);
    expect(f.tilt).toBe(0);
  });

  it("is nearly still between shakes", () => {
    const f = flowAt([], 100, emptyFlow());
    expect(f.stir).toBeLessThan(0.01);
    const u = new Float32Array(3);
    velocityAt(f, createEddies(createRng("e")), 100, 0.5, 0.2, -0.4, u);
    expect(Math.hypot(u[0]!, u[1]!, u[2]!)).toBeLessThan(0.02);
  });

  it("neither gathers nor spreads the snow, and doesn't flow through the glass", () => {
    const eddies = createEddies(createRng("div"));
    const f = emptyFlow();
    flowAt([shake], shake.at + 1, f);
    const u = new Float32Array(3);
    const at = (x: number, y: number, z: number) => {
      velocityAt(f, eddies, 11, x, y, z, u);
      return [u[0]!, u[1]!, u[2]!] as const;
    };
    const rng = createRng("points");
    const h = 1e-3;
    for (let i = 0; i < 40; i++) {
      const x = rng.range(-1.4, 1.4);
      const y = rng.range(-1.4, 1.4);
      const z = rng.range(-1.4, 1.4);
      const div =
        (at(x + h, y, z)[0] - at(x - h, y, z)[0]) / (2 * h) +
        (at(x, y + h, z)[1] - at(x, y - h, z)[1]) / (2 * h) +
        (at(x, y, z + h)[2] - at(x, y, z - h)[2]) / (2 * h);
      expect(Math.abs(div)).toBeLessThan(1e-2);
    }
    // The roll alone runs along the glass, never through it.
    const roll = { ...emptyFlow(), roll: 1, eddies: 0 };
    for (let i = 0; i < 40; i++) {
      const lat = rng.range(-1.5, 1.5);
      const lon = rng.range(-Math.PI, Math.PI);
      const n = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      velocityAt(roll, eddies, 0, n[0]! * R, n[1]! * R, n[2]! * R, u);
      expect(Math.abs(u[0]! * n[0]! + u[1]! * n[1]! + u[2]! * n[2]!)).toBeLessThan(1e-5);
    }
  });
});
