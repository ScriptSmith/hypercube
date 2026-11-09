/**
 * A lighthouse on a headland in drifting fog, its beam turning slowly through the mist. The
 * lantern brightens gently as each side of the beam swings round towards us, every seven
 * seconds.
 */
export const LIGHTHOUSE = /* glsl */ `
float headland(float x) {
  return -0.16 + 0.13 * smoothstep(-0.35, 0.05, x) - 0.05 * smoothstep(0.45, 0.9, x)
    + 0.025 * (fbm3(vec2(x * 7.0, 2.0)) - 0.5);
}

vec3 scene(vec2 p) {
  float t = uStage.x;
  float hz = -0.20;
  vec3 col = mix(vec3(0.27, 0.30, 0.35), vec3(0.06, 0.08, 0.13), smoothstep(hz, 0.85, p.y));
  col += stars(p, 50.0, 0.1, t) * smoothstep(0.4, 0.75, p.y);

  float rock = p.y - headland(p.x);
  // The headland ends in a cliff on the left, falling into the sea.
  float edge = -0.30 + 0.12 * (p.y - hz) + 0.015 * (vnoise(vec2(p.y * 30.0, 4.0)) - 0.5);
  rock = max(rock, edge - p.x);
  vec2 base = vec2(0.10, headland(0.10) - 0.006);
  float th = 0.30;
  float y = (p.y - base.y) / th;
  float tower = max(abs(p.x - base.x) - mix(0.032, 0.021, clamp(y, 0.0, 1.0)), max(-y, y - 1.0) * th);
  vec2 L = base + vec2(0.0, th + 0.03);
  float gallery = sdBox(p - (base + vec2(0.0, th + 0.004)), vec2(0.033, 0.004));
  float lantern = sdBox(p - L, vec2(0.016, 0.021));
  float dome = max(length(p - (L + vec2(0.0, 0.021))) - 0.019, (L.y + 0.021) - p.y);

  // The beam goes out both ways and turns once every fourteen seconds.
  float spin = t * TAU / 14.0 + uSeed * TAU;
  float fog = fbm(vec2(p.x * 1.4 - t * 0.02, p.y * 3.4 + 1.0));
  float facing = 0.0;
  vec3 beams = vec3(0.0);
  vec2 rel = p - L;
  for (int k = 0; k < 2; k++) {
    float a = spin + float(k) * PI;
    float across = cos(a);
    facing = max(facing, sin(a));
    float along = rel.x * sign(across);
    float width = 0.008 + max(along, 0.0) * 0.12;
    float perp = rel.y - along * 0.02;
    float reach = 0.08 + 0.9 * abs(across);
    float beam = exp(-sq(perp / width)) * smoothstep(0.0, 0.025, along) * exp(-max(along, 0.0) / reach);
    beams += vec3(1.0, 0.9, 0.7) * beam * (0.25 + 0.75 * abs(across)) * (0.5 + 0.8 * fog) * 0.6;
  }

  float depth = hz - p.y;
  if (depth > 0.0) {
    float z = 1.0 / (depth + 0.012);
    float w = fbm(vec2(p.x * z * 0.4, z * 0.06) + vec2(0.0, -t * 0.25));
    col = mix(vec3(0.15, 0.18, 0.23), vec3(0.03, 0.04, 0.07), smoothstep(0.0, 0.4, depth)) * (0.8 + 0.4 * w);
    float path = exp(-sq((p.x - L.x) / (0.02 + depth * 0.3)));
    col += vec3(1.0, 0.85, 0.6) * smoothstep(0.55, 0.8, w) * path * (0.3 + 0.4 * facing);
    float foam = smoothstep(0.5, 0.75, fbm3(vec2(p.x * 30.0, p.y * 60.0 - t * 0.4)))
      * exp(-max(rock, 0.0) * 50.0) * (1.0 - smoothstep(0.0, 0.06, depth));
    col = mix(col, vec3(0.7, 0.73, 0.76), foam * 0.5);
  }
  float face = smoothstep(-0.3, 0.2, p.x);
  col = mix(col, mix(vec3(0.03, 0.035, 0.05), vec3(0.08, 0.085, 0.10), face), fill(rock));
  float shade = 0.65 + 0.35 * smoothstep(base.x - 0.03, base.x + 0.02, p.x);
  col = mix(col, vec3(0.62, 0.63, 0.65) * shade, fill(tower));
  float stripe = step(0.5, fract(y * 2.5)) * step(0.05, y) * step(y, 0.95);
  col = mix(col, vec3(0.12, 0.13, 0.16) * shade, fill(tower) * stripe);
  col = mix(col, vec3(0.06, 0.06, 0.08), fill(min(gallery, dome)));
  col = mix(col, vec3(1.0, 0.88, 0.62), fill(lantern));
  col += beams;
  float bloom = 0.6 + 0.6 * pow(facing, 6.0);
  col += vec3(1.0, 0.82, 0.55) * exp(-dot(rel, rel) / (0.0016 * bloom)) * 0.45 * bloom;

  // Fog drifting across everything, lit near the lantern.
  float drift = fbm(vec2(p.x * 1.1 + t * 0.018, p.y * 2.6 - 2.0));
  float mist = smoothstep(0.35, 0.8, drift) * (0.3 + 0.35 * (1.0 - smoothstep(-0.3, 0.3, p.y)));
  vec3 mistCol = mix(vec3(0.38, 0.41, 0.45), vec3(0.72, 0.68, 0.58), exp(-length(rel) * 4.0));
  return mix(col, mistCol, mist * 0.6);
}
`;
