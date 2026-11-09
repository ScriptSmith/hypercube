/** A log cabin among pines, its windows lit, smoke curling from its chimney. */
import { Color, ExtrudeGeometry, Float32BufferAttribute, Group, Mesh, Shape, Vector3 } from "three";
import type { Rng } from "../../../core/types";
import { ground } from "./common";
import {
  at,
  ball,
  box,
  cyl,
  gableRoof,
  lampPost,
  type Materials,
  Parts,
  pine,
  put,
  SNOW,
  stone,
  window4,
} from "../kit";
import { groundY, type Hills } from "../mound";
import type { BuiltScene } from "../scene";
import { buildTerrain } from "../terrain";

const LOG = "#7a5236";
const LOG_END = "#b48a62";
const ROOF = "#6e2f2a";
const STONE = "#8a8580";
const PUFFS = 7;

const hills: Hills = (x, z) =>
  0.07 * Math.sin(1.4 * x + 0.6) * Math.cos(1.2 * z - 0.3) +
  0.14 * Math.exp(-((x + 0.75) ** 2 + (z - 0.55) ** 2) / 0.22) -
  0.05 * Math.exp(-((x - 0.1) ** 2 + (z + 0.05) ** 2) / 0.3);

export const makeCabin = (rng: Rng, materials: Materials): BuiltScene => {
  const parts = new Parts(rng);
  const gy = (x: number, z: number) => groundY(hills, x, z);
  ground(parts, rng, hills);

  const cx = 0.1;
  const cz = -0.05;
  const yaw = 0.35;
  const place = at(cx, cz, yaw);
  const hw = 0.42;
  const hd = 0.32;
  let base = -Infinity;
  for (const [u, w] of [
    [-hw, -hd],
    [hw, -hd],
    [-hw, hd],
    [hw, hd],
    [0, 0],
  ] as const) {
    const [x, z] = place(u, w);
    base = Math.max(base, gy(x, z));
  }
  // A stone footing, down into the snow so the cabin never floats.
  parts.add(put(box(2 * hw + 0.06, 0.3, 2 * hd + 0.06), cx, base - 0.13, cz, 0, yaw, 0), STONE);

  const r = 0.042;
  const courses = 7;
  const step = 2 * r * 0.92;
  for (let k = 0; k < courses; k++) {
    const y = base + 0.02 + r + k * step;
    const long = k % 2 === 0;
    for (const side of [-1, 1]) {
      const [x, z] = long ? place(0, side * hd) : place(side * hw, 0);
      const len = long ? 2 * hw + 0.12 : 2 * hd + 0.12;
      const g = long
        ? put(cyl(r, r, len, 9), x, y, z, 0, yaw, Math.PI / 2)
        : put(cyl(r, r, len, 9), x, y + r * 0.92, z, Math.PI / 2, yaw, 0);
      parts.add(g, LOG, "solid", 0.1);
      // Cut ends at the corners.
      for (const end of [-1, 1]) {
        const [ex, ez] = long
          ? place(end * (hw + 0.06), side * hd)
          : place(side * hw, end * (hd + 0.06));
        const ey = long ? y : y + r * 0.92;
        const disc = long
          ? put(cyl(r * 0.92, r * 0.92, 0.012, 9), ex, ey, ez, 0, yaw, Math.PI / 2)
          : put(cyl(r * 0.92, r * 0.92, 0.012, 9), ex, ey, ez, Math.PI / 2, yaw, 0);
        parts.add(disc, LOG_END, "solid", 0.06);
      }
    }
  }
  const eave = base + 0.02 + courses * step + r;
  const rise = 0.34;
  // Gable ends: boards in a triangle above each short wall.
  const tri = new Shape();
  tri.moveTo(-hd, 0);
  tri.lineTo(hd, 0);
  tri.lineTo(0, rise);
  tri.closePath();
  for (const side of [-1, 1]) {
    const g = new ExtrudeGeometry(tri, { depth: 0.04, bevelEnabled: false });
    g.translate(0, 0, -0.02);
    const [x, z] = place(side * (hw - 0.01), 0);
    parts.add(put(g, x, eave - 0.01, z, 0, yaw + Math.PI / 2, 0), "#6a4630", "solid", 0.04);
  }
  const ridge = gableRoof(parts, place, yaw, hw + 0.04, hd, eave, rise, ROOF, 0.1, 0.6);

  // Chimney, on the far slope, and its stone cap.
  const [chx, chz] = place(hw - 0.16, -hd * 0.45);
  const chTop = ridge + 0.14;
  const chH = chTop - base;
  parts.add(put(box(0.15, chH, 0.15), chx, base + chH / 2, chz, 0, yaw, 0), STONE, "solid", 0.12);
  parts.add(put(box(0.19, 0.04, 0.19), chx, chTop + 0.02, chz, 0, yaw, 0), "#6d6964");
  parts.add(put(box(0.17, 0.025, 0.17), chx, chTop + 0.05, chz, 0, yaw, 0), SNOW);
  parts.collide({ kind: "box", x: chx, z: chz, hw: 0.09, hd: 0.09, yaw, top: chTop + 0.06 });

  // Windows on three sides, a door on the fourth.
  const sill = base + 0.3;
  for (const side of [-1, 1]) {
    const wy = side > 0 ? yaw : yaw + Math.PI;
    const p = (u: number, w: number) => place(side * u, side * w);
    window4(parts, p, wy, -0.2, sill, hd + r, 0.13, 0.15);
    window4(parts, p, wy, 0.2, sill, hd + r, 0.13, 0.15);
  }
  {
    const p = (u: number, w: number) => place(-w, u);
    window4(parts, p, yaw - Math.PI / 2, 0, sill, hw + r, 0.14, 0.15);
  }
  const [dx, dz] = place(hw + r + 0.006, 0.02);
  parts.add(put(box(0.012, 0.32, 0.17), dx, base + 0.18, dz, 0, yaw, 0), "#4a2f1f");
  parts.add(put(ball(0.012, 6, 4), dx + 0.01, base + 0.18, dz + 0.05), "#c9a24a");
  const [lx, lz] = place(hw + r + 0.03, -0.14);
  parts.add(put(box(0.05, 0.07, 0.05), lx, base + 0.42, lz, 0, yaw, 0), "#ffd890", "glow");
  parts.add(put(box(0.07, 0.015, 0.07), lx, base + 0.465, lz, 0, yaw, 0), "#2c3138");
  // Step and a mat of snow at the door.
  const [sx, sz] = place(hw + r + 0.08, 0.02);
  parts.add(put(box(0.12, 0.05, 0.22), sx, base + 0.0, sz, 0, yaw, 0), STONE);

  // A woodpile along the back wall.
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4 - (i >> 1); j++) {
      const [wx, wz] = place(-0.3 + j * 0.075 + (i % 2) * 0.035, -(hd + r + 0.08));
      parts.add(
        put(cyl(0.034, 0.034, 0.2, 7), wx, base + 0.04 + i * 0.062, wz, Math.PI / 2, yaw, 0),
        i % 2 ? "#8a6242" : "#7a5236",
        "solid",
        0.12,
      );
    }
  }
  {
    const [wx, wz] = place(-0.2, -(hd + r + 0.08));
    parts.add(put(box(0.36, 0.03, 0.22), wx, base + 0.27, wz, 0, yaw, 0), SNOW);
  }

  // Pines all round, and a lamp by the path.
  const trees: [number, number, number][] = [
    [-0.95, 0.35, 1.25],
    [-0.75, 0.85, 0.85],
    [0.35, 1.05, 1.05],
    [1.0, 0.55, 0.75],
    [0.95, -0.7, 1.35],
    [-0.2, -1.05, 0.95],
    [-0.95, -0.55, 0.7],
    [0.55, -1.0, 0.6],
  ];
  for (const [x, z, h] of trees) pine(parts, rng, x, gy(x, z) - 0.02, z, h);
  const lamp = lampPost(parts, 0.75, gy(0.75, 0.3) - 0.02, 0.3, 0.6);
  // Rocks poking through the snow.
  for (const [x, z, s] of [
    [-0.45, -0.85, 0.09],
    [1.15, -0.1, 0.07],
    [-1.2, 0.0, 0.08],
  ] as const) {
    parts.add(put(stone(rng, s, 0), x, gy(x, z), z), "#77716b", "solid", 0.1);
    parts.add(put(stone(rng, s * 0.8, 0), x, gy(x, z) + s * 0.45, z, 0, 0, 0, 1, 0.35, 1), SNOW);
  }

  const group = parts.build(materials);
  const terrain = buildTerrain(hills, parts.colliders);

  // Smoke: soft puffs rising from the chimney and thinning out, round and round.
  const puffGeo = ball(1, 10, 7);
  const n = puffGeo.attributes.position!.count;
  const col = new Float32Array(n * 3);
  const c = new Color("#dfe3ea");
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  puffGeo.setAttribute("color", new Float32BufferAttribute(col, 3));
  const smoke = new Group();
  const puffs: Mesh[] = [];
  for (let i = 0; i < PUFFS; i++) {
    const m = new Mesh(puffGeo, materials.solid);
    m.castShadow = false;
    puffs.push(m);
    smoke.add(m);
  }
  group.add(smoke);
  const chimney = new Vector3(chx, chTop + 0.08, chz);
  const drift = rng.range(0, Math.PI * 2);

  const windowLight = (side: number) => {
    const [x, z] = place(0, side * (hd + 0.3));
    return new Vector3(x, sill + 0.05, z);
  };

  return {
    id: "cabin",
    group,
    terrain,
    lights: [windowLight(1), windowLight(-1), new Vector3(lamp.x, lamp.y, lamp.z)],
    update(t) {
      for (let i = 0; i < PUFFS; i++) {
        const f = (t * 0.06 + i / PUFFS) % 1;
        const size = 0.04 + 0.09 * f;
        const fadeIn = Math.min(1, f * 6);
        const fadeOut = Math.min(1, (1 - f) * 3);
        const m = puffs[i]!;
        const lean = drift + 0.5 * Math.sin(t * 0.05);
        m.position.set(
          chimney.x + Math.sin(lean) * f * 0.45 + 0.03 * Math.sin(t * 0.7 + i),
          chimney.y + f * 0.75,
          chimney.z + Math.cos(lean) * f * 0.45,
        );
        m.scale.setScalar(size * fadeIn * fadeOut + 1e-4);
      }
    },
  };
};
