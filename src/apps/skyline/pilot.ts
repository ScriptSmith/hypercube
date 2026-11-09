/**
 * The autopilot: catch the oldest yard block that fits, carry it at a safe height and set it in
 * the next slot, then come back. It reads only a `Readout` (the pad's 0..1 box) and speaks only
 * through a `PilotHand`, so the same plan drives a crane directly where it is simulated, a bot's
 * injected finger on a pad, and a bot on a bank frame steering a crane on the screen above.
 *
 * Moves overlap as an operator's would: the trolley sets off once the hook is halfway up, and
 * the hook starts down before the trolley arrives. Moves across are input shaped (zero
 * vibration: the move is split into two halves, the second starting half a swing period after
 * the first, so the swings the two halves start cancel), and it lets the load hang still just
 * above a slot before lowering it in.
 */
import type { Rng } from "../../core/types";
import type { Point, Readout } from "./crane";

export interface PilotHand {
  /** Aim the hook, in the pad's box (y up). Called every update while a task runs. */
  aim(x: number, y: number): void;
  release(): void;
  /** Nothing to do for now: a bot lifts its finger. */
  rest(): void;
}

export interface PilotOptions {
  rng: Rng;
  hand: PilotHand;
  /** Bots: now and then let go a little early, and sometimes skip the shaping. */
  sloppy?: boolean;
}

type Phase = "plan" | "rise" | "travel" | "hover" | "lower";
type GoalKind = "pick" | "drop" | "park";

export interface Pilot {
  readonly phase: Phase;
  /** Where it aims now, for the ghost finger. Null while resting. */
  readonly aim: Point | null;
  readonly goal: GoalKind | null;
  readonly stats: { picks: number; drops: number; parks: number; replans: number; early: number };
  update(dt: number, r: Readout): void;
  /** Drop the current task, e.g. when a person takes over. */
  reset(): void;
}

/** Steady enough to lower into a slot, and onto a yard block: how far the load swings, in units. */
const STEADY = { drop: 0.17, pick: 0.35 };
const NEAR_X = 0.015;
const LOWER_TIMEOUT_S = 7;
const HOVER_TIMEOUT_S = 5;
const RISE_TIMEOUT_S = 8;
const TRAVEL_SLACK_S = 4;
/** The hook starts down once the move across is this far along. */
const DESCEND_AT = 0.75;

/** A trapezoid (or triangle) move of `d`, with top speed `v` and acceleration `a`. */
export const profile = (d: number, v: number, a: number) => {
  const D = Math.abs(d);
  const ta = v / a;
  let t1: number;
  let tc: number;
  let vp: number;
  if (a * ta * ta >= D) {
    t1 = Math.sqrt(D / a);
    tc = 0;
    vp = a * t1;
  } else {
    t1 = ta;
    vp = v;
    tc = (D - a * ta * ta) / v;
  }
  const total = 2 * t1 + tc;
  const at = (t: number): number => {
    if (t <= 0) return 0;
    if (t >= total) return d;
    let s: number;
    if (t < t1) s = 0.5 * a * t * t;
    else if (t < t1 + tc) s = 0.5 * a * t1 * t1 + vp * (t - t1);
    else {
      const u = total - t;
      s = D - 0.5 * a * u * u;
    }
    return Math.sign(d) * s;
  };
  return { total, at };
};

export const createPilot = (o: PilotOptions): Pilot => {
  const hand = o.hand;
  let phase: Phase = "plan";
  let aim: Point | null = null;
  let goal: { x: number; y: number; kind: GoalKind } | null = null;
  let carryY = 0.9;
  let hoverY = 0.5;
  let riseFrom = 0;
  let t = 0;
  let move: { x0: number; d: number; half: number; p: ReturnType<typeof profile> } | null = null;
  let early = false;
  let jitter = 0;
  const stats = { picks: 0, drops: 0, parks: 0, replans: 0, early: 0 };

  const set = (x: number, y: number) => {
    aim = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    hand.aim(aim.x, aim.y);
  };

  const choose = (r: Readout) => {
    if (r.carrying < 0 && r.pick) return { ...r.pick, kind: "pick" as const };
    if (r.carrying >= 0 && r.drop) return { ...r.drop, kind: "drop" as const };
    if (r.carrying >= 0 && r.park) return { ...r.park, kind: "park" as const };
    return null;
  };

  const startTravel = (r: Readout) => {
    if (!goal) return;
    const x0 = aim?.x ?? r.trolley;
    const d = goal.x + jitter - x0;
    const shaped = !(o.sloppy && o.rng.next() < 0.25);
    move = {
      x0,
      d,
      half: shaped ? r.period / 2 : 0,
      p: profile(d, r.vx * 0.95, r.ax * 0.9),
    };
    t = 0;
    phase = "travel";
  };

  const begin = (r: Readout) => {
    goal = choose(r);
    if (!goal) {
      aim = null;
      hand.rest();
      return;
    }
    hoverY = Math.min(1, goal.y + r.unit * (goal.kind === "pick" ? 1.6 : 1.3));
    carryY = Math.max(r.carry, hoverY);
    jitter = r.jitter > 0 && goal.kind === "drop" ? o.rng.range(-r.jitter, r.jitter) : 0;
    early = !!o.sloppy && goal.kind === "drop" && o.rng.next() < 0.12;
    riseFrom = r.hook.y;
    t = 0;
    phase = "rise";
    set(aim?.x ?? r.trolley, Math.max(carryY, r.hook.y));
  };

  const done = (kind: "picks" | "drops" | "parks", r: Readout) => {
    stats[kind]++;
    phase = "plan";
    begin(r);
  };

  return {
    get phase() {
      return phase;
    },
    get aim() {
      return aim;
    },
    get goal() {
      return goal?.kind ?? null;
    },
    stats,
    reset() {
      phase = "plan";
      goal = null;
      move = null;
      aim = null;
    },
    update(dt, r) {
      t += dt;
      switch (phase) {
        case "plan": {
          begin(r);
          return;
        }
        case "rise": {
          set(aim?.x ?? r.trolley, carryY);
          const half = riseFrom + (carryY - riseFrom) * 0.55;
          if (r.hook.y >= Math.min(half, carryY - 0.03) || t > RISE_TIMEOUT_S) startTravel(r);
          return;
        }
        case "travel": {
          if (!move || !goal) {
            phase = "plan";
            return;
          }
          // The goal can move (another slot, a block taken): plan the rest of the way again.
          const now = choose(r);
          if (!now || now.kind !== goal.kind || Math.abs(now.x - goal.x) > 0.03) {
            stats.replans++;
            goal = now;
            if (!goal) {
              phase = "plan";
              return;
            }
            hoverY = Math.min(1, goal.y + r.unit * (goal.kind === "pick" ? 1.6 : 1.3));
            carryY = Math.max(carryY, hoverY);
            startTravel(r);
            return;
          }
          const x = move.x0 + 0.5 * (move.p.at(t) + move.p.at(t - move.half));
          const share = Math.abs(move.d) > 1e-6 ? (x - move.x0) / move.d : 1;
          set(x, share >= DESCEND_AT ? hoverY : carryY);
          if (early && Math.abs(x - (goal.x + jitter)) < 0.06) {
            // A bot letting go too soon: the block drops and finds its way back to the yard.
            early = false;
            stats.early++;
            hand.release();
            phase = "plan";
            return;
          }
          const end = move.p.total + move.half;
          const there = Math.abs(r.trolley - (goal.x + jitter)) < NEAR_X;
          if (t >= end && (there || t > end + TRAVEL_SLACK_S)) {
            phase = "hover";
            t = 0;
          }
          return;
        }
        case "hover": {
          if (!goal) {
            phase = "plan";
            return;
          }
          set(goal.x + jitter, hoverY);
          const low = r.hook.y <= hoverY + 0.02;
          const steady = r.drift < (goal.kind === "drop" ? STEADY.drop : STEADY.pick);
          if ((low && steady) || t > HOVER_TIMEOUT_S) {
            phase = "lower";
            t = 0;
          }
          return;
        }
        case "lower": {
          if (!goal) {
            phase = "plan";
            return;
          }
          set(goal.x + jitter, goal.y);
          if (goal.kind === "pick" && r.carrying >= 0) return done("picks", r);
          if (goal.kind === "drop" && r.carrying < 0) return done("drops", r);
          if (goal.kind === "park" && Math.abs(r.hook.y - goal.y) < 0.03) {
            hand.release();
            return done("parks", r);
          }
          // In place but the hook hasn't let go by itself (a swing, a stale reading): let go.
          if (goal.kind === "drop" && r.inZone && t > 2.2) hand.release();
          if (t > LOWER_TIMEOUT_S) {
            stats.replans++;
            phase = "plan";
          }
          return;
        }
      }
    },
  };
};
