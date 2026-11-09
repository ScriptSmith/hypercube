/**
 * A logic solver for the beach. It only makes sound deductions from what a visitor can see:
 *
 * - single cells: a count already met makes its other covered neighbours safe, and a count that
 *   needs every covered neighbour makes them all bluebottles;
 * - pairs of nearby counts: when the difference between two counts equals the number of cells
 *   only the larger one sees, those cells are bluebottles and the cells only the smaller one sees
 *   are safe (this covers the subset rule);
 * - exhaustive search over small groups of frontier cells, trying every assignment that agrees
 *   with the counts around them; a cell that is safe (or a bluebottle) in all of them is decided.
 *
 * Large frontier groups are searched in windows of nearby cells, where counts that reach outside
 * the window only bound the window's share. Searches have a node budget, so the solver's results
 * depend only on its input. It never uses the total number of bluebottles.
 */
import { type Board, neighbours } from "./board";

export const UNKNOWN = 0;
export const SAFE = 1;
export const BOTTLE = 2;

/** What a visitor can see. */
export interface Visible {
  /** 1 where the sand is dug and its count shows. */
  dug: Uint8Array;
  /** Counts, read only where dug. */
  count: Uint8Array;
  /** Non-zero where a bluebottle is known (found after a sting). */
  found: Uint8Array;
}

export interface Deductions {
  safe: number[];
  bottles: number[];
}

export interface SolveResult {
  cleared: boolean;
  /** UNKNOWN, SAFE or BOTTLE per cell after solving. */
  st: Uint8Array;
  /** 1 where the solver dug. */
  open: Uint8Array;
  /** Safe cells the solver could not reach. */
  left: number;
}

export interface SolverLimits {
  /** Frontier groups up to this many cells are searched whole. */
  exact: number;
  /** Larger groups are searched in windows of this many cells. */
  window: number;
  /** Nodes one search may visit before it gives up (and decides nothing). */
  nodes: number;
  /** Nodes all the searches of one pass may visit. */
  budget: number;
}

export const DEFAULT_LIMITS: SolverLimits = {
  exact: 20,
  window: 14,
  nodes: 40_000,
  budget: 400_000,
};

export interface Solver {
  readonly cols: number;
  readonly rows: number;
  /** Play the board from its openings using deductions only. */
  solve(board: Board): SolveResult;
  /** Everything that can be deduced from the visible beach. */
  deduce(v: Visible): Deductions;
  /** Times the solver concluded something false. Always 0; checked by tests. */
  readonly errors: number;
}

export const createSolver = (
  cols: number,
  rows: number,
  limits: SolverLimits = DEFAULT_LIMITS,
): Solver => {
  const size = cols * rows;
  const nb = neighbours(cols, rows);
  const NL = nb.list;
  const NN = nb.n;
  const st = new Uint8Array(size);
  const open = new Uint8Array(size);
  const cnt = new Uint8Array(size);
  const queue = new Int32Array(Math.max(1, size));
  const queued = new Uint8Array(size);
  let qh = 0;
  let qt = 0;
  let qn = 0;
  let board: Board | null = null;
  let newSafe: number[] = [];
  let newBottles: number[] = [];
  let errors = 0;

  // Scratch for pairs and searches.
  const markA = new Int32Array(size);
  const markB = new Int32Array(size);
  let stamp = 0;
  const local = new Int32Array(size).fill(-1);
  const parent = new Int32Array(size);
  const ua = new Int32Array(8);
  const ub = new Int32Array(8);

  const push = (i: number) => {
    if (queued[i] || !open[i]) return;
    queued[i] = 1;
    queue[qt] = i;
    qt = (qt + 1) % size;
    qn++;
  };

  const pushOpenAround = (j: number) => {
    const base = j * 8;
    for (let k = 0; k < NN[j]!; k++) {
      const n = NL[base + k]!;
      if (open[n]) push(n);
    }
  };

  const setSafe = (j: number) => {
    if (st[j] !== UNKNOWN) return;
    st[j] = SAFE;
    if (board) {
      if (board.bottle[j]) errors++;
      open[j] = 1;
      cnt[j] = board.count[j]!;
      push(j);
    } else newSafe.push(j);
    pushOpenAround(j);
  };

  const setBottle = (j: number) => {
    if (st[j] !== UNKNOWN) return;
    st[j] = BOTTLE;
    if (board && !board.bottle[j]) errors++;
    if (!board) newBottles.push(j);
    pushOpenAround(j);
  };

  /** Covered unknown neighbours of an open cell into `out`; returns [count, bluebottles still to place]. */
  const collect = (i: number, out: Int32Array): [number, number] => {
    let u = 0;
    let b = 0;
    const base = i * 8;
    for (let k = 0; k < NN[i]!; k++) {
      const n = NL[base + k]!;
      const s = st[n]!;
      if (s === UNKNOWN) out[u++] = n;
      else if (s === BOTTLE) b++;
    }
    return [u, cnt[i]! - b];
  };

  const simple = (i: number): boolean => {
    const [u, r] = collect(i, ua);
    if (u === 0 || r < 0 || r > u) return false;
    if (r === 0) {
      for (let k = 0; k < u; k++) setSafe(ua[k]!);
      return true;
    }
    if (r === u) {
      for (let k = 0; k < u; k++) setBottle(ua[k]!);
      return true;
    }
    return false;
  };

  const drain = () => {
    while (qn > 0) {
      const i = queue[qh]!;
      qh = (qh + 1) % size;
      qn--;
      queued[i] = 0;
      simple(i);
    }
  };

  const pairs = (): boolean => {
    let any = false;
    for (let a = 0; a < size; a++) {
      if (!open[a]) continue;
      const ar = Math.floor(a / cols);
      const ac = a % cols;
      for (let dr = 0; dr <= 2; dr++) {
        const br = ar + dr;
        if (br >= rows) break;
        for (let dc = -2; dc <= 2; dc++) {
          if (dr === 0 && dc <= 0) continue;
          const bc = ac + dc;
          if (bc < 0 || bc >= cols) continue;
          const b = br * cols + bc;
          if (!open[b]) continue;
          const [na, ra] = collect(a, ua);
          if (na === 0) break;
          const [nbb, rb] = collect(b, ub);
          if (nbb === 0) continue;
          stamp++;
          for (let k = 0; k < na; k++) markA[ua[k]!] = stamp;
          let inter = 0;
          for (let k = 0; k < nbb; k++) {
            if (markA[ub[k]!] === stamp) inter++;
            markB[ub[k]!] = stamp;
          }
          if (inter === 0) continue;
          const onlyA = na - inter;
          const onlyB = nbb - inter;
          if (onlyA === 0 && onlyB === 0) continue;
          if (rb - ra === onlyB) {
            for (let k = 0; k < nbb; k++) if (markA[ub[k]!] !== stamp) setBottle(ub[k]!);
            for (let k = 0; k < na; k++) if (markB[ua[k]!] !== stamp) setSafe(ua[k]!);
            any = true;
          } else if (ra - rb === onlyA) {
            for (let k = 0; k < na; k++) if (markB[ua[k]!] !== stamp) setBottle(ua[k]!);
            for (let k = 0; k < nbb; k++) if (markA[ub[k]!] !== stamp) setSafe(ub[k]!);
            any = true;
          }
        }
      }
    }
    return any;
  };

  // ---- Exhaustive search ------------------------------------------------------------------------

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };

  /**
   * Try every assignment of `vars` that agrees with the counts around them. Counts that see
   * covered cells outside `vars` only bound how many of their bluebottles fall inside. Returns
   * the cells decided, or null when the search ran out of nodes or found nothing.
   */
  let budgetLeft = 0;
  const enumerate = (vars: readonly number[]): { safe: number[]; bottles: number[] } | null => {
    const nv = vars.length;
    if (nv === 0) return null;
    for (let i = 0; i < nv; i++) local[vars[i]!] = i;
    // Constraints: every open cell next to a var.
    stamp++;
    const cons: number[] = [];
    for (const v of vars) {
      const base = v * 8;
      for (let k = 0; k < NN[v]!; k++) {
        const c = NL[base + k]!;
        if (open[c] && markA[c] !== stamp) {
          markA[c] = stamp;
          cons.push(c);
        }
      }
    }
    const nc = cons.length;
    const lo = new Int8Array(nc);
    const hi = new Int8Array(nc);
    const uc = new Int8Array(nc);
    const ac = new Int8Array(nc);
    const varCons: number[][] = vars.map(() => []);
    for (let ci = 0; ci < nc; ci++) {
      const c = cons[ci]!;
      let inside = 0;
      let outside = 0;
      let b = 0;
      const base = c * 8;
      for (let k = 0; k < NN[c]!; k++) {
        const n = NL[base + k]!;
        const s = st[n]!;
        if (s === BOTTLE) b++;
        else if (s === UNKNOWN) {
          const li = local[n]!;
          if (li >= 0) {
            inside++;
            varCons[li]!.push(ci);
          } else outside++;
        }
      }
      const r = cnt[c]! - b;
      lo[ci] = Math.max(0, r - outside);
      hi[ci] = Math.min(r, inside);
      uc[ci] = inside;
      if (lo[ci]! > hi[ci]!) {
        for (const v of vars) local[v] = -1;
        return null;
      }
    }
    const val = new Int8Array(nv);
    const seen = new Uint8Array(nv);
    let undecided = nv;
    let nodes = 0;
    let aborted = false;
    let solutions = 0;
    const cap = Math.min(limits.nodes, budgetLeft);

    const assign = (v: number, x: number): boolean => {
      let ok = true;
      for (const ci of varCons[v]!) {
        uc[ci]! -= 1;
        ac[ci]! += x;
        if (ac[ci]! > hi[ci]! || ac[ci]! + uc[ci]! < lo[ci]!) ok = false;
      }
      return ok;
    };
    const unassign = (v: number, x: number) => {
      for (const ci of varCons[v]!) {
        uc[ci]! += 1;
        ac[ci]! -= x;
      }
    };
    const rec = (d: number): boolean => {
      if (++nodes > cap) {
        aborted = true;
        return false;
      }
      if (d === nv) {
        solutions++;
        for (let i = 0; i < nv; i++) {
          const bit = val[i] ? 2 : 1;
          if ((seen[i]! & bit) === 0) {
            seen[i] = seen[i]! | bit;
            if (seen[i] === 3) undecided--;
          }
        }
        return undecided > 0;
      }
      for (let x = 0; x <= 1; x++) {
        const ok = assign(d, x);
        if (ok) {
          val[d] = x;
          if (!rec(d + 1)) {
            unassign(d, x);
            return false;
          }
        }
        unassign(d, x);
      }
      return true;
    };
    rec(0);
    budgetLeft -= nodes;
    for (const v of vars) local[v] = -1;
    if (aborted || solutions === 0 || undecided === 0) return null;
    const out = { safe: [] as number[], bottles: [] as number[] };
    for (let i = 0; i < nv; i++) {
      if (seen[i] === 1) out.safe.push(vars[i]!);
      else if (seen[i] === 2) out.bottles.push(vars[i]!);
    }
    return out;
  };

  /** Up to `max` frontier cells around `v`, nearest (through shared counts) first. */
  const windowAround = (v: number, max: number): number[] => {
    stamp++;
    const out = [v];
    markB[v] = stamp;
    for (let head = 0; head < out.length && out.length < max; head++) {
      const x = out[head]!;
      const base = x * 8;
      for (let k = 0; k < NN[x]! && out.length < max; k++) {
        const c = NL[base + k]!;
        if (!open[c]) continue;
        const cb = c * 8;
        for (let m = 0; m < NN[c]! && out.length < max; m++) {
          const y = NL[cb + m]!;
          if (st[y] === UNKNOWN && markB[y] !== stamp) {
            markB[y] = stamp;
            out.push(y);
          }
        }
      }
    }
    return out;
  };

  /** Order a group so each cell is next to the ones before it, which keeps pruning early. */
  const ordered = (group: number[]): number[] => {
    if (group.length <= 2) return group;
    stamp++;
    const inGroup = stamp;
    for (const v of group) markA[v] = inGroup;
    stamp++;
    const done = stamp;
    const out: number[] = [];
    for (const start of group) {
      if (markB[start] === done) continue;
      markB[start] = done;
      out.push(start);
      for (let head = out.length - 1; head < out.length; head++) {
        const x = out[head]!;
        const base = x * 8;
        for (let k = 0; k < NN[x]!; k++) {
          const c = NL[base + k]!;
          if (!open[c]) continue;
          const cb = c * 8;
          for (let m = 0; m < NN[c]!; m++) {
            const y = NL[cb + m]!;
            if (markA[y] === inGroup && markB[y] !== done) {
              markB[y] = done;
              out.push(y);
            }
          }
        }
      }
    }
    return out;
  };

  const apply = (r: { safe: number[]; bottles: number[] } | null): boolean => {
    if (!r) return false;
    for (const c of r.safe) setSafe(c);
    for (const c of r.bottles) setBottle(c);
    return r.safe.length + r.bottles.length > 0;
  };

  const search = (): boolean => {
    budgetLeft = limits.budget;
    const frontier: number[] = [];
    for (let i = 0; i < size; i++) {
      if (st[i] !== UNKNOWN) continue;
      const base = i * 8;
      let edge = false;
      for (let k = 0; k < NN[i]!; k++) {
        if (open[NL[base + k]!]) {
          edge = true;
          break;
        }
      }
      if (edge) {
        frontier.push(i);
        parent[i] = i;
      }
    }
    if (frontier.length === 0) return false;
    for (let c = 0; c < size; c++) {
      if (!open[c]) continue;
      const base = c * 8;
      let first = -1;
      for (let k = 0; k < NN[c]!; k++) {
        const n = NL[base + k]!;
        if (st[n] !== UNKNOWN) continue;
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
      const r = find(v);
      let g = groups.get(r);
      if (!g) {
        g = [];
        groups.set(r, g);
      }
      g.push(v);
    }
    let any = false;
    for (const group of groups.values()) {
      if (budgetLeft <= 0) break;
      if (group.length <= limits.exact) {
        if (apply(enumerate(ordered(group)))) any = true;
        continue;
      }
      for (const v of group) {
        if (budgetLeft <= 0) break;
        if (st[v] !== UNKNOWN) continue;
        if (apply(enumerate(windowAround(v, limits.window)))) any = true;
      }
    }
    return any;
  };

  const run = () => {
    for (;;) {
      drain();
      if (pairs()) continue;
      if (search()) continue;
      break;
    }
  };

  const reset = () => {
    st.fill(UNKNOWN);
    open.fill(0);
    cnt.fill(0);
    queued.fill(0);
    qh = 0;
    qt = 0;
    qn = 0;
    newSafe = [];
    newBottles = [];
  };

  return {
    cols,
    rows,
    get errors() {
      return errors;
    },
    solve(b) {
      if (b.cols !== cols || b.rows !== rows) throw new Error("solver and board sizes differ");
      reset();
      board = b;
      for (const o of b.openings) {
        if (b.bottle[o]) continue;
        setSafe(o);
      }
      run();
      let dug = 0;
      for (let i = 0; i < size; i++) dug += open[i]!;
      board = null;
      return { cleared: dug === b.safe, st: st.slice(), open: open.slice(), left: b.safe - dug };
    },
    deduce(v) {
      reset();
      board = null;
      for (let i = 0; i < size; i++) {
        if (v.dug[i]) {
          st[i] = SAFE;
          open[i] = 1;
          cnt[i] = v.count[i]!;
        } else if (v.found[i]) st[i] = BOTTLE;
      }
      for (let i = 0; i < size; i++) if (open[i]) push(i);
      run();
      const out = { safe: newSafe, bottles: newBottles };
      newSafe = [];
      newBottles = [];
      return out;
    },
  };
};

const solvers = new Map<string, Solver>();

/** A shared solver per grid size (they hold scratch buffers), kept for a few sizes. */
export const solverFor = (cols: number, rows: number): Solver => {
  const key = `${cols}x${rows}`;
  const hit = solvers.get(key);
  if (hit) return hit;
  if (solvers.size >= 6) solvers.delete(solvers.keys().next().value!);
  const s = createSolver(cols, rows);
  solvers.set(key, s);
  return s;
};
