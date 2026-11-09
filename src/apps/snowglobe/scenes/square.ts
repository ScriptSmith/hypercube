/** A little town square round a frozen pond, skaters gliding on it, lamps lit. */
import { CircleGeometry, Group, Mesh, Vector3 } from "three";
import type { Rng } from "../../../core/types";
import {
  at,
  ball,
  box,
  cone,
  cyl,
  gableRoof,
  lampPost,
  type Materials,
  Parts,
  pine,
  put,
  ring,
  SNOW,
  window4,
} from "../kit";
import { domeY, groundY, type Hills } from "../mound";
import type { BuiltScene } from "../scene";
import { buildTerrain } from "../terrain";
import { ground, person } from "./common";

const POND = 0.6;
/** The pond sits level with the top of the hill, so people looking up from below see skaters. */
const ICE = domeY(POND + 0.08) + 0.12;

const hills: Hills = (x, z) => {
  const rho = Math.hypot(x, z);
  const plateau = Math.exp(-((rho / (POND + 0.12)) ** 6));
  const bumps = 0.05 * Math.sin(2.1 * x + 1) * Math.cos(1.7 * z);
  return plateau * (ICE - 0.03 - domeY(rho)) + (1 - plateau) * bumps;
};

interface Skater {
  mesh: Mesh;
  radius: number;
  speed: number;
  phase: number;
}

export const makeSquare = (rng: Rng, materials: Materials): BuiltScene => {
  const parts = new Parts(rng);
  const gy = (x: number, z: number) => groundY(hills, x, z);
  ground(parts, rng, hills);

  // The pond: ice a little above the snow in the hollow, a bank of snow round it.
  const ice = ICE;
  const disc = new CircleGeometry(POND, 48);
  disc.rotateX(-Math.PI / 2);
  disc.translate(0, ice, 0);
  parts.add(disc, "#bcd2e4", "gloss", 0.02);
  // A low bank of snow round it, low enough to see the skaters over from below.
  parts.add(
    put(ring(POND + 0.03, 0.03, 40), 0, ice, 0, Math.PI / 2, 0, 0, 1, 1, 0.7),
    SNOW,
    "solid",
    0.03,
  );
  parts.collide({ kind: "cyl", x: 0, z: 0, r: POND, top: ice });

  // Houses round the square, facing the pond.
  const houses: { a: number; wall: string; roof: string; tall: number; clock?: boolean }[] = [
    { a: 0.5, wall: "#4f8a8b", roof: "#33404a", tall: 0.62 },
    { a: 2.6, wall: "#e2c48c", roof: "#7a3530", tall: 0.95, clock: true },
    { a: 4.6, wall: "#c46f6a", roof: "#3a3f4c", tall: 0.7 },
  ];
  for (const h of houses) {
    const d = 1.08;
    const cx = Math.sin(h.a) * d;
    const cz = Math.cos(h.a) * d;
    // Its front (+w) looks at the pond.
    const yaw = h.a + Math.PI;
    const place = at(cx, cz, yaw);
    const hw = h.clock ? 0.17 : 0.22;
    const hd = 0.16;
    let b = -Infinity;
    for (const [u, w] of [
      [-hw, -hd],
      [hw, -hd],
      [-hw, hd],
      [hw, hd],
    ] as const) {
      const [x, z] = place(u, w);
      b = Math.max(b, gy(x, z));
    }
    parts.add(
      put(box(2 * hw, h.tall + 0.2, 2 * hd), cx, b + h.tall / 2 - 0.1, cz, 0, yaw, 0),
      h.wall,
      "solid",
      0.03,
    );
    const ridge = gableRoof(
      parts,
      place,
      yaw,
      hw,
      hd,
      b + h.tall,
      h.clock ? 0.26 : 0.2,
      h.roof,
      0.04,
      0.7,
    );
    const floors = h.clock ? 2 : Math.round(h.tall / 0.3);
    for (let f = 0; f < floors; f++) {
      const y = b + 0.16 + f * 0.27;
      if (h.clock) window4(parts, place, yaw, 0, y, hd, 0.09, 0.12);
      else {
        window4(parts, place, yaw, -0.09, y, hd, 0.08, 0.11);
        window4(parts, place, yaw, 0.09, y, hd, 0.08, 0.11);
      }
      const back = (u: number, w: number) => place(-u, -w);
      window4(parts, back, yaw + Math.PI, 0, y, hd, 0.08, 0.11);
    }
    if (h.clock) {
      const [fx, fz] = place(0, hd + 0.012);
      const fy = b + h.tall - 0.12;
      parts.add(
        put(cyl(0.085, 0.085, 0.02, 24), fx, fy, fz, Math.PI / 2, yaw, 0),
        "#fff4d6",
        "glow",
      );
      parts.add(put(ring(0.088, 0.01, 24), fx, fy, fz, 0, yaw, 0), "#3a2a20");
      const [hx, hz] = place(0, hd + 0.026);
      parts.add(put(box(0.008, 0.06, 0.006), hx, fy + 0.025, hz, 0, yaw, 0), "#2a2420");
      parts.add(put(box(0.045, 0.008, 0.006), hx + 0.0, fy, hz, 0, yaw, 0.3), "#2a2420");
      parts.add(put(ball(0.02, 8, 6), cx, ridge + 0.03, cz), "#c9a24a");
    } else {
      const [chx, chz] = place(hw * 0.5, -hd * 0.3);
      parts.add(put(box(0.06, 0.22, 0.06), chx, b + h.tall + 0.16, chz, 0, yaw, 0), "#7a6f66");
      parts.collide({
        kind: "box",
        x: chx,
        z: chz,
        hw: 0.035,
        hd: 0.035,
        yaw,
        top: b + h.tall + 0.27,
      });
    }
    const [dx, dz] = place(h.clock ? 0 : hw * 0.55, hd + 0.01);
    if (!h.clock) parts.add(put(box(0.08, 0.15, 0.02), dx, b + 0.075, dz, 0, yaw, 0), "#3b2a20");
  }

  // Lamps between the houses, pines and benches round the edge.
  const lamps: Vector3[] = [];
  for (const a of [1.55, 3.6, 5.6]) {
    const x = Math.sin(a) * 0.86;
    const z = Math.cos(a) * 0.86;
    lamps.push(lampPost(parts, x, gy(x, z) - 0.02, z, 0.55));
  }
  for (const [a, d, h] of [
    [1.2, 1.25, 0.8],
    [1.95, 1.2, 0.65],
    [3.2, 1.25, 0.75],
    [5.15, 1.25, 0.85],
    [6.05, 1.22, 0.6],
  ] as const) {
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    pine(parts, rng, x, gy(x, z) - 0.02, z, h);
  }
  for (const a of [1.85, 5.95]) {
    const d = 0.83;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const yaw = a + Math.PI;
    const place = at(x, z, yaw);
    const y = gy(x, z);
    const wood = "#7a5236";
    parts.add(put(box(0.26, 0.02, 0.08), x, y + 0.1, z, 0, yaw, 0), wood);
    const [bx, bz] = place(0, -0.04);
    parts.add(put(box(0.26, 0.08, 0.015), bx, y + 0.16, bz, -0.15, yaw, 0), wood);
    parts.add(put(box(0.24, 0.015, 0.06), x, y + 0.118, z, 0, yaw, 0), SNOW);
    for (const s of [-1, 1]) {
      const [lx, lz] = place(s * 0.11, 0);
      parts.add(put(box(0.02, 0.1, 0.07), lx, y + 0.05, lz, 0, yaw, 0), "#2c3138");
    }
  }
  // A snowman someone built by the pond.
  {
    const a = 3.0;
    const x = Math.sin(a) * 0.72;
    const z = Math.cos(a) * 0.72;
    const y = gy(x, z);
    parts.add(put(ball(0.09, 10, 8), x, y + 0.07, z), SNOW, "solid", 0.02);
    parts.add(put(ball(0.065, 10, 8), x, y + 0.2, z), SNOW, "solid", 0.02);
    parts.add(
      put(
        cone(0.012, 0.05, 6),
        x + Math.sin(a) * 0.065,
        y + 0.2,
        z + Math.cos(a) * 0.065,
        Math.PI / 2,
        a,
        0,
      ),
      "#e07b2c",
    );
    parts.add(put(ring(0.055, 0.015, 12), x, y + 0.155, z, Math.PI / 2, 0, 0), "#3f6fa8");
  }

  const group = parts.build(materials);
  const terrain = buildTerrain(hills, parts.colliders);

  const skaters: Skater[] = [];
  const crowd = new Group();
  for (let i = 0; i < 4; i++) {
    const mesh = new Mesh(person(rng, rng.range(0.29, 0.34)), materials.solid);
    mesh.castShadow = true;
    crowd.add(mesh);
    skaters.push({
      mesh,
      radius: [0.22, 0.38, 0.47, 0.32][i]!,
      speed: [0.26, -0.2, 0.17, 0.22][i]!,
      phase: rng.range(0, Math.PI * 2),
    });
  }
  group.add(crowd);

  return {
    id: "square",
    group,
    terrain,
    lights: [lamps[0]!, lamps[1]!, lamps[2]!],
    update(t) {
      for (const s of skaters) {
        // Gliding round, swinging gently in and out with each stride.
        const a = s.phase + t * s.speed * 2;
        const r = s.radius + 0.03 * Math.sin(t * 1.7 + s.phase);
        const m = s.mesh;
        m.position.set(Math.sin(a) * r, ice + 0.005, Math.cos(a) * r);
        // Facing along the way round, leaning into the turn.
        m.rotation.set(0, a + (s.speed > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
        m.rotateZ(s.speed > 0 ? -0.12 : 0.12);
      }
    },
  };
};
