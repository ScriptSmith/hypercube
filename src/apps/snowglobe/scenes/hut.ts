/** A mountain hut under a rocky peak, a chairlift carrying people up to the top. */
import { Group, Mesh, Vector3 } from "three";
import type { Rng } from "../../../core/types";
import {
  at,
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
import { ground, person } from "./common";

const PEAK_X = 0.5;
const PEAK_Z = -0.38;
const CHAIRS = 10;
/** Metres a second along the cable. */
const LIFT_SPEED = 0.07;
const STEEL = "#4a5058";

const hills: Hills = (x, z) =>
  0.98 * Math.exp(-((x - PEAK_X) ** 2 + (z - PEAK_Z) ** 2) / 0.17) +
  0.22 * Math.exp(-((x - 0.05) ** 2 + (z + 0.05) ** 2) / 0.35) +
  0.04 * Math.sin(3.1 * x + 0.5) * Math.cos(2.7 * z);

const lerp3 = (a: Vector3, b: Vector3, f: number, out: Vector3) => out.copy(a).lerp(b, f);

export const makeHut = (rng: Rng, materials: Materials): BuiltScene => {
  const parts = new Parts(rng);
  const gy = (x: number, z: number) => groundY(hills, x, z);
  ground(parts, rng, hills, { rocky: 0.9 });

  // Crags and boulders on the peak.
  for (let i = 0; i < 12; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0.1, 0.4);
    const x = PEAK_X + Math.sin(a) * d;
    const z = PEAK_Z + Math.cos(a) * d;
    const s = rng.range(0.06, 0.12);
    parts.add(
      put(stone(rng, s, 1), x, gy(x, z), z, 0, rng.range(0, 6), 0),
      "#6d6762",
      "solid",
      0.14,
    );
  }

  // The hut: stone below, timber above, a deep roof of snow.
  const hx = -0.55;
  const hz = 0.32;
  const yaw = -0.5;
  const place = at(hx, hz, yaw);
  const hw = 0.3;
  const hd = 0.22;
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
  parts.add(put(box(2 * hw, 0.36, 2 * hd), hx, b - 0.08, hz, 0, yaw, 0), "#87817a", "solid", 0.12);
  const wall = 0.34;
  parts.add(
    put(
      box(2 * hw - 0.02, wall - 0.1, 2 * hd - 0.02),
      hx,
      b + 0.1 + (wall - 0.1) / 2,
      hz,
      0,
      yaw,
      0,
    ),
    "#8a5a3c",
    "solid",
    0.06,
  );
  for (let k = 0; k < 4; k++) {
    const [px, pz] = place(0, hd - 0.004);
    parts.add(
      put(box(2 * hw - 0.01, 0.01, 0.012), px, b + 0.14 + k * 0.055, pz, 0, yaw, 0),
      "#6e4630",
    );
  }
  gableRoof(parts, place, yaw, hw, hd, b + wall, 0.27, "#5b3a2a", 0.09, 0.95);
  window4(parts, place, yaw, -0.13, b + 0.2, hd, 0.1, 0.11);
  window4(parts, place, yaw, 0.13, b + 0.2, hd, 0.1, 0.11);
  window4(parts, (u, w) => place(-u, -w), yaw + Math.PI, 0, b + 0.2, hd, 0.1, 0.11);
  window4(parts, (u, w) => place(-w, u), yaw - Math.PI / 2, 0, b + 0.22, hw, 0.09, 0.1);
  // A balcony along the front.
  {
    const [bx, bz] = place(0, hd + 0.08);
    parts.add(put(box(2 * hw, 0.02, 0.16), bx, b + 0.1, bz, 0, yaw, 0), "#7a5236");
    parts.add(put(box(2 * hw - 0.02, 0.02, 0.14), bx, b + 0.115, bz, 0, yaw, 0), SNOW);
    const [rx, rz] = place(0, hd + 0.155);
    parts.add(put(box(2 * hw, 0.018, 0.018), rx, b + 0.22, rz, 0, yaw, 0), "#6e4630");
    for (let i = 0; i <= 8; i++) {
      const [px, pz] = place(-hw + (i / 8) * 2 * hw, hd + 0.155);
      parts.add(put(box(0.014, 0.12, 0.014), px, b + 0.16, pz, 0, yaw, 0), "#6e4630");
    }
  }
  const [chx, chz] = place(hw * 0.45, -hd * 0.3);
  parts.add(put(box(0.09, 0.32, 0.09), chx, b + wall + 0.18, chz, 0, yaw, 0), "#87817a");
  parts.add(put(box(0.11, 0.03, 0.11), chx, b + wall + 0.35, chz, 0, yaw, 0), SNOW);
  parts.collide({ kind: "box", x: chx, z: chz, hw: 0.05, hd: 0.05, yaw, top: b + wall + 0.37 });
  const [lx, lz] = place(hw + 0.02, 0.06);
  parts.add(put(box(0.045, 0.06, 0.045), lx, b + 0.3, lz, 0, yaw, 0), "#ffd890", "glow");

  // The chairlift: a station at each end, two pylons, the cable on both sides.
  const bottom = new Vector3(-0.12, 0, 0.62);
  const top = new Vector3(0.36, 0, -0.2);
  const dir = top.clone().sub(bottom).setY(0).normalize();
  const side = new Vector3(dir.z, 0, -dir.x);
  const along = (f: number) => {
    const x = bottom.x + (top.x - bottom.x) * f;
    const z = bottom.z + (top.z - bottom.z) * f;
    return new Vector3(x, gy(x, z), z);
  };
  const lineYaw = Math.atan2(dir.x, dir.z);
  const supports: Vector3[] = [];
  for (const [f, tall] of [
    [0, 0.42],
    [0.36, 0.62],
    [0.7, 0.58],
    [1, 0.4],
  ] as const) {
    const g = along(f);
    supports.push(new Vector3(g.x, g.y + tall, g.z));
    if (f === 0 || f === 1) {
      // A little station with the big wheel on top.
      parts.add(
        put(box(0.24, 0.2, 0.2), g.x, g.y + 0.08, g.z, 0, lineYaw, 0),
        "#9a3f3a",
        "solid",
        0.05,
      );
      parts.add(put(box(0.27, 0.03, 0.23), g.x, g.y + 0.19, g.z, 0, lineYaw, 0), SNOW);
      parts.add(
        put(cyl(0.025, 0.025, tall - 0.18, 6), g.x, g.y + 0.18 + (tall - 0.18) / 2, g.z),
        STEEL,
      );
      parts.add(put(cyl(0.095, 0.095, 0.025, 20), g.x, g.y + tall, g.z), STEEL);
      parts.collide({
        kind: "box",
        x: g.x,
        z: g.z,
        hw: 0.135,
        hd: 0.115,
        yaw: lineYaw,
        top: g.y + 0.21,
      });
    } else {
      parts.add(put(cyl(0.022, 0.032, tall, 8), g.x, g.y + tall / 2, g.z), STEEL);
      parts.add(
        put(box(0.22, 0.025, 0.03), g.x, g.y + tall, g.z, 0, lineYaw + Math.PI / 2, 0),
        STEEL,
      );
      parts.add(
        put(box(0.2, 0.015, 0.025), g.x, g.y + tall + 0.02, g.z, 0, lineYaw + Math.PI / 2, 0),
        SNOW,
      );
    }
  }
  const cable = (a: Vector3, c: Vector3) => {
    const mid = a.clone().add(c).multiplyScalar(0.5);
    const d = c.clone().sub(a);
    const len = d.length();
    const tip = Math.acos(d.y / len);
    const az = Math.atan2(d.x, d.z);
    parts.add(
      put(cyl(0.007, 0.007, len, 5), mid.x, mid.y, mid.z, tip, az, 0),
      "#23272d",
      "solid",
      0,
    );
  };
  const off = 0.09;
  const up: Vector3[] = supports.map((p) => p.clone().addScaledVector(side, off));
  const down: Vector3[] = supports.map((p) => p.clone().addScaledVector(side, -off));
  for (let i = 0; i < supports.length - 1; i++) {
    cable(up[i]!, up[i + 1]!);
    cable(down[i]!, down[i + 1]!);
  }

  const lamp = lampPost(
    parts,
    bottom.x - 0.2,
    gy(bottom.x - 0.2, bottom.z + 0.1) - 0.02,
    bottom.z + 0.1,
    0.5,
  );
  for (const [x, z, h] of [
    [-1.0, -0.2, 0.9],
    [-0.75, -0.62, 0.7],
    [-0.15, -0.85, 0.8],
    [0.25, 0.95, 0.75],
    [0.95, 0.35, 0.85],
    [1.0, -0.3, 0.6],
    [-1.05, 0.65, 0.65],
    [0.62, 0.55, 0.55],
  ] as const) {
    pine(parts, rng, x, gy(x, z) - 0.02, z, h);
  }

  const group = parts.build(materials);
  const terrain = buildTerrain(hills, parts.colliders);

  // Chairs: round the loop, up one side and down the other, a few with riders.
  const legs: { a: Vector3; b: Vector3; len: number }[] = [];
  for (let i = 0; i < up.length - 1; i++)
    legs.push({ a: up[i]!, b: up[i + 1]!, len: up[i]!.distanceTo(up[i + 1]!) });
  for (let i = down.length - 1; i > 0; i--) {
    legs.push({ a: down[i]!, b: down[i - 1]!, len: down[i]!.distanceTo(down[i - 1]!) });
  }
  const loop = legs.reduce((s, l) => s + l.len, 0);
  const chairs: Group[] = [];
  const lift = new Group();
  for (let i = 0; i < CHAIRS; i++) {
    const c = new Parts(rng);
    c.add(put(box(0.011, 0.15, 0.011), 0, -0.075, 0), STEEL);
    c.add(put(box(0.19, 0.02, 0.1), 0, -0.155, 0.025), "#3d6e8a");
    c.add(put(box(0.19, 0.1, 0.016), 0, -0.11, -0.02), "#3d6e8a");
    c.add(put(box(0.012, 0.06, 0.1), 0.095, -0.13, 0.025), STEEL);
    c.add(put(box(0.012, 0.06, 0.1), -0.095, -0.13, 0.025), STEEL);
    const holder = new Group();
    holder.add(new Mesh(c.merged(), materials.solid));
    if (i % 3 !== 2) {
      const rider = new Mesh(person(rng, 0.23, true), materials.solid);
      rider.position.set(0, -0.145, -0.01);
      holder.add(rider);
    }
    for (const m of holder.children) (m as Mesh).castShadow = true;
    lift.add(holder);
    chairs.push(holder);
  }
  group.add(lift);
  const p = new Vector3();
  const [wx, wz] = place(0, hd + 0.3);

  return {
    id: "hut",
    group,
    terrain,
    lights: [new Vector3(wx, b + 0.2, wz), new Vector3(lx, b + 0.3, lz), lamp],
    update(t) {
      chairs.forEach((chair, i) => {
        let s = (t * LIFT_SPEED + (i / CHAIRS) * loop) % loop;
        let k = 0;
        while (k < legs.length - 1 && s > legs[k]!.len) {
          s -= legs[k]!.len;
          k++;
        }
        const leg = legs[k]!;
        lerp3(leg.a, leg.b, Math.min(1, s / leg.len), p);
        chair.position.copy(p);
        // Riders face up the hill going up, down it coming back.
        chair.rotation.set(0, k < up.length - 1 ? lineYaw : lineYaw + Math.PI, 0);
        chair.rotation.z = 0.04 * Math.sin(t * 1.3 + i);
      });
    },
  };
};
