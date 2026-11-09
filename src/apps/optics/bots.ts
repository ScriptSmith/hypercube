/**
 * Bots and the attract hand, playing a bench through injected touches like a visitor: each move
 * drags one piece from its tray (or a wrong socket) to its solution socket, or turns it, by taps
 * for a step or two and by its ring for more. Bots now and then turn a piece the wrong way first.
 * In free play they set out pieces and turn them about at random.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import type { Bench } from "./bench";
import { STEP, normDetent, symmetryOf } from "./pieces";
import { inBox } from "./layout";
import { segDist2 } from "./trace";

export interface Hand {
  /** Advance by `dt` seconds; acts only while `on`. */
  update(dt: number, on: boolean): void;
  release(): void;
  dispose(): void;
}

export interface HandOptions {
  input: Pick<Input, "inject">;
  rng: Rng;
  bench: () => Bench;
  /** Venue px to stage px. */
  unit: () => number;
  rest: readonly [number, number];
  /** Chance of a wrong turn first. */
  wrong: number;
  /** Gestures take this many times longer (the attract hand is slow). */
  pace: number;
}

/** Shortest turn in detents from `cur` to `target`, allowing for the piece's symmetry. */
export const turnDelta = (
  kind: Parameters<typeof symmetryOf>[0],
  cur: number,
  target: number,
): number => {
  const sym = symmetryOf(kind);
  const d = normDetent(target - cur) % sym;
  return d > sym / 2 ? d - sym : d;
};

export const createHand = (o: HandOptions): Hand => {
  const hand: BotHand = createBotHand(o.input);
  let rest = 0.8 + o.rng.next();
  let busy = false;
  let disposed = false;

  const at = (x: number, y: number) => ({ x: x * o.unit(), y: y * o.unit() });

  const run = (p: Promise<void>) => {
    busy = true;
    void p.finally(() => {
      busy = false;
    });
  };

  /**
   * A path around a piece's ring turning it `by` detents, starting where a touch takes hold of
   * this ring (not a neighbour's ring or body, nor a piece in a tray), as far from other pieces
   * as it can. Null when no such point exists.
   */
  const ringPath = (b: Bench, i: number, by: number) => {
    const it = b.items[i]!;
    const s = b.layout.sockets[it.place.socket!]!;
    const radius = b.layout.sizes.ring;
    const L = b.layout.box;
    let a0: number | null = null;
    let best = -Infinity;
    for (let k = 0; k < 24; k++) {
      const a = k * STEP;
      const px = s.x + Math.cos(a) * radius;
      const py = s.y + Math.sin(a) * radius;
      if (px < L.x + 30 || px > L.x + L.width - 30 || py < L.y + 30 || py > L.y + L.height - 30) {
        continue;
      }
      if (inBox(b.layout.reset, px, py, 20)) continue;
      const hit = b.target(px, py);
      if (hit?.kind !== "ring" || hit.item !== i) continue;
      let clear = Infinity;
      b.items.forEach((x, k2) => {
        if (k2 === i) return;
        const w = b.where(k2);
        if (w) clear = Math.min(clear, Math.hypot(w.x - px, w.y - py));
      });
      if (clear > best) {
        best = clear;
        a0 = a;
      }
    }
    if (a0 === null) return null;
    const pts: { x: number; y: number }[] = [];
    const steps = Math.max(2, Math.abs(by) * 2);
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (by * STEP * k) / steps;
      pts.push(at(s.x + Math.cos(a) * radius, s.y + Math.sin(a) * radius));
    }
    return pts;
  };

  const taps = (b: Bench, i: number, n: number) => {
    const s = b.layout.sockets[b.items[i]!.place.socket!]!;
    run(
      (async () => {
        for (let k = 0; k < n; k++) {
          const p = at(s.x + b.layout.sizes.piece * 0.2, s.y + b.layout.sizes.piece * 0.15);
          await hand.tap(p.x, p.y, 90);
          await new Promise((r) => setTimeout(r, 260 * o.pace));
        }
      })(),
    );
  };

  const turn = (b: Bench, i: number, by: number) => {
    if (by > 0 && by <= 2) {
      taps(b, i, by);
      return;
    }
    const path = ringPath(b, i, by);
    if (path) {
      run(hand.drag(path, (500 + Math.abs(by) * 110) * o.pace));
      return;
    }
    // No clear hold on the ring: tap round instead (taps only go clockwise).
    const sym = symmetryOf(b.items[i]!.kind);
    taps(b, i, ((by % sym) + sym) % sym);
  };

  const carry = (b: Bench, i: number, to: number) => {
    const w = b.where(i);
    const s = b.layout.sockets[to];
    if (!w || !s) return;
    const a = at(w.x, w.y);
    const z = at(s.x, s.y);
    const mid = { x: (a.x + z.x) / 2, y: Math.min(a.y, z.y) - 60 * o.unit() };
    run(
      hand.drag([a, mid, z], (850 + (Math.hypot(z.x - a.x, z.y - a.y) / o.unit()) * 0.35) * o.pace),
    );
  };

  const puzzleMove = (b: Bench) => {
    const p = b.puzzle;
    const order = p.pieces.map((_, i) => i);
    for (const i of order) {
      const it = b.items[i];
      const sol = p.solution[i];
      if (!it || !sol || sol.socket === null) continue;
      if (it.place.socket !== sol.socket) {
        // Something else sits in the solution socket: take it out first.
        const blocker = b.items.findIndex((x, k) => k !== i && x.place.socket === sol.socket);
        if (blocker >= 0) {
          const w = b.where(blocker);
          const tray = b.layout.trays[b.items[blocker]!.tray];
          if (w && tray) {
            const a = at(w.x, w.y);
            const z = at(tray.box.x + tray.box.width / 2, tray.box.y + tray.box.height / 2);
            run(hand.drag([a, z], 900 * o.pace));
          }
          return;
        }
        carry(b, i, sol.socket);
        return;
      }
      const d = turnDelta(it.kind, it.place.turn, sol.turn);
      if (d === 0) continue;
      if (o.wrong > 0 && o.rng.next() < o.wrong) {
        turn(b, i, o.rng.next() < 0.5 ? 3 : -3);
        return;
      }
      turn(b, i, d);
      return;
    }
  };

  const sandboxMove = (b: Bench) => {
    const L = b.layout;
    const placed = b.items
      .map((it, i) => (it.place.socket !== null ? i : -1))
      .filter((i) => i >= 0);
    const r = o.rng.next();
    if (placed.length > 0 && (r < 0.45 || placed.length >= L.limit)) {
      const i = o.rng.pick(placed);
      turn(b, i, o.rng.pick([1, 2, 3, -3, 4, -4]));
      return;
    }
    if (placed.length > 2 && r < 0.55) {
      const i = o.rng.pick(placed);
      const w = b.where(i);
      const tray = L.trays[b.items[i]!.tray];
      if (w && tray) {
        run(hand.drag([at(w.x, w.y), at(tray.box.x + tray.box.width / 2, tray.box.y + 40)], 900));
      }
      return;
    }
    const free = L.sockets
      .map((_, k) => k)
      .filter((k) => !b.items.some((it) => it.place.socket === k));
    // Mostly where light already passes, so the new piece does something.
    const R = L.sizes.piece;
    const lit = free.filter((k) => {
      const p = L.sockets[k]!;
      return b.result.segs.some(
        (g) => segDist2(g.x0, g.y0, g.x1, g.y1, p.x, p.y) < (0.45 * R) ** 2,
      );
    });
    const d = b.dispensers.length > 0 ? o.rng.pick(b.dispensers) : null;
    if (!d || free.length === 0) return;
    const slot = L.trays[d.tray]?.slots[d.slot];
    const s = L.sockets[o.rng.pick(lit.length > 0 && o.rng.next() < 0.8 ? lit : free)]!;
    if (!slot) return;
    run(hand.drag([at(slot.x, slot.y), at(s.x, s.y)], 1100 * o.pace));
  };

  return {
    update(dt, on) {
      if (disposed || !on || busy) return;
      rest -= dt;
      if (rest > 0) return;
      rest = o.rng.range(o.rest[0], o.rest[1]);
      const b = o.bench();
      if (b.grabs.size > 0) return;
      if (b.dispensers.length > 0) sandboxMove(b);
      else puzzleMove(b);
    },
    release() {
      hand.release();
      busy = false;
    },
    dispose() {
      disposed = true;
      hand.dispose();
    },
  };
};
