/**
 * Bots: injected touches that pick items off a line's belts and carry or throw them to a bin,
 * the right one about nine times in ten so the wrong-bin hint shows now and then. They take the
 * same path as fingers (the runtime's input, then the app's grab and throw), and leave a line
 * alone for a while after a person grabs from it.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import { BOT_YIELD_MS, FLY_TAU, GRAVITY_D } from "./config";
import { ITEMS } from "./items";
import type { BinSlot, Layout } from "./layout";
import { planCarry, pathLength } from "./plan";
import { arcTo, predictCrossing } from "./physics";
import type { Item, World } from "./world";

export const WRONG_SHARE = 0.1;

export interface Bot {
  readonly line: number;
  readonly stats: { tries: number; carried: number; thrown: number; wrong: number };
  update(dt: number, now: number): void;
  release(): void;
  dispose(): void;
}

export interface BotOptions {
  input: Pick<Input, "inject">;
  world: () => World;
  line: number;
  unit: () => number;
  rng: Rng;
  /** Last time a person grabbed from this line (performance.now ms). */
  lastHuman: () => number;
  /** Items other bots are already going for. */
  claimed: Set<number>;
}

/** The bin a bot aims for: usually the right one on the item's line. */
export const chooseBin = (
  layout: Layout,
  it: Item,
  line: number,
  roll: number,
  pick: number,
): BinSlot | null => {
  const bins = layout.bins.filter((b) => b.line === line);
  if (bins.length === 0) return null;
  const want = ITEMS[it.kind]?.bin;
  const right = bins.find((b) => b.kind === want) ?? null;
  if (roll >= WRONG_SHARE || bins.length === 1) return right ?? bins[0]!;
  const wrong = bins.filter((b) => b.kind !== want);
  return wrong[Math.floor(pick * wrong.length) % wrong.length] ?? right;
};

export const createBot = (o: BotOptions): Bot => {
  const hand: BotHand = createBotHand(o.input);
  const stats = { tries: 0, carried: 0, thrown: 0, wrong: 0 };
  let wait = 1 + o.rng.next() * 1.5;
  let busy = false;
  let target: number | null = null;
  let disposed = false;

  const pickItem = (): Item | null => {
    const w = o.world();
    const lineItems = w.items.filter(
      (it) =>
        it.line === o.line &&
        it.state === "belt" &&
        !o.claimed.has(it.id) &&
        it.s > w.layout.d * 0.6,
    );
    if (lineItems.length === 0) return null;
    // Mostly the one nearest the end of its belt, sometimes any.
    if (o.rng.next() < 0.6) {
      return lineItems.reduce((best, it) => {
        const b = w.layout.belts[it.belt]!;
        const bb = w.layout.belts[best.belt]!;
        return it.s / b.length > best.s / bb.length ? it : best;
      });
    }
    return o.rng.pick(lineItems);
  };

  const act = async (it: Item) => {
    const w = o.world();
    const L = w.layout;
    const bin = chooseBin(L, it, o.line, o.rng.next(), o.rng.next());
    if (!bin) return;
    if (ITEMS[it.kind]?.bin !== bin.kind) stats.wrong++;
    stats.tries++;
    target = it.id;
    o.claimed.add(it.id);
    const u = o.unit();
    const from = { x: it.x, y: it.y };
    const g = GRAVITY_D * L.d;
    // A throw where nothing is in the way, otherwise carry it round.
    if (o.rng.next() < 0.4) {
      const mid = (bin.mouth.x0 + bin.mouth.x1) / 2;
      const arc = arcTo(from.x, from.y, mid, bin.mouth.y + L.d * 0.2, g, L.d * 1.2);
      const mouths = L.bins.map((b) => b.mouth);
      const hit = predictCrossing(
        { x: from.x, y: from.y, vx: arc.vx, vy: arc.vy },
        mouths,
        g,
        FLY_TAU,
        L.d * 0.1,
      );
      if (hit && L.bins[hit.index] === bin && Math.hypot(arc.vx, arc.vy) < L.d * 22) {
        const ms = 110;
        const end = { x: from.x + (arc.vx * ms) / 1000, y: from.y + (arc.vy * ms) / 1000 };
        stats.thrown++;
        await hand.drag(
          [
            { x: from.x * u, y: from.y * u },
            { x: end.x * u, y: end.y * u },
          ],
          ms,
        );
        return;
      }
    }
    const path = planCarry(L, from, bin);
    const speed = L.d * 7;
    const ms = Math.max(350, (pathLength(path) / speed) * 1000);
    stats.carried++;
    await hand.drag(
      path.map((p) => ({ x: p.x * u, y: p.y * u })),
      ms,
    );
  };

  return {
    line: o.line,
    stats,
    update(dt, now) {
      if (disposed || busy) return;
      if (now - o.lastHuman() < BOT_YIELD_MS) return;
      wait -= dt;
      if (wait > 0) return;
      wait = 0.8 + o.rng.next() * 1.6;
      const it = pickItem();
      if (!it) return;
      busy = true;
      void act(it).finally(() => {
        busy = false;
        if (target !== null) o.claimed.delete(target);
        target = null;
      });
    },
    release() {
      hand.release();
    },
    dispose() {
      disposed = true;
      hand.dispose();
      if (target !== null) o.claimed.delete(target);
    },
  };
};
