/**
 * The studio the balls stand in on a wall: a seamless sweep of dark paper, a floor that curves up
 * into a back wall, lit softly from above and by the softbox in front that also makes the balls'
 * highlights, with a glow on the wall behind each ball so its outline shows. Each ball darkens the
 * floor round where it stands and casts a soft shadow to one side.
 *
 * The floor and wall are the same all along the wall, so every column is drawn as seen from
 * straight in front of it (the eye slides along with the pixel): each ball's own eye sees the
 * same backdrop, and they all join up. Lengths are in ball radii: x along the wall from its left
 * edge, y up from the floor, z out of the wall from the plane through the balls' centres.
 */
import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3, Vector4 } from "three";
import type { Vec3 } from "../../core/sphere";

export const MAX_BALLS = 3;
/** The back wall's distance behind the balls' centres, and the cove's radius, ball radii. */
export const BACK = { depth: 2.4, cove: 0.9 };

const VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
// Drawing-buffer px of the floor line at the wall's left edge, and px per ball radius.
uniform vec3 uOrigin;
// The eye's height above the floor and distance out from the wall.
uniform vec2 uEye;
uniform vec4 uBall[${MAX_BALLS}];
uniform vec3 uKeyDir;
uniform vec3 uAlbedo;

const float BACK_Z = ${(-BACK.depth).toFixed(4)};
const float COVE = ${BACK.cove.toFixed(4)};
// An overcast of light from above, the softbox in front, and a glow on the wall behind each ball.
const vec3 SKY = vec3(0.085, 0.09, 0.105);
const vec3 KEY = vec3(0.4, 0.385, 0.36);
const vec3 GLOW = vec3(0.3, 0.31, 0.36);

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// How much of a light from direction d (unit) a unit ball at c leaves at point h: 1 lit, 0 dark.
// 'spread' is how much wider the penumbra grows per unit of distance from the ball.
float ballShadow(vec3 h, vec3 d, vec3 c, float spread) {
  vec3 to = c - h;
  float s = dot(to, d);
  if (s <= 0.0) return 1.0;
  float perp = length(to - s * d);
  float pen = 0.03 + spread * s;
  return smoothstep(1.0 - pen, 1.0 + pen, perp);
}

void main() {
  vec2 p = (gl_FragCoord.xy - uOrigin.xy) / uOrigin.z;
  // The eye is straight in front of this column, so the ray stays in its own (y, z) plane.
  vec2 o = vec2(uEye.x, uEye.y);
  vec2 d = normalize(vec2(p.y, 0.0) - o);
  vec3 hit;
  vec3 n;
  float tf = d.x < 0.0 ? -o.x / d.x : 1e9;
  float zf = o.y + tf * d.y;
  float tw = (BACK_Z - o.y) / d.y;
  float yw = o.x + tw * d.x;
  if (zf >= BACK_Z + COVE) {
    hit = vec3(p.x, 0.0, zf);
    n = vec3(0.0, 1.0, 0.0);
  } else if (yw >= COVE) {
    hit = vec3(p.x, yw, BACK_Z);
    n = vec3(0.0, 0.0, 1.0);
  } else {
    // The cove: the far side of the circle that rounds the corner.
    vec2 cc = vec2(COVE, BACK_Z + COVE);
    vec2 oc = o - cc;
    float b = dot(oc, d);
    float t = -b + sqrt(max(0.0, b * b - dot(oc, oc) + COVE * COVE));
    vec2 q = o + t * d;
    hit = vec3(p.x, q.x, q.y);
    vec2 nn = (cc - q) / COVE;
    n = vec3(0.0, nn.x, nn.y);
  }

  float keyLit = 1.0;
  float ao = 0.0;
  vec3 glow = vec3(0.0);
  for (int i = 0; i < ${MAX_BALLS}; i++) {
    vec4 bb = uBall[i];
    if (bb.w < 0.5) continue;
    vec3 c = bb.xyz;
    vec3 to = c - hit;
    float dist = length(to);
    ao += max(0.0, dot(n, to) / dist) / (dist * dist);
    keyLit *= ballShadow(hit, uKeyDir, c, 0.09);
    vec2 g = vec2(hit.x - c.x, hit.y - 1.3) / vec2(0.95, 1.15);
    glow += GLOW * exp(-0.5 * dot(g, g)) * smoothstep(0.2, 0.9, n.z);
  }
  vec3 light = SKY * (0.3 + 0.7 * max(0.0, n.y)) * (1.0 - 0.9 * min(1.0, ao));
  light += KEY * max(0.0, dot(n, uKeyDir)) * keyLit * (1.0 - 0.5 * min(1.0, ao)) + glow;
  // The light falls off towards the top of the wall and towards the people in front.
  light *= mix(1.0, 0.4, smoothstep(1.2, 4.0, hit.y)) * mix(1.0, 0.55, smoothstep(0.5, 3.0, hit.z));
  vec3 col = uAlbedo * light;
  // Dither by about one step of 8-bit output, so the dark gradients don't band on a big wall.
  float noise = hash12(gl_FragCoord.xy) - 0.5;
  vec3 slope = max(2.275 * pow(max(col, vec3(1e-6)), vec3(0.5833)), vec3(1.0 / 12.92));
  col = max(vec3(0.0), col + noise * slope / 255.0);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export interface Backdrop {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /**
   * Where the floor line is (drawing-buffer px from the bottom), px per ball radius, the eye, and
   * each ball's centre in ball radii (x from the wall's left edge, y up from the floor).
   */
  set(opts: {
    floor: number;
    scale: number;
    eye: { up: number; out: number };
    balls: readonly Vec3[];
  }): void;
}

export const createBackdrop = (albedo: string, keyDir: Vec3): Backdrop => {
  const uBall = { value: Array.from({ length: MAX_BALLS }, () => new Vector4()) };
  const uOrigin = { value: new Vector3() };
  const uEye = { value: new Vector2(1.2, 3.4) };
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uOrigin,
      uEye,
      uBall,
      uKeyDir: { value: new Vector3(...keyDir) },
      uAlbedo: { value: new Color(albedo) },
    },
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    material,
    set({ floor, scale, eye, balls }) {
      uOrigin.value.set(0, floor, scale);
      uEye.value.set(1 + eye.up, eye.out);
      uBall.value.forEach((v, i) => {
        const b = balls[i];
        if (b) v.set(b[0], b[1], b[2], 1);
        else v.set(0, 0, 0, 0);
      });
    },
  };
};
