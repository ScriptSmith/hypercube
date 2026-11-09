/**
 * Messages within a bank. The board is never sent: every frame generates it from the spec.
 *
 * - `bb:ev`   one event of a patch, to every frame in the group
 * - `bb:beat` each frame's heartbeat: its mode, its geometry, and (when it holds the shared
 *             patch) the patch with its event count and fingerprint
 * - `bb:sync` a request for a patch's log
 * - `bb:log`  the log, in chunks of at most CHUNK events
 *
 * Every decoder checks every field and returns null for anything else.
 */
import { decodeSpec, encodeSpec, MAX_COLS, MAX_ROWS, type Spec } from "./board";
import { CHUNK } from "./config";
import type { Ev, Kind } from "./patch";

export const TOPIC_EV = "bb:ev";
export const TOPIC_BEAT = "bb:beat";
export const TOPIC_SYNC = "bb:sync";
export const TOPIC_LOG = "bb:log";

export type BeatMode = "j" | "s" | "l";

export interface Geometry {
  /** Columns of one touch frame, rows, and child rows. */
  w: number;
  r: number;
  k: number;
}

export interface Beat {
  m: BeatMode;
  /** Present on touch frames. */
  g: Geometry | null;
  /** The shared patch this frame holds, in mode "s". */
  p: Spec | null;
  e: number;
  x: number;
}

export interface LiveEv {
  b: number;
  n: number;
  ev: Omit<Ev, "s">;
}

export interface LogChunk {
  p: Spec;
  i: number;
  m: number;
  events: Ev[];
}

const MAX_CELLS = MAX_COLS * MAX_ROWS;
const MAX_CHUNKS = 64;

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const kind = (v: unknown): v is Kind => int(v, 0, 5);
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 96;

export const encodeEv = (b: number, n: number, e: Ev) => ({
  p: [b, n],
  e: [e.k, e.c, Math.round(e.t), e.q, e.h ? 1 : 0],
});

export const decodeEv = (data: unknown, from: string): (LiveEv & { s: string }) | null => {
  const d = obj(data);
  if (!d || !id(from)) return null;
  const { p, e } = d;
  if (!Array.isArray(p) || p.length !== 2 || !Array.isArray(e) || e.length !== 5) return null;
  const [b, n] = p;
  const [k, c, t, q, h] = e;
  if (!int(b, 0, 2 ** 32 - 1) || !int(n, 0, 2 ** 31)) return null;
  if (!kind(k) || !int(c, 0, MAX_CELLS - 1) || !finite(t) || !int(q, 0, Number.MAX_SAFE_INTEGER))
    return null;
  if (h !== 0 && h !== 1) return null;
  return { b, n, s: from, ev: { k, c, t, q, h: h === 1 } };
};

export const encodeBeat = (b: Beat) => ({
  m: b.m,
  ...(b.g ? { g: [b.g.w, b.g.r, b.g.k] } : {}),
  ...(b.p ? { p: encodeSpec(b.p), e: b.e, x: b.x } : {}),
});

export const decodeBeat = (data: unknown): Beat | null => {
  const d = obj(data);
  if (!d) return null;
  const { m, g, p, e, x } = d;
  if (m !== "j" && m !== "s" && m !== "l") return null;
  let geom: Geometry | null = null;
  if (g !== undefined) {
    if (!Array.isArray(g) || g.length !== 3) return null;
    const [w, r, k] = g;
    if (!int(w, 1, MAX_COLS) || !int(r, 1, MAX_ROWS) || !int(k, 0, r)) return null;
    geom = { w, r, k };
  }
  let spec: Spec | null = null;
  if (p !== undefined) {
    spec = decodeSpec(p);
    if (!spec || !int(e, 0, MAX_CELLS * 8) || !int(x, 0, 2 ** 32 - 1)) return null;
  }
  return { m, g: geom, p: spec, e: spec ? (e as number) : 0, x: spec ? (x as number) : 0 };
};

export const encodeSync = (spec: Spec | null) => (spec ? { p: [spec.b, spec.n] } : {});

export const decodeSync = (data: unknown): { b: number; n: number } | null | "any" => {
  const d = obj(data);
  if (!d) return null;
  if (d.p === undefined) return "any";
  const p = d.p;
  if (!Array.isArray(p) || p.length !== 2 || !int(p[0], 0, 2 ** 32 - 1) || !int(p[1], 0, 2 ** 31))
    return null;
  return { b: p[0] as number, n: p[1] as number };
};

/** A patch's log as chunks, each naming its senders once. */
export const encodeLog = (spec: Spec, events: readonly Ev[]) => {
  const chunks: unknown[] = [];
  const m = Math.max(1, Math.min(MAX_CHUNKS, Math.ceil(events.length / CHUNK)));
  for (let i = 0; i < m; i++) {
    const part = events.slice(i * CHUNK, (i + 1) * CHUNK);
    const senders: string[] = [];
    const index = new Map<string, number>();
    const rows = part.map((e) => {
      let si = index.get(e.s);
      if (si === undefined) {
        si = senders.length;
        senders.push(e.s);
        index.set(e.s, si);
      }
      return [e.k, e.c, Math.round(e.t), si, e.q, e.h ? 1 : 0];
    });
    chunks.push({ p: encodeSpec(spec), i, m, s: senders, e: rows });
  }
  return chunks;
};

export const decodeLog = (data: unknown): LogChunk | null => {
  const d = obj(data);
  if (!d) return null;
  const p = decodeSpec(d.p);
  const { i, m, s, e } = d;
  if (!p || !int(m, 1, MAX_CHUNKS) || !int(i, 0, m - 1)) return null;
  if (!Array.isArray(s) || s.length > CHUNK || !s.every(id)) return null;
  if (!Array.isArray(e) || e.length > CHUNK) return null;
  const events: Ev[] = [];
  for (const row of e) {
    if (!Array.isArray(row) || row.length !== 6) return null;
    const [k, c, t, si, q, h] = row;
    if (!kind(k) || !int(c, 0, p.cols * p.rows - 1) || !finite(t)) return null;
    if (!int(si, 0, s.length - 1) || !int(q, 0, Number.MAX_SAFE_INTEGER)) return null;
    if (h !== 0 && h !== 1) return null;
    events.push({ k, c, t, s: s[si] as string, q, h: h === 1 });
  }
  return { p, i, m, events };
};
