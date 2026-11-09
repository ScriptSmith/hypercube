/**
 * The scenes, all our own: a solar system, a binary star with planets round both, a gas giant
 * whose closest moon is inside its tidal limit, a small star cluster and two disc galaxies
 * passing. Each is built in the scene's own units, set so the main mass pulls about as hard as
 * the default sun (so slingshots throw sensibly everywhere) while sizes are the scene's own.
 * Every scene starts with no net momentum and its centre of mass at home.
 */
import { MASS } from "./bodies";
import { COL, type Dust, KEEP } from "./dust";
import {
  addBody,
  type Body,
  createUniverse,
  type Spec,
  type Universe,
  type Units,
} from "./physics";

export const SCENES = ["solar", "binary", "rings", "cluster", "galaxies"] as const;
export type SceneId = (typeof SCENES)[number];

const AU_KM = 1.496e8;
const LY_KM = 9.461e12;

/**
 * How many real km the sky's size L stands for in each scene, which sets true sizes. The solar
 * system's L is 5 AU (its giants at 3.3 and 4.9 AU); the binary's 2 AU (the stars 0.56 AU
 * apart); the ringed giant is seen so close that its true size is the size it is drawn on a
 * wall; the cluster's L is 200 AU (its close pair 32 AU apart); the galaxies' 40,000 light years.
 */
export const SCALE_KM: Record<SceneId, number> = {
  solar: 5 * AU_KM,
  binary: 2 * AU_KM,
  rings: 7.77e5,
  cluster: 200 * AU_KM,
  galaxies: 40_000 * LY_KM,
};

/** Where a frame's scenes sit and how they move. Lengths in display px. */
export interface Sky {
  /** Home: where the centre of mass is kept. */
  cx: number;
  cy: number;
  /** Size of the sky: the largest orbits reach about this far from home. */
  L: number;
  /** Orbital period (s) at half of L round the main mass. */
  T0: number;
  /** Extra size for bodies on small frames, so they read from a few metres. */
  boost: number;
  /** Smallest radius drawn. */
  minR: number;
  /** The visible area. */
  view: { x0: number; y0: number; x1: number; y1: number };
}

export interface SceneBuild {
  id: SceneId;
  universe: Universe;
  /** Slingshot speeds scale with this (the square root of the main mass's pull). */
  speed: number;
  /** Total pull at the start, for telling when a scene has burnt out. */
  gm0: number;
}

export interface SceneOptions {
  sky: Sky;
  k: number;
  seed: number;
  maxBodies: number;
  dust: Dust;
  /** Particles a scene may keep for its own belt, discs or galaxies. */
  keep: number;
  /** Particle size scale (display px per particle unit). */
  dot: number;
  /** Contacts and tides use true sizes. */
  trueSizes?: boolean;
}

const TAU = Math.PI * 2;

/** The pull of the default sun: a period of T0 at half of L. */
export const gm0Of = (sky: Sky) => (4 * Math.PI ** 2 * (0.5 * sky.L) ** 3) / sky.T0 ** 2;

const mulberry = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const specFor = (o: SceneOptions, units: Units): Spec => {
  const { sky } = o;
  const v = sky.view;
  const far = Math.max(
    Math.hypot(Math.max(sky.cx - v.x0, v.x1 - sky.cx), Math.max(sky.cy - v.y0, v.y1 - sky.cy)) *
      1.25,
    sky.L * 2.5,
  );
  return {
    units,
    home: { x: sky.cx, y: sky.cy },
    keepR: sky.L * 2.2,
    farR: far,
    lostR: far * 6,
    maxBodies: o.maxBodies,
    omega: TAU / 16,
  };
};

/** Velocity of a circular orbit at angle th (radians, y down), anticlockwise as seen. */
const around = (gm: number, r: number, th: number) => {
  const v = Math.sqrt(gm / r);
  return { vx: Math.sin(th) * v, vy: -Math.cos(th) * v };
};

/**
 * Put a body on a circular orbit round `c` (its pull plus `extra`), allowing for the pair's
 * softening so the orbit really is round.
 */
const orbit = (
  u: Universe,
  c: { x: number; y: number; vx: number; vy: number; gm: number; soft?: number },
  r: number,
  th: number,
  body: { kind: Body["kind"]; m: number; look?: number },
  extra = 0,
): Body => {
  const b = addBody(u, { ...body, x: c.x + Math.cos(th) * r, y: c.y + Math.sin(th) * r });
  const eps = Math.max(c.soft ?? 0, b.soft);
  const v = around(((c.gm + extra) * r * r * r) / (r * r + eps * eps) ** 1.5, r, th);
  b.vx = c.vx + v.vx;
  b.vy = c.vy + v.vy;
  return b;
};

/** No net momentum, and the centre of mass at home. */
const balance = (u: Universe) => {
  let g = 0;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  for (const b of u.bodies) {
    g += b.gm;
    x += b.x * b.gm;
    y += b.y * b.gm;
    vx += b.vx * b.gm;
    vy += b.vy * b.gm;
  }
  if (g <= 0) return { dx: 0, dy: 0, dvx: 0, dvy: 0 };
  const shift = {
    dx: u.spec.home.x - x / g,
    dy: u.spec.home.y - y / g,
    dvx: -vx / g,
    dvy: -vy / g,
  };
  for (const b of u.bodies) {
    b.x += shift.dx;
    b.y += shift.dy;
    b.px = b.x;
    b.py = b.y;
    b.vx += shift.dvx;
    b.vy += shift.dvy;
  }
  return shift;
};

/** A ring of keep particles on circular orbits round `c`. */
const belt = (
  o: SceneOptions,
  rnd: () => number,
  c: { x: number; y: number; vx: number; vy: number },
  gm: number,
  r0: number,
  r1: number,
  n: number,
  col: number,
  size: number,
  eps = 0,
) => {
  for (let i = 0; i < n; i++) {
    const r = r0 + (r1 - r0) * rnd();
    const th = rnd() * TAU;
    const v = Math.sqrt((gm * r * r) / (r * r + eps * eps) ** 1.5) * (1 + (rnd() - 0.5) * 0.02);
    o.dust.spawn(
      KEEP,
      c.x + Math.cos(th) * r,
      c.y + Math.sin(th) * r,
      c.vx + Math.sin(th) * v,
      c.vy - Math.cos(th) * v,
      Infinity,
      col,
      size * (0.7 + rnd() * 0.6),
    );
  }
};

/** Shift a scene's own particles, made before `balance`, by the same amounts. */
const shiftDust = (dust: Dust, s: ReturnType<typeof balance>) => {
  for (let i = 0; i < dust.cap; i++) {
    if (dust.kind[i] !== KEEP) continue;
    dust.x[i] = dust.x[i]! + s.dx;
    dust.y[i] = dust.y[i]! + s.dy;
    dust.px[i] = dust.x[i]!;
    dust.py[i] = dust.y[i]!;
    dust.vx[i] = dust.vx[i]! + s.dvx;
    dust.vy[i] = dust.vy[i]! + s.dvy;
  }
};

const units = (sky: Sky, gmUnit: number, zoom: number, id: SceneId): Units => ({
  gmUnit,
  lenUnit: sky.L * zoom * sky.boost,
  minR: sky.minR,
  kmPx: SCALE_KM[id] / sky.L,
});

const universe = (o: SceneOptions, id: SceneId, gmUnit: number, zoom: number): Universe =>
  createUniverse(specFor(o, units(o.sky, gmUnit, zoom, id)), o.k, o.seed, o.trueSizes ?? false);

const solar = (o: SceneOptions, rnd: () => number): Universe => {
  const { sky } = o;
  const L = sky.L;
  const GM0 = gm0Of(sky);
  const u = universe(o, "solar", GM0, 1);
  const sun = addBody(u, { kind: "star", m: 1, x: sky.cx, y: sky.cy });
  let inner = 0;
  // Spaced so they stay put for many minutes: rocky planets inside, the belt clear of the first
  // giant's reach, and the giants far enough apart. (The giants have no moons: at the sizes drawn
  // a moon would sit outside a giant's Hill sphere and the star would take it.)
  const rocky: [number, number][] = [
    [0.24, 1.5e-4],
    [0.32, 2.5e-4],
    [0.4, 1.2e-4],
  ];
  for (const [r, m] of rocky) {
    const p = orbit(u, sun, r * L, rnd() * TAU, { kind: "planet", m }, inner);
    inner += p.gm;
  }
  belt(
    o,
    rnd,
    sun,
    sun.gm + inner,
    0.45 * L,
    0.51 * L,
    Math.round(o.keep * 0.35),
    COL.belt,
    o.dot,
    sun.r * 0.15,
  );
  const giants: [number, number][] = [
    [0.66, 1.5e-3],
    [0.97, 9e-4],
  ];
  for (const [r, m] of giants) {
    const g = orbit(u, sun, r * L, rnd() * TAU, { kind: "giant", m }, inner);
    inner += g.gm;
  }
  shiftDust(o.dust, balance(u));
  return u;
};

const binary = (o: SceneOptions, rnd: () => number): Universe => {
  const { sky } = o;
  const L = sky.L;
  const GM0 = gm0Of(sky);
  const u = universe(o, "binary", GM0 * 0.68, 0.8);
  const ma = 1;
  const mb = 0.62;
  const a = 0.28 * L;
  const th = rnd() * TAU;
  const gmTot = (ma + mb) * u.spec.units.gmUnit;
  const v = Math.sqrt(gmTot / a);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const fa = mb / (ma + mb);
  const fb = ma / (ma + mb);
  addBody(u, {
    kind: "star",
    m: ma,
    x: sky.cx - c * a * fa,
    y: sky.cy - s * a * fa,
    vx: -s * v * fa,
    vy: c * v * fa,
  });
  addBody(u, {
    kind: "star",
    m: mb,
    x: sky.cx + c * a * fb,
    y: sky.cy + s * a * fb,
    vx: s * v * fb,
    vy: -c * v * fb,
  });
  const cm = { x: sky.cx, y: sky.cy, vx: 0, vy: 0, gm: gmTot };
  // Planets round both stars must stay well outside the pair (about two and a half times their
  // separation), or the stars fling them out.
  orbit(u, cm, 0.72 * L, rnd() * TAU, { kind: "planet", m: 2e-4 });
  orbit(u, cm, 0.98 * L, rnd() * TAU, { kind: "giant", m: 1.2e-3 }, 2e-4 * u.spec.units.gmUnit);
  shiftDust(o.dust, balance(u));
  return u;
};

/** How close a rock may orbit a gas giant before tides start on it, in giant radii. */
export const RING_MOON = 0.95;

const rings = (o: SceneOptions, rnd: () => number): Universe => {
  const { sky } = o;
  const L = sky.L;
  const GM0 = gm0Of(sky);
  const u = universe(o, "rings", (GM0 * 0.35) / MASS.giant, 3);
  const g = addBody(u, { kind: "giant", m: MASS.giant, x: sky.cx, y: sky.cy, look: 1 });
  const rg = g.r;
  // The closest moon sits just inside the tidal limit, so it strains and comes apart in a minute
  // or so. The others are light and spaced well apart, so they leave each other alone.
  const limit = 2.44 * Math.cbrt(1.3 / 3);
  const moons: [number, number, number][] = [
    [rg * limit * RING_MOON, 4e-6, 2],
    [Math.max(0.42 * L, rg * 3.2), 6e-6, 0],
    [Math.max(0.63 * L, rg * 4.8), 4e-6, 1],
    [Math.max(0.86 * L, rg * 6.5), 3e-6, 2],
  ];
  for (const [r, m, look] of moons) orbit(u, g, r, rnd() * TAU, { kind: "rock", m, look });
  belt(
    o,
    rnd,
    g,
    g.gm,
    rg * 1.12,
    rg * 1.4,
    Math.round(o.keep * 0.4),
    COL.ice,
    o.dot * 0.9,
    rg * 0.15,
  );
  shiftDust(o.dust, balance(u));
  return u;
};

/** Two stars on a circular orbit round their centre of mass at (x, y), moving with (vx, vy). */
const pair = (
  u: Universe,
  x: number,
  y: number,
  vx: number,
  vy: number,
  ma: number,
  mb: number,
  sep: number,
  th: number,
) => {
  const g = (ma + mb) * u.spec.units.gmUnit;
  const v = Math.sqrt(g / sep);
  const fa = mb / (ma + mb);
  const fb = ma / (ma + mb);
  const c = Math.cos(th);
  const s = Math.sin(th);
  addBody(u, {
    kind: "star",
    m: ma,
    x: x - c * sep * fa,
    y: y - s * sep * fa,
    vx: vx - s * v * fa,
    vy: vy + c * v * fa,
  });
  addBody(u, {
    kind: "star",
    m: mb,
    x: x + c * sep * fb,
    y: y + s * sep * fb,
    vx: vx + s * v * fb,
    vy: vy - c * v * fb,
  });
};

/**
 * A small cluster: a close pair of stars in the middle, a single star on a long orbit that dives
 * past them, and a second pair further out. The single meets the inner pair every orbit, so
 * stars swap partners and, sooner or later, one is flung out.
 */
const cluster = (o: SceneOptions, rnd: () => number): Universe => {
  const { sky } = o;
  const L = sky.L;
  const GM0 = gm0Of(sky);
  const pool = [0.4, 0.5, 0.65, 0.8, 0.95, 1.1];
  const m: number[] = [];
  while (pool.length > 1) m.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]!);
  const total = m.reduce((s, x) => s + x, 0);
  const u = universe(o, "cluster", (GM0 * 0.6) / total, 0.25);
  const gm = (x: number) => x * u.spec.units.gmUnit;
  const th = rnd() * TAU;
  const { cx, cy } = sky;
  pair(u, cx, cy, 0, 0, m[0]!, m[1]!, 0.16 * L, rnd() * TAU);
  // The single: far end of an orbit that comes back past the inner pair.
  const ra = 0.62 * L;
  const rp = 0.17 * L;
  const inner = gm(m[0]! + m[1]!);
  const va = Math.sqrt((inner * 2 * rp) / (ra * (ra + rp)));
  addBody(u, {
    kind: "star",
    m: m[2]!,
    x: cx + Math.cos(th) * ra,
    y: cy + Math.sin(th) * ra,
    vx: Math.sin(th) * va,
    vy: -Math.cos(th) * va,
  });
  // The outer pair on a roughly circular orbit round the rest.
  const ro = 0.84 * L;
  const to = th + Math.PI;
  const vo = Math.sqrt((inner + gm(m[2]!)) / ro) * 0.95;
  pair(
    u,
    cx + Math.cos(to) * ro,
    cy + Math.sin(to) * ro,
    Math.sin(to) * vo,
    -Math.cos(to) * vo,
    m[3]!,
    m[4]!,
    0.13 * L,
    rnd() * TAU,
  );
  balance(u);
  return u;
};

const galaxies = (o: SceneOptions, rnd: () => number): Universe => {
  const { sky } = o;
  const L = sky.L;
  const GM0 = gm0Of(sky);
  const ma = 1.5e5;
  const mb = 1.0e5;
  const u = universe(o, "galaxies", (GM0 * 0.3) / ma, 0.008);
  const v = sky.view;
  const vw = (v.x1 - v.x0) / L;
  const vh = (v.y1 - v.y0) / L;
  const wide = vw >= vh;
  // Big discs far apart where the view is long, middling ones on squarish views, small ones on
  // a narrow panel.
  const room = Math.max(vw, vh);
  const big = room > 5;
  const square = !big && room / Math.min(vw, vh) < 1.3;
  const ra = (big ? 0.42 : square ? 0.4 : 0.32) * L;
  const rb = ra * 0.82;
  const gma = ma * u.spec.units.gmUnit;
  const gmb = mb * u.spec.units.gmUnit;
  const gm = gma + gmb;
  // A bound, eccentric orbit with its long axis along the view's long side, starting on the way
  // in: they pass about a disc's width apart, swing out and come back, losing a little each pass
  // (dynamical friction) until they merge.
  // The orbit's width across its long axis is the root of its nearest and farthest separations,
  // so a close pass keeps them within the view's short side.
  const q = ra * 0.85;
  const far = (big ? 2.2 : square ? 1.4 : 1.05) * L;
  const e = (far - q) / (far + q);
  const a = (far + q) / 2;
  const p = a * (1 - e * e);
  const d0 = far * 0.97;
  const f0 = -Math.acos(Math.max(-1, Math.min(1, (p / d0 - 1) / e)));
  const psi = (wide ? 0 : Math.PI / 2) + (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.3;
  const k = Math.sqrt(gm / p);
  const vr = k * e * Math.sin(f0);
  const vt = k * (1 + e * Math.cos(f0));
  const th = psi + f0;
  const rx = Math.cos(th) * d0;
  const ry = Math.sin(th) * d0;
  const rvx = Math.cos(th) * vr - Math.sin(th) * vt;
  const rvy = Math.sin(th) * vr + Math.cos(th) * vt;
  const fa = gmb / gm;
  const fb = gma / gm;
  const A = addBody(u, {
    kind: "hole",
    m: ma,
    core: true,
    soft: ra * 0.24,
    x: sky.cx - rx * fa,
    y: sky.cy - ry * fa,
    vx: -rvx * fa,
    vy: -rvy * fa,
  });
  const B = addBody(u, {
    kind: "hole",
    m: mb,
    core: true,
    soft: rb * 0.24,
    x: sky.cx + rx * fb,
    y: sky.cy + ry * fb,
    vx: rvx * fb,
    vy: rvy * fb,
  });
  // The first turns the same way as their orbit (it grows long tails), the second against it.
  const prograde: 1 | -1 = rx * rvy - ry * rvx > 0 ? -1 : 1;
  const na = Math.round(o.keep * 0.55);
  const nb = Math.round(o.keep * 0.45);
  disc(o, rnd, A, ra, na, prograde);
  disc(o, rnd, B, rb, nb, prograde === 1 ? -1 : 1);
  return u;
};

/**
 * A galaxy's stars on circular orbits in the core's softened pull: an exponential disc, two
 * thirds of it in two loose spiral arms, old yellow stars inside and young blue ones outside.
 */
const disc = (o: SceneOptions, rnd: () => number, c: Body, R: number, n: number, turn: 1 | -1) => {
  const h = R / 2.4;
  const eps = c.soft;
  const arm0 = rnd() * TAU;
  for (let i = 0; i < n; i++) {
    let r = R;
    for (let t = 0; t < 8 && r >= R; t++) r = -h * Math.log(Math.max(1e-9, rnd() * rnd()));
    r = Math.max(R * 0.08, Math.min(R, r));
    let th = rnd() * TAU;
    if (rnd() < 0.66 && r > R * 0.2) {
      // On a logarithmic spiral, trailing the way the disc turns, with some scatter.
      const arm = rnd() < 0.5 ? 0 : Math.PI;
      th = arm0 + arm - turn * Math.log(r / (R * 0.2)) * 2.3 + (rnd() - 0.5) * 0.55;
    }
    const v = Math.sqrt((c.gm * r * r) / (r * r + eps * eps) ** 1.5) * (1 + (rnd() - 0.5) * 0.04);
    const t = r / R;
    const pick = rnd();
    const col =
      t < 0.25
        ? pick < 0.8
          ? COL.galaxyOld
          : COL.galaxyWhite
        : pick < 0.07
          ? COL.galaxyGas
          : pick < 0.6
            ? COL.galaxyYoung
            : COL.galaxyWhite;
    const size = o.dot * (t < 0.25 ? 1 + rnd() * 0.6 : 0.75 + rnd() * 0.9);
    o.dust.spawn(
      KEEP,
      c.x + Math.cos(th) * r,
      c.y + Math.sin(th) * r,
      c.vx + Math.sin(th) * v * turn,
      c.vy - Math.cos(th) * v * turn,
      Infinity,
      col,
      size,
    );
  }
};

const BUILD: Record<SceneId, (o: SceneOptions, rnd: () => number) => Universe> = {
  solar,
  binary,
  rings,
  cluster,
  galaxies,
};

/** Build a scene into a fresh universe, adding its own particles to `o.dust`. */
export const buildScene = (id: SceneId, o: SceneOptions): SceneBuild => {
  const rnd = mulberry(o.seed ^ 0x5eed);
  const u = BUILD[id](o, rnd);
  u.events.length = 0;
  const GM0 = gm0Of(o.sky);
  let central = 0;
  let total = 0;
  for (const b of u.bodies) {
    total += b.gm;
    if (Math.hypot(b.x - o.sky.cx, b.y - o.sky.cy) < 0.6 * o.sky.L) central += b.gm;
  }
  const speed = Math.max(0.45, Math.min(1.3, Math.sqrt(Math.max(central, total * 0.5) / GM0)));
  return { id, universe: u, speed, gm0: total };
};
