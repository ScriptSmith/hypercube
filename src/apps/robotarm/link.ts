/**
 * Who talks to whom in a bank. A touch frame sends an `up` to the screen on its side for each
 * piece its lift sends; the screen sends `need` to everyone about once a second, which is also
 * its beacon. A frame counts the screen as there only while those keep coming (and, when the
 * room is up, the roster lists it), so a screen that crashes or is unplugged is noticed within a
 * few seconds. While the room is between hubs the last word from the screen stands a little
 * longer, so a quick hub change doesn't make every lift blink.
 */
import type { Channel, PeerInfo } from "../../core/types";
import {
  decodeExit,
  decodeNeed,
  decodeUp,
  encodeExit,
  encodeNeed,
  encodeUp,
  type ExitMsg,
  type NeedMsg,
  TOPIC,
  type UpMsg,
} from "./wire";

export const NEED_MS = 1000;
/** A screen not heard from for this long has gone. */
export const NEED_GRACE_MS = 3200;
/** While the room is offline, a screen's word stands at most this much longer. */
const OFFLINE_EXTRA_MS = 3000;
/** Fewest ms between two pieces from one frame that a screen accepts (lifts take longer). */
export const SCREEN_GAP_MS = 900;
const MAX_SENDERS = 64;

const sideOf = (p: PeerInfo) => p.side ?? 0;

export interface Uplink {
  /** The screen above this frame, while it answers. */
  screen(): string | null;
  /** What that screen still wants, per colour, or null with no screen. */
  needs(): [number, number, number] | null;
  send(m: UpMsg): boolean;
  /** Tell the screen where this frame's beam leaves its top edge. */
  sendExit(m: ExitMsg): boolean;
  readonly sent: number;
  dispose(): void;
}

export const createUplink = (net: Channel, side: number, now: () => number): Uplink => {
  let heard: { from: string; at: number; msg: NeedMsg } | null = null;
  let offlineSince: number | null = null;
  let sent = 0;
  const off = net.on(TOPIC.need, (data, from) => {
    const m = decodeNeed(data);
    if (!m || m.s !== side) return;
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role !== "screen" || sideOf(peer) !== side) return;
    heard = { from, at: now(), msg: m };
  });
  const screen = (): string | null => {
    const t = now();
    if (!heard) return null;
    if (!net.online) {
      offlineSince ??= t;
      return t - heard.at <= NEED_GRACE_MS + OFFLINE_EXTRA_MS ? heard.from : null;
    }
    offlineSince = null;
    if (t - heard.at > NEED_GRACE_MS) return null;
    const from = heard.from;
    if (!net.peers().some((p) => p.frame === from && p.role === "screen")) return null;
    return from;
  };
  return {
    screen,
    needs() {
      return screen() && heard ? heard.msg.n : null;
    },
    send(m) {
      const to = screen();
      if (!to || !net.online) return false;
      net.send(TOPIC.up, encodeUp(m), to);
      sent++;
      return true;
    },
    sendExit(m) {
      const to = screen();
      if (!to || !net.online) return false;
      net.send(TOPIC.exit, encodeExit(m), to);
      return true;
    },
    get sent() {
      return sent;
    },
    dispose() {
      off();
      heard = null;
    },
  };
};

export interface Downlink {
  /** Touch frames on this screen's side. */
  stations(): PeerInfo[];
  /** Send the `need` beacon when it is due. */
  tick(m: Omit<NeedMsg, "s">): void;
  dispose(): void;
}

/** Fewest ms between two beam reports from one frame that a screen takes. */
export const EXIT_GAP_MS = 80;
/** A beam not reported for this long goes (its frame has left). Frames report every 3 s. */
export const EXIT_TTL_MS = 10_000;

export interface Exit {
  /** Centre and width as shares of the frame's width. */
  u: number;
  w: number;
  at: number;
}

/** The last beam each column reported, one per column, forgotten once stale. */
export interface Exits {
  /** Returns true when it changed what the column shows. */
  set(column: number, u: number, w: number, now: number): boolean;
  /** The column's beam, or null before it has reported or once its report is stale. */
  get(column: number, now: number): Exit | null;
  /** Columns with a live beam, in order. */
  live(now: number): { column: number; exit: Exit }[];
  readonly size: number;
}

export const createExits = (maxColumns = 64): Exits => {
  const byColumn = new Map<number, Exit>();
  return {
    set(column, u, w, now) {
      if (!Number.isInteger(column) || column < 0 || column >= maxColumns) return false;
      if (!(u >= 0 && u <= 1 && w >= 0 && w <= 1)) return false;
      const prev = byColumn.get(column);
      byColumn.set(column, { u, w, at: now });
      return !prev || prev.u !== u || prev.w !== w;
    },
    get(column, now) {
      const e = byColumn.get(column);
      if (!e) return null;
      if (now - e.at > EXIT_TTL_MS) {
        byColumn.delete(column);
        return null;
      }
      return e;
    },
    live(now) {
      const out: { column: number; exit: Exit }[] = [];
      for (const [column, exit] of [...byColumn].sort((a, b) => a[0] - b[0])) {
        if (now - exit.at > EXIT_TTL_MS) byColumn.delete(column);
        else out.push({ column, exit });
      }
      return out;
    },
    get size() {
      return byColumn.size;
    },
  };
};

export const createDownlink = (
  net: Channel,
  opts: { side: number; count: () => number; now: () => number },
  onUp: (m: UpMsg, column: number, columns: number) => void,
  onExit?: (column: number, u: number, w: number) => void,
): Downlink => {
  const lastBy = new Map<string, number>();
  const exitBy = new Map<string, number>();
  let beaconAt = Number.NEGATIVE_INFINITY;
  const stations = () => net.peers().filter((p) => p.role !== "screen" && sideOf(p) === opts.side);
  const off = net.on(TOPIC.up, (data, from) => {
    const peer = net.peers().find((p) => p.frame === from);
    // Only frames below this screen, on its own side, may send it pieces.
    if (!peer || peer.role === "screen" || sideOf(peer) !== opts.side) return;
    const m = decodeUp(data);
    if (!m) return;
    const t = opts.now();
    const last = lastBy.get(from);
    if (last !== undefined && t - last < SCREEN_GAP_MS) return;
    lastBy.delete(from);
    lastBy.set(from, t);
    if (lastBy.size > MAX_SENDERS) {
      const first = lastBy.keys().next().value;
      if (first !== undefined) lastBy.delete(first);
    }
    // The roster's position is the frame's own; the message's is only a fallback.
    const column = Number.isInteger(peer.pos) && peer.pos >= 0 ? peer.pos : m.p;
    const columns = Math.max(1, opts.count(), ...stations().map((p) => p.pos + 1));
    if (column >= columns) return;
    onUp(m, column, columns);
  });
  /** The sender's column, if it is a touch frame below this screen. */
  const columnOf = (from: string, fallback: number): number | null => {
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role === "screen" || sideOf(peer) !== opts.side) return null;
    const column = Number.isInteger(peer.pos) && peer.pos >= 0 ? peer.pos : fallback;
    const columns = Math.max(1, opts.count(), ...stations().map((p) => p.pos + 1));
    return column < columns ? column : null;
  };
  const offExit = net.on(TOPIC.exit, (data, from) => {
    const m = decodeExit(data);
    if (!m || !onExit) return;
    const column = columnOf(from, m.p);
    if (column === null) return;
    const t = opts.now();
    const last = exitBy.get(from);
    if (last !== undefined && t - last < EXIT_GAP_MS) return;
    exitBy.delete(from);
    exitBy.set(from, t);
    if (exitBy.size > MAX_SENDERS) {
      const first = exitBy.keys().next().value;
      if (first !== undefined) exitBy.delete(first);
    }
    onExit(column, m.u / 1000, m.w / 1000);
  });
  return {
    stations,
    tick(m) {
      const t = opts.now();
      if (!net.online || t - beaconAt < NEED_MS) return;
      beaconAt = t;
      net.send(TOPIC.need, encodeNeed({ ...m, s: opts.side }));
    },
    dispose() {
      off();
      offExit();
      lastBy.clear();
      exitBy.clear();
    },
  };
};
