/**
 * Ghost fingers: attract demos and bots, both played as injected touches through the runtime's
 * input, so they take the same path as a visitor's finger (and the card can draw the ghost hand
 * where they are). A demo is a chapter's script of steps; a bot makes one move every few seconds
 * and stands back for 30 s after a person touches the card.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input } from "../../core/types";
import type { Card } from "./card";
import type { DemoStep } from "./chapter";
import { BOT_YIELD_MS } from "./config";
import type { Gesture } from "./controls";

export interface Performer {
  /** Play steps on a card; resolves when done or stopped. */
  play(card: Card, steps: readonly DemoStep[]): Promise<void>;
  stop(): void;
  readonly playing: boolean;
  /** Fingers down now, venue px. */
  fingers(): { x: number; y: number }[];
  dispose(): void;
}

const wait = (ms: number, alive: () => boolean) =>
  new Promise<void>((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (!alive() || performance.now() - start >= ms) resolve();
      else setTimeout(tick, Math.min(100, ms));
    };
    tick();
  });

export const createPerformer = (input: Pick<Input, "inject">, unit: () => number): Performer => {
  const hand: BotHand = createBotHand(input);
  let run = 0;
  let playing = false;
  let finger: { x: number; y: number } | null = null;
  let disposed = false;

  const gestureOn = async (g: Gesture, mine: number) => {
    const u = unit();
    const path = g.path.map((p) => ({ x: p.x * u, y: p.y * u }));
    const first = path[0];
    if (!first) return;
    if (path.length === 1) {
      finger = g.path[0]!;
      await hand.tap(first.x, first.y, Math.max(80, g.ms));
      finger = null;
      return;
    }
    // Follow the drag ourselves so the ghost hand can be drawn where the finger is.
    const t = hand.press(first.x, first.y);
    const steps = Math.max(1, Math.round(g.ms / 16));
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, g.ms / steps));
      if (mine !== run || !t.active) break;
      const f = (i / steps) * (g.path.length - 1);
      const k = Math.min(g.path.length - 2, Math.floor(f));
      const a = g.path[k]!;
      const b = g.path[k + 1] ?? a;
      const s = f - k;
      finger = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
      t.move(finger.x * u, finger.y * u);
    }
    t.up();
    finger = null;
  };

  const doStep = async (card: Card, s: DemoStep, mine: number) => {
    if ("wait" in s) return wait(s.wait, () => mine === run);
    if ("maths" in s) {
      const b = card.control("maths");
      if (b && card.mathsOpen !== s.maths) await gestureOn(b.gesture()!, mine);
      return;
    }
    if ("part" in s) {
      const r = card.partRect(s.part);
      if (r)
        await gestureOn({ path: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }], ms: 160 }, mine);
      return;
    }
    if ("gesture" in s) return gestureOn(s.gesture, mine);
    const c = card.control(s.control);
    if (!c || !c.visible || !c.enabled) return;
    const g = c.gesture(s.to);
    if (!g) return;
    await gestureOn(s.ms ? { ...g, ms: s.ms } : g, mine);
  };

  return {
    async play(card, steps) {
      if (disposed) return;
      const mine = ++run;
      playing = true;
      try {
        for (const s of steps) {
          if (mine !== run) break;
          await doStep(card, s, mine);
          // A short beat between steps, as a person would leave.
          await wait(260, () => mine === run);
        }
      } finally {
        if (mine === run) {
          playing = false;
          finger = null;
        }
      }
    },
    stop() {
      run++;
      playing = false;
      finger = null;
      hand.release();
    },
    get playing() {
      return playing;
    },
    fingers() {
      return finger ? [finger] : [];
    },
    dispose() {
      disposed = true;
      run++;
      hand.dispose();
    },
  };
};

/** One bot per card: a move every few seconds, standing back after a person. */
export interface Bot {
  update(now: number): void;
  readonly moves: number;
  dispose(): void;
}

export const createBot = (
  card: () => Card,
  performer: Performer,
  rand: () => number,
  opts: { tabs: boolean },
): Bot => {
  let next = performance.now() + 1500 + rand() * 2000;
  let moves = 0;
  const pickStep = (): DemoStep | null => {
    const c = card();
    const own = c.current.botMove?.(rand);
    if (own) return own;
    const all = c.controls().filter((k) => {
      if (k.id === "maths") return rand() < 0.3;
      if (k.id.startsWith("tab:") || k.id === "back" || k.id === "next")
        return opts.tabs && rand() < 0.25;
      return true;
    });
    const k = all[Math.floor(rand() * all.length)];
    if (!k) return null;
    const g = k.gesture(undefined, rand);
    return g ? { gesture: g } : null;
  };
  return {
    update(now) {
      const c = card();
      if (performer.playing || now < next) return;
      if (now - c.lastPerson < BOT_YIELD_MS) return;
      next = now + 2400 + rand() * 2800;
      const s = pickStep();
      if (!s) return;
      moves++;
      void performer.play(c, [s]);
    },
    get moves() {
      return moves;
    },
    dispose() {
      performer.stop();
    },
  };
};
