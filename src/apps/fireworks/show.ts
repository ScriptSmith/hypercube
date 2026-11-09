/**
 * The scripted show. Show `n` fills the clock period [n P, (n + 1) P) and is generated from the
 * room seed and `n` alone, so two screens that share a seed and a clock play the same show in step
 * without a single message: openers, a middle section, a finale, then a quiet rest with the odd
 * single shell so the sky is never empty for long.
 *
 * Positions are fractions across the show's width. A bank screen maps them onto its bank; the two
 * screens of a corner map them onto both banks together, so the corner sits at 0.5 and mirrored
 * pairs straddle it.
 */
import { createRng } from "../../core/rng";
import type { Rng } from "../../core/types";
import { ABSTRACT_SHAPES, COLORS, MIXED, PICTOGRAMS, SHAPE, type ShapeId } from "./recipe";

export const SHOW_PERIOD_MS = 90_000;
/** Most events one show may hold. */
export const MAX_EVENTS = 400;

export type SectionName = "openers" | "middle" | "finale" | "rest";

export interface Section {
  name: SectionName;
  start: number;
  end: number;
}

export interface ShowEvent {
  /** Clock ms of the launch (or of the burst, for effects). */
  t: number;
  /** 0..1 across the show's width. */
  x: number;
  /** Launch angle from vertical, radians, positive to the right. */
  a: number;
  color: number;
  shape: ShapeId;
  size: number;
  seed: number;
  /** Effects burst in place at this fraction of the sky's height, with no shell. */
  y?: number;
  /** The pattern's draw for thin skies: lower is kept first. */
  weight: number;
  /** Order within its pattern; thin skies keep the first few. */
  rank: number;
}

export interface ShowPlan {
  n: number;
  start: number;
  /** End of the show proper; the rest runs to the end of the period. */
  end: number;
  sections: Section[];
  events: ShowEvent[];
}

export const showIndex = (now: number): number => Math.floor(now / SHOW_PERIOD_MS);

const DEG = Math.PI / 180;

interface Builder {
  rng: Rng;
  events: ShowEvent[];
  pictograms: boolean;
  /** Pictograms left in this show. */
  pictoLeft: number;
}

const add = (
  b: Builder,
  e: Omit<ShowEvent, "seed" | "weight" | "rank">,
  weight: number,
  rank: number,
) => {
  if (b.events.length >= MAX_EVENTS) return;
  b.events.push({ ...e, seed: b.rng.int(0x7fffffff), weight, rank });
};

const anyColor = (rng: Rng): number => (rng.next() < 0.12 ? MIXED : rng.int(COLORS.length));
const anyShape = (b: Builder, allowPicto: boolean): ShapeId => {
  if (allowPicto && b.pictograms && b.pictoLeft > 0 && b.rng.next() < 0.16) {
    b.pictoLeft--;
    return b.rng.pick(PICTOGRAMS);
  }
  return b.rng.pick(ABSTRACT_SHAPES);
};
const wobble = (rng: Rng, deg: number) => (rng.next() * 2 - 1) * deg * DEG;

type Pattern = (b: Builder, t: number, weight: number) => number;

const single: Pattern = (b, t, w) => {
  add(
    b,
    {
      t,
      x: b.rng.range(0.08, 0.92),
      a: wobble(b.rng, 6),
      color: anyColor(b.rng),
      shape: anyShape(b, true),
      size: b.rng.range(0.2, 1),
    },
    w,
    0,
  );
  return 1;
};

const pair: Pattern = (b, t, w) => {
  const x = b.rng.range(0.1, 0.4);
  const color = anyColor(b.rng);
  const shape = anyShape(b, false);
  const size = b.rng.range(0.3, 0.9);
  const a = b.rng.range(0, 8) * DEG;
  add(b, { t, x, a: -a, color, shape, size }, w, 0);
  add(b, { t, x: 1 - x, a, color, shape, size }, w, 1);
  return 2;
};

const sweep: Pattern = (b, t, w) => {
  const n = 3 + b.rng.int(4);
  const dir = b.rng.next() < 0.5 ? 1 : -1;
  const c0 = b.rng.int(COLORS.length);
  const shape = b.rng.pick([SHAPE.peony, SHAPE.ring, SHAPE.crossette] as const);
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    add(
      b,
      {
        t: t + i * 260,
        x: 0.1 + 0.8 * (dir > 0 ? f : 1 - f),
        a: wobble(b.rng, 4),
        color: (c0 + i) % COLORS.length,
        shape,
        size: 0.25 + 0.5 * f,
      },
      w,
      i,
    );
  }
  return n;
};

const fan: Pattern = (b, t, w) => {
  const n = 3 + b.rng.int(3);
  const x = b.rng.next() < 0.5 ? 0.5 + wobble(b.rng, 1) * 2 : b.rng.range(0.2, 0.8);
  const color = anyColor(b.rng);
  const shape = b.rng.pick([SHAPE.peony, SHAPE.palm, SHAPE.willow] as const);
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1) - 0.5;
    add(
      b,
      {
        t: t + Math.abs(f) * 300,
        x,
        a: f * 36 * DEG,
        color,
        shape,
        size: 0.55 - Math.abs(f) * 0.3,
      },
      w,
      i === Math.floor(n / 2) ? 0 : i + 1,
    );
  }
  return n;
};

const chorus: Pattern = (b, t, w) => {
  const n = 4 + b.rng.int(3);
  const shape = b.rng.pick([SHAPE.peony, SHAPE.ring, SHAPE.willow] as const);
  const color = anyColor(b.rng);
  const size = b.rng.range(0.4, 0.8);
  for (let i = 0; i < n; i++) {
    add(
      b,
      {
        t: t + b.rng.range(0, 120),
        x: 0.1 + (0.8 * (i + 0.5)) / n,
        a: wobble(b.rng, 3),
        color,
        shape,
        size,
      },
      w,
      Math.abs(i - (n - 1) / 2) < 1 ? 0 : i + 1,
    );
  }
  return n;
};

const picture: Pattern = (b, t, w) => {
  if (!b.pictograms || b.pictoLeft <= 0) return pair(b, t, w);
  b.pictoLeft--;
  const x = b.rng.range(0.3, 0.7);
  add(
    b,
    {
      t,
      x,
      a: wobble(b.rng, 3),
      color: b.rng.int(COLORS.length),
      shape: b.rng.pick(PICTOGRAMS),
      size: 0.85,
    },
    w,
    0,
  );
  const color = anyColor(b.rng);
  add(b, { t: t + 400, x: x - 0.2, a: -6 * DEG, color, shape: SHAPE.peony, size: 0.3 }, w, 1);
  add(b, { t: t + 400, x: x + 0.2, a: 6 * DEG, color, shape: SHAPE.peony, size: 0.3 }, w, 2);
  return 3;
};

const cascade = (b: Builder, t: number, w: number) => {
  const n = 7;
  const color = b.rng.next() < 0.7 ? 1 : anyColor(b.rng);
  for (let i = 0; i < n; i++) {
    add(
      b,
      {
        t: t + i * 140,
        x: 0.07 + (0.86 * (i + 0.5)) / n,
        a: 0,
        color,
        shape: SHAPE.cascade,
        size: 0.5,
        y: 0.9,
      },
      w,
      Math.abs(i - 3) < 1 ? 0 : i + 1,
    );
  }
};

const MIDDLE: readonly Pattern[] = [pair, fan, chorus, sweep, single, picture, pair, fan];

/** Pure: the same seed text and index always give the same plan. */
export const showPlan = (seed: string, n: number, opts: { pictograms: boolean }): ShowPlan => {
  const rng = createRng(`fireworks-show:${seed}:${n}`);
  const start = n * SHOW_PERIOD_MS;
  const duration = Math.round(rng.range(60_000, 80_000));
  const end = start + duration;
  const openersEnd = start + Math.round(duration * rng.range(0.22, 0.28));
  const finaleStart = end - Math.round(rng.range(12_000, 15_000));
  const sections: Section[] = [
    { name: "openers", start, end: openersEnd },
    { name: "middle", start: openersEnd, end: finaleStart },
    { name: "finale", start: finaleStart, end },
    { name: "rest", start: end, end: start + SHOW_PERIOD_MS },
  ];
  const b: Builder = {
    rng,
    events: [],
    pictograms: opts.pictograms,
    pictoLeft: opts.pictograms ? 2 + rng.int(2) : 0,
  };

  // Openers: one, then two, then short sweeps, building up.
  let t = start + 300;
  let i = 0;
  while (t < openersEnd - 1500) {
    const p = i < 2 ? single : i < 4 ? pair : rng.next() < 0.5 ? sweep : pair;
    p(b, t, rng.next());
    t += rng.range(1300, 1900);
    i++;
  }

  // Middle: the varied patterns, a little closer together.
  t = openersEnd;
  let last: Pattern | null = null;
  while (t < finaleStart - 2000) {
    let p = rng.pick(MIDDLE);
    if (p === last) p = rng.pick(MIDDLE);
    last = p;
    const n = p(b, t, rng.next());
    t += rng.range(1100, 1900) + n * 110;
  }

  // Finale: rising salvos, a cascade along the top, and a last line of large shells.
  const salvoEnd = end - 2500;
  t = finaleStart;
  while (t < salvoEnd) {
    const k = 1 + rng.int(3);
    const w = rng.next();
    for (let j = 0; j < k; j++) {
      add(
        b,
        {
          t: t + j * 90,
          x: rng.range(0.06, 0.94),
          a: wobble(rng, 10),
          color: anyColor(rng),
          shape: anyShape(b, false),
          size: rng.range(0.3, 1),
        },
        w,
        j,
      );
    }
    const f = (t - finaleStart) / Math.max(1, salvoEnd - finaleStart);
    t += rng.range(650, 900) - f * 300;
  }
  cascade(b, finaleStart + (salvoEnd - finaleStart) * 0.55, rng.next() * 0.5);
  const lineN = 8;
  const lineColor = anyColor(rng);
  for (let j = 0; j < lineN; j++) {
    add(
      b,
      {
        t: salvoEnd + j * 70,
        x: 0.08 + (0.84 * (j + 0.5)) / lineN,
        a: (j / (lineN - 1) - 0.5) * 14 * DEG,
        color: j % 2 ? lineColor : 1,
        shape: j % 2 ? SHAPE.peony : SHAPE.willow,
        size: 1,
      },
      0,
      Math.abs(j - 3.5) < 1 ? 0 : j,
    );
  }

  // Rest: now and then a single shell, so the sky never goes dark for long.
  t = end + rng.range(2500, 3500);
  while (t < start + SHOW_PERIOD_MS - 1500) {
    single(b, t, rng.next() * 0.6);
    t += rng.range(2300, 3600);
  }

  b.events.sort((p, q) => p.t - q.t);
  return { n, start, end, sections, events: b.events };
};

/** The section of a plan that holds time `t`. */
export const sectionAt = (plan: ShowPlan, t: number): Section | null =>
  plan.sections.find((s) => t >= s.start && t < s.end) ?? null;

/**
 * Whether a sky of a given thinness keeps an event: narrow skies keep the start of each pattern
 * and only some of the patterns.
 */
export const keeps = (e: ShowEvent, density: number, maxRank: number): boolean =>
  e.weight < density && e.rank < maxRank;
