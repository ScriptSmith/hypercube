import type { FrameKind, OptionValue, PeerInfo, Role } from "../types";

/**
 * Wire format between a frame and the hub. Every message is one JSON object whose `t` names its
 * type; keys are short because app messages are relayed to every subscriber.
 *
 * Limits, chosen so one hub can carry about 30 frames:
 * - An app message, envelope included, is at most MAX_MESSAGE_BYTES of JSON. Larger ones are
 *   dropped with a console warning.
 * - The hub relays at most RELAY_RATE app messages a second from each frame, with bursts up to
 *   RELAY_BURST. The excess is dropped. Keep steady traffic far lower (say 20 Hz of small,
 *   quantised state from one frame per group).
 * - A frame's status holds at most MAX_STATUS_KEYS keys and MAX_STATUS_BYTES of JSON; string
 *   values are cut to 120 characters.
 * - A frame has at most MAX_SUBS channel names open at the hub; the oldest is dropped first.
 * - A room holds at most MAX_MEMBERS frames besides the hub. A client keeps at most that many
 *   roster entries and accepts new ones at a bounded rate, whatever a hub sends.
 */
export const PROTOCOL = 1;
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const RELAY_RATE = 60;
export const RELAY_BURST = 120;
export const MAX_STATUS_KEYS = 24;
export const MAX_STATUS_BYTES = 1024;
export const MAX_SUBS = 32;
export const MAX_MEMBERS = 96;

export type StatusMap = Record<string, OptionValue>;

/** A roster entry: hub-assigned key, info, join time on the shared clock, status, rtt. */
export interface WireEntry {
  k: string;
  i: PeerInfo;
  j: number;
  s?: StatusMap;
  r?: number;
  /** Never the hub (RoomOptions.hubEligible false). */
  n?: 1;
}

export type Hello = { t: "hello"; v: number; i: PeerInfo; c: string[]; s?: StatusMap; n?: 1 };

export type ToHub =
  | Hello
  | { t: "info"; i: PeerInfo }
  | { t: "st"; s: StatusMap }
  | { t: "sub"; c: string }
  | { t: "uns"; c: string }
  | { t: "m"; c: string; k: string; d: unknown; to?: string }
  | { t: "pi"; n: number; a: number; r?: number }
  | { t: "probe"; s: number }
  | { t: "bye" };

export type Welcome = { t: "wel"; v: number; k: string; h: string; s: number; r: WireEntry[] };

export type FromHub =
  | Welcome
  | { t: "ro"; u: WireEntry[]; x: string[] }
  | { t: "m"; c: string; k: string; d: unknown; f: string }
  | { t: "po"; n: number; a: number; h: number }
  | { t: "hub"; s: number }
  | { t: "mv"; s: number }
  | { t: "bye" }
  | { t: "full" };

const KINDS: ReadonlySet<string> = new Set<FrameKind>([
  "panel",
  "pair",
  "wall",
  "screen",
  "kiosk",
  "sphere",
]);
const ROLES: ReadonlySet<string> = new Set<Role>(["solo", "station", "screen"]);

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const short = (v: unknown, max: number): string | undefined =>
  typeof v === "string" ? v.slice(0, max) : undefined;
const channelName = (v: unknown): string | null => (isStr(v) && v.length <= 128 ? v : null);

const parse = (text: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/** PeerInfo with every field checked and bounded. `rtt` is dropped; the hub measures it. */
export const cleanInfo = (v: unknown): PeerInfo | null => {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const frame = short(o.frame, 128);
  if (!frame) return null;
  const info: PeerInfo = {
    frame,
    app: short(o.app, 64) ?? "",
    group: short(o.group, 64) ?? "",
    kind: isStr(o.kind) && KINDS.has(o.kind) ? (o.kind as FrameKind) : "panel",
    role: isStr(o.role) && ROLES.has(o.role) ? (o.role as Role) : "solo",
    pos: isNum(o.pos) ? Math.max(0, Math.min(1023, Math.round(o.pos))) : 0,
  };
  if (o.side === 0 || o.side === 1) info.side = o.side;
  if (isNum(o.span) && o.span >= 2) info.span = Math.min(16, Math.round(o.span));
  const zone = short(o.zone, 64);
  if (zone !== undefined) info.zone = zone;
  const display = short(o.display, 64);
  if (display !== undefined) info.display = display;
  return info;
};

export const cleanStatus = (v: unknown): StatusMap | undefined => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: StatusMap = {};
  let keys = 0;
  let bytes = 2;
  for (const [rawKey, raw] of Object.entries(v)) {
    if (keys >= MAX_STATUS_KEYS) break;
    let value: OptionValue;
    if (typeof raw === "string") value = raw.slice(0, 120);
    else if (typeof raw === "boolean" || isNum(raw)) value = raw;
    else continue;
    const key = rawKey.slice(0, 32);
    const size = JSON.stringify(key).length + JSON.stringify(value).length + 2;
    if (bytes + size > MAX_STATUS_BYTES) break;
    bytes += size;
    out[key] = value;
    keys++;
  }
  return out;
};

const readEntry = (v: unknown): WireEntry | null => {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const i = cleanInfo(o.i);
  if (!isStr(o.k) || o.k.length > 16 || !i) return null;
  const entry: WireEntry = { k: o.k, i, j: isNum(o.j) ? o.j : 0 };
  const s = cleanStatus(o.s);
  if (s) entry.s = s;
  if (isNum(o.r)) entry.r = o.r;
  if (o.n === 1) entry.n = 1;
  return entry;
};

const readEntries = (v: unknown): WireEntry[] | null => {
  if (!Array.isArray(v)) return null;
  const out: WireEntry[] = [];
  for (const item of v.slice(0, MAX_MEMBERS + 1)) {
    const e = readEntry(item);
    if (e) out.push(e);
  }
  return out;
};

export const readToHub = (text: string): ToHub | null => {
  const m = parse(text);
  if (!m) return null;
  switch (m.t) {
    case "hello": {
      const i = cleanInfo(m.i);
      if (!i || !Array.isArray(m.c)) return null;
      const c = m.c.map(channelName).filter((n): n is string => n !== null);
      const hello: Hello = { t: "hello", v: isNum(m.v) ? m.v : 0, i, c: c.slice(-MAX_SUBS) };
      const s = cleanStatus(m.s);
      if (s) hello.s = s;
      if (m.n === 1) hello.n = 1;
      return hello;
    }
    case "info": {
      const i = cleanInfo(m.i);
      return i ? { t: "info", i } : null;
    }
    case "st":
      return { t: "st", s: cleanStatus(m.s) ?? {} };
    case "sub":
    case "uns": {
      const c = channelName(m.c);
      if (c === null) return null;
      return m.t === "sub" ? { t: "sub", c } : { t: "uns", c };
    }
    case "m":
      if (!isStr(m.c) || !isStr(m.k)) return null;
      return isStr(m.to)
        ? { t: "m", c: m.c, k: m.k, d: m.d, to: m.to }
        : { t: "m", c: m.c, k: m.k, d: m.d };
    case "pi":
      if (!isNum(m.n) || !isNum(m.a)) return null;
      return isNum(m.r) ? { t: "pi", n: m.n, a: m.a, r: m.r } : { t: "pi", n: m.n, a: m.a };
    case "probe":
      return isNum(m.s) ? { t: "probe", s: m.s } : null;
    case "bye":
      return { t: "bye" };
    default:
      return null;
  }
};

export const readFromHub = (text: string): FromHub | null => {
  const m = parse(text);
  if (!m) return null;
  switch (m.t) {
    case "wel": {
      const r = readEntries(m.r);
      if (!isStr(m.k) || !isStr(m.h) || !isNum(m.s) || !r) return null;
      return { t: "wel", v: isNum(m.v) ? m.v : 0, k: m.k, h: m.h, s: m.s, r };
    }
    case "ro": {
      const u = readEntries(m.u ?? []);
      const x = Array.isArray(m.x) ? m.x.filter(isStr).slice(0, MAX_MEMBERS + 1) : [];
      return u ? { t: "ro", u, x } : null;
    }
    case "m":
      return isStr(m.c) && isStr(m.k) && isStr(m.f)
        ? { t: "m", c: m.c, k: m.k, d: m.d, f: m.f }
        : null;
    case "po":
      return isNum(m.n) && isNum(m.a) && isNum(m.h) ? { t: "po", n: m.n, a: m.a, h: m.h } : null;
    case "hub":
    case "mv": {
      if (!isNum(m.s)) return null;
      return m.t === "hub" ? { t: "hub", s: m.s } : { t: "mv", s: m.s };
    }
    case "bye":
      return { t: "bye" };
    case "full":
      return { t: "full" };
    default:
      return null;
  }
};
