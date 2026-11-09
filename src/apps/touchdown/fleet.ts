/**
 * The screen's view of the touch frames below it: one entry per frame that sends `ship`
 * messages. Each keeps a short ring of samples and is drawn a little in the past so there is
 * nearly always a newer sample to move towards. The terrain is rebuilt here from the frame's seed
 * and layout, never sent. A frame that stops sending is dropped 3 s after its last message.
 *
 * Sample times are the sender's own ms. The screen tracks the sender's clock against its own from
 * the quickest messages (the largest sender-minus-local difference), easing that estimate down a
 * little every second so a slower route or clock drift is followed.
 */
import type { Rng } from "../../core/types";
import { seedLabel } from "./config";
import { REF_DROP } from "./craft";
import type { Phase } from "./crew";
import { type Layout, layoutFor, type LayoutInput } from "./layout";
import { generateTerrain, type Terrain, terrainInputOf } from "./terrain";
import { MAX_POS, type Ship, type ShipGeometry } from "./wire";

/** A frame's craft goes this long after its last message. */
export const DROP_MS = 3000;
/** Samples are drawn this far behind the sender's clock. */
export const DELAY_MS = 120;
/** At most this many frames at once; more are ignored until some drop. */
export const MAX_REMOTES = MAX_POS;
const SAMPLES = 8;
/** Without a newer sample, a flying craft is carried on its velocity for at most this long. */
const EXTRAPOLATE_MS = 200;
/** The sender-clock estimate eases down this many ms per second. */
const EASE_MS_PER_S = 2;
/** A sender clock that jumps back this far means the frame reloaded. */
const RESTART_MS = 2000;

interface Sample extends ShipPose {
  t: number;
}

const blank = (): Sample => ({
  t: 0,
  x: 0,
  y: 0,
  a: 0,
  vx: 0,
  vy: 0,
  flags: 0,
  phase: "flying",
  phaseT: 0,
  stars: 0,
  attract: true,
  run: 0,
  wind: 0,
  ghost: false,
  gx: 0,
  gy: 0,
  ga: 0,
  gf: 0,
  galpha: 0,
});

/** A craft as the screen draws it at one moment. */
export interface ShipPose {
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  flags: number;
  phase: Phase;
  phaseT: number;
  stars: number;
  attract: boolean;
  run: number;
  wind: number;
  /** The ghost's pose, when it has one. */
  ghost: boolean;
  gx: number;
  gy: number;
  ga: number;
  gf: number;
  galpha: number;
}

export const emptyPose = (): ShipPose => blank();

export interface Remote {
  readonly frame: string;
  pos: number;
  count: number;
  geo: ShipGeometry;
  layout: Layout;
  seed: number;
  terrainKey: number;
  terrain: Terrain;
  /** Changes with the terrain or the layout, for the renderer's cache. */
  terrainId: string;
  /** Local ms of the last message. */
  heard: number;
  readonly samples: Sample[];
  /** Index of the newest sample, and how many are held. */
  head: number;
  n: number;
  /** Sender ms minus local ms, from the quickest messages. */
  offset: number;
  offsetAt: number;
}

export const geoKey = (g: ShipGeometry): string =>
  `${g.kind}:${g.span}:${g.width}:${g.height}:${g.adult}:${g.child}:${g.variant}`;

/** The layout input of a touch frame described by a `ship` message. */
export const layoutInputOf = (g: ShipGeometry): LayoutInput => ({
  kind: g.kind,
  width: g.width,
  height: g.height,
  reachTop: { adult: g.adult, child: g.child },
  seams: Array.from({ length: g.span - 1 }, (_, i) => (g.width * (i + 1)) / g.span),
  variant: g.variant,
  crews: 1,
});

/**
 * A touch frame's terrain, as that frame builds it: its seed's stream, forked for its only crew
 * and the terrain's key. `rng` is `ctx.rng`.
 */
export const shipTerrain = (
  rng: (label: string) => Rng,
  seed: number,
  key: number,
  layout: Layout,
): Terrain => {
  const spec = layout.crews[0]!;
  const stream = rng(seedLabel(seed)).fork(`crew:${spec.index}`).fork(`terrain:${key}`);
  return generateTerrain(stream, terrainInputOf(layout, spec, layout.drop / REF_DROP));
};

const lerpAngle = (a: number, b: number, f: number) => {
  let d = b - a;
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * f;
};

export interface Fleet {
  /** Take a message from `from` at local ms `now`. Returns its entry, or null if full. */
  accept(msg: Ship, from: string, now: number): Remote | null;
  /** Drop frames silent for DROP_MS. Returns how many went. */
  prune(now: number): number;
  /** The craft of `r` as drawn at local ms `now`. False if it has no samples. */
  poseOf(r: Remote, now: number, out: ShipPose): boolean;
  remotes(): IterableIterator<Remote>;
  readonly size: number;
  clear(): void;
}

export const createFleet = (rng: (label: string) => Rng): Fleet => {
  const byFrame = new Map<string, Remote>();
  const layouts = new Map<string, Layout>();

  const layoutOf = (g: ShipGeometry): Layout => {
    const key = geoKey(g);
    let l = layouts.get(key);
    if (!l) {
      l = layoutFor(layoutInputOf(g));
      layouts.set(key, l);
      // Only a handful of shapes exist in one bank; keep the cache small anyway.
      if (layouts.size > 8) layouts.delete(layouts.keys().next().value!);
    }
    return l;
  };

  const write = (s: Sample, m: Ship) => {
    s.t = m.t;
    s.x = m.x;
    s.y = m.y;
    s.a = m.a;
    s.vx = m.vx;
    s.vy = m.vy;
    s.flags = m.flags;
    s.phase = m.phase;
    s.phaseT = m.phaseT;
    s.stars = m.stars;
    s.attract = m.attract;
    s.run = m.run;
    s.wind = m.wind;
    const g = m.ghost;
    s.ghost = g !== null;
    s.gx = g?.x ?? 0;
    s.gy = g?.y ?? 0;
    s.ga = g?.a ?? 0;
    s.gf = g?.flags ?? 0;
    s.galpha = g?.alpha ?? 0;
  };

  const sample = (r: Remote, back: number): Sample | null =>
    back < r.n ? r.samples[(r.head - back + SAMPLES) % SAMPLES]! : null;

  const fill = (out: ShipPose, s: ShipPose) => {
    out.x = s.x;
    out.y = s.y;
    out.a = s.a;
    out.vx = s.vx;
    out.vy = s.vy;
    out.flags = s.flags;
    out.phase = s.phase;
    out.phaseT = s.phaseT;
    out.stars = s.stars;
    out.attract = s.attract;
    out.run = s.run;
    out.wind = s.wind;
    out.ghost = s.ghost;
    out.gx = s.gx;
    out.gy = s.gy;
    out.ga = s.ga;
    out.gf = s.gf;
    out.galpha = s.galpha;
  };

  return {
    accept(m, from, now) {
      let r = byFrame.get(from);
      const layout = layoutOf(m.geo);
      if (!r) {
        if (byFrame.size >= MAX_REMOTES) return null;
        r = {
          frame: from,
          pos: m.pos,
          count: m.count,
          geo: m.geo,
          layout,
          seed: m.seed,
          terrainKey: m.terrain,
          terrain: shipTerrain(rng, m.seed, m.terrain, layout),
          terrainId: "",
          heard: now,
          samples: Array.from({ length: SAMPLES }, blank),
          head: 0,
          n: 0,
          offset: m.t - now,
          offsetAt: now,
        };
        r.terrainId = `${geoKey(m.geo)}|${m.seed}|${m.terrain}`;
        byFrame.set(from, r);
      }
      const newest = sample(r, 0);
      if (newest && m.t < newest.t - RESTART_MS) {
        r.n = 0;
        r.offset = m.t - now;
      }
      if (newest && r.n > 0 && m.t <= newest.t) return r;
      if (layout !== r.layout || m.seed !== r.seed || m.terrain !== r.terrainKey) {
        r.layout = layout;
        r.seed = m.seed;
        r.terrainKey = m.terrain;
        r.terrain = shipTerrain(rng, m.seed, m.terrain, layout);
        r.terrainId = `${geoKey(m.geo)}|${m.seed}|${m.terrain}`;
      }
      r.geo = m.geo;
      r.pos = m.pos;
      r.count = m.count;
      r.heard = now;
      r.offset = Math.max(m.t - now, r.offset - (EASE_MS_PER_S * (now - r.offsetAt)) / 1000);
      r.offsetAt = now;
      r.head = (r.head + 1) % SAMPLES;
      r.n = Math.min(SAMPLES, r.n + 1);
      write(r.samples[r.head]!, m);
      return r;
    },
    prune(now) {
      let n = 0;
      for (const [frame, r] of byFrame) {
        if (now - r.heard > DROP_MS) {
          byFrame.delete(frame);
          n++;
        }
      }
      return n;
    },
    poseOf(r, now, out) {
      if (r.n === 0) return false;
      const at = now + r.offset - DELAY_MS;
      // The newest sample at or before `at`, and the one after it.
      let older: Sample | null = null;
      let newer: Sample | null = null;
      for (let back = 0; back < r.n; back++) {
        const s = sample(r, back)!;
        if (s.t <= at) {
          older = s;
          break;
        }
        newer = s;
      }
      if (!older) {
        // Drawing earlier than anything held: show the oldest.
        fill(out, newer!);
        return true;
      }
      fill(out, older);
      const dt = at - older.t;
      out.phaseT = older.phaseT + dt / 1000;
      if (newer && newer.run === older.run && newer.t > older.t) {
        const f = dt / (newer.t - older.t);
        out.x = older.x + (newer.x - older.x) * f;
        out.y = older.y + (newer.y - older.y) * f;
        out.a = lerpAngle(older.a, newer.a, f);
        if (older.ghost && newer.ghost) {
          out.gx = older.gx + (newer.gx - older.gx) * f;
          out.gy = older.gy + (newer.gy - older.gy) * f;
          out.ga = lerpAngle(older.ga, newer.ga, f);
          out.galpha = older.galpha + (newer.galpha - older.galpha) * f;
        }
      } else if (!newer && older.phase === "flying") {
        const k = Math.min(dt, EXTRAPOLATE_MS) / 1000;
        out.x += older.vx * k;
        out.y += older.vy * k;
      }
      return true;
    },
    remotes() {
      return byFrame.values();
    },
    get size() {
      return byFrame.size;
    },
    clear() {
      byFrame.clear();
      layouts.clear();
    },
  };
};
