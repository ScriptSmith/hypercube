/**
 * The glaze as numbers, stepped by the app's fixed-step loop and drawn by `field.ts`.
 *
 * Icing glaze is a yield-stress fluid: a layer flows only while it is
 * thicker than its yield stress over the pull of gravity along the surface, so glaze stays on
 * the flat top, runs down the steep sides, and each drip runs until its head has spread itself
 * too thin, then stops. Here the cap is an edge latitude for every longitude, and each drip is a
 * record: a meridian, a stem from the cap's edge down to a tip, and a bead at the tip whose
 * volume drives it. The bead moves at a speed that grows with the square of how far its weight
 * exceeds the yield stress, loses volume to the stem it leaves behind (a film about as thick as
 * the yield stress allows), and gains what still flows down from the cap. So it slows smoothly
 * and stops by itself. Under the overhang a heavy bead stretches and lets go of a drop, and the
 * long drips that reach the bottom pole feed one hanging drop there that grows and falls.
 *
 * The warm pudding softens old glaze: set drips sag, thin, clear and fade to a sheen, then their
 * record is freed. Pours come every few minutes and push the cap's edge down; between them it
 * drifts back up. Everything is a fixed pool, so a day looks like the first hour.
 *
 * Latitudes and longitudes are radians in the pudding's own frame, which turns about the
 * vertical when `turn` is on; `yaw` turns it into the room's.
 */
import type { Rng } from "../../core/types";

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

export type Pace = "slow" | "lively";
/** How the glaze behaves: a smooth cap alone, drips already set, drips that run and stop, or
 * drips that run, hang and let drops go. */
export type DripMode = "none" | "set" | "runs" | "drops";
export type GlazeKind = "icing" | "custard" | "ganache" | "pink" | "mirror" | "chocolate";
export type Phase = "run" | "pool" | "set" | "soften" | "fade" | "dry";

export const MAX_DRIPS = 64;
export const MAX_DROPS = 6;
/** Samples of the cap's edge round the pudding. */
export const EDGE_N = 128;
/** The cap's edge stays between these latitudes. */
export const EDGE_HIGH = 30 * DEG;
export const EDGE_LOW = 10 * DEG;
/** One slow turn about the vertical, seconds. */
export const TURN_SECONDS = 360;
/** The fastest a tip ever crawls, radians a second: 2.4 cm/s on a 4 m ball. */
export const MAX_SPEED = 0.012;
/** Below this a tip counts as still, radians a second (0.6 mm/s on that ball). */
export const SET_SPEED = 0.0003;
/** A tip faster than this is plainly moving to someone watching (1.6 mm/s on that ball). */
export const SEEN_SPEED = 0.0008;
/** Drops let go only below this latitude, under the overhang. */
export const DROP_FROM = -8 * DEG;
/** Room sectors that must each see a moving drip often. */
export const SECTORS = 6;

/** Tip speed, radians a second, for a unit of excess stress (it goes as the square). */
const SPEED_K = 0.0245;
/** Volume a tip leaves in its stem per radian travelled, for a reference width and yield. */
const DEPOSIT = 15;
const WIDTH_REF = 0.045;
const FEED_MIN = 0.002;
/** How far the stem reaches into the cap, so the two always join. */
export const TOP_OVERLAP = 0.06;
const NECK_SECONDS = 2.2;
const POOL_NECK_SECONDS = 1.8;
/** Bottom drop volume at which it lets go, and the least time it takes to grow again. */
export const POOL_FALL = 2.4;
export const POOL_GROW = 50;
/** Most the stems can carry into the bottom drop, volume a second. */
const POOL_INFLOW = 0.022;
/** Seconds a drop takes to leave once it lets go. */
export const DROP_LIFE = 0.45;
const WAVE_FROM = 75 * DEG;
const MIN_SEPARATION = 0.09;
const LONGEST_RUN = 600;
/** Drips that reach this close to the bottom pole run into the drop there. */
const POOL_CATCH = 16 * DEG;
/** Largest bead, in volume, when no drops let go. */
const BEAD_MOST = 1.2;

interface PaceSpec {
  pour: readonly [number, number];
  /** Time scale of running glaze. */
  speed: number;
  /** Scale of how long set glaze lasts. */
  life: number;
  breakout: readonly [number, number];
  wave: number;
}

const PACES: Record<Pace, PaceSpec> = {
  slow: { pour: [180, 360], speed: 1, life: 1, breakout: [25, 45], wave: 40 },
  lively: { pour: [60, 120], speed: 2, life: 0.45, breakout: [12, 22], wave: 22 },
};

interface KindSpec {
  /** Yield stress against the pull of a unit bead on a vertical side. */
  yield: number;
  width: number;
  thick: number;
}

const KINDS: Record<GlazeKind, KindSpec> = {
  icing: { yield: 0.55, width: 1, thick: 1 },
  // Custard is runnier: a lower yield stress gives longer, thinner drips.
  custard: { yield: 0.4, width: 0.85, thick: 0.8 },
  // Ganache poured warm runs further and thinner than icing.
  ganache: { yield: 0.45, width: 0.9, thick: 0.9 },
  pink: { yield: 0.55, width: 1, thick: 1 },
  // Mirror glaze is the runniest, a thin coat.
  mirror: { yield: 0.42, width: 0.85, thick: 0.85 },
  // Melted chocolate runs much like ganache and lies a little thicker.
  chocolate: { yield: 0.45, width: 0.9, thick: 0.95 },
};

export interface Drip {
  /** Serial number, never reused. */
  id: number;
  lon: number;
  /** Stem half-width at the top and at the tip, radians. */
  w0: number;
  w1: number;
  /** Latitude of the stem's end. */
  tip: number;
  /** Volume of the bead at the tip. */
  bead: number;
  /** Glaze still flowing down the stem into the bead, volume a second. */
  feed: number;
  feedTau: number;
  /** Tip speed, radians a second. */
  v: number;
  /** Fed for long enough to reach the bottom, or near it. */
  long: boolean;
  phase: Phase;
  /** Seconds in this phase. */
  t: number;
  hold: number;
  soften: number;
  fade: number;
  dry: number;
  /** How far a softening drip creeps down, radians. */
  sag: number;
  /** Stretching towards letting go a drop, 0 to 1. */
  neck: number;
  /** Recoil of the tip after a drop goes, radians, and its rate. */
  spring: number;
  springV: number;
  /** Speeds up the later phases when its slot is needed. */
  hurry: number;
  born: number;
  drops: number;
}

export interface Drop {
  lat: number;
  lon: number;
  r: number;
  age: number;
  /** True for the bottom drop. */
  bottom: boolean;
}

export interface Pool {
  /** Glaze gathered at the bottom pole. */
  vol: number;
  neck: number;
  fresh: number;
  falls: number;
  /** Seconds since glaze last ran in. */
  dryFor: number;
  /** When it last let go. */
  fellAt: number;
  /** The volume at which it lets go this time. */
  need: number;
}

export interface DripShape {
  lon: number;
  top: number;
  tip: number;
  w0: number;
  w1: number;
  /** Bead centre latitude, half-width across and along the meridian. */
  beadLat: number;
  rb: number;
  rbAlong: number;
  /** Half-width of the thread to a bead that is letting go. */
  wn: number;
  /** Thickness of the stem and the top of the bead. */
  hs: number;
  hb: number;
  fresh: number;
  sheen: number;
}

export interface GlazeOptions {
  pace: Pace;
  kind: GlazeKind;
  turn: boolean;
  /** Default `none`, a still cap. */
  drips?: DripMode;
  /** Seconds run before the show starts, so the ball opens with glaze under way. */
  prewarm?: number;
}

export interface Glaze {
  readonly mode: DripMode;
  /** False when nothing but the turn ever changes (`none` and `set`). */
  readonly moving: boolean;
  readonly time: number;
  readonly yaw: number;
  readonly drips: readonly Drip[];
  readonly drops: readonly Drop[];
  readonly pool: Pool;
  /** The cap's edge latitude per sample, its lowest recent latitude, and its ridge. */
  readonly edge: Float32Array;
  readonly low: Float32Array;
  readonly ridge: Float32Array;
  /** Freshness of the cap's glaze, 0 to 1. */
  readonly capFresh: number;
  /** The latitude of a pour's wave on its way down the cap and its strength, or 0. */
  readonly wave: { lat: number; amount: number };
  readonly pours: number;
  readonly nextPour: number;
  /** Drops that have let go, the bottom drop's included. */
  readonly released: number;
  /** When each room sector last had a moving drip. */
  readonly seen: Float32Array;
  /** The cap's edge at a longitude, by linear interpolation. */
  edgeAt(lon: number): number;
  shape(d: Drip): DripShape;
  /** The puddle round the bottom pole and the drop hanging from it, radians, and its stretch. */
  bottom(): { radius: number; drop: number; neck: number };
  /** Start a pour now, unless one has only just started. */
  pour(): boolean;
  step(dt: number): void;
}

/** How thick a glaze lies, against icing's 1. */
export const glazeThickness = (k: GlazeKind): number => KINDS[k].thick;

export const wrapLon = (lon: number): number => {
  const w = (((lon + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI;
  return w - Math.PI;
};

const smooth = (u: number): number => {
  const a = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return a * a * (3 - 2 * a);
};
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * How hard gravity drives glaze along the surface at a latitude: the slope's sine above the
 * equator; under the overhang a hanging bead keeps creeping towards the bottom, as rivulets
 * drain to the lowest point under a curved surface.
 */
export const drive = (lat: number): number =>
  lat >= 0 ? Math.cos(lat) : 1 - 0.35 * (1 - Math.cos(lat));

/** Bead volume above which a hanging bead lets go, at a latitude under the overhang. */
export const pinchVolume = (lat: number): number => 1.25 / Math.max(0.3, -Math.sin(lat));

export const createGlaze = (rng: Rng, opts: GlazeOptions): Glaze => {
  const pace = PACES[opts.pace];
  const kind = KINDS[opts.kind];
  const mode: DripMode = opts.drips ?? "none";
  const moving = mode === "runs" || mode === "drops";
  const dropping = mode === "drops";
  const drips: Drip[] = [];
  const drops: Drop[] = [];
  const pool: Pool = {
    vol: 0,
    neck: 0,
    fresh: 1,
    falls: 0,
    dryFor: 1e9,
    fellAt: -1e9,
    need: POOL_FALL,
  };
  let inflowLeft = 0;
  const edge = new Float32Array(EDGE_N);
  const target = new Float32Array(EDGE_N);
  const low = new Float32Array(EDGE_N);
  const ridge = new Float32Array(EDGE_N);
  const seen = new Float32Array(SECTORS);
  let time = 0;
  let serial = 0;
  let pours = 0;
  let released = 0;
  let capFresh = 1;
  let capAge = 0;
  let nextPour = 0;
  let pourAt = -1e9;
  let arrived = true;
  let nextBreak = 0;
  let lastUrgent = -1e9;
  const wave = { lat: 0, amount: 0 };
  const pending: { at: number; lon: number; long: boolean }[] = [];

  const yawAt = (t: number) => (opts.turn ? (TWO_PI * t) / TURN_SECONDS : 0);
  let yaw = 0;

  // A smooth, uneven edge to start: about 20° with a gentle wander.
  const wobble = (amp: number) => {
    const terms = [1, 2, 3, 5].map((k) => ({
      k,
      a: rng.range(0.4, 1) / k,
      p: rng.range(0, TWO_PI),
    }));
    const norm = terms.reduce((s, x) => s + x.a, 0);
    return (i: number) => {
      const th = (i / EDGE_N) * TWO_PI;
      return (amp * terms.reduce((s, x) => s + x.a * Math.sin(x.k * th + x.p), 0)) / norm;
    };
  };
  {
    const w = wobble(4 * DEG);
    for (let i = 0; i < EDGE_N; i++) {
      edge[i] = clamp(20 * DEG + w(i), EDGE_LOW, EDGE_HIGH);
      target[i] = edge[i]!;
      low[i] = edge[i]!;
    }
  }

  const edgeAt = (lon: number): number => {
    const x = ((wrapLon(lon) + Math.PI) / TWO_PI) * EDGE_N;
    const i = Math.floor(x);
    const f = x - i;
    const a = edge[((i % EDGE_N) + EDGE_N) % EDGE_N]!;
    const b = edge[(i + 1) % EDGE_N]!;
    return a + (b - a) * f;
  };

  const angleTo = (a: number, b: number) => Math.abs(wrapLon(a - b));

  const running = (d: Drip) => d.phase === "run" || d.phase === "pool";

  /** Make room for a new drip by hurrying the most worn one on its way. */
  const hurryOne = () => {
    let best: Drip | null = null;
    let score = -1;
    for (const d of drips) {
      if (d.hurry > 1) continue;
      const rank =
        d.phase === "dry"
          ? 3
          : d.phase === "fade"
            ? 2
            : d.phase === "soften"
              ? 1
              : d.phase === "set"
                ? 0.5
                : -1;
      if (rank < 0) continue;
      const s = rank + d.t / Math.max(1, d.soften);
      if (s > score) {
        score = s;
        best = d;
      }
    }
    if (best) best.hurry = 8;
  };

  const spawn = (lonIn: number, longAsked: boolean): boolean => {
    const long = longAsked && dropping;
    let lon = wrapLon(lonIn);
    for (const d of drips) {
      if (running(d) && angleTo(d.lon, lon) < MIN_SEPARATION) {
        lon = wrapLon(d.lon + (wrapLon(lon - d.lon) >= 0 ? 1 : -1) * MIN_SEPARATION * 1.2);
      }
    }
    if (drips.length >= MAX_DRIPS) {
      hurryOne();
      return false;
    }
    const w0 = rng.range(0.03, 0.058) * kind.width * (long ? 1.15 : 1);
    const life = pace.life;
    drips.push({
      id: serial++,
      lon,
      w0,
      w1: w0 * rng.range(0.7, 0.92),
      tip: edgeAt(lon) - 0.012,
      bead: long ? rng.range(1.6, 2.2) : rng.range(0.55, 1.35),
      feed: long ? rng.range(0.035, 0.09) : rng.range(0.002, 0.03),
      feedTau: long ? rng.range(120, 220) : rng.range(25, 60),
      v: 0,
      long,
      phase: "run",
      t: 0,
      hold: rng.range(40, 100) * life,
      soften: rng.range(240, 420) * life,
      fade: rng.range(60, 90) * life,
      dry: rng.range(60, 120) * life,
      sag: rng.range(0.008, 0.03),
      neck: 0,
      spring: 0,
      springV: 0,
      hurry: 1,
      born: time,
      drops: 0,
    });
    return true;
  };

  const startPour = (): boolean => {
    if (!moving || time - pourAt < pace.wave + 5) return false;
    pourAt = time;
    arrived = false;
    pours++;
    nextPour = time + rng.range(pace.pour[0], pace.pour[1]);
    return true;
  };

  /** The wave reaches the edge: the ridge thickens, advances, and breaks into drips. */
  const arrive = () => {
    arrived = true;
    capFresh = 1;
    capAge = 0;
    const adv = wobble(1.6 * DEG);
    for (let i = 0; i < EDGE_N; i++) {
      // A high edge takes more of a pour, so the edge keeps to its band over the hours.
      const e = edge[i]!;
      target[i] = Math.max(EDGE_LOW, e - (2.5 * DEG + 0.3 * (e - EDGE_LOW) + adv(i)));
      ridge[i] = 1;
    }
    const n = 8 + rng.int(5);
    const base = rng.range(0, TWO_PI);
    const longs = new Set([0, Math.round(n / 3), Math.round((2 * n) / 3)].slice(0, 2 + rng.int(2)));
    const shift = rng.int(n);
    for (let k = 0; k < n && pending.length < 24; k++) {
      let lon = wrapLon(base + ((k + rng.range(-0.35, 0.35)) * TWO_PI) / n);
      // Fresh glaze often finds an old drip's path and runs down it again.
      if (rng.next() < 0.5) {
        for (const d of drips) {
          if (!running(d) && angleTo(d.lon, lon) < 0.12) {
            lon = d.lon;
            break;
          }
        }
      }
      pending.push({
        at: time + rng.range(0, 45) / pace.speed,
        lon,
        long: longs.has((k + shift) % n),
      });
    }
  };

  const sectorOf = (roomLon: number) =>
    Math.min(SECTORS - 1, Math.floor(((wrapLon(roomLon) + Math.PI) / TWO_PI) * SECTORS));

  const breakoutIn = (sector: number) => {
    const roomLon = -Math.PI + ((sector + rng.range(0.15, 0.85)) * TWO_PI) / SECTORS;
    if (spawn(roomLon - yaw, rng.next() < 0.2)) {
      seen[sector] = time;
      return true;
    }
    return false;
  };

  const stepEdge = (dt: number) => {
    const rise = (1.33 * DEG * pace.speed * dt) / 60;
    const move = 0.25 * DEG * pace.speed * dt;
    const k = 1 - Math.exp(-dt / 180);
    const kr = Math.exp(-dt / 60);
    for (let i = 0; i < EDGE_N; i++) {
      target[i] = Math.min(EDGE_HIGH, target[i]! + rise);
      const e = edge[i]!;
      const t = target[i]!;
      edge[i] = e + clamp(t - e, -move, move);
      low[i] = Math.min(low[i]!, edge[i]!);
      low[i] = low[i]! + (edge[i]! - low[i]!) * k;
      ridge[i] = ridge[i]! * kr;
    }
  };

  const release = (d: Drip, lat: number, r: number) => {
    if (drops.length >= MAX_DROPS) drops.shift();
    drops.push({ lat, lon: d.lon, r, age: 0, bottom: false });
    released++;
    d.drops++;
  };

  const stepRun = (d: Drip, dt: number) => {
    const dtr = dt * pace.speed;
    const g = drive(d.tip);
    if (d.phase === "pool") {
      // Near the bottom: the tip creeps in to the drop gathering there, then runs into it.
      const edgeLat = -Math.PI / 2 + poolRadius() + 0.5 * d.w1;
      if (d.tip > edgeLat + 1e-4) {
        d.v = 0.004 * pace.speed;
        d.tip = Math.max(edgeLat, d.tip - d.v * dt);
        d.bead += d.feed * dtr;
        d.feed *= Math.exp(-dtr / d.feedTau);
        return;
      }
      // A stem carries only so much, so the drop grows at a steady pace however many feed it.
      d.bead += d.feed * dtr;
      const flow = Math.min(d.bead * (1 - Math.exp(-dtr / 3)), Math.max(0, inflowLeft));
      d.bead -= flow;
      inflowLeft -= flow;
      pool.vol += flow;
      pool.dryFor = 0;
      pool.fresh = 1;
      d.feed *= Math.exp(-dtr / d.feedTau);
      d.v = 0;
      d.tip = edgeLat;
      if (d.feed < FEED_MIN && d.bead < 0.12) toPhase(d, "set");
      else if (d.t > LONGEST_RUN * 2) toPhase(d, "set");
      return;
    }
    if (d.neck > 0) {
      d.neck += dtr / NECK_SECONDS;
      d.bead += d.feed * dtr;
      d.feed *= Math.exp(-dtr / d.feedTau);
      if (d.neck >= 1) {
        // The drop leaves from where the bead hung, at its size; the tip springs back up.
        const g = beadGeometry(d, 1);
        release(d, g.lat, g.across);
        d.bead *= 0.4;
        d.neck = 0;
        d.spring = -0.3 * g.stretch;
        d.springV = 0;
      }
      return;
    }
    const s = Math.cbrt(Math.max(d.bead, 0));
    // Without drops, glaze stiffens as it reaches the equator, so drips stop there or above and
    // never hang under the overhang.
    const stiff = dropping ? 1 : 1 + 2.5 * smooth((0.1 - d.tip) / 0.28);
    const excess = g * s - kind.yield * stiff;
    // A new drip grows out of the ridge over its first seconds rather than setting off at once.
    const start = smooth((d.t * pace.speed) / 8);
    d.v = Math.min(MAX_SPEED, SPEED_K * Math.max(0, excess) ** 2) * pace.speed * start;
    const dist = d.v * dt;
    d.tip -= dist;
    // The stem keeps a film about as thick as the yield stress holds on the slope.
    const holds = d.tip >= 0 ? Math.max(Math.cos(d.tip), 0.3) : 1;
    const residue = (kind.yield / holds) * (d.w1 / WIDTH_REF);
    d.bead = Math.max(0.05, d.bead + d.feed * dtr - dist * DEPOSIT * residue);
    if (!dropping) d.bead = Math.min(d.bead, BEAD_MOST);
    d.feed *= Math.exp(-dtr / d.feedTau);
    if (!dropping) {
      if ((d.v < SET_SPEED && d.feed < FEED_MIN) || d.t > LONGEST_RUN) toPhase(d, "set");
      return;
    }
    if (d.tip < DROP_FROM && d.bead > pinchVolume(d.tip)) d.neck = 1e-3;
    if (d.tip <= -Math.PI / 2 + POOL_CATCH) {
      d.phase = "pool";
      d.t = 0;
      return;
    }
    if ((d.v < SET_SPEED && d.feed < FEED_MIN) || d.t > LONGEST_RUN) toPhase(d, "set");
  };

  const toPhase = (d: Drip, p: Phase) => {
    d.phase = p;
    d.t = 0;
    if (p !== "run" && p !== "pool") {
      d.v = 0;
      d.feed = 0;
    }
  };

  const stepAging = (d: Drip, dt: number) => {
    const h = dt * d.hurry;
    if (d.phase === "set") {
      d.t += h;
      if (d.t >= d.hold) toPhase(d, "soften");
    } else if (d.phase === "soften") {
      d.t += h;
      if (d.t >= d.soften) toPhase(d, "fade");
    } else if (d.phase === "fade") {
      d.t += h;
      if (d.t >= d.fade) toPhase(d, "dry");
    } else if (d.phase === "dry") {
      d.t += h;
    }
  };

  const springStep = (d: Drip, dt: number) => {
    if (d.spring === 0 && d.springV === 0) return;
    // Underdamped, a little over a second to settle.
    const w = TWO_PI / 0.9;
    const z = 0.35;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      d.springV += (-w * w * d.spring - 2 * z * w * d.springV) * h;
      d.spring += d.springV * h;
    }
    if (Math.abs(d.spring) < 1e-5 && Math.abs(d.springV) < 1e-4) {
      d.spring = 0;
      d.springV = 0;
    }
  };

  const poolRadius = () => 0.06 + 0.04 * Math.sqrt(Math.min(pool.vol, 4));

  const stepPool = (dt: number) => {
    pool.dryFor += dt;
    if (pool.dryFor > 20) pool.fresh = Math.max(0.2, pool.fresh - dt / 400);
    // Softening into the warm pudding.
    pool.vol *= Math.exp(-(dt * pace.speed) / 600);
    if (pool.neck > 0) {
      pool.neck += (dt * pace.speed) / POOL_NECK_SECONDS;
      if (pool.neck >= 1) {
        if (drops.length >= MAX_DROPS) drops.shift();
        drops.push({ lat: -Math.PI / 2, lon: 0, r: bottomDropRadius(), age: 0, bottom: true });
        released++;
        pool.falls++;
        pool.vol *= 0.25;
        pool.neck = 0;
        pool.fellAt = time;
        pool.need = POOL_FALL * rng.range(0.8, 1.2);
      }
    } else if (pool.vol > pool.need && time - pool.fellAt > POOL_GROW) {
      pool.neck = 1e-3;
    }
  };

  const bottomDropRadius = () => 0.03 + 0.055 * Math.cbrt(Math.min(pool.vol / POOL_FALL, 1.3));

  const beadRadius = (d: Drip, s: number) => d.w1 * clamp(1.15 + 0.4 * (s - 1), 1.05, 1.9);
  /** A bead's size; only drips that let drops go swell much past their stem. */
  const beadSize = (d: Drip) => {
    const s = Math.cbrt(Math.max(d.bead, 0.05));
    return dropping ? s : Math.min(s, 1.05);
  };

  /**
   * Where the bead hangs and its half-widths across and along the meridian: a heavy bead under
   * the overhang hangs longer, and while it lets go it sinks below the tip on a thinning thread.
   */
  const beadGeometry = (d: Drip, spread: number, tip = d.tip) => {
    const s = beadSize(d);
    const rb = beadRadius(d, s) * spread;
    const hang = dropping ? smooth(-tip / 0.7) * clamp(s - 0.6, 0, 1) : 0;
    const n = d.neck > 0 ? smooth(d.neck) : 0;
    // Slow at first, then quickly, as a neck thins before it breaks.
    const stretch = 2.3 * rb * n ** 1.6;
    const across = rb * (1 - 0.12 * n);
    return {
      lat: tip - 0.4 * rb - stretch + d.spring,
      across,
      along: rb * (1 + 0.5 * hang) + 0.25 * stretch,
      stretch,
      hang,
      thread: d.neck > 0 ? d.w1 * (0.8 - 0.62 * n) : 0,
    };
  };

  const step = (dt: number) => {
    time += dt;
    yaw = yawAt(time);
    // A still cap, with or without set drips: only the turn goes on.
    if (!moving) return;
    capAge += dt;
    capFresh = 0.45 + 0.55 * Math.exp(-capAge / (300 * pace.life));
    if (time >= nextPour) startPour();
    const since = time - pourAt;
    if (!arrived) {
      const meanEdge = 20 * DEG;
      const u = clamp(since / pace.wave, 0, 1);
      wave.lat = WAVE_FROM - (WAVE_FROM - meanEdge) * (1 - (1 - u) * (1 - u));
      wave.amount = smooth(since / 4);
      if (since >= pace.wave) arrive();
    } else {
      wave.amount = Math.max(0, wave.amount - dt / 6);
    }
    stepEdge(dt);

    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i]!;
      if (time >= p.at && spawn(p.lon, p.long)) pending.splice(i, 1);
      else if (time >= p.at + 120) pending.splice(i, 1);
    }

    inflowLeft = POOL_INFLOW * dt * pace.speed;
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i]!;
      if (running(d)) {
        d.t += dt;
        stepRun(d, dt);
        if (d.v > SEEN_SPEED) seen[sectorOf(d.lon + yaw)] = time;
      } else {
        stepAging(d, dt);
      }
      springStep(d, dt);
      if (d.phase === "dry" && d.t >= d.dry) drips.splice(i, 1);
    }

    stepPool(dt);
    for (let i = drops.length - 1; i >= 0; i--) {
      drops[i]!.age += dt;
      if (drops[i]!.age >= DROP_LIFE) drops.splice(i, 1);
    }

    // Breakouts between pours, where nobody has seen a drip move for a while.
    let stale = 0;
    for (let k = 1; k < SECTORS; k++) if (seen[k]! < seen[stale]!) stale = k;
    const waited = time - seen[stale]!;
    if (time >= nextBreak) {
      nextBreak = time + rng.range(pace.breakout[0], pace.breakout[1]);
      if (waited > 25 / pace.speed) breakoutIn(stale);
    } else if (waited > 70 && time - lastUrgent > 5) {
      lastUrgent = time;
      breakoutIn(stale);
    }
  };

  /** Drips already set down the sides, as on a drip cake: mostly short, all well above the equator. */
  const setDrips = () => {
    const n = 18 + rng.int(7);
    const base = rng.range(0, TWO_PI);
    const runny = 0.55 / kind.yield;
    for (let k = 0; k < n; k++) {
      const lon = wrapLon(base + ((k + rng.range(-0.3, 0.3)) * TWO_PI) / n);
      const w0 = rng.range(0.028, 0.05) * kind.width;
      const length = (rng.next() < 0.7 ? rng.range(3, 11) : rng.range(11, 19)) * DEG * runny;
      drips.push({
        id: serial++,
        lon,
        w0,
        w1: w0 * rng.range(0.75, 0.92),
        tip: Math.max(edgeAt(lon) - 0.02 - length, 3 * DEG),
        bead: rng.range(0.55, 1),
        feed: 0,
        feedTau: 1,
        v: 0,
        long: false,
        phase: "set",
        t: 0,
        hold: Infinity,
        soften: Infinity,
        fade: Infinity,
        dry: Infinity,
        sag: 0,
        neck: 0,
        spring: 0,
        springV: 0,
        hurry: 1,
        born: 0,
        drops: 0,
      });
    }
  };

  // Start with a pour, and the next timed to arrive just before the show begins.
  const prewarm = moving ? Math.max(0, opts.prewarm ?? 0) : 0;
  nextPour = moving ? 0 : Infinity;
  if (mode === "set") setDrips();
  if (prewarm > 0) {
    for (let k = 0; k < SECTORS; k++) seen[k] = 0;
    const h = 0.05;
    let left = prewarm;
    let timed = false;
    while (left > 1e-9) {
      const dt = Math.min(h, left);
      step(dt);
      left -= dt;
      if (!timed && pours > 0) {
        timed = true;
        nextPour = Math.max(time + 60, prewarm - pace.wave - 20);
      }
    }
  }

  return {
    mode,
    moving,
    get time() {
      return time;
    },
    get yaw() {
      return yaw;
    },
    drips,
    drops,
    pool,
    edge,
    low,
    ridge,
    get capFresh() {
      return capFresh;
    },
    wave,
    get pours() {
      return pours;
    },
    get nextPour() {
      return nextPour;
    },
    get released() {
      return released;
    },
    seen,
    edgeAt,
    shape(d) {
      const s = beadSize(d);
      let fresh = 1;
      let thick = 1;
      let sheen = 1;
      let spread = 1;
      let sag = 0;
      let flat = 0;
      if (d.phase === "soften") {
        const u = smooth(d.t / d.soften);
        fresh = 1 - 0.85 * u;
        thick = 1 - 0.55 * u;
        spread = 1 + 0.25 * u;
        sag = d.sag * u;
        flat = u;
      } else if (d.phase === "fade" || d.phase === "dry") {
        const u = d.phase === "fade" ? clamp(d.t / d.fade, 0, 1) : 1;
        fresh = 0.15 - 0.1 * u;
        thick = 0.45 * (1 - smooth(u));
        spread = 1.25;
        sag = d.sag;
        flat = 1;
        if (d.phase === "dry") sheen = 1 - smooth(d.t / d.dry);
      }
      const tip = d.tip - sag;
      const b = beadGeometry(d, spread, tip);
      const hs = thick * kind.thick;
      // A drip just breaking out of the ridge is a bulge first, its bead growing as it goes.
      const grow = d.phase === "run" ? smooth((d.t * pace.speed) / 10) : 1;
      return {
        lon: d.lon,
        top: edgeAt(d.lon) + TOP_OVERLAP,
        tip,
        w0: d.w0 * spread,
        w1: d.w1 * spread,
        beadLat: b.lat,
        rb: b.across * (0.6 + 0.4 * grow),
        rbAlong: b.along * (0.6 + 0.4 * grow),
        wn: b.thread,
        hs,
        hb: hs * (1 + grow * (0.25 + 0.35 * (s - 1) + 0.4 * b.hang)) * (1 - 0.5 * flat),
        fresh,
        sheen,
      };
    },
    bottom: () => ({
      radius: pool.vol > 0.05 ? poolRadius() : 0,
      drop: pool.vol > 0.15 ? bottomDropRadius() : 0,
      neck: pool.neck,
    }),
    pour: startPour,
    step,
  };
};
