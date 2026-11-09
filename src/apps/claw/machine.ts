/**
 * A claw machine's own logic, as in a real one: a player moves the claw with a joystick until
 * they press the button or time runs out, then the machine drops the claw, closes it, lifts it,
 * carries it to the chute and opens it. Like real machines it decides each round how hard the
 * claw holds on: a strong round now and then keeps wins near the operator's setting, and the rest
 * close firmly and then weaken, so prizes come up and slip. What happens to a prize is up to the
 * physics.
 *
 * Whoever plays (a bot now, a visitor later) only sets `controls`.
 */
import type { Rng } from "../../core/types";
import { DESIGN_IDS, DESIGNS, type DesignId } from "./designs";
import {
  type CabinetSpec,
  type CabinetWorld,
  CHUTE,
  SQUASH,
  createCabinetWorld,
  type Prize,
} from "./world";

export type Phase = "idle" | "play" | "drop" | "grab" | "lift" | "carry" | "release";

export interface Controls {
  /** Joystick: -1 left, 0 centred, 1 right. */
  stick: -1 | 0 | 1;
  /** Set true to press the button; the machine clears it. */
  drop: boolean;
}

export interface Grip {
  strong: boolean;
  /** Finger torques while closing, lifting and carrying. */
  grab: number;
  lift: number;
  carry: number;
  /** Seconds into the lift over which the grip eases from `grab` to `lift`. */
  fade: number;
  /**
   * Seconds into the carry when the claw loosens and its fingers drift open, as weak machines
   * do on the way to the chute; null to hold on.
   */
  loosen: number | null;
}

export interface RoundRecord {
  index: number;
  strong: boolean;
  /** A prize reached the top in the claw. */
  lifted: boolean;
  won: number;
  /** Seconds from coin to the claw opening over the chute. */
  seconds: number;
}

export interface WinEvent {
  prize: Prize;
  /** The round it came in, or -1 between rounds. */
  round: number;
}

export interface MachineOptions {
  spec: CabinetSpec;
  rng: Rng;
  /** Wins per round to aim for. */
  rate: number;
  /** The designs this machine is stocked with. */
  mix: readonly DesignId[];
  /** Seconds to wait before the first coin, so machines start apart. */
  delay?: number;
  /** Seconds the player has to aim before the claw drops by itself. */
  playLimit?: number;
}

export interface Machine {
  readonly world: CabinetWorld;
  readonly controls: Controls;
  readonly phase: Phase;
  /** Seconds into the phase. */
  readonly phaseT: number;
  /** Seconds the player has left in `play`. */
  readonly timeLeft: number;
  /** Smoothed joystick position, -1 to 1, for drawing. */
  readonly stickShown: number;
  readonly round: number;
  readonly grip: Grip | null;
  readonly stock: number;
  readonly rounds: readonly RoundRecord[];
  /** Total wins since mount. */
  readonly wins: number;
  /** Prizes that got out some other way and were replaced (never expected). */
  readonly lost: number;
  /** Seconds since the last win, for the marquee. */
  readonly sinceWin: number;
  /** Runs at the machine's fixed rate. Returns prizes that went down the chute. */
  step(dt: number): WinEvent[];
  /**
   * While true, the machine waits between rounds until `start()` rather than starting the next
   * round by itself, as when it waits for a player to come back.
   */
  hold: boolean;
  /**
   * A player takes the controls: between rounds the next round starts at once, and while
   * someone is aiming the clock starts again. False while the claw is busy with a round.
   */
  start(): boolean;
  /** Fill the machine and let the pile settle, before anyone sees it. */
  fill(): void;
  /** Make the next round strong (debug and e2e). */
  forceStrong(): void;
  dispose(): void;
}

export const STEP = 1 / 60;
/** Physics steps per machine step: grips hold better at 120 Hz. */
const SUBSTEPS = 2;
const PLAY_LIMIT = 22;
const TROLLEY_SPEED = 0.8;
const TROLLEY_ACCEL = 4;
const DROP_SPEED = 1.3;
const LIFT_SPEED = 0.95;
/** Cable motor forces: enough to lower the claw steadily, and to lift it with a heavy prize. */
const CABLE_FORCE = 30;
const LIFT_FORCE = 90;
const OPEN_TORQUE = 6;
/** How far the claw may sink into the pile while it closes, u. */
const SINK = 0.3;
/** Machine steps the drop looks back over to see whether the claw has stopped. */
const LANDING_STEPS = 9;
const STRONG = 22;
/** How often a weak round loosens on the way to the chute, and how hard its fingers then open. */
const LOOSEN = 0.75;
const LOOSE_TORQUE = 0.5;
/** Rounds the machine remembers, and the most prizes a pile ever holds. */
const RECORDS = 64;
export const MAX_STOCK = 22;

/** Prizes for a play area `width` x `height` u: about as many as fill its lower part. */
export const stockFor = (width: number, height: number): number =>
  Math.max(5, Math.min(MAX_STOCK, Math.round((width - CHUTE.width) * height * 1.3)));

export const createMachine = (o: MachineOptions): Machine => {
  const { spec, rng } = o;
  const playLimit = o.playLimit ?? PLAY_LIMIT;
  const world = createCabinetWorld(spec);
  const stock = stockFor(spec.width, spec.height);
  const controls: Controls = { stick: 0, drop: false };
  const records: RoundRecord[] = [];

  let phase: Phase = "idle";
  let phaseT = 0;
  let idleFor = o.delay ?? rng.range(1, 4);
  let round = 0;
  let roundStart = 0;
  let t = 0;
  let vx = 0;
  let stickShown = 0;
  let grip: Grip | null = null;
  // Wins owed against the rate: a strong round becomes likelier as it grows.
  let owed = 0;
  let forced = false;
  let wins = 0;
  let lastWin = Number.NEGATIVE_INFINITY;
  let lifted = false;
  let wonThisRound = 0;
  let sinceTopUp = 0;
  let lost = 0;
  let riding = 0;
  const depths: number[] = [];
  let landed = 0;
  let hold = false;
  let startNow = false;

  const go = (next: Phase) => {
    phase = next;
    phaseT = 0;
  };

  const pick = (): DesignId => (o.mix.length ? rng.pick(o.mix) : rng.pick(DESIGN_IDS));

  const newGrip = (): Grip => {
    // About half of strong grabs win, so aim for twice the rate, more while wins are owed.
    const p = Math.min(0.95, Math.max(0.03, 1.6 * o.rate + 0.5 * owed));
    const strong = forced || rng.next() < p;
    forced = false;
    if (strong) {
      return { strong, grab: STRONG, lift: STRONG, carry: STRONG * 0.9, fade: 0, loosen: null };
    }
    // Firm on the grab, so prizes come up, then fading: most slip on the way up or across.
    // Weaker still while the machine has paid out more than its share.
    const ahead = owed < 0 ? Math.max(0.4, 1 + 0.4 * owed) : 1;
    const lift = rng.range(0.4, 2.6) * ahead;
    return {
      strong,
      grab: rng.range(8, 13),
      lift,
      carry: lift * rng.range(0.4, 0.9),
      fade: rng.range(0.3, 1.8),
      loosen: rng.next() < LOOSEN ? rng.range(0, 1.6) : null,
    };
  };

  /** Somewhere to drop a new prize in from above, clear of the chute and the claw. */
  const topUpX = (): number => {
    const lo = spec.chute > 0 ? 0.45 : world.hole.x1 + 0.45;
    const hi = spec.chute > 0 ? world.hole.guardX - 0.45 : spec.width - 0.45;
    const clawX = world.trolleyX();
    for (let i = 0; i < 6; i++) {
      const x = rng.range(lo, hi);
      if (Math.abs(x - clawX) > 0.7) return x;
    }
    return rng.range(lo, hi);
  };

  const add = (x: number, y: number | null, angle: number) => {
    const d = pick();
    // From the canopy, upright enough to fit under its roof.
    const yy = y ?? spec.height + spec.canopy - 0.06 - DESIGNS[d].box.y1 * SQUASH;
    world.addPrize(d, rng.int(DESIGNS[d].colourways.length), x, yy, angle);
  };

  const topUp = () => add(topUpX(), null, rng.range(-0.15, 0.15));

  const moveTrolley = (target: number | null, speed: number, dt: number, accel = TROLLEY_ACCEL) => {
    const x = world.trolleyX();
    let want = 0;
    if (target !== null) {
      const d = target - x;
      // Brake in time to stop on the target.
      const brake = Math.sqrt(2 * accel * Math.abs(d));
      want = Math.sign(d) * Math.min(speed, brake);
      if (Math.abs(d) < 0.004) want = 0;
    } else {
      want = controls.stick * speed;
    }
    const dv = want - vx;
    const maxDv = accel * dt;
    vx += Math.max(-maxDv, Math.min(maxDv, dv));
    // The rails end before the walls.
    if ((x <= world.minX && vx < 0) || (x >= world.maxX && vx > 0)) vx = 0;
    world.setTrolleyVelocity(vx);
  };

  const endRound = () => {
    records.push({
      index: round,
      strong: grip?.strong ?? false,
      lifted,
      won: wonThisRound,
      seconds: t - roundStart,
    });
    if (records.length > RECORDS) records.shift();
    grip = null;
    idleFor = rng.range(4, 10);
    go("idle");
  };

  const machineStep = (dt: number) => {
    phaseT += dt;
    sinceTopUp += dt;
    stickShown += (controls.stick - stickShown) * Math.min(1, dt * 14);
    switch (phase) {
      case "idle": {
        controls.stick = 0;
        controls.drop = false;
        moveTrolley(world.home, TROLLEY_SPEED, dt);
        if (world.prizes.length < stock && sinceTopUp > 2.5) {
          topUp();
          sinceTopUp = 0;
        }
        if (startNow || (!hold && phaseT >= idleFor)) {
          startNow = false;
          round++;
          roundStart = t;
          lifted = false;
          wonThisRound = 0;
          owed += o.rate;
          grip = newGrip();
          world.setGrip(1, OPEN_TORQUE);
          go("play");
        }
        break;
      }
      case "play": {
        moveTrolley(null, TROLLEY_SPEED, dt);
        if (controls.drop || phaseT >= playLimit) {
          controls.drop = false;
          controls.stick = 0;
          go("drop");
        }
        break;
      }
      case "drop": {
        moveTrolley(world.trolleyX(), TROLLEY_SPEED, dt);
        // Lower until something holds the claw up, as a real machine's slack-cable switch
        // notices, then let it settle under its own weight.
        world.setCable(DROP_SPEED, CABLE_FORCE);
        // Stopped when it has gone less than half as far as it should in the last moment.
        depths.push(world.depth());
        if (depths.length > LANDING_STEPS) depths.shift();
        const progress = world.depth() - (depths[0] ?? 0);
        const stalled =
          depths.length >= LANDING_STEPS && progress < DROP_SPEED * (LANDING_STEPS - 1) * dt * 0.45;
        if (stalled || world.depth() >= world.maxDepth - 0.01 || phaseT > 4) {
          depths.length = 0;
          landed = world.depth();
          world.setCable(0, 0, landed + SINK);
          world.setGrip(-1, grip?.grab ?? STRONG);
          go("grab");
        }
        break;
      }
      case "grab": {
        moveTrolley(world.trolleyX(), TROLLEY_SPEED, dt);
        if (phaseT > 1.2) go("lift");
        break;
      }
      case "lift": {
        moveTrolley(world.trolleyX(), TROLLEY_SPEED, dt);
        world.setCable(-LIFT_SPEED, LIFT_FORCE);
        if (grip) {
          const k = grip.fade > 0 ? Math.min(1, phaseT / grip.fade) : 1;
          world.setGrip(-1, grip.grab + (grip.lift - grip.grab) * k * k * (3 - 2 * k));
        }
        if (world.depth() < 0.01 && phaseT > 0.4) {
          if (!lifted) lifted = world.touching().some((p) => p.body.getPosition().y > 0.9);
          world.setGrip(-1, grip?.carry ?? STRONG);
          if (phaseT > 0.9 || world.depth() < 0.002) go("carry");
        }
        if (phaseT > 5) go("carry");
        break;
      }
      case "carry": {
        world.setCable(-LIFT_SPEED, LIFT_FORCE);
        // Gently, so a held prize doesn't swing off.
        moveTrolley(world.home, TROLLEY_SPEED * 0.75, dt, TROLLEY_ACCEL * 0.45);
        if (grip?.loosen != null && phaseT >= grip.loosen) world.setGrip(1, LOOSE_TORQUE);
        if (Math.abs(world.trolleyX() - world.home) < 0.01 && Math.abs(vx) < 0.02) {
          world.setGrip(1, OPEN_TORQUE);
          go("release");
        }
        if (phaseT > 12) go("release");
        break;
      }
      case "release": {
        moveTrolley(world.home, TROLLEY_SPEED, dt);
        world.setGrip(1, OPEN_TORQUE);
        if (phaseT > 1.6) endRound();
        break;
      }
    }
  };

  const machine: Machine = {
    world,
    controls,
    get phase() {
      return phase;
    },
    get phaseT() {
      return phaseT;
    },
    get timeLeft() {
      return phase === "play" ? Math.max(0, playLimit - phaseT) : 0;
    },
    get stickShown() {
      return stickShown;
    },
    get round() {
      return round;
    },
    get grip() {
      return grip;
    },
    stock,
    rounds: records,
    get wins() {
      return wins;
    },
    get lost() {
      return lost;
    },
    get sinceWin() {
      return t - lastWin;
    },
    get hold() {
      return hold;
    },
    set hold(v) {
      hold = v;
    },
    start() {
      if (phase === "idle") {
        startNow = true;
        return true;
      }
      if (phase === "play") {
        phaseT = 0;
        controls.drop = false;
        return true;
      }
      return false;
    },
    step(dt) {
      t += dt;
      machineStep(dt);
      const out: WinEvent[] = [];
      const h = dt / SUBSTEPS;
      for (let i = 0; i < SUBSTEPS; i++) {
        const r = world.step(h);
        lost += r.lost.length;
        for (const prize of r.won) {
          wins++;
          owed = Math.max(-1, owed - 1);
          lastWin = t;
          const during = phase !== "idle";
          if (during) wonThisRound++;
          out.push({ prize, round: during ? round : -1 });
        }
      }
      // A prize that landed on top of the claw would ride round on it for ever: tip it off.
      if (world.onHead().length) riding += dt;
      else riding = 0;
      if (riding > 2) {
        for (const p of world.onHead()) {
          const side = p.body.getPosition().x < spec.width / 2 ? 1 : -1;
          p.body.applyLinearImpulse({ x: side * 0.6, y: 0.4 }, p.body.getWorldCenter(), true);
        }
        riding = 0;
      }
      return out;
    },
    fill() {
      const n = stock;
      const lo = spec.chute > 0 ? 0.32 : world.hole.x1 + 0.38;
      const hi = spec.chute > 0 ? world.hole.guardX - 0.32 : spec.width - 0.32;
      const across = Math.max(1, Math.floor((hi - lo) / 0.56) + 1);
      for (let i = 0; i < n; i++) {
        const col = i % across;
        const row = Math.floor(i / across);
        const x = lo + ((col + (row % 2) * 0.4) * (hi - lo)) / Math.max(1, across - 1 + 0.4);
        const y = 0.4 + row * 0.6;
        add(Math.min(hi, x), y, rng.range(-0.5, 0.5));
      }
      world.setGrip(1, OPEN_TORQUE);
      world.setCable(-LIFT_SPEED, LIFT_FORCE);
      for (let i = 0; i < 240 * SUBSTEPS; i++) world.step(STEP / SUBSTEPS);
    },
    forceStrong() {
      forced = true;
      if (grip && phase === "play") {
        grip = {
          strong: true,
          grab: STRONG,
          lift: STRONG,
          carry: STRONG * 0.9,
          fade: 0,
          loosen: null,
        };
      }
    },
    dispose() {
      world.dispose();
    },
  };
  return machine;
};
