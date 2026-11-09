/**
 * The park along the top. A full bin becomes a new thing at the plant: a recycling bin by what
 * most of it was (cans make a bike, plastic bottles a bench, glass a jar of jam, paper a book),
 * compost a tree or flowers, the drop-off box a lamp powered by the recycled batteries. Rubbish
 * goes to landfill and makes nothing. The park holds a bounded number of things; when it is
 * full the oldest moves on.
 */
import type { BinKind, Material } from "./items";

export type ThingKind = "bike" | "bench" | "jar" | "book" | "tree" | "flowers" | "lamp";

export const THING_KINDS: readonly ThingKind[] = [
  "bike",
  "bench",
  "jar",
  "book",
  "tree",
  "flowers",
  "lamp",
];

export const MAX_PARK = 12;

export type Materials = Partial<Record<Material, number>>;

const BY_MATERIAL: [Material, ThingKind][] = [
  ["metal", "bike"],
  ["plastic", "bench"],
  ["glass", "jar"],
  ["paper", "book"],
];

/** What a full bin becomes, or null for rubbish. `turn` alternates compost's trees and flowers. */
export const productOf = (bin: BinKind, materials: Materials, turn: number): ThingKind | null => {
  if (bin === "rubbish") return null;
  if (bin === "dropoff") return "lamp";
  if (bin === "compost") return turn % 2 === 0 ? "tree" : "flowers";
  let best: ThingKind = "bike";
  let most = -1;
  for (const [m, thing] of BY_MATERIAL) {
    const n = materials[m] ?? 0;
    if (n > most) {
      most = n;
      best = thing;
    }
  }
  return best;
};

export interface Thing {
  id: number;
  kind: ThingKind;
  /** Place in the park, 0 = oldest. `shown` eases towards `slot` for drawing. */
  slot: number;
  shown: number;
  /** Seconds since it arrived (for its pop-in), and since it started leaving. */
  age: number;
  leaving: number | null;
}

export interface Park {
  readonly things: readonly Thing[];
  /** Things leaving off the end, still drawn while they go. */
  readonly leavers: readonly Thing[];
  readonly capacity: number;
  readonly added: number;
  add(kind: ThingKind): Thing;
  step(dt: number): void;
  clear(): void;
  setCapacity(n: number): void;
}

export const LEAVE_S = 1.6;

export const createPark = (capacity = MAX_PARK): Park => {
  let cap = Math.max(1, Math.min(MAX_PARK, Math.round(capacity)));
  const things: Thing[] = [];
  const leavers: Thing[] = [];
  let next = 1;
  let added = 0;
  const trim = () => {
    while (things.length > cap) {
      const old = things.shift()!;
      old.leaving = 0;
      leavers.push(old);
      if (leavers.length > MAX_PARK) leavers.shift();
    }
    things.forEach((t, i) => {
      t.slot = i;
    });
  };
  return {
    things,
    leavers,
    get capacity() {
      return cap;
    },
    get added() {
      return added;
    },
    add(kind) {
      const t: Thing = {
        id: next++,
        kind,
        slot: things.length,
        shown: things.length,
        age: 0,
        leaving: null,
      };
      things.push(t);
      added++;
      trim();
      return t;
    },
    step(dt) {
      for (const t of things) {
        t.age += dt;
        t.shown += (t.slot - t.shown) * Math.min(1, dt * 3);
      }
      for (let i = leavers.length - 1; i >= 0; i--) {
        const t = leavers[i]!;
        t.leaving = (t.leaving ?? 0) + dt;
        if (t.leaving >= LEAVE_S) leavers.splice(i, 1);
      }
    },
    clear() {
      things.length = 0;
      leavers.length = 0;
    },
    setCapacity(n) {
      cap = Math.max(1, Math.min(MAX_PARK, Math.round(n)));
      trim();
    },
  };
};
