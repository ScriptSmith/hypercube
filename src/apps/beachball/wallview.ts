/**
 * Solid balls drawn on a wall. Each ball is a square of stage pixels round its disc, and for
 * every pixel the shader finds the point of the ball behind it, its normal and the direction to
 * a viewer's eye, then asks the app's GLSL for the colour there.
 *
 * A ball is seen along the line from one eye to its centre, as if from a few metres away: the
 * disc on the wall is exactly the ball's circle, so touch and physics can treat it as one, while
 * shading, highlights and reflections use the true direction to that eye, so a ball high on the
 * wall shows its underside to someone standing below it and a ball on the ground its top. On a
 * wall people stand all along it, so an app usually puts the eye in front of each ball.
 *
 * Directions are in the wall's frame: x right along the wall, y up, z out of the wall towards
 * the people in front of it. Draw with an orthographic camera; the quad ignores it.
 */
import { type IUniform, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, Vector3 } from "three";

export interface WallBallOptions {
  /**
   * GLSL that declares its own uniforms and defines `vec4 wallSurface(vec3 n, vec3 v, float aa)`:
   * the linear colour of the ball where its unit normal is `n`, seen from the unit direction `v`
   * (both in the wall's frame), with `aa` the angle on the ball one pixel spans there. Alpha is
   * ignored; the edge is smoothed here.
   */
  fragment: string;
  uniforms?: Record<string, IUniform>;
}

export interface WallBall {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /**
   * Put the ball at (x, y) stage px (y down) with radius `r` stage px, seen from the direction
   * `toEye` (wall frame, any length) on a stage `width` by `height`.
   */
  place(
    x: number,
    y: number,
    r: number,
    toEye: readonly [number, number, number],
    width: number,
    height: number,
  ): void;
}

const VERTEX = /* glsl */ `
uniform vec2 uStage;
uniform vec3 uBall;
varying vec2 vLocal;
// A little wider than the disc, so its smoothed edge has room.
const float PAD = 1.08;
void main() {
  vLocal = position.xy * PAD;
  vec2 px = uBall.xy + vec2(vLocal.x, -vLocal.y) * uBall.z;
  gl_Position = vec4(px.x / uStage.x * 2.0 - 1.0, 1.0 - px.y / uStage.y * 2.0, 0.0, 1.0);
}
`;

const fragmentOf = (body: string) => /* glsl */ `
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uView;
varying vec2 vLocal;
${body}
void main() {
  float r = length(vLocal);
  float edge = max(fwidth(r), 1e-4);
  float cover = 1.0 - smoothstep(1.0 - 0.5 * edge, 1.0 + 0.5 * edge, r);
  if (cover <= 0.0) discard;
  vec2 l = vLocal / max(r, 1.0);
  float lz = sqrt(max(0.0, 1.0 - dot(l, l)));
  vec3 n = normalize(l.x * uRight + l.y * uUp + lz * uView);
  // On the ball an angle grows faster than the disc's radius towards its rim.
  float aa = min(edge / max(lz, 0.06), 0.5);
  vec4 c = wallSurface(n, uView, aa);
  gl_FragColor = vec4(c.rgb, cover);
  #include <colorspace_fragment>
}
`;

export const createWallBall = (opts: WallBallOptions): WallBall => {
  const right = new Vector3(1, 0, 0);
  const up = new Vector3(0, 1, 0);
  const view = new Vector3(0, 0, 1);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: fragmentOf(opts.fragment),
    uniforms: {
      ...opts.uniforms,
      uStage: { value: [1, 1] },
      uBall: { value: new Vector3(0, 0, 1) },
      uRight: { value: right },
      uUp: { value: up },
      uView: { value: view },
    },
    transparent: true,
    blending: NormalBlending,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const ball = material.uniforms.uBall!.value as Vector3;
  return {
    mesh,
    material,
    place(x, y, r, toEye, width, height) {
      material.uniforms.uStage!.value = [width, height];
      ball.set(x, y, r);
      view.set(toEye[0], toEye[1], toEye[2]);
      if (view.lengthSq() < 1e-12) view.set(0, 0, 1);
      view.normalize();
      // The picture's right is the wall's right, turned to face the eye; its up follows.
      right.set(view.z, 0, -view.x);
      if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
      right.normalize();
      up.crossVectors(view, right);
    },
  };
};
