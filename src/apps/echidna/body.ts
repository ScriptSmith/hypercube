/**
 * The curled echidna's body, on the unit ball in its own frame: y towards the middle of the
 * back, the belly at -y (the bottom pole, under the people), the head towards +z and the tail
 * towards -z. Head and tail both sit low, a little either side of the belly, as when an echidna
 * tucks its snout and legs under itself.
 *
 * Spines lie back from the head over the back to the tail. Their direction is the field of a
 * source at the head and a sink at the tail: its lines are the circles through both points, so
 * along the middle of the back they run from head to tail, on the flanks they sweep backwards,
 * and none ever points back towards the head. On the crown they flare out of two whorls above
 * the snout, as on the animal, leaving a bare forehead between them and the face.
 *
 * Spines grow in tufts: those round a tuft's centre lean in towards a point ahead of it, so their
 * tips gather into spiky tents with partings of fur between, and the middle ones stand highest.
 *
 * Sizes are fractions of the ball's radius (or tangents of angles from the centre, the same
 * for small things), so another sphere shows the same animal.
 */
import type { Vec3 } from "../../core/sphere";
import type { Rng } from "../../core/types";

/** Angles of the head and the tail from the belly pole, radians. */
export const HEAD_ANGLE = 0.62;
export const TAIL_ANGLE = 0.56;
export const HEAD: Vec3 = [0, -Math.cos(HEAD_ANGLE), Math.sin(HEAD_ANGLE)];
export const TAIL: Vec3 = [0, -Math.cos(TAIL_ANGLE), -Math.sin(TAIL_ANGLE)];

/**
 * Where the curl opens round the belly pole, so people underneath see the tucked face and
 * feet: an ellipse in the body's x, z plane. Spines grow only outside it.
 */
export const OPENING = { cz: 0.04, rx: 0.27, rz: 0.45 } as const;

/** Back spines: length (about 0.8 m on a 4 m ball) and length over width at its widest. */
export const BACK_LENGTH = 0.42;
export const SLENDER = 17;
/** Bare crown round the head, radians, where fur shows before the spines start. */
export const CROWN = 0.1;
/** Points of the lattice the spines grow from, over the whole ball. */
export const LATTICE = 7200;
/** Tufts over the whole ball, and how far their spines lean in towards a point ahead. */
export const TUFTS = 720;
const TUFT_PULL = 1;
const TUFT_BEND = 0.5;
/** How far ahead of a tuft's centre its spines aim, as a fraction of their length. */
const TUFT_APEX = 0.85;
/** Spines rest this far off the skin, radians: half raised, more in the middle of a tuft. */
export const LIFT_MIN = 0.45;
export const LIFT_MAX = 0.95;
/** How far from the tail its own direction takes over from the field, radians. */
export const TAIL_REACH = 0.75;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Angle between two unit vectors. */
export const angle = (a: Vec3, b: Vec3): number => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Below 1 inside the opening, above 1 outside it; large on the upper half. */
export const openingValue = (p: Vec3): number => {
  if (p[1] > -0.2) return 99;
  const x = p[0] / OPENING.rx;
  const z = (p[2] - OPENING.cz) / OPENING.rz;
  return x * x + z * z;
};

/** The field's own direction: circles through the head and the tail. */
const field = (p: Vec3): Vec3 => {
  const n = cross(sub(TAIL, HEAD), sub(p, HEAD));
  return cross(p, n);
};

/** Tangent at `p` of a fixed direction `t`, unit length (or zero). */
const along = (p: Vec3, t: Vec3): Vec3 => {
  const k = dot(p, t);
  return [t[0] - p[0] * k, t[1] - p[1] * k, t[2] - p[2] * k];
};

const blend = (a: Vec3, b: Vec3, w: number): Vec3 => {
  const la = len(a) || 1;
  const lb = len(b) || 1;
  return [
    (a[0] / la) * (1 - w) + (b[0] / lb) * w,
    (a[1] / la) * (1 - w) + (b[1] / lb) * w,
    (a[2] / la) * (1 - w) + (b[2] / lb) * w,
  ];
};

/** Up the back from the head, and down under the body past the tail. */
export const HEAD_BACK: Vec3 = normalize(along(HEAD, [0, 1, 0]));
export const TAIL_TUCK: Vec3 = normalize(along(TAIL, [0, -1, 0]));

/** The two whorls on the crown, either side above the snout's base. */
const WHORL_BACK = 0.2;
const WHORL_SIDE = 0.12;
export const WHORLS: readonly Vec3[] = [1, -1].map((s) =>
  normalize([
    HEAD[0] + HEAD_BACK[0] * WHORL_BACK + s * WHORL_SIDE,
    HEAD[1] + HEAD_BACK[1] * WHORL_BACK,
    HEAD[2] + HEAD_BACK[2] * WHORL_BACK,
  ]),
);
/** Nothing grows this close to a whorl's centre, radians, so a little skin shows there. */
export const WHORL_BARE = 0.03;
/** How far out the whorls hand over to the body's own flow, radians from the head. */
export const WHORL_REACH: readonly [number, number] = [0.32, 0.62];

/** Away from the whorls: the sum of their outward directions, the nearer counting more. */
const whorlFlow = (p: Vec3): Vec3 => {
  const out: [number, number, number] = [0, 0, 0];
  for (const w of WHORLS) {
    const k = dot(p, w);
    const t: Vec3 = [p[0] * k - w[0], p[1] * k - w[1], p[2] * k - w[2]];
    const l = len(t);
    if (l < 1e-9) continue;
    const a = angle(p, w);
    const weight = 1 / (l * (a * a + 0.004));
    out[0] += t[0] * weight;
    out[1] += t[1] * weight;
    out[2] += t[2] * weight;
  }
  return out;
};

/**
 * The way spines lie at `p` (unit), a unit tangent, or null where it has none. On the crown
 * they flare out of the two whorls, and near the tail all sweep down and under it, as on the
 * animal.
 */
export const flow = (p: Vec3): Vec3 | null => {
  let f = field(p);
  const dh = angle(p, HEAD);
  f = blend(f, whorlFlow(p), 1 - smoothstep(WHORL_REACH[0], WHORL_REACH[1], dh));
  f = blend(f, along(p, TAIL_TUCK), 1 - smoothstep(0.05, TAIL_REACH, angle(p, TAIL)));
  const l = len(f);
  return l < 1e-6 ? null : [f[0] / l, f[1] / l, f[2] / l];
};

/**
 * How far along the body `p` is, from the head (very negative) to the tail (very positive).
 * It grows along every flow line, which is how tests check that no spine points headwards.
 */
export const progress = (p: Vec3): number => Math.log(len(sub(p, HEAD)) / len(sub(p, TAIL)));

/** Spine length at `p` before per-spine variety: longest on the back, shorter on the flanks and near the head, tail and rim. */
export const lengthAt = (p: Vec3): number => {
  const side = Math.abs(p[0]);
  let g = 1 - 0.34 * side * side;
  g *= mix(0.62, 1, smoothstep(CROWN * 0.6, 0.48, angle(p, HEAD)));
  g *= mix(0.55, 1, smoothstep(0.06, 0.45, angle(p, TAIL)));
  g *= mix(0.7, 1, smoothstep(1, 2.2, openingValue(p)));
  return BACK_LENGTH * g;
};

export interface Spine {
  /** Base, unit vector. */
  b: Vec3;
  /** Direction it lies along, unit tangent at `b`. */
  f: Vec3;
  /** Length lying flat, in tangent units. */
  len: number;
  /** Width at its widest. */
  width: number;
  /** How far it rests off the skin, radians. */
  lift: number;
}

/** Spacing of the lattice, radians. */
export const SPACING = Math.sqrt((4 * Math.PI) / LATTICE);

/**
 * Does a spine grow at `p`? Not inside the opening, on the bare crown, at a whorl's centre, or
 * lying into the face.
 */
export const grows = (p: Vec3, f: Vec3, length: number): boolean => {
  if (openingValue(p) < 1) return false;
  if (angle(p, HEAD) < CROWN) return false;
  for (const w of WHORLS) if (angle(p, w) < WHORL_BARE) return false;
  // Past the tail, towards the belly, the tail's own spines already lie over it.
  const dt = angle(p, TAIL);
  if (dt < 0.07) return false;
  if (dt < 0.35 && dot(sub(p, TAIL), TAIL_TUCK) > 0) return false;
  if (p[2] > 0 && p[1] < 0) {
    const tip = normalize([p[0] + f[0] * length, p[1] + f[1] * length, p[2] + f[2] * length]);
    if (openingValue(tip) < 0.9) return false;
    // Nor over the bare forehead between the whorls and the face.
    if (angle(tip, HEAD) < CROWN * 1.15) return false;
  }
  return true;
};

const fibonacci = (n: number, i: number): Vec3 => {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  return [r * Math.cos(phi), y, r * Math.sin(phi)];
};

/** A random nudge of `p` in its tangent plane, up to `reach` radians. */
const jitter = (rng: Rng, p: Vec3, reach: number): Vec3 => {
  const t1 = normalize(cross(p, Math.abs(p[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const t2 = cross(p, t1);
  const ja = rng.range(0, Math.PI * 2);
  const jr = Math.sqrt(rng.next()) * reach;
  return normalize([
    p[0] + (t1[0] * Math.cos(ja) + t2[0] * Math.sin(ja)) * jr,
    p[1] + (t1[1] * Math.cos(ja) + t2[1] * Math.sin(ja)) * jr,
    p[2] + (t1[2] * Math.cos(ja) + t2[2] * Math.sin(ja)) * jr,
  ]);
};

/** Tuft centres, a jittered lattice of their own. */
export const makeTufts = (rng: Rng, n = TUFTS): Vec3[] => {
  const spacing = Math.sqrt((4 * Math.PI) / n);
  return Array.from({ length: n }, (_, i) => jitter(rng, fibonacci(n, i), 0.3 * spacing));
};

/** Index of the tuft centre nearest `p`. */
export const nearestTuft = (tufts: readonly Vec3[], p: Vec3): number => {
  let best = 0;
  let most = -2;
  for (let i = 0; i < tufts.length; i++) {
    const d = dot(tufts[i]!, p);
    if (d > most) {
      most = d;
      best = i;
    }
  }
  return best;
};

/** Rotate tangent `f` at `p` by `a` radians towards `p` × `f`. */
const turn = (p: Vec3, f: Vec3, a: number): Vec3 => {
  const side = cross(p, f);
  return normalize([
    f[0] * Math.cos(a) + side[0] * Math.sin(a),
    f[1] * Math.cos(a) + side[1] * Math.sin(a),
    f[2] * Math.cos(a) + side[2] * Math.sin(a),
  ]);
};

/**
 * How a spine at `b`, lying `f0`, leans into its tuft: the signed angle it turns by, and how
 * near the tuft's middle line it grows (1 on it, 0 at the edge).
 */
const lean = (b: Vec3, f0: Vec3, centre: Vec3, length: number, spacing: number) => {
  const fc = flow(centre);
  if (!fc) return { bend: 0, middle: 0.5 };
  const apex = normalize([
    centre[0] + fc[0] * length * TUFT_APEX,
    centre[1] + fc[1] * length * TUFT_APEX,
    centre[2] + fc[2] * length * TUFT_APEX,
  ]);
  const aim = along(b, apex);
  const side = cross(b, f0);
  const ahead = dot(aim, f0);
  const across = dot(aim, side);
  // Never more than square on, so no spine is turned back on itself.
  let bend = Math.atan2(across, Math.max(ahead, Math.abs(across) * 0.2)) * TUFT_PULL;
  bend = Math.max(-TUFT_BEND, Math.min(TUFT_BEND, bend));
  const sc = cross(centre, fc);
  const off = Math.abs(dot(sub(b, centre), sc));
  return { bend, middle: 1 - smoothstep(0, spacing * 0.55, off) };
};

/**
 * Spines on a jittered Fibonacci lattice: even everywhere (no bald patches or clumps), but
 * not in rows anyone could follow, leaning into their tufts.
 */
export const makeSpines = (rng: Rng, lattice = LATTICE): Spine[] => {
  const out: Spine[] = [];
  const spacing = Math.sqrt((4 * Math.PI) / lattice);
  const tufts = makeTufts(rng.fork("tufts"));
  const tuftSpacing = Math.sqrt((4 * Math.PI) / tufts.length);
  for (let i = 0; i < lattice; i++) {
    const b = jitter(rng, fibonacci(lattice, i), 0.33 * spacing);
    const f0 = flow(b);
    // Draw the randoms before deciding, so each lattice point keeps its own spine either way.
    const twist = rng.range(-0.12, 0.12);
    const lengthVar = rng.range(0.8, 1.1);
    const widthVar = rng.range(0.85, 1.15);
    const liftVar = rng.next();
    if (!f0) continue;
    const base = lengthAt(b);
    const length = base * lengthVar;
    // Tufts fade out on the crown, where the whorls already gather the spines.
    const tuft = lean(b, f0, tufts[nearestTuft(tufts, b)]!, length, tuftSpacing);
    const crown = smoothstep(0.3, 0.6, angle(b, HEAD));
    const f = turn(b, f0, twist + tuft.bend * crown);
    if (!grows(b, f, length)) continue;
    const width = (BACK_LENGTH / SLENDER) * (0.55 + (0.45 * base) / BACK_LENGTH) * widthVar;
    const lift = mix(LIFT_MIN, LIFT_MAX, 0.55 * liftVar + 0.45 * tuft.middle * crown);
    out.push({ b, f, len: length, width, lift });
  }
  return out;
};
