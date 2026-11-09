/**
 * Slingshots and black-hole launchers on a touch frame, in the frame's venue px.
 *
 * A slingshot has a body resting between the prongs of its fork. A touch on the pad takes it;
 * pulling back stretches the bands and the body follows the finger (on the allowed arc); letting
 * go launches it away from the finger, faster the longer the pull. A tiny pull just cancels. The
 * next body rolls on a moment later. A launcher fires a black hole when it is charged and then
 * refills over half a minute. The attract ghost and bots use the same pads: the ghost directly,
 * bots through injected touches like a person's.
 */
import { launchFromPull } from "./aim";
import type { LauncherSpot, PadSpot } from "./layout";

/** A launcher refills over this long after firing. */
export const RECHARGE_S = 30;

/** The next body is on the pad this long after a launch. */
export const RELOAD_MS = 650;

export interface Pad {
  readonly spot: PadSpot;
  pointer: number | null;
  /** Finger offset from the rest point while drawn. */
  dx: number;
  dy: number;
  /** Held by a person's finger, a bot's injected finger, or the attract ghost. */
  holder: "person" | "bot" | "ghost" | null;
  readyAt: number;
  lastUse: number;
  lastHuman: number;
  /** When a body from this pad last went once round, for a glow. */
  glowAt: number;
}

export interface Launcher {
  readonly spot: LauncherSpot;
  /** ms when it is full again. */
  fullAt: number;
  firedAt: number;
}

export interface PadLaunch {
  pad: Pad;
  vx: number;
  vy: number;
  human: boolean;
}

export interface PadEvents {
  launch(l: PadLaunch): void;
  hole(l: Launcher, human: boolean): boolean;
}

export interface Pads {
  readonly pads: readonly Pad[];
  readonly launchers: readonly Launcher[];
  /** Venue px. Returns true when the touch took a pad or a launcher. */
  down(id: number, x: number, y: number, synthetic: boolean, now: number): boolean;
  move(id: number, x: number, y: number): void;
  up(id: number, x: number, y: number, now: number): void;
  cancel(id: number): void;
  ghostHold(index: number, dx: number, dy: number, now: number): boolean;
  ghostRelease(index: number, now: number): void;
  /** Drop every hold without launching. */
  release(): void;
  /** Charge share of a launcher, 0 to 1. */
  charge(l: Launcher, now: number): number;
  reset(now: number): void;
  readonly lastHuman: number;
}

export const createPads = (
  spots: readonly PadSpot[],
  launchSpots: readonly LauncherSpot[],
  events: PadEvents,
  now: number,
): Pads => {
  const pads: Pad[] = spots.map((spot) => ({
    spot,
    pointer: null,
    dx: 0,
    dy: 0,
    holder: null,
    readyAt: now,
    lastUse: now,
    lastHuman: -Infinity,
    glowAt: -Infinity,
  }));
  // Launchers start charged so the first visitor can try one.
  const launchers: Launcher[] = launchSpots.map((spot) => ({
    spot,
    fullAt: now,
    firedAt: -Infinity,
  }));
  const byPointer = new Map<number, Pad>();
  let lastHuman = -Infinity;

  const release = (pad: Pad, now: number, launch: boolean) => {
    if (pad.pointer !== null) byPointer.delete(pad.pointer);
    const human = pad.holder === "person";
    const l = launch ? launchFromPull(pad.spot, pad.dx, pad.dy) : null;
    pad.pointer = null;
    pad.holder = null;
    pad.dx = 0;
    pad.dy = 0;
    if (!l) return;
    pad.readyAt = now + RELOAD_MS;
    pad.lastUse = now;
    events.launch({ pad, vx: l.vx, vy: l.vy, human });
  };

  const charge = (l: Launcher, t: number) =>
    t >= l.fullAt ? 1 : 1 - (l.fullAt - t) / (RECHARGE_S * 1000);

  return {
    pads,
    launchers,
    get lastHuman() {
      return lastHuman;
    },
    down(id, x, y, synthetic, t) {
      if (!synthetic) lastHuman = t;
      for (const l of launchers) {
        if (Math.hypot(x - l.spot.x, y - l.spot.y) > l.spot.r * 1.15) continue;
        if (charge(l, t) >= 1 && events.hole(l, !synthetic)) {
          l.firedAt = t;
          l.fullAt = t + RECHARGE_S * 1000;
        }
        return true;
      }
      let best: Pad | null = null;
      let bd = Infinity;
      for (const p of pads) {
        const d = Math.hypot(x - p.spot.x, y - p.spot.y);
        if (d <= p.spot.grab && d < bd) {
          bd = d;
          best = p;
        }
      }
      if (!best) return false;
      if (best.holder === "ghost") best.holder = null;
      if (best.holder !== null || t < best.readyAt) return true;
      best.pointer = id;
      best.holder = synthetic ? "bot" : "person";
      // A touch below the body already counts as pulling.
      best.dx = x - best.spot.x;
      best.dy = Math.max(0, y - best.spot.y);
      best.lastUse = t;
      if (!synthetic) best.lastHuman = t;
      byPointer.set(id, best);
      return true;
    },
    move(id, x, y) {
      const p = byPointer.get(id);
      if (!p) return;
      p.dx = x - p.spot.x;
      p.dy = y - p.spot.y;
    },
    up(id, x, y, t) {
      const p = byPointer.get(id);
      if (!p) return;
      p.dx = x - p.spot.x;
      p.dy = y - p.spot.y;
      if (p.holder === "person") p.lastHuman = t;
      release(p, t, true);
    },
    cancel(id) {
      const p = byPointer.get(id);
      if (p) release(p, 0, false);
    },
    ghostHold(index, dx, dy, t) {
      const p = pads[index];
      if (!p || (p.holder !== null && p.holder !== "ghost") || t < p.readyAt) return false;
      p.holder = "ghost";
      p.dx = dx;
      p.dy = dy;
      return true;
    },
    ghostRelease(index, t) {
      const p = pads[index];
      if (p?.holder === "ghost") release(p, t, true);
    },
    release() {
      for (const p of pads) release(p, 0, false);
    },
    charge,
    reset(t) {
      for (const p of pads) {
        release(p, 0, false);
        p.readyAt = t;
        p.lastUse = t;
        p.glowAt = -Infinity;
      }
      for (const l of launchers) {
        l.fullAt = t;
        l.firedAt = -Infinity;
      }
    },
  };
};
