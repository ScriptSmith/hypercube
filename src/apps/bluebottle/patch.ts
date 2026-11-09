/**
 * One patch in play: the hidden board, the log of everything done to it, and the state that
 * replaying the log gives. Events are kept sorted by (time, sender, sequence), so every frame
 * that holds the same events holds the same beach, whatever order they arrived in. An event
 * that sorts after the last one is applied directly; one that sorts earlier replays the log.
 */
import { type Board, neighbours, regionCount, regionOf } from "./board";
import { IDLE_GUARD_MS, LOG_PER_CELL, MAX_WASHES, WASH_GUARD_MS } from "./config";

export const DIG = 0;
export const FLAG = 1;
export const UNFLAG = 2;
/** A crab digs a cell the leader knows is safe. */
export const HINT = 3;
/** A visitor's or the idle timer's wash, refused while another frame's visitors are digging. */
export const WASH = 4;
/** A wash that is never refused (admin, a full log, a leader fixing the patch size). */
export const TIDE = 5;
export type Kind = 0 | 1 | 2 | 3 | 4 | 5;

export interface Ev {
  k: Kind;
  /** Cell index. For washes, any cell of the sender's beach. */
  c: number;
  /** Shared-clock ms. */
  t: number;
  /** Sending frame. */
  s: string;
  /** The sender's sequence number. */
  q: number;
  /** Done by a person rather than a bot or a timer. */
  h: boolean;
}

export const compareEv = (a: Ev, b: Ev): number =>
  a.t - b.t || (a.s < b.s ? -1 : a.s > b.s ? 1 : 0) || a.q - b.q;

export const evKey = (e: Ev): string => `${e.s}#${e.q}`;

/** Order-independent fingerprint of a set of events. */
const evHash = (e: Ev): number => {
  let h = 2166136261 ^ e.k;
  const text = `${e.s}#${e.q}#${e.c}#${Math.round(e.t)}`;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

export interface PatchEnd {
  t: number;
  why: "clear" | "wash";
}

/** What changed when one event was applied, for drawing. */
export type Effect =
  | { kind: "dig"; ev: Ev; cells: number[]; depth: number[]; crab: boolean }
  | { kind: "sting"; ev: Ev; cell: number; covered: number[] }
  | { kind: "flag"; ev: Ev; cell: number; on: boolean }
  | { kind: "end"; ev: Ev; why: PatchEnd["why"]; found: number[] }
  | { kind: "refused"; ev: Ev }
  | { kind: "replayed" };

export type AddResult = "dup" | "full" | "applied" | "late" | "replayed" | "bad";

export interface PatchRules {
  sting: number;
  flags: boolean;
}

export interface Patch {
  readonly board: Board;
  readonly dug: Uint8Array;
  readonly flag: Uint8Array;
  /** 1 found by a sting, 2 found by the lifeguard when the patch cleared. */
  readonly found: Uint8Array;
  /** 1 where a crab dug the cell itself. */
  readonly crab: Uint8Array;
  readonly dugSafe: number;
  readonly flags: number;
  readonly foundCount: number;
  readonly stings: number;
  readonly hints: number;
  readonly end: PatchEnd | null;
  /** Per region: time of the latest event that dug something there. */
  readonly progressAt: Float64Array;
  /** Whether a person has done anything to this patch. */
  readonly touched: boolean;
  readonly events: readonly Ev[];
  readonly hash: number;
  /** Flags still to place: one per bluebottle, less those placed and those found. */
  flagsLeft(): number;
  /** Fraction of the safe sand dug. */
  progress(): number;
  /** Whether a flag could go on cell `i` now. */
  canFlag(i: number): boolean;
  add(ev: Ev, effects?: (e: Effect) => void): AddResult;
  /** Add a batch (a synced log), replaying at most once. Returns how many were new. */
  addMany(evs: readonly Ev[], effects?: (e: Effect) => void): number;
  has(ev: Ev): boolean;
}

export const createPatch = (
  board: Board,
  rules: PatchRules,
  opts: { start: number; rw: number },
): Patch => {
  const { cols, rows, size } = board;
  const nb = neighbours(cols, rows);
  const regions = regionCount(cols, opts.rw);
  const cap = Math.max(64, size * LOG_PER_CELL);
  const events: Ev[] = [];
  const keys = new Set<string>();
  let washes = 0;
  let hash = 0;

  const dug = new Uint8Array(size);
  const flag = new Uint8Array(size);
  const found = new Uint8Array(size);
  const crab = new Uint8Array(size);
  const progressAt = new Float64Array(regions);
  let dugSafe = 0;
  let flags = 0;
  let foundCount = 0;
  let stings = 0;
  let hints = 0;
  let end: PatchEnd | null = null;
  let touched = false;
  /** Latest person's event per sender, for the wash guard. */
  const humanAt = new Map<string, number>();
  const queue = new Int32Array(Math.max(1, size));
  const depthOf = new Int32Array(size);

  const around = (i: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < nb.n[i]!; k++) out.push(nb.list[i * 8 + k]!);
    return out;
  };

  const nearDug = (i: number) => {
    for (let k = 0; k < nb.n[i]!; k++) if (dug[nb.list[i * 8 + k]!]) return true;
    return false;
  };

  /** Dig `start` and, through cells with no neighbours, everything they touch. */
  const open = (start: number, isCrab: boolean, out?: { cells: number[]; depth: number[] }) => {
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    depthOf[start] = 0;
    dug[start] = 1;
    dugSafe++;
    if (isCrab) crab[start] = 1;
    if (flag[start]) {
      flag[start] = 0;
      flags--;
    }
    while (head < tail) {
      const i = queue[head++]!;
      out?.cells.push(i);
      out?.depth.push(depthOf[i]!);
      if (board.count[i] !== 0) continue;
      for (let k = 0; k < nb.n[i]!; k++) {
        const j = nb.list[i * 8 + k]!;
        if (dug[j] || found[j] || board.bottle[j]) continue;
        dug[j] = 1;
        dugSafe++;
        if (flag[j]) {
          flag[j] = 0;
          flags--;
        }
        depthOf[j] = depthOf[i]! + 1;
        queue[tail++] = j;
      }
    }
  };

  const markProgress = (i: number, t: number) => {
    const g = regionOf(cols, opts.rw, i);
    if (t > progressAt[g]!) progressAt[g] = t;
  };

  const finish = (ev: Ev, why: PatchEnd["why"], fx?: (e: Effect) => void) => {
    end = { t: ev.t, why };
    const lifeguard: number[] = [];
    if (why === "clear") {
      for (let i = 0; i < size; i++) {
        if (board.bottle[i] && !found[i]) {
          found[i] = 2;
          foundCount++;
          lifeguard.push(i);
          if (flag[i]) {
            flag[i] = 0;
            flags--;
          }
        }
      }
    }
    fx?.({ kind: "end", ev, why, found: lifeguard });
  };

  const valid = (ev: Ev) => ev.c >= 0 && ev.c < size;

  const apply = (ev: Ev, fx?: (e: Effect) => void) => {
    if (end) return;
    if (ev.h && ev.k !== TIDE) {
      touched = true;
      humanAt.set(ev.s, ev.t);
    }
    const i = ev.c;
    switch (ev.k) {
      case DIG:
      case HINT: {
        if (dug[i] && ev.k === DIG && board.count[i] === 0) {
          // A blank cell at the edge of an opening: everything around it is safe, so dig it.
          const before = dugSafe;
          const out = fx ? { cells: [] as number[], depth: [] as number[] } : undefined;
          for (const j of around(i)) {
            if (dug[j] || found[j] || board.bottle[j]) continue;
            open(j, false, out);
          }
          if (dugSafe === before) return;
          markProgress(i, ev.t);
          if (out) fx?.({ kind: "dig", ev, cells: out.cells, depth: out.depth, crab: false });
          if (dugSafe === board.safe) finish(ev, "clear", fx);
          return;
        }
        if (dug[i] || found[i]) return;
        if (ev.k === DIG && flag[i]) return;
        if (board.bottle[i]) {
          if (ev.k === HINT) return;
          found[i] = 1;
          foundCount++;
          stings++;
          const covered: number[] = [];
          const c0 = i % cols;
          const r0 = Math.floor(i / cols);
          const rad = rules.sting;
          for (let r = Math.max(0, r0 - rad); r <= Math.min(rows - 1, r0 + rad); r++) {
            for (let c = Math.max(0, c0 - rad); c <= Math.min(cols - 1, c0 + rad); c++) {
              const j = r * cols + c;
              if (!dug[j]) continue;
              dug[j] = 0;
              crab[j] = 0;
              dugSafe--;
              covered.push(j);
            }
          }
          fx?.({ kind: "sting", ev, cell: i, covered });
          return;
        }
        if (ev.k === HINT) hints++;
        const out = fx ? { cells: [] as number[], depth: [] as number[] } : undefined;
        open(i, ev.k === HINT, out);
        markProgress(i, ev.t);
        if (out) fx?.({ kind: "dig", ev, cells: out.cells, depth: out.depth, crab: ev.k === HINT });
        if (dugSafe === board.safe) finish(ev, "clear", fx);
        return;
      }
      case FLAG: {
        if (!rules.flags || !canFlag(i)) return;
        flag[i] = 1;
        flags++;
        fx?.({ kind: "flag", ev, cell: i, on: true });
        return;
      }
      case UNFLAG: {
        if (!flag[i]) return;
        flag[i] = 0;
        flags--;
        fx?.({ kind: "flag", ev, cell: i, on: false });
        return;
      }
      case WASH: {
        // The idle timer waits longer for others than a visitor's own wash does.
        const guard = ev.h ? WASH_GUARD_MS : IDLE_GUARD_MS;
        for (const [s, t] of humanAt) {
          if (s !== ev.s && t > ev.t - guard) {
            fx?.({ kind: "refused", ev });
            return;
          }
        }
        finish(ev, "wash", fx);
        return;
      }
      case TIDE:
        finish(ev, "wash", fx);
    }
  };

  const canFlag = (i: number) =>
    i >= 0 &&
    i < size &&
    !dug[i] &&
    !found[i] &&
    !flag[i] &&
    nearDug(i) &&
    flags + foundCount < board.bottles;

  const resetState = () => {
    dug.fill(0);
    flag.fill(0);
    found.fill(0);
    crab.fill(0);
    progressAt.fill(opts.start);
    dugSafe = 0;
    flags = 0;
    foundCount = 0;
    stings = 0;
    hints = 0;
    end = null;
    touched = false;
    humanAt.clear();
    // An opening digs itself and the sand around it, but doesn't flood: blank cells at its edge
    // point visitors at safe sand, and their first tap there opens the stretch behind it.
    for (const o of board.openings) {
      for (const j of [o, ...around(o)]) {
        if (dug[j] || board.bottle[j]) continue;
        dug[j] = 1;
        dugSafe++;
      }
    }
    if (dugSafe === board.safe) end = { t: opts.start, why: "clear" };
  };

  const replay = () => {
    resetState();
    for (const e of events) apply(e);
  };

  resetState();

  const upper = (ev: Ev): number => {
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareEv(events[mid]!, ev) <= 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  /** Put an event in the log: "end" when it went last, "mid" when the log must be replayed. */
  const insert = (ev: Ev): "dup" | "full" | "bad" | "end" | "mid" => {
    if (!valid(ev) || !Number.isFinite(ev.t)) return "bad";
    const key = evKey(ev);
    if (keys.has(key)) return "dup";
    const wash = ev.k === WASH || ev.k === TIDE;
    if (wash && washes >= MAX_WASHES) return "full";
    const at = upper(ev);
    if (!wash && events.length - washes >= cap) {
      // The log keeps the earliest `cap` ordinary events, so every frame keeps the same ones.
      let last = events.length - 1;
      while (last >= 0 && (events[last]!.k === WASH || events[last]!.k === TIDE)) last--;
      if (last < 0 || at > last) return "full";
      const dropped = events.splice(last, 1)[0]!;
      keys.delete(evKey(dropped));
      hash = (hash ^ evHash(dropped)) >>> 0;
      events.splice(at, 0, ev);
      keys.add(key);
      hash = (hash ^ evHash(ev)) >>> 0;
      return "mid";
    }
    if (wash) washes++;
    keys.add(key);
    hash = (hash ^ evHash(ev)) >>> 0;
    if (at === events.length) {
      events.push(ev);
      return "end";
    }
    events.splice(at, 0, ev);
    return "mid";
  };

  return {
    board,
    dug,
    flag,
    found,
    crab,
    get dugSafe() {
      return dugSafe;
    },
    get flags() {
      return flags;
    },
    get foundCount() {
      return foundCount;
    },
    get stings() {
      return stings;
    },
    get hints() {
      return hints;
    },
    get end() {
      return end;
    },
    progressAt,
    get touched() {
      return touched;
    },
    events,
    get hash() {
      return hash;
    },
    flagsLeft: () => Math.max(0, board.bottles - flags - foundCount),
    progress: () => (board.safe > 0 ? dugSafe / board.safe : 1),
    canFlag,
    has: (ev) => keys.has(evKey(ev)),
    add(ev, fx) {
      const r = insert(ev);
      if (r === "end") {
        if (end) return "late";
        apply(ev, fx);
        return "applied";
      }
      if (r === "mid") {
        replay();
        fx?.({ kind: "replayed" });
        return "replayed";
      }
      return r;
    },
    addMany(evs, fx) {
      let added = 0;
      let again = false;
      for (const ev of evs) {
        const r = insert(ev);
        if (r === "end") {
          added++;
          if (!again && !end) apply(ev, fx);
        } else if (r === "mid") {
          added++;
          again = true;
        }
      }
      if (again) {
        replay();
        fx?.({ kind: "replayed" });
      }
      return added;
    },
  };
};

/** The visible beach in the form the solver reads. */
export const visibleOf = (p: Patch) => ({ dug: p.dug, count: p.board.count, found: p.found });

/** Order-independent summary of a patch's state, for tests and convergence checks. */
export const stateHash = (p: Patch): number => {
  let h = 2166136261;
  for (let i = 0; i < p.board.size; i++) {
    const v = p.dug[i]! | (p.flag[i]! << 1) | (p.found[i]! << 2);
    h = Math.imul(h ^ v, 16777619);
  }
  return (h ^ (p.end ? Math.round(p.end.t) : 0)) >>> 0;
};
