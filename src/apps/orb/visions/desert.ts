/**
 * Dunes under the Milky Way with a lone tree, the sky turning slowly, and one shooting star part
 * way through.
 */
export const DESERT = /* glsl */ `
vec3 night(vec2 p, float t) {
  vec3 col = mix(vec3(0.09, 0.08, 0.14), vec3(0.01, 0.015, 0.045), smoothstep(-0.25, 0.6, p.y));
  // The whole sky turns about a pole off to one side.
  vec2 pole = vec2(-1.5, 1.3);
  vec2 sp = rot(t * 0.003) * (p - pole) + pole;
  vec2 axis = normalize(vec2(0.5, 1.0));
  vec2 rel = sp - vec2(0.08, -0.05);
  float along = dot(rel, axis);
  float across = dot(rel, vec2(axis.y, -axis.x));
  float band = exp(-across * across / 0.045);
  float cloud = fbm(vec2(along * 2.6, across * 6.0) + 4.0);
  float dust = smoothstep(0.45, 0.7, fbm(vec2(along * 4.0 + 9.0, across * 11.0))) * exp(-across * across / 0.005);
  float core = exp(-sq(along + 0.1) / 0.05);
  vec3 glow = mix(vec3(0.30, 0.34, 0.52), vec3(0.85, 0.70, 0.52), core);
  col += glow * band * (0.3 + 0.7 * cloud) * (1.0 - 0.7 * dust) * (0.5 + 0.6 * core) * 0.85;
  col += stars(sp, 80.0, 0.08 + 0.18 * band, t) + stars(sp * 1.7 + 3.0, 130.0, 0.04 + 0.16 * band, t) * 0.5;
  // One shooting star, part way through.
  float k = (progress() - 0.48) / 0.05;
  if (k > 0.0 && k < 1.0) {
    vec2 a = vec2(-0.40, 0.58);
    vec2 b = vec2(-0.08, 0.36);
    vec2 head = mix(a, b, k);
    vec2 tail = mix(a, b, max(0.0, k - 0.25));
    float d = sdSeg(p, tail, head);
    float along2 = clamp(dot(p - tail, head - tail) / max(1e-5, dot(head - tail, head - tail)), 0.0, 1.0);
    col += vec3(0.9, 0.95, 1.0) * exp(-d * d / (uPx * uPx * 2.0)) * along2 * (1.0 - k) * 0.8;
  }
  return col;
}

/** Height of a dune line: smooth waves, skewed so one side is longer than the other. */
float dune(float x, float s) {
  return 0.5 + 0.38 * sin(x + s + 0.7 * sin(x + s)) + 0.12 * (vnoise(vec2(x * 0.7, s)) - 0.5);
}

vec3 scene(vec2 p) {
  float t = uStage.x;
  vec3 col = night(p, t);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float scale = 2.6 + 1.8 * fk;
    float s = 2.0 + fk * 5.0;
    float x = p.x * scale + fk * 4.0;
    float amp = 0.07 + 0.03 * fk;
    float h = -0.06 - 0.11 * fk + amp * dune(x, s);
    if (p.y < h) {
      float e = 0.01;
      float slope = (dune(x + e, s) - dune(x - e, s)) / (2.0 * e);
      // Starlight catches the long backs; the steep faces are in shade.
      float lit = smoothstep(-0.7, 0.7, slope);
      float below = h - p.y;
      vec3 sand = mix(vec3(0.07, 0.06, 0.09), vec3(0.30, 0.25, 0.28), lit);
      sand *= 0.9 + 0.1 * vnoise(vec2(p.x * 80.0, p.y * 260.0));
      sand += vec3(0.10, 0.09, 0.12) * exp(-below * 90.0) * lit;
      col = mix(sand, vec3(0.10, 0.09, 0.15), (2.0 - fk) * 0.25);
    }
    if (k == 1) {
      // A lone tree on the middle dunes.
      float tx = 0.26;
      float ground = -0.06 - 0.11 + (0.07 + 0.03) * dune(tx * (2.6 + 1.8) + 4.0, 7.0);
      vec2 q = p - vec2(tx, ground - 0.005);
      float tree = sdSeg(q, vec2(0.0, 0.0), vec2(0.006, 0.08)) - 0.005;
      tree = min(tree, sdSeg(q, vec2(0.004, 0.055), vec2(-0.045, 0.105)) - 0.003);
      tree = min(tree, sdSeg(q, vec2(0.004, 0.065), vec2(0.055, 0.11)) - 0.003);
      float crown = sdEllipse(q - vec2(0.0, 0.122), vec2(0.095, 0.03));
      crown = min(crown, sdEllipse(q - vec2(-0.05, 0.108), vec2(0.045, 0.02)));
      crown = min(crown, sdEllipse(q - vec2(0.055, 0.112), vec2(0.04, 0.018)));
      crown += 0.012 * (vnoise(q * 70.0) - 0.5);
      col = mix(col, vec3(0.015, 0.015, 0.03), fill(min(tree, crown)));
    }
  }
  return col;
}
`;
