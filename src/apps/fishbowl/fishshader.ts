/**
 * The fish's shaders, shared by the bowl and the tank: each supplies its own water (the GLSL
 * that defines `mirrored`, `inMirror`, `lit`, `underwater` and the like) and how to finish.
 *
 * The vertex shader swims the fish: a travelling wave stronger towards the tail, the body
 * bending into turns, fins fluttering, threads trailing, the mouth working, the puffer swelling.
 * The fragment shader paints each kind's markings and lights them as a fish is lit: scales that
 * glint one by one as the body turns, a silvery or metallic sheen that changes with the angle,
 * fins thin enough for the light above to come through them, eyes with a glossy cornea.
 */

export const FISH_VERT_BODY = /* glsl */ `
attribute vec4 aCoord;
attribute vec3 aAnchor;
attribute vec4 aAnimA;
attribute vec4 aAnimB;
attribute vec2 aLook;
uniform float uBall;
uniform float uFlow;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec4 vCoord;
varying vec3 vRest;
varying vec3 vAnchor;
varying vec4 vAnim;
varying float vMirror;
varying float vTint;

void main() {
  vec3 p = position;
  vec3 n = normal;
  float s = aCoord.x;
  float part = aCoord.z;
  float phase = aAnimA.x;
  float amp = aAnimA.y;
  float bend = aAnimA.z;
  float mouth = aAnimA.w;
  float puff = aAnimB.x;
  float fin = aAnimB.y;

  if (puff > 0.0) {
    vec3 c = vec3(0.06, 0.0, 0.0);
    vec3 a = part < 0.5 ? p : aAnchor;
    vec3 onBall = c + normalize(a - c + vec3(0.0, 0.0, 1e-4)) * uBall;
    float keep = part < 0.5 ? 1.0 - smoothstep(0.72, 0.95, s) : 1.0;
    p += (onBall - a) * puff * keep;
    if (part < 0.5) n = normalize(mix(n, normalize(p - c), puff * keep));
  }
  if (s < 0.07 && part < 0.5) {
    float k = 1.0 - s / 0.07;
    p.x += mouth * 0.022 * k;
    p.y += mouth * 0.012 * k * sign(p.y - aAnchor.y);
  }
  if (abs(part - 3.0) < 0.5) {
    float f = sin(fin + aCoord.y * 2.2) * aCoord.y * 0.07;
    p.z += f * aCoord.w;
    p.y += f * 0.4;
  } else if (abs(part - 1.0) < 0.5) {
    p.z += sin(fin * 0.6 + aCoord.y * 3.0 - s * 5.0) * aCoord.y * 0.012;
  } else if (abs(part - 6.0) < 0.5) {
    // Threads trail and sway, and reach forward when the fish feels about (aAnimB.z).
    float u = aCoord.y;
    float reach = aAnimB.z;
    p.z += sin(fin * 0.4 + u * 5.0) * u * 0.05 * aCoord.w;
    p.x += sin(fin * 0.33 + u * 3.0) * u * 0.02;
    vec3 fwd = vec3(aAnchor.x + 0.5 * u, aAnchor.y - 0.12 * u, aAnchor.z + aCoord.w * 0.05 * u);
    p = mix(p, fwd, reach * smoothstep(0.0, 0.3, u));
  }

  float env = 0.02 + 0.17 * s * s;
  float w = phase - 6.0 * s;
  float b = s - 0.35;
  float z = amp * env * sin(w) + bend * b * b * 0.9;
  float dz = amp * (0.34 * s * sin(w) - 6.0 * env * cos(w)) + bend * 1.8 * b;
  if (abs(part - 2.0) < 0.5) {
    z += uFlow * amp * aCoord.y * aCoord.y * 0.09 * sin(w - 1.4 - aCoord.y * 2.5);
  } else if (abs(part - 1.0) < 0.5 && s > 0.6) {
    z += uFlow * 0.5 * amp * aCoord.y * aCoord.y * 0.06 * sin(w - 1.0 - aCoord.y * 2.0);
  }
  p.z += z;
  float ang = atan(dz);
  float ca = cos(ang);
  float sa = sin(ang);
  n = vec3(n.x * ca + n.z * sa, n.y, -n.x * sa + n.z * ca);

  vec4 local = instanceMatrix * vec4(p, 1.0);
  vReal = local.xyz;
  vNormal = normalize(mat3(instanceMatrix) * n);
  vMirror = aAnimB.w;
  vSeen = mirrored(vReal, vMirror);
  vCoord = aCoord;
  vRest = position;
  vAnchor = aAnchor;
  vAnim = vec4(mouth, puff, aAnimB.z, aLook.x);
  vTint = aLook.y;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vSeen, 1.0);
}
`;

/**
 * The fragment shader, given the water's GLSL, an expression for the eye in the same space as
 * the fish, one for lamp light left at a point p, and the lines that finish the colour.
 */
export const fishFragment = (
  env: string,
  eye: string,
  sunAt: string,
  out: string,
): string => /* glsl */ `
${env}
uniform int uKind;
uniform vec3 uBack;
uniform vec3 uSide;
uniform vec3 uBelly;
uniform vec3 uFin;
uniform vec3 uIris;
uniform float uSeed;
uniform float uSheen;
/** 0 draws the body and eyes, 1 the fins, -1 everything. */
uniform float uPass;
varying vec3 vReal;
varying vec3 vSeen;
varying vec3 vNormal;
varying vec4 vCoord;
varying vec3 vRest;
varying vec3 vAnchor;
varying vec4 vAnim;
varying float vMirror;
varying float vTint;

float band(float x, float a, float b, float soft) {
  return smoothstep(a - soft, a + soft, x) * (1.0 - smoothstep(b - soft, b + soft, x));
}

/** Small round spots on a jittered lattice, 1 inside a spot. */
float spots(vec2 p, float size, float fill) {
#ifdef FISH_CHEAP
  return 0.0;
#endif
  vec2 g = p / size;
  vec2 i = floor(g);
  vec2 f = fract(g);
  float best = 9.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = vec2(float(x), float(y));
      vec2 o = c + vec2(hash13(vec3(i + c, 3.0)), hash13(vec3(i + c, 5.0))) * 0.7 + 0.15;
      best = min(best, length(f - o) + (hash13(vec3(i + c, 9.0)) - 0.5) * 0.15);
    }
  }
  return smoothstep(fill, fill * 0.7, best);
}

/**
 * Markings. s runs from the nose (0) to the tail tip (1), around from the back (0) through the
 * flank (0.5) to the belly (1); r is the rest position in body lengths.
 */
vec3 markings(float s, float around, vec3 r, float puff, float part, out float sheen, out float metal) {
  float back = 1.0 - smoothstep(0.08, 0.45, around);
  float belly = smoothstep(0.55, 0.9, around);
  vec3 c = mix(mix(uSide, uBack, back), uBelly, belly);
  sheen = uSheen;
  metal = 0.0;
  if (uKind == 0) {
    // Goldfish: metallic orange, deeper on the back, pale gold below.
    metal = 0.6;
  } else if (uKind == 1) {
    float patches = noise3(r * 9.0 + uSeed * 7.0) + 0.4 * noise3(r * 21.0 + uSeed);
    c = mix(uBelly, uSide, smoothstep(0.62, 0.72, patches));
    c = mix(c, uBack, back * 0.5);
    metal = 0.3;
  } else if (uKind == 2) {
    // Neon tetra: a glowing stripe from behind the eye to the adipose fin, red low behind.
    float stripe = band(around, 0.3, 0.42, 0.02) * band(s, 0.13, 0.66, 0.03);
    float red = smoothstep(0.46, 0.54, around) * smoothstep(0.36, 0.46, s) * (1.0 - smoothstep(0.8, 0.86, s));
    c = mix(c, vec3(0.72, 0.02, 0.03), red * 0.95);
    c = mix(c, vec3(0.015, 0.5, 0.66), stripe);
    sheen = stripe * 1.6 + 0.3;
  } else if (uKind == 3) {
    // Bronze corydoras: two rows of plates meeting along the flank, an orange patch on the nape.
    float plates = smoothstep(0.42, 0.5, fract(s * 22.0)) * smoothstep(0.18, 0.75, s) * 0.25;
    float seam = band(around, 0.47, 0.53, 0.02) * 0.5;
    c = mix(c, vec3(0.5, 0.42, 0.22), band(around, 0.5, 0.75, 0.05) * 0.35);
    c *= 1.0 - plates - seam * 0.6;
    float nape = band(s, 0.16, 0.3, 0.03) * (1.0 - smoothstep(0.1, 0.25, around));
    c = mix(c, vec3(0.46, 0.14, 0.03), nape * 0.8);
    metal = 0.75;
  } else if (uKind == 4) {
    float spot = noise3(r * 16.0 + uSeed * 5.0);
    c = mix(c, vec3(0.08, 0.07, 0.03), smoothstep(0.6, 0.66, spot) * (1.0 - belly));
    c = mix(c, uBelly * 1.1, puff * belly * 0.6);
  } else if (uKind == 5) {
    // Harlequin rasbora: a black wedge from mid-body tapering to the tail's root.
    float t = clamp((s - 0.42) / 0.3, 0.0, 1.0);
    float lo = mix(0.22, 0.46, t);
    float hi = mix(0.76, 0.52, t);
    float wedge = smoothstep(0.4, 0.43, s) * (1.0 - smoothstep(0.7, 0.73, s)) * band(around, lo, hi, 0.02);
    c = mix(c, vec3(0.012, 0.01, 0.012), wedge);
    float gold = band(around, lo - 0.06, lo - 0.01, 0.015) * smoothstep(0.4, 0.45, s) * (1.0 - t * 0.6);
    c = mix(c, vec3(0.9, 0.55, 0.2), gold * 0.6);
    metal = 0.35 * (1.0 - wedge);
  } else if (uKind == 6) {
    // Angelfish: silver with black bars through the eye, the middle and the rear, into the fins.
    float x = s;
    float bars = band(x, 0.13, 0.18, 0.01) + band(x - (around - 0.5) * 0.04, 0.31, 0.37, 0.012);
    bars += band(x - (around - 0.5) * 0.05, 0.53, 0.59, 0.012) + 0.45 * band(x, 0.77, 0.8, 0.012);
    float fade = 0.75 + 0.25 * noise3(r * 6.0 + uSeed * 9.0);
    c = mix(c, vec3(0.015, 0.014, 0.012), clamp(bars, 0.0, 1.0) * fade);
    c = mix(c, vec3(0.45, 0.38, 0.2), back * 0.4 * smoothstep(0.1, 0.3, s));
    metal = 0.5;
    sheen = 0.9;
  } else if (uKind == 7) {
    // Pearl gourami: pearly spots all over, a dark line to a spot at the tail, an orange throat.
    float pearl = spots(vec2(s * 13.0, around * 4.6 + r.z * 2.0), 0.16, 0.3);
    float lineY = 0.5 + 0.03 * sin(s * 40.0);
    float line = band(around, lineY - 0.025, lineY + 0.025, 0.012) * smoothstep(0.02, 0.06, s) * (1.0 - smoothstep(0.68, 0.72, s));
    float dot = 1.0 - smoothstep(0.035, 0.05, length(vec2((s - 0.71) * 0.9, around - 0.5) * vec2(1.0, 0.5)));
    float throat = smoothstep(0.55, 0.75, around) * (1.0 - smoothstep(0.3, 0.45, s));
    c = mix(c, vec3(0.82, 0.25, 0.06), throat * 0.85);
    c = mix(c, vec3(0.86, 0.83, 0.78), pearl * 0.8 * (1.0 - line) * (1.0 - throat * 0.5));
    c = mix(c, vec3(0.04, 0.03, 0.03), max(line, dot));
    sheen = 0.5;
  } else if (uKind == 8) {
    // Bristlenose: dark brown, with small pale spots, paler under.
    float pale = spots(vec2(r.x * 30.0, (r.y + r.z) * 30.0), 1.0, 0.2) * (1.0 - belly);
    c = mix(c, vec3(0.42, 0.36, 0.22), pale * 0.8);
    c *= 0.85 + 0.3 * noise3(r * 18.0 + uSeed);
    metal = 0.0;
    sheen = 0.15;
  }
  return c;
}

vec3 finColour(float s, float u, vec3 r, out float alpha) {
  vec3 c = uFin;
  alpha = mix(0.88, 0.4, smoothstep(0.25, 1.0, u));
  if (uKind == 2) {
    alpha *= 0.55;
  } else if (uKind == 5) {
    // Red-orange along the tail's top and bottom edges.
    float edge = smoothstep(0.45, 0.8, abs(r.y) / 0.15) * step(0.7, s);
    c = mix(c, vec3(0.75, 0.2, 0.06), edge);
    alpha *= 0.7;
  } else if (uKind == 6) {
    // Smoky fins carrying the bars, a pale streak along the leading rays.
    float bars = band(s, 0.31, 0.37, 0.015) + band(s, 0.53, 0.6, 0.015);
    c = mix(c, vec3(0.02), clamp(bars, 0.0, 1.0) * 0.9);
    c = mix(c, vec3(0.7, 0.7, 0.66), smoothstep(0.88, 1.0, u) * 0.4);
    alpha = mix(0.9, 0.55, smoothstep(0.3, 1.0, u));
  } else if (uKind == 7) {
    float pearl = spots(vec2(r.x * 26.0, r.y * 26.0), 1.0, 0.25);
    c = mix(c, vec3(0.85, 0.83, 0.78), pearl * 0.7);
    alpha = mix(0.8, 0.5, u);
  } else if (uKind == 8) {
    float pale = spots(vec2(r.x * 28.0, r.y * 28.0), 1.0, 0.22);
    c = mix(c, vec3(0.4, 0.34, 0.2), pale * 0.6);
    alpha = 0.92;
  }
  return c;
}

void main() {
  vec3 eye = ${eye};
  float isFin = (vCoord.z > 0.5 && vCoord.z < 3.5) || abs(vCoord.z - 6.0) < 0.5 ? 1.0 : 0.0;
  if (uPass > -0.5 && abs(isFin - uPass) > 0.5) discard;
  if (vMirror > 0.5 && !inMirror(eye, vSeen)) discard;
  vec3 v = normalize(eyeFor(eye, vMirror) - vReal);
  vec3 n = normalize(vNormal);
  float part = vCoord.z;
  float alpha = 1.0;
  vec3 albedo;
  float gloss = 40.0;
  float shine = 0.35;
  float sheen = 0.0;
  float metal = 0.0;
  float glow = 0.0;
  vec3 extra = vec3(0.0);
  float sun = ${sunAt};
  if (part < 0.5) {
    albedo = markings(vCoord.x, vCoord.y, vRest, vAnim.y, part, sheen, metal);
#ifndef FISH_CHEAP
    // Rows of overlapping scales: each a little darker at its rim and tilted its own way, so
    // the sheen breaks up into soft patches as the body turns.
    vec2 g = vec2(vCoord.x * 38.0, vCoord.y * 11.0);
    g.y += floor(g.x) * 0.5;
    vec2 cell = fract(g) - vec2(0.3, 0.5);
    vec2 id = floor(g);
    float rimS = smoothstep(0.25, 0.55, length(cell * vec2(1.0, 0.8)));
    vec3 tilt = vec3(hash13(vec3(id, uSeed * 13.0)) - 0.5, hash13(vec3(id, 7.0 + uSeed)) - 0.5, 0.0);
    float scaly = uKind == 8 ? 0.0 : 1.0;
    vec3 ns = normalize(n + tilt * 0.18 * scaly);
    albedo *= 1.0 - 0.05 * rimS * scaly;
    // Silver and metallic sheen: a soft mirror-like lobe tinted by the body, shifting in hue
    // at a slant as the guanine in the scales does.
    float facing = max(dot(ns, v), 0.0);
    vec3 hue = mix(vec3(0.6, 0.78, 0.95), vec3(0.95, 0.88, 0.72), facing);
    vec3 h = normalize(uLight + v);
    float lobe = pow(max(dot(ns, h), 0.0), 28.0);
    extra += uSun * sun * lobe * mix(hue, albedo * 1.6, metal) * (0.12 + 0.5 * sheen) * (1.0 - 0.5 * rimS);
    float wide = pow(max(dot(n, h), 0.0), 8.0);
    extra += uSun * sun * wide * albedo * metal * 0.35;
    // The sky above shows in the upper flanks of silvery fish.
    extra += uSky * 2.0 * sheen * smoothstep(0.2, 0.9, ns.y) * pow(1.0 - facing, 2.0) * 0.5;
#else
    vec3 ns = n;
    float facing = max(dot(n, v), 0.0);
#endif
    if (uKind == 2) {
      float stripe = band(vCoord.y, 0.3, 0.42, 0.02) * band(vCoord.x, 0.13, 0.66, 0.03);
      glow = stripe * (0.35 + 0.65 * pow(1.0 - facing, 1.5));
      extra += mix(vec3(0.0, 0.45, 0.7), vec3(0.1, 0.25, 0.9), facing) * glow * 0.55;
    }
    shine = 0.25;
    gloss = 50.0;
    if (vCoord.x < 0.06 && (uKind <= 1 || uKind == 6 || uKind == 7)) {
      vec2 m = (vRest.yz - vec2(-0.008, 0.0)) * vec2(1.25, 1.0);
      float r = length(m);
      float open = 0.006 + 0.03 * vAnim.x;
      float lips = smoothstep(open + 0.022, open + 0.01, r) * smoothstep(0.06, 0.03, vCoord.x);
      albedo = mix(albedo, mix(uBelly, vec3(0.85, 0.45, 0.35), 0.4), lips * 0.7);
      albedo = mix(albedo, vec3(0.02, 0.006, 0.006), smoothstep(open + 0.003, open - 0.003, r));
    }
    if (uKind == 8 && vRest.y < -0.02 && vCoord.x < 0.2) {
      // The sucker mouth under the head.
      float d = length(vec2((vRest.x - 0.4) * 1.2, vRest.z));
      albedo = mix(albedo, vec3(0.18, 0.15, 0.12), smoothstep(0.05, 0.035, d));
      albedo = mix(albedo, vec3(0.03, 0.02, 0.02), smoothstep(0.02, 0.012, d) * (0.4 + 0.6 * vAnim.x));
    }
    n = ns;
  } else if (part < 3.5 || abs(part - 6.0) < 0.5) {
    // Fins, tail and threads: thin and see-through, with rays, lit through from above.
    if (dot(n, v) < 0.0) n = -n;
    // Rays fanning out from the base, the membrane between them thinner.
    float rays = 0.5 + 0.5 * sin(atan(vRest.y - vAnchor.y, vRest.x - vAnchor.x - 0.02) * 60.0);
    albedo = finColour(vCoord.x, vCoord.y, vRest, alpha) * (0.85 + 0.3 * rays);
    alpha *= mix(0.7, 1.0, rays * smoothstep(0.0, 0.3, vCoord.y));
    if (part > 5.5) alpha = 0.85;
    gloss = 22.0;
    shine = 0.15;
    extra += albedo * uSun * sun * (0.15 + 0.6 * max(dot(-n, uLight), 0.0));
  } else if (part < 4.5) {
    vec3 e = normalize(vRest - vAnchor);
    float side = sign(vAnchor.z + 1e-4);
    float wink = uKind == 3 ? vAnim.z : 0.0;
    vec3 axis = normalize(vec3(0.35 + vAnim.w * 0.35, -wink * 0.95, side));
    float d = dot(e, axis);
    // No white: skin round the edge, a metallic iris ring, a big dark pupil.
    float ring = 0.75 + 0.5 * noise3(vec3(atan(e.y, e.x + 1e-5) * 6.0, d * 9.0, uSeed));
    vec3 iris = uIris * ring;
    albedo = mix(uBack * 0.6, iris, smoothstep(0.05, 0.2, d));
    albedo = mix(albedo, vec3(0.002), smoothstep(0.55, 0.6, d));
    gloss = 300.0;
    shine = 2.5;
    extra += iris * uSun * sun * 0.12 * smoothstep(0.2, 0.5, d) * (1.0 - smoothstep(0.55, 0.6, d));
  } else {
    albedo = uFin * 0.75;
    gloss = 10.0;
    shine = 0.05;
  }
  vec3 col = lit(albedo, n, vReal, v, gloss, shine, 0.65) + extra;
  // The water's light wraps round the edges.
  float rim = pow(1.0 - abs(dot(n, v)), 3.0);
  col += waterTint(vReal.y) * rim * 0.35;
  col = underwater(col, eye, vSeen, vReal.y);
  gl_FragColor = vec4(col, alpha);
  ${out}
}
`;
