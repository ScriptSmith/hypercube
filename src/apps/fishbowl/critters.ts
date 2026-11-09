/**
 * Meshes for the tank's smaller animals, built from numbers in their own units: a shrimp one
 * length long, and a nerite snail one shell-width across. `aPart` tells the shaders which part
 * a point belongs to and how far along it, for animating legs and colouring.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { TAU } from "./vec";

interface Builder {
  pos: number[];
  normal: number[];
  part: number[];
  index: number[];
}

const finish = (b: Builder): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(b.pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(b.normal), 3));
  g.setAttribute("aPart", new BufferAttribute(new Float32Array(b.part), 4));
  g.setIndex(b.index);
  return g;
};

/** A tube through `centre(t)` with elliptical rings of half-sizes `size(t)` (up, across). */
const tube = (
  b: Builder,
  rows: number,
  around: number,
  centre: (t: number) => Vector3,
  size: (t: number) => [number, number],
  part: (t: number) => [number, number, number, number],
) => {
  const base = b.pos.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const c = centre(t);
    const ahead = centre(Math.min(1, t + 0.01))
      .sub(centre(Math.max(0, t - 0.01)))
      .normalize();
    const side = new Vector3(0, 0, 1);
    const up = new Vector3().crossVectors(side, ahead).normalize();
    const [h, w] = size(t);
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * TAU;
      const n = up
        .clone()
        .multiplyScalar(Math.cos(a) / Math.max(h, 1e-4))
        .addScaledVector(side, Math.sin(a) / Math.max(w, 1e-4))
        .normalize();
      const p = c
        .clone()
        .addScaledVector(up, Math.cos(a) * h)
        .addScaledVector(side, Math.sin(a) * w);
      b.pos.push(p.x, p.y, p.z);
      b.normal.push(n.x, n.y, n.z);
      b.part.push(...part(t));
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < around; j++) {
      const a = base + i * (around + 1) + j;
      const c = a + around + 1;
      b.index.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
};

/** Shrimp parts in `aPart.x`. */
export const SHRIMP_PART = { body: 0, leg: 1, claw: 2, antenna: 3, eye: 4, tail: 5 } as const;

/**
 * A shrimp one length long, head at +x, back up, legs reaching down to y = 0 where it stands.
 * aPart: (part, t along it, which leg 0 to 4 or side, side -1 or 1).
 */
export const buildShrimp = (detail: number): BufferGeometry => {
  const b: Builder = { pos: [], normal: [], part: [], index: [] };
  const around = Math.max(6, Math.round(8 * detail));
  // A humped body: carapace in front, the abdomen arching down to the tail fan.
  const spine = (t: number) => {
    const x = 0.42 - t * 0.78;
    const y =
      0.13 + 0.05 * Math.sin(Math.PI * Math.min(1, t * 1.4)) - 0.07 * Math.max(0, t - 0.6) ** 2 * 6;
    return new Vector3(x, y, 0);
  };
  const girth = (t: number): [number, number] => {
    const k = t < 0.08 ? Math.sqrt(t / 0.08) : 1 - 0.55 * Math.max(0, (t - 0.35) / 0.65);
    return [0.06 * k, 0.045 * k];
  };
  tube(b, Math.round(26 * detail), around, spine, girth, (t) => [SHRIMP_PART.body, t, 0, 0]);
  // The rostrum.
  tube(
    b,
    4,
    4,
    (t) => new Vector3(0.42 + t * 0.09, 0.15 + t * 0.01, 0),
    (t) => [0.012 * (1 - t), 0.006 * (1 - t)],
    (t) => [SHRIMP_PART.body, 0, 0, t],
  );
  // The tail fan: five blades spread at the end of the abdomen.
  const tail = spine(1);
  for (let k = -2; k <= 2; k++) {
    const a = k * 0.32;
    tube(
      b,
      4,
      4,
      (t) =>
        tail.clone().add(new Vector3(-Math.cos(a) * 0.1 * t, -0.01 * t, Math.sin(a) * 0.1 * t)),
      (t) => [0.004, 0.025 * Math.sin(Math.PI * (0.2 + 0.8 * t))],
      (t) => [SHRIMP_PART.tail, t, k, 0],
    );
  }
  // Five pairs of walking legs, the first two with small claws.
  for (let leg = 0; leg < 5; leg++) {
    for (const side of [-1, 1]) {
      const x0 = 0.3 - leg * 0.055;
      const root = new Vector3(x0, 0.1, side * 0.03);
      const foot = new Vector3(x0 + 0.03 - leg * 0.012, 0, side * 0.09);
      const knee = new Vector3(x0 + 0.01, 0.13, side * 0.075);
      const curve = (t: number) =>
        t < 0.5 ? root.clone().lerp(knee, t * 2) : knee.clone().lerp(foot, (t - 0.5) * 2);
      const claw = leg < 2;
      tube(
        b,
        6,
        3,
        curve,
        () => [0.006, 0.006],
        (t) => [claw ? SHRIMP_PART.claw : SHRIMP_PART.leg, t, leg, side],
      );
    }
  }
  // Two long antennae sweeping back, two short ones forward.
  for (const side of [-1, 1]) {
    tube(
      b,
      10,
      3,
      (t) =>
        new Vector3(
          0.44 + 0.15 * t - 0.75 * t * t,
          0.16 + 0.12 * t - 0.1 * t * t,
          side * (0.02 + 0.22 * t),
        ),
      () => [0.003, 0.003],
      (t) => [SHRIMP_PART.antenna, t, 0, side],
    );
    tube(
      b,
      4,
      3,
      (t) => new Vector3(0.44 + 0.12 * t, 0.16 + 0.03 * t, side * (0.015 + 0.03 * t)),
      () => [0.004, 0.004],
      (t) => [SHRIMP_PART.antenna, t, 1, side],
    );
    // Eyes on short stalks.
    tube(
      b,
      4,
      6,
      (t) => new Vector3(0.39 + 0.03 * t, 0.17, side * (0.03 + 0.012 * t)),
      (t) => [
        0.014 * Math.sin(Math.PI * Math.max(0.15, t)),
        0.014 * Math.sin(Math.PI * Math.max(0.15, t)),
      ],
      (t) => [SHRIMP_PART.eye, t, 0, side],
    );
  }
  return finish(b);
};

/** Snail parts in `aPart.x`. */
export const SNAIL_PART = { sole: 0, foot: 1, shell: 2, tentacle: 3 } as const;

/**
 * A nerite one shell-width across: the sole flat on y = 0 facing -y (the glass it clings to),
 * heading +x, a low round shell over it with its whorl to one side.
 */
export const buildNerite = (detail: number): BufferGeometry => {
  const b: Builder = { pos: [], normal: [], part: [], index: [] };
  const rows = Math.round(14 * detail);
  const around = Math.round(22 * detail);
  // The sole: a flat oval disc, and the foot's rim rising from it.
  const disc = (y: number, rx: number, rz: number, nx: number, part: number) => {
    const base = b.pos.length / 3;
    b.pos.push(0.05, y, 0);
    b.normal.push(0, nx, 0);
    b.part.push(part, 0, 0, 0);
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * TAU;
      b.pos.push(0.05 + Math.cos(a) * rx, y, Math.sin(a) * rz);
      b.normal.push(0, nx, 0);
      b.part.push(part, 1, Math.cos(a), Math.sin(a));
    }
    for (let j = 0; j < around; j++) {
      if (nx < 0) b.index.push(base, base + 1 + j, base + 2 + j);
      else b.index.push(base, base + 2 + j, base + 1 + j);
    }
  };
  disc(0.001, 0.48, 0.32, -1, SNAIL_PART.sole);
  // The foot's edge and the head with its tentacles, under the front of the shell.
  tube(
    b,
    rows,
    8,
    (t) => new Vector3(0.05 + Math.cos(t * TAU) * 0.46, 0.04, Math.sin(t * TAU) * 0.3),
    () => [0.04, 0.04],
    (t) => [SNAIL_PART.foot, t, 0, 0],
  );
  for (const side of [-1, 1]) {
    tube(
      b,
      6,
      4,
      (t) => new Vector3(0.48 + 0.2 * t, 0.06 + 0.04 * t, side * (0.08 + 0.12 * t)),
      (t) => [0.02 * (1 - 0.6 * t), 0.02 * (1 - 0.6 * t)],
      (t) => [SNAIL_PART.tentacle, t, 0, side],
    );
  }
  // The shell: a low dome, fuller on the whorl's side, its lip just above the foot.
  const base = b.pos.length / 3;
  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    const lat = (v * Math.PI) / 2;
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * TAU;
      const r = Math.cos(lat);
      const bulge = 1 + 0.12 * Math.cos(a - 2.4) * Math.sin(lat * 2);
      const p = new Vector3(
        -0.02 + Math.cos(a) * 0.5 * r * bulge,
        0.06 + Math.sin(lat) * 0.42,
        Math.sin(a) * 0.4 * r * bulge,
      );
      const n = new Vector3(
        (Math.cos(a) * r) / 0.5,
        Math.sin(lat) / 0.42,
        (Math.sin(a) * r) / 0.4,
      ).normalize();
      b.pos.push(p.x, p.y, p.z);
      b.normal.push(n.x, n.y, n.z);
      b.part.push(SNAIL_PART.shell, v, a / TAU, 0);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < around; j++) {
      const a = base + i * (around + 1) + j;
      const c = a + around + 1;
      b.index.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  return finish(b);
};
