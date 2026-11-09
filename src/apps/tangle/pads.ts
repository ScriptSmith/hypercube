/**
 * Fingers on a station's pads.
 *
 * Turn pads: a touch anywhere in a playing station counts. Left of the pads' middle turns left,
 * right of it turns right, and sliding across moves the turn with the finger. Holding both
 * sides goes straight.
 *
 * Direction pads: a touch on a pad, or within AIM_SLACK of one, presses its direction, and a
 * finger sliding onto another pad presses that one. Presses are queued (a couple per station)
 * so two quick taps both count, and counted, so a bank panel can tell the screen about them.
 */
import type { Input, Pointer } from "../../core/types";
import { AIM_SLACK, sideAt, type StationLayout } from "./layout";

export interface Pads {
  /** Turn pads: -1, 0 or 1 for station `j`. */
  dir(j: number): number;
  /** Whether a finger holds pad `pad` of station `j` (turn pads: 0 left, 1 right). */
  held(j: number, pad: number): boolean;
  /** Fingers anywhere on station `j`'s pads. */
  touches(j: number): number;
  /** Direction pads: presses so far on station `j`, and the latest direction pressed or -1. */
  presses(j: number): number;
  last(j: number): number;
  /** Direction pads: the oldest press not yet taken from station `j`, or -1. */
  take(j: number): number;
  dispose(): void;
}

export interface PadsOptions {
  input: Input;
  /** Stations in venue px. */
  stations: () => readonly StationLayout[];
  /** Stage px per venue px. */
  unit: () => number;
  /** Whether station `j` is playing (only then do its pads steer). */
  live: (j: number) => boolean;
}

/** Most stations a frame has (eight on a wall). */
const MAX = 16;
const PADS = 4;
/** Presses a station keeps waiting; an older one makes way for a newer. */
const QUEUE = 2;

/** The direction pad nearest (x, y) and within AIM_SLACK of it, or -1. */
export const aimAt = (s: StationLayout, x: number, y: number): number => {
  let best = -1;
  let bestD = AIM_SLACK;
  for (let i = 0; i < s.pads.length; i++) {
    const p = s.pads[i]!;
    const dx = Math.max(p.x - x, 0, x - (p.x + p.width));
    const dy = Math.max(p.y - y, 0, y - (p.y + p.height));
    const d = Math.hypot(dx, dy);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
};

export const createPads = (opts: PadsOptions): Pads => {
  /** Pointer id to `station * PADS + pad`. */
  const holds = new Map<number, number>();
  const count = new Uint8Array(MAX * PADS);
  const pressed = new Uint32Array(MAX);
  const latest = new Int8Array(MAX).fill(-1);
  const queue = new Int8Array(MAX * QUEUE);
  const queued = new Uint8Array(MAX);

  const recount = () => {
    count.fill(0);
    for (const code of holds.values()) count[code]!++;
  };

  const hit = (p: Pointer): number => {
    const u = opts.unit();
    const x = p.x / u;
    const y = p.y / u;
    for (const s of opts.stations()) {
      if (s.index >= MAX) continue;
      const r = s.rect;
      if (x < r.x || x >= r.x + r.width || y < r.y || y >= r.y + r.height) continue;
      if (!opts.live(s.index)) return -1;
      if (s.kind === "aim") {
        const pad = aimAt(s, x, y);
        return pad < 0 ? -1 : s.index * PADS + pad;
      }
      const side = sideAt(s, x, y);
      return side === null ? -1 : s.index * PADS + (side > 0 ? 1 : 0);
    }
    return -1;
  };

  const aimed = (code: number) => {
    const j = Math.floor(code / PADS);
    if (opts.stations()[j]?.kind !== "aim") return;
    const d = code % PADS;
    pressed[j] = (pressed[j]! + 1) >>> 0;
    latest[j] = d;
    if (queued[j]! >= QUEUE) {
      queue[j * QUEUE] = queue[j * QUEUE + 1]!;
      queued[j]!--;
    }
    queue[j * QUEUE + queued[j]!] = d;
    queued[j]!++;
  };

  const press = (p: Pointer) => {
    const code = hit(p);
    const prev = holds.get(p.id) ?? -1;
    if (code === prev) return;
    if (code < 0) holds.delete(p.id);
    else holds.set(p.id, code);
    recount();
    if (code >= 0) aimed(code);
  };
  const lift = (p: Pointer) => {
    if (holds.delete(p.id)) recount();
  };

  const offs = [
    opts.input.on("down", press),
    opts.input.on("move", press),
    opts.input.on("up", lift),
    opts.input.on("cancel", lift),
  ];

  const held = (j: number, pad: number) =>
    j >= 0 && j < MAX && pad >= 0 && pad < PADS && opts.live(j) && count[j * PADS + pad]! > 0;

  return {
    dir(j) {
      return (held(j, 1) ? 1 : 0) - (held(j, 0) ? 1 : 0);
    },
    held,
    touches(j) {
      if (j < 0 || j >= MAX) return 0;
      let n = 0;
      for (let k = 0; k < PADS; k++) n += count[j * PADS + k]!;
      return n;
    },
    presses(j) {
      return j >= 0 && j < MAX ? pressed[j]! : 0;
    },
    last(j) {
      return j >= 0 && j < MAX ? latest[j]! : -1;
    },
    take(j) {
      if (j < 0 || j >= MAX || queued[j] === 0) return -1;
      const d = queue[j * QUEUE]!;
      queue[j * QUEUE] = queue[j * QUEUE + 1]!;
      queued[j]!--;
      return d;
    },
    dispose() {
      for (const off of offs) off();
      holds.clear();
    },
  };
};
