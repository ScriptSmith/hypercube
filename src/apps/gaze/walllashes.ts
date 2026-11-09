/**
 * Eyelashes for the eye on a wall: curved, tapering hairs growing from the lids' margins, drawn
 * over the wall's picture as thin strips. Each lash belongs to its lid, so it moves with every
 * blink, droop and look: its root is found on the margin each frame, and it grows out of the lid,
 * curling away from the opening as it goes, so upper lashes curl up and out when the eye is open
 * and hang down over the shut lid. The shaders and `lashPoint` below do the same sums.
 *
 * Upper lashes number 90 to 160 in five or six rows, 7 to 8 mm long and rarely
 * over 12; lower ones 75 to 80 in three or four rows, 5 to 6 mm; all curved. Here the upper ones
 * are longest in the middle and towards the outer corner and thin out and shorten towards the
 * inner one; none grow on the inner part of either margin, past the tear ducts' openings. The
 * lower ones are sparser than life, since a full row of them read as a comb at this size. They
 * gather in clumps whose tips meet, as real ones do, with a few strays.
 *
 * Each strip is a pixel wider than its hair on each side and fades to the hair's true coverage,
 * and a hair narrower than a pixel fades rather than thinning, so lashes neither alias nor
 * shimmer as they move. They are lit by the wall's lamp, with a sheen along their length.
 */
import {
  type IUniform,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  NormalBlending,
  ShaderMaterial,
} from "three";
import type { Vec3 } from "../../core/sphere";
import type { Rng } from "../../core/types";
import { LIDS } from "./lids";
import { PUNCTUM, WALL_SCENE } from "./wallscene";
import { WALL_GLSL } from "./wallview";

const DEG = Math.PI / 180;

/**
 * Upper lashes grow from the margin just outside the eye (a share of the lids' shell radius):
 * seen from below, as everyone sees it, that is the upper lid's edge. Lower lashes grow from the
 * shell itself, the lower lid's edge from below.
 */
export const ROOT_UPPER = 1.01 / LIDS.shell;

/**
 * How much of the lower margin's turn up or down from rest its lashes don't follow: a lower lid
 * that rises in a smile bunches up rather than tipping its lashes out at the viewer.
 */
export const LOWER_KEEP = 0.75;

/** How far lower lashes turn from their angles at rest, radians, with the lower margin at `lower`. */
export const lowerLift = (lower: number): number => LOWER_KEEP * (lower - LIDS.lower);

interface LidLashes {
  count: number;
  /** Where they grow along the margin, shell radii across the eye (+ towards the nose). */
  from: number;
  to: number;
  /** The longest, and the width at the root, ball radii. */
  length: number;
  width: number;
  rows: number;
  /** How far behind the margin's front edge the back row grows, ball radii. */
  depth: number;
  /** Angle from the lid's surface at the root and at the tip, away from the opening, radians. */
  from0: [number, number];
  to0: [number, number];
  /** How far the tips turn along the margin, lengths per shell radius across. */
  fan: number;
  /** Lashes to a clump. */
  clump: [number, number];
}

export const LASHES: { upper: LidLashes; lower: LidLashes; segments: number } = {
  upper: {
    count: 150,
    from: -0.85,
    to: PUNCTUM - 0.03,
    length: 0.45,
    width: 0.0075,
    rows: 5,
    depth: 0.014,
    from0: [-34 * DEG, -12 * DEG],
    to0: [30 * DEG, 58 * DEG],
    fan: 0.3,
    clump: [3, 7],
  },
  lower: {
    count: 38,
    from: -0.82,
    to: PUNCTUM - 0.05,
    length: 0.24,
    width: 0.0055,
    rows: 3,
    depth: 0.01,
    from0: [-6 * DEG, 8 * DEG],
    to0: [22 * DEG, 46 * DEG],
    fan: 0.14,
    clump: [1, 3],
  },
  /** Strips along each lash. */
  segments: 10,
};

export interface Lash {
  lower: boolean;
  /** Where along the margin: the angle round the eye from straight out, + towards the nose. */
  phi: number;
  /** How far behind the margin's front edge it grows, ball radii. */
  row: number;
  /** Ball radii. */
  length: number;
  /** Its angle from the lid's surface normal at the root and the tip, away from the opening. */
  from: number;
  to: number;
  /** How far its tip turns along the margin, and its pull to its clump's middle, in lengths. */
  fan: number;
  pull: number;
  /** Width at the root, ball radii, and how dark it is (1 typical). */
  width: number;
  shade: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Length along an upper or lower margin, a share of the longest, at `x` across. */
export const lashProfile = (lower: boolean, x: number): number =>
  lower
    ? 1 - 0.55 * smooth(0.05, 0.62, x) - 0.3 * smooth(-0.55, -0.83, x)
    : 1 - 0.55 * smooth(0.2, 0.66, x) - 0.35 * smooth(-0.6, -0.86, x);

/** How many lashes grow at `x` across, a share of the most. */
const density = (lower: boolean, x: number) =>
  lower ? 1 - 0.55 * smooth(0.1, 0.6, x) : 1 - 0.45 * smooth(0.25, 0.65, x);

const growLid = (rng: Rng, lower: boolean): Lash[] => {
  const spec = lower ? LASHES.lower : LASHES.upper;
  const a = Math.asin(spec.from);
  const b = Math.asin(spec.to);
  // Place them evenly in the density, round the margin's arc.
  const steps = 400;
  const cdf = [0];
  for (let i = 1; i <= steps; i++) {
    const phi = a + ((b - a) * (i - 0.5)) / steps;
    cdf.push(cdf[i - 1]! + density(lower, Math.sin(phi)));
  }
  const total = cdf[steps]!;
  const at = (u: number) => {
    const target = u * total;
    let i = 1;
    while (i < steps && cdf[i]! < target) i++;
    const f = (target - cdf[i - 1]!) / Math.max(1e-9, cdf[i]! - cdf[i - 1]!);
    return a + ((b - a) * (i - 1 + f)) / steps;
  };
  const out: Lash[] = [];
  for (let k = 0; k < spec.count; k++) {
    const phi = at((k + rng.range(0.1, 0.9)) / spec.count);
    const x = Math.sin(phi);
    const row = rng.int(spec.rows);
    const medial = smooth(0.25, 0.7, x);
    const stray = rng.next() < 0.06;
    out.push({
      lower,
      phi,
      row: (row / Math.max(1, spec.rows - 1)) * spec.depth,
      length: spec.length * lashProfile(lower, x) * (1 - (0.12 * row) / spec.rows),
      from: rng.range(...spec.from0),
      to: rng.range(...spec.to0) - (stray ? rng.range(0, 15 * DEG) : 0),
      fan: spec.fan * x + (stray ? rng.range(-0.25, 0.25) : 0),
      pull: 0,
      width: spec.width * rng.range(0.8, 1.2) * (1 - 0.35 * medial),
      shade: rng.range(0.75, 1.2),
    });
  }
  out.sort((p, q) => p.phi - q.phi);
  // Clumps of neighbours along the margin, about as long as each other and leaning the same way,
  // their tips drawn together into a point; some lashes are short new ones, apart from any clump.
  for (let i = 0; i < out.length;) {
    const n = spec.clump[0] + rng.int(spec.clump[1] - spec.clump[0] + 1);
    const group = out.slice(i, i + n);
    const mid = group.reduce((s, l) => s + l.phi, 0) / group.length;
    const long = rng.range(0.7, 1.12);
    const lean = rng.range(-0.06, 0.06);
    for (const l of group) {
      if (rng.next() < 0.18) {
        l.length *= rng.range(0.3, 0.65);
        l.fan += rng.range(-0.06, 0.06);
        continue;
      }
      l.length *= long * rng.range(0.92, 1.06);
      l.fan += lean + rng.range(-0.015, 0.015);
      l.pull = ((mid - l.phi) * LIDS.shell * rng.range(0.8, 1)) / Math.max(0.05, l.length);
    }
    i += n;
  }
  // Drawn back rows first, so the front ones lie over them.
  return out.sort((p, q) => q.row - p.row || p.phi - q.phi);
};

/** The lashes of one eye: lower lid first, then upper, back rows before front, as drawn. */
export const growLashes = (rng: Rng): Lash[] => [
  ...growLid(rng.fork("lower"), true),
  ...growLid(rng.fork("upper"), false),
];

type Plane = readonly [number, number, number, number];
type Shell = readonly [number, number, number, number];

export interface LashRoot {
  root: Vec3;
  /** The lid's outward normal, the way into the lid away from the opening, and along the margin. */
  normal: Vec3;
  away: Vec3;
  along: Vec3;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Where a lash at `phi` grows: where the margin's plane cuts the lid's edge (`ROOT_UPPER`), the
 * front of the two such points; null where the plane misses it there.
 */
export const lashRoot = (plane: Plane, shell: Shell, phi: number, lower: boolean) => {
  const rs = shell[3] * (lower ? 1 : ROOT_UPPER);
  const x = Math.sin(phi);
  const r2 = 1 - x * x;
  const ml = Math.hypot(plane[1], plane[2]);
  const m = [plane[1] / ml, plane[2] / ml];
  const pc = plane[0] * shell[0] + plane[1] * shell[1] + plane[2] * shell[2];
  const k = -(plane[3] + pc + plane[0] * rs * x) / (rs * ml);
  if (k * k >= r2) return null;
  const q = Math.sqrt(r2 - k * k);
  const a = [k * m[0]! - q * m[1]!, k * m[1]! + q * m[0]!];
  const b = [k * m[0]! + q * m[1]!, k * m[1]! - q * m[0]!];
  const yz = a[1]! > b[1]! ? a : b;
  const normal: Vec3 = [x, yz[0]!, yz[1]!];
  const root: Vec3 = [
    shell[0] + rs * normal[0],
    shell[1] + rs * normal[1],
    shell[2] + rs * normal[2],
  ];
  const s = lower ? -1 : 1;
  const pn: Vec3 = [plane[0] * s, plane[1] * s, plane[2] * s];
  const d = dot(pn, normal);
  const away = unit([pn[0] - d * normal[0], pn[1] - d * normal[1], pn[2] - d * normal[2]]);
  let along = cross(away, normal);
  if (along[0] < 0) along = [-along[0], -along[1], -along[2]];
  return { root, normal, away, along } satisfies LashRoot;
};

/**
 * The point `s` (0 root, 1 tip) along a lash grown from `at`, on an eye of radius `radius`, with
 * lower lashes turned by `lift` (see `lowerLift`).
 */
export const lashPoint = (lash: Lash, at: LashRoot, radius: number, s: number, lift = 0): Vec3 => {
  const from = lash.from + (lash.lower ? lift : 0);
  const d = lash.to - lash.from;
  const th = from + d * s;
  const i = [(Math.sin(th) - Math.sin(from)) / d, (Math.cos(from) - Math.cos(th)) / d];
  const len = lash.length * radius;
  const side = lash.fan * s + lash.pull * s * s;
  const at3 = (c: number) =>
    at.root[c]! +
    at.away[c]! * lash.row * radius +
    len * (i[0]! * at.normal[c]! + i[1]! * at.away[c]! + side * at.along[c]!);
  return [at3(0), at3(1), at3(2)];
};

const VERTEX = /* glsl */ `
uniform vec3 uWallOrigin;
uniform vec3 uWallRight;
uniform vec3 uWallUp;
uniform vec2 uWallSize;
uniform vec3 uViewEye;
uniform vec4 uBall;
uniform float uPxM;
uniform float uLidsOn;
uniform vec4 uLidShell;
uniform vec4 uLidUpper;
uniform vec4 uLidLower;
// How far the lower lashes turn from their angles at rest (see lowerLift).
uniform float uLowerLift;
const float ROOT_UPPER = ${ROOT_UPPER.toFixed(5)};
// Per lash: x where (angle round the eye), y 1 on the lower lid, z row depth, w length; then the
// angle at the root and the tip, the fan and the clump's pull; then width and shade.
attribute vec4 aWhere;
attribute vec4 aShape;
attribute vec2 aLook;
varying float vAcross;
varying float vHalf;
varying float vS;
varying float vShade;
varying vec3 vP;
varying vec3 vT;

bool lashRoot(float phi, float lower, out vec3 root, out vec3 n, out vec3 away, out vec3 along) {
  vec4 pl = lower > 0.5 ? uLidLower : uLidUpper;
  vec3 c = uLidShell.xyz;
  // Seen from below, the upper lid's edge is where its margin meets the eye, the lower's where
  // it meets the lid's surface.
  float rs = uLidShell.w * (lower > 0.5 ? 1.0 : ROOT_UPPER);
  float x = sin(phi);
  float r2 = 1.0 - x * x;
  float ml = length(pl.yz);
  vec2 m = pl.yz / ml;
  float k = -(pl.w + dot(pl.xyz, c) + pl.x * rs * x) / (rs * ml);
  if (k * k >= r2) return false;
  float q = sqrt(r2 - k * k);
  vec2 a = k * m + q * vec2(-m.y, m.x);
  vec2 b = k * m - q * vec2(-m.y, m.x);
  n = vec3(x, a.y > b.y ? a : b);
  root = c + rs * n;
  vec3 pn = lower > 0.5 ? -pl.xyz : pl.xyz;
  away = normalize(pn - dot(pn, n) * n);
  along = cross(away, n);
  along *= along.x < 0.0 ? -1.0 : 1.0;
  return true;
}

// The point s along a lash (0 root, 1 tip) grown from 'root' in the lid's frame. It turns at a
// steady rate from its angle at the root to its angle at the tip, so it is an arc, and its tip
// turns aside along the margin.
vec3 lashAt(float s, vec3 root, vec3 n, vec3 away, vec3 along, vec4 where, vec4 shape) {
  float d = shape.y - shape.x;
  float th = shape.x + d * s;
  vec2 arc = vec2(sin(th) - sin(shape.x), cos(shape.x) - cos(th)) / d;
  float turn = shape.z * s + shape.w * s * s;
  return root + away * where.z * uBall.w + where.w * uBall.w * (arc.x * n + arc.y * away + turn * along);
}

// Where the viewer sees a point on the wall's plane, metres across and up it, and how much
// nearer the point is than the wall (its scale on the wall).
vec2 onWall(vec3 x, out float scale) {
  vec3 nw = cross(uWallRight, uWallUp);
  scale = dot(uWallOrigin - uViewEye, nw) / dot(x - uViewEye, nw);
  vec3 w = uViewEye + (x - uViewEye) * scale - uWallOrigin;
  return vec2(dot(w, uWallRight), dot(w, uWallUp));
}

void main() {
  float s = position.x;
  float side = position.y;
  vec3 root, n, away, along;
  if (uLidsOn < 0.5 || !lashRoot(aWhere.x, aWhere.y, root, n, away, along)) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec4 shape = aShape + vec4(aWhere.y * uLowerLift, aWhere.y * uLowerLift, 0.0, 0.0);
  vec3 p = lashAt(s, root, n, away, along, aWhere, shape);
  float ds = s < 0.5 ? 0.02 : -0.02;
  vec3 p2 = lashAt(s + ds, root, n, away, along, aWhere, shape);
  float th = mix(shape.x, shape.y, s);
  float k, k2;
  vec2 w = onWall(p, k);
  vec2 w2 = onWall(p2, k2);
  vec2 dw = (w2 - w) * sign(ds);
  vec2 dir = dot(dw, dw) > 1e-12 ? normalize(dw) : vec2(0.0, 1.0);
  // Thickest at the root, tapering mostly over its outer part.
  float width = aLook.x * uBall.w * (1.0 - 0.84 * smoothstep(0.2, 1.0, s) - 0.12 * s) * k;
  float halfPx = 0.5 * width / uPxM;
  float drawn = max(halfPx, 0.5) + 1.0;
  w += vec2(-dir.y, dir.x) * side * drawn * uPxM;
  vAcross = side * drawn;
  vHalf = halfPx;
  vS = s;
  vShade = aLook.y;
  vP = p;
  vT = cos(th) * n + sin(th) * away + (shape.z + 2.0 * shape.w * s) * along;
  gl_Position = vec4(2.0 * w / uWallSize - 1.0, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying float vAcross;
varying float vHalf;
varying float vS;
varying float vShade;
varying vec3 vP;
varying vec3 vT;
// Dark brown hair, linear.
const vec3 LASH = vec3(0.007, 0.005, 0.004);

void main() {
  float hw = max(vHalf, 0.5);
  float cover = clamp(hw + 0.5 - abs(vAcross), 0.0, 1.0) * min(1.0, 2.0 * vHalf);
  // It grows out of the skin rather than starting with a cut end.
  cover *= smoothstep(0.0, 0.025, vS);
  if (cover <= 0.002) discard;
  vec3 l = normalize(uLamp - vP);
  vec3 v = normalize(uViewEye - vP);
  vec3 t = normalize(vT);
  float tl = dot(t, l);
  float diffuse = sqrt(max(0.0, 1.0 - tl * tl));
  float th = dot(t, normalize(l + v));
  float sh = sqrt(max(0.0, 1.0 - th * th));
  float fall = lampFalloff(vP) * uLampOn * lampShadow(vP, l, uLidShell);
  vec3 hair = LASH * vShade;
  vec3 col = hair * (0.22 + 1.1 * diffuse * fall);
  // A pale sheen off the hair's surface and a warmer one through it, along its length.
  col += (vec3(0.012) * pow(sh, 80.0) + hair * 1.2 * pow(sh, 16.0)) * fall;
  gl_FragColor = vec4(col, cover);
  #include <colorspace_fragment>
}
`;

export interface WallLashes {
  readonly mesh: Mesh;
  readonly lashes: readonly Lash[];
  /** Follow the lower margin, at elevation `lower` in front, radians. */
  setLower(lower: number): void;
}

/**
 * The lashes as one instanced mesh for the wall view's scene, drawn after the wall's picture.
 * `uniforms` are the wall view's (lids, wall, lamp), shared so they follow it.
 */
export const createLashes = (rng: Rng, uniforms: Record<string, IUniform>): WallLashes => {
  const lashes = growLashes(rng);
  const lift = { value: 0 };
  const n = LASHES.segments;
  const pos: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= n; i++) {
    pos.push(i / n, -1, 0, i / n, 1, 0);
    if (i < n) {
      const a = 2 * i;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geometry.setIndex(index);
  const where = new Float32Array(lashes.length * 4);
  const shape = new Float32Array(lashes.length * 4);
  const look = new Float32Array(lashes.length * 2);
  lashes.forEach((l, i) => {
    where.set([l.phi, l.lower ? 1 : 0, l.row, l.length], i * 4);
    shape.set([l.from, l.to, l.fan, l.pull], i * 4);
    look.set([l.width, l.shade], i * 2);
  });
  geometry.setAttribute("aWhere", new InstancedBufferAttribute(where, 4));
  geometry.setAttribute("aShape", new InstancedBufferAttribute(shape, 4));
  geometry.setAttribute("aLook", new InstancedBufferAttribute(look, 2));
  geometry.instanceCount = lashes.length;
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: [WALL_GLSL, WALL_SCENE, FRAGMENT].join("\n"),
    uniforms: { ...uniforms, uLowerLift: lift },
    transparent: true,
    blending: NormalBlending,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return {
    mesh,
    lashes,
    setLower(lower) {
      lift.value = lowerLift(lower);
    },
  };
};
