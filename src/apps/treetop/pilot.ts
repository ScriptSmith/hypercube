/**
 * Bot pilots. A pilot aims for the centre of the next gap, plus a little error it picks per
 * gate, and notices a new gate only after a reaction delay. It flaps when the glider is about to
 * drop far enough below the aim that the flap's arc centres on it, with some timing noise. Now
 * and then it misjudges a gate badly, so bots clear most gates but crash now and then.
 */
import type { Rng } from "../../core/types";
import { type Body, CEIL_Y, RADIUS } from "./config";
import type { Course } from "./course";
import type { Flight } from "./flight";

export interface Skill {
  /** Seconds before a pilot reacts to the next gate. */
  reaction: [number, number];
  /** Aim error per gate as a fraction of the gap height (standard deviation). */
  error: number;
  /** Chance per gate of a bad misjudgement. */
  lapse: number;
  /** Extra random delay on each flap, seconds. */
  jitter: number;
}

export const SKILLS: Record<"steady" | "attract" | "rival", Skill> = {
  steady: { reaction: [0.12, 0.2], error: 0.06, lapse: 0.015, jitter: 0.02 },
  attract: { reaction: [0.14, 0.26], error: 0.09, lapse: 0.05, jitter: 0.035 },
  rival: { reaction: [0.12, 0.28], error: 0.1, lapse: 0.06, jitter: 0.04 },
};

/** How far ahead the pilot predicts the glider's height. */
const LOOKAHEAD_S = 0.05;
/**
 * A flap's arc peaks this far above where it began (as a fraction of its full rise), on average,
 * so flapping that far below the aim keeps the glider centred on it.
 */
const ARC = 0.55;
/** Fewest seconds between a pilot's flaps. */
const MIN_GAP_S = 0.14;

/** A small height bias per lane, so a field of bots on the screen spreads out. */
export const laneBias = (index: number): number => ((index % 5) - 2) * 0.07;

export interface Pilot {
  /** True when the pilot wants to flap this step. */
  step(f: Flight, course: Course, body: Body, dt: number): boolean;
  reset(): void;
}

const gauss = (rng: Rng) => {
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/**
 * `bias` shifts every aim by that fraction of the gap height (negative is higher), so several
 * bots in one view don't fly on top of each other.
 */
export const createPilot = (rng: Rng, skill: Skill, bias = 0): Pilot => {
  let target = -1;
  let aim = 900;
  let pendingAim = 900;
  let react = 0;
  let wait = 0;
  let sinceFlap = 1;

  /** This gate is a misjudged one: no care taken to stay inside the gap. */
  let careless = false;
  let pendingCareless = false;

  const pickAim = (c: number, h: number) => {
    const lapse = rng.next() < skill.lapse;
    pendingCareless = lapse;
    const err = lapse
      ? (rng.next() < 0.5 ? -1 : 1) * rng.range(0.4, 0.55)
      : gauss(rng) * skill.error;
    return c + (err + bias) * h;
  };

  return {
    step(f, course, body, dt) {
      sinceFlap += dt;
      if (f.mode !== "flying") {
        target = -1;
        wait = 0;
        return false;
      }
      // Once through the middle of a gate, look to the one after it.
      const here = course.gates[f.next];
      const ahead = here && f.x > here.x + here.w * 0.3 ? course.gates[f.next + 1] : undefined;
      const g = ahead ?? here;
      if (g && g.i !== target) {
        target = g.i;
        pendingAim = pickAim(g.c, g.h);
        react = rng.range(skill.reaction[0], skill.reaction[1]);
      } else if (!g && target !== -2) {
        target = -2;
        pendingAim = 900;
        react = skill.reaction[1];
      }
      if (react > 0) {
        react -= dt;
        if (react <= 0) {
          aim = pendingAim;
          careless = pendingCareless;
        }
      }
      if (wait > 0) {
        wait -= dt;
        if (wait > 0) return false;
        wait = 0;
        sinceFlap = 0;
        return true;
      }
      const rise = (body.flap * body.flap) / (2 * body.gravity);
      const t = LOOKAHEAD_S;
      const predicted = f.y + f.vy * t + 0.5 * body.gravity * t * t;
      let want = predicted > aim + rise * ARC;
      // While the glider overlaps the next gate, keep it inside the gap: no flap whose arc would
      // reach the top edge, and a flap before falling onto the bottom edge.
      if (here && !careless && f.speed > 0) {
        const enter = Math.max(0, (here.x - RADIUS - f.x) / f.speed);
        const exit = (here.x + here.w + RADIUS - f.x) / f.speed;
        if (exit > 0 && enter < 0.45) {
          const top = here.c - here.h / 2 + RADIUS + 12;
          const bottom = here.c + here.h / 2 - RADIUS - 12;
          const apexT = body.flap / body.gravity;
          const peakT = Math.min(Math.max(apexT, enter), exit);
          const peak = f.y - body.flap * peakT + 0.5 * body.gravity * peakT * peakT;
          const fallT = Math.min(exit, 0.25);
          const low = f.y + f.vy * fallT + 0.5 * body.gravity * fallT * fallT;
          if (peak < top) want = false;
          else if (low > bottom && enter < fallT) want = true;
        }
      }
      if (want && sinceFlap > MIN_GAP_S && f.y - RADIUS > CEIL_Y + 30) {
        wait = rng.next() * skill.jitter;
        if (wait <= dt) {
          wait = 0;
          sinceFlap = 0;
          return true;
        }
      }
      return false;
    },
    reset() {
      careless = false;
      pendingCareless = false;
      target = -1;
      aim = 900;
      pendingAim = 900;
      react = 0;
      wait = 0;
      sinceFlap = 1;
    },
  };
};
