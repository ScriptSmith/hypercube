/**
 * Which item comes next. Each belt class has a share per bin, so every bin gets a steady flow
 * whatever its number of item pictures, and the same picture never comes twice in a row.
 */
import type { Rng } from "../../core/types";
import type { Variant } from "./config";
import { type BinKind, ITEMS, itemsFor } from "./items";

export type ItemClass = "tricky" | "obvious" | "any";

const SHARES: Record<Variant, Record<ItemClass, Partial<Record<BinKind, number>>>> = {
  sort: {
    obvious: { recycle: 0.42, compost: 0.33, rubbish: 0.25 },
    tricky: { recycle: 0.28, compost: 0.16, rubbish: 0.3, dropoff: 0.26 },
    any: { recycle: 0.36, compost: 0.24, rubbish: 0.22, dropoff: 0.18 },
  },
  simple: {
    obvious: { recycle: 0.55, rubbish: 0.45 },
    tricky: { recycle: 0.55, rubbish: 0.45 },
    any: { recycle: 0.55, rubbish: 0.45 },
  },
};

export interface Picker {
  pick(cls: ItemClass): number;
}

/** Item indices a class draws from in a variant. */
export const poolFor = (variant: Variant, cls: ItemClass): number[] => {
  const pool = itemsFor(variant);
  if (variant === "simple" || cls === "any") return pool;
  return pool.filter((i) => ITEMS[i]!.tricky === (cls === "tricky"));
};

export const createPicker = (rng: Rng, variant: Variant): Picker => {
  const tables = new Map<ItemClass, { items: number[]; weights: number[]; total: number }>();
  for (const cls of ["tricky", "obvious", "any"] as const) {
    const items = poolFor(variant, cls);
    const shares = SHARES[variant][cls];
    const perBin = new Map<BinKind, number>();
    for (const i of items) perBin.set(ITEMS[i]!.bin, (perBin.get(ITEMS[i]!.bin) ?? 0) + 1);
    const weights = items.map((i) => {
      const bin = ITEMS[i]!.bin;
      return (shares[bin] ?? 0.1) / (perBin.get(bin) ?? 1);
    });
    tables.set(cls, { items, weights, total: weights.reduce((a, b) => a + b, 0) });
  }
  let last = -1;
  return {
    pick(cls) {
      const t = tables.get(cls)!;
      if (t.items.length === 0) return 0;
      for (let attempt = 0; attempt < 4; attempt++) {
        let x = rng.next() * t.total;
        let chosen = t.items[t.items.length - 1]!;
        for (let i = 0; i < t.items.length; i++) {
          x -= t.weights[i]!;
          if (x <= 0) {
            chosen = t.items[i]!;
            break;
          }
        }
        if (chosen !== last || t.items.length === 1) {
          last = chosen;
          return chosen;
        }
      }
      const other = t.items.find((i) => i !== last) ?? last;
      last = other;
      return other;
    },
  };
};
