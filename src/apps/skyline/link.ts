/**
 * Who talks to whom on a bank. A touch frame sends its pad, release and block messages to the
 * screen on its own side; the screen sends each frame the state of its cranes about five times a
 * second (its beacon) and their shapes once a second. A frame counts the screen as there only
 * while those keep coming and the roster lists it, so a screen that crashes or is unplugged is
 * noticed within a few seconds. While the room is between hubs the last word stands a little
 * longer, so a quick hub change doesn't send every frame to its own crane.
 */
import type { Channel, PeerInfo } from "../../core/types";
import {
  type BlkMsg,
  type CraneGeo,
  type CraneState,
  decodeBlk,
  decodeExit,
  decodeGeo,
  decodePad,
  decodeRel,
  decodeSt,
  encodeExit,
  encodePad,
  type ExitMsg,
  type GeoMsg,
  type PadMsg,
  type RelMsg,
  type StMsg,
  TOPIC,
} from "./wire";

export const ST_MS = 200;
export const GEO_MS = 1000;
/** A screen not heard from for this long has gone. */
export const SCREEN_GRACE_MS = 3000;
const OFFLINE_EXTRA_MS = 3000;
/** Fewest ms between messages of each kind from one frame that the screen takes. */
export const GAP_MS = { pad: 40, rel: 150, blk: 250, exit: 80 };
const MAX_SENDERS = 64;

const sideOf = (p: PeerInfo) => p.side ?? 0;

export interface Uplink {
  /** The screen above this frame, while it answers. */
  screen(): string | null;
  /** The screen's latest word on a crane of this frame, and its shapes. */
  state(c: number): CraneState | null;
  geo(c: number): CraneGeo | null;
  /** When the latest state for a crane came (ms). */
  stateAt(c: number): number;
  pad(m: PadMsg): boolean;
  release(c: number, bot: boolean): boolean;
  block(m: BlkMsg): boolean;
  exit(m: ExitMsg): boolean;
  readonly sent: number;
  dispose(): void;
}

export const createUplink = (net: Channel, side: number, now: () => number): Uplink => {
  let heard: { from: string; at: number } | null = null;
  const states = new Map<number, { st: CraneState; at: number }>();
  const geos = new Map<number, CraneGeo>();
  let sent = 0;
  const fromScreen = (from: string) => {
    const peer = net.peers().find((p) => p.frame === from);
    return !!peer && peer.role === "screen" && sideOf(peer) === side;
  };
  const offSt = net.on(TOPIC.st, (data, from) => {
    const m: StMsg | null = decodeSt(data);
    if (!m || m.s !== side || !fromScreen(from)) return;
    const t = now();
    heard = { from, at: t };
    for (const c of m.cr) states.set(c.c, { st: c, at: t });
  });
  const offGeo = net.on(TOPIC.geo, (data, from) => {
    const m: GeoMsg | null = decodeGeo(data);
    if (!m || m.s !== side || !fromScreen(from)) return;
    for (const c of m.cr) geos.set(c.c, c);
  });
  const screen = (): string | null => {
    if (!heard) return null;
    const age = now() - heard.at;
    if (!net.online) return age <= SCREEN_GRACE_MS + OFFLINE_EXTRA_MS ? heard.from : null;
    if (age > SCREEN_GRACE_MS) return null;
    const from = heard.from;
    return net.peers().some((p) => p.frame === from && p.role === "screen") ? from : null;
  };
  const send = (topic: string, data: unknown) => {
    const to = screen();
    if (!to || !net.online) return false;
    net.send(topic, data, to);
    sent++;
    return true;
  };
  return {
    screen,
    state: (c) => (screen() ? (states.get(c)?.st ?? null) : null),
    geo: (c) => geos.get(c) ?? null,
    stateAt: (c) => states.get(c)?.at ?? Number.NEGATIVE_INFINITY,
    pad: (m) => send(TOPIC.pad, encodePad(m)),
    release: (c, bot) => send(TOPIC.rel, { c: c ? 1 : 0, b: bot ? 1 : 0 }),
    block: (m) =>
      send(TOPIC.blk, {
        c: m.c ? 1 : 0,
        k: Math.max(0, Math.min(3, Math.round(m.k))),
        h: m.h ? 1 : 0,
      }),
    exit: (m) => send(TOPIC.exit, encodeExit(m)),
    get sent() {
      return sent;
    },
    dispose() {
      offSt();
      offGeo();
      states.clear();
      geos.clear();
      heard = null;
    },
  };
};

export interface DownlinkHandlers {
  pad(pos: number, m: PadMsg): void;
  release(pos: number, m: RelMsg): void;
  block(pos: number, m: BlkMsg): void;
  exit(pos: number, m: ExitMsg): void;
}

export interface Downlink {
  /** Touch frames on this screen's side. */
  stations(): PeerInfo[];
  send(frame: string, st: StMsg): void;
  sendGeo(frame: string, geo: GeoMsg): void;
  dispose(): void;
}

export const createDownlink = (
  net: Channel,
  opts: { side: number; now: () => number },
  on: DownlinkHandlers,
): Downlink => {
  const last = new Map<string, number>();
  const stations = () => net.peers().filter((p) => p.role !== "screen" && sideOf(p) === opts.side);
  /** The sender's position, if it is a touch frame below this screen and not too quick. */
  /** Limits apply per crane: a pair's two halves speak for two cranes. */
  const accept = (from: string, kind: keyof typeof GAP_MS, crane: number): number | null => {
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role === "screen" || sideOf(peer) !== opts.side) return null;
    if (!Number.isInteger(peer.pos) || peer.pos < 0 || peer.pos > 63) return null;
    const key = `${kind}:${from}:${crane}`;
    const t = opts.now();
    const prev = last.get(key);
    if (prev !== undefined && t - prev < GAP_MS[kind]) return null;
    last.delete(key);
    last.set(key, t);
    if (last.size > MAX_SENDERS * 4) {
      const first = last.keys().next().value;
      if (first !== undefined) last.delete(first);
    }
    return peer.pos;
  };
  const acceptRelaxed = (from: string): number | null => {
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role === "screen" || sideOf(peer) !== opts.side) return null;
    return Number.isInteger(peer.pos) && peer.pos >= 0 && peer.pos <= 63 ? peer.pos : null;
  };
  const offs = [
    net.on(TOPIC.pad, (data, from) => {
      const m = decodePad(data);
      // A finger lifting always gets through, so a crane is never left held.
      if (!m) return;
      const pos = m.h === 0 ? acceptRelaxed(from) : accept(from, "pad", m.c);
      if (pos !== null) on.pad(pos, m);
    }),
    net.on(TOPIC.rel, (data, from) => {
      const m = decodeRel(data);
      const pos = m ? accept(from, "rel", m.c) : null;
      if (m && pos !== null) on.release(pos, m);
    }),
    net.on(TOPIC.blk, (data, from) => {
      const m = decodeBlk(data);
      const pos = m ? accept(from, "blk", m.c) : null;
      if (m && pos !== null) on.block(pos, m);
    }),
    net.on(TOPIC.exit, (data, from) => {
      const m = decodeExit(data);
      const pos = m ? accept(from, "exit", m.c) : null;
      if (m && pos !== null) on.exit(pos, m);
    }),
  ];
  return {
    stations,
    send(frame, st) {
      if (net.online) net.send(TOPIC.st, st, frame);
    },
    sendGeo(frame, geo) {
      if (net.online) net.send(TOPIC.geo, geo, frame);
    },
    dispose() {
      for (const off of offs) off();
      last.clear();
    },
  };
};
