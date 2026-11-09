import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import type { Box } from "./dish";
import { type DialSpec, detentAngles, type Pad } from "./layout";

/**
 * Scripted visitors that use real injected touches, so they take the same path as fingers. Each
 * one rests, then plays a short script: tap a swatch, then tap the culture a few times (or flick
 * a drop up on a bank), or now and then turn a dial. The attract hand is one of these with a slow
 * cadence. Scripts are a handful of timed steps, so nothing piles up.
 */
type Op = "down" | "move" | "up";
interface Step {
  t: number;
  op: Op;
  x: number;
  y: number;
}

export interface ActorScene {
  pads: readonly Pad[];
  dials: readonly DialSpec[];
  /** Where taps may land for a pad (venue px), or null when this frame flicks instead. */
  tapArea(pad: Pad): Box | null;
  /** Detents per dial. */
  detents: number;
  /** Stamps this actor likes, by id, with weights. Missing ids are skipped. */
  weights: Record<string, number>;
}

export interface ActorOptions {
  input: Pick<Input, "inject">;
  rng: Rng;
  count: number;
  /** Venue px to stage px. */
  unit: () => number;
  scene: () => ActorScene | null;
  /** Seconds of rest between scripts. */
  rest: [number, number];
  dialChance: number;
}

export interface Actors {
  update(dt: number, active: number): void;
  release(): void;
  dispose(): void;
}

interface Actor {
  rest: number;
  steps: Step[];
  clock: number;
  touch: BotTouch | null;
  pad: number;
}

export const createActors = (opts: ActorOptions): Actors => {
  const hand: BotHand = createBotHand(opts.input);
  const { rng } = opts;
  const actors: Actor[] = Array.from({ length: opts.count }, (_, i) => ({
    rest: rng.range(0.6, 2) + i * 0.9,
    steps: [],
    clock: 0,
    touch: null,
    pad: i,
  }));

  const tapSteps = (t: number, x: number, y: number, out: Step[]) => {
    out.push({ t, op: "down", x, y }, { t: t + 0.08, op: "up", x, y });
  };

  const chooseSwatch = (pad: Pad, weights: Record<string, number>) => {
    const options = pad.swatches.filter((s) => (weights[s.stamp.id] ?? 0) > 0);
    if (options.length === 0) return null;
    let total = 0;
    for (const s of options) total += weights[s.stamp.id] ?? 0;
    let r = rng.next() * total;
    for (const s of options) {
      r -= weights[s.stamp.id] ?? 0;
      if (r <= 0) return s;
    }
    return options[0] ?? null;
  };

  const script = (a: Actor): Step[] => {
    const scene = opts.scene();
    if (!scene || scene.pads.length === 0) return [];
    const pad = scene.pads[a.pad % scene.pads.length]!;
    const out: Step[] = [];
    const dial = scene.dials.find((d) => d.cx >= pad.x0 - 400 && d.cx <= pad.x1 + 400);
    if (dial && scene.detents > 1 && rng.next() < opts.dialChance) {
      // Grab the knob's rim and sweep it to another detent.
      const angles = detentAngles(scene.detents, dial.spread);
      const to = angles[rng.int(angles.length)] ?? 0;
      const from = angles[rng.int(angles.length)] ?? 0;
      const rad = dial.r * 0.75;
      for (let i = 0; i <= 10; i++) {
        const a2 = from + ((to - from) * i) / 10;
        out.push({
          t: i * 0.06,
          op: i === 0 ? "down" : "move",
          x: dial.cx + Math.sin(a2) * rad,
          y: dial.cy - Math.cos(a2) * rad,
        });
      }
      out.push({ t: 0.7, op: "up", x: 0, y: 0 });
      return out;
    }
    const sw = chooseSwatch(pad, scene.weights);
    if (!sw) return [];
    const b = sw.box;
    tapSteps(0, b.x + b.width / 2, b.y + b.height / 2, out);
    const area = scene.tapArea(pad);
    let t = rng.range(0.4, 0.8);
    if (area) {
      const taps = 1 + rng.int(3);
      for (let i = 0; i < taps; i++) {
        tapSteps(
          t,
          rng.range(area.x, area.x + area.width),
          rng.range(area.y, area.y + area.height),
          out,
        );
        t += rng.range(0.9, 1.4);
      }
    } else if (pad.flick) {
      const f = pad.flick;
      const x = rng.range(f.x + f.width * 0.25, f.x + f.width * 0.75);
      const y = f.y + f.height * rng.range(0.6, 0.85);
      const lift = rng.range(220, Math.max(240, f.height * 0.7));
      const ms = rng.range(0.09, 0.2);
      out.push({ t, op: "down", x, y });
      for (let i = 1; i <= 5; i++) {
        out.push({
          t: t + (ms * i) / 5,
          op: "move",
          x: x + rng.range(-8, 8),
          y: y - (lift * i) / 5,
        });
      }
      out.push({ t: t + ms + 0.01, op: "up", x, y: y - lift });
    }
    return out;
  };

  const lift = (a: Actor) => {
    a.touch?.up();
    a.touch = null;
  };

  return {
    update(dt, active) {
      const unit = opts.unit();
      actors.forEach((a, i) => {
        if (i >= active) {
          lift(a);
          a.steps = [];
          a.rest = Math.max(a.rest, 0.5);
          return;
        }
        if (a.steps.length === 0) {
          a.rest -= dt;
          if (a.rest > 0) return;
          a.steps = script(a);
          a.clock = 0;
          a.rest = rng.range(opts.rest[0], opts.rest[1]);
          if (a.steps.length === 0) return;
        }
        a.clock += dt;
        while (a.steps.length > 0 && (a.steps[0]?.t ?? 0) <= a.clock) {
          const s = a.steps.shift()!;
          if (s.op === "down") {
            lift(a);
            a.touch = hand.press(s.x * unit, s.y * unit);
          } else if (s.op === "move") a.touch?.move(s.x * unit, s.y * unit);
          else lift(a);
        }
        if (a.steps.length === 0) lift(a);
      });
    },
    release() {
      for (const a of actors) {
        lift(a);
        a.steps = [];
        a.rest = rng.range(1, 3);
      }
      hand.release();
    },
    dispose() {
      hand.dispose();
    },
  };
};
