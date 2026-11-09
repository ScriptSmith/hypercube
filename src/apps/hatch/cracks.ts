/**
 * The cracks of one egg, made once per egg in the egg's own frame (blunt end up, the y axis):
 * the pip's star, a ring of pecks joined by cracks round the shell, the last stretch that
 * breaks when the chick pushes, and the cracks that free the lower pieces. Each crack is a run
 * of short segments with the "crack clock" times at which its ends appear, so one number
 * (`CLOCK`) reveals them in order.
 *
 * The ring is a function of longitude and each lower crack a function of latitude, so the
 * pieces they bound can be worked out exactly (`pieceOf`).
 */
import { type Vec3, direction, wrapLon } from "../../core/sphere";
import type { Rng } from "../../core/types";
import type { EggPlan } from "./show";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Crack clock ranges: when each kind of crack shows. */
export const CLOCK = {
  star: [0.02, 0.12],
  zip: [0.14, 0.84],
  final: [0.86, 0.9],
  lower: [0.9, 0.99],
} as const;

export interface Segment {
  a: Vec3;
  b: Vec3;
  /** Crack clock at each end. */
  ta: number;
  tb: number;
  /** Half width, radians. */
  r: number;
}

/** Piece ids: the cap above the ring, the strips below it, and the cup at the bottom. */
export const CAP = 1;
export const firstStrip = 2;

export interface CrackNet {
  segments: Segment[];
  /** Ring latitude at `RING_SAMPLES` longitudes from -π. */
  ring: Float32Array;
  /** Longitude of each lower crack at `LOWER_SAMPLES` latitudes from the cup up to the top. */
  lower: Float32Array[];
  /** The latitudes the lower crack tables span. */
  range: { bottom: number; top: number };
  /** Cup latitude at `RING_SAMPLES` longitudes from -π. */
  cup: Float32Array;
  /** Strips between lower cracks, then the cup. */
  pieces: number;
  /** Middle of each lower piece (strips then cup), for moving it. */
  centres: Vec3[];
  /** Middle of the stretch the chick didn't chip, where the top hinges. */
  hinge: number;
  /** The last peck, where the chick's beak is when it pushes. */
  last: { lat: number; lon: number };
  /** Peck points in order, the pip first. */
  pecks: { lat: number; lon: number }[];
}

export const RING_SAMPLES = 1024;
export const LOWER_SAMPLES = 256;

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** Linear lookup in a table sampled evenly round a circle from -π. */
export const sampleRound = (table: Float32Array, lon: number): number => {
  const n = table.length;
  const x = ((wrapLon(lon) + Math.PI) / TAU) * n;
  const i = Math.floor(x);
  const f = x - i;
  return lerp(table[((i % n) + n) % n]!, table[(((i + 1) % n) + n) % n]!, f);
};

/** A jagged path between two lat/lon points, as points, made by moving midpoints aside. */
const jag = (
  rng: Rng,
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  depth: number,
  rough: number,
  across: "lat" | "lon",
): { lat: number; lon: number }[] => {
  let pts = [a, b];
  let amp = rough;
  for (let d = 0; d < depth; d++) {
    const out = [pts[0]!];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]!;
      const q = pts[i]!;
      const m = { lat: (p.lat + q.lat) / 2, lon: (p.lon + q.lon) / 2 };
      m[across] += rng.range(-amp, amp);
      out.push(m, q);
    }
    pts = out;
    amp *= 0.55;
  }
  return pts;
};

const dir = (p: { lat: number; lon: number }) => direction(p.lat, p.lon);

/** Segments along points, times running from `t0` to `t1` and width from `r` to `r1` by length. */
const along = (
  out: Segment[],
  pts: { lat: number; lon: number }[],
  t0: number,
  t1: number,
  r: number,
  r1 = r,
) => {
  const ds = pts.map(dir);
  const lens: number[] = [0];
  for (let i = 1; i < ds.length; i++) {
    const a = ds[i - 1]!;
    const b = ds[i]!;
    lens.push(lens[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = lens[lens.length - 1]! || 1;
  for (let i = 1; i < ds.length; i++) {
    const mid = (lens[i - 1]! + lens[i]!) / 2 / total;
    out.push({
      a: ds[i - 1]!,
      b: ds[i]!,
      ta: lerp(t0, t1, lens[i - 1]! / total),
      tb: lerp(t0, t1, lens[i]! / total),
      r: lerp(r, r1, mid),
    });
  }
};

/** A short crack leaving `from` at `angle` (radians, 0 is east, π/2 north), forking once maybe. */
const branch = (
  rng: Rng,
  out: Segment[],
  from: { lat: number; lon: number },
  angle: number,
  length: number,
  t0: number,
  t1: number,
  r: number,
  forks: number,
) => {
  const pts = [from];
  const steps = 5 + rng.int(3);
  let a = angle;
  let p = from;
  for (let i = 0; i < steps; i++) {
    a += rng.range(-0.5, 0.5);
    const step = length / steps;
    p = {
      lat: p.lat + Math.sin(a) * step,
      lon: p.lon + (Math.cos(a) * step) / Math.max(0.2, Math.cos(p.lat)),
    };
    pts.push(p);
  }
  // A hairline that thins to nothing at its tip.
  along(out, pts, t0, t1, r, r * 0.3);
  if (forks > 0 && rng.next() < 0.55) {
    const at = pts[1 + rng.int(pts.length - 2)]!;
    const f = lerp(t0, t1, 0.5);
    branch(
      rng,
      out,
      at,
      a + rng.pick([-1, 1]) * rng.range(0.5, 1),
      length * 0.5,
      f,
      t1,
      r * 0.8,
      0,
    );
  }
};

export const LINE = 0.0034;
export const PECK = 0.013;

/** Make the cracks for `plan`. */
export const makeCracks = (rng: Rng, plan: EggPlan): CrackNet => {
  const segments: Segment[] = [];
  const pip = plan.pip;
  const nTaps = Math.max(1, plan.taps.length);

  // The pip's star: cracks start on taps and lengthen over the next two.
  const arms = 5 + rng.int(4);
  const [s0, s1] = CLOCK.star;
  for (let i = 0; i < arms; i++) {
    const tap = Math.min(nTaps - 1, Math.floor((i / arms) * nTaps * 0.8));
    const ta = lerp(s0, s1, tap / nTaps);
    const tb = lerp(s0, s1, Math.min(1, (tap + 2.5) / nTaps));
    const angle = (i / arms) * TAU + rng.range(-0.3, 0.3);
    branch(rng, segments, pip, angle, rng.range(6, 12) * DEG, ta, tb, LINE, 1);
  }

  // The zip: pecks round from the pip, joined by cracks, each with a chip and side cracks.
  const n = plan.pecks.length;
  const pecks: { lat: number; lon: number }[] = [pip];
  let lat = pip.lat;
  for (let i = 1; i <= n; i++) {
    lat = lat * 0.7 + pip.lat * 0.3 + rng.range(-1.6, 1.6) * DEG;
    const lon = pip.lon + plan.zipDir * plan.zipSpan * (i / n) + rng.range(-0.25, 0.25) * DEG;
    pecks.push({ lat, lon });
  }
  const [z0, z1] = CLOCK.zip;
  const ringPts: { lat: number; lon: number }[] = [pip];
  for (let i = 1; i <= n; i++) {
    const ta = lerp(z0, z1, (i - 1) / n);
    const tb = lerp(z0, z1, i / n);
    const pts = jag(rng, pecks[i - 1]!, pecks[i]!, 4, 1.4 * DEG, "lat");
    along(segments, pts, ta, tb, LINE);
    ringPts.push(...pts.slice(1));
    const p = pecks[i]!;
    segments.push({ a: dir(p), b: dir(p), ta: tb, tb, r: PECK * rng.range(0.8, 1.15) });
    for (let k = 0, m = 1 + rng.int(2); k < m; k++) {
      const up = rng.next() < 0.5 ? 1 : -1;
      const angle = up * rng.range(0.5, 1.4) + (plan.zipDir > 0 ? 0 : Math.PI);
      const t = Math.min(z1, tb + 0.15 / n);
      branch(rng, segments, p, angle, rng.range(2, 5.5) * DEG, tb, t, LINE * 0.75, 1);
    }
  }

  // The push: the rest of the ring breaks from both ends at once, meeting at the hinge.
  const last = pecks[n]!;
  const gap = TAU - plan.zipSpan;
  const hingeLon = pip.lon + plan.zipDir * (plan.zipSpan + gap / 2);
  const hinge = {
    lat: (last.lat + pip.lat) / 2 + rng.range(-1, 1) * DEG,
    lon: hingeLon,
  };
  const [f0, f1] = CLOCK.final;
  const fromLast = jag(rng, last, hinge, 4, 2 * DEG, "lat");
  const toPip = jag(
    rng,
    hinge,
    { lat: pip.lat, lon: pip.lon + plan.zipDir * TAU },
    4,
    2 * DEG,
    "lat",
  );
  along(segments, fromLast, f0, f1, LINE);
  along(segments, [...toPip].reverse(), f0, f1, LINE);
  ringPts.push(...fromLast.slice(1), ...toPip.slice(1, -1));

  // The ring as latitude by longitude, from its points in order round.
  const ring = new Float32Array(RING_SAMPLES);
  const pts = ringPts.map((p) => ({ lat: p.lat, lon: p.lon - pip.lon }));
  if (plan.zipDir < 0) for (const p of pts) p.lon = -p.lon;
  // Now longitudes rise from 0 to 2π along the ring.
  pts.push({ lat: pip.lat, lon: TAU });
  for (let i = 0; i < RING_SAMPLES; i++) {
    const lon = -Math.PI + ((i + 0.5) / RING_SAMPLES) * TAU;
    let rel = wrapLon(lon - pip.lon) * plan.zipDir;
    if (rel < 0) rel += TAU;
    let j = 1;
    while (j < pts.length - 1 && pts[j]!.lon < rel) j++;
    const p = pts[j - 1]!;
    const q = pts[j]!;
    const f = q.lon > p.lon ? (rel - p.lon) / (q.lon - p.lon) : 0;
    ring[i] = lerp(p.lat, q.lat, Math.min(1, Math.max(0, f)));
  }

  // Lower cracks from the ring down to the cup, and the cup's own crack round.
  const strips = 4 + rng.int(3);
  const cupLat = rng.range(-62, -52) * DEG;
  const cupRough = 3 * DEG;
  const cup = new Float32Array(RING_SAMPLES);
  const cupPhase = rng.range(0, TAU);
  for (let i = 0; i < RING_SAMPLES; i++) {
    const lon = -Math.PI + ((i + 0.5) / RING_SAMPLES) * TAU;
    cup[i] =
      cupLat +
      cupRough * 0.6 * Math.sin(3 * lon + cupPhase) +
      cupRough * 0.4 * Math.sin(7 * lon + 2 * cupPhase);
  }
  const [l0, l1] = CLOCK.lower;
  const range = { bottom: cupLat - cupRough, top: Math.max(...ring) + 2 * DEG };
  const lower: Float32Array[] = [];
  const startLon = rng.range(-Math.PI, Math.PI);
  const starts: number[] = [];
  for (let k = 0; k < strips; k++) {
    starts.push(startLon + ((k + rng.range(-0.2, 0.2)) / strips) * TAU);
  }
  for (let k = 0; k < strips; k++) {
    // A slow wander plus a small zigzag, never far enough to meet the next crack.
    const table = new Float32Array(LOWER_SAMPLES);
    const pa = rng.range(0, TAU);
    const pb = rng.range(0, TAU);
    let zig = 0;
    for (let s = 0; s < LOWER_SAMPLES; s++) {
      const f = s / (LOWER_SAMPLES - 1);
      zig = zig * 0.85 + rng.range(-0.5, 0.5) * DEG;
      table[s] =
        starts[k]! + 4 * DEG * Math.sin(5 * f + pa) + 2 * DEG * Math.sin(13 * f + pb) + zig;
    }
    lower.push(table);
    // Its drawn crack runs from the ring down to the cup, appearing downwards.
    const topLon = lowerLon(table, range.top, range.bottom, range.top);
    const top = sampleRound(ring, topLon);
    const bottom = sampleRound(cup, lowerLon(table, cupLat, range.bottom, range.top));
    const pts2: { lat: number; lon: number }[] = [
      { lat: top, lon: lowerLon(table, top, range.bottom, range.top) },
    ];
    for (let s = LOWER_SAMPLES - 1; s >= 0; s -= 4) {
      const la = lowerLat(s, range.bottom, range.top);
      if (la >= top) continue;
      if (la <= bottom) break;
      pts2.push({ lat: la, lon: table[s]! });
    }
    pts2.push({ lat: bottom, lon: lowerLon(table, bottom, range.bottom, range.top) });
    along(segments, pts2, l0, lerp(l0, l1, 0.6), LINE);
  }
  const cupPts: { lat: number; lon: number }[] = [];
  for (let i = 0; i <= 96; i++) {
    const lon = -Math.PI + (i / 96) * TAU;
    cupPts.push({ lat: sampleRound(cup, lon), lon });
  }
  along(segments, cupPts, lerp(l0, l1, 0.5), l1, LINE);

  const centres: Vec3[] = [];
  const mid = (cupLat + pip.lat) / 2;
  for (let k = 0; k < strips; k++) {
    const a = starts[k]!;
    let b = starts[(k + 1) % strips]!;
    while (b < a) b += TAU;
    centres.push(direction(mid, (a + b) / 2));
  }
  centres.push([0, -1, 0]);

  return {
    segments,
    ring,
    lower,
    range,
    cup,
    pieces: strips + 1,
    centres,
    hinge: wrapLon(hingeLon),
    last: { lat: last.lat, lon: wrapLon(last.lon) },
    pecks: pecks.map((p) => ({ lat: p.lat, lon: wrapLon(p.lon) })),
  };
};

/** Latitude of lower-crack sample `s`, from `bottom` to `top`. */
export const lowerLat = (s: number, bottom: number, top: number): number =>
  bottom + (s / (LOWER_SAMPLES - 1)) * (top - bottom);

/** A lower crack's longitude at latitude `lat`. */
export const lowerLon = (table: Float32Array, lat: number, bottom: number, top: number): number => {
  const x = ((lat - bottom) / (top - bottom)) * (LOWER_SAMPLES - 1);
  const i = Math.max(0, Math.min(LOWER_SAMPLES - 2, Math.floor(x)));
  const f = Math.max(0, Math.min(1, x - i));
  return lerp(table[i]!, table[i + 1]!, f);
};

/**
 * Which piece a point belongs to: the cap (`CAP`), strip `firstStrip + k`, or the cup
 * (`firstStrip + strips`).
 */
export const pieceOf = (net: CrackNet, lat: number, lon: number): number => {
  if (lat >= sampleRound(net.ring, lon)) return CAP;
  const strips = net.pieces - 1;
  if (lat <= sampleRound(net.cup, lon)) return firstStrip + strips;
  return firstStrip + stripAt(net, lat, lon);
};

/** Which strip, counting from the first lower crack, contains longitude `lon` at `lat`. */
export const stripAt = (net: CrackNet, lat: number, lon: number): number => {
  const { range } = net;
  const strips = net.lower.length;
  const base = lowerLon(net.lower[0]!, lat, range.bottom, range.top);
  let rel = lon - base;
  rel = ((rel % TAU) + TAU) % TAU;
  for (let k = 1; k < strips; k++) {
    let b = lowerLon(net.lower[k]!, lat, range.bottom, range.top) - base;
    b = ((b % TAU) + TAU) % TAU;
    if (rel < b) return k - 1;
  }
  return strips - 1;
};
