/**
 * Patch generator. Bluebottles are scattered by row band (sparse in the child rows, denser
 * above), a few openings are kept clear so they dig open at the start, and the layout is only
 * accepted once the solver can clear it from the openings without guessing. When the solver
 * gets stuck, one bluebottle from each stuck stretch of the frontier moves to covered sand far
 * from anything dug, and the solver starts again. Everything follows from the spec's seeds.
 */
import { createRng } from "../../core/rng";
import type { Rng } from "../../core/types";
import {
  type Board,
  distance,
  isKidRow,
  makeBoard,
  neighbours,
  regionCount,
  type Spec,
} from "./board";
import { DENSITY, OPENING_EVERY } from "./config";
import { BOTTLE, type Solver, solverFor, UNKNOWN } from "./solver";

/** Rounds of moving bluebottles before stuck ones are taken away instead. */
const MOVE_ROUNDS = 40;
/** Hard stop; a board with no bluebottles is always solvable, so this is never reached. */
const MAX_ROUNDS = 400;

export interface GenStats {
  rounds: number;
  moved: number;
  removed: number;
  added: number;
}

const shuffle = <T>(rng: Rng, a: T[]): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
};

/**
 * Openings: at least one per region, about one per OPENING_EVERY columns in all. Each is an
 * empty cell away from the edges, so it and its eight neighbours start dug. A region's first
 * opening is in the child rows, so children always have a start; any others are higher up. A
 * region with no empty cell gets one by moving a bluebottle or two off it.
 */
export const pickOpenings = (spec: Spec, rng: Rng, bottle: Uint8Array): number[] => {
  const { cols, rows, rw } = spec;
  const nb = neighbours(cols, rows);
  const regions = regionCount(cols, rw);
  const total = Math.max(regions, Math.round(cols / OPENING_EVERY));
  const per = Array.from({ length: regions }, () => 1);
  const order = shuffle(
    rng,
    Array.from({ length: regions }, (_, i) => i),
  );
  for (let k = 0; k < total - regions; k++) per[order[k % regions]!]!++;

  let count = makeBoard(cols, rows, bottle, []).count;
  const out: number[] = [];
  const kidLo = rows - spec.kid;
  const split = spec.kid > 0 && spec.kid < rows;
  const apart = (i: number) => out.every((o) => distance(cols, o, i) >= 3);
  for (let g = 0; g < regions; g++) {
    const x0 = g * rw;
    const x1 = Math.min(cols, x0 + rw);
    for (let k = 0; k < per[g]!; k++) {
      const wantKid = k === 0;
      const inBand = (r: number) => !split || r >= kidLo === wantKid;
      let best = -1;
      let bestScore = Infinity;
      for (let r = 0; r < rows; r++) {
        if (!inBand(r)) continue;
        for (let c = x0; c < x1; c++) {
          const i = r * cols + c;
          if (bottle[i] || count[i] !== 0 || !apart(i)) continue;
          // A full ring of neighbours makes a whole 3 x 3 clearing; ties at random.
          const score = (nb.n[i] === 8 ? 0 : 1) + rng.next() * 0.5;
          if (score < bestScore) {
            bestScore = score;
            best = i;
          }
        }
      }
      if (best < 0) {
        const rows3 = rows >= 3;
        let rLo = rows3 ? 1 : 0;
        let rHi = rows3 ? rows - 2 : rows - 1;
        if (split && wantKid) rLo = Math.max(rLo, Math.min(rHi, kidLo));
        else if (split) rHi = Math.max(rLo, Math.min(rHi, kidLo - 1));
        const cLo = x1 - x0 >= 3 ? x0 + 1 : x0;
        const cHi = x1 - x0 >= 3 ? x1 - 2 : x1 - 1;
        for (let tries = 0; tries < 16 && (best < 0 || !apart(best)); tries++) {
          best = (rLo + rng.int(rHi - rLo + 1)) * cols + cLo + rng.int(cHi - cLo + 1);
        }
        bottle[best] = 0;
        for (let m = 0; m < nb.n[best]!; m++) bottle[nb.list[best * 8 + m]!] = 0;
        count = makeBoard(cols, rows, bottle, []).count;
      }
      out.push(best);
    }
  }
  return [...new Set(out)];
};

const place = (spec: Spec, rng: Rng): Uint8Array => {
  const { cols, rows } = spec;
  const bottle = new Uint8Array(cols * rows);
  const d = DENSITY[spec.dens];
  for (const kid of [true, false]) {
    const band: number[] = [];
    let cells = 0;
    for (let r = 0; r < rows; r++) {
      if (isKidRow(spec, r) !== kid) continue;
      for (let c = 0; c < cols; c++) {
        cells++;
        band.push(r * cols + c);
      }
    }
    const want = Math.min(band.length, Math.round(cells * (kid ? d.low : d.high)));
    // A partial shuffle picks `want` distinct cells.
    for (let k = 0; k < want; k++) {
      const j = k + rng.int(band.length - k);
      const t = band[k]!;
      band[k] = band[j]!;
      band[j] = t;
      bottle[band[k]!] = 1;
    }
  }
  return bottle;
};

export const generate = (spec: Spec, stats?: GenStats): Board => {
  const { cols, rows } = spec;
  const size = cols * rows;
  const rng = createRng(`bluebottle:${spec.b}:${spec.n}:${spec.dens}`);
  const nb = neighbours(cols, rows);
  const bottle = place(spec, rng.fork("bottles"));
  const openings = pickOpenings(spec, rng.fork("openings"), bottle);
  // Openings stay empty: nothing moves next to them.
  const forbidden = new Uint8Array(size);
  for (const o of openings) {
    forbidden[o] = 1;
    for (let k = 0; k < nb.n[o]!; k++) forbidden[nb.list[o * 8 + k]!] = 1;
  }
  const fix = rng.fork("repair");
  const solver: Solver = solverFor(cols, rows);
  const s = stats ?? { rounds: 0, moved: 0, removed: 0, added: 0 };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const board = makeBoard(cols, rows, bottle, openings);
    const res = solver.solve(board);
    s.rounds = round + 1;
    if (res.cleared) return board;
    repair(spec, res.st, res.open, bottle, forbidden, openings, fix, round >= MOVE_ROUNDS, s);
  }
  // Unreachable in practice: fall back to a beach with no bluebottles at all.
  return makeBoard(cols, rows, new Uint8Array(size), openings);
};

const repair = (
  spec: Spec,
  st: Uint8Array,
  open: Uint8Array,
  bottle: Uint8Array,
  forbidden: Uint8Array,
  openings: number[],
  rng: Rng,
  remove: boolean,
  s: GenStats,
) => {
  const { cols, rows } = spec;
  const size = cols * rows;
  const nb = neighbours(cols, rows);
  const nearOpen = (i: number) => {
    for (let k = 0; k < nb.n[i]!; k++) if (open[nb.list[i * 8 + k]!]) return true;
    return false;
  };
  // Stretches of frontier joined through shared counts.
  const parent = new Int32Array(size).fill(-1);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const frontier: number[] = [];
  for (let i = 0; i < size; i++) {
    if (st[i] === UNKNOWN && nearOpen(i)) {
      frontier.push(i);
      parent[i] = i;
    }
  }
  for (let c = 0; c < size; c++) {
    if (!open[c]) continue;
    let first = -1;
    for (let k = 0; k < nb.n[c]!; k++) {
      const n = nb.list[c * 8 + k]!;
      if (parent[n]! < 0) continue;
      if (first < 0) first = n;
      else {
        const a = find(first);
        const b = find(n);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (const v of frontier) {
    if (!bottle[v]) continue;
    const r = find(v);
    const g = groups.get(r);
    if (g) g.push(v);
    else groups.set(r, [v]);
  }

  const move = (src: number) => {
    bottle[src] = 0;
    if (remove) {
      s.removed++;
      return;
    }
    const kid = isKidRow(spec, Math.floor(src / cols));
    const sc = src % cols;
    const sr = Math.floor(src / cols);
    const pick = (sameBand: boolean): number => {
      const ok: number[] = [];
      for (let i = 0; i < size; i++) {
        if (bottle[i] || forbidden[i] || open[i] || st[i] !== UNKNOWN || nearOpen(i)) continue;
        if (Math.abs((i % cols) - sc) < 2 && Math.abs(Math.floor(i / cols) - sr) < 2) continue;
        if (sameBand && isKidRow(spec, Math.floor(i / cols)) !== kid) continue;
        ok.push(i);
      }
      return ok.length > 0 ? ok[rng.int(ok.length)]! : -1;
    };
    let to = pick(true);
    if (to < 0) to = pick(false);
    if (to >= 0) {
      bottle[to] = 1;
      s.moved++;
    } else s.removed++;
  };

  if (groups.size > 0) {
    for (const g of groups.values()) move(g[rng.int(g.length)]!);
    return;
  }
  // No bluebottle on the frontier: unreachable sand is walled off by known ones. Free one.
  const walls: number[] = [];
  for (let i = 0; i < size; i++) {
    if (st[i] !== BOTTLE) continue;
    for (let k = 0; k < nb.n[i]!; k++) {
      if (st[nb.list[i * 8 + k]!] === UNKNOWN) {
        walls.push(i);
        break;
      }
    }
  }
  if (walls.length > 0) {
    move(walls[rng.int(walls.length)]!);
    return;
  }
  // Nothing dug reaches the rest at all: give it an opening of its own.
  const rest: number[] = [];
  for (let i = 0; i < size; i++) if (st[i] === UNKNOWN && !bottle[i]) rest.push(i);
  if (rest.length === 0) return;
  const counts = makeBoard(cols, rows, bottle, openings).count;
  const zero = rest.filter((i) => counts[i] === 0);
  const at = (zero.length > 0 ? zero : rest)[rng.int((zero.length > 0 ? zero : rest).length)]!;
  openings.push(at);
  forbidden[at] = 1;
  s.added++;
};
