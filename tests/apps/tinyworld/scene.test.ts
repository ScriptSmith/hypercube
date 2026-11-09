import { describe, expect, it } from "vitest";
import {
  computeGeometry,
  readConfig,
  softwareCell,
  SOFTWARE_CELLS,
} from "../../../src/apps/tinyworld/config";
import { buildScene } from "../../../src/apps/tinyworld/scene";
import { MAX_ISLANDS } from "../../../src/apps/tinyworld/shaders/genesis";
import { craterOf } from "../../../src/apps/tinyworld/weather";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind } from "../../../src/core/types";

const sceneFor = (kind: FrameKind, variant: string, weather = true) => {
  const config = readConfig(kind, variant, { weather, palette: "full", cell: "auto" });
  const size = VENUE_SIZE[kind];
  const g = computeGeometry({ ...size, unit: 1 }, config.cell);
  return { config, g, scene: buildScene(config, g, 1, () => 0.5) };
};

describe("tinyworld scene", () => {
  it("sizes the grid from the cell option", () => {
    expect(readConfig("wall", "sandbox", {}).cell).toBe(3);
    expect(readConfig("panel", "sandbox", {}).cell).toBe(4);
    expect(readConfig("wall", "sandbox", { cell: "2" }).cell).toBe(2);
    const { g } = sceneFor("wall", "sandbox");
    expect([g.gridW, g.gridH]).toEqual([1920, 720]);
  });

  it("keeps a software renderer's grid small", () => {
    for (const kind of ["wall", "panel", "pair"] as const) {
      const { width, height } = VENUE_SIZE[kind];
      const c = softwareCell(width, height, 3);
      expect(Math.ceil(width / c) * Math.ceil(height / c)).toBeLessThanOrEqual(
        SOFTWARE_CELLS * 1.1,
      );
    }
  });

  for (const kind of ["wall", "panel", "pair"] as const) {
    for (const variant of ["sandbox", "delta"]) {
      it(`fits the ${kind} ${variant} world in its grid`, () => {
        const { g, scene } = sceneFor(kind, variant);
        expect(scene.world.islands.length).toBeLessThanOrEqual(MAX_ISLANDS);
        expect(scene.openFloor).toBe(false);
        for (const v of scene.world.terrain) expect(Number.isFinite(v)).toBe(true);
        if (variant === "delta") {
          expect(scene.sea).not.toBeNull();
          expect(scene.sea!.x1).toBeLessThanOrEqual(g.gridW);
          expect(scene.erosion).toBeGreaterThan(0);
        } else {
          expect(scene.sea).toBeNull();
          expect(scene.erosion).toBe(0);
        }
      });
    }
  }

  it("gives the screen above a bank a sky of islands with an open floor", () => {
    const { scene } = sceneFor("screen", "sandbox");
    expect(scene.world.variant).toBe("sky");
    expect(scene.world.islands).toHaveLength(3);
    expect(scene.openFloor).toBe(true);
    expect(scene.weather.volcano).not.toBeNull();
  });

  it("puts the volcano island high on the wall, above anyone's reach", () => {
    const { g, scene } = sceneFor("wall", "sandbox");
    const island = scene.weather.volcano!;
    const reachTop = g.gridH * DEFAULT_REACH.wall.adult;
    expect(island.cy - island.hh * 1.3).toBeGreaterThan(reachTop);
    const crater = craterOf(island);
    expect(crater.y).toBeLessThan(g.gridH);
    expect(sceneFor("wall", "sandbox", false).scene.weather.volcano).toBeNull();
    expect(sceneFor("panel", "sandbox").scene.weather.volcano).toBeNull();
  });
});
