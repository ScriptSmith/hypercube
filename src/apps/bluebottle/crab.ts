/**
 * Where a crab digs. The leader holds the hidden board, so a crab always digs safe sand: a cell
 * the solver can already deduce if there is one, else covered safe sand next to dug sand, else
 * any covered safe sand, and within each of those the cell with the fewest neighbours first (an
 * empty cell digs open a whole stretch).
 */
import { neighbours, regionOf } from "./board";
import type { Patch } from "./patch";

const mix = (a: number, b: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ b;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

/**
 * The cell a crab should dig in `region`, or -1 if the region has no covered safe sand.
 * `deducible` are safe cells the solver found; `salt` varies the choice between equals.
 */
export const crabTarget = (
  p: Patch,
  region: number,
  rw: number,
  deducible: readonly number[] | null,
  salt: number,
): number => {
  const { cols, rows, size, bottle, count } = p.board;
  const nb = neighbours(cols, rows);
  const inRegion = (i: number) => regionOf(cols, rw, i) === region;
  const covered = (i: number) => !p.dug[i] && !bottle[i] && !p.found[i];
  const best = (cells: Iterable<number>): number => {
    let pick = -1;
    let score = Infinity;
    for (const i of cells) {
      const s = count[i]! * 4_294_967_296 + mix(i, salt);
      if (s < score) {
        score = s;
        pick = i;
      }
    }
    return pick;
  };
  if (deducible) {
    const pick = best(deducible.filter((i) => inRegion(i) && covered(i)));
    if (pick >= 0) return pick;
  }
  const edge: number[] = [];
  const any: number[] = [];
  for (let i = 0; i < size; i++) {
    if (!covered(i) || !inRegion(i)) continue;
    any.push(i);
    for (let k = 0; k < nb.n[i]!; k++) {
      if (p.dug[nb.list[i * 8 + k]!]) {
        edge.push(i);
        break;
      }
    }
  }
  const pick = best(edge);
  return pick >= 0 ? pick : best(any);
};
