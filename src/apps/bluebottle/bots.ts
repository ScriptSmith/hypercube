/**
 * Bots that dig like visitors, through injected touches. Each one rests, then digs a cell the
 * solver can deduce is safe, or holds on one it knows is a bluebottle to plant a flag, or now
 * and then digs a covered cell at random to show a sting. Only this frame's columns are used.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import { HOLD_MS } from "./config";
import { visibleOf } from "./patch";
import type { Current } from "./shore";
import { solverFor } from "./solver";

export interface BotScene {
  cur: Current | null;
  playing: boolean;
  c0: number;
  c1: number;
  flags: boolean;
  /** Stage px of a patch cell's centre on this frame. */
  point(cell: number): { x: number; y: number } | null;
}

export interface BotOptions {
  input: Pick<Input, "inject">;
  rng: Rng;
  count: number;
  /** Seconds between moves. */
  rest: readonly [number, number];
  /** Chance a move digs a random covered cell instead. */
  random: number;
  /** Chance a move plants a flag on a known bluebottle, when there is one. */
  flag: number;
  scene: () => BotScene;
}

export interface Bots {
  update(dt: number, active: number): void;
  release(): void;
  dispose(): void;
}

export const createBots = (o: BotOptions): Bots => {
  const hand: BotHand = createBotHand(o.input);
  const { rng } = o;
  const rests = Array.from({ length: o.count }, (_, i) => 0.6 + i * 0.7 + rng.next());
  const busy = new Set<number>();
  let cache: { key: string; safe: number[]; bottles: number[] } | null = null;

  const deduced = (cur: Current) => {
    const p = cur.patch;
    const key = `${cur.spec.b}:${cur.spec.n}:${p.events.length}:${p.dugSafe}`;
    if (cache?.key === key) return cache;
    const d = solverFor(cur.spec.cols, cur.spec.rows).deduce(visibleOf(p));
    cache = { key, safe: d.safe, bottles: d.bottles };
    return cache;
  };

  const act = (s: BotScene) => {
    const cur = s.cur;
    if (!cur || !s.playing) return;
    const p = cur.patch;
    const cols = cur.spec.cols;
    const ours = (i: number) => i % cols >= s.c0 && i % cols < s.c1 && !busy.has(i);
    const covered = (i: number) => !p.dug[i] && !p.found[i] && !p.flag[i];
    const d = deduced(cur);
    const r = rng.next();
    let cell = -1;
    let hold = false;
    if (r < o.random) {
      const options: number[] = [];
      for (let i = 0; i < p.board.size; i++) if (ours(i) && covered(i)) options.push(i);
      if (options.length > 0) cell = options[rng.int(options.length)]!;
    } else if (s.flags && r < o.random + o.flag) {
      const options = d.bottles.filter((i) => ours(i) && covered(i) && p.canFlag(i));
      if (options.length > 0) {
        cell = options[rng.int(options.length)]!;
        hold = true;
      }
    }
    if (cell < 0) {
      const options = d.safe.filter((i) => ours(i) && covered(i));
      if (options.length > 0) cell = options[rng.int(options.length)]!;
    }
    if (cell < 0) return;
    const at = s.point(cell);
    if (!at) return;
    busy.add(cell);
    const done = () => busy.delete(cell);
    if (hold) void hand.hold(at.x, at.y, HOLD_MS + 250).then(done);
    else void hand.tap(at.x, at.y, 90).then(done);
  };

  return {
    update(dt, active) {
      for (let i = 0; i < rests.length; i++) {
        if (i >= active) continue;
        rests[i] = rests[i]! - dt;
        if (rests[i]! > 0) continue;
        rests[i] = rng.range(o.rest[0], o.rest[1]);
        act(o.scene());
      }
    },
    release() {
      hand.release();
      busy.clear();
    },
    dispose() {
      hand.dispose();
      busy.clear();
      cache = null;
    },
  };
};
