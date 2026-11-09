/**
 * Under the hill, against the bottom of the glass, a den where a family of rabbits lie on dry
 * leaves with their heads together, peering down through the glass at whoever is underneath,
 * roots hanging from the earth above them. Only people underneath see it. It turns with the
 * scene. Design metres, the scene's own frame.
 */
import { BufferGeometry, Color, Float32BufferAttribute, Group, Vector3 } from "three";
import type { Rng } from "../../core/types";
import { ball, cyl, type Materials, Parts, put, stone } from "./kit";
import { R } from "./mound";
import { fbm3 } from "./noise";

/** The den's mouth on the glass: this far round from the bottom of the ball, radians. */
export const DEN_ANGLE = 0.32;
/** How high the den's roof rises above the glass in its middle. */
const DEN_HIGH = 0.42;

const EARTH = new Color("#5b4433");
const EARTH_DARK = new Color("#3a2b21");

/** The den's roof: earth curving down to meet the glass round the mouth, facing into the den. */
const roofGeometry = (): BufferGeometry => {
  const rings = 14;
  const around = 72;
  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();
  for (let k = 0; k <= rings; k++) {
    const f = k / rings;
    const a = DEN_ANGLE * f;
    const h = DEN_HIGH * Math.pow(Math.cos((f * Math.PI) / 2), 0.8);
    const r0 = R - 0.006;
    for (let j = 0; j < around; j++) {
      const th = (j / around) * Math.PI * 2;
      const bump = 0.03 * fbm3(Math.sin(th) * 4, f * 5, Math.cos(th) * 4);
      const r = r0 - h - bump * (1 - f);
      const x = r * Math.sin(a) * Math.sin(th);
      const y = -r * Math.cos(a);
      const z = r * Math.sin(a) * Math.cos(th);
      pos.push(x, y, z);
      c.copy(EARTH).lerp(EARTH_DARK, 0.5 + 0.5 * fbm3(x * 9, y * 9, z * 9));
      col.push(c.r, c.g, c.b);
    }
  }
  const index: number[] = [];
  for (let k = 0; k < rings; k++) {
    for (let j = 0; j < around; j++) {
      const j1 = (j + 1) % around;
      const a = k * around + j;
      const b = k * around + j1;
      const d = (k + 1) * around + j;
      const e = (k + 1) * around + j1;
      // Facing down into the den, towards the glass.
      index.push(a, b, d, b, e, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
};

const COATS = ["#8a6a4f", "#8f8b86", "#d6c4a3"];
const CREAM = "#efe4d0";
const PINK = "#e7a3a3";
const EYE = "#16110e";
const RABBITS = 3;

/** Height of the den's floor (the glass) this far from its middle. */
const floorAt = (rho: number) => -Math.sqrt(R * R - rho * rho) + 0.012;

interface Rabbit {
  head: Group;
  eyes: Group;
  phase: number;
}

/**
 * A rabbit lying on the glass and looking down through it, built with its head at the origin
 * and facing +x: its face is on the underside of its head, for people below to see.
 */
const rabbit = (rng: Rng, materials: Materials, coat: string): { group: Group; r: Rabbit } => {
  const body = new Parts(rng);
  body.add(put(ball(1, 14, 10), -0.17, 0.04, 0, 0, 0, 0, 0.17, 0.1, 0.12), coat, "solid", 0.04);
  body.add(put(ball(1, 12, 8), -0.15, 0.0, 0, 0, 0, 0, 0.13, 0.05, 0.09), CREAM, "solid", 0.03);
  body.add(put(ball(0.045, 8, 6), -0.33, 0.06, 0), CREAM);
  for (const s of [-1, 1]) {
    body.add(put(ball(1, 8, 6), 0.09, -0.04, s * 0.045, 0, 0, 0, 0.045, 0.022, 0.028), CREAM);
    body.add(put(ball(1, 8, 6), -0.24, 0.0, s * 0.08, 0, 0.3 * s, 0, 0.07, 0.03, 0.04), coat);
  }
  const head = new Parts(rng);
  head.add(put(ball(0.085, 14, 10), 0, 0, 0, 0, 0, 0, 1.1, 0.9, 1), coat, "solid", 0.03);
  // The face, on the underside: muzzle, nose and cheeks.
  for (const s of [-1, 1]) {
    head.add(put(ball(0.026, 8, 6), 0.045, -0.06, s * 0.02), CREAM);
    // Ears lie back along the body, pink inside.
    head.add(
      put(ball(1, 10, 6), -0.1, 0.03, s * 0.05, s * 0.25, 0, 0.15, 0.12, 0.022, 0.04),
      coat,
      "solid",
      0.03,
    );
    head.add(put(ball(1, 8, 6), -0.1, 0.012, s * 0.05, s * 0.25, 0, 0.15, 0.1, 0.012, 0.025), PINK);
  }
  head.add(put(ball(0.014, 8, 6), 0.07, -0.055, 0), PINK);
  const eyes = new Parts(rng);
  for (const s of [-1, 1]) {
    eyes.add(
      put(ball(1, 10, 8), 0.015, -0.068, s * 0.05, 0, 0, 0, 0.022, 0.016, 0.02),
      EYE,
      "solid",
      0,
    );
    eyes.add(put(ball(0.005, 6, 4), 0.022, -0.082, s * 0.05 + 0.006), "#ffffff", "glow", 0);
  }
  const g = new Group();
  g.add(body.build(materials));
  const h = new Group();
  h.add(head.build(materials));
  const e = eyes.build(materials);
  h.add(e);
  h.position.set(0.04, 0.0, 0);
  g.add(h);
  return { group: g, r: { head: h, eyes: e, phase: rng.range(0, 20) } };
};

export interface Den {
  readonly group: Group;
  /**
   * Where the den's light comes from: the room's light through the glass below it, which is
   * what shows people underneath the rabbits' faces.
   */
  readonly light: Vector3;
  /** Blink and look about, at time `t`. */
  update(t: number): void;
}

export const makeDen = (rng: Rng, materials: Materials): Den => {
  const parts = new Parts(rng);
  parts.addColored(roofGeometry());

  // Roots hanging from the roof, and stones in the earth.
  for (let i = 0; i < 14; i++) {
    const th = rng.range(0, Math.PI * 2);
    const f = rng.range(0.1, 0.75);
    const a = DEN_ANGLE * f;
    const h = DEN_HIGH * Math.pow(Math.cos((f * Math.PI) / 2), 0.8);
    const r = R - h - 0.01;
    const x = r * Math.sin(a) * Math.sin(th);
    const y = -r * Math.cos(a);
    const z = r * Math.sin(a) * Math.cos(th);
    const len = rng.range(0.08, 0.2);
    const lean = rng.range(-0.4, 0.4);
    parts.add(
      put(cyl(0.004, 0.012, len, 5), x, y - len / 2, z, lean, th, rng.range(-0.3, 0.3)),
      "#7a5a3c",
      "solid",
      0.1,
    );
  }
  for (let i = 0; i < 9; i++) {
    const th = rng.range(0, Math.PI * 2);
    const f = rng.range(0.3, 0.95);
    const a = DEN_ANGLE * f;
    const h = DEN_HIGH * Math.pow(Math.cos((f * Math.PI) / 2), 0.8);
    const r = R - h;
    parts.add(
      put(
        stone(rng, rng.range(0.03, 0.06), 1),
        r * Math.sin(a) * Math.sin(th),
        -r * Math.cos(a),
        r * Math.sin(a) * Math.cos(th),
      ),
      "#7d7570",
      "solid",
      0.12,
    );
  }
  // A bed of dry leaves on the glass, a couple of acorns, a glow of little mushrooms.
  for (let i = 0; i < 26; i++) {
    const th = rng.range(0, Math.PI * 2);
    const d = rng.range(0, 0.36);
    parts.add(
      put(
        ball(rng.range(0.035, 0.06), 6, 4),
        Math.sin(th) * d,
        floorAt(d) + 0.012,
        Math.cos(th) * d,
        0,
        rng.range(0, 6),
        0,
        1,
        0.25,
        0.6,
      ),
      rng.pick(["#a0662c", "#b9853b", "#8a4f24", "#c49a4a"]),
      "solid",
      0.1,
    );
  }
  for (const [th, d] of [
    [0.9, 0.42],
    [3.4, 0.4],
  ] as const) {
    const x = Math.sin(th) * d;
    const z = Math.cos(th) * d;
    parts.add(put(ball(0.022, 8, 6), x, floorAt(d) + 0.03, z, 0, 0, 0, 1, 1.25, 1), "#9a6a34");
    parts.add(put(ball(0.024, 8, 4), x, floorAt(d) + 0.055, z, 0, 0, 0, 1, 0.6, 1), "#5e4128");
  }
  for (let i = 0; i < 5; i++) {
    const th = 5.2 + i * 0.12;
    const d = 0.46 + (i % 2) * 0.04;
    const x = Math.sin(th) * d;
    const z = Math.cos(th) * d;
    const y = floorAt(d) + 0.02 + 0.01 * i;
    parts.add(put(cyl(0.006, 0.008, 0.05, 5), x, y + 0.025, z), "#e8e0cc");
    parts.add(put(ball(0.022, 8, 5), x, y + 0.055, z, 0, 0, 0, 1, 0.55, 1), "#9fe0c8", "glow");
  }
  const group = parts.build(materials);
  for (const m of group.children) m.receiveShadow = false;

  // A family of rabbits, heads together, looking down through the glass.
  const family: Rabbit[] = [];
  const turn = rng.range(0, Math.PI * 2);
  for (let i = 0; i < RABBITS; i++) {
    const a = turn + (i / RABBITS) * Math.PI * 2;
    const d = 0.2;
    const { group: g, r } = rabbit(rng, materials, COATS[i % COATS.length]!);
    g.position.set(Math.sin(a) * d, floorAt(d) + 0.075, Math.cos(a) * d);
    // Head towards the middle.
    g.rotation.y = a + Math.PI / 2;
    group.add(g);
    family.push(r);
  }

  return {
    group,
    light: new Vector3(0, -R - 0.75, 0),
    update(t) {
      for (const r of family) {
        // A blink every few seconds, and now and then a look round.
        const blink = (t + r.phase) % 4.3;
        r.eyes.scale.y = blink < 0.14 ? 0.15 : 1;
        r.head.rotation.y =
          0.35 * Math.sin((t + r.phase * 3) * 0.23) * Math.sin((t + r.phase) * 0.11);
        r.head.rotation.z = 0.06 * Math.sin((t + r.phase) * 1.7);
      }
    },
  };
};
