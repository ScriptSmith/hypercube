/**
 * A ball on a wall, seen from in front. The wall is a window onto venue space, as in `view3d`:
 * every pixel is a ray from one viewer through its point on the wall. Where a ray meets the ball
 * the shader asks the app's `surface(dir)` for the colour, the same GLSL a `SurfacePass` uses on
 * a sphere (the unit direction `dir` from the ball's centre), with the ray itself in `wallRay` so
 * reflections and highlights can follow the real view; elsewhere it asks `wallBackdrop`. The
 * ball's outline is antialiased, and `surface` runs only on and just round the ball, in whole
 * 2 x 2 pixel blocks, so its screen-space derivatives stay sound.
 *
 * GLSL contract. Before the app's fragment come the uniforms below and:
 * - `vec3 wallRay`, `vec3 wallHit`: the view ray (unit, venue space) and the point on the ball,
 *   set before `surface` is called.
 * - `float wallSphere(vec3 ro, vec3 rd, vec4 ball, out float t)`: how far the ray passes outside
 *   the ball (negative inside), metres, and the distance along it to the hit or to the closest
 *   approach.
 * - `float wallSphereShadow(vec3 p, vec3 l, vec4 ball, float spread)`: light reaching `p` from
 *   direction `l` past the ball, 0 to 1, with a penumbra that widens by `spread` per metre.
 * The app defines `vec4 surface(vec3 dir)` and `vec3 wallBackdrop(vec3 ro, vec3 rd)`, and, with
 * `WALL_FRONT` defined, `vec4 wallFront(vec3 ro, vec3 rd, float ballT)` for things in front of
 * the ball (premultiplied colour and coverage; `ballT` is the ball's distance along the ray, or
 * -1). Where the front hides everything behind it by a few pixels' margin, it can set
 * `wallFrontHides`, and the ball and backdrop aren't drawn there. Colours are linear and encoded
 * for the canvas after.
 */
import {
  type IUniform,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  type WebGLRenderTarget,
} from "three";
import type { Renderer3D } from "../../core/renderer3d";
import type { FrameInfo, SetupInfo } from "../../core/types";
import { defaultEye, type Surface, surfaceOf, type Vec3, windowView } from "../../core/view3d";

export interface WallBall {
  /** Venue metres. */
  centre: Vec3;
  radius: number;
}

export interface WallViewOptions {
  /** GLSL with `surface` and `wallBackdrop` (see the header). */
  fragment: string;
  uniforms?: Record<string, IUniform>;
  defines?: Record<string, string | number>;
  ball: WallBall;
  /** The viewer the picture is drawn for, venue metres. Default: view3d's shared eye. */
  eye?: Vec3;
}

export interface WallView {
  readonly material: ShaderMaterial;
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  /** The part of the wall the stage shows, venue metres. */
  readonly surface: Surface;
  readonly eye: Vec3;
  readonly ball: WallBall;
  render(target?: WebGLRenderTarget | null): void;
  resize(frame: FrameInfo): void;
  setBall(ball: WallBall): void;
  /** The point on the wall under stage px (x, y), venue metres. */
  wallPoint(x: number, y: number): Vec3;
  /** Stage px of a point in venue space, or null behind the viewer. */
  toStage(p: Vec3): { x: number; y: number } | null;
  /** Where the view ray through stage px (x, y) meets the ball: its unit direction from the centre. */
  hitBall(x: number, y: number, margin?: number): Vec3 | null;
}

export const WALL_GLSL = /* glsl */ `
uniform vec3 uWallOrigin;
uniform vec3 uWallRight;
uniform vec3 uWallUp;
uniform vec2 uWallSize;
uniform vec3 uViewEye;
uniform vec4 uBall;
// Metres per drawing-buffer pixel on the wall's plane.
uniform float uPxM;
vec3 wallRay;
vec3 wallHit;
bool wallFrontHides;
float wallSphere(vec3 ro, vec3 rd, vec4 ball, out float t) {
  vec3 oc = ball.xyz - ro;
  float tc = dot(oc, rd);
  vec3 closest = oc - rd * tc;
  float m2 = dot(closest, closest);
  float r2 = ball.w * ball.w;
  if (m2 < r2) {
    t = tc - sqrt(r2 - m2);
    return sqrt(m2) - ball.w;
  }
  t = tc;
  return sqrt(m2) - ball.w;
}
float wallSphereShadow(vec3 p, vec3 l, vec4 ball, float spread) {
  vec3 oc = ball.xyz - p;
  float along = dot(oc, l);
  if (along <= 0.0) return 1.0;
  float miss = length(oc - l * along) - ball.w;
  float pen = 0.02 + spread * along;
  return smoothstep(-pen, pen, miss);
}
`;

const VERTEX = /* glsl */ `
varying vec2 vWall;
void main() {
  vWall = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const MAIN = /* glsl */ `
varying vec2 vWall;
void main() {
  vec3 p = uWallOrigin + uWallRight * (vWall.x * uWallSize.x) + uWallUp * (vWall.y * uWallSize.y);
  vec3 ro = uViewEye;
  vec3 toWall = p - ro;
  vec3 rd = normalize(toWall);
  wallRay = rd;
  float t;
  float miss = wallSphere(ro, rd, uBall, t);
  // A pixel's footprint where the ray meets the ball.
  float px = uPxM * t / length(toWall);
  float cover = clamp(0.5 - miss / px, 0.0, 1.0);
  float ballT = cover > 0.0 ? t : -1.0;
  vec4 front = vec4(0.0);
  wallFrontHides = false;
#ifdef WALL_FRONT
  front = wallFront(ro, rd, ballT);
#endif
  vec3 col = vec3(0.0);
  if (!wallFrontHides) {
    col = wallBackdrop(ro, rd);
    // Margin of a few pixels, so every 2 x 2 block that shows the ball runs this branch whole.
    if (miss < 3.0 * px) {
      vec3 dir = normalize(ro + rd * t - uBall.xyz);
      wallHit = uBall.xyz + dir * uBall.w;
      col = mix(col, surface(dir).rgb, cover);
    }
  }
  col = col * (1.0 - front.a) + front.rgb;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const v3 = (a: Vec3) => new Vector3(a[0], a[1], a[2]);

export const createWallView = (
  r3d: Renderer3D,
  frame: FrameInfo,
  setup: SetupInfo,
  opts: WallViewOptions,
): WallView => {
  let surface = surfaceOf(frame, setup);
  const eye = opts.eye ?? defaultEye(frame, setup);
  let ball = opts.ball;
  let view = windowView(surface, eye, frame);
  let stage = { width: frame.width, height: frame.height };

  const uniforms: Record<string, IUniform> = {
    ...opts.uniforms,
    uWallOrigin: { value: new Vector3() },
    uWallRight: { value: new Vector3() },
    uWallUp: { value: new Vector3() },
    uWallSize: { value: [1, 1] },
    uViewEye: { value: v3(eye) },
    uBall: { value: [0, 0, 0, 1] },
    uPxM: { value: 0.01 },
  };
  const setSurface = (f: FrameInfo) => {
    uniforms.uWallOrigin!.value.copy(v3(surface.origin));
    uniforms.uWallRight!.value.copy(v3(surface.right));
    uniforms.uWallUp!.value.copy(v3(surface.up));
    uniforms.uWallSize!.value = [surface.width, surface.height];
    uniforms.uPxM!.value = surface.width / Math.max(1, f.width * f.pixelRatio);
  };
  const setBallUniform = () => {
    uniforms.uBall!.value = [ball.centre[0], ball.centre[1], ball.centre[2], ball.radius];
  };
  setSurface(frame);
  setBallUniform();

  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: [WALL_GLSL, opts.fragment, MAIN].join("\n"),
    uniforms,
    defines: opts.defines ?? {},
    depthTest: false,
    depthWrite: false,
  });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  r3d.prepare(scene, camera);

  const wallPoint = (x: number, y: number): Vec3 => {
    const along = (x / Math.max(1, stage.width)) * surface.width;
    const upward = (1 - y / Math.max(1, stage.height)) * surface.height;
    const o = surface.origin;
    const r = surface.right;
    const u = surface.up;
    return [
      o[0] + r[0] * along + u[0] * upward,
      o[1] + r[1] * along + u[1] * upward,
      o[2] + r[2] * along + u[2] * upward,
    ];
  };

  return {
    material,
    scene,
    camera,
    get surface() {
      return surface;
    },
    eye,
    get ball() {
      return ball;
    },
    render(target = null) {
      const r = r3d.renderer;
      r.setRenderTarget(target);
      r.render(scene, camera);
      r.setRenderTarget(null);
    },
    resize(f) {
      surface = surfaceOf(f, setup);
      view = windowView(surface, eye, f);
      stage = { width: f.width, height: f.height };
      setSurface(f);
    },
    setBall(b) {
      ball = b;
      setBallUniform();
    },
    wallPoint,
    toStage(p) {
      const s = view.toStage(p);
      return s ? { x: s.x, y: s.y } : null;
    },
    hitBall(x, y, margin = 0) {
      const p = wallPoint(x, y);
      const d: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      const rd: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
      const oc: Vec3 = [ball.centre[0] - eye[0], ball.centre[1] - eye[1], ball.centre[2] - eye[2]];
      const tc = oc[0] * rd[0] + oc[1] * rd[1] + oc[2] * rd[2];
      const cx = oc[0] - rd[0] * tc;
      const cy = oc[1] - rd[1] * tc;
      const cz = oc[2] - rd[2] * tc;
      const m2 = cx * cx + cy * cy + cz * cz;
      const r = ball.radius + margin;
      if (m2 > r * r) return null;
      const t = tc - Math.sqrt(Math.max(0, ball.radius * ball.radius - m2));
      const h: Vec3 = [
        eye[0] + rd[0] * t - ball.centre[0],
        eye[1] + rd[1] * t - ball.centre[1],
        eye[2] + rd[2] * t - ball.centre[2],
      ];
      const hl = Math.hypot(h[0], h[1], h[2]) || 1;
      return [h[0] / hl, h[1] / hl, h[2] / hl];
    },
  };
};
