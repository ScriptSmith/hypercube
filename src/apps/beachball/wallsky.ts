/**
 * The time of day on the beach. Four looks (day, sunset, evening and sunrise) set the sky, the
 * clouds, the sea, the sand and the light on everything; with `cycle` the beach drifts slowly
 * from one to the next, fading over a minute, round about every eighteen and a half minutes.
 *
 * The beach faces east over the sea, as Brisbane's ocean beaches do: the sun rises out of the sea
 * in the picture, with a path of light across the water, and sets behind the people, lighting
 * the beach gold while the sky over the sea turns pink. In the evening a moon hangs over the sea
 * among the stars, and warm light from the promenade behind the people keeps every face lit.
 *
 * Colours are linear, as the shaders use them. Every value is plain data, blended between looks
 * on the CPU and handed to the shaders as shared uniforms (`SKY`), so nothing is computed per
 * pixel that doesn't need to be.
 */
import { Vector2, Vector3, Vector4 } from "three";

export type SkyMode = "cycle" | "day" | "sunset" | "evening" | "sunrise";
export type LookName = Exclude<SkyMode, "cycle">;
export const SKY_MODES: readonly SkyMode[] = ["cycle", "day", "sunset", "evening", "sunrise"];

type Rgb = readonly [number, number, number];

export interface Look {
  /** Towards the light that shades things, in the wall's frame (x right, y up, z to the people). */
  sun: Rgb;
  /** Light on the balls, toys and net: the sun's, the sky's, the sand's and the beach behind. */
  sunLight: Rgb;
  skyLight: Rgb;
  sandLight: Rgb;
  behindLight: Rgb;
  /** The colour of the sun's glint on gloss. */
  glint: Rgb;
  /** What shiny things reflect: the sky overhead and at the horizon, the sand, the far sea. */
  envTop: Rgb;
  envHorizon: Rgb;
  envGround: Rgb;
  envFar: Rgb;
  /** The sky's top and its colour at the horizon, and a glow: colour, and where and how wide. */
  skyTop: Rgb;
  skyLow: Rgb;
  glow: Rgb;
  /** Across the wall (0 to 1), up the sky from the horizon (0 to 1), and its spread. */
  glowAt: Rgb;
  cloudLit: Rgb;
  cloudDark: Rgb;
  /** How much of the sky the clouds cover, 0 to 1 (1 is the day's). */
  clouds: number;
  /** The sea's colours scaled, its horizon's reflection, and its foam. */
  seaTint: Rgb;
  seaSky: Rgb;
  foam: Rgb;
  /** The sand's and the far land's colours scaled. */
  sand: Rgb;
  land: Rgb;
  /** The sun's disc: across the wall (0 to 1), metres above the horizon, radius, strength. */
  sunDisc: readonly [number, number, number, number];
  sunColour: Rgb;
  /** The moon's disc, the same way. */
  moonDisc: readonly [number, number, number, number];
  stars: number;
  /** How dark shadows are, 1 the day's. */
  shadow: number;
}

const unit = (v: Rgb): Rgb => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const k = (c: Rgb, s: number): Rgb => [c[0] * s, c[1] * s, c[2] * s];

export const LOOKS: Readonly<Record<LookName, Look>> = {
  // A bright midday beach: the look the wall had before the time of day.
  day: {
    sun: unit([-0.22, 0.94, 0.26]),
    sunLight: k([1, 0.95, 0.86], 0.55),
    skyLight: k([0.42, 0.52, 0.68], 0.75),
    sandLight: k([0.75, 0.64, 0.48], 0.6),
    behindLight: k([0.85, 0.85, 0.82], 0.35),
    glint: [1, 0.97, 0.9],
    envTop: k([0.12, 0.32, 0.7], 0.9),
    envHorizon: k([0.62, 0.78, 0.9], 0.9),
    envGround: k([0.55, 0.45, 0.32], 0.75),
    envFar: k([0.4, 0.55, 0.62], 0.75),
    skyTop: [0.09, 0.27, 0.62],
    skyLow: [0.58, 0.76, 0.88],
    glow: [0.1, 0.09, 0.06],
    glowAt: [0, 1, 0.35],
    cloudLit: [0.98, 0.96, 0.92],
    cloudDark: [0.5, 0.58, 0.7],
    clouds: 1,
    seaTint: [1, 1, 1],
    seaSky: [0.5, 0.68, 0.82],
    foam: [0.92, 0.95, 0.96],
    sand: [1, 1, 1],
    land: [1, 1, 1],
    sunDisc: [0.4, 0.17, 0.2, 0],
    sunColour: [1, 0.85, 0.6],
    moonDisc: [0.72, 1.1, 0.15, 0],
    stars: 0,
    shadow: 1,
  },
  // The sun low behind the people: gold light on the beach, a pink sky over a lilac sea.
  sunset: {
    sun: unit([-0.5, 0.32, 0.8]),
    sunLight: k([1, 0.64, 0.36], 0.66),
    skyLight: k([0.36, 0.32, 0.52], 0.7),
    sandLight: k([0.78, 0.52, 0.34], 0.55),
    behindLight: k([1, 0.68, 0.46], 0.42),
    glint: [1, 0.78, 0.52],
    envTop: k([0.16, 0.16, 0.42], 0.9),
    envHorizon: k([0.92, 0.6, 0.58], 0.9),
    envGround: k([0.62, 0.42, 0.3], 0.75),
    envFar: k([0.42, 0.36, 0.52], 0.75),
    skyTop: [0.11, 0.12, 0.36],
    skyLow: [0.92, 0.6, 0.56],
    glow: [0.24, 0.1, 0.14],
    glowAt: [0.5, 0, 0.09],
    cloudLit: [1, 0.72, 0.6],
    cloudDark: [0.42, 0.34, 0.5],
    clouds: 0.9,
    seaTint: [0.82, 0.66, 0.92],
    seaSky: [0.86, 0.6, 0.66],
    foam: [0.98, 0.86, 0.84],
    sand: [1.04, 0.82, 0.68],
    land: [0.8, 0.62, 0.72],
    sunDisc: [0.4, 0.17, 0.2, 0],
    sunColour: [1, 0.85, 0.6],
    moonDisc: [0.72, 1.1, 0.15, 0],
    stars: 0,
    shadow: 0.9,
  },
  // After dusk: a deep blue sky full of stars, a moon over the sea and its path on the water,
  // cool moonlight and warm light from the promenade behind the people.
  evening: {
    sun: unit([0.25, 0.85, 0.2]),
    sunLight: k([0.55, 0.66, 0.95], 0.3),
    skyLight: k([0.12, 0.18, 0.38], 0.85),
    sandLight: k([0.22, 0.22, 0.3], 0.5),
    behindLight: k([0.85, 0.62, 0.42], 0.34),
    glint: [0.75, 0.82, 1],
    envTop: k([0.02, 0.04, 0.12], 0.9),
    envHorizon: k([0.12, 0.17, 0.32], 0.9),
    envGround: k([0.3, 0.24, 0.2], 0.75),
    envFar: k([0.06, 0.1, 0.2], 0.75),
    skyTop: [0.008, 0.016, 0.06],
    skyLow: [0.06, 0.1, 0.22],
    glow: [0.07, 0.08, 0.13],
    glowAt: [0.72, 0.42, 0.04],
    cloudLit: [0.32, 0.37, 0.52],
    cloudDark: [0.04, 0.06, 0.12],
    clouds: 0.75,
    seaTint: [0.3, 0.38, 0.56],
    seaSky: [0.1, 0.14, 0.26],
    foam: [0.5, 0.57, 0.7],
    sand: [0.36, 0.38, 0.5],
    land: [0.25, 0.3, 0.42],
    sunDisc: [0.4, 0.17, 0.2, 0],
    sunColour: [1, 0.85, 0.6],
    moonDisc: [0.72, 1.1, 0.15, 1],
    stars: 1,
    shadow: 0.4,
  },
  // The sun coming up out of the sea, a path of gold across the water and a peach sky.
  sunrise: {
    sun: unit([0.15, 0.3, -0.94]),
    sunLight: k([1, 0.7, 0.42], 0.66),
    skyLight: k([0.46, 0.48, 0.64], 0.72),
    sandLight: k([0.72, 0.56, 0.44], 0.52),
    behindLight: k([0.58, 0.6, 0.74], 0.46),
    glint: [1, 0.82, 0.56],
    envTop: k([0.24, 0.32, 0.6], 0.9),
    envHorizon: k([1, 0.74, 0.5], 0.9),
    envGround: k([0.6, 0.46, 0.36], 0.75),
    envFar: k([0.62, 0.52, 0.5], 0.75),
    skyTop: [0.17, 0.26, 0.52],
    skyLow: [1, 0.72, 0.46],
    glow: [0.62, 0.36, 0.14],
    glowAt: [0.4, 0.02, 0.05],
    cloudLit: [1, 0.76, 0.56],
    cloudDark: [0.46, 0.42, 0.56],
    clouds: 0.85,
    seaTint: [0.72, 0.64, 0.72],
    seaSky: [1, 0.74, 0.52],
    foam: [1, 0.92, 0.86],
    sand: [1.03, 0.86, 0.75],
    land: [0.6, 0.5, 0.58],
    sunDisc: [0.4, 0.17, 0.2, 1.4],
    sunColour: [1, 0.86, 0.62],
    moonDisc: [0.72, 1.1, 0.15, 0],
    stars: 0.15,
    shadow: 0.65,
  },
};

/** The cycle: each look held, then faded into the next over `fade` seconds. */
export const CYCLE: readonly { look: LookName; hold: number; fade: number }[] = [
  { look: "day", hold: 480, fade: 60 },
  { look: "sunset", hold: 120, fade: 60 },
  { look: "evening", hold: 150, fade: 60 },
  { look: "sunrise", hold: 120, fade: 60 },
];
export const CYCLE_S = CYCLE.reduce((s, c) => s + c.hold + c.fade, 0);

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** A blank look to fill. */
export const blankLook = (): Look => structuredClone(LOOKS.day) as Look;

/** `out` set to `a` blended towards `b` by `t`, in place, so a frame makes no garbage. */
const blend = (a: Look, b: Look, t: number, out: Look) => {
  const o = out as unknown as Record<string, number | number[]>;
  for (const key of Object.keys(a) as (keyof Look)[]) {
    const av = a[key] as number | readonly number[];
    const bv = b[key] as number | readonly number[];
    if (typeof av === "number") {
      o[key] = mix(av, bv as number, t);
      continue;
    }
    const ov = o[key] as number[];
    for (let i = 0; i < av.length; i++) ov[i] = mix(av[i]!, (bv as readonly number[])[i]!, t);
  }
  const s = out.sun as unknown as number[];
  const l = Math.hypot(s[0]!, s[1]!, s[2]!) || 1;
  for (let i = 0; i < 3; i++) s[i]! /= l;
  return out;
};

/** Which look the cycle is in at `t` s and how far it has faded towards the next, 0 to 1. */
export const cycleAt = (t: number): { from: LookName; to: LookName; fade: number } => {
  let s = ((t % CYCLE_S) + CYCLE_S) % CYCLE_S;
  for (let i = 0; i < CYCLE.length; i++) {
    const c = CYCLE[i]!;
    const next = CYCLE[(i + 1) % CYCLE.length]!;
    if (s < c.hold) return { from: c.look, to: c.look, fade: 0 };
    s -= c.hold;
    if (s < c.fade) {
      const u = s / c.fade;
      return { from: c.look, to: next.look, fade: u * u * (3 - 2 * u) };
    }
    s -= c.fade;
  }
  return { from: "day", to: "day", fade: 0 };
};

/** The look for `mode` at cycle time `t` s, written into `out`. */
export const lookAt = (mode: SkyMode, t: number, out: Look): Look => {
  if (mode !== "cycle") return blend(LOOKS[mode], LOOKS[mode], 0, out);
  const c = cycleAt(t);
  return blend(LOOKS[c.from], LOOKS[c.to], c.fade, out);
};

/**
 * The sun as shadows use it: never lower than this over the sand, so a low sun lengthens them
 * without sending them off the beach, and never far towards the people, where the sand ends.
 */
export const shadowSun = (sun: Rgb): Rgb => {
  const [x, y0, z0] = unit([sun[0], sun[1], Math.max(-0.12, sun[2])]);
  if (y0 >= 0.62) return [x, y0, z0];
  const along = Math.sqrt(1 - 0.62 * 0.62) / (Math.hypot(x, z0) || 1);
  return [x * along, 0.62, z0 * along];
};

const v3 = (c: Rgb) => ({ value: new Vector3(c[0], c[1], c[2]) });

/** The uniforms every wall shader shares, set once a frame from the look. */
export const createSkyUniforms = () => {
  const d = LOOKS.day;
  return {
    uLightSun: v3(d.sunLight),
    uLightSky: v3(d.skyLight),
    uLightSand: v3(d.sandLight),
    uLightBehind: v3(d.behindLight),
    uGlint: v3(d.glint),
    uEnvTop: v3(d.envTop),
    uEnvHorizon: v3(d.envHorizon),
    uEnvGround: v3(d.envGround),
    uEnvFar: v3(d.envFar),
    uSkyTop: v3(d.skyTop),
    uSkyLow: v3(d.skyLow),
    uGlow: v3(d.glow),
    uGlowAt: v3(d.glowAt),
    uCloudLit: v3(d.cloudLit),
    uCloudDark: v3(d.cloudDark),
    uClouds: { value: d.clouds },
    uSeaTint: v3(d.seaTint),
    uSeaSky: v3(d.seaSky),
    uFoam: v3(d.foam),
    uSandTint: v3(d.sand),
    uLandTint: v3(d.land),
    uSunDisc: { value: new Vector4(...d.sunDisc) },
    uSunColour: v3(d.sunColour),
    uMoonDisc: { value: new Vector4(...d.moonDisc) },
    uStars: { value: d.stars },
    uSkyTime: { value: new Vector2(0, 0) },
  };
};
export type SkyUniforms = ReturnType<typeof createSkyUniforms>;

/** Every uniform set from the look. */
export const applyLook = (u: SkyUniforms, l: Look) => {
  const set = (t: { value: Vector3 }, c: Rgb) => t.value.set(c[0], c[1], c[2]);
  set(u.uLightSun, l.sunLight);
  set(u.uLightSky, l.skyLight);
  set(u.uLightSand, l.sandLight);
  set(u.uLightBehind, l.behindLight);
  set(u.uGlint, l.glint);
  set(u.uEnvTop, l.envTop);
  set(u.uEnvHorizon, l.envHorizon);
  set(u.uEnvGround, l.envGround);
  set(u.uEnvFar, l.envFar);
  set(u.uSkyTop, l.skyTop);
  set(u.uSkyLow, l.skyLow);
  set(u.uGlow, l.glow);
  set(u.uGlowAt, l.glowAt);
  set(u.uCloudLit, l.cloudLit);
  set(u.uCloudDark, l.cloudDark);
  u.uClouds.value = l.clouds;
  set(u.uSeaTint, l.seaTint);
  set(u.uSeaSky, l.seaSky);
  set(u.uFoam, l.foam);
  set(u.uSandTint, l.sand);
  set(u.uLandTint, l.land);
  u.uSunDisc.value.set(...l.sunDisc);
  set(u.uSunColour, l.sunColour);
  u.uMoonDisc.value.set(...l.moonDisc);
  u.uStars.value = l.stars;
};

/** GLSL declaring the light and reflection uniforms the balls, the net and the toys share. */
export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uLightSun;
uniform vec3 uLightSky;
uniform vec3 uLightSand;
uniform vec3 uLightBehind;
uniform vec3 uGlint;
uniform vec3 uEnvTop;
uniform vec3 uEnvHorizon;
uniform vec3 uEnvGround;
uniform vec3 uEnvFar;

// The sky and beach as shiny things reflect them.
vec3 skyEnv(vec3 r) {
  if (r.y >= 0.0) return mix(uEnvHorizon, uEnvTop, pow(r.y, 0.6));
  float far = exp(r.y * 6.0);
  return mix(uEnvGround, uEnvFar, far * 0.6);
}
`;
