/**
 * The day's layers of settled ink. Ink that reaches the top of the fluid is measured in COLUMNS
 * strips across the frame and added to the current hour's band: a running sum of colour and
 * amount per strip. Bands are drawn blurred along their length (a Gaussian over about three
 * strips, then interpolated between strips), so a band can only vary gently across the frame and
 * can't hold letters or symbols: each band is one row, one per hour, and nobody chooses the hour.
 *
 * At most MAX_BANDS bands (one per hour). The day is the local date; a new date starts afresh.
 * Bands persist per frame and group in local storage, so a reload keeps the day.
 */
import type { Rgb } from "./palette";

export const COLUMNS = 32;
export const MAX_BANDS = 24;
export const PREFIX = "hc.kaleido.v1.";
/** Kaleido keys kept across frames and groups; older days and extras are pruned. */
export const MAX_KEYS = 16;
const MAX_AMOUNT = 1e7;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Settled amount at which a band's colour reaches about two thirds of its brightest. */
export const BAND_AMOUNT = 300;
/**
 * Settled amount at which a band reaches about two thirds of its thickest: roughly an hour of a
 * few people pouring at once on a wall, so busy hours stand out from quiet ones.
 */
export const THICK_AMOUNT = 2500;
const MIN_THICK = 0.035;
const MAX_THICK = 0.16;
/** Gaussian blur along a band, in strips. */
const BLUR_SIGMA = 2.2;
const BLUR_RADIUS = 6;

export interface Band {
  hour: number;
  /** Per strip: amount-weighted sum of colour, three values a strip. */
  rgb: Float64Array;
  amount: Float64Array;
}

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
  keys(): string[];
}

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

/** Local date as YYYY-MM-DD. */
export const dayKey = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const newBand = (hour: number): Band => ({
  hour,
  rgb: new Float64Array(COLUMNS * 3),
  amount: new Float64Array(COLUMNS),
});

export const bandTotal = (b: Band): number => {
  let s = 0;
  for (let i = 0; i < COLUMNS; i++) s += b.amount[i]!;
  return s;
};

/** Fraction of the layers' zone a band takes before the stack is squeezed to fit. */
export const bandThickness = (amount: number): number =>
  MIN_THICK + (MAX_THICK - MIN_THICK) * (1 - Math.exp(-Math.max(0, amount) / THICK_AMOUNT));

const KERNEL = (() => {
  const k: number[] = [];
  for (let i = -BLUR_RADIUS; i <= BLUR_RADIUS; i++)
    k.push(Math.exp(-(i * i) / (2 * BLUR_SIGMA ** 2)));
  return k;
})();

export interface BandLook {
  /** Per strip RGB (0 to 1), three values a strip. */
  rgb: Float32Array;
  /** Per strip brightness, 0 to 1. */
  level: Float32Array;
}

/** A band as drawn: blurred along its length and shaded by how much ink settled. */
export const bandLook = (b: Band): BandLook => {
  const total = bandTotal(b);
  const mean: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < COLUMNS; i++) {
    for (let c = 0; c < 3; c++) mean[c]! += b.rgb[i * 3 + c]!;
  }
  for (let c = 0; c < 3; c++) mean[c] = total > 0 ? mean[c]! / total : 0.5;
  // Strips with little ink lean towards the band's mean colour.
  const prior = Math.max(1e-6, (0.3 * total) / COLUMNS);
  const bandLevel = 1 - Math.exp(-total / BAND_AMOUNT);
  const rgb = new Float32Array(COLUMNS * 3);
  const level = new Float32Array(COLUMNS);
  for (let i = 0; i < COLUMNS; i++) {
    let w = 0;
    let a = 0;
    const s = [0, 0, 0];
    for (let k = -BLUR_RADIUS; k <= BLUR_RADIUS; k++) {
      const j = i + k;
      if (j < 0 || j >= COLUMNS) continue;
      const kw = KERNEL[k + BLUR_RADIUS]!;
      w += kw;
      a += kw * b.amount[j]!;
      for (let c = 0; c < 3; c++) s[c]! += kw * b.rgb[j * 3 + c]!;
    }
    const amt = a / w;
    for (let c = 0; c < 3; c++) {
      rgb[i * 3 + c] = Math.min(1, (s[c]! / w + prior * mean[c]!) / (amt + prior));
    }
    const colLevel = 1 - Math.exp((-amt * COLUMNS) / (2 * BAND_AMOUNT));
    level[i] = Math.min(1, 0.45 * bandLevel + 0.55 * colLevel);
  }
  return { rgb, level };
};

export interface StrataOptions {
  kv: KV;
  /** Storage key suffix (frame and group), or null to keep nothing (preview frames). */
  key: string | null;
  today: string;
}

export interface Strata {
  readonly day: string;
  readonly bands: readonly Band[];
  /** Bumped on every change, so views redraw only when needed. */
  readonly version: number;
  /** Add settled ink to `hour`'s band in strip `col`. */
  add(hour: number, col: number, rgb: Rgb, amount: number): void;
  /** Start afresh if the date changed. Returns true if it did. */
  roll(today: string): boolean;
  clear(): void;
  /** Write to storage if anything changed. */
  save(): boolean;
  /** Fractions of the zone each band takes, top (earliest) first, squeezed to fit. */
  thicknesses(): number[];
}

interface Stored {
  v: 1;
  d: string;
  b: [number, number[], number[]][];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Bands from storage, or null for anything malformed. */
export const parseStored = (raw: string | null, today: string): Band[] | null => {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const s = data as Partial<Stored>;
  if (s.v !== 1 || s.d !== today || !Array.isArray(s.b) || s.b.length > MAX_BANDS) return null;
  const out: Band[] = [];
  const seen = new Set<number>();
  for (const entry of s.b) {
    if (!Array.isArray(entry) || entry.length !== 3) return null;
    const [hour, amount, rgb] = entry as unknown[];
    if (!finite(hour) || !Number.isInteger(hour) || hour < 0 || hour > 23 || seen.has(hour)) {
      return null;
    }
    if (!Array.isArray(amount) || amount.length !== COLUMNS) return null;
    if (!Array.isArray(rgb) || rgb.length !== COLUMNS * 3) return null;
    const b = newBand(hour);
    for (let i = 0; i < COLUMNS; i++) {
      const a = amount[i];
      if (!finite(a) || a < 0) return null;
      b.amount[i] = Math.min(MAX_AMOUNT, a);
    }
    for (let i = 0; i < COLUMNS * 3; i++) {
      const v = rgb[i];
      if (!finite(v) || v < 0) return null;
      // A strip's colour sum can't exceed its amount.
      b.rgb[i] = Math.min(b.amount[Math.floor(i / 3)]!, v);
    }
    seen.add(hour);
    out.push(b);
  }
  out.sort((a, b) => a.hour - b.hour);
  return out;
};

const round = (v: number) => Math.round(v * 1000) / 1000;

export const serialize = (day: string, bands: readonly Band[]): string =>
  JSON.stringify({
    v: 1,
    d: day,
    b: bands.map((b) => [b.hour, Array.from(b.amount, round), Array.from(b.rgb, round)]),
  } satisfies Stored);

/** Drop other days' keys and anything beyond MAX_KEYS (keeping `keep`). */
export const prune = (kv: KV, today: string, keep: string | null): void => {
  const mine = kv.keys().filter((k) => k.startsWith(PREFIX));
  const fresh: string[] = [];
  for (const k of mine) {
    if (k === keep) continue;
    const raw = kv.get(k);
    let d: unknown = null;
    try {
      d = raw ? (JSON.parse(raw) as { d?: unknown }).d : null;
    } catch {
      d = null;
    }
    if (typeof d !== "string" || !DAY.test(d) || d !== today) kv.remove(k);
    else fresh.push(k);
  }
  const room = MAX_KEYS - (keep ? 1 : 0);
  for (const k of fresh.slice(0, Math.max(0, fresh.length - room))) kv.remove(k);
};

export const createStrata = (opts: StrataOptions): Strata => {
  const storeKey = opts.key === null ? null : PREFIX + opts.key;
  let day = opts.today;
  let bands: Band[] = (storeKey ? parseStored(opts.kv.get(storeKey), day) : null) ?? [];
  let version = 1;
  let dirty = false;
  if (storeKey) prune(opts.kv, day, storeKey);

  const bandFor = (hour: number): Band | null => {
    const h = Math.floor(hour);
    if (h < 0 || h > 23) return null;
    let b = bands.find((x) => x.hour === h);
    if (!b) {
      if (bands.length >= MAX_BANDS) return null;
      b = newBand(h);
      bands.push(b);
      bands.sort((x, y) => x.hour - y.hour);
    }
    return b;
  };

  return {
    get day() {
      return day;
    },
    get bands() {
      return bands;
    },
    get version() {
      return version;
    },
    add(hour, col, rgb, amount) {
      if (!(amount > 0) || !Number.isFinite(amount)) return;
      const c = Math.floor(col);
      if (c < 0 || c >= COLUMNS) return;
      const b = bandFor(hour);
      if (!b) return;
      const room = MAX_AMOUNT - b.amount[c]!;
      const a = Math.min(amount, room);
      if (a <= 0) return;
      b.amount[c]! += a;
      for (let k = 0; k < 3; k++) {
        const v = rgb[k] ?? 0;
        b.rgb[c * 3 + k]! += a * (v < 0 ? 0 : v > 1 ? 1 : v);
      }
      version++;
      dirty = true;
    },
    roll(today) {
      if (today === day) return false;
      day = today;
      bands = [];
      version++;
      dirty = true;
      if (storeKey) prune(opts.kv, day, storeKey);
      return true;
    },
    clear() {
      bands = [];
      version++;
      dirty = true;
    },
    save() {
      if (!dirty || !storeKey) return false;
      dirty = false;
      if (bands.length === 0) {
        opts.kv.remove(storeKey);
        return true;
      }
      return opts.kv.set(storeKey, serialize(day, bands));
    },
    thicknesses() {
      const t = bands.map((b) => bandThickness(bandTotal(b)));
      const sum = t.reduce((a, b) => a + b, 0);
      return sum > 1 ? t.map((x) => x / sum) : t;
    },
  };
};
