/** A carousel turning slowly under a striped canopy ringed with bulbs, its horses rising and falling. */
import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Vector3,
} from "three";
import type { Rng } from "../../../core/types";
import {
  ball,
  box,
  cone,
  cyl,
  lampPost,
  type Materials,
  Parts,
  pine,
  put,
  ring,
  SNOW,
} from "../kit";
import { groundY, type Hills } from "../mound";
import type { BuiltScene } from "../scene";
import { buildTerrain } from "../terrain";
import { ground } from "./common";

const SPOKES = 16;
const HORSES = 6;
/** Seconds for one turn. */
const TURN = 16;
const ROSE = "#b4475a";
const CREAM = "#f1e4cc";
const BRASS = "#c9a24a";
const COATS = ["#f2efe8", "#8a5a3c", "#d8d2c8", "#4a3a34", "#b98b5e", "#efe6d6"];
const SADDLES = ["#3f6fa8", "#3d8a6d", "#6b4f9e", "#2f7e8c", "#b4485c", "#d08a3c"];

const hills: Hills = (x, z) =>
  -0.1 * Math.exp(-((Math.hypot(x, z) / 0.85) ** 4)) +
  0.05 * Math.cos(1.6 * x - 0.4) * Math.sin(1.9 * z + 0.7);

/** A cone in alternating stripes, coloured per face. */
const stripedCone = (r: number, h: number, a: string, b: string): BufferGeometry => {
  const g = new ConeGeometry(r, h, SPOKES * 2, 1, true).toNonIndexed();
  const pos = g.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const ca = new Color(a);
  const cb = new Color(b);
  for (let i = 0; i < pos.count; i += 3) {
    let x = 0;
    let z = 0;
    for (let j = 0; j < 3; j++) {
      x += pos.getX(i + j);
      z += pos.getZ(i + j);
    }
    const k = Math.floor(((Math.atan2(x, z) + Math.PI) / (Math.PI * 2)) * SPOKES * 2);
    const c = k % 2 ? ca : cb;
    for (let j = 0; j < 3; j++) colors.set([c.r, c.g, c.b], (i + j) * 3);
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
};

/** A toy horse facing +x, prancing, its saddle `saddle`, about 0.3 long. */
const horse = (parts: Parts, coat: string, saddle: string) => {
  parts.add(put(ball(1, 12, 9), 0, 0, 0, 0, 0, 0, 0.15, 0.085, 0.08), coat, "solid", 0.03);
  parts.add(put(cyl(0.035, 0.05, 0.16, 8), 0.12, 0.07, 0, 0, 0, -0.75), coat);
  parts.add(put(box(0.12, 0.055, 0.06), 0.2, 0.13, 0, 0, 0, -0.35), coat);
  parts.add(put(box(0.03, 0.04, 0.012), 0.16, 0.17, 0.02, 0, 0, 0.3), coat);
  parts.add(put(box(0.03, 0.04, 0.012), 0.16, 0.17, -0.02, 0, 0, 0.3), coat);
  parts.add(put(box(0.1, 0.03, 0.02), 0.1, 0.13, 0, 0, 0, -0.8), "#3a2a20");
  parts.add(put(box(0.09, 0.025, 0.1), -0.01, 0.08, 0), saddle);
  parts.add(put(cone(0.03, 0.12, 6), -0.17, 0.0, 0, 0, 0, 2.3), "#3a2a20");
  // Front legs up in a prance, back legs down.
  for (const s of [-1, 1]) {
    parts.add(put(cyl(0.016, 0.014, 0.13, 6), 0.11, -0.06, s * 0.035, 0, 0, 1.1), coat);
    parts.add(put(cyl(0.016, 0.014, 0.15, 6), -0.1, -0.1, s * 0.035, 0, 0, -0.25), coat);
  }
};

export const makeCarousel = (rng: Rng, materials: Materials): BuiltScene => {
  const parts = new Parts(rng);
  const gy = (x: number, z: number) => groundY(hills, x, z);
  ground(parts, rng, hills);

  const base = gy(0.7, 0) + 0.02;
  // A stone ring for it to stand on, and a low fence with a gap round it.
  parts.add(put(cyl(0.74, 0.78, 0.12, 40), 0, base - 0.04, 0), "#8a8580", "solid", 0.05);
  parts.add(put(cyl(0.72, 0.72, 0.02, 40), 0, base + 0.03, 0), SNOW);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    if (Math.abs(Math.sin(a - 1.2)) < 0.12) continue;
    const x = Math.sin(a) * 0.98;
    const z = Math.cos(a) * 0.98;
    parts.add(put(cyl(0.012, 0.012, 0.13, 5), x, gy(x, z) + 0.05, z), "#2c3138");
  }
  parts.add(put(ring(0.98, 0.007, 48), 0, gy(0.98, 0) + 0.11, 0, Math.PI / 2, 0, 0), "#2c3138");

  const lamps: Vector3[] = [];
  for (const a of [0.6, 3.75]) {
    const x = Math.sin(a) * 1.16;
    const z = Math.cos(a) * 1.16;
    lamps.push(lampPost(parts, x, gy(x, z) - 0.02, z, 0.6));
  }
  for (const [a, d, h] of [
    [1.6, 1.25, 0.9],
    [2.45, 1.2, 0.7],
    [4.6, 1.25, 0.95],
    [5.4, 1.2, 0.65],
    [2.9, 1.32, 0.55],
  ] as const) {
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    pine(parts, rng, x, gy(x, z) - 0.02, z, h);
  }

  // What turns: platform, column, canopy, bulbs and horses, each made once.
  const floor = base + 0.08;
  const roofY = floor + 0.78;
  const spin = new Parts(rng);
  spin.add(put(cyl(0.66, 0.66, 0.08, 40), 0, base + 0.04, 0), "#8a5a3c", "solid", 0.04);
  spin.add(put(cyl(0.64, 0.64, 0.012, 40), 0, floor + 0.002, 0), "#d9c9a8", "solid", 0.04);
  spin.add(put(cyl(0.06, 0.07, roofY - floor, 14), 0, (floor + roofY) / 2, 0), CREAM);
  for (let i = 0; i < 5; i++) {
    spin.add(put(ring(0.066, 0.012, 14), 0, floor + 0.12 + i * 0.13, 0, Math.PI / 2, 0, 0), ROSE);
  }
  spin.add(put(cyl(0.72, 0.72, 0.06, 40, true), 0, roofY - 0.02, 0), ROSE, "solid", 0.03);
  spin.add(put(ball(0.05, 10, 8), 0, roofY + 0.39, 0), BRASS);
  spin.add(put(cone(0.03, 0.1, 8), 0, roofY + 0.46, 0), BRASS);
  for (let i = 0; i < SPOKES; i++) {
    const a = ((i + 0.5) / SPOKES) * Math.PI * 2;
    // Scallops hanging under the canopy's rim.
    spin.add(
      put(
        cyl(0.07, 0.07, 0.012, 10),
        Math.sin(a) * 0.715,
        roofY - 0.06,
        Math.cos(a) * 0.715,
        Math.PI / 2,
        a,
        0,
        1,
        1,
        1,
      ),
      i % 2 ? ROSE : CREAM,
    );
  }
  const bulbs = new Parts(rng);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    bulbs.add(
      put(ball(0.016, 6, 4), Math.sin(a) * 0.73, roofY + 0.01, Math.cos(a) * 0.73),
      "#ffe2a0",
      "glow",
    );
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    bulbs.add(
      put(ball(0.013, 6, 4), Math.sin(a) * 0.67, base + 0.04, Math.cos(a) * 0.67),
      "#ffe2a0",
      "glow",
    );
  }
  const turning = new Group();
  const deck = spin.build(materials);
  const lights = bulbs.build(materials);
  const canopyGeo = stripedCone(0.78, 0.4, ROSE, CREAM);
  canopyGeo.translate(0, roofY + 0.18, 0);
  const canopy = new Mesh(canopyGeo, materials.solid);
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  const snowCap = new Parts(rng);
  snowCap.add(put(cone(0.5, 0.26, 32), 0, roofY + 0.27, 0), SNOW, "solid", 0.03);
  turning.add(deck, lights, canopy, snowCap.build(materials));

  const mounts: Group[] = [];
  for (let i = 0; i < HORSES; i++) {
    const a = (i / HORSES) * Math.PI * 2;
    const pole = new Parts(rng);
    pole.add(
      put(
        cyl(0.011, 0.011, roofY - floor, 6),
        Math.sin(a) * 0.48,
        (floor + roofY) / 2,
        Math.cos(a) * 0.48,
      ),
      BRASS,
    );
    turning.add(pole.build(materials));
    const h = new Parts(rng);
    horse(h, COATS[i % COATS.length]!, SADDLES[i % SADDLES.length]!);
    const g = h.build(materials);
    const holder = new Group();
    holder.add(g);
    // Facing along the way round.
    holder.position.set(Math.sin(a) * 0.48, floor + 0.32, Math.cos(a) * 0.48);
    holder.rotation.y = a;
    turning.add(holder);
    mounts.push(holder);
  }
  parts.collide({
    kind: "cone",
    x: 0,
    z: 0,
    r: 0.78,
    base: roofY - 0.02,
    apex: roofY + 0.48,
    shed: true,
  });

  const group = parts.build(materials);
  group.add(turning);
  const terrain = buildTerrain(hills, parts.colliders);

  return {
    id: "carousel",
    group,
    terrain,
    lights: [new Vector3(0, floor + 0.45, 0), lamps[0]!, lamps[1]!],
    update(t) {
      turning.rotation.y = ((t / TURN) % 1) * Math.PI * 2;
      mounts.forEach((m, i) => {
        m.position.y = floor + 0.3 + 0.07 * Math.sin(t * 1.6 + i * 2.1);
      });
    },
  };
};
