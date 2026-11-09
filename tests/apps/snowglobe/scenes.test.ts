import { type Mesh, type Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import { makeDen } from "../../../src/apps/snowglobe/den";
import { createMaterials } from "../../../src/apps/snowglobe/kit";
import { groundY, R, RIM_RHO, RIM_Y } from "../../../src/apps/snowglobe/mound";
import { SCENE_MAKERS } from "../../../src/apps/snowglobe/scenes";
import { SCENES } from "../../../src/apps/snowglobe/show";
import { buildTerrain, GRID } from "../../../src/apps/snowglobe/terrain";

/** The farthest any vertex of `root` reaches from the globe's centre. */
const reach = (root: Object3D): number => {
  root.updateMatrixWorld(true);
  const v = new Vector3();
  let most = 0;
  root.traverse((o) => {
    const geo = (o as Mesh).geometry;
    const p = geo?.attributes?.position;
    if (!p) return;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      most = Math.max(most, v.length());
    }
  });
  return most;
};

describe("snowglobe scenes", () => {
  for (const id of SCENES) {
    it(`builds the ${id} inside the glass, moving parts and all`, () => {
      const built = SCENE_MAKERS[id](createRng(`models:${id}`), createMaterials());
      expect(built.id).toBe(id);
      expect(built.lights.length).toBeLessThanOrEqual(3);
      for (const l of built.lights) expect(l.length()).toBeLessThan(R);
      for (const t of [0, 3.3, 17, 61, 400]) {
        built.update(t);
        expect(reach(built.group)).toBeLessThan(R - 0.002);
      }
      // What the snow lands on is the scene's ground or something standing on it.
      const h = built.terrain.heights;
      let solid = 0;
      for (let i = 0; i < GRID * GRID; i++) {
        if (h[i] === -Infinity) continue;
        solid++;
        expect(h[i]).toBeGreaterThanOrEqual(RIM_Y - 0.05);
        expect(h[i]).toBeLessThan(R * 0.6);
      }
      expect(solid).toBeGreaterThan(GRID * GRID * 0.6);
      expect(built.terrain.top(0, RIM_RHO + 0.2)).toBe(-Infinity);
    });
  }

  it("keeps the den and its rabbits inside the glass", () => {
    const den = makeDen(createRng("den"), createMaterials());
    for (const t of [0, 2, 9.5]) {
      den.update(t);
      expect(reach(den.group)).toBeLessThan(R);
    }
  });

  it("reads colliders' tops: boxes, roofs, cones and domes", () => {
    const flat = () => 0;
    const t = buildTerrain(flat, [
      { kind: "box", x: 0.5, z: 0, hw: 0.1, hd: 0.1, top: 0.2 },
      { kind: "gable", x: -0.5, z: 0, hw: 0.2, hd: 0.2, eave: -0.5, ridge: -0.2, shed: true },
      { kind: "cone", x: 0, z: 0.6, r: 0.2, base: -0.8, apex: 0.1, shed: true },
      { kind: "dome", x: 0, z: -0.6, r: 0.2, base: -1, h: 0.5 },
    ]);
    expect(t.top(0.5, 0)).toBeCloseTo(0.2, 3);
    expect(t.id(0.5, 0)).toBe(1);
    expect(t.top(-0.5, 0)).toBeGreaterThan(-0.25);
    expect(t.top(-0.5, 0.15)).toBeLessThan(t.top(-0.5, 0));
    expect(t.slope(-0.5, 0.1)).toBeGreaterThan(1);
    expect(t.top(0, 0.6)).toBeGreaterThan(0);
    expect(t.top(0, -0.6)).toBeCloseTo(-0.5, 1);
    expect(t.sheds).toEqual([false, false, true, true, false]);
    // Bare ground elsewhere.
    expect(t.top(0, 0)).toBeCloseTo(groundY(flat, 0, 0), 2);
    expect(t.id(0, 0)).toBe(0);
  });
});
