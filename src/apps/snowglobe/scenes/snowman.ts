/** A big snowman in a scarf and hat, a little one beside him, a sledge, snowballs and a bird. */
import { Group, Mesh, SphereGeometry, Vector3 } from "three";
import type { Rng } from "../../../core/types";
import {
  at,
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
import { noise3 } from "../noise";
import type { BuiltScene } from "../scene";
import { buildTerrain } from "../terrain";
import { ground } from "./common";

const COAL = "#26282c";
const CARROT = "#e2742a";
const SCARF = "#2f7d6d";
const STRIPE = "#f1e4cc";
const TWIG = "#5a3f2c";

const hills: Hills = (x, z) =>
  0.16 * Math.exp(-((x + 0.7) ** 2 + (z + 0.5) ** 2) / 0.3) +
  0.1 * Math.exp(-((x - 0.8) ** 2 + (z - 0.45) ** 2) / 0.25) -
  0.04 * Math.exp(-(x * x + z * z) / 0.4);

/** A snowball that isn't quite round. */
const lump = (rng: Rng, r: number) => {
  const g = new SphereGeometry(r, 18, 14);
  const p = g.attributes.position!;
  const seed = rng.range(0, 50);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + 0.05 * noise3((x / r) * 1.6 + seed, (y / r) * 1.6, (z / r) * 1.6);
    p.setXYZ(i, x * k, y * k * 0.95, z * k);
  }
  g.computeVertexNormals();
  return g;
};

/** A twig arm from (x, y, z) reaching out along `a` round and up by `up`. */
const arm = (parts: Parts, x: number, y: number, z: number, a: number, up: number, len: number) => {
  const dx = Math.sin(a) * Math.cos(up);
  const dy = Math.sin(up);
  const dz = Math.cos(a) * Math.cos(up);
  const mid = (f: number) => [x + dx * len * f, y + dy * len * f, z + dz * len * f] as const;
  // A cylinder points up y; tip it over towards the arm's direction.
  const tip = Math.acos(dy);
  const [mx, my, mz] = mid(0.5);
  parts.add(put(cyl(0.012, 0.016, len, 6), mx, my, mz, tip, a, 0), TWIG);
  for (const [f, side] of [
    [0.75, 0.6],
    [0.85, -0.5],
  ] as const) {
    const [fx, fy, fz] = mid(f);
    const t = len * 0.25;
    parts.add(
      put(
        cyl(0.006, 0.008, t, 5),
        fx + Math.sin(a + side) * t * 0.4,
        fy + t * 0.35,
        fz + Math.cos(a + side) * t * 0.4,
        tip - 0.6,
        a + side,
        0,
      ),
      TWIG,
    );
  }
};

export const makeSnowman = (rng: Rng, materials: Materials): BuiltScene => {
  const parts = new Parts(rng);
  const gy = (x: number, z: number) => groundY(hills, x, z);
  ground(parts, rng, hills);

  // The big snowman, facing +z.
  const sx = 0;
  const sz = 0;
  const g0 = gy(sx, sz);
  const r1 = 0.36;
  const r2 = 0.27;
  const r3 = 0.2;
  const y1 = g0 + r1 * 0.8;
  const y2 = y1 + r1 * 0.78 + r2 * 0.8;
  const y3 = y2 + r2 * 0.8 + r3 * 0.82;
  parts.add(put(lump(rng, r1), sx, y1, sz), SNOW, "solid", 0.015);
  parts.add(put(lump(rng, r2), sx, y2, sz), SNOW, "solid", 0.015);
  parts.add(put(lump(rng, r3), sx, y3, sz), SNOW, "solid", 0.015);
  // Buttons, eyes, a carrot nose and a smile of coal.
  for (const yy of [0.12, 0, -0.12]) {
    const a = Math.asin(yy / r2);
    parts.add(put(ball(0.026, 8, 6), sx, y2 + yy, sz + Math.cos(a) * r2), COAL);
  }
  for (const s of [-1, 1]) {
    parts.add(put(ball(0.022, 8, 6), sx + s * 0.065, y3 + 0.06, sz + r3 * 0.9), COAL);
  }
  parts.add(
    put(cone(0.03, 0.16, 8), sx, y3 + 0.0, sz + r3 + 0.06, Math.PI / 2, 0, 0),
    CARROT,
    "solid",
    0.06,
  );
  for (let i = 0; i < 5; i++) {
    const a = -0.5 + (i / 4) * 1.0;
    parts.add(
      put(
        ball(0.013, 6, 4),
        sx + Math.sin(a) * 0.11,
        y3 - 0.08 + Math.abs(a) * 0.04,
        sz + r3 * 0.93,
      ),
      COAL,
    );
  }
  // Scarf round the neck, one end hanging.
  parts.add(
    put(ring(0.19, 0.05, 20), sx, y2 + r2 * 0.82, sz, Math.PI / 2, 0, 0),
    SCARF,
    "solid",
    0.05,
  );
  parts.add(
    put(ring(0.19, 0.052, 20), sx, y2 + r2 * 0.82, sz, Math.PI / 2, 0, 0, 1, 1, 0.35),
    STRIPE,
  );
  parts.add(
    put(box(0.09, 0.26, 0.035), sx + 0.12, y2 + 0.08, sz + 0.2, 0.25, 0.3, 0.1),
    SCARF,
    "solid",
    0.05,
  );
  for (const f of [0.0, 0.08]) {
    parts.add(
      put(
        box(0.092, 0.025, 0.037),
        sx + 0.12,
        y2 + 0.04 - f,
        sz + 0.205 + f * 0.25,
        0.25,
        0.3,
        0.1,
      ),
      STRIPE,
    );
  }
  // A top hat.
  parts.add(put(cyl(0.2, 0.2, 0.025, 24), sx, y3 + r3 * 0.82, sz), COAL);
  parts.add(put(cyl(0.13, 0.135, 0.22, 24), sx, y3 + r3 * 0.82 + 0.12, sz), COAL);
  parts.add(put(cyl(0.137, 0.137, 0.04, 24), sx, y3 + r3 * 0.82 + 0.04, sz), "#7a3b69");
  parts.add(put(cyl(0.12, 0.13, 0.02, 24), sx, y3 + r3 * 0.82 + 0.235, sz), SNOW);
  parts.collide({ kind: "cyl", x: sx, z: sz, r: 0.13, top: y3 + r3 * 0.82 + 0.245 });
  parts.collide({ kind: "dome", x: sx, z: sz, r: r1, base: y1, h: r1 * 0.8, shed: true });
  arm(parts, sx + 0.22, y2 + 0.05, sz, Math.PI / 2, 0.5, 0.36);
  arm(parts, sx - 0.22, y2 + 0.05, sz, -Math.PI / 2, 0.35, 0.36);

  // A little snowman beside him.
  {
    const x = -0.58;
    const z = 0.32;
    const g = gy(x, z);
    parts.add(put(lump(rng, 0.15), x, g + 0.12, z), SNOW, "solid", 0.015);
    parts.add(put(lump(rng, 0.105), x, g + 0.32, z), SNOW, "solid", 0.015);
    for (const s of [-1, 1])
      parts.add(put(ball(0.013, 6, 4), x + s * 0.035, g + 0.35, z + 0.095), COAL);
    parts.add(put(cone(0.016, 0.08, 6), x, g + 0.32, z + 0.13, Math.PI / 2, 0, 0), CARROT);
    parts.add(put(ring(0.1, 0.028, 16), x, g + 0.23, z, Math.PI / 2, 0, 0), "#b4485c");
    parts.add(put(ball(0.09, 12, 8), x, g + 0.4, z, 0, 0, 0, 1, 0.75, 1), "#b4485c");
    parts.add(put(ball(0.035, 8, 6), x, g + 0.48, z), STRIPE);
  }

  // A sledge, runners curled up at the front.
  {
    const x = 0.55;
    const z = 0.45;
    const yaw = 0.9;
    const place = at(x, z, yaw);
    const g = gy(x, z);
    for (const s of [-1, 1]) {
      const [rx, rz] = place(0, s * 0.11);
      parts.add(put(box(0.46, 0.022, 0.02), rx, g + 0.02, rz, 0, yaw, 0), "#b4485c");
      const [cx, cz] = place(0.24, s * 0.11);
      parts.add(put(ring(0.05, 0.011, 10), cx, g + 0.065, cz, 0, yaw, 0, 1, 1, 1), "#b4485c");
      for (const u of [-0.15, 0.1]) {
        const [px, pz] = place(u, s * 0.11);
        parts.add(put(box(0.02, 0.07, 0.02), px, g + 0.06, pz, 0, yaw, 0), "#7a5236");
      }
    }
    for (let i = 0; i < 5; i++) {
      const [px, pz] = place(-0.18 + i * 0.075, 0);
      parts.add(put(box(0.06, 0.016, 0.28), px, g + 0.1, pz, 0, yaw, 0), "#b48a62", "solid", 0.08);
    }
    parts.collide({ kind: "box", x, z, hw: 0.2, hd: 0.14, yaw, top: g + 0.11 });
  }
  // A pyramid of snowballs.
  {
    const x = -0.25;
    const z = -0.62;
    const g = gy(x, z);
    const r = 0.06;
    const spots: [number, number, number][] = [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, 1.6],
      [0, 1, 0.55],
    ];
    for (const [u, layer, w] of spots) {
      parts.add(
        put(lump(rng, r), x + u * r * 1.05, g + r * 0.8 + layer * r * 1.5, z + (w - 0.55) * r),
        SNOW,
        "solid",
        0.02,
      );
    }
  }
  // A birdhouse on a post, and its bird.
  {
    const x = 0.5;
    const z = -0.62;
    const g = gy(x, z);
    parts.add(put(cyl(0.018, 0.022, 0.5, 6), x, g + 0.25, z), TWIG);
    parts.add(put(box(0.13, 0.12, 0.12), x, g + 0.56, z), "#c9b48a", "solid", 0.06);
    parts.add(
      put(cyl(0.022, 0.022, 0.012, 10), x, g + 0.57, z + 0.062, Math.PI / 2, 0, 0),
      "#2a2420",
    );
    parts.add(put(cone(0.12, 0.08, 4), x, g + 0.66, z, 0, Math.PI / 4, 0), "#3d6e8a");
    parts.add(put(cone(0.09, 0.05, 4), x, g + 0.68, z, 0, Math.PI / 4, 0), SNOW);
    parts.collide({ kind: "cone", x, z, r: 0.11, base: g + 0.62, apex: g + 0.71, shed: true });
  }

  const lamp = lampPost(parts, -0.85, gy(-0.85, -0.25) - 0.02, -0.25, 0.6);
  const lamp2 = lampPost(parts, 0.9, gy(0.9, -0.1) - 0.02, -0.1, 0.55);
  for (const [x, z, h] of [
    [-1.0, 0.55, 0.95],
    [-0.75, -0.85, 0.75],
    [0.15, 1.05, 0.85],
    [1.05, 0.45, 0.65],
    [0.95, -0.75, 1.05],
  ] as const) {
    pine(parts, rng, x, gy(x, z) - 0.02, z, h);
  }

  const group = parts.build(materials);
  const terrain = buildTerrain(hills, parts.colliders);

  // The bird: a round little thing that hops round and looks about.
  const b = new Parts(rng);
  b.add(put(ball(0.035, 10, 8), 0, 0.035, 0, 0, 0, 0, 1.1, 0.95, 1), "#6b4b3a");
  b.add(put(ball(0.026, 8, 6), 0, 0.03, 0.02), "#d9894f");
  b.add(put(ball(0.024, 8, 6), 0, 0.075, 0.018), "#6b4b3a");
  b.add(put(cone(0.008, 0.02, 5), 0, 0.075, 0.048, Math.PI / 2, 0, 0), "#e2b04a");
  b.add(put(box(0.012, 0.012, 0.04), 0, 0.045, -0.04, 0.5, 0, 0), "#4a3a34");
  const bird = new Mesh(b.merged(), materials.solid);
  bird.castShadow = true;
  const perch = new Group();
  perch.position.set(0.5, gy(0.5, -0.62) + 0.7, -0.62);
  perch.add(bird);
  group.add(perch);

  return {
    id: "snowman",
    group,
    terrain,
    lights: [lamp, lamp2, new Vector3(0.0, y2, 0.55)],
    update(t) {
      // Now and then it turns to look another way, with a little hop.
      const beat = Math.floor(t / 2.6);
      const f = t / 2.6 - beat;
      const look = Math.sin(beat * 2.4) * 1.6;
      bird.rotation.y = look;
      bird.position.y = f < 0.12 ? Math.sin((f / 0.12) * Math.PI) * 0.03 : 0;
    },
  };
};
