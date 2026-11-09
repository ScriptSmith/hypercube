/** A city at night seen from a hill: lit windows, a river and a bridge, cars along the shore. */
export const CITY = /* glsl */ `
/** One row of buildings: lit windows in rgb, how much is building in a. */
vec4 towers(vec2 p, float t, float s, float cellW, float hmin, float hmax, float ground, float dim) {
  float cell = floor(p.x / cellW);
  float u = p.x / cellW - cell;
  float r = rnd2(vec2(cell, s));
  float centre = exp(-sq(p.x / 0.42));
  float h = mix(hmin, hmax, r * r) * (0.5 + 0.8 * centre);
  float gap = 0.05 + 0.12 * rnd2(vec2(cell, s + 1.0));
  float y = p.y - ground;
  float body = max(max(gap - u, u - 0.97) * cellW, y - h);
  // Some have a narrower top storey or a mast.
  float kind = rnd2(vec2(cell, s + 2.0));
  if (kind > 0.7) body = min(body, max(abs(u - 0.5) * cellW - cellW * 0.22, abs(y - h - 0.02) - 0.02));
  if (kind > 0.88) body = min(body, max(abs(u - 0.5) * cellW - 0.0018, abs(y - h - 0.04) - 0.04));
  body = max(body, -y - 0.3);
  float inside = fill(body);
  vec2 wq = vec2(p.x / 0.0105, y / 0.0165);
  vec2 wc = floor(wq);
  vec2 wf = wq - wc;
  float pane = smoothstep(0.18, 0.32, wf.x) * (1.0 - smoothstep(0.68, 0.82, wf.x))
    * smoothstep(0.25, 0.38, wf.y) * (1.0 - smoothstep(0.72, 0.85, wf.y));
  // Now and then a window goes on or off.
  float era = floor(t / 61.0 + rnd2(wc + s * 7.0) * 9.0);
  float lit = step(rnd2(wc + vec2(era * 13.0, s)), 0.30);
  vec3 tint = mix(vec3(1.0, 0.78, 0.44), vec3(0.74, 0.86, 1.0), step(0.78, rnd2(wc + 3.0)));
  float inner = step(0.012, h - y) * step(0.004, y) * step(gap + 0.05, u) * step(u, 0.93);
  return vec4(tint * lit * pane * inner * dim, inside);
}

vec3 skyline(vec2 p, float t) {
  float hz = -0.06;
  float sy = clamp((p.y - hz) / 1.0, 0.0, 1.0);
  vec3 col = mix(vec3(0.34, 0.22, 0.24), vec3(0.06, 0.07, 0.16), smoothstep(0.0, 0.35, sy));
  col = mix(col, vec3(0.015, 0.02, 0.06), smoothstep(0.35, 1.0, sy));
  col += stars(p, 60.0, 0.18, t) * smoothstep(0.25, 0.6, p.y);
  float cl = fbm(vec2(p.x * 1.2 - t * 0.008, p.y * 5.0 + 2.0));
  col = mix(col, vec3(0.30, 0.20, 0.24), smoothstep(0.55, 0.8, cl) * smoothstep(0.1, 0.3, p.y) * 0.5);
  vec4 far = towers(p, t, 5.0, 0.045, 0.05, 0.22, hz, 0.55);
  col = mix(col, vec3(0.07, 0.07, 0.12), far.a);
  col += far.rgb;
  vec4 near = towers(p, t, 19.0, 0.07, 0.06, 0.33, hz - 0.012, 1.0);
  col = mix(col, vec3(0.035, 0.035, 0.06), near.a);
  col += near.rgb;
  return col;
}

vec3 scene(vec2 p) {
  float t = uStage.x;
  float hz = -0.06;
  float bank = -0.105;
  vec3 col;
  if (p.y > bank) {
    col = skyline(p, t);
    col = mix(col, vec3(0.03, 0.03, 0.05), fill(p.y - bank - 0.01));
  } else {
    // The river: the lights above stretched into wavering columns.
    float depth = bank - p.y;
    float wob = 0.008 * sin(p.y * 210.0 + t * 1.6) * (0.4 + vnoise(vec2(p.x * 9.0, p.y * 60.0 - t * 0.3)));
    vec3 refl = skyline(vec2(p.x + wob, hz + depth * 0.55), t);
    col = mix(vec3(0.02, 0.025, 0.05), refl, 0.55 * (1.0 - smoothstep(0.0, 0.26, depth)));
  }
  // A bridge across the river.
  float bx = (p.x + 0.28) / 0.34;
  float arch = bank + 0.055 * (1.0 - bx * bx);
  float deck = bank + 0.06;
  if (abs(bx) < 1.15) {
    float span = abs(p.y - deck) - 0.004;
    float curve = abs(p.y - arch) - 0.0025;
    float piers = max(abs(fract(bx * 3.0 + 0.5) - 0.5) * 0.23 - 0.004, max(p.y - deck, arch - p.y));
    float bridge = min(min(span, curve), piers);
    col = mix(col, vec3(0.03, 0.03, 0.05), fill(bridge));
    float lamps = (1.0 - smoothstep(0.1, 0.35, length(vec2((fract(bx * 9.0) - 0.5) * 0.075, p.y - deck - 0.009)) * 60.0));
    col += vec3(1.0, 0.8, 0.5) * lamps * 0.8;
  }
  // Cars along the near shore.
  float shore = -0.29;
  if (p.y < shore + 0.03) col = mix(col, vec3(0.02, 0.02, 0.035), fill(p.y - shore));
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float dir = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
    float x = fract(rnd(fi) + t * (0.018 + 0.012 * rnd(fi + 30.0)) * dir) * 2.6 - 1.3;
    vec2 q = p - vec2(x, shore + 0.006 - 0.004 * dir);
    q.x *= 0.5;
    float g = exp(-dot(q, q) / 0.000006);
    col += (dir > 0.0 ? vec3(1.0, 0.92, 0.75) : vec3(1.0, 0.45, 0.25)) * g * 0.9;
  }
  // The hill we stand on, and a tree.
  float hill = p.y - (-0.36 + 0.06 * smoothstep(0.1, 0.9, p.x) + 0.01 * vnoise(vec2(p.x * 20.0, 4.0)));
  vec2 tr = p - vec2(0.58, -0.31);
  float tree = min(sdBox(tr - vec2(0.0, 0.05), vec2(0.006, 0.06)),
    length(tr - vec2(0.0, 0.14)) - 0.065 - 0.012 * (vnoise(tr * 40.0) - 0.5));
  col = mix(col, vec3(0.012, 0.012, 0.02), fill(min(hill, tree)));
  return col;
}
`;
