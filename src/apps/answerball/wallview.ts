/**
 * A ball on a flat frame, seen from an eye in front of it: the same shader of direction a
 * sphere's `SurfacePass` uses (`vec4 surface(vec3 dir)`) drawn as a 3D ball, by casting a ray
 * from the eye through each pixel onto a unit sphere.
 *
 * Frames: x right along the wall, y up, z out of the wall towards the eye, so a `dir` of (0, 0, 1)
 * faces the eye as longitude 0 on the equator does on a sphere. Lengths are in ball radii. The
 * picture is the wall itself, a plane through the ball's centre. Each ball draws only a polygon
 * round its outline, with the outline's coverage in alpha, so it blends over whatever is drawn
 * behind it (draw that first).
 *
 * The fragment can read `uWallEye`, the eye in ball radii from the centre in the frame of `dir`,
 * for reflections and highlights that depend on where the viewer is.
 */
import {
  CircleGeometry,
  type IUniform,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector3,
  Vector4,
} from "three";
import type { Vec3 } from "../../core/sphere";

export const WALL_VIEW_GLSL = /* glsl */ `
// The eye, ball radii from the centre, in the frame of 'dir'.
uniform vec3 uWallEye;
`;

const VERTEX = /* glsl */ `
// Centre and radii of the polygon round the outline, in clip space.
uniform vec4 uPoly;
void main() {
  gl_Position = vec4(uPoly.xy + position.xy * uPoly.zw, 0.0, 1.0);
}
`;

const MAIN = /* glsl */ `
// The centre on the picture in drawing-buffer px (y up), and px per ball radius.
uniform vec3 uPlace;
void main() {
  vec2 q = (gl_FragCoord.xy - uPlace.xy) / uPlace.z;
  vec3 e = uWallEye;
  vec3 rd = normalize(vec3(q, 0.0) - e);
  // The ray's nearest approach to the centre; past the outline, the outline's own point.
  float b = -dot(e, rd);
  vec3 m = e + b * rd;
  float d = length(m);
  vec3 hit = d < 1.0 ? e + (b - sqrt(max(0.0, 1.0 - d * d))) * rd : m / max(d, 1e-6);
  float cover = clamp((1.0 - d) / max(fwidth(d), 1e-6) + 0.5, 0.0, 1.0);
  vec4 c = surface(normalize(hit));
  gl_FragColor = vec4(c.rgb, c.a * cover);
  #include <colorspace_fragment>
}
`;

/** Sides of the polygon drawn round each ball's outline. */
const SIDES = 64;

export interface WallBallOptions {
  /**
   * GLSL that declares its own uniforms and defines `vec4 surface(vec3 dir)`, the linear colour
   * at unit direction `dir` from the centre; it may read `uWallEye`.
   */
  fragment: string;
  uniforms?: Record<string, IUniform>;
  defines?: Record<string, string | number>;
}

export interface WallPlace {
  /** The ball's centre on the stage, CSS px with y down. */
  x: number;
  y: number;
  /** Stage px per ball radius on the picture. */
  scale: number;
  /** The eye, ball radii from the centre (x right, y up, z out of the wall). */
  eye: Vec3;
}

export interface WallBall {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /**
   * Put the ball on a stage `height` CSS px tall whose drawing buffer has `buffer` px per CSS px.
   */
  place(at: WallPlace, stage: { width: number; height: number }, buffer: number): void;
}

/**
 * Where the outline of a unit ball seen from `eye` falls on the picture, as a circle round it:
 * its centre (ball radii from the ball's centre, y up) and radius.
 */
export const outline = (eye: Vec3): { x: number; y: number; r: number } => {
  const len = Math.hypot(eye[0], eye[1], eye[2]);
  if (eye[2] <= 1 || len <= 1.0001) return { x: 0, y: 0, r: 4 };
  // The circle where the eye's sight lines touch the ball, then each point of it on the picture.
  const k = 1 / (len * len);
  const c: Vec3 = [eye[0] * k, eye[1] * k, eye[2] * k];
  const rho = Math.sqrt(1 - k);
  const n: Vec3 = [eye[0] / len, eye[1] / len, eye[2] / len];
  const a = Math.abs(n[1]) < 0.9 ? ([0, 1, 0] as Vec3) : ([1, 0, 0] as Vec3);
  const u0 = [
    a[1] * n[2] - a[2] * n[1],
    a[2] * n[0] - a[0] * n[2],
    a[0] * n[1] - a[1] * n[0],
  ] as const;
  const ul = Math.hypot(u0[0], u0[1], u0[2]);
  const u: Vec3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const pts: [number, number][] = [];
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const ct = Math.cos(t) * rho;
    const st = Math.sin(t) * rho;
    const p = [
      c[0] + u[0] * ct + v[0] * st,
      c[1] + u[1] * ct + v[1] * st,
      c[2] + u[2] * ct + v[2] * st,
    ];
    const s = eye[2] / (eye[2] - p[2]!);
    pts.push([eye[0] + (p[0]! - eye[0]) * s, eye[1] + (p[1]! - eye[1]) * s]);
  }
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0] / steps;
    y += p[1] / steps;
  }
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p[0] - x, p[1] - y));
  return { x, y, r };
};

export const createWallBall = (opts: WallBallOptions): WallBall => {
  const uPoly = { value: new Vector4() };
  const uPlace = { value: new Vector3() };
  const uWallEye = { value: new Vector3(0, 0, 3) };
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: [WALL_VIEW_GLSL, opts.fragment, MAIN].join("\n"),
    uniforms: { ...opts.uniforms, uPoly, uPlace, uWallEye },
    defines: opts.defines ?? {},
    transparent: true,
    blending: NormalBlending,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(new CircleGeometry(1, SIDES), material);
  mesh.frustumCulled = false;
  return {
    mesh,
    material,
    place(at, stage, buffer) {
      uWallEye.value.set(at.eye[0], at.eye[1], at.eye[2]);
      const px = at.scale * buffer;
      const cx = at.x * buffer;
      const cy = (stage.height - at.y) * buffer;
      uPlace.value.set(cx, cy, px);
      // A polygon whose edges clear the outline, with a couple of pixels for its soft edge.
      const o = outline(at.eye);
      const r = (o.r * px + 3) / Math.cos(Math.PI / SIDES);
      const w = stage.width * buffer;
      const h = stage.height * buffer;
      uPoly.value.set(
        ((cx + o.x * px) / w) * 2 - 1,
        ((cy + o.y * px) / h) * 2 - 1,
        (r / w) * 2,
        (r / h) * 2,
      );
    },
  };
};
