/**
 * Attract: while nobody plays, a ghost hand takes a slingshot every few seconds, picks a body,
 * pulls it back along a shot chosen with the predictor (so the ribbon shows it lining up), holds
 * a moment and lets go. A person touching that pad takes it over at once.
 */
import { pullFor, type Shot } from "./aim";
import type { Chooser } from "./chooser";
import type { Pads } from "./pads";

const REACH_MS = 450;
const PULL_MS = 850;
const HOLD_MS = 500;
const LEAVE_MS = 400;

export interface Ghost {
  update(now: number): void;
  /** Where the hand is and how visible, or null. */
  hand(): { x: number; y: number; alpha: number } | null;
  /** Shots it has fired, for tests. */
  readonly shots: number;
  stop(): void;
}

export const createGhost = (opts: {
  pads: () => Pads | null;
  /** Start choosing a shot for this pad. */
  plan(pad: number): Chooser;
  /** Called as the ghost takes a pad, before it plans (it may pick another body). */
  prepare?(pad: number): void;
  /** Whether the ghost may play now. */
  allowed(now: number): boolean;
  /** Pause between shots, ms. */
  gap: () => number;
  rand: () => number;
}): Ghost => {
  type Phase = "wait" | "think" | "reach" | "pull" | "hold" | "leave";
  let phase: Phase = "wait";
  let at = 0;
  let next = 0;
  let pad = -1;
  let chooser: Chooser | null = null;
  let shot: Shot | null = null;
  let shots = 0;
  let hand: { x: number; y: number; alpha: number } | null = null;

  const stop = () => {
    const p = opts.pads();
    if (p && pad >= 0 && p.pads[pad]?.holder === "ghost") {
      const pd = p.pads[pad]!;
      pd.holder = null;
      pd.dx = 0;
      pd.dy = 0;
    }
    phase = "wait";
    chooser = null;
    shot = null;
    hand = null;
    pad = -1;
  };

  return {
    get shots() {
      return shots;
    },
    hand: () => hand,
    stop,
    update(now) {
      const pads = opts.pads();
      if (!pads || !opts.allowed(now)) {
        if (phase !== "wait") stop();
        next = Math.max(next, now + 1500);
        return;
      }
      const pd = pad >= 0 ? pads.pads[pad] : undefined;
      // Someone took the pad: while reaching it must still be free, after that still the ghost's.
      const taken =
        pd &&
        ((phase === "reach" && pd.holder !== null) ||
          ((phase === "pull" || phase === "hold") && pd.holder !== "ghost"));
      if (taken) {
        stop();
        next = now + opts.gap();
        return;
      }
      switch (phase) {
        case "wait": {
          if (now < next) return;
          const free = pads.pads.filter((p) => p.holder === null && now >= p.readyAt);
          if (free.length === 0) {
            next = now + 500;
            return;
          }
          const choice = free[Math.floor(opts.rand() * free.length)]!;
          pad = pads.pads.indexOf(choice);
          opts.prepare?.(pad);
          chooser = opts.plan(pad);
          phase = "think";
          return;
        }
        case "think": {
          // A couple of candidates a frame.
          shot = chooser?.work() ?? null;
          if (!shot) shot = chooser?.work() ?? null;
          if (!shot) return;
          phase = "reach";
          at = now;
          return;
        }
        case "reach": {
          const s = pads.pads[pad]!.spot;
          const t = Math.min(1, (now - at) / REACH_MS);
          hand = { x: s.x + s.grab * 0.9 * (1 - t), y: s.y + s.grab * 1.2 * (1 - t), alpha: t };
          if (t >= 1) {
            if (!pads.ghostHold(pad, 0, 0, now)) {
              stop();
              next = now + 800;
              return;
            }
            phase = "pull";
            at = now;
          }
          return;
        }
        case "pull":
        case "hold": {
          const s = pads.pads[pad]!.spot;
          const target = pullFor(s, shot!);
          const t = phase === "pull" ? Math.min(1, (now - at) / PULL_MS) : 1;
          const e = t * t * (3 - 2 * t);
          pads.ghostHold(pad, target.dx * e, target.dy * e, now);
          hand = { x: s.x + target.dx * e, y: s.y + target.dy * e, alpha: 1 };
          if (phase === "pull" && t >= 1) {
            phase = "hold";
            at = now;
          } else if (phase === "hold" && now - at >= HOLD_MS) {
            pads.ghostRelease(pad, now);
            shots++;
            phase = "leave";
            at = now;
          }
          return;
        }
        case "leave": {
          const t = Math.min(1, (now - at) / LEAVE_MS);
          if (hand) hand = { ...hand, alpha: 1 - t };
          if (t >= 1) {
            hand = null;
            phase = "wait";
            pad = -1;
            next = now + opts.gap();
          }
          return;
        }
      }
    },
  };
};
