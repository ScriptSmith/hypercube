/**
 * A universe being shown: the bodies, the particles round them, trails, flashes, the scene and
 * the time control. The universe steps on the shared clock's step grid: each clock step adds the
 * time factor's share of a step (in quarters, so it is exact), and whole steps are taken as they
 * come, so at 4x four steps run per clock step and at a quarter one every fourth.
 *
 * Particles are stepped here, every couple of steps, from where the bodies are; they never touch
 * the bodies, so the ribbon (which copies only the bodies) still matches the flight exactly.
 */
import { shownTemp, solidRgb, tempRgb } from "./bodies";
import { COL, createDust, DEBRIS, type Dust, GAS, MAX_PULLS, type Pull, RING } from "./dust";
import {
  type Body,
  DT,
  type Event,
  findBody,
  launch as launchBody,
  type Launch,
  setSizes,
  STEP_MS,
  step,
  takeEvents,
  type Universe,
} from "./physics";
import { buildScene, SCENES, type SceneId, type Sky } from "./scenes";
import { rgbOf } from "./sprites";

/** Time factors and their quarters of a step per clock step. */
export const FACTORS = [0.25, 0.5, 1, 2, 4] as const;
const QUARTERS = [1, 2, 4, 8, 16] as const;
export const NORMAL_TIME = 2;
/** Drawn sizes ease to the new ones over this long after a switch. */
export const SIZE_EASE_MS = 1000;
/** Most clock steps one advance catches up, and most universe steps it takes. */
const MAX_CATCHUP = 90;
const MAX_STEPS = 200;
const MAX_EVENTS = 160;
const TRAIL_POINTS = 110;
const TRAIL_EVERY = 3;
export const TRAIL_FADE_MS = 1200;
const MAX_FLASHES = 6;

export interface Trail {
  id: number;
  rgb: number;
  /** Brightness: people's throws stand out, a scene's own bodies are faint. */
  alpha: number;
  width: number;
  pts: Float32Array;
  start: number;
  count: number;
  goneAt: number;
}

export interface Flash {
  at: number;
  x: number;
  y: number;
  r: number;
  rgb: number;
  /** How long it lasts, ms. */
  ms: number;
}

export interface CosmosOptions {
  sky: Sky;
  /** Start with true sizes. */
  trueSizes?: boolean;
  maxBodies: number;
  dustCap: number;
  seed: number;
  scene: number;
  clockMs: number;
  /** Particle size in display px. */
  dot: number;
}

export interface Cosmos {
  readonly u: Universe;
  readonly dust: Dust;
  readonly trails: ReadonlyMap<number, Trail>;
  readonly flashes: readonly Flash[];
  readonly sky: Sky;
  readonly sceneIndex: number;
  readonly sceneId: SceneId;
  /** Clock ms the scene started, and ui ms (for its fade in). */
  readonly sceneAt: number;
  readonly sceneShownAt: number;
  /** Slingshot speed scale for this scene. */
  readonly speed: number;
  readonly timeIndex: number;
  readonly factor: number;
  readonly quarters: number;
  readonly clockK: number;
  readonly scenes: number;
  /** Contacts and tides use true sizes; drawn sizes ease towards them over a second. */
  readonly trueSizes: boolean;
  setSizes(trueSizes: boolean, nowMs: number): void;
  /** 0 drawn sizes, 1 true sizes, easing between after a switch. */
  sizeBlend(nowMs: number): number;
  /** A body's radius as drawn now. */
  drawnRadius(b: Body, nowMs: number): number;
  /** Bring the universe up to the clock. `each` runs after every clock step (the screen's climbers). */
  advance(clockMs: number, nowMs: number, each?: (clockK: number) => void): Event[];
  /** Interpolation between the last two steps, and between the last two particle steps. */
  alpha(clockMs: number): number;
  dustAlpha(clockMs: number): number;
  setScene(index: number, clockMs: number, nowMs: number): void;
  setTime(index: number): void;
  launch(l: Launch): Body;
  /** Mass of the black hole a launcher fires: a share of the heaviest body. */
  holeMass(): number;
  /** Whether the scene has burnt out (little left in view). */
  burnt(): boolean;
  clearEffects(): void;
}

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

/** Colour of a body for trails and particles. */
export const bodyRgb = (b: Pick<Body, "kind" | "m" | "look">): number => {
  if (b.kind === "star") return tempRgb(shownTemp(b.m));
  if (b.kind === "hole") return 0xffb070;
  return solidRgb(b.kind, b.look);
};

const dustColOf = (kind: Body["kind"], look: number) =>
  kind === "rock"
    ? COL.rock + (look % 3)
    : kind === "planet"
      ? COL.planet + (look % 5)
      : kind === "giant"
        ? COL.giant + (look % 4)
        : COL.belt;

export const createCosmos = (o: CosmosOptions): Cosmos => {
  const dust = createDust(o.dustCap);
  const keep = Math.round(o.dustCap * 0.62);
  const cap = o.dustCap / 3000;
  const fx = mulberry(o.seed ^ 0xf00d);
  const trails = new Map<number, Trail>();
  const flashes: Flash[] = [];
  const out: Event[] = [];
  let sceneIndex = ((o.scene % SCENES.length) + SCENES.length) % SCENES.length;
  let scenes = 0;
  let sceneAt = o.clockMs;
  let sceneShownAt = -Infinity;
  let timeIndex = NORMAL_TIME;
  let quarters = 0;
  let clockK = Math.floor(o.clockMs / STEP_MS);
  let sinceDust = 0;
  let dustEvery = 2;
  let u!: Universe;
  let trueSizes = o.trueSizes ?? false;
  let blendFrom = trueSizes ? 1 : 0;
  let blendAt = -Infinity;
  let speed = 1;
  let gm0 = 1;
  const pulls: Pull[] = Array.from({ length: MAX_PULLS }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    gm: 0,
    eps2: 0,
    absorb: 0,
    disc: 0,
  }));
  const pullIds = new Int32Array(MAX_PULLS);
  const order: Body[] = [];
  const seen = new Set<number>();
  let nPulls = 0;
  const v = o.sky.view;
  const bounds = {
    x0: v.x0 - (v.x1 - v.x0) * 0.5,
    y0: v.y0 - (v.y1 - v.y0) * 0.5,
    x1: v.x1 + (v.x1 - v.x0) * 0.5,
    y1: v.y1 + (v.y1 - v.y0) * 0.5,
  };

  const build = (k: number) => {
    dust.clear(true);
    trails.clear();
    const s = buildScene(SCENES[sceneIndex]!, {
      sky: o.sky,
      k,
      seed: (o.seed + scenes * 7919) >>> 0,
      maxBodies: o.maxBodies,
      dust,
      keep,
      dot: o.dot,
      trueSizes,
    });
    scenes++;
    u = s.universe;
    speed = s.speed;
    gm0 = s.gm0;
  };
  build(clockK);

  const flash = (f: Omit<Flash, "at">, now: number) => {
    if (flashes.length >= MAX_FLASHES) flashes.shift();
    flashes.push({ ...f, at: now });
  };

  // ---- Effects --------------------------------------------------------------------------------

  const n = (x: number) => Math.max(2, Math.round(x * Math.max(0.35, cap)));
  const dir = () => fx() * Math.PI * 2;

  const effect = (e: Event, now: number) => {
    switch (e.type) {
      case "merge": {
        const count = n(10 + 70 * e.heat);
        const col = dustColOf(e.small, e.smallLook);
        for (let i = 0; i < count; i++) {
          // A splash out of the surface, in a cone round the normal.
          const a = Math.atan2(e.ny, e.nx) + (fx() - 0.5) * 2.4;
          const s = e.vesc * (0.25 + fx() * 1.05);
          dust.spawn(
            DEBRIS,
            e.x,
            e.y,
            e.vx + Math.cos(a) * s,
            e.vy + Math.sin(a) * s,
            6 + fx() * 8,
            col,
            o.dot * (0.8 + fx() * 0.8),
            0.6 + fx() * 0.4,
          );
        }
        break;
      }
      case "shatter": {
        const count = n(70 + fx() * 60);
        const col = dustColOf(e.kind, e.look);
        for (let i = 0; i < count; i++) {
          const a = dir();
          const s = e.vesc * (0.15 + fx() * 1.1);
          const d = e.r * Math.sqrt(fx());
          dust.spawn(
            DEBRIS,
            e.x + Math.cos(a) * d,
            e.y + Math.sin(a) * d,
            e.vx + Math.cos(a) * s,
            e.vy + Math.sin(a) * s,
            8 + fx() * 10,
            col,
            o.dot * (0.8 + fx() * 0.9),
            1,
          );
        }
        flash({ x: e.x, y: e.y, r: e.r * 3, rgb: 0xffc890, ms: 700 }, now);
        break;
      }
      case "swallow": {
        const into = findBody(u, e.into);
        if (!into) break;
        if (e.by === "star") {
          const count = n(18 + Math.min(60, 300 * Math.sqrt(e.m / into.m)));
          const vesc = Math.sqrt((2 * into.gm) / into.re);
          const base = Math.atan2(e.y - into.y, e.x - into.x);
          for (let i = 0; i < count; i++) {
            const a = base + (fx() - 0.5) * 2;
            const s = vesc * (0.2 + fx() * 0.5);
            dust.spawn(
              GAS,
              into.x + Math.cos(a) * into.re,
              into.y + Math.sin(a) * into.re,
              into.vx + Math.cos(a) * s,
              into.vy + Math.sin(a) * s,
              1.2 + fx() * 2,
              0,
              o.dot * (2 + fx() * 2),
              0.75 + fx() * 0.25,
            );
          }
        } else {
          flash({ x: e.x, y: e.y, r: into.re * 4, rgb: 0xffb878, ms: 600 }, now);
        }
        break;
      }
      case "shred": {
        // A stream along the orbit that spreads into a ring (or, round a black hole, a hot disc).
        const count = n(
          e.kind === "rock" ? 70 : e.kind === "planet" ? 140 : e.kind === "giant" ? 220 : 320,
        );
        const toHole = e.pkind === "hole";
        const rvx = e.vx - e.pvx;
        const rvy = e.vy - e.pvy;
        const rv = Math.hypot(rvx, rvy) || 1;
        const tx = rvx / rv;
        const ty = rvy / rv;
        const col = e.kind === "star" ? 0 : dustColOf(e.kind, e.look);
        for (let i = 0; i < count; i++) {
          const along = (fx() - 0.5) * 2;
          // A body far smaller than a pixel still sheds a stream wide enough to see.
          const er = Math.max(e.r, o.dot * 2);
          const ox = tx * along * er * 1.6 + (fx() - 0.5) * er;
          const oy = ty * along * er * 1.6 + (fx() - 0.5) * er;
          // Inner parts run ahead, outer parts lag: the stream shears along the orbit.
          const dv = 1 + along * 0.06 + (fx() - 0.5) * 0.03;
          dust.spawn(
            toHole ? GAS : RING,
            e.x + ox,
            e.y + oy,
            e.pvx + rvx * dv + (fx() - 0.5) * rv * 0.02,
            e.pvy + rvy * dv + (fx() - 0.5) * rv * 0.02,
            toHole ? 25 + fx() * 25 : 150 + fx() * 70,
            col,
            o.dot * (toHole ? 1.6 + fx() * 1.4 : 0.8 + fx() * 0.7),
            toHole ? 0.9 : 0.35,
          );
        }
        break;
      }
      case "collapse": {
        flash({ x: e.x, y: e.y, r: e.r * 14, rgb: 0xdfe8ff, ms: 2600 }, now);
        // The blown-off shell: fast at first, slowing as it sweeps up the thin gas round it,
        // so it spreads to about a sky's width and fades from blue-white to red.
        const count = n(520);
        const SHELL_DRAG = 0.45;
        for (let i = 0; i < count; i++) {
          const a = dir();
          const reach = o.sky.L * (0.45 + fx() * 0.8);
          const s = reach * SHELL_DRAG;
          dust.spawn(
            GAS,
            e.x + Math.cos(a) * e.r,
            e.y + Math.sin(a) * e.r,
            e.vx + Math.cos(a) * s,
            e.vy + Math.sin(a) * s,
            8 + fx() * 6,
            COL.galaxyGas,
            o.dot * (2.5 + fx() * 2.5),
            1,
            SHELL_DRAG,
          );
        }
        break;
      }
      case "ignite":
        flash({ x: e.x, y: e.y, r: e.r * 6, rgb: 0xffd8a0, ms: 1600 }, now);
        break;
      case "gone":
        break;
    }
  };

  // ---- Particles ------------------------------------------------------------------------------

  const preparePulls = () => {
    const bs = u.bodies;
    let max = 0;
    for (const b of bs) if (b.gm > max) max = b.gm;
    nPulls = 0;
    const floor = max * 2e-4;
    // Heaviest first, at most MAX_PULLS.
    order.length = 0;
    for (const b of bs) if (b.gm >= floor) order.push(b);
    order.sort((a, b) => b.gm - a.gm);
    for (const b of order) {
      if (nPulls >= MAX_PULLS) break;
      const p = pulls[nPulls]!;
      p.x = b.x;
      p.y = b.y;
      p.vx = b.vx;
      p.vy = b.vy;
      p.gm = b.gm;
      p.eps2 = (b.core ? b.soft : b.soft * 0.75) ** 2;
      p.absorb = b.r;
      // A galaxy's stars orbit its core freely; only a black hole's own disc drags.
      p.disc = b.kind === "hole" && !b.core ? b.r * 7 : 0;
      pullIds[nPulls] = b.id;
      nPulls++;
    }
  };

  const stepDust = () => {
    preparePulls();
    dust.step(DT * dustEvery, pulls, nPulls, u.rc.x, u.rc.y, bounds);
    for (let j = 0; j < nPulls; j++) {
      const fed = dust.fed[j]!;
      if (fed <= 0) continue;
      const b = findBody(u, pullIds[j]!);
      if (b && b.kind === "hole") b.feed = Math.min(1, b.feed + fed * 0.03);
    }
  };

  // ---- Trails ---------------------------------------------------------------------------------

  const recordTrails = (now: number) => {
    seen.clear();
    for (const b of u.bodies) {
      if (b.core) continue;
      seen.add(b.id);
      let t = trails.get(b.id);
      if (!t) {
        if (trails.size >= o.maxBodies + 16) {
          const first = trails.keys().next().value;
          if (first !== undefined) trails.delete(first);
        }
        t = {
          id: b.id,
          rgb: 0,
          alpha: 0,
          width: 0,
          pts: new Float32Array(TRAIL_POINTS * 2),
          start: 0,
          count: 0,
          goneAt: 0,
        };
        trails.set(b.id, t);
      }
      const mine = b.color >= 0;
      t.rgb = mine ? rgbOf(b.color) : b.kind === "star" ? bodyRgb(b) : 0xc8d4ec;
      t.alpha = mine ? 0.5 : b.kind === "star" ? 0.22 : 0.16;
      t.width = Math.max(o.dot * 0.8, Math.min(b.r * 0.45, o.dot * 3));
      const at = (t.start + t.count) % TRAIL_POINTS;
      t.pts[at * 2] = b.x;
      t.pts[at * 2 + 1] = b.y;
      if (t.count < TRAIL_POINTS) t.count++;
      else t.start = (t.start + 1) % TRAIL_POINTS;
    }
    for (const [id, t] of trails) {
      if (seen.has(id)) continue;
      if (!t.goneAt) t.goneAt = now;
      else if (now - t.goneAt > TRAIL_FADE_MS) trails.delete(id);
    }
  };

  // ---- Stepping -------------------------------------------------------------------------------

  const stepOnce = (now: number) => {
    step(u);
    for (const e of takeEvents(u)) {
      if (out.length >= MAX_EVENTS) out.shift();
      out.push(e);
      effect(e, now);
    }
    sinceDust++;
    if (sinceDust >= dustEvery) {
      stepDust();
      sinceDust = 0;
    }
    if (u.k % TRAIL_EVERY === 0) recordTrails(now);
  };

  const blend = (now: number) => {
    const to = trueSizes ? 1 : 0;
    const t = Math.min(1, Math.max(0, (now - blendAt) / SIZE_EASE_MS));
    const e = t * t * (3 - 2 * t);
    return blendFrom + (to - blendFrom) * e;
  };

  return {
    get u() {
      return u;
    },
    get trueSizes() {
      return trueSizes;
    },
    setSizes(on, nowMs) {
      if (on === trueSizes) return;
      blendFrom = blend(nowMs);
      blendAt = nowMs;
      trueSizes = on;
      setSizes(u, on);
    },
    sizeBlend: blend,
    drawnRadius(b, nowMs) {
      const t = blend(nowMs);
      if (t <= 0) return b.re;
      if (t >= 1) return b.rt;
      // Between sizes that differ a thousandfold, ease the logarithm so the change reads.
      return Math.exp(Math.log(b.re) * (1 - t) + Math.log(Math.max(1e-4, b.rt)) * t);
    },
    dust,
    trails,
    flashes,
    sky: o.sky,
    get sceneIndex() {
      return sceneIndex;
    },
    get sceneId() {
      return SCENES[sceneIndex]!;
    },
    get sceneAt() {
      return sceneAt;
    },
    get sceneShownAt() {
      return sceneShownAt;
    },
    get speed() {
      return speed;
    },
    get timeIndex() {
      return timeIndex;
    },
    get factor() {
      return FACTORS[timeIndex]!;
    },
    get quarters() {
      return quarters;
    },
    get clockK() {
      return clockK;
    },
    get scenes() {
      return scenes;
    },
    advance(clockMs, nowMs, each) {
      out.length = 0;
      const K = Math.floor(clockMs / STEP_MS);
      if (K - clockK > MAX_CATCHUP) clockK = K - MAX_CATCHUP;
      let budget = MAX_STEPS;
      while (clockK < K) {
        clockK++;
        quarters += QUARTERS[timeIndex]!;
        while (quarters >= 4) {
          quarters -= 4;
          // Too far behind: time slips rather than the page stalling.
          if (budget-- <= 0) {
            quarters = 0;
            break;
          }
          stepOnce(nowMs);
        }
        each?.(clockK);
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        if (nowMs - flashes[i]!.at > flashes[i]!.ms) flashes.splice(i, 1);
      }
      return out.slice();
    },
    alpha(clockMs) {
      const frac = Math.max(0, Math.min(1, clockMs / STEP_MS - clockK));
      return Math.max(0, Math.min(1, (quarters + QUARTERS[timeIndex]! * frac) / 4));
    },
    dustAlpha(clockMs) {
      const a = this.alpha(clockMs);
      return Math.max(0, Math.min(1, (sinceDust + a) / dustEvery));
    },
    setScene(index, clockMs, nowMs) {
      sceneIndex = ((index % SCENES.length) + SCENES.length) % SCENES.length;
      sceneAt = clockMs;
      sceneShownAt = nowMs;
      flashes.length = 0;
      build(u.k);
    },
    setTime(index) {
      timeIndex = Math.max(0, Math.min(FACTORS.length - 1, Math.round(index)));
      dustEvery = timeIndex >= 4 ? 4 : timeIndex >= 3 ? 3 : 2;
      sinceDust = Math.min(sinceDust, dustEvery - 1);
    },
    launch(l) {
      return launchBody(u, l);
    },
    holeMass() {
      let m = 0;
      for (const b of u.bodies) if (b.m > m) m = b.m;
      return m > 0 ? m * 0.6 : 1;
    },
    burnt() {
      const vw = o.sky.view;
      let inView = 0;
      let heavy = 0;
      let stars = 0;
      let cores = 0;
      for (const b of u.bodies) {
        if (b.core) cores++;
        if (b.x < vw.x0 || b.x > vw.x1 || b.y < vw.y0 || b.y > vw.y1) continue;
        inView++;
        if (b.gm >= gm0 * 0.05) heavy++;
        if (b.kind === "star") stars++;
      }
      if (inView === 0 || heavy === 0) return true;
      if (SCENES[sceneIndex] === "cluster") return stars < 2;
      if (SCENES[sceneIndex] === "galaxies") return cores < 2 && dust.live < keep * 0.3;
      return false;
    },
    clearEffects() {
      dust.clear(false);
      flashes.length = 0;
      for (const t of trails.values()) t.count = 0;
    },
  };
};
