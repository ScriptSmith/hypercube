/**
 * The universe: massive bodies pulling every other one, stepped at a fixed rate.
 *
 * - Gravity is a pairwise sum with a little Plummer softening, integrated with velocity Verlet
 *   (symplectic for forces that depend only on position, so orbits keep their energy). A step is
 *   split into substeps while any pair is in a close pass, so energy stays steady through it.
 * - The view follows the system's centre of mass: everything gets the same small acceleration that
 *   pulls the centre of mass back home. A uniform acceleration changes no relative motion at all,
 *   so orbits are untouched; it only keeps a system someone shoved from drifting off the view.
 * - Contacts: a much smaller body is absorbed (mass, momentum and volume kept) and heats the
 *   larger; two similar solid bodies hitting fast shatter into fragments that may gather again;
 *   whatever hits a star or a black hole is swallowed.
 * - Tides: a body inside the tidal limit of a much heavier one strains, faster the deeper it is
 *   and the faster it would swing round, and comes apart into a stream (the cosmos turns it into
 *   dust that spreads into a ring).
 * - A gas giant that gathers enough mass ignites as a star; a star that gathers too much
 *   collapses into a black hole, blowing most of its mass off as a shell.
 *
 * - Sizes: every body has a drawn size, exaggerated so it shows, and its true size for its mass
 *   and density at the scene's length scale. The universe's mode says which one contacts and
 *   tides use. A contact counts only for a pair that was apart at the start of the step, so
 *   switching sizes never makes bodies that happen to overlap collide.
 *
 * Everything that changes lives in the Universe, and `step` uses only the universe's own random
 * state, so a copy stepped ahead (the ribbon) goes exactly where the original will.
 */
import {
  densityOf,
  GIANT_MAX,
  holeRadius,
  holeRadiusKm,
  isSolid,
  type Kind,
  MASS,
  mixDensity,
  type Pick,
  REMNANT,
  solidDensity,
  solidKind,
  solidRadiusKm,
  solidVolume,
  STAR_MAX,
  starRadius,
  starRadiusKm,
} from "./bodies";

export const HZ = 120;
export const DT = 1 / HZ;
export const STEP_MS = 1000 / HZ;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Body {
  id: number;
  kind: Kind;
  /** Mass in suns, and the pull it gives (display px^3/s^2). */
  m: number;
  gm: number;
  /** Radius for contacts and tides (display px): `re` or `rt` by the universe's mode. */
  r: number;
  /** Drawn (exaggerated) radius, and true radius at the scene's length scale. */
  re: number;
  rt: number;
  /** Solids: volume in length units cubed (radius = cbrt). */
  vol: number;
  /** Real density, for tidal limits. */
  rho: number;
  /** Softening length. */
  soft: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Position at the start of the last step, for drawing between steps and for contacts. */
  px: number;
  py: number;
  ax: number;
  ay: number;
  /** Glow from impacts, 0 to 1, cooling over tens of seconds. */
  heat: number;
  /** Tidal strain, 0 to 1 (1 comes apart), and the body pulling it. */
  strain: number;
  tide: number;
  /** A star's flare after swallowing something, and a black hole's feeding glow. */
  flare: number;
  feed: number;
  born: number;
  /** Fragments of one shatter don't touch each other again until `apartUntil`. */
  group: number;
  apartUntil: number;
  /** Who threw it: frame, pad, pad colour (-1 for a scene's own body) and person or not. */
  owner: string;
  pad: number;
  color: number;
  human: boolean;
  /** Picks a look (palette and surface) for drawing. */
  look: number;
  /** A galaxy's core: a heavy, very soft mass drawn with a bulge of stars. */
  core: boolean;
}

/**
 * Display units of a scene: pull per solar mass, length per size unit, smallest drawn radius,
 * and how many real km one display px is (for true sizes).
 */
export interface Units {
  gmUnit: number;
  lenUnit: number;
  minR: number;
  kmPx: number;
}

export interface Spec {
  units: Units;
  /** Where the view's centre of mass is kept. */
  home: { x: number; y: number };
  /** Bodies beyond this from home don't count for the centre of mass. */
  keepR: number;
  /** Beyond this an unbound body is gone; beyond `lostR` anything is. */
  farR: number;
  lostR: number;
  maxBodies: number;
  /** Rate (rad/s) at which the centre of mass is brought home; 0 leaves it free. */
  omega: number;
}

export type Event =
  | {
      type: "merge";
      into: number;
      gone: number;
      kind: Kind;
      look: number;
      /** Impact point, outward normal there, closing speed and the larger body's escape speed. */
      x: number;
      y: number;
      nx: number;
      ny: number;
      vx: number;
      vy: number;
      speed: number;
      vesc: number;
      /** Heat added, and the smaller body's kind, look and radius. */
      heat: number;
      small: Kind;
      smallLook: number;
      r: number;
    }
  | {
      type: "shatter";
      ids: number[];
      gone: number[];
      kind: Kind;
      look: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      vesc: number;
    }
  | {
      type: "swallow";
      into: number;
      gone: number;
      by: "star" | "hole";
      kind: Kind;
      look: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      m: number;
    }
  | {
      type: "shred";
      by: number;
      gone: number;
      kind: Kind;
      look: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      m: number;
      /** The body pulling it apart, as it was. */
      px: number;
      py: number;
      pvx: number;
      pvy: number;
      pgm: number;
      pr: number;
      pkind: Kind;
    }
  | { type: "ignite"; id: number; x: number; y: number; r: number }
  | {
      type: "collapse";
      id: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      m: number;
      lost: number;
    }
  | { type: "gone"; id: number; x: number; y: number; why: "far" | "room" };

export interface Universe {
  k: number;
  spec: Spec;
  bodies: Body[];
  nextId: number;
  nextGroup: number;
  /** Random state, part of the universe so copies agree. */
  seed: number;
  events: Event[];
  /** Accelerations need working out again (bodies changed). */
  dirty: boolean;
  /** Shortest pair timescale squared at the last force pass, for substeps. */
  tmin2: number;
  /** Centre of mass of the kept bodies at the start of the last step. */
  cm: { x: number; y: number; vx: number; vy: number; gm: number };
  /** The uniform acceleration of the last step. */
  rc: { x: number; y: number };
  /** Contacts and tides use true sizes rather than drawn ones. */
  trueSizes: boolean;
}

const MAX_EVENTS = 128;
/** Substeps are taken while a pair's timescale is under this many steps. */
const SUB_STEPS = 8;
const MAX_SUB = 12;
/** Solid bodies at least this many times heavier absorb the smaller instead of shattering. */
const SHATTER_RATIO = 4;
/** Closing speed, in mutual escape speeds, above which two similar solids shatter. */
const SHATTER_SPEED = 1.4;
const HEAT_K = 6;
const HEAT_TAU = 20;
const FLARE_TAU = 1.6;
const FEED_TAU = 4;
/** Strain builds over this many of the orbit's timescales (sqrt(d^3 / GM)) at a given depth. */
const STRAIN_K = 15;
/** Deeper than this share of the limit, a body comes apart at once. */
const DEEP = 0.45;
const RELAX_TAU = 20;
/** A primary must be this much heavier to strain a body. */
const TIDE_RATIO = 10;
/** Galaxy cores overlapping feel dynamical friction (1/s) and merge once slow and close. */
const CORE_FRICTION = 0.06;
const APART_S = 0.4;
/** Fragments leave with this share of the energy that would part them for good. */
const GATHER = 0.7;
const REMOVE_EVERY = 10;
/**
 * Softening never goes below cbrt(SOFT_FLOOR * pull), so even a pass through a point-sized
 * body's centre stays within the substeps (true sizes are far below a pixel).
 */
const SOFT_FLOOR = 6.2e-5;

const TAU = Math.PI * 2;

export const createUniverse = (
  spec: Spec,
  k: number,
  seed: number,
  trueSizes = false,
): Universe => ({
  k,
  spec,
  bodies: [],
  nextId: 1,
  nextGroup: 1,
  seed: seed >>> 0 || 1,
  events: [],
  dirty: true,
  tmin2: Infinity,
  cm: { x: spec.home.x, y: spec.home.y, vx: 0, vy: 0, gm: 0 },
  rc: { x: 0, y: 0 },
  trueSizes,
});

/** A copy that steps on its own. The spec doesn't change, so it is shared. */
export const cloneUniverse = (u: Universe): Universe => ({
  k: u.k,
  spec: u.spec,
  bodies: u.bodies.map((b) => ({ ...b })),
  nextId: u.nextId,
  nextGroup: u.nextGroup,
  seed: u.seed,
  events: [],
  dirty: u.dirty,
  tmin2: u.tmin2,
  cm: { ...u.cm },
  rc: { ...u.rc },
  trueSizes: u.trueSizes,
});

const emit = (u: Universe, e: Event) => {
  if (u.events.length >= MAX_EVENTS) u.events.shift();
  u.events.push(e);
};

export const takeEvents = (u: Universe): Event[] => {
  const out = u.events;
  u.events = [];
  return out;
};

/** Mulberry32 on the universe's own state. */
export const rand = (u: Universe): number => {
  u.seed = (u.seed + 0x6d2b79f5) >>> 0;
  let t = u.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---- Sizes and classes ---------------------------------------------------------------------

const softFor = (b: Body) =>
  Math.max(b.r * (b.kind === "hole" ? 0.5 : 0.2), Math.cbrt(SOFT_FLOOR * b.gm));

/** Both radii for a body's kind and mass, and the one in use. */
const size = (u: Universe, b: Body) => {
  const { lenUnit, minR, kmPx } = u.spec.units;
  if (b.kind === "star") {
    b.re = Math.max(minR, starRadius(b.m) * lenUnit);
    b.rt = starRadiusKm(b.m) / kmPx;
  } else if (b.kind === "hole") {
    b.re = Math.max(minR, holeRadius(b.m) * lenUnit);
    b.rt = holeRadiusKm(b.m) / kmPx;
  } else {
    b.re = Math.max(minR, Math.cbrt(b.vol) * lenUnit);
    b.rt = solidRadiusKm(b.m, b.rho) / kmPx;
  }
  b.r = u.trueSizes ? b.rt : b.re;
  if (!b.core) b.soft = softFor(b);
};

/** Bring a body's radius, pull, class and softening in line with its mass. */
const settle = (u: Universe, b: Body) => {
  const { gmUnit } = u.spec.units;
  b.gm = b.m * gmUnit;
  if (isSolid(b.kind)) {
    if (b.m >= GIANT_MAX) {
      b.kind = "star";
      b.heat = 0;
      b.rho = densityOf("star", b.m);
      size(u, b);
      emit(u, { type: "ignite", id: b.id, x: b.x, y: b.y, r: b.re });
    } else {
      b.kind = solidKind(b.m);
    }
  }
  if (b.kind === "star" && b.m > STAR_MAX) {
    const before = b.m;
    size(u, b);
    const r0 = b.re;
    b.m = before * REMNANT;
    b.gm = b.m * gmUnit;
    b.kind = "hole";
    b.flare = 0;
    b.feed = 1;
    emit(u, {
      type: "collapse",
      id: b.id,
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy,
      r: r0,
      m: before,
      lost: before - b.m,
    });
  }
  b.rho = isSolid(b.kind) ? b.rho : densityOf(b.kind, b.m);
  if (b.core) {
    const { lenUnit, minR, kmPx } = u.spec.units;
    b.re = Math.max(minR, holeRadius(b.m) * lenUnit);
    b.rt = holeRadiusKm(b.m) / kmPx;
    b.r = u.trueSizes ? b.rt : b.re;
  } else {
    size(u, b);
  }
  u.dirty = true;
};

/** Use true sizes (or drawn ones) for contacts and tides from now on. */
export const setSizes = (u: Universe, trueSizes: boolean) => {
  if (u.trueSizes === trueSizes) return;
  u.trueSizes = trueSizes;
  for (const b of u.bodies) {
    b.r = trueSizes ? b.rt : b.re;
    if (!b.core) b.soft = softFor(b);
  }
  u.dirty = true;
};

export interface BodyInit {
  kind: Kind;
  m: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  owner?: string;
  pad?: number;
  color?: number;
  human?: boolean;
  look?: number;
  core?: boolean;
  /** Softening for a galaxy core. */
  soft?: number;
}

/** Add a body as it is, with no room made. Scenes use this. */
export const addBody = (u: Universe, init: BodyInit): Body => {
  const kind = init.kind;
  const solid = isSolid(kind) ? (kind as "rock" | "planet" | "giant") : null;
  const b: Body = {
    id: u.nextId++,
    kind,
    m: init.m,
    gm: 0,
    r: 0,
    re: 0,
    rt: 0,
    vol: solid ? solidVolume(solid, init.m) : 0,
    rho: solid ? solidDensity(solid) : densityOf(kind, init.m),
    soft: init.soft ?? 0,
    x: init.x,
    y: init.y,
    vx: init.vx ?? 0,
    vy: init.vy ?? 0,
    px: init.x,
    py: init.y,
    ax: 0,
    ay: 0,
    heat: 0,
    strain: 0,
    tide: -1,
    flare: 0,
    feed: 0,
    born: u.k,
    group: 0,
    apartUntil: 0,
    owner: init.owner ?? "",
    pad: init.pad ?? -1,
    color: init.color ?? -1,
    human: init.human ?? false,
    look: init.look ?? Math.floor(rand(u) * 1000),
    core: init.core ?? false,
  };
  settle(u, b);
  u.bodies.push(b);
  u.dirty = true;
  // Fresh events from settling a scene's own bodies would only be noise.
  return b;
};

export interface Launch {
  kind: Pick | "hole";
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: string;
  pad: number;
  color: number;
  human: boolean;
  /** Mass in suns; the kind's typical mass when absent. */
  m?: number;
}

/** The body a slingshot or launcher throws, with room made for it. Releases and ribbons both use this. */
export const launch = (u: Universe, l: Launch): Body => {
  makeRoom(u, 1);
  const m = l.m ?? (l.kind === "hole" ? 1 : MASS[l.kind]);
  return addBody(u, {
    kind: l.kind,
    m,
    x: l.x,
    y: l.y,
    vx: l.vx,
    vy: l.vy,
    owner: l.owner,
    pad: l.pad,
    color: l.color,
    human: l.human,
  });
};

const distHome = (u: Universe, b: Body) => Math.hypot(b.x - u.spec.home.x, b.y - u.spec.home.y);

/** Remove the least massive bodies (not stars or black holes), farthest first, until n fit. */
export const makeRoom = (u: Universe, n: number) => {
  while (u.bodies.length + n > u.spec.maxBodies && u.bodies.length > 0) {
    let pick = -1;
    let best = -Infinity;
    for (let i = 0; i < u.bodies.length; i++) {
      const b = u.bodies[i]!;
      const heavy = b.kind === "star" || b.kind === "hole" ? 1e9 : 0;
      // Lighter first, then farther.
      const score = -heavy - Math.log(b.m) * 1000 + distHome(u, b) * 1e-3;
      if (score > best) {
        best = score;
        pick = i;
      }
    }
    const b = u.bodies[pick]!;
    emit(u, { type: "gone", id: b.id, x: b.x, y: b.y, why: "room" });
    u.bodies.splice(pick, 1);
    u.dirty = true;
  }
};

// ---- Forces --------------------------------------------------------------------------------

/** Accelerations of every body from every other, and the shortest pair timescale. */
const forces = (u: Universe) => {
  const bs = u.bodies;
  const n = bs.length;
  for (let i = 0; i < n; i++) {
    bs[i]!.ax = 0;
    bs[i]!.ay = 0;
  }
  let tmin2 = Infinity;
  for (let i = 0; i < n; i++) {
    const a = bs[i]!;
    const sa = a.soft * a.soft;
    for (let j = i + 1; j < n; j++) {
      const b = bs[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const r2 = dx * dx + dy * dy + Math.max(sa, b.soft * b.soft);
      const r3 = r2 * Math.sqrt(r2);
      const inv = 1 / r3;
      a.ax += b.gm * dx * inv;
      a.ay += b.gm * dy * inv;
      b.ax -= a.gm * dx * inv;
      b.ay -= a.gm * dy * inv;
      const t2 = r3 / (a.gm + b.gm);
      if (t2 < tmin2) tmin2 = t2;
      if (a.core && b.core) coreFriction(a, b, r2);
    }
  }
  u.tmin2 = tmin2;
  u.dirty = false;
};

const coreFriction = (a: Body, b: Body, r2: number) => {
  // Strongest where the cores overlap, fading over a couple of their sizes: each close pass
  // takes a little of their orbit's energy, as their unseen halos would.
  const reach = (a.soft + b.soft) * 1.4;
  const k = CORE_FRICTION * Math.exp(-r2 / (reach * reach));
  if (k < 1e-4) return;
  // Equal and opposite, so momentum is kept: F = -k mu (va - vb).
  const mu = (a.gm * b.gm) / (a.gm + b.gm);
  const fx = -k * mu * (a.vx - b.vx);
  const fy = -k * mu * (a.vy - b.vy);
  a.ax += fx / a.gm;
  a.ay += fy / a.gm;
  b.ax -= fx / b.gm;
  b.ay -= fy / b.gm;
};

/** Centre of mass of the bodies near home, and the uniform pull bringing it back. */
const recenter = (u: Universe) => {
  const { home, keepR, omega } = u.spec;
  let g = 0;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  const k2 = keepR * keepR;
  for (const b of u.bodies) {
    const dx = b.x - home.x;
    const dy = b.y - home.y;
    if (dx * dx + dy * dy > k2) continue;
    g += b.gm;
    x += b.x * b.gm;
    y += b.y * b.gm;
    vx += b.vx * b.gm;
    vy += b.vy * b.gm;
  }
  const cm = u.cm;
  if (g <= 0) {
    cm.x = home.x;
    cm.y = home.y;
    cm.vx = 0;
    cm.vy = 0;
    cm.gm = 0;
    u.rc.x = 0;
    u.rc.y = 0;
    return;
  }
  cm.x = x / g;
  cm.y = y / g;
  cm.vx = vx / g;
  cm.vy = vy / g;
  cm.gm = g;
  u.rc.x = -omega * omega * (cm.x - home.x) - 2 * omega * cm.vx;
  u.rc.y = -omega * omega * (cm.y - home.y) - 2 * omega * cm.vy;
};

/** The number of substeps the next step takes. */
export const substeps = (u: Universe): number => {
  if (!Number.isFinite(u.tmin2)) return 1;
  const t = Math.sqrt(u.tmin2);
  return Math.max(1, Math.min(MAX_SUB, Math.ceil((SUB_STEPS * DT) / t)));
};

// ---- The step ------------------------------------------------------------------------------

/** One fixed step of everything. */
export const step = (u: Universe): void => {
  const bs = u.bodies;
  if (u.dirty) forces(u);
  recenter(u);
  const ns = substeps(u);
  const h = DT / ns;
  const half = h * 0.5;
  const rcx = u.rc.x;
  const rcy = u.rc.y;
  for (const b of bs) {
    b.px = b.x;
    b.py = b.y;
  }
  for (let s = 0; s < ns; s++) {
    for (const b of bs) {
      b.vx += (b.ax + rcx) * half;
      b.vy += (b.ay + rcy) * half;
      b.x += b.vx * h;
      b.y += b.vy * h;
    }
    forces(u);
    for (const b of bs) {
      b.vx += (b.ax + rcx) * half;
      b.vy += (b.ay + rcy) * half;
    }
  }
  const k1 = u.k + 1;
  contacts(u, k1);
  tides(u);
  cores(u);
  const cool = Math.exp(-DT / HEAT_TAU);
  const fl = Math.exp(-DT / FLARE_TAU);
  const fe = Math.exp(-DT / FEED_TAU);
  for (const b of u.bodies) {
    b.heat *= cool;
    b.flare *= fl;
    b.feed *= fe;
  }
  if (k1 % REMOVE_EVERY === 0) removeLost(u);
  u.k = k1;
};

// ---- Contacts ------------------------------------------------------------------------------

/**
 * Whether two bodies came within touching distance during the step (straight-line sweep). A pair
 * already overlapping at the start doesn't count: only new contacts do.
 */
const touched = (a: Body, b: Body): boolean => {
  const rr = a.r + b.r;
  const x0 = a.px - b.px;
  const y0 = a.py - b.py;
  if (x0 * x0 + y0 * y0 < rr * rr) return false;
  const x1 = a.x - b.x;
  const y1 = a.y - b.y;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dd = dx * dx + dy * dy;
  let t = dd > 1e-12 ? -(x0 * dx + y0 * dy) / dd : 1;
  t = Math.max(0, Math.min(1, t));
  const cx = x0 + dx * t;
  const cy = y0 + dy * t;
  return cx * cx + cy * cy < rr * rr;
};

const contacts = (u: Universe, k1: number) => {
  const bs = u.bodies;
  let dead: Set<number> | null = null;
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i]!;
    if (dead?.has(a.id)) continue;
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j]!;
      if (dead && (dead.has(b.id) || dead.has(a.id))) continue;
      if (a.group !== 0 && a.group === b.group && k1 < Math.max(a.apartUntil, b.apartUntil)) {
        continue;
      }
      if (!touched(a, b)) continue;
      dead ??= new Set();
      for (const id of resolve(u, a, b, k1)) dead.add(id);
    }
  }
  if (!dead) return;
  const gone = dead;
  u.bodies = bs.filter((b) => !gone.has(b.id));
  u.dirty = true;
};

const closing = (a: Body, b: Body) => Math.hypot(a.vx - b.vx, a.vy - b.vy);

/** Settle a contact between a and b. Returns the ids of bodies that are gone. */
const resolve = (u: Universe, a: Body, b: Body, k1: number): number[] => {
  const big = a.gm >= b.gm ? a : b;
  const small = big === a ? b : a;
  if (big.kind === "hole" || big.kind === "star") {
    const by = big.kind;
    const x = small.x;
    const y = small.y;
    const vx = small.vx;
    const vy = small.vy;
    absorb(u, big, small, false);
    if (by === "star") big.flare = Math.min(1, big.flare + 0.35 + Math.sqrt(small.m / big.m) * 2);
    else big.feed = Math.min(1, big.feed + 0.4 + Math.sqrt(small.m / big.m));
    emit(u, {
      type: "swallow",
      into: big.id,
      gone: small.id,
      by,
      kind: small.kind,
      look: small.look,
      x,
      y,
      vx,
      vy,
      r: small.r,
      m: small.m,
    });
    settle(u, big);
    return [small.id];
  }
  const v = closing(a, b);
  const vesc = Math.sqrt((2 * (a.gm + b.gm)) / (a.r + b.r));
  const solid = (k: Kind) => k === "rock" || k === "planet";
  if (
    solid(a.kind) &&
    solid(b.kind) &&
    big.m / small.m < SHATTER_RATIO &&
    v > SHATTER_SPEED * vesc &&
    u.bodies.length <= u.spec.maxBodies
  ) {
    return shatter(u, a, b, v, vesc, k1);
  }
  const d = Math.hypot(small.x - big.x, small.y - big.y) || 1;
  const nx = (small.x - big.x) / d;
  const ny = (small.y - big.y) / d;
  const ix = big.x + nx * big.r;
  const iy = big.y + ny * big.r;
  const mu = (big.m * small.m) / (big.m + small.m);
  const heat = Math.min(1, HEAT_K * (mu / (big.m + small.m)) * (v / Math.max(1e-9, vesc)) ** 2);
  const smallKind = small.kind;
  const smallLook = small.look;
  const smallR = small.r;
  absorb(u, big, small, true);
  big.heat = Math.min(1, big.heat + heat);
  emit(u, {
    type: "merge",
    into: big.id,
    gone: small.id,
    kind: big.kind,
    look: big.look,
    x: ix,
    y: iy,
    nx,
    ny,
    vx: big.vx,
    vy: big.vy,
    speed: v,
    // Debris speeds are for drawing: from the drawn size, so a splash looks alike in both modes.
    vesc: Math.sqrt((2 * big.gm) / big.re),
    heat,
    small: smallKind,
    smallLook,
    r: smallR,
  });
  settle(u, big);
  return [small.id];
};

/** `big` takes in `small`: mass and momentum kept, the centre of mass where it was. */
const absorb = (u: Universe, big: Body, small: Body, volume: boolean) => {
  const g = big.gm + small.gm;
  big.x = (big.x * big.gm + small.x * small.gm) / g;
  big.y = (big.y * big.gm + small.y * small.gm) / g;
  big.vx = (big.vx * big.gm + small.vx * small.gm) / g;
  big.vy = (big.vy * big.gm + small.vy * small.gm) / g;
  big.px = big.x;
  big.py = big.y;
  if (volume && isSolid(big.kind)) {
    big.vol += isSolid(small.kind) ? small.vol : (small.re / u.spec.units.lenUnit) ** 3;
    big.rho = mixDensity(big.m, big.rho, small.m, small.rho);
  }
  big.m += small.m;
  big.gm = g;
  if (big.color < 0 && small.color >= 0 && small.m > big.m * 0.3) {
    big.color = small.color;
    big.owner = small.owner;
    big.pad = small.pad;
  }
  u.dirty = true;
};

/** Two similar solids hitting fast: a few fragments flying apart, slower than they could escape. */
const shatter = (u: Universe, a: Body, b: Body, speed: number, vesc: number, k1: number) => {
  const M = a.m + b.m;
  const G = a.gm + b.gm;
  const X = (a.x * a.gm + b.x * b.gm) / G;
  const Y = (a.y * a.gm + b.y * b.gm) / G;
  const VX = (a.vx * a.gm + b.vx * b.gm) / G;
  const VY = (a.vy * a.gm + b.vy * b.gm) / G;
  const vol = a.vol + b.vol;
  const rho = mixDensity(a.m, a.rho, b.m, b.rho);
  const big = a.m >= b.m ? a : b;
  // Spin from the off-centre part of the hit.
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const L = ((a.m * b.m) / M) * (rx * (b.vy - a.vy) - ry * (b.vx - a.vx));
  const room = u.spec.maxBodies - (u.bodies.length - 2);
  const n = Math.max(2, Math.min(room, 2 + Math.floor(rand(u) * 3)));
  const w = Array.from({ length: n }, () => 0.45 + rand(u));
  const wsum = w.reduce((s, x) => s + x, 0);
  const lenUnit = u.spec.units.lenUnit;
  const rmax = Math.max(...w.map((x) => Math.cbrt((vol * x) / wsum) * lenUnit));
  const ring = (rmax * 1.2) / Math.sin(Math.PI / Math.max(2, n));
  const vRing = Math.sqrt((2 * G) / ring);
  const spin = L / (M * ring);
  const th0 = rand(u) * TAU;
  const group = u.nextGroup++;
  const made: Body[] = [];
  for (let i = 0; i < n; i++) {
    const share = w[i]! / wsum;
    const th = th0 + (TAU * i) / n;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const out = vRing * (0.45 + 0.5 * rand(u));
    const kind = solidKind(M * share);
    const f: Body = {
      ...big,
      id: u.nextId++,
      kind,
      m: M * share,
      gm: G * share,
      vol: vol * share,
      rho,
      r: 0,
      x: X + c * ring,
      y: Y + s * ring,
      vx: VX + c * out - s * spin,
      vy: VY + s * out + c * spin,
      heat: 1,
      strain: 0,
      tide: -1,
      flare: 0,
      feed: 0,
      born: k1,
      group,
      apartUntil: k1 + Math.round(APART_S * HZ),
      color: i === 0 ? big.color : -1,
    };
    f.px = f.x;
    f.py = f.y;
    made.push(f);
  }
  // Keep the centre of mass and the momentum exactly.
  let mx = 0;
  let my = 0;
  let mvx = 0;
  let mvy = 0;
  for (const f of made) {
    mx += f.x * f.gm;
    my += f.y * f.gm;
    mvx += f.vx * f.gm;
    mvy += f.vy * f.gm;
  }
  const dx = mx / G - X;
  const dy = my / G - Y;
  const dvx = mvx / G - VX;
  const dvy = mvy / G - VY;
  // Then slow the spread so the pieces can't all escape each other: they fall back together.
  let pe = 0;
  let ke = 0;
  for (let i = 0; i < made.length; i++) {
    const a = made[i]!;
    ke += 0.5 * a.gm * ((a.vx - dvx - VX) ** 2 + (a.vy - dvy - VY) ** 2);
    for (let j = i + 1; j < made.length; j++) {
      const b = made[j]!;
      pe -= (a.gm * b.gm) / Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  const slow = ke > 0 ? Math.min(1, Math.sqrt((GATHER * -pe) / ke)) : 1;
  for (const f of made) {
    f.x -= dx;
    f.y -= dy;
    f.px = f.x;
    f.py = f.y;
    f.vx = VX + (f.vx - dvx - VX) * slow;
    f.vy = VY + (f.vy - dvy - VY) * slow;
    settle(u, f);
    u.bodies.push(f);
  }
  emit(u, {
    type: "shatter",
    ids: made.map((f) => f.id),
    gone: [a.id, b.id],
    kind: big.kind,
    look: big.look,
    x: X,
    y: Y,
    vx: VX,
    vy: VY,
    r: Math.cbrt(vol) * lenUnit,
    vesc: Math.max(vesc, speed * 0.3),
  });
  u.dirty = true;
  return [a.id, b.id];
};

// ---- Tides ---------------------------------------------------------------------------------

/** How close to `p` a body `b` can come before tides pull it apart. */
export const tidalLimit = (p: Body, b: Body): number => {
  if (p.kind === "hole") {
    if (b.kind === "star" || b.kind === "giant") {
      return Math.max(b.r * Math.cbrt((2 * p.m) / b.m), 3 * p.r + b.r);
    }
    return 2 * p.r + b.r;
  }
  return 2.44 * p.r * Math.cbrt(p.rho / b.rho);
};

const tides = (u: Universe) => {
  const bs = u.bodies;
  let shredded: Set<number> | null = null;
  for (const b of bs) {
    if (b.kind === "hole" || b.core) continue;
    let p: Body | null = null;
    let best = 0;
    for (const q of bs) {
      // A galaxy's core is a spread-out mass, not a point that tears things apart.
      if (q === b || q.core || q.gm < b.gm * TIDE_RATIO) continue;
      if (b.kind === "star" && q.kind !== "hole") continue;
      if (shredded?.has(q.id)) continue;
      const d2 = (q.x - b.x) ** 2 + (q.y - b.y) ** 2;
      const pull = q.gm / (d2 * Math.sqrt(d2) + 1e-9);
      if (pull > best) {
        best = pull;
        p = q;
      }
    }
    if (!p) {
      b.strain = Math.max(0, b.strain - DT / RELAX_TAU);
      b.tide = -1;
      continue;
    }
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    const lim = tidalLimit(p, b);
    b.tide = p.id;
    if (d < lim) {
      // Measured against the time it takes to swing past: a fast fly-by barely strains, a moon
      // circling just inside comes apart within a minute or so.
      const t = Math.sqrt((d * d * d) / p.gm);
      b.strain += (DT * ((lim / Math.max(d, 1e-6)) ** 3 - 1)) / (STRAIN_K * t);
      if (d < lim * DEEP) b.strain = 1;
    } else {
      b.strain = Math.max(0, b.strain - DT / RELAX_TAU);
    }
    if (b.strain < 1) continue;
    shredded ??= new Set();
    shredded.add(b.id);
    shred(u, p, b);
  }
  if (shredded) {
    u.bodies = u.bodies.filter((b) => !shredded.has(b.id));
    u.dirty = true;
  }
};

/** `b` comes apart near `p`. The primary keeps the bound share of its mass and momentum. */
const shred = (u: Universe, p: Body, b: Body) => {
  const share = p.kind === "hole" && (b.kind === "star" || b.kind === "giant") ? 0.5 : 1;
  emit(u, {
    type: "shred",
    by: p.id,
    gone: b.id,
    kind: b.kind,
    look: b.look,
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    r: b.r,
    m: b.m,
    px: p.x,
    py: p.y,
    pvx: p.vx,
    pvy: p.vy,
    pgm: p.gm,
    pr: p.r,
    pkind: p.kind,
  });
  const add = b.gm * share;
  const g = p.gm + add;
  p.vx = (p.vx * p.gm + b.vx * add) / g;
  p.vy = (p.vy * p.gm + b.vy * add) / g;
  p.m += b.m * share;
  if (isSolid(p.kind) && isSolid(b.kind)) {
    p.vol += b.vol * share;
    p.rho = mixDensity(p.m - b.m * share, p.rho, b.m * share, b.rho);
  }
  if (p.kind === "hole") p.feed = 1;
  settle(u, p);
};

/** Galaxy cores that have sunk together become one. */
const cores = (u: Universe) => {
  const bs = u.bodies;
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i]!;
    if (!a.core) continue;
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j]!;
      if (!b.core) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const s = Math.min(a.soft, b.soft);
      if (d > s * 0.5) continue;
      if (closing(a, b) > 0.6 * Math.sqrt((a.gm + b.gm) / s)) continue;
      const big = a.gm >= b.gm ? a : b;
      const small = big === a ? b : a;
      absorb(u, big, small, false);
      big.soft = Math.hypot(a.soft, b.soft) * 0.8;
      settle(u, big);
      big.feed = 1;
      emit(u, {
        type: "swallow",
        into: big.id,
        gone: small.id,
        by: "hole",
        kind: "hole",
        look: small.look,
        x: small.x,
        y: small.y,
        vx: small.vx,
        vy: small.vy,
        r: small.r,
        m: small.m,
      });
      u.bodies = bs.filter((x) => x !== small);
      u.dirty = true;
      return;
    }
  }
};

// ---- Leaving -------------------------------------------------------------------------------

/** Energy per unit mass of a body relative to the kept centre of mass's motion. */
export const bodyEnergy = (u: Universe, b: Body): number => {
  let e = 0.5 * ((b.vx - u.cm.vx) ** 2 + (b.vy - u.cm.vy) ** 2);
  for (const q of u.bodies) {
    if (q === b) continue;
    const d2 = (q.x - b.x) ** 2 + (q.y - b.y) ** 2 + Math.max(q.soft, b.soft) ** 2;
    e -= q.gm / Math.sqrt(d2);
  }
  return e;
};

const removeLost = (u: Universe) => {
  const { farR, lostR } = u.spec;
  let changed = false;
  for (let i = u.bodies.length - 1; i >= 0; i--) {
    const b = u.bodies[i]!;
    const d = distHome(u, b);
    if (d < farR) continue;
    if (d < lostR && bodyEnergy(u, b) < 0) continue;
    emit(u, { type: "gone", id: b.id, x: b.x, y: b.y, why: "far" });
    u.bodies.splice(i, 1);
    changed = true;
  }
  if (changed) u.dirty = true;
};

/** Total momentum (gm-weighted) and energy, for tests. */
export const totals = (u: Universe) => {
  let px = 0;
  let py = 0;
  let ke = 0;
  let pe = 0;
  const bs = u.bodies;
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i]!;
    px += a.gm * a.vx;
    py += a.gm * a.vy;
    ke += 0.5 * a.gm * (a.vx * a.vx + a.vy * a.vy);
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j]!;
      const r2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 + Math.max(a.soft, b.soft) ** 2;
      pe -= (a.gm * b.gm) / Math.sqrt(r2);
    }
  }
  return { px, py, energy: ke + pe };
};

export const findBody = (u: Universe, id: number): Body | undefined =>
  u.bodies.find((b) => b.id === id);
