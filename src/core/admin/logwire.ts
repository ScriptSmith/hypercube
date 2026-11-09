import { isLogLevel, LOG_CAPACITY, type LogEntry, type LogLevel, type LogQuery } from "../logs";
import { canonical } from "./sign";

/**
 * A frame answers `logs` with one or more signed LOG_REPLY envelopes sent only to the asker.
 * Each part's entries take at most LOG_CHUNK_CHARS of JSON, which keeps the whole envelope under
 * MAX_ENVELOPE_BYTES (8 KB) and the net's 16 KB message cap. A full buffer of long entries is
 * about 25 parts, well inside the hub's relay burst.
 */
export const LOG_REPLY = "logs-reply";
export const LOG_CHUNK_CHARS = 6000;
/** Entries asked of each frame when one command asks many, so a big selection stays small. */
export const LOG_SELECTION_TOTAL = 1200;

export interface WireLog {
  s: number;
  t: number;
  l: LogLevel;
  m: string;
}

export interface LogReply {
  ref: string;
  part: number;
  parts: number;
  /** The frame's LogBuffer.boot. */
  boot: string;
  /** Entries in the frame's buffer, and its error count since it loaded. */
  size: number;
  errors: number;
  entries: WireLog[];
}

/** `since` is a seq for every frame, or per frame a seq that applies only to that page load. */
export type LogSince = number | Record<string, { b: string; s: number }>;

export interface LogRequest {
  limit?: number;
  levels?: LogLevel[];
  since?: LogSince;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const toWire = (e: LogEntry): WireLog => ({ s: e.seq, t: e.t, l: e.level, m: e.msg });

/** Entries split into parts of at most `budget` characters of JSON each, oldest first. */
export const chunkEntries = (
  entries: readonly LogEntry[],
  budget = LOG_CHUNK_CHARS,
): WireLog[][] => {
  const parts: WireLog[][] = [];
  let part: WireLog[] = [];
  let used = 2;
  for (const e of entries) {
    const w = toWire(e);
    const size = canonical(w).length + 1;
    if (part.length > 0 && used + size > budget) {
      parts.push(part);
      part = [];
      used = 2;
    }
    part.push(w);
    used += size;
  }
  if (part.length > 0) parts.push(part);
  return parts;
};

/** The query a frame runs for a `logs` command's arguments. */
export const readLogRequest = (args: unknown, frame: string, boot: string): LogQuery => {
  const a = isRecord(args) ? args : {};
  const query: LogQuery = { limit: 100 };
  if (typeof a.limit === "number" && Number.isFinite(a.limit)) {
    query.limit = Math.max(1, Math.min(LOG_CAPACITY, Math.round(a.limit)));
  }
  if (Array.isArray(a.levels)) query.levels = a.levels.filter(isLogLevel);
  if (typeof a.since === "number" && Number.isFinite(a.since)) {
    query.since = a.since;
  } else if (isRecord(a.since)) {
    const mine = a.since[frame];
    // A seq from an earlier page load means nothing now, so the frame sends its latest instead.
    if (isRecord(mine) && mine.b === boot && typeof mine.s === "number") query.since = mine.s;
  }
  return query;
};

export const readLogReply = (v: unknown): LogReply | null => {
  if (!isRecord(v) || !Array.isArray(v.entries)) return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const part = num(v.part);
  const parts = num(v.parts);
  if (typeof v.ref !== "string" || typeof v.boot !== "string" || part === null || parts === null) {
    return null;
  }
  const entries: WireLog[] = [];
  for (const e of v.entries.slice(0, LOG_CAPACITY)) {
    if (!isRecord(e) || !isLogLevel(e.l) || typeof e.m !== "string") continue;
    const s = num(e.s);
    const t = num(e.t);
    if (s === null || t === null) continue;
    entries.push({ s, t, l: e.l, m: e.m.slice(0, 2000) });
  }
  return {
    ref: v.ref,
    part,
    parts,
    boot: v.boot.slice(0, 32),
    size: num(v.size) ?? 0,
    errors: num(v.errors) ?? 0,
    entries,
  };
};
