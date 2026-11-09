/**
 * Beach toys for the wall: a sun hat, sunglasses, a bucket of sand, a spade and a bottle of
 * sunscreen, nearly three times life size so they read from across the room beside the big
 * balls and make large targets.
 *
 * Each one is a rigid body in the plane of the wall. Its outline is a handful of discs, given
 * here in the model's own frame (metres, y up, x right, as the toy stands at angle 0) and
 * shifted so that the body's centre of mass is the origin. The 3D model is built in the same
 * model frame (`wallpropview.ts`), so the discs follow its silhouette.
 */

import { BROLLY_DISCS } from "./wallumbrella";

/** The toys, and the beach umbrella once it is closed and out of the sand (`brolly`). */
export type PropKind = "hat" | "bucket" | "sunnies" | "spade" | "bottle" | "brolly";
export type ToyKind = Exclude<PropKind, "brolly">;

/** The toys, in the order they are put out along the sand. */
export const PROP_KINDS: readonly ToyKind[] = ["hat", "bucket", "sunnies", "spade", "bottle"];

export interface Disc {
  x: number;
  y: number;
  r: number;
}

export interface PropSpec {
  readonly kind: PropKind;
  /** Discs about the centre of mass, metres, as it stands at angle 0. */
  readonly discs: readonly Disc[];
  /** The model's origin (its base) from the centre of mass. */
  readonly origin: { readonly x: number; readonly y: number };
  /** Mass, where a beach ball's is 1, and the moment of inertia about the centre of mass. */
  readonly mass: number;
  readonly inertia: number;
  /** Furthest any disc reaches from the centre of mass. */
  readonly reach: number;
  readonly bounce: number;
  readonly grip: number;
  readonly gravity: number;
  /** Air drag, linear and quadratic in speed. */
  readonly drag: readonly [number, number];
  /** The angle it is put out at. */
  readonly rest: number;
  /**
   * A turn about its own upright axis is drawn but not felt, so once it lands it eases back to
   * a multiple of this, where it faces the people as its discs say. 0 for a round toy.
   */
  readonly yawStep: number;
  /** How much higher and faster than others a tap pops and flips it, 1 for most. */
  readonly pop: number;
}

interface Model {
  discs: readonly (readonly [number, number, number])[];
  centre: readonly [number, number];
  mass: number;
  gyration: number;
  bounce: number;
  grip: number;
  gravity: number;
  drag: readonly [number, number];
  rest: number;
  yawStep: number;
  pop?: number;
  /** How much bigger than its model it is drawn and felt; the toys' scale unless given. */
  scale?: number;
}

const TAU = Math.PI * 2;
/** The models below are about twice life size; everything is drawn and felt this much bigger. */
export const PROP_SCALE = 1.35;

const mirror = (
  list: readonly (readonly [number, number, number])[],
): (readonly [number, number, number])[] =>
  list.flatMap(([x, y, r]) =>
    x === 0 ? [[x, y, r] as const] : [[x, y, r] as const, [-x, y, r] as const],
  );

const BUCKET_DISCS = mirror([
  [0.105, 0.05, 0.05],
  [0, 0.05, 0.05],
  [0.119, 0.15, 0.05],
  [0.131, 0.25, 0.05],
  [0.144, 0.35, 0.05],
  [0.072, 0.35, 0.05],
  [0, 0.35, 0.05],
  [0, 0.2, 0.1],
]);

/**
 * The bucket once its sand has fallen out: the same outline, a third of the weight with its
 * centre of mass higher up, bouncier, and caught more by the air, so it is light and lively.
 */
const EMPTY_BUCKET_MODEL: Model = {
  discs: BUCKET_DISCS,
  centre: [0, 0.19],
  mass: 0.4,
  gyration: 0.16,
  bounce: 0.42,
  grip: 0.6,
  gravity: 9,
  drag: [0.06, 0.1],
  rest: 0,
  yawStep: TAU,
  pop: 1.2,
};

/** Model frames: the origin is the middle of the toy's base, as it stands upright. */
const MODELS: Record<PropKind, Model> = {
  // A wide straw sun hat: a thin brim 0.8 m across round a domed crown.
  hat: {
    discs: mirror([
      [0.375, 0.016, 0.02],
      [0.3, 0.016, 0.02],
      [0.225, 0.016, 0.02],
      [0.15, 0.016, 0.02],
      [0.1, 0.085, 0.075],
      [0.125, 0.16, 0.05],
      [0, 0.135, 0.095],
    ]),
    centre: [0, 0.06],
    mass: 0.35,
    gyration: 0.21,
    bounce: 0.12,
    grip: 0.7,
    gravity: 7,
    drag: [0.3, 0.6],
    rest: 0,
    yawStep: 0,
  },
  // A tapered bucket 0.4 m tall with a lip, packed with damp sand, so it sits low and heavy.
  bucket: {
    discs: BUCKET_DISCS,
    centre: [0, 0.17],
    mass: 1.5,
    gyration: 0.14,
    bounce: 0.2,
    grip: 0.65,
    gravity: 9.2,
    drag: [0.02, 0.03],
    rest: 0,
    yawStep: TAU,
  },
  // Sunglasses standing on their lenses, facing the people, arms open behind them.
  sunnies: {
    discs: mirror([
      [0.088, 0.062, 0.062],
      [0.155, 0.112, 0.024],
      [0, 0.104, 0.024],
    ]),
    centre: [0, 0.07],
    mass: 0.3,
    gyration: 0.11,
    bounce: 0.35,
    grip: 0.5,
    gravity: 9,
    drag: [0.03, 0.05],
    rest: 0,
    yawStep: TAU,
  },
  // A spade 0.76 m long, blade down when upright; it is put out lying on the sand.
  spade: {
    discs: mirror([
      [0, 0.07, 0.07],
      [0.05, 0.18, 0.05],
      [0, 0.17, 0.07],
      [0, 0.27, 0.024],
      [0, 0.33, 0.024],
      [0, 0.39, 0.024],
      [0, 0.45, 0.024],
      [0, 0.51, 0.024],
      [0, 0.57, 0.024],
      [0, 0.63, 0.024],
      [0.05, 0.69, 0.025],
      [0, 0.69, 0.03],
    ]),
    centre: [0, 0.26],
    mass: 0.6,
    gyration: 0.2,
    bounce: 0.25,
    grip: 0.55,
    gravity: 9.2,
    drag: [0.03, 0.04],
    rest: Math.PI / 2,
    yawStep: Math.PI,
  },
  // A squeeze bottle of sunscreen 0.43 m tall with its cap on top.
  bottle: {
    discs: mirror([
      [0.04, 0.045, 0.045],
      [0, 0.13, 0.085],
      [0, 0.22, 0.085],
      [0, 0.29, 0.08],
      [0, 0.395, 0.04],
    ]),
    centre: [0, 0.17],
    mass: 0.7,
    gyration: 0.12,
    bounce: 0.3,
    grip: 0.55,
    gravity: 9.2,
    drag: [0.02, 0.03],
    rest: 0,
    yawStep: TAU,
  },
  // The beach umbrella furled round its pole, at its own size, lying down when put out.
  brolly: {
    discs: BROLLY_DISCS,
    centre: [0, 1.12],
    mass: 1.4,
    gyration: 0.62,
    bounce: 0.25,
    grip: 0.6,
    gravity: 9.2,
    drag: [0.04, 0.06],
    rest: Math.PI / 2,
    yawStep: 0,
    pop: 0.55,
    scale: 1,
  },
};

const specOf = (kind: PropKind, m: Model = MODELS[kind]): PropSpec => {
  const k = m.scale ?? PROP_SCALE;
  const [cx, cy] = m.centre;
  const discs = m.discs.map(([x, y, r]) => ({ x: (x - cx) * k, y: (y - cy) * k, r: r * k }));
  const reach = Math.max(...discs.map((d) => Math.hypot(d.x, d.y) + d.r));
  return {
    kind,
    discs,
    origin: { x: -cx * k, y: -cy * k },
    mass: m.mass,
    inertia: m.mass * (m.gyration * k) ** 2,
    reach,
    bounce: m.bounce,
    grip: m.grip,
    gravity: m.gravity,
    drag: m.drag,
    rest: m.rest,
    yawStep: m.yawStep,
    pop: m.pop ?? 1,
  };
};

export const PROP_SPECS: Readonly<Record<PropKind, PropSpec>> = {
  hat: specOf("hat"),
  bucket: specOf("bucket"),
  sunnies: specOf("sunnies"),
  spade: specOf("spade"),
  bottle: specOf("bottle"),
  brolly: specOf("brolly"),
};

export const EMPTY_BUCKET: PropSpec = specOf("bucket", EMPTY_BUCKET_MODEL);

/**
 * The bucket's insides, metres in its model frame (from the middle of its base, as it stands):
 * the height of its mouth, where sand comes out and goes in, and the packed sand's shape, which
 * a bucket turned out on the sand leaves standing as a castle.
 */
export const BUCKET_MOUTH = 0.38 * PROP_SCALE;
export const BUCKET_SAND = {
  /** Radius at the mouth and at the bottom, and height from the inside bottom to the top. */
  mouth: 0.184 * PROP_SCALE,
  bottom: 0.152 * PROP_SCALE,
  floor: 0.02 * PROP_SCALE,
  height: 0.357 * PROP_SCALE,
} as const;
export interface Extent {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** How far the discs reach left, right, down and up from the centre of mass at angle `a`. */
export const extentAt = (spec: PropSpec, a: number): Extent => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const e: Extent = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
  for (const d of spec.discs) {
    const x = c * d.x - s * d.y;
    const y = s * d.x + c * d.y;
    e.left = Math.min(e.left, x - d.r);
    e.right = Math.max(e.right, x + d.r);
    e.bottom = Math.min(e.bottom, y - d.r);
    e.top = Math.max(e.top, y + d.r);
  }
  return e;
};

/**
 * Paint for the toys, sRGB as picked from a photograph. No red and no yellow anywhere (the
 * lifesaving rule); the straw is a pale, greyish beige, too dull to read as yellow.
 */
export const PROP_PAINT = {
  straw: "#d4c8ad",
  ribbon: "#2a7f9e",
  bucket: "#22a7b5",
  handle: "#efede6",
  frame: "#6c46b9",
  blade: "#3b8fe0",
  shaft: "#1d3577",
  bottle: "#efede6",
  band: "#138784",
  wave: "#7fd3d0",
  cap: "#1d3577",
} as const;
