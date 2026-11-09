/** Snowy mountains under the stars and a slow aurora, mirrored in a still lake. */
export const PEAKS = /* glsl */ `
/** A ridge line: a broad massif with a few sharp peaks and a little roughness. */
float ridgeH(float x, float s) {
  float big = vnoise(vec2(x * 0.8, s));
  float r = 1.0 - abs(2.0 * vnoise(vec2(x * 1.9 + 5.0, s + 1.0)) - 1.0);
  float fine = vnoise(vec2(x * 8.0, s + 2.0));
  return 0.45 * big + 0.5 * r * r * r + 0.05 * fine;
}

vec3 aurora(vec2 p, float t) {
  vec3 c = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float base = 0.20 + 0.12 * fk + 0.07 * sin(p.x * (1.3 + 0.5 * fk) + t * 0.05 + fk * 2.0)
      + 0.06 * (vnoise(vec2(p.x * 2.4 + t * 0.03, 7.0 * fk)) - 0.5);
    float above = p.y - base;
    float curtain = smoothstep(-0.03, 0.02, above) * exp(-max(above, 0.0) * (3.2 + 1.5 * fk));
    float rays = 0.5 + 0.5 * vnoise(vec2(p.x * 26.0 + t * 0.12 + fk * 9.0, 0.5 + fk));
    rays *= 0.65 + 0.35 * vnoise(vec2(p.x * 7.0 - t * 0.07, 3.0 + fk));
    float across = smoothstep(-0.95, -0.4, p.x) * (1.0 - smoothstep(0.5, 0.95, p.x + 0.3 * fk));
    vec3 tint = mix(vec3(0.20, 0.90, 0.56), vec3(0.52, 0.36, 0.88), smoothstep(0.02, 0.32, above));
    c += tint * curtain * rays * across * (0.42 - 0.15 * fk);
  }
  return c;
}

vec3 land(vec2 p, float t) {
  float sy = clamp((p.y + 0.1) / 1.1, 0.0, 1.0);
  vec3 col = mix(vec3(0.05, 0.11, 0.17), vec3(0.01, 0.02, 0.06), pow(sy, 0.6));
  col += stars(p, 70.0, 0.12, t) + stars(p * 1.6 + 7.0, 110.0, 0.06, t) * 0.6;
  col += aurora(p, t);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float scale = 1.0 + fk * 0.7;
    float amp = 0.62 - fk * 0.17;
    float s = 3.0 + fk * 7.0;
    float x = p.x * scale + fk * 13.1 + 2.0;
    float h = -0.24 - fk * 0.03 + amp * ridgeH(x, s);
    if (p.y < h) {
      float e = 0.01;
      float slope = (ridgeH(x + e, s) - ridgeH(x - e, s)) / (2.0 * e);
      // Snow above a line part way up each range, reaching down the gullies.
      float gully = vnoise(vec2(x * 24.0, p.y * 3.0 + fk * 5.0));
      float alt = -0.24 - fk * 0.03 + amp * (0.42 + 0.15 * vnoise(vec2(x * 3.0, 5.0 + fk)));
      float snow = smoothstep(alt - 0.015, alt + 0.015, p.y + 0.05 * (gully - 0.5));
      // Lit from the aurora's side, up and to the left.
      float lit = smoothstep(-0.5, 0.5, slope);
      vec3 rock = mix(vec3(0.03, 0.04, 0.06), vec3(0.08, 0.10, 0.14), lit);
      vec3 snowCol = mix(vec3(0.16, 0.22, 0.33), vec3(0.62, 0.74, 0.82), lit);
      vec3 c = mix(rock, snowCol, snow);
      col = mix(c, vec3(0.08, 0.13, 0.21), (2.0 - fk) * 0.25);
    }
  }
  return col;
}

vec3 scene(vec2 p) {
  float t = uStage.x;
  float shore = -0.30;
  if (p.y > shore) return land(p, t);
  float depth = shore - p.y;
  float ripple = 0.005 * sin(p.y * 150.0 - t * 1.1) * (0.5 + vnoise(vec2(p.x * 6.0, p.y * 30.0)));
  vec3 refl = land(vec2(p.x + ripple, shore + depth * 1.2), t);
  vec3 water = mix(vec3(0.03, 0.05, 0.09), vec3(0.01, 0.02, 0.04), smoothstep(0.0, 0.5, depth));
  float edge = soft(depth - 0.004, 0.003);
  return mix(mix(water, refl, 0.55), vec3(0.14, 0.2, 0.26), edge * 0.4);
}
`;
