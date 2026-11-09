/**
 * The frame's own plant: when the frame runs alone (or its screen has gone) it drops items
 * into each line's inlet at the plant's pace, keeping each line's count near a target so the
 * belts stay busy without filling up.
 */
import type { Rng } from "../../core/types";
import type { ItemClass, Picker } from "./picker";
import type { World } from "./world";

export interface FeedOptions {
  world: World;
  picker: Picker;
  rng: Rng;
  /** Seconds between items on one line now. */
  interval(): number;
  /** Items a line should hold now. */
  target(line: number): number;
}

export interface Feed {
  step(dt: number, clockMs: number): void;
  /** Start every line's timer again (after a pause), with a little stagger. */
  restart(): void;
}

/** The class a line needs next: whichever of its belts is emptier for its size. */
export const classFor = (world: World, line: number): ItemClass => {
  const l = world.layout.lines[line];
  if (!l) return "any";
  let best: ItemClass = "any";
  let bestLoad = Infinity;
  for (const id of l.belts) {
    const b = world.layout.belts[id]!;
    const n = world.items.filter(
      (it) => it.belt === b.id && (it.state === "belt" || it.state === "tube"),
    ).length;
    const load = n / Math.max(1, world.beltCapacity(b.id));
    if (load < bestLoad) {
      bestLoad = load;
      best = b.takes;
    }
  }
  return best;
};

export const createFeed = (o: FeedOptions): Feed => {
  const lines = o.world.layout.lines.length;
  const timers = Array.from({ length: lines }, (_, i) => 0.4 + i * 0.7);
  return {
    step(dt, clockMs) {
      for (let i = 0; i < lines; i++) {
        timers[i] = timers[i]! - dt;
        if (timers[i]! > 0) continue;
        timers[i] = o.interval() * o.rng.range(0.8, 1.2);
        if (o.world.load(i) >= o.target(i)) continue;
        o.world.spawn(i, o.picker.pick(classFor(o.world, i)), clockMs);
      }
    },
    restart() {
      for (let i = 0; i < lines; i++) timers[i] = 0.5 + i * 0.6 + o.rng.next() * 0.5;
    },
  };
};
