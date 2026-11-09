/**
 * three.js helpers for a `sphere` frame, used with `renderer3d`.
 *
 * Things that are the ball (an eye, a beach ball, an egg) draw with a `SurfacePass`: a
 * fragment shader that is given the direction from the centre for every pixel of the feed and
 * returns the colour there. Spinning the ball is a matrix on that direction, and the picture is
 * right from every side.
 *
 * Things inside the glass (a snow globe's cabin, fish in a bowl) look different from each side,
 * and with people all round there is no single right picture. `SectorViews` renders one 3D
 * scene, in venue metres with the ball's centre at (0, centreY, 0), from a few viewers standing
 * round it and one underneath, and gives each point of the surface the view of the viewer who
 * sees it most squarely, blending where two meet. Someone standing near a viewer sees a true
 * perspective view through the glass. Content close to the glass looks right to everyone, so keep
 * joins where things are near the surface or soft (snow, smoke, water).
 */
import {
  type IUniform,
  Matrix3,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
} from "three";
import type { Renderer3D } from "./renderer3d";
import { DEG, type Mat3, WHOLE_SPHERE } from "./sphere";
import type { FrameInfo, SphereInfo } from "./types";

/**
 * GLSL for the feed's geometry. Declares `uCover` (top and bottom latitude), `sphereDir(feed)`
 * for a feed position (0 to 1 across, 0 to 1 down from the top row) and `sphereLatLon(dir)`.
 */
export const SPHERE_GLSL = /* glsl */ `
uniform vec2 uCover;
const float SPHERE_PI = 3.141592653589793;
vec3 sphereDir(vec2 feed) {
  float lon = feed.x * 2.0 * SPHERE_PI - SPHERE_PI;
  float lat = uCover.x - feed.y * (uCover.x - uCover.y);
  float c = cos(lat);
  return vec3(c * sin(lon), sin(lat), c * cos(lon));
}
vec2 sphereLatLon(vec3 d) {
  vec3 n = normalize(d);
  return vec2(asin(clamp(n.y, -1.0, 1.0)), atan(n.x, n.z));
}
`;

const QUAD_VERTEX = /* glsl */ `
varying vec2 vFeed;
void main() {
  vFeed = vec2(uv.x, 1.0 - uv.y);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** A rotation for a `mat3` uniform. */
export const toMatrix3 = (m: Mat3, out = new Matrix3()): Matrix3 =>
  out.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);

const coverOf = (s: SphereInfo): [number, number] => [s.cover.top, s.cover.bottom];

export interface SurfacePass {
  readonly material: ShaderMaterial;
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  /** Draw the feed into the renderer's canvas, or into `target`. */
  render(target?: WebGLRenderTarget | null): void;
  /** Follow a frame whose sphere changed (`ctx.onResize`). */
  setSphere(s: SphereInfo): void;
}

export interface SurfaceOptions {
  /**
   * GLSL that declares its own uniforms and defines `vec4 surface(vec3 dir)`, the colour at the
   * unit direction `dir` from the centre (y up, longitude 0 towards +z). `SPHERE_GLSL` comes
   * before it. Colours are linear, as in three.js materials (a `Color` uniform is already
   * linear), and are encoded for the canvas after it.
   */
  fragment: string;
  uniforms?: Record<string, IUniform>;
}

/**
 * A shader over the whole feed. It is prepared with the renderer, which compiles it in the
 * background and disposes it, so check `r3d.ready` before drawing.
 */
export const createSurfacePass = (
  r3d: Renderer3D,
  frame: FrameInfo,
  opts: SurfaceOptions,
): SurfacePass => {
  const material = new ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: [
      SPHERE_GLSL,
      opts.fragment,
      "varying vec2 vFeed;",
      "void main() {",
      "  gl_FragColor = surface(sphereDir(vFeed));",
      "  #include <colorspace_fragment>",
      "}",
    ].join("\n"),
    uniforms: { ...opts.uniforms, uCover: { value: coverOf(frame.sphere ?? WHOLE_SPHERE) } },
    depthTest: false,
    depthWrite: false,
  });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  r3d.prepare(scene, camera);
  return {
    material,
    scene,
    camera,
    render(target = null) {
      const r = r3d.renderer;
      r.setRenderTarget(target);
      r.render(scene, camera);
      r.setRenderTarget(null);
    },
    setSphere(s) {
      material.uniforms.uCover!.value = coverOf(s);
    },
  };
};

export interface SectorOptions {
  /**
   * Viewers standing round the ball. Default 5: with three, the band 25° to 45° up midway
   * between two of them faces none of them; with six, a scene's middle repeats more round the
   * ball (measured by the fishbowl and snowglobe builds).
   */
  around?: number;
  /** Their distance from the spot under the centre, metres. Default two diameters. */
  distance?: number;
  /** Their eye height, metres. Default 1.6. */
  eye?: number;
  /** Add a viewer right underneath, when the ball hangs high enough. Default true. */
  below?: boolean;
  /** Longitude of the first viewer round the ball, radians. Default 0. */
  start?: number;
  /** How sharply one view gives way to the next where they meet; higher is a narrower join. Default 24. */
  sharpness?: number;
  /** Side of each view's square render target, px. Default from the feed's height, at most 2048. */
  size?: number;
  /** Multisampling for each view. Default 4. */
  samples?: number;
}

export interface SectorViewer {
  /** Where the viewer's eye is, venue metres. */
  eye: Vector3;
  /** Longitude they stand at, or null for the viewer underneath. */
  lon: number | null;
  camera: PerspectiveCamera;
}

export interface SectorViews {
  readonly viewers: readonly SectorViewer[];
  /**
   * Render `scene` (venue metres) from every viewer, then compose the feed into the canvas or
   * `target`. Call `r3d.prepare(scene, views.viewers[0].camera)` once when the scene is built.
   */
  render(scene: Scene, target?: WebGLRenderTarget | null): void;
  resize(frame: FrameInfo): void;
  dispose(): void;
}

const composeFragment = (n: number): string => {
  const lines: string[] = [SPHERE_GLSL, "uniform vec3 uCentre;", "uniform float uRadius;"];
  lines.push("uniform float uSharp;", "varying vec2 vFeed;");
  for (let i = 0; i < n; i++) {
    lines.push(`uniform sampler2D uView${i};`, `uniform mat4 uProj${i};`, `uniform vec3 uEye${i};`);
  }
  lines.push(
    "vec4 viewSample(sampler2D tex, mat4 proj, vec3 p) {",
    "  vec4 c = proj * vec4(p, 1.0);",
    "  vec2 uv = clamp(c.xy / c.w * 0.5 + 0.5, 0.0, 1.0);",
    "  return texture2D(tex, uv);",
    "}",
    "void main() {",
    "  vec3 n = sphereDir(vFeed);",
    "  vec3 p = uCentre + uRadius * n;",
    "  float best = -2.0;",
  );
  // How squarely each viewer sees this point, then a soft maximum over them.
  for (let i = 0; i < n; i++) {
    lines.push(`  float f${i} = dot(n, normalize(uEye${i} - p));`, `  best = max(best, f${i});`);
  }
  lines.push("  vec4 sum = vec4(0.0);", "  float total = 0.0;");
  for (let i = 0; i < n; i++) {
    lines.push(
      `  float w${i} = exp(uSharp * (f${i} - best));`,
      `  if (w${i} > 0.004) { sum += w${i} * viewSample(uView${i}, uProj${i}, p); total += w${i}; }`,
    );
  }
  // The views hold linear colour; encode it for the canvas like any three.js material.
  lines.push(
    "  gl_FragColor = vec4(sum.rgb / max(total, 1e-6), 1.0);",
    "  #include <colorspace_fragment>",
    "}",
  );
  return lines.join("\n");
};

/**
 * Views of a scene inside the ball from people round it. It owns render targets and a
 * composing shader, released by `dispose` (or with the renderer).
 */
export const createSectorViews = (
  r3d: Renderer3D,
  frame: FrameInfo,
  opts: SectorOptions = {},
): SectorViews => {
  let s = frame.sphere ?? WHOLE_SPHERE;
  const eyeY = opts.eye ?? 1.6;
  const around = Math.max(1, Math.round(opts.around ?? 5));
  const start = opts.start ?? 0;
  const below = (opts.below ?? true) && s.centreY - s.radius > eyeY + 0.3;
  const viewers: SectorViewer[] = [];
  for (let i = 0; i < around; i++) {
    viewers.push({
      eye: new Vector3(),
      lon: start + (i * 2 * Math.PI) / around,
      camera: new PerspectiveCamera(),
    });
  }
  if (below) viewers.push({ eye: new Vector3(), lon: null, camera: new PerspectiveCamera() });

  const targets: WebGLRenderTarget[] = viewers.map(
    () => new WebGLRenderTarget(1, 1, { samples: opts.samples ?? 4, depthBuffer: true }),
  );
  const uniforms: Record<string, IUniform> = {
    uCover: { value: coverOf(s) },
    uCentre: { value: new Vector3() },
    uRadius: { value: 1 },
    uSharp: { value: opts.sharpness ?? 24 },
  };
  viewers.forEach((v, i) => {
    uniforms[`uView${i}`] = { value: targets[i]!.texture };
    uniforms[`uProj${i}`] = { value: new Matrix4() };
    uniforms[`uEye${i}`] = { value: v.eye };
  });
  const material = new ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: composeFragment(viewers.length),
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const composeScene = new Scene();
  const composeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  composeScene.add(quad);
  r3d.prepare(composeScene, composeCamera);

  const place = () => {
    const centre = new Vector3(0, s.centreY, 0);
    const distance = opts.distance ?? 4 * s.radius;
    for (const v of viewers) {
      if (v.lon === null) v.eye.set(0, eyeY, 0);
      else v.eye.set(distance * Math.sin(v.lon), eyeY, distance * Math.cos(v.lon));
      const d = v.eye.distanceTo(centre);
      // Just wide enough for the whole ball as seen from there.
      const half = Math.asin(Math.min(0.999, s.radius / d));
      const cam = v.camera;
      cam.fov = (2 * half) / DEG + 2;
      cam.aspect = 1;
      cam.near = Math.max(0.05, d - s.radius - 0.2);
      cam.far = d + s.radius + 0.2;
      cam.position.copy(v.eye);
      if (v.lon === null) cam.up.set(0, 0, -1);
      else cam.up.set(0, 1, 0);
      cam.lookAt(centre);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    }
    uniforms.uCover!.value = coverOf(s);
    (uniforms.uCentre!.value as Vector3).copy(centre);
    uniforms.uRadius!.value = s.radius;
  };

  const sizeTargets = (f: FrameInfo) => {
    const feedRows = Math.round(f.height * f.pixelRatio);
    const side = Math.max(256, Math.min(2048, Math.round(opts.size ?? feedRows)));
    for (const t of targets) if (t.width !== side) t.setSize(side, side);
  };

  place();
  sizeTargets(frame);

  return {
    viewers,
    render(scene, target = null) {
      const r = r3d.renderer;
      viewers.forEach((v, i) => {
        r.setRenderTarget(targets[i]!);
        r.render(scene, v.camera);
        (uniforms[`uProj${i}`]!.value as Matrix4).multiplyMatrices(
          v.camera.projectionMatrix,
          v.camera.matrixWorldInverse,
        );
      });
      r.setRenderTarget(target);
      r.render(composeScene, composeCamera);
      r.setRenderTarget(null);
    },
    resize(f) {
      s = f.sphere ?? WHOLE_SPHERE;
      place();
      sizeTargets(f);
    },
    dispose() {
      for (const t of targets) t.dispose();
      material.dispose();
      quad.geometry.dispose();
    },
  };
};
