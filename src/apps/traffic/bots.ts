/**
 * Bots touch cars through injected touches, the way people do: mostly short taps on a car a
 * little ahead of where it is drawn (a finger lands a moment late), sometimes a hold of a couple
 * of seconds. Now and then one presses an adult control, more often back towards the starting
 * settings than away from them, so the road wanders but returns. In versus they throw slowdowns
 * instead of touching cars. A bot leaves a frame alone for a while after a person touches it.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rect, Rng } from "../../core/types";
import type { Settings } from "./config";
import type { ControlGroup } from "./layout";
import type { DrawnCar } from "./scene";

export interface BotView {
  /** Cars drawn on this frame, venue px, and their speed along the road in venue px/s. */
  cars(): readonly (DrawnCar & { vx: number; vy: number })[];
  controls(): readonly ControlGroup[];
  settings(): Settings | null;
  defaults(): Settings;
  /** Versus: the slowdown buttons. */
  slowdowns?(): readonly Rect[];
  /** Local ms of the last person's touch on this frame. */
  lastPerson(): number;
  /** Venue px to stage px. */
  unit(): number;
  /** Frame size in venue px, so bots only touch what is on screen. */
  size(): { width: number; height: number };
}

export interface Bots {
  update(local: number): void;
  release(): void;
  dispose(): void;
  readonly fingers: number;
}

const YIELD_MS = 15_000;

export const createBots = (input: Input, count: number, view: BotView, rng: Rng): Bots => {
  const hands: { hand: BotHand; next: number }[] = [];
  for (let i = 0; i < count; i++) {
    hands.push({ hand: createBotHand(input), next: performance.now() + 2500 + rng.range(0, 4000) });
  }
  let controlAt = performance.now() + rng.range(20_000, 40_000);
  let disposed = false;

  const pressControl = (hand: BotHand) => {
    const s = view.settings();
    if (!s) return;
    const d = view.defaults();
    const groups = view.controls();
    if (groups.length === 0) return;
    const grp = groups[rng.int(groups.length)]!;
    const u = view.unit();
    const tap = (r: Rect) => void hand.tap((r.x + r.width / 2) * u, (r.y + r.height / 2) * u, 90);
    if (grp.key === "cars") {
      const back = s.count === d.count ? (rng.next() < 0.5 ? -1 : 1) : s.count > d.count ? -1 : 1;
      const dir = rng.next() < 0.7 ? back : -back;
      tap(grp.cells[dir < 0 ? 0 : 2]!);
      return;
    }
    const current = grp.key === "limit" ? s.limit : s.smart;
    const home = grp.key === "limit" ? d.limit : d.smart;
    const pick = current !== home && rng.next() < 0.7 ? home : rng.int(grp.cells.length);
    tap(grp.cells[pick]!);
  };

  return {
    update(local) {
      if (disposed) return;
      if (local - view.lastPerson() < YIELD_MS) {
        for (const h of hands) h.hand.release();
        return;
      }
      const u = view.unit();
      const { width, height } = view.size();
      for (const h of hands) {
        if (local < h.next || h.hand.touches > 0) continue;
        const slow = view.slowdowns?.();
        if (slow && slow.length > 0) {
          h.next = local + rng.range(3500, 9000);
          const r = slow[rng.int(slow.length)]!;
          void h.hand.tap((r.x + r.width / 2) * u, (r.y + r.height / 2) * u, 120);
          continue;
        }
        h.next = local + rng.range(5000, 13_000);
        const cars = view.cars().filter((c) => c.x > 80 && c.x < width - 80 && c.y < height);
        if (cars.length === 0) continue;
        const c = cars[rng.int(cars.length)]!;
        const lead = 0.12;
        const x = (c.x + c.vx * lead) * u;
        const y = (c.y + c.vy * lead) * u;
        if (rng.next() < 0.75) void h.hand.tap(x, y, rng.range(70, 220));
        else void h.hand.hold(x, y, rng.range(1500, 3200));
      }
      if (local >= controlAt) {
        controlAt = local + rng.range(30_000, 60_000);
        const free = hands.find((h) => h.hand.touches === 0);
        if (free) pressControl(free.hand);
      }
    },
    release() {
      for (const h of hands) h.hand.release();
    },
    dispose() {
      disposed = true;
      for (const h of hands) h.hand.dispose();
      hands.length = 0;
    },
    get fingers() {
      let n = 0;
      for (const h of hands) n += h.hand.touches;
      return n;
    },
  };
};
