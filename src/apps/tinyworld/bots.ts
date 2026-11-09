import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import type { Box } from "./config";

/**
 * Scripted pourers that use real injected touches, so they exercise the same path as fingers.
 * Each walks a loop: rest, open the right page if needed, press a swatch, drag out into the world
 * (pouring as it goes), pour with a small wobble, lift. Pieces and tools are carried out and
 * dropped instead. The attract "hand" is one of these with a slower cadence and gentle choices.
 */
export interface PourerSpec {
  /** Venue px to stage px. */
  unit: number;
  /** Where pourers aim, in venue px. */
  area: Box;
  /** Number of palette widgets. */
  widgets: number;
  /** Where swatch `id` is in widget `w` right now, and the tab to press first if it's hidden. */
  locate(w: number, id: string): { swatch: Box | null; tab: Box | null };
  /** True when swatch `id` is a piece or tool (carried out and dropped, not poured). */
  placed(id: string): boolean;
  /** Somewhere worth pouring onto (a geyser), if there is one. */
  aim(): { x: number; y: number } | null;
  rng: Rng;
  /** Relative weights by swatch id; ids not listed are never picked. */
  weights: Record<string, number>;
  /** Seconds between demonstrations. */
  rest: [number, number];
  /** Seconds of pouring per demonstration. */
  pour: [number, number];
}

type Phase = "rest" | "tab" | "press" | "drag" | "pour";

interface Pourer {
  phase: Phase;
  timer: number;
  touch: BotTouch | null;
  widget: number;
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  dragTime: number;
  wobble: number;
}

export interface Pourers {
  /** Where each active touch is (venue px), for the ghost hands. */
  readonly touches: readonly ({ x: number; y: number; down: boolean } | null)[];
  update(dt: number, active: number): void;
  /** Lift every finger now. */
  release(): void;
  dispose(): void;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

export const createPourers = (
  input: Pick<Input, "inject">,
  count: number,
  spec: PourerSpec,
): Pourers => {
  const hand: BotHand = createBotHand(input);
  const { rng, unit, area } = spec;
  const ids = Object.keys(spec.weights).filter((id) => (spec.weights[id] ?? 0) > 0);
  const pourers: Pourer[] = Array.from({ length: count }, (_, i) => ({
    phase: "rest",
    timer: rng.range(0.5, 2.5) + i * 0.7,
    touch: null,
    widget: i % Math.max(1, spec.widgets),
    id: "",
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    dragTime: 1,
    wobble: rng.range(0, 6),
  }));
  const touches: ({ x: number; y: number; down: boolean } | null)[] = pourers.map(() => null);

  const choose = (): string => {
    let total = 0;
    for (const id of ids) total += spec.weights[id] ?? 0;
    let r = rng.next() * total;
    for (const id of ids) {
      r -= spec.weights[id] ?? 0;
      if (r <= 0) return id;
    }
    return ids[0] ?? "sand";
  };

  const target = (from: { x: number; y: number }, pouring: boolean): { x: number; y: number } => {
    // Half the time, feed a geyser so people see where it throws things.
    const spot = pouring ? spec.aim() : null;
    if (spot && rng.next() < 0.5) return { x: spot.x, y: spot.y - 160 };
    const spread = area.width * 0.32;
    return {
      x: Math.min(area.x + area.width, Math.max(area.x, from.x + rng.range(-spread, spread))),
      y: rng.range(area.y, area.y + area.height),
    };
  };

  const stage = (p: { x: number; y: number }) => ({ x: p.x * unit, y: p.y * unit });

  const lift = (p: Pourer) => {
    p.touch?.up();
    p.touch = null;
  };

  const restAgain = (p: Pourer) => {
    lift(p);
    p.phase = "rest";
    p.timer = rng.range(spec.rest[0], spec.rest[1]);
  };

  const pressSwatch = (p: Pourer) => {
    const where = spec.locate(p.widget, p.id);
    if (!where.swatch) {
      restAgain(p);
      return;
    }
    p.from = centre(where.swatch);
    p.to = target(p.from, !spec.placed(p.id));
    const at = stage(p.from);
    p.touch = hand.press(at.x, at.y);
    p.phase = "press";
    p.timer = 0.3;
  };

  return {
    touches,

    update(dt, active) {
      pourers.forEach((p, i) => {
        if (i >= active) {
          if (p.touch) lift(p);
          p.phase = "rest";
          p.timer = Math.max(p.timer, 0.5);
          touches[i] = null;
          return;
        }
        p.timer -= dt;
        switch (p.phase) {
          case "rest": {
            if (p.timer > 0) break;
            p.id = choose();
            const where = spec.locate(p.widget, p.id);
            if (!where.swatch && where.tab) {
              const at = stage(centre(where.tab));
              p.touch = hand.press(at.x, at.y);
              p.phase = "tab";
              p.timer = 0.15;
            } else pressSwatch(p);
            break;
          }
          case "tab":
            if (p.timer > 0) break;
            lift(p);
            pressSwatch(p);
            break;
          case "press":
            if (p.timer <= 0) {
              p.phase = "drag";
              p.dragTime = rng.range(0.7, 1.2);
              p.timer = p.dragTime;
            }
            break;
          case "drag": {
            const t = ease(1 - Math.max(0, p.timer) / p.dragTime);
            const at = {
              x: lerp(p.from.x, p.to.x, t),
              y: lerp(p.from.y, p.to.y, t) - Math.sin(t * Math.PI) * 120,
            };
            const s = stage(at);
            p.touch?.move(s.x, s.y);
            if (p.timer <= 0) {
              if (spec.placed(p.id)) restAgain(p);
              else {
                p.phase = "pour";
                p.timer = rng.range(spec.pour[0], spec.pour[1]);
              }
            }
            break;
          }
          case "pour": {
            p.wobble += dt;
            const at = stage({
              x: p.to.x + Math.sin(p.wobble * 1.3) * 90 + Math.sin(p.wobble * 0.37) * 140,
              y: p.to.y + Math.cos(p.wobble * 1.7) * 40,
            });
            p.touch?.move(at.x, at.y);
            if (p.timer <= 0) restAgain(p);
            break;
          }
        }
        touches[i] = p.touch?.active
          ? { x: p.touch.x / unit, y: p.touch.y / unit, down: true }
          : null;
      });
    },

    release() {
      for (const p of pourers) {
        lift(p);
        p.phase = "rest";
        p.timer = rng.range(1, 3);
      }
      touches.fill(null);
      hand.release();
    },

    dispose() {
      hand.dispose();
    },
  };
};
