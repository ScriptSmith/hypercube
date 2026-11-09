/**
 * Carries out the planner's steps the way a visitor would: a finger on each dial that has to
 * turn, dragged round together so the joints arrive together, and a tap on the grip button.
 * Fingers come from a `Hand`: injected touches for bots, or ghost fingers for the
 * demonstration, so both take the same path through controls.ts. Driven by the fixed-step loop
 * in simulation seconds, so it behaves the same however slowly the page renders.
 *
 * When a step fails (a joint stopped by the clamp, a grab that missed, a move that never
 * settles) the driver lets go, lifts a little and asks for a fresh plan; a piece that keeps
 * failing is left alone for a while.
 */
import type { Rng } from "../../core/types";
import type { Cell } from "./cell";
import { JOINTS } from "./kinematics";
import type { CellLayout } from "./layout";
import { createMemory, homeSteps, type PilotMemory, plan, type Step } from "./pilot";

/** Venue px. */
export interface Finger {
  readonly active: boolean;
  move(x: number, y: number): void;
  up(): void;
}

export interface Hand {
  press(x: number, y: number): Finger;
}

export interface DriverOptions {
  cell: Cell;
  layout: () => CellLayout | undefined;
  hand: Hand;
  rng: Rng;
  /** Servo speed scale, so dials never outrun the joints by much. */
  speed: number;
  /** Go home and rest after each piece (the demonstration) instead of carrying straight on. */
  restAtHome: boolean;
  /** Seconds to rest at home. */
  rest?: number;
  /** Called after many failures in a row: the arm is jammed. */
  onStuck?(): void;
  /** On a bank, send one piece in this many up the lift. */
  liftEvery?: number;
}

export interface Driver {
  update(dt: number): void;
  /** Lift every finger and drop the current plan. */
  release(): void;
  /** Where its fingers are, venue px, for ghost hands. */
  readonly fingers: readonly { x: number; y: number }[];
  readonly step: Step | null;
  readonly stats: { plans: number; failures: number; steps: number; lastFailure: string };
  readonly memory: PilotMemory;
}

/** Dials turn at this share of the joint's top speed on average (smoothstep peaks at 1.5x). */
const DIAL_SHARE = 0.6;
const SETTLE = 0.012;
const SETTLE_TIMEOUT = 3;
/** Finger distance from a dial's centre, as a share of its radius. */
const FINGER_R = 0.64;
const TAP_S = 0.1;
const SKIP_S = 25;
const STUCK_STREAK = 12;

interface Turn {
  joint: number;
  from: number;
  to: number;
  /** Screen angle of the finger at the start. */
  angle0: number;
  /** The joint's clamp stop count when the move began. */
  stops: number;
  finger: Finger | null;
}

interface Active {
  step: Step;
  t: number;
  turns: Turn[];
  duration: number;
  phase: "sweep" | "settle" | "tap" | "after" | "wait";
  tap: Finger | null;
}

const smooth = (f: number) => f * f * (3 - 2 * f);

export const createDriver = (o: DriverOptions): Driver => {
  const { cell, rng } = o;
  const memory = createMemory(o.liftEvery ?? 1);
  let queue: Step[] = [];
  let active: Active | null = null;
  let target: number | null = null;
  let pause = rng.range(0.4, 1);
  let fails = 0;
  /** Failures in a row, whatever the target. */
  let streak = 0;
  /** At home with nothing to do. */
  let idleHome = false;
  /** A piece was just let go, so the demonstration rests before the next. */
  let placed = false;
  const stats = { plans: 0, failures: 0, steps: 0, lastFailure: "" };
  const fingers: { x: number; y: number }[] = [];

  const lift = () => {
    if (!active) return;
    for (const t of active.turns) {
      t.finger?.up();
      t.finger = null;
    }
    active.tap?.up();
    active.tap = null;
  };

  const fingerAt = (j: number, angle: number) => {
    const d = o.layout()?.dials[j];
    if (!d) return null;
    return { x: d.x + Math.cos(angle) * d.r * FINGER_R, y: d.y + Math.sin(angle) * d.r * FINGER_R };
  };

  const begin = (step: Step) => {
    stats.steps++;
    active = { step, t: 0, turns: [], duration: 0, phase: "wait", tap: null };
    if (step.kind === "move") {
      let dur = 0.25;
      for (const tg of step.targets) {
        const from = cell.target[tg.joint]!;
        const rate = (JOINTS[tg.joint]?.rate ?? 1) * o.speed * DIAL_SHARE;
        dur = Math.max(dur, Math.abs(tg.value - from) / rate);
        const angle0 = -Math.PI / 2 + from;
        const at = fingerAt(tg.joint, angle0);
        active.turns.push({
          joint: tg.joint,
          from,
          to: tg.value,
          angle0,
          stops: cell.stops[tg.joint] ?? 0,
          finger: at ? o.hand.press(at.x, at.y) : null,
        });
      }
      active.duration = dur;
      active.phase = "sweep";
    } else if (step.kind === "grip") {
      if (cell.grip.closed === step.close) {
        active.phase = "after";
        active.duration = 0;
      } else {
        const g = o.layout()?.grip;
        active.tap = g
          ? o.hand.press(g.x + rng.range(-0.2, 0.2) * g.r, g.y + rng.range(-0.2, 0.2) * g.r)
          : null;
        active.phase = "tap";
        active.duration = TAP_S;
      }
    } else {
      active.phase = "wait";
      active.duration = step.s;
    }
  };

  const fail = (why: string) => {
    stats.lastFailure = `${active?.step.label ?? "?"}: ${why}`;
    lift();
    active = null;
    queue = [];
    stats.failures++;
    fails++;
    if (target !== null && fails >= 2) {
      memory.skip.set(target, memory.time + SKIP_S);
      fails = 0;
    }
    streak++;
    if (streak >= STUCK_STREAK) {
      streak = 0;
      o.onStuck?.();
      pause = 1;
      return;
    }
    // Get clear of whatever stopped the arm, a different way each time, then plan afresh.
    const toward = (j: number, goal: number, by: number) => {
      const cur = cell.q[j]!;
      const d = Math.max(-by, Math.min(by, goal - cur));
      return { joint: j, value: Math.max(JOINTS[j]!.min, Math.min(JOINTS[j]!.max, cur + d)) };
    };
    const escapes = [
      [{ joint: 1, value: Math.max(JOINTS[1]!.min, cell.q[1] - 0.25) }],
      [toward(2, Math.PI / 2, 0.35)],
      [toward(4, 0, 0.35), toward(3, 0, 0.5)],
      [toward(0, cell.q[0] > 0 ? cell.q[0] - 0.4 : cell.q[0] + 0.4, 0.4)],
    ];
    queue.push({
      kind: "move",
      label: "back off",
      targets: escapes[(streak - 1) % escapes.length]!,
    });
    pause = 0.3;
  };

  const finish = () => {
    lift();
    if (active?.step.kind !== "wait") streak = 0;
    active = null;
  };

  const nextPlan = () => {
    if (o.restAtHome && placed) {
      placed = false;
      target = null;
      queue = [...homeSteps(cell), { kind: "wait", s: o.rest ?? 2.5, label: "rest" }];
      return;
    }
    stats.plans++;
    const p = plan(cell, memory);
    target = p.target;
    if (p.steps.length) {
      queue = p.steps;
      idleHome = false;
      return;
    }
    if (!idleHome) {
      queue = homeSteps(cell);
      idleHome = true;
    }
    pause = 1;
  };

  const stopped = (t: Turn) => (cell.stops[t.joint] ?? 0) > t.stops;

  const tick = (dt: number) => {
    const a = active;
    if (!a) return;
    a.t += dt;
    const step = a.step;
    if (step.kind === "move") {
      if (a.phase === "sweep") {
        const f = smooth(Math.min(1, a.t / a.duration));
        for (const t of a.turns) {
          const v = t.from + (t.to - t.from) * f;
          const at = fingerAt(t.joint, t.angle0 + (v - t.from));
          if (at && t.finger?.active) t.finger.move(at.x, at.y);
          if (stopped(t)) {
            fail(`joint ${t.joint} stopped`);
            return;
          }
        }
        if (a.t >= a.duration) {
          lift();
          a.phase = "settle";
          a.t = 0;
        }
      } else if (a.phase === "settle") {
        const off = a.turns.some((t) => Math.abs(cell.target[t.joint]! - t.to) > 0.03);
        if (off) {
          fail("dial off target");
          return;
        }
        const settled = a.turns.every((t) => Math.abs(cell.q[t.joint]! - t.to) < SETTLE);
        if (settled) finish();
        else if (a.t > SETTLE_TIMEOUT) fail("never settled");
      }
      return;
    }
    if (step.kind === "grip") {
      if (a.phase === "tap" && a.t >= a.duration) {
        a.tap?.up();
        a.tap = null;
        a.phase = "after";
        a.t = 0;
      } else if (a.phase === "after" && a.t >= 0.32) {
        if (step.close && !cell.heldPiece()) {
          fail("missed");
          return;
        }
        if (step.close) fails = 0;
        else if (step.label === "let go") placed = true;
        finish();
      }
      return;
    }
    if (a.t >= a.duration) finish();
  };

  const update = (dt: number) => {
    memory.time += dt;
    if (active) {
      tick(dt);
    } else if (pause > 0) {
      pause -= dt;
    } else if (queue.length) {
      begin(queue.shift()!);
    } else {
      nextPlan();
      if (queue.length && pause <= 0) pause = rng.range(0.15, 0.45);
    }
    fingers.length = 0;
    if (active) {
      for (const t of active.turns) {
        const d = o.layout()?.dials[t.joint];
        if (t.finger?.active && d) {
          const v = cell.target[t.joint]!;
          const at = fingerAt(t.joint, t.angle0 + (v - t.from));
          if (at) fingers.push(at);
        }
      }
      const g = o.layout()?.grip;
      if (active.tap?.active && g) fingers.push({ x: g.x, y: g.y });
    }
  };

  return {
    update,
    release() {
      lift();
      active = null;
      queue = [];
      pause = rng.range(0.3, 0.8);
      idleHome = false;
    },
    get fingers() {
      return fingers;
    },
    get step() {
      return active?.step ?? null;
    },
    stats,
    memory,
  };
};

/** Ids for direct fingers, shared by every hand so arms on one frame never mix them up. */
let nextDirectId = -1;

/**
 * A hand whose fingers go straight into the controls: the demonstration's ghost fingers, and
 * the tests' stand-in for injected touches. Ids are negative so they never meet real pointers.
 */
export const createDirectHand = (
  controls: {
    down(id: number, x: number, y: number, kind: "person" | "bot" | "ghost", now: number): boolean;
    move(id: number, x: number, y: number, now: number): void;
    up(id: number): void;
  },
  kind: "bot" | "ghost",
  now: () => number,
): Hand => {
  return {
    press(x, y) {
      const id = nextDirectId;
      nextDirectId = nextDirectId <= -1_000_000 ? -1 : nextDirectId - 1;
      let active = controls.down(id, x, y, kind, now());
      return {
        get active() {
          return active;
        },
        move(nx, ny) {
          if (active) controls.move(id, nx, ny, now());
        },
        up() {
          if (!active) return;
          active = false;
          controls.up(id);
        },
      };
    },
  };
};
