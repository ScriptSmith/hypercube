/** A sailing ship rocking on a moonlit sea, its lantern lit. */
export const SHIP = /* glsl */ `
/** The ship with its waterline at y = 0 and its bow to +x; sails in sails.x, their light in .y. */
float shipShape(vec2 q, out vec2 sails) {
  float d = sdQuad(q, vec2(-0.20, -0.03), vec2(0.17, -0.03), vec2(0.26, 0.055), vec2(-0.235, 0.05));
  d = min(d, sdBox(q - vec2(-0.19, 0.066), vec2(0.048, 0.018)));
  d = min(d, sdSeg(q, vec2(0.24, 0.052), vec2(0.37, 0.105)) - 0.004);
  sails = vec2(1.0, 0.0);
  for (int m = 0; m < 3; m++) {
    float fm = float(m);
    float x = -0.11 + 0.11 * fm;
    float h = m == 1 ? 0.34 : 0.28 - 0.02 * fm;
    d = min(d, sdBox(q - vec2(x, 0.05 + h * 0.5), vec2(0.0045, h * 0.5)));
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float cy = 0.115 + fk * h * 0.27;
      float hw = 0.072 - 0.013 * fk - 0.006 * fm;
      float hh = h * 0.115;
      vec2 r = q - vec2(x, cy);
      // Filled by a following wind: the middle of each sail pushed forwards.
      r.x -= 0.014 * (1.0 - (r.y * r.y) / (hh * hh));
      float s = sdBox(r, vec2(hw, hh));
      if (s < sails.x) sails = vec2(s, clamp(0.5 + r.x / (2.0 * hw), 0.0, 1.0));
    }
  }
  float jib = sdTri(q, vec2(0.125, 0.07), vec2(0.36, 0.105), vec2(0.115, 0.30));
  if (jib < sails.x) sails = vec2(jib, 0.85);
  return d;
}

vec3 seaSky(vec2 p, float t, vec2 moon) {
  float hz = -0.13;
  float md = length(p - moon);
  float sy = clamp((p.y - hz) / 1.1, 0.0, 1.0);
  vec3 col = mix(vec3(0.14, 0.20, 0.34), vec3(0.025, 0.04, 0.10), pow(sy, 0.7));
  col += vec3(0.30, 0.36, 0.52) * exp(-md * 4.5) * 0.55;
  col += stars(p, 62.0, 0.28, t) * smoothstep(0.02, 0.25, p.y - hz) * smoothstep(0.12, 0.45, md);
  float cl = fbm(vec2(p.x * 1.4 + t * 0.010, p.y * 4.2 - 1.3));
  float band = smoothstep(0.52, 0.74, cl) * smoothstep(0.05, 0.25, p.y - hz) * (1.0 - smoothstep(0.45, 0.85, p.y));
  vec3 cloud = mix(vec3(0.07, 0.09, 0.16), vec3(0.62, 0.66, 0.78), exp(-md * 2.6));
  col = mix(col, cloud, band * 0.8);
  float mare = fbm(p * 16.0 + 3.0);
  vec3 lunar = vec3(0.97, 0.95, 0.86) * (0.82 + 0.18 * smoothstep(0.35, 0.65, mare));
  return mix(col, lunar, fill(md - 0.072));
}

vec3 scene(vec2 p) {
  float t = uStage.x;
  float hz = -0.13;
  vec2 moon = vec2(0.34, 0.40);
  vec3 col = seaSky(p, t, moon);
  float depth = hz - p.y;
  if (depth > 0.0) {
    float z = 1.0 / (depth + 0.015);
    vec2 wp = vec2(p.x * z * 0.35, z * 0.06);
    float w = fbm(wp * vec2(1.0, 2.5) + vec2(t * 0.05, -t * 0.4));
    vec3 sea = mix(vec3(0.11, 0.15, 0.27), vec3(0.025, 0.04, 0.08), smoothstep(0.0, 0.45, depth));
    sea *= 0.7 + 0.6 * w;
    float path = exp(-sq((p.x - moon.x) / (0.035 + depth * 0.55)));
    float glint = smoothstep(0.58, 0.78, w) * path;
    sea += vec3(0.85, 0.86, 0.92) * glint * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.4, depth)));
    col = sea;
  }
  vec2 at = vec2(-0.15, hz + 0.004 + 0.005 * sin(t * 0.9));
  float roll = 0.035 * sin(t * 0.55) + 0.012 * sin(t * 1.3 + 1.0);
  vec2 q = rot(-roll) * (p - at);
  vec2 sails;
  float hull = shipShape(q, sails);
  // Its dark reflection, broken up by the waves.
  if (depth > 0.0) {
    vec2 rq = rot(roll) * vec2(p.x - at.x + 0.006 * sin(p.y * 160.0 + t * 1.7), at.y - p.y);
    vec2 rs;
    float r = min(shipShape(rq, rs), rs.x);
    col *= 1.0 - 0.45 * soft(r, 0.01) * (1.0 - smoothstep(0.0, 0.32, depth));
  }
  float above = smoothstep(-0.004, 0.004, q.y + 0.004);
  col = mix(col, vec3(0.022, 0.028, 0.045), fill(hull) * above);
  vec3 sail = mix(vec3(0.07, 0.09, 0.14), vec3(0.30, 0.33, 0.42), sails.y);
  col = mix(col, sail, fill(sails.x) * above);
  vec2 lamp = q - vec2(-0.222, 0.098);
  col += vec3(1.0, 0.72, 0.32) * (exp(-dot(lamp, lamp) / 0.000012) + 0.18 * exp(-dot(lamp, lamp) / 0.0006));
  vec2 win = q - vec2(-0.16, 0.066);
  col += vec3(1.0, 0.7, 0.35) * 0.6 * fill(sdBox(win, vec2(0.006, 0.004)));
  return col;
}
`;
