import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import { type Box, glidePoint, type Layout, stripPoint } from "./layout";

/**
 * Scripted visitors that use real injected touches, so they take the same path as fingers. Each
 * rests, then plays a short script: hold a key a while (most often) or tap it, slide a glide
 * strip, move a slider, drag the drive point (on the plate or a map), or now and then rest a
 * finger on the plate to damp it. Scripts are a handful of timed steps.
 */
type Op = "down" | "move" | "up";
interface Step {
  t: number;
  op: Op;
  x: number;
  y: number;
}

export interface BotScene {
  layout: Layout;
  round: boolean;
  /** Bots may rest a finger on the plate. */
  damp: boolean;
  /** Where each plate's puck is now and the box it may be dragged within, if it can be. */
  pucks: { x: number; y: number; within: Box }[];
}

export interface Bots {
  update(dt: number, active: number): void;
  release(): void;
  dispose(): void;
}

interface Actor {
  rest: number;
  steps: Step[];
  clock: number;
  touch: BotTouch | null;
}

export const createBots = (opts: {
  input: Pick<Input, "inject">;
  rng: Rng;
  count: number;
  unit: () => number;
  scene: () => BotScene | null;
}): Bots => {
  const hand: BotHand = createBotHand(opts.input);
  const { rng } = opts;
  const actors: Actor[] = Array.from({ length: Math.max(0, opts.count) }, (_, i) => ({
    rest: rng.range(0.4, 1.5) + i * 1.3,
    steps: [],
    clock: 0,
    touch: null,
  }));

  const script = (): Step[] => {
    const scene = opts.scene();
    if (!scene) return [];
    const { layout } = scene;
    const r = rng.next();
    const out: Step[] = [];
    /** A smooth drag from `a` to `b` over `ms` seconds, then a hold of `hold`. */
    const drag = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      ms: number,
      hold: number,
    ) => {
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const e = k * k * (3 - 2 * k);
        out.push({
          t: (ms * i) / n,
          op: i === 0 ? "down" : "move",
          x: a.x + (b.x - a.x) * e,
          y: a.y + (b.y - a.y) * e,
        });
      }
      out.push({ t: ms + hold, op: "up", x: 0, y: 0 });
      return out;
    };
    if (layout.glides.length > 0 && r < 0.16) {
      const g = layout.glides[rng.int(layout.glides.length)]!;
      return drag(
        glidePoint(g, rng.next()),
        glidePoint(g, rng.next()),
        rng.range(2, 4),
        rng.range(1.5, 4),
      );
    }
    if (layout.sliders.length > 0 && r < 0.27) {
      const s = layout.sliders[rng.int(layout.sliders.length)]!;
      return drag(
        stripPoint(s, rng.next()),
        stripPoint(s, rng.next()),
        rng.range(1, 2.5),
        rng.range(0.3, 1.5),
      );
    }
    if (r < 0.38) {
      const inside = (b: Box) => ({
        x: b.x + b.width * rng.range(0.15, 0.85),
        y: b.y + b.height * rng.range(0.15, 0.85),
      });
      const map = layout.maps.filter((m) => m.touch);
      if (map.length > 0) {
        const m = map[rng.int(map.length)]!;
        return drag(inside(m.box), inside(m.box), rng.range(1, 2.5), rng.range(0.3, 1));
      }
      const puck = scene.pucks[rng.int(Math.max(1, scene.pucks.length))];
      if (puck) return drag(puck, inside(puck.within), rng.range(1, 2.5), rng.range(0.3, 1));
    }
    const plate = layout.plates[rng.int(Math.max(1, layout.plates.length))];
    if (scene.damp && plate && r < 0.46) {
      // A point on the plate within reach, away from the very edge.
      for (let i = 0; i < 8; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * 0.8 * (plate.size / 2);
        const x = plate.cx + Math.cos(a) * d;
        const y = plate.cy + Math.sin(a) * d;
        if (y < layout.reach.adult + 40) continue;
        out.push({ t: 0, op: "down", x, y }, { t: rng.range(1.5, 3.5), op: "up", x, y });
        return out;
      }
    }
    if (layout.keys.length === 0) return [];
    const k = layout.keys[rng.int(layout.keys.length)]!;
    const x = k.box.x + k.box.width * rng.range(0.3, 0.7);
    const y = k.box.y + k.box.height * rng.range(0.3, 0.7);
    const hold = rng.next() < 0.7 ? rng.range(2.5, 6) : rng.range(0.08, 0.2);
    out.push({ t: 0, op: "down", x, y }, { t: hold, op: "up", x, y });
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
          a.steps = script();
          a.clock = 0;
          a.rest = rng.range(2, 5);
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
