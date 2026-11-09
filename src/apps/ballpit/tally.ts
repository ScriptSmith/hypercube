/**
 * Today's votes per question, kept so that any frame can merge any other frame's copy without
 * counting a vote twice. Each frame counts the votes it takes in its own row (one count per
 * answer); a question's totals are the sum of the rows. A vote message carries the sender's new
 * count for that answer, so the vote id is (frame, answer, count): applying it means raising that
 * row to the count, and a duplicate or late copy changes nothing. Merging two copies takes the
 * larger count per frame and answer. Rows are bounded by MAX_ORIGINS, and per answer a row holds
 * one number however many votes it has seen, so there is no growing set of seen ids.
 *
 * Clearing a question starts a new generation (`gen`, a clock time): a higher generation replaces
 * a lower one outright, and votes or copies from an older generation are ignored.
 */
import { questionById } from "./questions";

export interface TallySnapshot {
  /** Generation. */
  g: number;
  /** Frame id to counts per answer. */
  r: Record<string, number[]>;
}

interface QState {
  gen: number;
  rows: Map<string, number[]>;
}

export const MAX_ORIGINS = 48;
export const MAX_COUNT = 1_000_000;
export const MAX_GEN = 1e14;
const ORIGIN = /^[A-Za-z0-9_.:-]{1,64}$/;

export const validOrigin = (s: unknown): s is string => typeof s === "string" && ORIGIN.test(s);

/** A frame id as a row key: any id the host gives maps to one that `validOrigin` accepts. */
export const originOf = (frame: string): string =>
  frame.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64) || "_";

const answersOf = (qid: string): number => questionById(qid)?.answers.length ?? 0;

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT;

const isGen = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_GEN;

/** A checked copy of a snapshot for question `qid`, or null if any part is out of range. */
export const cleanSnapshot = (qid: string, data: unknown): TallySnapshot | null => {
  const k = answersOf(qid);
  if (k === 0 || typeof data !== "object" || data === null) return null;
  const d = data as { g?: unknown; r?: unknown };
  if (!isGen(d.g) || typeof d.r !== "object" || d.r === null || Array.isArray(d.r)) return null;
  const r: Record<string, number[]> = {};
  let rows = 0;
  for (const [origin, counts] of Object.entries(d.r as Record<string, unknown>)) {
    if (!validOrigin(origin) || !Array.isArray(counts) || counts.length !== k) return null;
    if (!counts.every(isCount)) return null;
    if (++rows > MAX_ORIGINS) return null;
    r[origin] = counts.slice();
  }
  return { g: d.g, r };
};

export interface MergeResult {
  /** The totals went up (or, when replaced, changed at all). */
  changed: boolean;
  /** A newer generation replaced this one: totals may have gone down. */
  replaced: boolean;
  /** The copy was from an older generation, or had nothing this one lacked. */
  stale: boolean;
}

export interface Tally {
  readonly day: string;
  /** Bumps on every change, for saving. */
  readonly version: number;
  /** Start `day` afresh, optionally from stored snapshots. */
  reset(day: string, stored?: ReadonlyMap<string, TallySnapshot>): void;
  /** This frame takes a vote. Returns its generation and new count for the vote message. */
  vote(qid: string, origin: string, answer: number): { g: number; n: number } | null;
  /** A vote taken by `origin`. Returns how many votes it added (0 for a repeat). */
  apply(qid: string, g: number, origin: string, answer: number, n: number): number;
  merge(qid: string, snap: TallySnapshot): MergeResult;
  /** This copy has something `snap` lacks: a newer generation or a larger count. */
  ahead(qid: string, snap: TallySnapshot): boolean;
  sums(qid: string): number[];
  total(qid: string): number;
  gen(qid: string): number;
  /** Empty the question, with a generation above any seen. Returns the generation. */
  clear(qid: string, at: number): number;
  snapshot(qid: string): TallySnapshot | null;
  /** Questions with any state today. */
  questions(): string[];
}

export const createTally = (day: string): Tally => {
  let today = day;
  let version = 0;
  const qs = new Map<string, QState>();

  const state = (qid: string): QState | null => {
    let s = qs.get(qid);
    if (!s) {
      if (answersOf(qid) === 0) return null;
      s = { gen: 0, rows: new Map() };
      qs.set(qid, s);
    }
    return s;
  };

  const rowOf = (s: QState, qid: string, origin: string): number[] | null => {
    let row = s.rows.get(origin);
    if (!row) {
      if (s.rows.size >= MAX_ORIGINS) return null;
      row = Array.from({ length: answersOf(qid) }, () => 0);
      s.rows.set(origin, row);
    }
    return row;
  };

  const tally: Tally = {
    get day() {
      return today;
    },
    get version() {
      return version;
    },
    reset(d, stored) {
      today = d;
      qs.clear();
      version++;
      if (!stored) return;
      for (const [qid, snap] of stored) {
        const clean = cleanSnapshot(qid, snap);
        if (clean) tally.merge(qid, clean);
      }
    },
    vote(qid, origin, answer) {
      const s = state(qid);
      if (!s || !validOrigin(origin) || answer < 0 || answer >= answersOf(qid)) return null;
      const row = rowOf(s, qid, origin);
      if (!row || row[answer]! >= MAX_COUNT) return null;
      row[answer]!++;
      version++;
      return { g: s.gen, n: row[answer]! };
    },
    apply(qid, g, origin, answer, n) {
      const s = state(qid);
      if (!s || !validOrigin(origin) || !isGen(g) || !isCount(n)) return 0;
      if (!Number.isInteger(answer) || answer < 0 || answer >= answersOf(qid)) return 0;
      if (g < s.gen) return 0;
      if (g > s.gen) {
        s.gen = g;
        s.rows.clear();
        version++;
      }
      const row = rowOf(s, qid, origin);
      if (!row || n <= row[answer]!) return 0;
      const added = n - row[answer]!;
      row[answer] = n;
      version++;
      return added;
    },
    merge(qid, snap) {
      const s = state(qid);
      const none = { changed: false, replaced: false, stale: true };
      if (!s || snap.g < s.gen) return none;
      if (snap.g > s.gen) {
        s.gen = snap.g;
        s.rows.clear();
        for (const [origin, counts] of Object.entries(snap.r)) {
          if (s.rows.size >= MAX_ORIGINS) break;
          s.rows.set(origin, counts.slice());
        }
        version++;
        return { changed: true, replaced: true, stale: false };
      }
      let changed = false;
      for (const [origin, counts] of Object.entries(snap.r)) {
        const has = s.rows.has(origin);
        if (!has && counts.every((v) => v === 0)) continue;
        const row = rowOf(s, qid, origin);
        if (!row) continue;
        for (let i = 0; i < row.length; i++) {
          const v = counts[i] ?? 0;
          if (v > row[i]!) {
            row[i] = v;
            changed = true;
          }
        }
      }
      if (changed) version++;
      return { changed, replaced: false, stale: !changed };
    },
    ahead(qid, snap) {
      const s = qs.get(qid);
      if (!s) return false;
      if (s.gen !== snap.g) return s.gen > snap.g;
      for (const [origin, row] of s.rows) {
        const other = snap.r[origin];
        for (let i = 0; i < row.length; i++) if (row[i]! > (other?.[i] ?? 0)) return true;
      }
      return false;
    },
    sums(qid) {
      const k = answersOf(qid);
      const out = Array.from({ length: k }, () => 0);
      const s = qs.get(qid);
      if (!s) return out;
      for (const row of s.rows.values()) for (let i = 0; i < k; i++) out[i]! += row[i] ?? 0;
      return out;
    },
    total(qid) {
      return tally.sums(qid).reduce((a, b) => a + b, 0);
    },
    gen(qid) {
      return qs.get(qid)?.gen ?? 0;
    },
    clear(qid, at) {
      const s = state(qid);
      if (!s) return 0;
      s.gen = Math.min(MAX_GEN, Math.max(s.gen + 1, Math.round(at)));
      s.rows.clear();
      version++;
      return s.gen;
    },
    snapshot(qid) {
      const s = qs.get(qid);
      if (!s) return null;
      const r: Record<string, number[]> = {};
      for (const [origin, row] of s.rows) r[origin] = row.slice();
      return { g: s.gen, r };
    },
    questions() {
      return [...qs.keys()];
    },
  };
  return tally;
};
