/**
 * Daily totals in local storage, so they survive the runtime's twice-daily reload. One key per
 * frame, group and day holds every question's tally snapshot (tally.ts). At most KEEP_DAYS days
 * are kept and older or malformed keys are pruned, as is anything beyond MAX_KEYS. Every access
 * is wrapped, because storage can be missing, full or blocked.
 */
import { KEEP_DAYS } from "./config";
import { cleanSnapshot, type Tally, type TallySnapshot } from "./tally";

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
  keys(): string[];
}

export const PREFIX = "hc.ballpit.v1.";
/** Ballpit keys kept in one origin's storage, across frames and groups. */
export const MAX_KEYS = 64;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const browserKV = (): KV => {
  const ls = (): Storage | null => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        return ls()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        const s = ls();
        if (!s) return false;
        s.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        ls()?.removeItem(key);
      } catch {
        // Nothing to do without storage.
      }
    },
    keys() {
      try {
        const s = ls();
        if (!s) return [];
        const out: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k !== null) out.push(k);
        }
        return out;
      } catch {
        return [];
      }
    },
  };
};

export const memoryKV = (): KV => {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set(k, v) {
      m.set(k, v);
      return true;
    },
    remove: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
};

/** A storage-safe scope for one frame's view of one group. */
export const scopeOf = (frame: string, group: string): string =>
  `${frame}~${group}`.replace(/[^A-Za-z0-9_~-]/g, "_").slice(0, 96);

export const keyFor = (scope: string, day: string): string => `${PREFIX}${scope}.${day}`;

const pad = (v: number, w = 2) => String(v).padStart(w, "0");

/** The calendar day of clock time `ms` at a UTC offset in minutes, as YYYY-MM-DD. */
export const dayOf = (ms: number, offsetMin: number): string => {
  const d = new Date(ms + offsetMin * 60_000);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** This machine's UTC offset in minutes at `ms`. Venue machines share a time zone. */
export const localOffset = (ms: number): number => -new Date(ms).getTimezoneOffset();

export const addDays = (day: string, delta: number): string => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return dayOf(Date.UTC(y, m - 1, d) + delta * 86_400_000, 0);
};

export const loadDay = (kv: KV, scope: string, day: string): Map<string, TallySnapshot> => {
  const out = new Map<string, TallySnapshot>();
  const raw = kv.get(keyFor(scope, day));
  if (!raw) return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  const qs = (data as { q?: unknown } | null)?.q;
  if (typeof qs !== "object" || qs === null) return out;
  for (const [qid, snap] of Object.entries(qs as Record<string, unknown>)) {
    const clean = cleanSnapshot(qid, snap);
    if (clean) out.set(qid, clean);
  }
  return out;
};

export const saveDay = (kv: KV, scope: string, tally: Tally): boolean => {
  const q: Record<string, TallySnapshot> = {};
  for (const qid of tally.questions()) {
    const snap = tally.snapshot(qid);
    if (snap && (snap.g > 0 || Object.keys(snap.r).length > 0)) q[qid] = snap;
  }
  return kv.set(keyFor(scope, tally.day), JSON.stringify({ q }));
};

/** Sums per answer for one question on one stored day, or null if nothing was stored. */
export const storedSums = (
  kv: KV,
  scope: string,
  day: string,
  qid: string,
  answers: number,
): number[] | null => {
  const snap = loadDay(kv, scope, day).get(qid);
  if (!snap) return null;
  const out = Array.from({ length: answers }, () => 0);
  for (const row of Object.values(snap.r)) for (let i = 0; i < answers; i++) out[i]! += row[i] ?? 0;
  return out;
};

/** Drop days before the last KEEP_DAYS, malformed keys, and the oldest beyond MAX_KEYS. */
export const prune = (kv: KV, today: string, keep = KEEP_DAYS, maxKeys = MAX_KEYS): number => {
  const oldest = addDays(today, -(keep - 1));
  const kept: { key: string; day: string }[] = [];
  let removed = 0;
  for (const key of kv.keys()) {
    if (!key.startsWith(PREFIX)) continue;
    const day = key.slice(key.lastIndexOf(".") + 1);
    if (!DAY.test(day) || day < oldest) {
      kv.remove(key);
      removed++;
    } else kept.push({ key, day });
  }
  if (kept.length > maxKeys) {
    kept.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    for (const k of kept.slice(0, kept.length - maxKeys)) {
      kv.remove(k.key);
      removed++;
    }
  }
  return removed;
};
