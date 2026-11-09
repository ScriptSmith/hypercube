/**
 * Bots play like people, through injected touches: each takes a slingshot, now and then taps
 * its picker for another body, chooses a shot with the predictor (with a little aiming error),
 * drags the body back and lets go. Now and then one fires a charged black hole or taps the time
 * control. A bot stands back from a pad a person has used lately.
 */
import { createBotHand, type BotHand } from "../../core/input";
import type { Input } from "../../core/types";
import { pullFor, type Shot } from "./aim";
import type { Chooser } from "./chooser";
import type { Pads } from "./pads";

/** A bot leaves a pad alone this long after a person used it. */
export const STAND_BACK_MS = 20_000;
/** A bot that tapped its picker waits this long before pulling. */
const PICK_MS = 300;

interface Bot {
  hand: BotHand;
  pad: number;
  next: number;
  chooser: Chooser | null;
  busyUntil: number;
  pending: { shot: Shot; at: number } | null;
}

export interface Bots {
  update(now: number): void;
  readonly shots: number;
  release(): void;
  dispose(): void;
}

export interface Tap {
  x: number;
  y: number;
}

export const createBots = (opts: {
  input: Pick<Input, "inject">;
  count: number;
  pads: () => Pads | null;
  /** Stage px per venue px. */
  unit: () => number;
  plan(pad: number): Chooser;
  gap: () => number;
  rand: () => number;
  /** A picker button to tap before a shot from this pad, or null to keep the body it has. */
  prepare?(pad: number): Tap | null;
  /** Something else to tap now and then (the time control), or null. */
  chore?(): Tap | null;
  /** Chance per look that a bot fires a charged black hole. */
  holeChance?: number;
}): Bots => {
  const bots: Bot[] = [];
  let shots = 0;
  let holeAt = 0;
  let choreAt = 0;
  const ensure = (n: number) => {
    while (bots.length < Math.min(opts.count, n)) {
      bots.push({
        hand: createBotHand(opts.input),
        pad: -1,
        next: 0,
        chooser: null,
        busyUntil: 0,
        pending: null,
      });
    }
  };

  const shoot = (b: Bot, pads: Pads, shot: Shot, now: number) => {
    const p = pads.pads[b.pad];
    if (!p) return;
    const u = opts.unit();
    const target = pullFor(p.spot, shot);
    const path = Array.from({ length: 12 }, (_, i) => {
      const t = i / 11;
      const e = t * t * (3 - 2 * t);
      return { x: (p.spot.x + target.dx * e) * u, y: (p.spot.y + target.dy * e) * u };
    });
    // Hold at the end so the ribbon shows before the release.
    for (let i = 0; i < 6; i++) path.push(path[path.length - 1]!);
    const ms = 900 + opts.rand() * 300;
    b.busyUntil = now + ms + 200;
    shots++;
    void b.hand.drag(path, ms);
  };

  const tap = (b: Bot, t: Tap, now: number) => {
    const u = opts.unit();
    b.busyUntil = now + 250;
    void b.hand.tap(t.x * u, t.y * u, 90);
  };

  return {
    get shots() {
      return shots;
    },
    update(now) {
      const pads = opts.pads();
      if (!pads || opts.count <= 0) return;
      ensure(pads.pads.length);
      // Only one bot thinks about its shot per look, so many bots never hold a frame up.
      let thinking = false;
      bots.forEach((b, i) => {
        const want = Math.floor(
          (i * pads.pads.length) / Math.max(1, Math.min(opts.count, pads.pads.length)),
        );
        if (b.pad !== want) {
          b.pad = want;
          b.chooser = null;
          b.pending = null;
        }
        if (now < b.busyUntil || now < b.next) return;
        const p = pads.pads[b.pad];
        if (!p) return;
        if (now - p.lastHuman < STAND_BACK_MS || (p.holder !== null && p.holder !== "ghost")) {
          b.next = now + 1000;
          b.chooser = null;
          b.pending = null;
          return;
        }
        if (now < p.readyAt) return;
        if (b.pending) {
          if (now < b.pending.at) return;
          shoot(b, pads, b.pending.shot, now);
          b.pending = null;
          b.next = b.busyUntil + opts.gap();
          return;
        }
        if (thinking) return;
        thinking = true;
        if (!b.chooser) {
          const t = opts.prepare?.(b.pad);
          if (t) tap(b, t, now);
          b.chooser = opts.plan(b.pad);
          return;
        }
        const shot = b.chooser.work() ?? b.chooser.work();
        if (!shot) return;
        b.chooser = null;
        b.pending = { shot, at: now + PICK_MS };
      });
      if (now >= holeAt) {
        holeAt = now + 5000;
        const chance = opts.holeChance ?? 0.1;
        for (const l of pads.launchers) {
          if (pads.charge(l, now) < 1 || opts.rand() > chance) continue;
          if (now - pads.lastHuman < STAND_BACK_MS) continue;
          const b = bots.find((x) => now >= x.busyUntil && !x.pending);
          if (!b) break;
          tap(b, { x: l.spot.x, y: l.spot.y }, now);
          break;
        }
      }
      if (opts.chore && now >= choreAt) {
        choreAt = now + 9000 + opts.rand() * 9000;
        if (now - pads.lastHuman >= STAND_BACK_MS) {
          const t = opts.chore();
          const b = bots.find((x) => now >= x.busyUntil && !x.pending);
          if (t && b) tap(b, t, now);
        }
      }
    },
    release() {
      for (const b of bots) {
        b.hand.release();
        b.chooser = null;
        b.pending = null;
        b.busyUntil = 0;
      }
    },
    dispose() {
      for (const b of bots) b.hand.dispose();
      bots.length = 0;
    },
  };
};
