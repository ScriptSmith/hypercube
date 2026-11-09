/**
 * A whale in calm water at dawn: a misty blow, its back rolling through the surface, then its
 * tail lifting high and slipping under, ripples spreading after.
 */
export const WHALE = /* glsl */ `
vec3 dawn(vec2 p, float t) {
  float hz = -0.06;
  float sy = clamp((p.y - hz) / 1.0, 0.0, 1.0);
  // Early dawn: the sun just up, the sky still deep blue overhead.
  vec3 col = mix(vec3(0.86, 0.56, 0.38), vec3(0.64, 0.42, 0.50), smoothstep(0.0, 0.14, sy));
  col = mix(col, vec3(0.30, 0.31, 0.50), smoothstep(0.12, 0.45, sy));
  col = mix(col, vec3(0.09, 0.12, 0.26), smoothstep(0.4, 1.0, sy));
  col += stars(p, 60.0, 0.1, t) * smoothstep(0.45, 0.8, p.y) * 0.6;
  vec2 sun = vec2(-0.24, hz + 0.004);
  float sd = length(p - sun);
  col += vec3(1.0, 0.66, 0.38) * exp(-sd * 7.0) * 0.32;
  col = mix(col, vec3(1.0, 0.86, 0.62), fill(sd - 0.045));
  float cl = fbm(vec2(p.x * 1.3 + t * 0.006, p.y * 6.5));
  float band = smoothstep(0.55, 0.76, cl) * smoothstep(0.06, 0.18, p.y - hz) * (1.0 - smoothstep(0.35, 0.7, p.y));
  col = mix(col, mix(vec3(0.62, 0.38, 0.44), vec3(0.95, 0.70, 0.50), exp(-sd * 2.5)), band * 0.55);
  return col;
}

float fluke(vec2 q) {
  vec2 a = vec2(abs(q.x), q.y);
  vec2 l = rot(-0.34) * (a - vec2(0.068, 0.014));
  float lobe = sdEllipse(l, vec2(0.074, 0.021));
  float notch = 0.013 - length(q - vec2(0.0, 0.03));
  return max(lobe, notch);
}

/** The whale's parts above the water at progress h: distance, and how lit the edge is. */
float whale(vec2 p, float h, float hz, float x0) {
  float d = 1.0;
  // The back rolls up and over.
  float b = (h - 0.08) / 0.34;
  if (b > 0.0 && b < 1.0) {
    float lift = 0.065 * sin(PI * b);
    vec2 c = vec2(x0 - 0.20 + 0.26 * b, hz - 0.30 + lift);
    float back = length(p - c) - 0.30;
    vec2 f = p - (c + vec2(-0.05 + 0.03 * b, 0.30));
    float fin = sdTri(f, vec2(-0.03, -0.01), vec2(0.02, -0.01), vec2(-0.012, 0.028));
    d = min(back, mix(1.0, fin, step(0.25, b) * step(b, 0.85)));
  }
  // Then the tail lifts and slips under.
  float c = (h - 0.46) / 0.40;
  if (c > 0.0 && c < 1.0) {
    float rise = 0.24 * smoothstep(0.0, 0.42, c) * (1.0 - smoothstep(0.62, 1.0, c));
    vec2 top = vec2(x0 - 0.04 + 0.03 * c, hz + rise);
    vec2 q = p - top;
    q = rot(0.05 * sin(c * 5.0)) * q;
    float y = (p.y - hz) / max(rise, 1e-3);
    float stalk = max(abs(q.x) - mix(0.017, 0.009, clamp(y, 0.0, 1.0)), max(-(p.y - hz) - 0.01, q.y));
    d = min(d, min(stalk, fluke(q)));
  }
  return max(d, hz - p.y);
}

#define BIG 1.45

vec3 scene(vec2 p) {
  float t = uStage.x;
  float h = progress();
  float hz = -0.06;
  float x0 = 0.12;
  vec3 col = dawn(p, t);
  float depth = hz - p.y;
  if (depth > 0.0) {
    float z = 1.0 / (depth + 0.012);
    float w = fbm(vec2(p.x * z * 0.4, z * 0.05) + vec2(0.0, -t * 0.3));
    vec2 mp = vec2(p.x + (w - 0.5) * 0.06 * depth, hz + depth * 1.25);
    vec3 refl = dawn(mp, t);
    col = mix(vec3(0.10, 0.12, 0.20), refl, 0.6) * (0.85 + 0.25 * w);
    float path = exp(-sq((p.x + 0.24) / (0.02 + depth * 0.4)));
    col += vec3(1.0, 0.8, 0.55) * smoothstep(0.6, 0.8, w) * path * 0.55;
    // Rings spreading where it surfaced and where it dived.
    for (int k = 0; k < 2; k++) {
      float start = k == 0 ? 0.02 : 0.80;
      float a = (h - start) / 0.25;
      if (a > 0.0 && a < 1.0) {
        vec2 rq = (p - vec2(x0 - 0.06 * float(k), hz)) * vec2(1.0, 7.0);
        float ring = abs(length(rq) - (0.03 + 0.25 * a)) - 0.004;
        col += vec3(1.0, 0.9, 0.75) * soft(ring, 0.004) * (1.0 - a) * 0.35;
      }
    }
  }
  // Its blow: a puff of mist, lit by the low sun.
  float s = (h - 0.06) / 0.2;
  if (s > 0.0 && s < 1.0) {
    vec2 o = p - vec2(x0 - 0.02 + 0.05 * s, hz + 0.004);
    float height = 0.16 * smoothstep(0.0, 0.35, s);
    float cone = max(0.0, o.y) / max(height, 1e-3);
    float spread = 0.012 + 0.07 * cone;
    float puff = exp(-sq(o.x / spread)) * smoothstep(0.0, 0.01, o.y) * (1.0 - smoothstep(0.7, 1.15, cone));
    puff *= 0.6 + 0.6 * fbm3(o * vec2(18.0, 10.0) - vec2(0.0, t * 0.5));
    col = mix(col, vec3(1.0, 0.93, 0.84), clamp(puff * (1.0 - s) * 0.85, 0.0, 1.0));
  }
  // Drawn larger than the shapes are written, about where it surfaces.
  vec2 wp = vec2(x0, hz) + (p - vec2(x0, hz)) / BIG;
  float body = whale(wp, h, hz, x0) * BIG;
  if (body < 0.02) {
    float rim = smoothstep(0.0, 0.006, -body);
    vec3 skin = mix(vec3(0.95, 0.66, 0.42), vec3(0.06, 0.06, 0.09), rim);
    col = mix(col, skin, fill(body));
  }
  // Drops falling from the lifted tail.
  float c = (h - 0.46) / 0.40;
  if (c > 0.3 && c < 0.85) {
    for (int i = 0; i < 10; i++) {
      float fi = float(i);
      float lane = (rnd(fi) - 0.5) * 0.2;
      float fall = fract(t * 0.9 + rnd(fi + 9.0));
      float top = 0.24 * smoothstep(0.0, 0.42, c) * (1.0 - smoothstep(0.62, 1.0, c));
      vec2 q = wp - vec2(x0 - 0.04 + 0.03 * c + lane, hz + top * (1.0 - fall * fall) - 0.01);
      col += vec3(1.0, 0.92, 0.8) * exp(-dot(q, q) / 0.000005) * 0.7 * step(hz, p.y);
    }
  }
  return col;
}
`;
