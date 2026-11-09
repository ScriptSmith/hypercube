/**
 * A player for a machine nobody is touching: it picks a prize that looks easy, pushes the stick
 * towards it, lets go a moment late or early, nudges back, hesitates and presses the button. It
 * only sets the machine's `controls`, as a visitor's joystick would.
 */
import type { Rng } from "../../core/types";
import { type DesignId, DESIGNS } from "./designs";
import type { Machine } from "./machine";

type Step = "look" | "move" | "settle" | "tap" | "hesitate" | "done";

export interface Bot {
  /** The prize x it is going for this round, or null between rounds. */
  readonly aim: number | null;
  update(dt: number): void;
}

/**
 * How easy each prize looks to a player, from how often strong grabs on it came up in testing:
 * cacti and bears have something to hold, avocados and whales slip out.
 */
const EASE: Record<DesignId, number> = {
  bear: 0.67,
  bunny: 0.45,
  octopus: 0.39,
  whale: 0.36,
  dino: 0.58,
  star: 0.58,
  heart: 0.25,
  cactus: 0.86,
  avocado: 0.42,
  frog: 0.69,
};

/** About normal, from the sum of three uniforms. */
const gauss = (rng: Rng) => (rng.next() + rng.next() + rng.next() - 1.5) * 2;

/**
 * The x a bot aims for: a prize near the top of the pile that nothing lies on, with room either
 * side for the fingers, often one near the chute.
 */
export const chooseAim = (m: Machine, rng: Rng, tried: readonly number[] = []): number => {
  const w = m.world;
  const hole = w.hole;
  const all = w.prizes.map((p) => {
    const pos = p.body.getPosition();
    const b = DESIGNS[p.design].box;
    return { x: pos.x, y: pos.y, hw: (b.x1 - b.x0) / 2, ease: EASE[p.design] };
  });
  let best = rng.range(w.minX, w.maxX);
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const p of all) {
    if (p.x < w.minX + 0.04 || p.x > w.maxX - 0.04) continue;
    // The open fingers would land on the chute's guard.
    if (Math.abs(p.x - (hole.guardX + 0.03)) < 0.52 || (p.x > hole.x0 && p.x < hole.x1)) continue;
    if (p.y > 1.6) continue;
    let blocked = 0;
    let covered = false;
    for (const q of all) {
      if (q === p) continue;
      const dx = Math.abs(q.x - p.x);
      if (dx < 0.3 && q.y > p.y + 0.15) covered = true;
      // Neighbours as high as this one stand where the fingers must go.
      if (dx < p.hw + q.hw + 0.2 && q.y > p.y - 0.1) blocked++;
    }
    if (covered) continue;
    const near = 1 - Math.abs(p.x - hole.centre) / w.spec.width;
    // Players try something else after a miss or two.
    const again = tried.filter((x) => Math.abs(x - p.x) < 0.25).length;
    const score = 0.6 * p.y - 0.7 * blocked + 0.5 * near + p.ease - 0.6 * again + rng.range(0, 0.8);
    if (score > bestScore) {
      bestScore = score;
      best = p.x;
    }
  }
  return best;
};

export const createBot = (machine: Machine, rng: Rng): Bot => {
  let step: Step = "done";
  let stepT = 0;
  let wait = 0;
  let aim: number | null = null;
  let round = -1;
  /** How close is close enough this round, and how early it lets go. */
  let tolerance = 0.06;
  let anticipate = 1;
  let reaction = 0.2;
  let taps = 0;
  let tapFor = 0;
  let lastX = 0;
  let speed = 0;
  /** Where it went for in the last few rounds that came to nothing. */
  const tried: number[] = [];
  let wins = machine.wins;

  const go = (s: Step, w = 0) => {
    step = s;
    stepT = 0;
    wait = w;
  };

  const plan = () => {
    // Skill differs from player to player: steady hands, wild ones and in between.
    const sloppy = rng.next();
    tolerance = 0.025 + sloppy * 0.1;
    anticipate = rng.range(0.55, 1.35);
    reaction = rng.range(0.1, 0.3);
    if (aim !== null && machine.wins === wins) {
      tried.push(aim);
      if (tried.length > 3) tried.shift();
    }
    if (machine.wins !== wins) tried.length = 0;
    wins = machine.wins;
    const target = chooseAim(machine, rng, tried);
    const miss = gauss(rng) * (0.02 + sloppy * 0.07);
    const w = machine.world;
    aim = Math.max(w.minX, Math.min(w.maxX, target + miss));
    taps = 0;
    go("look", rng.range(1, 3.5));
  };

  return {
    get aim() {
      return aim;
    },
    update(dt) {
      const c = machine.controls;
      const x = machine.world.trolleyX();
      speed = dt > 0 ? (x - lastX) / dt : 0;
      lastX = x;
      if (machine.phase !== "play") {
        c.stick = 0;
        step = "done";
        return;
      }
      if (machine.round !== round) {
        round = machine.round;
        plan();
      }
      if (aim === null) return;
      stepT += dt;
      // Out of time: press it wherever the claw is.
      if (machine.timeLeft < 1.2 && step !== "done") {
        c.stick = 0;
        c.drop = true;
        go("done");
        return;
      }
      const err = aim - x;
      switch (step) {
        case "look":
          c.stick = 0;
          if (stepT >= wait) {
            if (Math.abs(err) < tolerance) go("hesitate", rng.range(0.6, 2));
            else go("move");
          }
          break;
        case "move": {
          const dir = err > 0 ? 1 : -1;
          c.stick = dir;
          // Where it thinks the claw is (a moment ago), and where it would stop if let go now.
          const seen = x - speed * reaction;
          const stopping = ((speed * speed) / 8) * anticipate;
          if ((aim - seen) * dir <= stopping) {
            c.stick = 0;
            go("settle", rng.range(0.25, 0.7));
          }
          if (stepT > 8) go("settle", 0.3);
          break;
        }
        case "settle":
          c.stick = 0;
          if (stepT >= wait && Math.abs(speed) < 0.01) {
            if (Math.abs(err) > tolerance && taps < 3) {
              taps++;
              tapFor = Math.min(0.6, Math.sqrt(Math.abs(err) / 4) * rng.range(0.8, 1.25));
              c.stick = err > 0 ? 1 : -1;
              go("tap");
            } else {
              go("hesitate", rng.range(0.6, 2.4));
            }
          }
          break;
        case "tap":
          if (stepT >= tapFor) {
            c.stick = 0;
            go("settle", rng.range(0.2, 0.6));
          }
          break;
        case "hesitate":
          c.stick = 0;
          if (stepT >= wait) {
            c.drop = true;
            go("done");
          }
          break;
        case "done":
          c.stick = 0;
          break;
      }
    },
  };
};
