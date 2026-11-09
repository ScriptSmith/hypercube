/**
 * The attract mode's ghost hand: now and then it reaches for an item on a belt and carries it
 * into the right bin, so passers-by see what to do. It moves items directly (no injected
 * touches) and is drawn as a translucent hand.
 */
import type { Rng } from "../../core/types";
import { ITEMS } from "./items";
import type { Point } from "./paths";
import { makePath, type Path, pointAt } from "./paths";
import { planCarry } from "./plan";
import type { Ghost } from "./render";
import type { World } from "./world";

/** Seconds between a line's ghost sorts. */
export const GHOST_EVERY = { min: 6, max: 10 } as const;
const REACH_S = 0.8;
const CARRY_D = 3.6;
const FADE_S = 0.5;

export interface GhostHands {
  readonly hands: readonly Ghost[];
  readonly sorted: number;
  step(dt: number, active: boolean): void;
  stop(): void;
}

interface Hand {
  line: number;
  finger: number;
  phase: "wait" | "reach" | "carry" | "fade";
  t: number;
  wait: number;
  from: Point;
  item: number;
  path: Path | null;
  x: number;
  y: number;
}

export const createGhosts = (world: () => World, rng: Rng): GhostHands => {
  const lines = world().layout.lines.length;
  const hands: Hand[] = Array.from({ length: lines }, (_, i) => ({
    line: i,
    finger: -100 - i,
    phase: "wait",
    t: 0,
    wait: 2 + i * 1.7 + rng.next() * 2,
    from: { x: 0, y: 0 },
    item: -1,
    path: null,
    x: 0,
    y: 0,
  }));
  const shown: Ghost[] = [];
  let sorted = 0;
  const pt = { x: 0, y: 0, angle: 0 };

  const rest = (h: Hand): Point => {
    const L = world().layout;
    const bins = L.bins.filter((b) => b.line === h.line);
    const b = bins[Math.floor(bins.length / 2)] ?? bins[0];
    return b ? { x: b.x, y: b.bottom - L.d * 0.2 } : { x: L.width / 2, y: L.height - L.d };
  };

  const letGo = (h: Hand) => {
    const w = world();
    if (w.held(h.finger)) w.release(h.finger, 0, w.layout.d * 2);
  };

  return {
    get hands() {
      return shown;
    },
    get sorted() {
      return sorted;
    },
    step(dt, active) {
      shown.length = 0;
      const w = world();
      const L = w.layout;
      for (const h of hands) {
        if (!active && h.phase === "wait") continue;
        h.t += dt;
        if (h.phase === "wait") {
          h.wait -= dt;
          if (h.wait > 0) continue;
          const candidates = w.items.filter(
            (it) =>
              it.line === h.line &&
              it.state === "belt" &&
              it.s > L.d &&
              L.belts[it.belt] &&
              it.s < L.belts[it.belt]!.length - L.d * 2.5,
          );
          h.wait = GHOST_EVERY.min + rng.next() * (GHOST_EVERY.max - GHOST_EVERY.min);
          if (candidates.length === 0) continue;
          const it = rng.pick(candidates);
          h.item = it.id;
          h.from = rest(h);
          h.x = h.from.x;
          h.y = h.from.y;
          h.phase = "reach";
          h.t = 0;
        } else if (h.phase === "reach") {
          const it = w.items.find((q) => q.id === h.item);
          if (!it || it.state !== "belt" || !active) {
            h.phase = "fade";
            h.t = 0;
            continue;
          }
          const f = Math.min(1, h.t / REACH_S);
          const e = f * f * (3 - 2 * f);
          h.x = h.from.x + (it.x - h.from.x) * e;
          h.y = h.from.y + (it.y - h.from.y) * e;
          if (f >= 1) {
            const got = w.grab(h.finger, it.x, it.y, "ghost");
            const bin = L.bins.find((b) => b.line === h.line && b.kind === ITEMS[it.kind]?.bin);
            if (!got || !bin) {
              letGo(h);
              h.phase = "fade";
              h.t = 0;
              continue;
            }
            h.path = makePath(planCarry(L, { x: got.x, y: got.y }, bin));
            h.phase = "carry";
            h.t = 0;
          }
        } else if (h.phase === "carry") {
          const path = h.path;
          if (!path || !w.held(h.finger)) {
            if (path && !w.held(h.finger)) sorted++;
            h.phase = "fade";
            h.t = 0;
            continue;
          }
          const s = h.t * CARRY_D * L.d;
          pointAt(path, s, pt);
          h.x = pt.x;
          h.y = pt.y;
          w.move(h.finger, pt.x, pt.y);
          if (s >= path.length) {
            letGo(h);
            sorted++;
            h.phase = "fade";
            h.t = 0;
          }
        } else if (h.t >= FADE_S) {
          h.phase = "wait";
          h.t = 0;
          continue;
        }
        const alpha =
          h.phase === "fade"
            ? 0.55 * (1 - h.t / FADE_S)
            : h.phase === "reach"
              ? 0.55 * Math.min(1, h.t / 0.3)
              : 0.55;
        shown.push({ x: h.x, y: h.y, alpha });
      }
    },
    stop() {
      for (const h of hands) {
        letGo(h);
        h.phase = "wait";
        h.wait = 3 + rng.next() * 3;
        h.t = 0;
      }
      shown.length = 0;
    },
  };
};
