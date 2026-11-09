import type { FrameKind, Reach } from "./types";

/**
 * A display type in an installation. Pixel sizes are what the host reports for one display;
 * physical sizes are approximate and only drive defaults (reach) and the simulator's drawing.
 */
export interface DisplaySpec {
  width: number;
  height: number;
  /** Metres. */
  widthM: number;
  heightM: number;
  /** Height of the bottom edge above the floor, in metres. */
  bottomM: number;
  touch: boolean;
}

/**
 * A display wrapped round a ball. Its feed is one equirectangular picture: columns run once
 * round, rows from `coverTop` down to `coverBottom` latitude. Physical sizes drive the visible
 * band and the simulator.
 */
export interface SphereSpec {
  width: number;
  height: number;
  /** Metres. */
  diameterM: number;
  /** Height of the lowest point above the floor, in metres. */
  bottomM: number;
  /** Degrees of latitude at the feed's top and bottom rows (90 and -90 for a whole sphere). */
  coverTop: number;
  coverBottom: number;
  /** Degrees of latitude people see well. Absent, it is worked out from where the ball hangs. */
  view?: { top: number; bottom: number };
  /** People also watch from a gallery round the room, about level with the ball. */
  gallery?: boolean;
}

export interface VenueProfile {
  /** One portrait touch panel. Banks are rows of these. */
  panel: DisplaySpec;
  /** Most adjacent panels one machine can merge into a single surface. */
  maxMerge: number;
  /** Panels in a bank, by default. */
  bankCount: number;
  /** Gap between adjacent panels (bezels), in metres. */
  bezelM: number;
  /** The non-touch screen above a bank. It spans the bank's width exactly. */
  screen: DisplaySpec;
  wall: DisplaySpec;
  kiosk: DisplaySpec;
  sphere: SphereSpec;
}

/** Comfortable reach above the floor, in metres, for an adult and a young child. */
export const ADULT_REACH_M = 2.2;
export const CHILD_REACH_M = 1.5;

/**
 * A plausible installation built from ordinary displays. A real one passes its own sizes in
 * the `venue` URL parameter (see `parseVenue`).
 */
export const DEFAULT_VENUE: VenueProfile = {
  panel: { width: 1080, height: 1920, widthM: 0.81, heightM: 1.44, bottomM: 0.75, touch: true },
  maxMerge: 2,
  bankCount: 6,
  bezelM: 0.02,
  screen: { width: 4000, height: 3600, widthM: 5, heightM: 4.5, bottomM: 2.3, touch: false },
  wall: { width: 5760, height: 2160, widthM: 12, heightM: 4.5, bottomM: 0.2, touch: true },
  kiosk: { width: 1920, height: 1080, widthM: 1.1, heightM: 0.62, bottomM: 0.8, touch: true },
  // An LED ball hung from a ceiling, people walking underneath.
  sphere: {
    width: 4096,
    height: 2048,
    diameterM: 4,
    bottomM: 3,
    coverTop: 90,
    coverBottom: -90,
  },
};

let active: VenueProfile = DEFAULT_VENUE;

/** This page's venue: the defaults with the `venue` URL parameter, or the operator's profile. */
export const activeVenue = (): VenueProfile => active;

/** The runtime, the landing panel and the simulator set this before anything reads sizes. */
export const setActiveVenue = (venue: VenueProfile): void => {
  active = venue;
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Reach as fractions of the display's height, from its physical mounting. */
export const reachFor = (d: DisplaySpec): Reach =>
  d.touch
    ? {
        adult: clamp01((ADULT_REACH_M - d.bottomM) / d.heightM),
        child: clamp01((CHILD_REACH_M - d.bottomM) / d.heightM),
      }
    : { adult: 0, child: 0 };

/** A sphere as a flat display spec: its feed's pixels, and its outline seen from the side. */
export const sphereDisplay = (s: SphereSpec): DisplaySpec => ({
  width: s.width,
  height: s.height,
  widthM: s.diameterM,
  heightM: s.diameterM,
  bottomM: s.bottomM,
  touch: false,
});

/** The display spec behind a frame kind. A merged frame is `span` panels side by side. */
export const displayFor = (
  kind: FrameKind,
  span = 1,
  venue: VenueProfile = activeVenue(),
): DisplaySpec => {
  switch (kind) {
    case "panel":
      return venue.panel;
    case "pair": {
      const n = Math.max(2, span);
      return {
        ...venue.panel,
        width: venue.panel.width * n,
        widthM: venue.panel.widthM * n + venue.bezelM * (n - 1),
      };
    }
    case "screen":
      return venue.screen;
    case "wall":
      return venue.wall;
    case "kiosk":
      return venue.kiosk;
    case "sphere":
      return sphereDisplay(venue.sphere);
  }
};

/*
 * The `venue` URL parameter: any part of a profile, as comma-separated entries of
 * colon-separated parts. An empty part keeps the default, and so does anything malformed.
 *
 *   panel:<w>x<h>:<w m>x<h m>:<bottom m>[:<touch 1|0>]   likewise screen, wall and kiosk
 *   bank:<panels>   merge:<panels>   bezel:<m>
 *   sphere:<w>x<h>:<diameter m>:<bottom m>
 *   cover:<top>:<bottom>   view:<top>:<bottom>   (degrees of latitude)
 *   gallery:<1|0>
 *
 * For example `wall:7680x2880:16x6:0.1,bank:8`, or `sphere::3:2.5` for a 3 m ball 2.5 m up.
 */

/** Any part of a venue profile. */
export interface VenuePatch {
  panel?: Partial<DisplaySpec>;
  screen?: Partial<DisplaySpec>;
  wall?: Partial<DisplaySpec>;
  kiosk?: Partial<DisplaySpec>;
  sphere?: Partial<SphereSpec>;
  maxMerge?: number;
  bankCount?: number;
  bezelM?: number;
}

export interface VenueParse {
  patch: VenuePatch;
  /** Entries that were not understood, as written. */
  ignored: string[];
}

type DisplayKey = "panel" | "screen" | "wall" | "kiosk";
const DISPLAY_KEYS: readonly DisplayKey[] = ["panel", "screen", "wall", "kiosk"];

type Range = readonly [number, number];
const PX: Range = [100, 32768];
const METRES: Range = [0.05, 200];
const HEIGHT: Range = [0, 200];
const LATITUDE: Range = [-90, 90];
/** The landing panel and the simulator offer up to 20 frames in a bank. */
const BANK: Range = [1, 20];
const MERGE: Range = [1, 8];
const BEZEL: Range = [0, 1];

const MAX_LENGTH = 1000;
const MAX_ENTRIES = 32;
const NUMBER = /^-?\d+(\.\d+)?$|^-?\.\d+$/;

/** A number within range (clamped), or null when the text isn't a plain number. */
const readNumber = (text: string, [lo, hi]: Range, integer = false): number | null => {
  const t = text.trim();
  if (!NUMBER.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const v = Math.min(hi, Math.max(lo, n));
  return integer ? Math.round(v) : v;
};

/** `<a>x<b>`, or null. */
const readPair = (text: string, range: Range, integer = false): [number, number] | null => {
  const parts = text.split("x");
  if (parts.length !== 2) return null;
  const a = readNumber(parts[0] ?? "", range, integer);
  const b = readNumber(parts[1] ?? "", range, integer);
  return a !== null && b !== null ? [a, b] : null;
};

const readFlag = (text: string): boolean | null =>
  text === "1" ? true : text === "0" ? false : null;

/**
 * Reads the parts of one entry in order. Each reader returns the fields it sets, or null when
 * its part is malformed; an empty part sets nothing. A malformed part drops the whole entry,
 * so a typo never half-applies.
 */
const readParts = <T extends object>(
  parts: readonly string[],
  readers: readonly ((text: string) => Partial<T> | null)[],
): Partial<T> | null => {
  if (parts.length === 0 || parts.length > readers.length) return null;
  const out: Partial<T> = {};
  let any = false;
  for (let i = 0; i < parts.length; i++) {
    const text = parts[i]?.trim() ?? "";
    if (text === "") continue;
    const fields = readers[i]?.(text) ?? null;
    if (!fields) return null;
    Object.assign(out, fields);
    any = true;
  }
  return any ? out : null;
};

const pixels = (text: string) => {
  const p = readPair(text, PX, true);
  return p ? { width: p[0], height: p[1] } : null;
};

const displayReaders: readonly ((text: string) => Partial<DisplaySpec> | null)[] = [
  pixels,
  (text) => {
    const p = readPair(text, METRES);
    return p ? { widthM: p[0], heightM: p[1] } : null;
  },
  (text) => {
    const n = readNumber(text, HEIGHT);
    return n === null ? null : { bottomM: n };
  },
  (text) => {
    const t = readFlag(text);
    return t === null ? null : { touch: t };
  },
];

const sphereReaders: readonly ((text: string) => Partial<SphereSpec> | null)[] = [
  pixels,
  (text) => {
    const n = readNumber(text, METRES);
    return n === null ? null : { diameterM: n };
  },
  (text) => {
    const n = readNumber(text, HEIGHT);
    return n === null ? null : { bottomM: n };
  },
];

/** Two different latitudes, either order. */
const readBand = (parts: readonly string[]): { top: number; bottom: number } | null => {
  if (parts.length !== 2) return null;
  const a = readNumber(parts[0] ?? "", LATITUDE);
  const b = readNumber(parts[1] ?? "", LATITUDE);
  if (a === null || b === null || a === b) return null;
  return { top: Math.max(a, b), bottom: Math.min(a, b) };
};

const readSingle = (parts: readonly string[], range: Range, integer = false): number | null =>
  parts.length === 1 ? readNumber(parts[0] ?? "", range, integer) : null;

/** Apply one entry to `patch`; false if it isn't understood. */
const readEntry = (patch: VenuePatch, entry: string): boolean => {
  const [key = "", ...parts] = entry.split(":");
  const name = key.trim().toLowerCase();
  if ((DISPLAY_KEYS as readonly string[]).includes(name)) {
    const fields = readParts(parts, displayReaders);
    if (!fields) return false;
    const k = name as DisplayKey;
    patch[k] = { ...patch[k], ...fields };
    return true;
  }
  switch (name) {
    case "sphere": {
      const fields = readParts(parts, sphereReaders);
      if (!fields) return false;
      patch.sphere = { ...patch.sphere, ...fields };
      return true;
    }
    case "cover": {
      const band = readBand(parts);
      if (!band) return false;
      patch.sphere = { ...patch.sphere, coverTop: band.top, coverBottom: band.bottom };
      return true;
    }
    case "view": {
      const band = readBand(parts);
      if (!band) return false;
      patch.sphere = { ...patch.sphere, view: band };
      return true;
    }
    case "gallery": {
      const on = parts.length === 1 ? readFlag(parts[0]?.trim() ?? "") : null;
      if (on === null) return false;
      patch.sphere = { ...patch.sphere, gallery: on };
      return true;
    }
    case "bank": {
      const n = readSingle(parts, BANK, true);
      if (n === null) return false;
      patch.bankCount = n;
      return true;
    }
    case "merge": {
      const n = readSingle(parts, MERGE, true);
      if (n === null) return false;
      patch.maxMerge = n;
      return true;
    }
    case "bezel": {
      const n = readSingle(parts, BEZEL);
      if (n === null) return false;
      patch.bezelM = n;
      return true;
    }
    default:
      return false;
  }
};

/**
 * Read a `venue` value. It comes from a URL anyone can write, so every number is checked and
 * clamped, and entries that don't parse are ignored (and listed).
 */
export const parseVenue = (text: string | null | undefined): VenueParse => {
  const patch: VenuePatch = {};
  const ignored: string[] = [];
  if (!text) return { patch, ignored };
  const entries = text
    .slice(0, MAX_LENGTH)
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    if (!readEntry(patch, entry)) ignored.push(entry);
  }
  ignored.push(...entries.slice(MAX_ENTRIES));
  return { patch, ignored };
};

/** `base` with any part of it replaced. */
export const mergeVenue = (
  base: VenueProfile,
  patch: VenuePatch | null | undefined,
): VenueProfile =>
  patch
    ? {
        panel: { ...base.panel, ...patch.panel },
        maxMerge: patch.maxMerge ?? base.maxMerge,
        bankCount: patch.bankCount ?? base.bankCount,
        bezelM: patch.bezelM ?? base.bezelM,
        screen: { ...base.screen, ...patch.screen },
        wall: { ...base.wall, ...patch.wall },
        kiosk: { ...base.kiosk, ...patch.kiosk },
        sphere: { ...base.sphere, ...patch.sphere },
      }
    : base;

/** The default venue with a `venue` value applied. */
export const venueFromParam = (text: string | null | undefined): VenueProfile =>
  mergeVenue(DEFAULT_VENUE, parseVenue(text).patch);

const fmt = (n: number): string => String(Number(n.toFixed(4)));

/** Equal as written, so float noise from arithmetic on a profile never shows as a change. */
const same = (a: number, b: number): boolean => fmt(a) === fmt(b);

const sameDisplay = (a: DisplaySpec, b: DisplaySpec): boolean =>
  a.width === b.width &&
  a.height === b.height &&
  same(a.widthM, b.widthM) &&
  same(a.heightM, b.heightM) &&
  same(a.bottomM, b.bottomM) &&
  a.touch === b.touch;

/**
 * The `venue` value for `venue`: only what differs from `base`, or everything when `base` is
 * null. An entry is written whole, so it reads on its own. Empty when nothing differs.
 */
export const encodeVenue = (
  venue: VenueProfile,
  base: VenueProfile | null = DEFAULT_VENUE,
): string => {
  const out: string[] = [];
  const display = (key: DisplayKey) => {
    const d = venue[key];
    if (base && sameDisplay(d, base[key])) return;
    const touch = d.touch !== (base ?? DEFAULT_VENUE)[key].touch ? `:${d.touch ? 1 : 0}` : "";
    out.push(
      `${key}:${d.width}x${d.height}:${fmt(d.widthM)}x${fmt(d.heightM)}:${fmt(d.bottomM)}${touch}`,
    );
  };
  display("panel");
  if (!base || venue.bankCount !== base.bankCount) out.push(`bank:${venue.bankCount}`);
  if (!base || venue.maxMerge !== base.maxMerge) out.push(`merge:${venue.maxMerge}`);
  if (!base || !same(venue.bezelM, base.bezelM)) out.push(`bezel:${fmt(venue.bezelM)}`);
  display("screen");
  display("wall");
  display("kiosk");
  const s = venue.sphere;
  const b = base?.sphere;
  if (
    !b ||
    s.width !== b.width ||
    s.height !== b.height ||
    !same(s.diameterM, b.diameterM) ||
    !same(s.bottomM, b.bottomM)
  ) {
    out.push(`sphere:${s.width}x${s.height}:${fmt(s.diameterM)}:${fmt(s.bottomM)}`);
  }
  if (!b || !same(s.coverTop, b.coverTop) || !same(s.coverBottom, b.coverBottom)) {
    out.push(`cover:${fmt(s.coverTop)}:${fmt(s.coverBottom)}`);
  }
  if (
    s.view &&
    (!b?.view || !same(s.view.top, b.view.top) || !same(s.view.bottom, b.view.bottom))
  ) {
    out.push(`view:${fmt(s.view.top)}:${fmt(s.view.bottom)}`);
  }
  if ((s.gallery ?? false) !== (b?.gallery ?? false)) out.push(`gallery:${s.gallery ? 1 : 0}`);
  return out.join(",");
};
