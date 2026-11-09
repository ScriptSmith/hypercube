/**
 * Chapter 11's model, pure: the samples, their fingerprints, the rounds and indexing.
 *
 * Every sample's fingerprint card is its powder rings worked out from its crystal under copper,
 * placed by |S| = 1/d with heights from |F|², multiplicity and the Lorentz-polarisation factor
 * (crystals.ts). The mystery's own curve is the radial profile of a simulated map where there is
 * one that makes rings (corundum powder, aluminium foil), else the rings worked out from the
 * crystal (zircon, silicon, table salt, diamond). The zircon and silicon maps are single crystals:
 * their spots show only the few layers the scan crossed, in other proportions, so they stay in
 * chapter 6 and are never offered here as a fingerprint of rings. The positions are what matter,
 * so the cards and the curve share one |S| ruler.
 *
 * A round shows the mystery and three cards. Corundum and zircon are both crowded with rings and
 * never share a round; corundum's (1 1 3) sits within 0.6° of diamond's (1 1 1), and aluminium's
 * brightest ring on zircon's weak (2 2 0), so those pairs are kept apart too.
 */
import type { CrystalId } from "../../crystals";
import { CRYSTALS, powderRings, type Ring } from "../../crystals";
import { mapMeta, type MapId } from "../../maps";

export const SAMPLES = ["corundum", "foil", "zircon", "silicon", "salt", "diamond"] as const;
export type SampleId = (typeof SAMPLES)[number];

export interface Sample {
  id: SampleId;
  crystal: CrystalId;
  /** The simulated map that is this sample's mystery picture, or null to draw its rings. */
  map: MapId | null;
  form: "powder" | "foil";
}

export const SAMPLE: Readonly<Record<SampleId, Sample>> = {
  corundum: { id: "corundum", crystal: "corundum", map: "corundum", form: "powder" },
  foil: { id: "foil", crystal: "aluminium", map: "foil", form: "foil" },
  zircon: { id: "zircon", crystal: "zircon", map: null, form: "powder" },
  silicon: { id: "silicon", crystal: "silicon", map: null, form: "powder" },
  salt: { id: "salt", crystal: "salt", map: null, form: "powder" },
  diamond: { id: "diamond", crystal: "diamond", map: null, form: "powder" },
};

/** Pairs that look too alike to share a round. */
export const APART: readonly (readonly [SampleId, SampleId])[] = [
  ["corundum", "zircon"],
  ["corundum", "diamond"],
  ["foil", "zircon"],
];

export const apart = (a: SampleId, b: SampleId): boolean =>
  APART.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** The ruler, Å⁻¹: from inside every sample's first ring to past aluminium's (4 0 0). */
export const S0 = 0.18;
export const S1 = 1.05;
export const LAMBDA = 1.5406;
/** Rings weaker than this (of 100) are left off the cards. */
export const MIN_HEIGHT = 2;
export const BINS = 300;

const ringCache = new Map<SampleId, Ring[]>();
export const fingerprint = (id: SampleId): Ring[] => {
  const hit = ringCache.get(id);
  if (hit) return hit;
  const rings = powderRings(CRYSTALS[SAMPLE[id].crystal], LAMBDA, { maxTwoTheta: 170 }).filter(
    (r) => r.S >= S0 && r.S <= S1 && r.height >= MIN_HEIGHT,
  );
  ringCache.set(id, rings);
  return rings;
};

const mapCache = new Map<SampleId, Ring[]>();
/** The rings a worked-out map shows: everything up to the map's top, 1.21 Å⁻¹. */
export const mapRings = (id: SampleId): Ring[] => {
  const hit = mapCache.get(id);
  if (hit) return hit;
  const rings = powderRings(CRYSTALS[SAMPLE[id].crystal], LAMBDA, { maxTwoTheta: 170 }).filter(
    (r) => r.S <= 1.25 && r.height >= MIN_HEIGHT,
  );
  mapCache.set(id, rings);
  return rings;
};

/** |S| at the middle of curve bin i. */
export const binS = (i: number): number => S0 + ((i + 0.5) / BINS) * (S1 - S0);

/** The width of a worked-out ring on the curve, Å⁻¹, about the simulated powder's. */
const RING_WIDTH = 0.005;

const curveCache = new Map<SampleId, Float32Array>();
/**
 * The mystery's curve over the ruler: brightness against |S|, 1 at its peak, NaN where the map
 * has no data.
 */
export const curve = (id: SampleId): Float32Array => {
  const hit = curveCache.get(id);
  if (hit) return hit;
  const out = new Float32Array(BINS);
  const map = SAMPLE[id].map;
  if (map) {
    const p = mapMeta(map).profile;
    for (let i = 0; i < BINS; i++) {
      const b = Math.floor((binS(i) - p.sMin) / p.binWidth);
      const v = p.values[b];
      out[i] = v === null || v === undefined ? Number.NaN : v;
    }
  } else {
    for (const r of powderRings(CRYSTALS[SAMPLE[id].crystal], LAMBDA, { maxTwoTheta: 170 }))
      for (let i = 0; i < BINS; i++) {
        const d = (binS(i) - r.S) / RING_WIDTH;
        if (Math.abs(d) < 5) out[i] = out[i]! + r.height * Math.exp(-0.5 * d * d);
      }
  }
  let top = 0;
  for (const v of out) if (v > top) top = v;
  if (top > 0) for (let i = 0; i < BINS; i++) out[i] = out[i]! / top;
  curveCache.set(id, out);
  return out;
};

/** The curve's main peaks, strongest first, as |S|. */
export const peaks = (id: SampleId, count = 4, min = 0.12): number[] => {
  const c = curve(id);
  const found: { S: number; v: number }[] = [];
  for (let i = 0; i < BINS; i++) {
    const v = c[i]!;
    if (!(v >= min)) continue;
    let top = true;
    for (let j = Math.max(0, i - 4); j <= Math.min(BINS - 1, i + 4); j++)
      if (j !== i && c[j]! > v) top = false;
    if (top) found.push({ S: binS(i), v });
  }
  found.sort((a, b) => b.v - a.v);
  return found.slice(0, count).map((p) => p.S);
};

/**
 * The order the mysteries come in, round after round. A powder map's rings come first, so the
 * game opens on what chapter 6 taught; the foil's arcs come second.
 */
export const ORDER: readonly SampleId[] = [
  "corundum",
  "foil",
  "salt",
  "zircon",
  "diamond",
  "silicon",
];

const mix = (n: number): number => {
  let x = (n + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
};

export interface Round {
  mystery: SampleId;
  /** Three cards, the mystery among them. */
  choices: [SampleId, SampleId, SampleId];
  /** Which card is the mystery. */
  answer: number;
}

export const MAX_ROUND = 999;

export const roundOf = (r: number): Round => {
  const n = ((Math.round(r) % (MAX_ROUND + 1)) + MAX_ROUND + 1) % (MAX_ROUND + 1);
  const mystery = ORDER[n % ORDER.length]!;
  const others = SAMPLES.filter((x) => x !== mystery && !apart(x, mystery));
  const pairs: [SampleId, SampleId][] = [];
  for (let i = 0; i < others.length; i++)
    for (let j = i + 1; j < others.length; j++)
      if (!apart(others[i]!, others[j]!)) pairs.push([others[i]!, others[j]!]);
  const pair = pairs[mix(n) % pairs.length]!;
  const answer = mix(n * 7 + 3) % 3;
  const rest = mix(n * 13 + 1) % 2 === 0 ? pair : ([pair[1], pair[0]] as const);
  const choices = [...rest] as SampleId[];
  choices.splice(answer, 0, mystery);
  return { mystery, choices: choices as [SampleId, SampleId, SampleId], answer };
};

export interface MysteryState {
  round: number;
  /** Bit i: card i was tried and was not it. */
  wrong: number;
  solved: boolean;
  /** The use tile showing its sentence, or −1. */
  use: number;
}

export const START: MysteryState = { round: 0, wrong: 0, solved: false, use: -1 };

export const USE_COUNT = 7;

export const STATE_RANGES: readonly (readonly [number, number])[] = [
  [0, MAX_ROUND],
  [0, 7],
  [0, 1],
  [0, USE_COUNT],
];

export const encode = (s: MysteryState): number[] => [
  Math.max(0, Math.min(MAX_ROUND, s.round)),
  s.wrong & 7,
  s.solved ? 1 : 0,
  s.use + 1,
];

export const decode = (v: readonly number[]): MysteryState => ({
  round: Math.max(0, Math.min(MAX_ROUND, v[0] ?? 0)),
  wrong: (v[1] ?? 0) & 7,
  solved: v[2] === 1,
  use: Math.max(-1, Math.min(USE_COUNT - 1, (v[3] ?? 0) - 1)),
});

/** Pick card i: solved when it is the mystery, else marked tried. */
export const pick = (s: MysteryState, i: number): MysteryState => {
  if (s.solved || i < 0 || i > 2) return s;
  const r = roundOf(s.round);
  return i === r.answer ? { ...s, solved: true } : { ...s, wrong: s.wrong | (1 << i) };
};

export const nextRound = (s: MysteryState): MysteryState => ({
  ...START,
  round: (s.round + 1) % (MAX_ROUND + 1),
});

/** Indexing aluminium: its first six rings' |S|², their ratio to a third of the first, a. */
export const alIndexing = () => {
  const rings = powderRings(CRYSTALS.aluminium, LAMBDA, { maxTwoTheta: 170 }).slice(0, 6);
  const unit = (rings[0]!.S * rings[0]!.S) / 3;
  return {
    rings: rings.map((r) => ({
      S: r.S,
      S2: r.S * r.S,
      ratio: (r.S * r.S) / unit,
      hkl: [...r.hkl].map(Math.abs).sort((a, b) => b - a) as [number, number, number],
    })),
    unit,
    a: Math.sqrt(3) / rings[0]!.S,
  };
};

/** A screen with nobody touching: show each round's mystery, then its answer. */
export const playAt = (t: number): MysteryState => {
  const k = Math.floor(t / 8);
  return { round: k % ORDER.length, wrong: 0, solved: t % 8 > 5, use: -1 };
};
