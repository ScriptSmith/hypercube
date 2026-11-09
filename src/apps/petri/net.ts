import { type Family, isFamily, stampAt } from "./stamps";

/**
 * Messages between the touch frames of a bank and the screen that owns the dish. No simulation
 * state crosses the network: panels send drops and their dial positions, and the screen sends back
 * which rules its dish runs. Every decoder checks every field and returns null for anything else.
 */
export const TOPIC_DROP = "pt:drop";
export const TOPIC_COND = "pt:cond";
export const TOPIC_DISH = "pt:dish";
export const TOPIC_LANDED = "pt:landed";

/** A panel re-sends its condition this often, so a reloaded screen recovers it. */
export const COND_EVERY_MS = 10_000;
/** The screen announces its dish this often. */
export const DISH_EVERY_MS = 2000;
/** A panel with no dish news for this long runs its own culture. */
export const DISH_TIMEOUT_MS = 6000;
/** A slice not heard from for this long goes back to the default condition. */
export const SLICE_TIMEOUT_MS = 30_000;

const MAX_POS = 16;
const MAX_PADS = 4;

export interface DropMsg {
  id: number;
  fam: Family;
  /** Stamp index in the family's catalogue. */
  s: number;
  pos: number;
  pad: number;
  /** Fraction across the sending frame. */
  u: number;
  /** Flick strength, 0 to 1. */
  f: number;
  /** Rotation (low two bits) and reflection (bit 2). */
  r: number;
  seed: number;
  /** Release time on the shared clock. */
  t: number;
  /** Colour or strain. */
  c: number;
  /** Sent by a bot or the attract script, so the screen doesn't count it as a visitor. */
  a: boolean;
}

export interface CondMsg {
  fam: Family;
  pos: number;
  pad: number;
  pads: number;
  v: number;
}

export interface DishMsg {
  fam: Family;
  /** Condition per touch frame and pad, or a single condition for the whole dish. */
  s: number[][];
  one: boolean;
}

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const unit = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= 1;
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export const decodeDrop = (data: unknown): DropMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const { id, fam, s, pos, pad, u, f, r, seed, t, c, a } = d;
  if (!int(id, 0, 2 ** 31) || !isFamily(fam) || !int(s, 0, 31) || stampAt(fam, s) === null) {
    return null;
  }
  if (!int(pos, 0, MAX_POS - 1) || !int(pad, 0, MAX_PADS - 1) || !unit(u) || !unit(f)) return null;
  if (!int(r, 0, 7) || !int(seed, 0, 2 ** 31) || !int(c, 0, 15)) return null;
  if (typeof t !== "number" || !Number.isFinite(t) || typeof a !== "boolean") return null;
  return { id, fam, s, pos, pad, u, f, r, seed, t, c, a };
};

export const decodeCond = (data: unknown): CondMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const { fam, pos, pad, pads, v } = d;
  if (!isFamily(fam) || !int(pos, 0, MAX_POS - 1) || !int(pads, 1, MAX_PADS)) return null;
  if (!int(pad, 0, pads - 1) || !int(v, 0, 7)) return null;
  return { fam, pos, pad, pads, v };
};

export const decodeDish = (data: unknown): DishMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const { fam, s, one } = d;
  if (!isFamily(fam) || typeof one !== "boolean" || !Array.isArray(s) || s.length > MAX_POS) {
    return null;
  }
  const rows: number[][] = [];
  for (const row of s) {
    if (!Array.isArray(row) || row.length > MAX_PADS) return null;
    if (!row.every((v) => int(v, 0, 7))) return null;
    rows.push(row as number[]);
  }
  return { fam, s: rows, one };
};

export const decodeLanded = (data: unknown): number | null => {
  const id = obj(data)?.id;
  return int(id, 0, 2 ** 31) ? id : null;
};

/** Time a flicked drop takes to rise off the top of its panel; faster flicks climb faster. */
export const climbMs = (strength: number): number => 650 - 300 * Math.min(1, Math.max(0, strength));

/** Time from entering the bottom of the screen to landing; higher landings take longer. */
export const flightMs = (strength: number): number =>
  900 + 500 * Math.min(1, Math.max(0, strength));

/** The shortest flight the screen shows, when a drop arrives late. */
export const MIN_FLIGHT_MS = 250;

/**
 * When the screen shows a drop's flight, on the shared clock. It enters the screen as it leaves
 * the panel and lands one flight later; network delay is absorbed by shortening the flight, so a
 * drop lands on time unless the delay eats the whole flight.
 */
export const arrival = (
  release: number,
  strength: number,
  now: number,
): { start: number; land: number } => {
  const start = release + climbMs(strength);
  const land = start + flightMs(strength);
  if (now <= start) return { start, land };
  if (now <= land - MIN_FLIGHT_MS) return { start: now, land };
  return { start: now, land: now + MIN_FLIGHT_MS };
};
