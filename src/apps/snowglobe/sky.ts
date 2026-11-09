/**
 * The tinted water behind the scene. It is drawn on the far side of the glass, but coloured by
 * where the line of sight came in through the near side, so every viewer sees the same colour
 * at the same place on the ball and the joins between their views don't show. At night it holds
 * a few faint stars, fixed to the room.
 */
import {
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";

const VERTEX = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uCentre;
uniform float uRadius;
uniform vec3 uLow;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uStars;
varying vec3 vWorld;

float starHash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  vec3 oc = cameraPosition - uCentre;
  float b = dot(oc, dir);
  float c = dot(oc, oc) - uRadius * uRadius;
  float t0 = -b - sqrt(max(b * b - c, 0.0));
  vec3 n = normalize(cameraPosition + dir * max(t0, 0.0) - uCentre);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  vec3 col = lat > -0.15
    ? mix(uHorizon, uZenith, smoothstep(-0.15, 1.1, lat))
    : mix(uHorizon, uLow, smoothstep(-0.15, -0.8, lat));
  if (uStars > 0.0) {
    float lon = atan(n.x, n.z);
    // A whole number of cells round, so no star is cut where the picture's edges meet.
    vec2 g = vec2((lon + PI) / (2.0 * PI) * 377.0, lat * 60.0);
    vec2 cell = vec2(mod(floor(g.x), 377.0), floor(g.y));
    float h = starHash(cell);
    vec2 at = vec2(starHash(cell + 3.1), starHash(cell + 7.7)) - 0.5;
    float d = length(fract(g) - 0.5 - at * 0.6);
    float star = step(0.93, h) * smoothstep(0.16, 0.0, d) * smoothstep(0.0, 0.35, lat);
    col += vec3(0.75, 0.8, 1.0) * star * uStars * (0.4 + 0.6 * fract(h * 17.0));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

export interface Sky {
  readonly mesh: Mesh;
  setColors(low: Color, horizon: Color, zenith: Color, stars: number): void;
  /** The ball's centre and radius in venue metres. */
  place(centre: Vector3, radius: number): void;
}

/** A sphere of `radius` design metres, inside the glass, in the globe's scaled frame. */
export const createSky = (radius: number): Sky => {
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uCentre: { value: new Vector3() },
      uRadius: { value: 1 },
      uLow: { value: new Color() },
      uHorizon: { value: new Color() },
      uZenith: { value: new Color() },
      uStars: { value: 0 },
    },
  ]);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    side: BackSide,
    fog: true,
  });
  const mesh = new Mesh(new SphereGeometry(radius, 48, 24), material);
  return {
    mesh,
    setColors(low, horizon, zenith, stars) {
      (uniforms.uLow!.value as Color).copy(low);
      (uniforms.uHorizon!.value as Color).copy(horizon);
      (uniforms.uZenith!.value as Color).copy(zenith);
      uniforms.uStars!.value = stars;
    },
    place(centre, r) {
      (uniforms.uCentre!.value as Vector3).copy(centre);
      uniforms.uRadius!.value = r;
    },
  };
};
