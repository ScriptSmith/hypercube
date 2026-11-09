/**
 * Goal cards for the `goals` variant. A card names its inputs (switches or buttons, pinned in
 * the bench's first child sockets) and the wanted value of one or two posts for every row of
 * inputs. The checker runs each row on a hidden copy of the circuit until it settles. Every card
 * has a known solution for each gate set, and `nextStep` plans how to reach it from any bench,
 * which the bots use to demonstrate cards.
 */
import {
  addPiece,
  type Circuit,
  cloneCircuit,
  connect,
  disconnect,
  KINDS,
  LIMITS,
  pieceById,
  type PieceKind,
  powered,
  removePiece,
  setOn,
  step,
} from "./circuit";

export type Src = { in: number } | { gate: number };
export type Dst = { gate: number; pin: number } | { post: number };
export interface RecipeWire {
  from: Src;
  to: Dst;
}
export interface Recipe {
  gates: PieceKind[];
  wires: RecipeWire[];
}

export interface GoalCard {
  id: string;
  /** Inputs left to right; the card draws them in the palette's first colours. */
  inputs: readonly ("switch" | "button")[];
  /** How many posts the card sets, from the left. */
  outputs: number;
  want(ins: readonly boolean[]): boolean[];
  solutions: { basic: Recipe; all: Recipe };
}

const a = { in: 0 };
const b = { in: 1 };
const g = (i: number): Src => ({ gate: i });
const gin = (i: number, pin = 0): Dst => ({ gate: i, pin });
const p = (i: number): Dst => ({ post: i });
const w = (from: Src, to: Dst): RecipeWire => ({ from, to });

/** XOR from basic gates: (A or B) and not (A and B), in gates 0 to 3. */
const BASIC_XOR: Recipe = {
  gates: ["or", "and", "not", "and"],
  wires: [
    w(a, gin(0, 0)),
    w(b, gin(0, 1)),
    w(a, gin(1, 0)),
    w(b, gin(1, 1)),
    w(g(1), gin(2)),
    w(g(0), gin(3, 0)),
    w(g(2), gin(3, 1)),
  ],
};

const same = (r: Recipe) => ({ basic: r, all: r });

/** The cards in order; after the last the first comes again. */
export const CARDS: readonly GoalCard[] = [
  {
    id: "copy",
    inputs: ["switch"],
    outputs: 1,
    want: ([x]) => [!!x],
    solutions: same({ gates: [], wires: [w(a, p(0))] }),
  },
  {
    id: "not",
    inputs: ["switch"],
    outputs: 1,
    want: ([x]) => [!x],
    solutions: same({ gates: ["not"], wires: [w(a, gin(0)), w(g(0), p(0))] }),
  },
  {
    id: "and",
    inputs: ["switch", "switch"],
    outputs: 1,
    want: ([x, y]) => [!!x && !!y],
    solutions: same({
      gates: ["and"],
      wires: [w(a, gin(0, 0)), w(b, gin(0, 1)), w(g(0), p(0))],
    }),
  },
  {
    id: "or",
    inputs: ["button", "button"],
    outputs: 1,
    want: ([x, y]) => [!!x || !!y],
    solutions: same({
      gates: ["or"],
      wires: [w(a, gin(0, 0)), w(b, gin(0, 1)), w(g(0), p(0))],
    }),
  },
  {
    id: "andnot",
    inputs: ["switch", "switch"],
    outputs: 1,
    want: ([x, y]) => [!!x && !y],
    solutions: same({
      gates: ["not", "and"],
      wires: [w(b, gin(0)), w(a, gin(1, 0)), w(g(0), gin(1, 1)), w(g(1), p(0))],
    }),
  },
  {
    id: "xor",
    inputs: ["switch", "switch"],
    outputs: 1,
    want: ([x, y]) => [!!x !== !!y],
    solutions: {
      basic: { gates: BASIC_XOR.gates, wires: [...BASIC_XOR.wires, w(g(3), p(0))] },
      all: { gates: ["xor"], wires: [w(a, gin(0, 0)), w(b, gin(0, 1)), w(g(0), p(0))] },
    },
  },
  {
    // A light on the stairs with a switch at each end: either switch changes it.
    id: "twoway",
    inputs: ["switch", "switch"],
    outputs: 1,
    want: ([x, y]) => [!!x === !!y],
    solutions: {
      basic: {
        gates: ["or", "not", "and", "or"],
        wires: [
          w(a, gin(0, 0)),
          w(b, gin(0, 1)),
          w(g(0), gin(1)),
          w(a, gin(2, 0)),
          w(b, gin(2, 1)),
          w(g(1), gin(3, 0)),
          w(g(2), gin(3, 1)),
          w(g(3), p(0)),
        ],
      },
      all: {
        gates: ["xor", "not"],
        wires: [w(a, gin(0, 0)), w(b, gin(0, 1)), w(g(0), gin(1)), w(g(1), p(0))],
      },
    },
  },
  {
    // Adds two one-bit numbers: the first post is the sum, the second the carry.
    id: "half",
    inputs: ["switch", "switch"],
    outputs: 2,
    want: ([x, y]) => [!!x !== !!y, !!x && !!y],
    solutions: {
      basic: {
        gates: BASIC_XOR.gates,
        wires: [...BASIC_XOR.wires, w(g(3), p(0)), w(g(1), p(1))],
      },
      all: {
        gates: ["xor", "and"],
        wires: [
          w(a, gin(0, 0)),
          w(b, gin(0, 1)),
          w(a, gin(1, 0)),
          w(b, gin(1, 1)),
          w(g(0), p(0)),
          w(g(1), p(1)),
        ],
      },
    },
  },
];

export interface Row {
  ins: boolean[];
  outs: boolean[];
}

/** Every combination of the card's inputs, counting up with the first input as the high bit. */
export const rowsOf = (card: GoalCard): Row[] => {
  const n = card.inputs.length;
  const rows: Row[] = [];
  for (let r = 0; r < 1 << n; r++) {
    const ins = Array.from({ length: n }, (_, i) => ((r >> (n - 1 - i)) & 1) === 1);
    rows.push({ ins, outs: card.want(ins) });
  }
  return rows;
};

/** Ticks to let a row settle: more than the longest chain of gates a bench can hold. */
export const SETTLE_TICKS = LIMITS.gate * 2 + 2;
/** Ticks the posts must then hold still, longer than a blinker's period. */
export const HOLD_TICKS = 7;

/**
 * The posts' values for one row of inputs on a hidden copy, or null if they never settle
 * (a loop or a blinker reaches them).
 */
export const runRow = (
  c: Circuit,
  inputs: readonly number[],
  posts: readonly number[],
  ins: readonly boolean[],
): boolean[] | null => {
  const k = cloneCircuit(c);
  inputs.forEach((id, i) => setOn(k, id, ins[i] ?? false));
  const read = () =>
    posts.map((id) => {
      const piece = pieceById(k, id);
      return piece ? powered(k, piece) : false;
    });
  for (let t = 0; t < SETTLE_TICKS; t++) step(k);
  const first = read();
  for (let t = 0; t < HOLD_TICKS; t++) {
    step(k);
    const now = read();
    if (now.some((v, i) => v !== first[i])) return null;
  }
  return first;
};

/** Which of the card's rows the circuit gets right. */
export const checkCard = (
  c: Circuit,
  card: GoalCard,
  inputs: readonly number[],
  posts: readonly number[],
): boolean[] =>
  rowsOf(card).map((row) => {
    const got = runRow(c, inputs, posts.slice(0, card.outputs), row.ins);
    return got !== null && row.outs.every((v, i) => got[i] === v);
  });

// ---- Planning towards a known solution ----------------------------------------------------------

export type Step =
  | { kind: "add"; gate: PieceKind; socket: number }
  | { kind: "remove"; piece: number }
  | { kind: "wire"; from: number; to: number; pin: number }
  | { kind: "unwire"; wire: number };

const COMMUTATIVE = new Set<PieceKind>(["and", "or", "xor"]);

export interface PlanContext {
  /** Piece ids of the card's inputs, in order. */
  inputs: readonly number[];
  /** Post ids, left to right. */
  posts: readonly number[];
  /** Adult sockets to put new gates in, in order of preference. */
  gateSockets: readonly number[];
}

/** Which bench gate stands for each of the recipe's gates. */
export const mapGates = (c: Circuit, recipe: Recipe): (number | null)[] => {
  const used = new Set<number>();
  const gates = c.pieces
    .filter((q) => KINDS[q.kind].group === "gate" && !q.pinned)
    .sort((x, y) => x.socket - y.socket);
  return recipe.gates.map((kind) => {
    const hit = gates.find((q) => q.kind === kind && !used.has(q.id));
    if (!hit) return null;
    used.add(hit.id);
    return hit.id;
  });
};

/**
 * The next change that brings the bench closer to the recipe, or null when it matches. Extra
 * gates go first, then wrong wires into the recipe's gates and posts, then missing gates, then
 * missing wires. Lamps and other extras that don't feed the recipe are left alone.
 */
export const nextStep = (c: Circuit, recipe: Recipe, ctx: PlanContext): Step | null => {
  const map = mapGates(c, recipe);
  const mapped = new Set(map.filter((id): id is number => id !== null));
  const extra = c.pieces.find(
    (q) => KINDS[q.kind].group === "gate" && !q.pinned && !mapped.has(q.id),
  );
  if (extra) return { kind: "remove", piece: extra.id };

  const srcId = (s: Src): number | null =>
    "in" in s ? (ctx.inputs[s.in] ?? null) : (map[s.gate] ?? null);
  const dstOf = (d: Dst): { id: number | null; pin: number } =>
    "post" in d
      ? { id: ctx.posts[d.post] ?? null, pin: 0 }
      : { id: map[d.gate] ?? null, pin: d.pin };

  // Wires each recipe target should receive, by target id.
  const wanted = new Map<number, { from: number; pin: number }[]>();
  for (const rw of recipe.wires) {
    const from = srcId(rw.from);
    const to = dstOf(rw.to);
    if (from === null || to.id === null) continue;
    const list = wanted.get(to.id) ?? [];
    list.push({ from, pin: to.pin });
    wanted.set(to.id, list);
  }
  const flexible = (id: number) => {
    const piece = pieceById(c, id);
    return piece ? COMMUTATIVE.has(piece.kind) : false;
  };

  // Each wire into a target must match its own wanted entry; duplicates count as wrong.
  for (const to of new Set([...wanted.keys(), ...mapped])) {
    const list = wanted.get(to) ?? [];
    const taken = new Set<number>();
    const into = c.wires.filter((x) => x.to === to).sort((x, y) => x.pin - y.pin);
    for (const wire of into) {
      const i = list.findIndex(
        (x, k) => !taken.has(k) && x.from === wire.from && (flexible(to) || x.pin === wire.pin),
      );
      if (i < 0) return { kind: "unwire", wire: wire.id };
      taken.add(i);
    }
  }

  for (let i = 0; i < recipe.gates.length; i++) {
    if (map[i] !== null) continue;
    const kind = recipe.gates[i]!;
    const socket = ctx.gateSockets.find(
      (s) => c.sockets[s] === "adult" && !c.pieces.some((q) => q.socket === s),
    );
    if (socket === undefined) return null;
    return { kind: "add", gate: kind, socket };
  }

  for (const [to, list] of wanted) {
    const into = c.wires.filter((x) => x.to === to);
    const matched = new Set<number>();
    for (const want of list) {
      const have = into.find(
        (x) => !matched.has(x.id) && x.from === want.from && (flexible(to) || x.pin === want.pin),
      );
      if (have) {
        matched.add(have.id);
        continue;
      }
      let pin = want.pin;
      if (flexible(to)) {
        const piece = pieceById(c, to);
        const free = [];
        for (let k = 0; k < (piece ? KINDS[piece.kind].inputs : 0); k++) {
          if (!c.wires.some((x) => x.to === to && x.pin === k)) free.push(k);
        }
        pin = free.includes(want.pin) ? want.pin : (free[0] ?? want.pin);
      }
      // Too many wires from this source elsewhere: free one that feeds something outside the plan.
      const out = c.wires.filter((x) => x.from === want.from);
      if (out.length >= LIMITS.fanout || c.wires.length >= LIMITS.wires) {
        const spare = out.find((x) => !wanted.has(x.to)) ?? c.wires.find((x) => !wanted.has(x.to));
        if (spare) return { kind: "unwire", wire: spare.id };
        return null;
      }
      return { kind: "wire", from: want.from, to, pin };
    }
  }
  return null;
};

/** Apply one planned step to a circuit directly (tests, and a bench with no hands). */
export const applyStep = (c: Circuit, s: Step): boolean => {
  switch (s.kind) {
    case "add":
      return addPiece(c, s.gate, s.socket) !== null;
    case "remove":
      return removePiece(c, s.piece);
    case "wire":
      return connect(c, s.from, s.to, s.pin) !== null;
    case "unwire":
      return disconnect(c, s.wire);
  }
};

/** Inputs pinned for a card, in child sockets chosen by the layout. Returns their ids. */
export const placeCardInputs = (
  c: Circuit,
  card: GoalCard,
  sockets: readonly number[],
): number[] => {
  const ids: number[] = [];
  card.inputs.forEach((kind, i) => {
    const s = sockets[i];
    if (s === undefined) return;
    const piece = addPiece(c, kind, s, true);
    if (piece) {
      piece.hue = i;
      ids.push(piece.id);
    }
  });
  return ids;
};
