import { bankFraction } from "../../core/layout";
import type { Channel } from "../../core/types";
import { ELEMENTS, type ElementId, isFlowing } from "./elements";

/**
 * Matter thrown off the top of a frame in a bank lands on the screen above. The frame collects
 * what its outlet took, packs each cell as one small integer (position across the whole bank,
 * quantised to 4096 steps, times 32, plus the element id) and sends at most a few batches a second
 * to the screen. The screen checks every value and drops the rest. With no screen, nothing is
 * sent and the geysers simply stop short of the top.
 */
export const TOPIC_UP = "pw:up";
const STEPS = 4096;
const ID_SPAN = 32;
export const MAX_BATCH = 240;
/** Fewest milliseconds between batches from one frame. */
export const MIN_INTERVAL_MS = 250;

export interface Arrival {
  /** Fraction across the bank (and so across the screen). */
  f: number;
  element: ElementId;
}

/**
 * Pack the cells an outlet capture holds. `ids` is RGBA per cell, `rows` rows of `width` cells.
 * Keeps at most MAX_BATCH, spread evenly when there are more.
 */
export const packOutlet = (
  ids: Uint8Array,
  width: number,
  rows: number,
  pos: number,
  count: number,
): number[] => {
  const cells: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < width; x++) {
      const id = ids[(r * width + x) * 4] ?? 0;
      if (id === 0 || id >= ID_SPAN || !isFlowing(id as ElementId)) continue;
      const f = bankFraction(pos, (x + 0.5) / width, count);
      cells.push(Math.min(STEPS - 1, Math.round(f * (STEPS - 1))) * ID_SPAN + id);
    }
  }
  if (cells.length <= MAX_BATCH) return cells;
  const out: number[] = [];
  const step = cells.length / MAX_BATCH;
  for (let i = 0; i < MAX_BATCH; i++) out.push(cells[Math.floor(i * step)] ?? 0);
  return out;
};

/** Validate and unpack a batch from the network. Null if it isn't one. */
export const unpackBatch = (data: unknown): Arrival[] | null => {
  if (typeof data !== "object" || data === null) return null;
  const c = (data as { c?: unknown }).c;
  if (!Array.isArray(c) || c.length > MAX_BATCH) return null;
  const out: Arrival[] = [];
  for (const v of c) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= STEPS * ID_SPAN) return null;
    const id = v % ID_SPAN;
    if (id >= ELEMENTS.length || !isFlowing(id as ElementId)) continue;
    out.push({ f: Math.floor(v / ID_SPAN) / (STEPS - 1), element: id as ElementId });
  }
  return out;
};

export interface Uplink {
  /** Is there a screen above to send to? */
  readonly connected: boolean;
  /** Send a capture, if one is due. Returns whether it went. */
  send(ids: Uint8Array, width: number, rows: number, now: number): boolean;
}

export const createUplink = (net: Channel, pos: number, count: number): Uplink => {
  let lastSent = -Infinity;
  const screen = () => net.peers().find((p) => p.role === "screen")?.frame ?? null;
  return {
    get connected() {
      return net.online && screen() !== null;
    },
    send(ids, width, rows, now) {
      const to = screen();
      if (!to || now - lastSent < MIN_INTERVAL_MS) return false;
      const c = packOutlet(ids, width, rows, pos, count);
      if (c.length === 0) return false;
      net.send(TOPIC_UP, { c }, to);
      lastSent = now;
      return true;
    },
  };
};

/**
 * The screen's side: arrivals wait in a bounded queue and come in a little at a time, each
 * through a short-lived jet at its position along the bottom edge.
 */
export interface Inbox {
  push(arrivals: Arrival[]): void;
  /** Take up to `max` arrivals. */
  take(max: number): Arrival[];
  readonly size: number;
}

export const createInbox = (capacity = 1200): Inbox => {
  let queue: Arrival[] = [];
  return {
    push(arrivals) {
      queue.push(...arrivals);
      if (queue.length > capacity) queue = queue.slice(queue.length - capacity);
    },
    take(max) {
      const out = queue.slice(0, max);
      queue = queue.slice(out.length);
      return out;
    },
    get size() {
      return queue.length;
    },
  };
};

/** A jet along the screen's bottom edge, in cells: where arrivals come in and fly up. */
export interface Jet {
  x: number;
  until: number;
}

export interface Landing {
  /** Live jets (bounded), for zones and effects. */
  readonly jets: readonly Jet[];
  /**
   * Bring arrivals in at the bottom: one emitter per (column bin, element) through `emit`, and
   * a jet at each bin for a moment so they rise into the sky.
   */
  land(
    arrivals: Arrival[],
    now: number,
    emit: (x: number, element: ElementId, count: number) => void,
  ): void;
  expire(now: number): void;
}

export const createLanding = (gridW: number, maxJets: number, jetMs = 1600): Landing => {
  let jets: Jet[] = [];
  const BIN = 8;
  return {
    get jets() {
      return jets;
    },
    land(arrivals, now, emit) {
      const groups = new Map<number, number>();
      for (const a of arrivals) {
        const bin = Math.min(Math.floor((a.f * gridW) / BIN), Math.floor(gridW / BIN));
        const key = bin * 64 + a.element;
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      for (const [key, n] of groups) {
        const bin = Math.floor(key / 64);
        const x = bin * BIN + BIN / 2;
        emit(x, (key % 64) as ElementId, n);
        const near = jets.find((j) => Math.abs(j.x - x) < BIN * 2);
        if (near) near.until = now + jetMs;
        else jets.push({ x, until: now + jetMs });
      }
      while (jets.length > maxJets) jets.shift();
    },
    expire(now) {
      jets = jets.filter((j) => j.until > now);
    },
  };
};
