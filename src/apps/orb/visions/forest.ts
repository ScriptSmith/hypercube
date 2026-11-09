/** A forest at dusk under a new moon, fireflies drifting and glowing over a misty meadow. */
export const FOREST = /* glsl */ `
/** Below zero inside a row of fir trees standing on the ground line, or under the ground. */
float firs(vec2 p, float cellW, float s, float hmin, float hmax, float ground, float clearing) {
  float d = p.y - ground;
  float cell = floor(p.x / cellW);
  for (int k = -1; k <= 1; k++) {
    float c = cell + float(k);
    float cx = (c + 0.2 + 0.6 * rnd2(vec2(c, s))) * cellW;
    if (abs(cx) < clearing) continue;
    float h = mix(hmin, hmax, rnd2(vec2(c, s + 1.0)));
    float w = h * (0.24 + 0.08 * rnd2(vec2(c, s + 2.0)));
    float y = (p.y - ground) / h;
    float tier = fract(y * 4.5 + rnd2(vec2(c, s + 3.0)));
    float halfW = w * max(0.0, 1.0 - y) * (0.7 + 0.3 * (1.0 - tier));
    float tree = max(abs(p.x - cx) - halfW, max(-y, y - 1.0) * h);
    tree = min(tree, sdBox(p - vec2(cx, ground), vec2(h * 0.025, h * 0.08)));
    d = min(d, tree);
  }
  return d;
}

vec3 fireflies(vec2 p, float t) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 28; i++) {
    float fi = float(i);
    vec2 base = vec2(rnd(fi) * 1.3 - 0.65, -0.40 + 0.34 * rnd(fi + 40.0));
    vec2 wander = 0.05 * vec2(
      sin(t * (0.22 + 0.3 * rnd(fi + 80.0)) + TAU * rnd(fi + 120.0)),
      sin(t * (0.18 + 0.25 * rnd(fi + 160.0)) + TAU * rnd(fi + 200.0)));
    vec2 q = p - base - wander;
    float period = 2.6 + 2.4 * rnd(fi + 240.0);
    float ph = fract(t / period + rnd(fi + 280.0));
    float pulse = smoothstep(0.0, 0.2, ph) * (1.0 - smoothstep(0.3, 0.75, ph));
    float r2 = dot(q, q);
    c += vec3(0.86, 1.0, 0.40) * pulse * (exp(-r2 / 0.00003) + 0.22 * exp(-r2 / 0.0012));
  }
  return c;
}

vec3 scene(vec2 p) {
  float t = uStage.x;
  float sy = clamp((p.y + 0.15) / 1.15, 0.0, 1.0);
  vec3 col = mix(vec3(0.93, 0.58, 0.44), vec3(0.48, 0.32, 0.56), smoothstep(0.0, 0.3, sy));
  col = mix(col, vec3(0.07, 0.07, 0.21), smoothstep(0.25, 0.95, sy));
  col += stars(p, 60.0, 0.16, t) * smoothstep(0.3, 0.7, p.y);
  // A thin new moon and the evening star.
  vec2 m = p - vec2(-0.34, 0.40);
  float crescent = max(length(m) - 0.05, -(length(m - vec2(0.019, 0.012)) - 0.047));
  col = mix(col, vec3(1.0, 0.95, 0.82), fill(crescent));
  col += vec3(0.8, 0.6, 0.6) * exp(-length(m) * 9.0) * 0.12;
  vec2 star = p - vec2(0.26, 0.29);
  col += vec3(1.0, 0.97, 0.9) * (exp(-dot(star, star) / 0.000015) + 0.15 * exp(-dot(star, star) / 0.0008));

  float hills = p.y - (-0.06 + 0.05 * sin(p.x * 2.2 + 1.0) + 0.03 * vnoise(vec2(p.x * 4.0, 2.0)));
  col = mix(col, vec3(0.42, 0.30, 0.48), fill(hills) * 0.8);
  col = mix(col, vec3(0.27, 0.19, 0.35), fill(firs(p, 0.05, 11.0, 0.08, 0.17, -0.09, 0.0)));
  col = mix(col, vec3(0.12, 0.09, 0.19), fill(firs(p, 0.085, 23.0, 0.16, 0.30, -0.17, 0.0)));
  float meadow = -0.24 + 0.02 * sin(p.x * 3.1) + 0.012 * vnoise(vec2(p.x * 40.0, 1.0));
  float mist = fbm3(vec2(p.x * 2.0 - t * 0.012, p.y * 6.0));
  col = mix(col, vec3(0.62, 0.48, 0.62), 0.32 * mist * exp(-sq((p.y + 0.2) / 0.07)));
  col = mix(col, vec3(0.035, 0.03, 0.06), fill(p.y - meadow));
  col = mix(col, vec3(0.03, 0.025, 0.05), fill(firs(p, 0.15, 37.0, 0.42, 0.75, -0.30, 0.38)));
  col += fireflies(p, t);
  return col;
}
`;
