/**
 * A touch frame's side of the bank. It listens for its screen's beacon (which also says how far
 * behind the shared clock the screen draws), sends its kites about 15 times a second to that
 * screen, reports ring catches, and takes the screen's word on tangles. Nothing goes out while no
 * screen answers; the frame then draws its own sky.
 *
 * Beacons decide whether the screen is there. While the room is between hubs nothing arrives, so
 * beacon ages stand still for up to half a second; and a frame whose own page was held up (the
 * simulator runs every frame on one thread) looks a few more times before giving up, so beacons
 * that queued meanwhile can arrive.
 */
import type { Channel, PeerInfo } from "../../core/types";
import { KITE_HZ, SCREEN_GRACE_MS } from "./config";
import {
  decodeSky,
  decodeTangle,
  encodeKites,
  encodeRing,
  type KiteMsg,
  type RingMsg,
  type TangleMsg,
  TOPIC,
} from "./wire";

const FREEZE_MS = 500;
const AWAKE_LOOKS = 6;
const LOOK_MS = 20;
/** A tangle the screen hasn't repeated for this long has ended (the screen may have gone). */
export const TANGLE_HOLD_MS = 2500;
/** Screens a frame sends to at most (one is usual). */
const MAX_SCREENS = 2;

const sideOf = (p: PeerInfo) => p.side ?? 0;

export interface Uplink {
  /** The screen above, while its beacons keep coming. `now` is local ms. */
  screen(now: number): string | null;
  /** The screen's drawing delay, ms, eased. */
  readonly delay: number;
  /** Send kites if a message is due. Returns true if sent. */
  tick(now: number, build: () => KiteMsg): boolean;
  ring(m: RingMsg): void;
  /** Tangles the screen says each slot is in (slot to crossing point). */
  tangles(now: number): ReadonlyMap<number, { x: number; y: number }>;
  readonly sent: number;
  dispose(): void;
}

export const createUplink = (net: Channel, side: number): Uplink => {
  const heard = new Map<string, { at: number; staleAt: number | null }>();
  const caught = new Map<number, { x: number; y: number; at: number }>();
  let offlineSince: number | null = null;
  let looks = 0;
  let lookedAt = Number.NEGATIVE_INFINITY;
  let delay = 160;
  let wantDelay = 160;
  let delayAt = Number.NEGATIVE_INFINITY;
  let sentAt = Number.NEGATIVE_INFINITY;
  let sent = 0;
  const every = 1000 / KITE_HZ;

  const isScreen = (from: string) => {
    const p = net.peers().find((x) => x.frame === from);
    return !!p && p.role === "screen" && sideOf(p) === side;
  };

  const offs = [
    net.on(TOPIC.sky, (data, from) => {
      const m = decodeSky(data);
      if (!m || m.side !== side || !isScreen(from)) return;
      heard.set(from, { at: performance.now(), staleAt: null });
      if (heard.size > 4) heard.delete(heard.keys().next().value!);
      wantDelay = m.delay;
    }),
    net.on(TOPIC.tangle, (data, from) => {
      if (!isScreen(from)) return;
      const m: TangleMsg | null = decodeTangle(data);
      if (!m) return;
      if (m.on) caught.set(m.slot, { x: m.x, y: m.y, at: performance.now() });
      else caught.delete(m.slot);
    }),
  ];

  const screen = (now: number): string | null => {
    if (now - lookedAt >= LOOK_MS) {
      looks++;
      lookedAt = now;
    }
    if (!net.online) {
      offlineSince ??= now;
    } else if (offlineSince !== null) {
      const gap = Math.min(FREEZE_MS, now - offlineSince);
      for (const h of heard.values()) h.at += gap;
      offlineSince = null;
    }
    const ref = offlineSince === null ? now : now - Math.min(FREEZE_MS, now - offlineSince);
    let best: string | null = null;
    let at = Number.NEGATIVE_INFINITY;
    for (const [frame, h] of heard) {
      if (h.at <= at) continue;
      if (ref - h.at > SCREEN_GRACE_MS) {
        h.staleAt ??= looks;
        if (looks - h.staleAt >= AWAKE_LOOKS) continue;
      } else {
        h.staleAt = null;
      }
      best = frame;
      at = h.at;
    }
    return best;
  };

  const tangles = new Map<number, { x: number; y: number }>();

  return {
    screen,
    get delay() {
      return delay;
    },
    tick(now, build) {
      // The delay eases, as the screen's does, so the join moves smoothly when it changes.
      const dt = Number.isFinite(delayAt) ? Math.min(0.25, (now - delayAt) / 1000) : 0;
      delayAt = now;
      if (wantDelay > delay) delay = Math.min(wantDelay, delay + 600 * dt);
      else delay = Math.max(wantDelay, delay - 60 * dt);
      if (now - sentAt < every - 4 || !net.online) return false;
      const to = screen(now);
      if (!to) return false;
      sentAt = now;
      const msg = encodeKites(build());
      let n = 0;
      for (const p of net.peers()) {
        if (p.role !== "screen" || sideOf(p) !== side || p.frame === net.self) continue;
        net.send(TOPIC.kite, msg, p.frame);
        if (++n >= MAX_SCREENS) break;
      }
      if (n > 0) sent++;
      return n > 0;
    },
    ring(m) {
      const to = screen(performance.now());
      if (to && net.online) net.send(TOPIC.ring, encodeRing(m), to);
    },
    tangles(now) {
      tangles.clear();
      for (const [slot, c] of caught) {
        if (now - c.at > TANGLE_HOLD_MS) caught.delete(slot);
        else tangles.set(slot, { x: c.x, y: c.y });
      }
      return tangles;
    },
    get sent() {
      return sent;
    },
    dispose() {
      for (const off of offs) off();
      heard.clear();
      caught.clear();
    },
  };
};

/**
 * Where each line left the frame's top edge lately, so the frame can draw the lower ends of its
 * lines at the same moment the screen draws the upper ends (`delay` behind the shared clock).
 */
export interface ExitHistory {
  record(t: number, exits: readonly number[]): void;
  /** Exits at shared time `t`, interpolated, into `out`. False if nothing is recorded. */
  at(t: number, out: number[]): boolean;
  clear(): void;
}

export const createExitHistory = (size = 64): ExitHistory => {
  const ts = new Float64Array(size);
  const rows: number[][] = Array.from({ length: size }, () => []);
  let head = -1;
  let n = 0;
  return {
    record(t, exits) {
      if (n > 0 && t <= ts[head]!) return;
      head = (head + 1) % size;
      n = Math.min(size, n + 1);
      ts[head] = t;
      const row = rows[head]!;
      row.length = exits.length;
      for (let i = 0; i < exits.length; i++) row[i] = exits[i]!;
    },
    at(t, out) {
      if (n === 0) return false;
      let newer = -1;
      for (let back = 0; back < n; back++) {
        const i = (head - back + size) % size;
        if (ts[i]! <= t) {
          const row = rows[i]!;
          out.length = row.length;
          if (newer < 0) {
            for (let j = 0; j < row.length; j++) out[j] = row[j]!;
          } else {
            const next = rows[newer]!;
            const f = (t - ts[i]!) / Math.max(1e-6, ts[newer]! - ts[i]!);
            for (let j = 0; j < row.length; j++) {
              const b = next[j];
              out[j] = b === undefined ? row[j]! : row[j]! + (b - row[j]!) * f;
            }
          }
          return true;
        }
        newer = i;
      }
      // Older than anything held: the oldest.
      const row = rows[newer]!;
      out.length = row.length;
      for (let j = 0; j < row.length; j++) out[j] = row[j]!;
      return true;
    },
    clear() {
      n = 0;
      head = -1;
    },
  };
};
