import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import type { Box } from "./layout";

/**
 * Scripted visitors that use real injected touches, so they take the same path as fingers.
 * Each rests, then plays a short script: drag a handle somewhere (most often), turn an angle
 * knob, hold a hand in the stream, tap a shape tile or a size button, or move the wind slider.
 * Scripts are a handful of timed steps in venue px.
 */
type Op = "down" | "move" | "up";
interface Step {
  t: number;
  op: Op;
  x: number;
  y: number;
}

export interface BotScene {
  handles: { x: number; y: number; travel: { x0: number; x1: number; y0: number; y1: number } }[];
  knobs: { x: number; y: number; r: number }[];
  tiles: Box[];
  /** Each sting's size buttons, where they are now, and its size. */
  sizes: { smaller: Box; bigger: Box; size: number }[];
  sliders: { from: { x: number; y: number }; to: { x: number; y: number } }[];
  views: Box[];
  /** Where a bot may hold a hand in the stream. */
  stream: Box | null;
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
    rest: rng.range(0.5, 1.5) + i * 1.7,
    steps: [],
    clock: 0,
    touch: null,
  }));

  const script = (): Step[] => {
    const scene = opts.scene();
    if (!scene) return [];
    const out: Step[] = [];
    const path = (pts: { x: number; y: number }[], ms: number, hold: number) => {
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const f = (i / n) * (pts.length - 1);
        const j = Math.min(pts.length - 2, Math.floor(f));
        const k = f - j;
        const a = pts[j]!;
        const b = pts[j + 1] ?? a;
        out.push({
          t: (ms * i) / n,
          op: i === 0 ? "down" : "move",
          x: a.x + (b.x - a.x) * k,
          y: a.y + (b.y - a.y) * k,
        });
      }
      out.push({ t: ms + hold, op: "up", x: 0, y: 0 });
      return out;
    };
    const taps = (b: Box) => {
      const x = b.x + b.width * rng.range(0.3, 0.7);
      const y = b.y + b.height * rng.range(0.3, 0.7);
      const n = 1 + rng.int(3);
      for (let i = 0; i < n; i++) {
        const t0 = i * 0.55;
        out.push({ t: t0, op: "down", x, y }, { t: t0 + rng.range(0.1, 0.2), op: "up", x, y });
      }
      return out;
    };
    // A shape grown large is soon brought back down, so bots show the large sizes without
    // leaving a shape there.
    const large = scene.sizes.filter((s) => s.size > 1.5);
    if (large.length > 0 && rng.next() < 0.3) return taps(large[rng.int(large.length)]!.smaller);
    const r = rng.next();
    if (scene.handles.length > 0 && r < 0.38) {
      const h = scene.handles[rng.int(scene.handles.length)]!;
      const to = {
        x: rng.range(h.travel.x0, h.travel.x1),
        y: rng.range(h.travel.y0, h.travel.y1),
      };
      return path([h, to], rng.range(1.5, 3.5), rng.range(0.4, 2));
    }
    if (scene.knobs.length > 0 && r < 0.58) {
      const k = scene.knobs[rng.int(scene.knobs.length)]!;
      const a0 = rng.range(0, Math.PI * 2);
      const sweep = rng.range(0.5, 1.2) * (rng.next() < 0.5 ? -1 : 1);
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = a0 + (sweep * i) / 5;
        return { x: k.x + Math.cos(a) * k.r * 0.75, y: k.y + Math.sin(a) * k.r * 0.75 };
      });
      return path(pts, rng.range(1.2, 2.5), rng.range(0.2, 0.8));
    }
    if (scene.stream && r < 0.8) {
      const b = scene.stream;
      const a = { x: rng.range(b.x, b.x + b.width), y: rng.range(b.y, b.y + b.height) };
      const drift = {
        x: Math.min(b.x + b.width, Math.max(b.x, a.x + rng.range(-1, 1) * b.width * 0.15)),
        y: Math.min(b.y + b.height, Math.max(b.y, a.y + rng.range(-1, 1) * b.height * 0.3)),
      };
      return path([a, drift], rng.range(2, 4), rng.range(0.5, 2));
    }
    if (scene.tiles.length > 0 && r < 0.86) {
      const t = scene.tiles[rng.int(scene.tiles.length)]!;
      const x = t.x + t.width * rng.range(0.3, 0.7);
      const y = t.y + t.height * rng.range(0.3, 0.7);
      out.push({ t: 0, op: "down", x, y }, { t: rng.range(0.1, 0.25), op: "up", x, y });
      return out;
    }
    if (scene.sizes.length > 0 && r < 0.92) {
      // One to three taps on the same button, more often bigger (a large shape is soon
      // brought back down, above).
      const s = scene.sizes[rng.int(scene.sizes.length)]!;
      const up = s.size < 1 ? 0.8 : 0.6;
      return taps(rng.next() < up ? s.bigger : s.smaller);
    }
    if (scene.sliders.length > 0 && r < 0.97) {
      const s = scene.sliders[rng.int(scene.sliders.length)]!;
      const at = (v: number) => ({
        x: s.from.x + (s.to.x - s.from.x) * v,
        y: s.from.y + (s.to.y - s.from.y) * v,
      });
      return path([at(rng.next()), at(rng.next())], rng.range(1, 2), rng.range(0.2, 0.6));
    }
    if (scene.views.length > 0) {
      const v = scene.views[rng.int(scene.views.length)]!;
      const x = v.x + v.width / 2;
      const y = v.y + v.height / 2;
      out.push({ t: 0, op: "down", x, y }, { t: 0.15, op: "up", x, y });
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
          a.steps = script();
          a.clock = 0;
          a.rest = rng.range(1.5, 4);
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
