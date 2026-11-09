/** A lighthouse on a rocky island in a frozen sea, its lamp turning, a keeper's cottage below. */
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import type { Rng } from "../../../core/types";
import {
  at,
  ball,
  box,
  cone,
  cyl,
  gableRoof,
  type Materials,
  Parts,
  pine,
  put,
  ring,
  SNOW,
  stone,
  window4,
} from "../kit";
import { domeY, groundY, type Hills, RIM_Y } from "../mound";
import { noise3 } from "../noise";
import type { BuiltScene } from "../scene";
import { buildTerrain } from "../terrain";
import { ground } from "./common";

const SEA = RIM_Y + 0.07;
const WHITE = "#efece4";
const BAND = "#b23b3b";
/** Seconds for the lamp to go round once. */
const LAMP_TURN = 9;

const island = (x: number, z: number) =>
  0.3 * Math.exp(-((x - 0.02) ** 2 + (z + 0.04) ** 2) / 0.26) + 0.03 * noise3(x * 4, 0.3, z * 4);

// A flat frozen sea round a rocky island: the dome is cancelled outside the island.
const hills: Hills = (x, z) => {
  const rho = Math.hypot(x, z);
  const sea = SEA - domeY(rho);
  const isle = Math.exp(-((rho / 0.62) ** 4));
  return sea + (island(x, z) + (domeY(rho) - SEA) * 0.25) * isle;
};

export const makeLighthouse = (rng: Rng, materials: Materials): BuiltScene => {
  const parts = new Parts(rng);
  const gy = (x: number, z: number) => groundY(hills, x, z);
  ground(parts, rng, hills, {
    paint: (x, z) => {
      const rho = Math.hypot(x, z);
      if (rho < 0.62) return null;
      const crack = Math.abs(noise3(x * 6, 2.1, z * 6)) < 0.04;
      return crack ? "#9fb6c8" : rho < 0.72 ? "#dfe8f1" : "#c4d6e6";
    },
  });

  // Rocks heaped into the island.
  for (let i = 0; i < 22; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0.15, 0.62);
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const s = rng.range(0.08, 0.17) * (1.1 - d * 0.6);
    const y = gy(x, z);
    parts.add(
      put(stone(rng, s, 1), x, y + s * 0.15, z, 0, rng.range(0, 6), 0),
      "#6f6a66",
      "solid",
      0.14,
    );
    if (rng.next() < 0.7) {
      parts.add(
        put(stone(rng, s * 0.8, 1), x, y + s * 0.55, z, 0, 0, 0, 1, 0.3, 1),
        SNOW,
        "solid",
        0.03,
      );
    }
  }
  // Ice floes on the frozen sea.
  for (let i = 0; i < 16; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0.8, 1.35);
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const s = rng.range(0.06, 0.13);
    parts.add(
      put(stone(rng, s, 0), x, gy(x, z) + 0.01, z, 0, rng.range(0, 6), 0, 1, 0.22, 1),
      "#eaf1f7",
      "solid",
      0.04,
    );
  }

  // The tower.
  const tx = 0.02;
  const tz = -0.04;
  const base = gy(tx, tz) + 0.02;
  parts.add(put(cyl(0.26, 0.29, 0.16, 16), tx, base, tz), "#8a8580", "solid", 0.1);
  const foot = base + 0.08;
  const height = 1.32;
  const rb = 0.2;
  const rt = 0.135;
  parts.add(put(cyl(rt, rb, height, 20), tx, foot + height / 2, tz), WHITE, "solid", 0.02);
  for (const f of [0.18, 0.5, 0.82]) {
    const y0 = f * height - 0.08;
    const y1 = f * height + 0.08;
    const r0 = rb + (rt - rb) * (y0 / height) + 0.004;
    const r1 = rb + (rt - rb) * (y1 / height) + 0.004;
    parts.add(put(cyl(r1, r0, y1 - y0, 20), tx, foot + (y0 + y1) / 2, tz), BAND, "solid", 0.03);
  }
  // A door and little windows up the stair.
  parts.add(put(box(0.11, 0.2, 0.03), tx, foot + 0.1, tz + rb - 0.005), "#3b2c24");
  for (const [f, a] of [
    [0.36, 0.4],
    [0.66, 2.6],
    [0.36, 4.4],
  ] as const) {
    const r = rb + (rt - rb) * f + 0.003;
    parts.add(
      put(
        box(0.05, 0.08, 0.02),
        tx + Math.sin(a) * r,
        foot + f * height,
        tz + Math.cos(a) * r,
        0,
        a,
        0,
      ),
      "#ffcf7a",
      "glow",
    );
  }
  const top = foot + height;
  parts.add(put(cyl(0.22, 0.17, 0.05, 20), tx, top + 0.02, tz), "#2f3338");
  parts.add(put(ring(0.21, 0.008, 28), tx, top + 0.12, tz, Math.PI / 2, 0, 0), "#2f3338");
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    parts.add(
      put(cyl(0.006, 0.006, 0.09, 4), tx + Math.sin(a) * 0.21, top + 0.08, tz + Math.cos(a) * 0.21),
      "#2f3338",
    );
  }
  const lampY = top + 0.15;
  parts.add(put(cyl(0.11, 0.11, 0.2, 16), tx, lampY, tz), "#fff0b8", "glow", 0.02);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.add(
      put(box(0.012, 0.2, 0.012), tx + Math.sin(a) * 0.112, lampY, tz + Math.cos(a) * 0.112),
      "#2f3338",
    );
  }
  parts.add(put(cone(0.16, 0.15, 16), tx, lampY + 0.17, tz), BAND, "solid", 0.03);
  parts.add(put(cone(0.12, 0.08, 16), tx, lampY + 0.2, tz), SNOW);
  parts.add(put(ball(0.03, 8, 6), tx, lampY + 0.27, tz), "#2f3338");
  parts.collide({
    kind: "cone",
    x: tx,
    z: tz,
    r: 0.17,
    base: lampY + 0.1,
    apex: lampY + 0.27,
    shed: true,
  });
  parts.collide({ kind: "cyl", x: tx, z: tz, r: 0.22, top: top + 0.045 });

  // The keeper's cottage.
  const cx = 0.38;
  const cz = 0.26;
  const yaw = -0.6;
  const place = at(cx, cz, yaw);
  const hw = 0.2;
  const hd = 0.15;
  let cb = -Infinity;
  for (const [u, w] of [
    [-hw, -hd],
    [hw, -hd],
    [-hw, hd],
    [hw, hd],
  ] as const) {
    const [x, z] = place(u, w);
    cb = Math.max(cb, gy(x, z));
  }
  const wallH = 0.24;
  parts.add(
    put(box(2 * hw, wallH + 0.2, 2 * hd), cx, cb + wallH / 2 - 0.1, cz, 0, yaw, 0),
    WHITE,
    "solid",
    0.03,
  );
  gableRoof(parts, place, yaw, hw, hd, cb + wallH, 0.15, "#3d4650", 0.05, 0.7);
  window4(parts, place, yaw, -0.08, cb + 0.13, hd, 0.09, 0.1, "#2f3338");
  window4(parts, place, yaw, 0.09, cb + 0.13, hd, 0.09, 0.1, "#2f3338");
  {
    const p = (u: number, w: number) => place(u, -w);
    window4(parts, p, yaw + Math.PI, 0, cb + 0.13, hd, 0.09, 0.1, "#2f3338");
  }
  const [chx, chz] = place(-0.12, -0.05);
  parts.add(put(box(0.07, 0.2, 0.07), chx, cb + wallH + 0.14, chz, 0, yaw, 0), "#77716b");
  parts.collide({ kind: "box", x: chx, z: chz, hw: 0.04, hd: 0.04, yaw, top: cb + wallH + 0.24 });

  for (const [x, z, h] of [
    [-0.42, 0.3, 0.55],
    [-0.35, -0.42, 0.42],
  ] as const) {
    pine(parts, rng, x, gy(x, z) - 0.02, z, h);
  }

  const group = parts.build(materials);
  const terrain = buildTerrain(hills, parts.colliders);

  // The beam: two long cones of light from the lamp, fading out along their length.
  const beamGeo = new ConeGeometry(0.2, 1.5, 20, 6, true);
  beamGeo.translate(0, -0.75, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const pos = beamGeo.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const warm = new Color("#ffe6a8");
  for (let i = 0; i < pos.count; i++) {
    const f = Math.max(0, 1 - pos.getX(i) / 1.5);
    colors.set([warm.r * f * f, warm.g * f * f, warm.b * f * f], i * 3);
  }
  beamGeo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const beamMat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.3,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  const beam = new Group();
  beam.position.set(tx, lampY, tz);
  const one = new Mesh(beamGeo, beamMat);
  const two = new Mesh(beamGeo, beamMat);
  two.rotation.y = Math.PI;
  beam.add(one, two);
  group.add(beam);

  const [wx, wz] = place(0, hd + 0.45);
  return {
    id: "lighthouse",
    group,
    terrain,
    lights: [
      new Vector3(tx, lampY, tz),
      new Vector3(wx, cb + 0.15, wz),
      new Vector3(tx + 0.05, foot + 0.3, tz + rb + 0.25),
    ],
    update(t) {
      beam.rotation.y = ((t / LAMP_TURN) % 1) * Math.PI * 2;
      beamMat.opacity = 0.3 * (1 - materials.dissolve.value);
    },
  };
};
