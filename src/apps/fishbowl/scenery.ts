/**
 * Where the plants, stones, pot and air stone sit on the gravel. Pure data from a seed, shared
 * by the swimming model (things to steer round) and the scene (things to draw).
 */
import type { Rng } from "../../core/types";
import { GRAVEL_EDGE, gravelHeight } from "./bowl";
import { TAU } from "./vec";

export type PlantKind = "ribbon" | "sword";

export interface Plant {
  kind: PlantKind;
  x: number;
  z: number;
  /** Tallest leaf, bowl radii. */
  height: number;
  leaves: number;
  /** Round the clump, for fish to keep clear of. */
  radius: number;
  seed: number;
}

export interface Stone {
  x: number;
  z: number;
  /** Half-sizes across, up and along. */
  size: readonly [number, number, number];
  yaw: number;
  tone: number;
}

export interface Scenery {
  plants: Plant[];
  stones: Stone[];
  pot: { x: number; z: number; yaw: number; size: number };
  air: { x: number; y: number; z: number };
}

/** Something to steer round: a vertical capsule from the gravel up to `top`. */
export interface Obstacle {
  x: number;
  z: number;
  radius: number;
  top: number;
}

const at = (r: number, a: number): { x: number; z: number } => ({
  x: r * Math.sin(a),
  z: r * Math.cos(a),
});

export const layoutScenery = (rng: Rng): Scenery => {
  const turn0 = rng.range(0, TAU);
  // Five clumps round the heap, with stones, the pot and the air stone in the gaps between.
  const plants: Plant[] = [];
  const kinds: PlantKind[] = ["ribbon", "sword", "ribbon", "ribbon", "sword"];
  kinds.forEach((kind, i) => {
    const a = turn0 + (i * TAU) / kinds.length + rng.range(-0.18, 0.18);
    const p = at(rng.range(0.27, 0.33), a);
    plants.push({
      kind,
      ...p,
      height: kind === "ribbon" ? rng.range(0.78, 0.98) : rng.range(0.42, 0.52),
      leaves: kind === "ribbon" ? 9 + rng.int(4) : 9 + rng.int(3),
      radius: kind === "ribbon" ? 0.1 : 0.15,
      seed: rng.int(1 << 30),
    });
  });
  const gap = (i: number) => turn0 + ((i + 0.5) * TAU) / kinds.length;
  const stones: Stone[] = [0, 2].map((i) => ({
    ...at(rng.range(0.24, 0.32), gap(i) + rng.range(-0.1, 0.1)),
    size: [rng.range(0.09, 0.12), rng.range(0.06, 0.08), rng.range(0.11, 0.15)] as const,
    yaw: rng.range(0, TAU),
    tone: rng.next(),
  }));
  const pot = { ...at(0.24, gap(3)), yaw: rng.range(0, TAU), size: 0.13 };
  const a = at(Math.min(0.36, GRAVEL_EDGE - 0.1), gap(1));
  return { plants, stones, pot, air: { ...a, y: gravelHeight(0.36) + 0.02 } };
};

/** Everything on the gravel as capsules for the fish to keep clear of. */
export const obstaclesOf = (s: Scenery): Obstacle[] => [
  ...s.plants.map((p) => ({
    x: p.x,
    z: p.z,
    radius: p.radius,
    top: gravelHeight(Math.hypot(p.x, p.z)) + p.height * 0.9,
  })),
  ...s.stones.map((st) => ({
    x: st.x,
    z: st.z,
    radius: Math.max(st.size[0], st.size[2]) + 0.02,
    top: gravelHeight(Math.hypot(st.x, st.z)) + st.size[1] * 1.6,
  })),
  { x: s.pot.x, z: s.pot.z, radius: s.pot.size * 1.1, top: gravelHeight(0.24) + s.pot.size * 1.2 },
];
