/**
 * Runs one sky: schedules shells (their burst time and size), plays the show when nobody has
 * launched for a while, spots volleys, and on a corner screen deals with the edge it shares.
 * The engine below it holds the records; the renderer draws them.
 */
import type { Config } from "./config";
import type { Engine } from "./engine";
import { type Ballistic, positionAt, timeToHeight, timeToX } from "./path";
import { MIXED, SHAPE, type ShapeId } from "./recipe";
import { type Burst, fillBurst, fillEffect, hash32, newBurst, type Shell } from "./records";
import {
  keeps,
  type Section,
  sectionAt,
  SHOW_PERIOD_MS,
  showIndex,
  showPlan,
  type ShowEvent,
  type ShowPlan,
} from "./show";
import { burstHeight, burstRadius, type Sky } from "./sky";
import {
  cascadeNeeds,
  CORNER_MIN,
  createVolleyTracker,
  EFFECT_COOLDOWN_MS,
  type Launch,
  VOLLEY_MIN,
} from "./volley";

/** The corner edge (x = 0) as one corner screen sees it. */
export interface CornerSide {
  side: number;
  partner(): boolean;
  sendCross(s: Shell): void;
  sendSpill(b: Burst): void;
  sendVolley(count: number, t: number): void;
}

export interface ShowFit {
  /** Show x 0..1 maps onto this range of sky x. */
  x0: number;
  x1: number;
  /** Height shells start from. */
  launchY: number;
  /** Thin skies keep only some of each show's patterns. */
  density: number;
  maxRank: number;
  /** Skip events whose shells start this far outside [rx0, rx1] (another screen's part). */
  rx0: number;
  rx1: number;
}

export interface DirectorOptions {
  engine: Engine;
  config: Config;
  seed: string;
  sky(): Sky;
  fit(): ShowFit;
  corner: CornerSide | null;
  /** Pads that can launch into this sky, for the cascade rule. */
  pads(): number;
  /** Whether this sky runs a show at all (a panel under a screen doesn't). */
  showAllowed(): boolean;
}

export interface LaunchRequest {
  x: number;
  y: number;
  /** Radians from vertical, + right. */
  angle: number;
  v: number;
  g: number;
  t0: number;
  color: number;
  shape: ShapeId;
  size: number;
  seed: number;
  /** Who launched it, for the echo; null for none. */
  frame: string | null;
  pad: number;
  exitU: number;
  /** Pad identity for volleys. */
  key: string;
}

export interface Director {
  /** A visitor (or bot) launch. */
  launch(r: LaunchRequest): Shell;
  update(now: number): void;
  /** A shell that crossed the corner from the other screen. */
  addRemoteShell(fill: (s: Shell) => boolean): void;
  /** A burst near the corner, made on the other screen. */
  addRemoteBurst(fill: (b: Burst) => boolean): void;
  partnerVolley(count: number, t: number): void;
  /** Start a show now (admin), aligned to 2 s so two screens told together agree. */
  forceShow(now: number): void;
  /** Forget visitor state: volleys, quiet time. */
  reset(): void;
  readonly showing: boolean;
  readonly showName: string;
  /** Launches seen in the last minute. */
  launchesPerMinute(now: number): number;
  readonly lastLaunch: number;
}

const VOLLEY_BOOST = 1.45;

/**
 * A cascade's sparks spread about three quarters of its radius sideways, so a radius from the
 * spacing makes neighbouring cascades join into one curtain. They fall about as far as the radius.
 */
const cascadeRadius = (sky: Sky, spacing: number) => Math.min(spacing * 1.4, sky.height * 0.42);
/** Events this far in the past still spawn (mid-flight) when a show starts or the page loads. */
const PREFILL_MS = 6000;
const FORCE_ALIGN_MS = 2000;
const MINUTE_CAP = 240;

export const createDirector = (o: DirectorOptions): Director => {
  const { engine, config } = o;
  const tracker = createVolleyTracker();
  const scratch = newBurst();
  let plan: ShowPlan | null = null;
  let forced: ShowPlan | null = null;
  let playing = false;
  let stopAt: number | null = null;
  let cursor = -Infinity;
  let lastLaunch = -Infinity;
  let everLaunched = false;
  let volleyIds = 1;
  let lastCascade = -Infinity;
  let lastCorner = -Infinity;
  let partner: { count: number; t: number } | null = null;
  let mine: { count: number; t: number } | null = null;
  let recentLaunches: number[] = [];
  /** Each volley's ring, by volley id; the burst id guards against a reused slot. */
  const rings = new Map<number, { burst: Burst; id: number }>();

  const planFor = (now: number): ShowPlan => {
    if (forced && now < forced.start + SHOW_PERIOD_MS) return forced;
    forced = null;
    const n = showIndex(now);
    if (!plan || plan.n !== n) plan = showPlan(o.seed, n, { pictograms: config.pictograms });
    return plan;
  };

  /** Burst time for a path: when it reaches its burst height, or its apex. */
  const fuse = (path: Ballistic, size: number, sky: Sky): number => {
    const h = burstHeight(sky, size);
    const t = timeToHeight(path, h);
    if (t !== null) return t;
    const vy = path.vy;
    return path.g > 0 ? Math.max(0.3, vy / path.g) : 2;
  };

  const towardsEdge = (side: number) => (side === 0 ? 1 : -1);

  /** On a corner screen: share the shell, or burst it early at the edge if nobody is there. */
  const corner = (s: Shell) => {
    const c = o.corner;
    if (!c) return;
    const tx = timeToX(s.path, 0);
    const flight = (s.tb - s.t0) / 1000;
    const startsMine = towardsEdge(c.side) * s.path.x < 0;
    if (tx !== null && startsMine && tx < flight) {
      if (c.partner()) {
        s.shared = true;
        c.sendCross(s);
      } else {
        s.tb = s.t0 + tx * 1000;
      }
      return;
    }
    if (!c.partner()) return;
    fillBurst(scratch, s);
    if (Math.abs(scratch.x) < scratch.radius * 1.15) c.sendSpill(scratch);
  };

  const effect = (e: Parameters<typeof fillEffect>[1]): Burst => {
    const b = engine.addBurst((x) => fillEffect(x, e));
    const c = o.corner;
    if (c?.partner() && Math.abs(b.x) < b.radius * 1.15) c.sendSpill(b);
    return b;
  };

  const shellById = (id: number): Shell | null => {
    for (const s of engine.shells.slots) if (s.live && s.id === id) return s;
    return null;
  };

  /** A ring of glitter round the volley's bursts, just after the last of them. */
  const linkRing = (id: number, members: Shell[], now: number) => {
    const sky = o.sky();
    let cx = 0;
    let cy = 0;
    let last = 0;
    const pts: { x: number; y: number; r: number }[] = [];
    for (const s of members) {
      const p = positionAt(s.path, (s.tb - s.t0) / 1000);
      pts.push({ x: p.x, y: p.y, r: s.radius });
      cx += p.x;
      cy += p.y;
      last = Math.max(last, s.tb);
    }
    cx /= pts.length;
    cy /= pts.length;
    let r = 0;
    for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy) + p.r * 0.5);
    r = Math.min(r, sky.height * 0.42, (sky.x1 - sky.x0) * 0.5);
    // A volley that grows moves its ring: drop the one not yet started.
    const prev = rings.get(id);
    if (prev && prev.burst.live && prev.burst.id === prev.id && prev.burst.t0 > now) {
      engine.bursts.free(prev.burst);
    }
    const ring = effect({
      t0: last + 180,
      x: cx,
      y: cy,
      shape: SHAPE.glitter,
      color: 1,
      radius: Math.max(r, sky.rLo),
      star: sky.star,
      seed: hash32(id, 99),
    });
    rings.delete(id);
    rings.set(id, { burst: ring, id: ring.id });
    if (rings.size > 16) {
      const first = rings.keys().next().value;
      if (first !== undefined) rings.delete(first);
    }
  };

  const cascade = (t: number, sides: { x0: number; x1: number }) => {
    const sky = o.sky();
    const n = 7;
    for (let i = 0; i < n; i++) {
      effect({
        t0: t + i * 120,
        x: sides.x0 + ((sides.x1 - sides.x0) * (i + 0.5)) / n,
        y: sky.floor + sky.height * 0.9,
        shape: SHAPE.cascade,
        color: 1,
        radius: cascadeRadius(sky, (sides.x1 - sides.x0) / n),
        star: sky.star,
        seed: hash32(Math.round(t), i),
      });
    }
  };

  const cornerVolley = (t: number) => {
    if (t - lastCorner < EFFECT_COOLDOWN_MS) return;
    lastCorner = t;
    const sky = o.sky();
    const at = t + 1400;
    effect({
      t0: at,
      x: 0,
      y: sky.floor + sky.height * 0.66,
      shape: SHAPE.peony,
      color: MIXED,
      radius: sky.height * 0.27,
      star: sky.star * 1.2,
      seed: hash32(Math.round(t), 5),
      boost: 1.5,
    });
    effect({
      t0: at + 260,
      x: 0,
      y: sky.floor + sky.height * 0.66,
      shape: SHAPE.glitter,
      color: 1,
      radius: sky.height * 0.36,
      star: sky.star,
      seed: hash32(Math.round(t), 6),
    });
  };

  const checkCorner = () => {
    const c = o.corner;
    // Side a decides, so the two screens never both make one.
    if (!c || c.side !== 0 || !c.partner() || !mine || !partner) return;
    if (
      mine.count >= CORNER_MIN &&
      partner.count >= CORNER_MIN &&
      Math.abs(mine.t - partner.t) <= 1000
    ) {
      cornerVolley(Math.max(mine.t, partner.t));
    }
  };

  const volleys = (s: Shell, key: string) => {
    const group = tracker.add({ t: s.t0, key, shell: s.id } satisfies Launch);
    const members = group.map((l) => shellById(l.shell)).filter((x): x is Shell => x !== null);
    if (config.volley && group.length >= VOLLEY_MIN) {
      let id = 0;
      for (const m of members) if (m.volley) id = m.volley;
      if (!id) id = volleyIds++;
      for (const m of members) {
        if (!m.burst) m.boost = VOLLEY_BOOST;
        m.volley = id;
      }
      linkRing(id, members, s.t0);
    }
    const pads = o.pads();
    if (
      config.volley &&
      pads >= 2 &&
      group.length >= cascadeNeeds(pads) &&
      s.t0 - lastCascade > EFFECT_COOLDOWN_MS
    ) {
      lastCascade = s.t0;
      const t = members.reduce((m, x) => Math.max(m, x.tb), s.tb);
      const sky = o.sky();
      cascade(t, { x0: sky.x0, x1: sky.x1 });
    }
    const c = o.corner;
    if (c && config.volley) {
      mine = { count: group.length, t: s.t0 };
      if (group.length >= CORNER_MIN) c.sendVolley(group.length, s.t0);
      checkCorner();
    }
  };

  const spawnEvent = (e: ShowEvent, sky: Sky, fit: ShowFit) => {
    const x = fit.x0 + e.x * (fit.x1 - fit.x0);
    if (e.y !== undefined) {
      if (x < fit.rx0 - sky.rHi || x > fit.rx1 + sky.rHi) return;
      engine.addBurst((b) =>
        fillEffect(b, {
          t0: e.t,
          x,
          y: sky.floor + sky.height * e.y!,
          shape: e.shape,
          color: e.color,
          radius: cascadeRadius(sky, (fit.x1 - fit.x0) / 7),
          star: sky.star,
          seed: e.seed,
        }),
      );
      return;
    }
    const margin = sky.rHi * 1.3 + Math.abs(Math.sin(e.a)) * sky.height * 0.6;
    if (x < fit.rx0 - margin || x > fit.rx1 + margin) return;
    const s = engine.addShell((sh) => {
      sh.t0 = e.t;
      sh.path.x = x;
      sh.path.y = fit.launchY;
      sh.path.vx = sky.v * Math.sin(e.a);
      sh.path.vy = sky.v * Math.cos(e.a);
      sh.path.g = sky.g;
      sh.path.k = 0;
      sh.color = e.color;
      sh.shape = e.shape;
      sh.size = e.size;
      sh.seed = e.seed;
      sh.radius = burstRadius(sky, e.size);
      sh.star = sky.star;
      sh.tb = e.t + fuse(sh.path, e.size, sky) * 1000;
    });
    // Show shells are on both corner screens already; only the hard edge matters.
    const c = o.corner;
    if (c && !c.partner()) {
      const tx = timeToX(s.path, 0);
      if (tx !== null && tx < (s.tb - s.t0) / 1000 && towardsEdge(c.side) * s.path.x < 0) {
        s.tb = s.t0 + tx * 1000;
      }
    }
  };

  const nextBoundary = (p: ShowPlan, now: number): number => {
    for (const s of p.sections) if (s.start >= now) return s.start;
    return p.start + SHOW_PERIOD_MS;
  };

  const play = (now: number) => {
    const sky = o.sky();
    const fit = o.fit();
    const p = planFor(now);
    // Plans leave the last moments of their period empty, so nothing is lost at a boundary.
    for (const e of p.events) {
      if (e.t <= cursor) continue;
      if (e.t > now) break;
      if (!keeps(e, fit.density, fit.maxRank)) continue;
      spawnEvent(e, sky, fit);
    }
    cursor = now;
  };

  /**
   * The other screen has gone: shells of ours that were going to cross burst at the edge
   * instead. Shells that already came over from it carry on.
   */
  const hardEdge = (now: number) => {
    const c = o.corner;
    if (!c || c.partner()) return;
    const dir = towardsEdge(c.side);
    const p = { x: 0, y: 0 };
    for (const s of engine.shells.slots) {
      if (!s.live || s.burst || s.ghost || !s.shared) continue;
      const tx = timeToX(s.path, 0);
      if (tx === null) continue;
      const at = s.t0 + tx * 1000;
      positionAt(s.path, Math.max(0, (now - s.t0) / 1000), p);
      if (at > now && dir * p.x < 0 && at < s.tb) s.tb = at;
      s.shared = false;
    }
  };

  return {
    launch(r) {
      const sky = o.sky();
      lastLaunch = Math.max(lastLaunch, r.t0);
      everLaunched = true;
      recentLaunches.push(r.t0);
      if (recentLaunches.length > MINUTE_CAP) recentLaunches = recentLaunches.slice(-MINUTE_CAP);
      if (playing && stopAt === null) {
        const sec: Section | null = sectionAt(planFor(r.t0), r.t0);
        stopAt = sec ? sec.end : r.t0;
      }
      const s = engine.addShell((sh) => {
        sh.t0 = r.t0;
        sh.path.x = r.x;
        sh.path.y = r.y;
        sh.path.vx = r.v * Math.sin(r.angle);
        sh.path.vy = r.v * Math.cos(r.angle);
        sh.path.g = r.g;
        sh.path.k = 0;
        sh.color = r.color;
        sh.shape = r.shape;
        sh.size = r.size;
        sh.seed = r.seed;
        sh.radius = burstRadius(sky, r.size);
        sh.star = sky.star;
        sh.frame = r.frame;
        sh.pad = r.pad;
        sh.exitU = r.exitU;
        sh.tb = r.t0 + fuse(sh.path, r.size, sky) * 1000;
      });
      corner(s);
      volleys(s, r.key);
      return s;
    },
    update(now) {
      if (!o.showAllowed()) {
        playing = false;
        stopAt = null;
        cursor = now;
      } else {
        if (!playing && (!everLaunched || now - lastLaunch >= config.showAfterMs)) {
          playing = true;
          stopAt = null;
          const p = planFor(now);
          const join = everLaunched ? nextBoundary(p, now) : now - PREFILL_MS;
          cursor = Math.max(cursor, join);
          if (!everLaunched) cursor = join;
        }
        if (playing && stopAt !== null && now >= stopAt) {
          playing = false;
          stopAt = null;
        }
        if (playing && now > cursor) play(now);
        else if (!playing) cursor = Math.max(cursor, now);
      }
      hardEdge(now);
      engine.update(now);
    },
    addRemoteShell(fill) {
      let ok = false;
      const s = engine.addShell((sh) => {
        ok = fill(sh);
      });
      if (!ok) engine.shells.free(s);
      else s.shared = true;
    },
    addRemoteBurst(fill) {
      let ok = false;
      const b = engine.addBurst((x) => {
        ok = fill(x);
      });
      if (!ok) engine.bursts.free(b);
    },
    partnerVolley(count, t) {
      partner = { count, t };
      checkCorner();
    },
    forceShow(now) {
      const start = Math.ceil(now / FORCE_ALIGN_MS) * FORCE_ALIGN_MS;
      const n = 1_000_000 + Math.floor(start / FORCE_ALIGN_MS);
      const p = showPlan(o.seed, n, { pictograms: config.pictograms });
      const shift = start - p.start;
      forced = {
        ...p,
        start,
        end: p.end + shift,
        sections: p.sections.map((s) => ({ ...s, start: s.start + shift, end: s.end + shift })),
        events: p.events.map((e) => ({ ...e, t: e.t + shift })),
      };
      playing = true;
      stopAt = null;
      lastLaunch = -Infinity;
      everLaunched = false;
      cursor = Math.min(cursor, start);
    },
    reset() {
      tracker.clear();
      partner = null;
      mine = null;
      recentLaunches = [];
    },
    get showing() {
      return playing;
    },
    get showName() {
      if (!playing) return "";
      const p = forced ?? plan;
      if (!p) return "";
      return sectionAt(p, cursor)?.name ?? "";
    },
    launchesPerMinute(now) {
      let n = 0;
      for (const t of recentLaunches) if (now - t <= 60_000) n++;
      return n;
    },
    get lastLaunch() {
      return lastLaunch;
    },
  };
};
