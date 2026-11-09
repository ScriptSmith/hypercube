import { describe, expect, it } from "vitest";
import {
  ALL_GATES,
  BASIC_GATES,
  type Circuit,
  createCircuit,
  KINDS,
  postsOf,
  validate,
} from "../../../src/apps/logic/circuit";
import {
  applyStep,
  CARDS,
  checkCard,
  type GoalCard,
  nextStep,
  placeCardInputs,
  type Recipe,
  rowsOf,
  runRow,
} from "../../../src/apps/logic/goals";
import { addPiece, connect, setOn } from "../../../src/apps/logic/circuit";
import { KINDS as FRAMES, layoutOf } from "./helpers";

interface Built {
  c: Circuit;
  inputs: number[];
  posts: number[];
  gateSockets: number[];
}

/** A card's starting circuit on a real bench layout. */
const start = (card: GoalCard, kind: (typeof FRAMES)[number] = "pair", benches = 1): Built => {
  const l = layoutOf(kind, { goals: true, benches, posts: Array(benches).fill(3) }).benches[0]!;
  const c = createCircuit(l.sockets.map((s) => s.band));
  const inputs = placeCardInputs(c, card, l.goalSockets);
  return { c, inputs, posts: postsOf(c).map((p) => p.id), gateSockets: l.gateSockets };
};

/** Follow the planner from `b` to the recipe; returns how many steps it took. */
const solve = (b: Built, recipe: Recipe): number => {
  let n = 0;
  for (; n < 80; n++) {
    const s = nextStep(b.c, recipe, b);
    if (!s) return n;
    expect(applyStep(b.c, s), JSON.stringify(s)).toBe(true);
  }
  throw new Error("planner did not finish");
};

describe("logic goal cards", () => {
  it("has rows for every combination of inputs, high bit first", () => {
    const and = CARDS.find((c) => c.id === "and")!;
    expect(rowsOf(and)).toEqual([
      { ins: [false, false], outs: [false] },
      { ins: [false, true], outs: [false] },
      { ins: [true, false], outs: [false] },
      { ins: [true, true], outs: [true] },
    ]);
    const half = CARDS.find((c) => c.id === "half")!;
    expect(rowsOf(half).map((r) => r.outs)).toEqual([
      [false, false],
      [true, false],
      [true, false],
      [false, true],
    ]);
  });

  it("ramps from one wire to the half adder and uses at most two posts", () => {
    expect(CARDS[0]!.id).toBe("copy");
    expect(CARDS[CARDS.length - 1]!.id).toBe("half");
    for (const card of CARDS) {
      expect(card.outputs).toBeGreaterThanOrEqual(1);
      expect(card.outputs).toBeLessThanOrEqual(2);
      expect(card.inputs.length).toBeLessThanOrEqual(3);
    }
  });

  for (const card of CARDS) {
    for (const set of ["basic", "all"] as const) {
      it(`card ${card.id} is solvable with ${set} gates, and only its solution passes`, () => {
        const recipe = card.solutions[set];
        const allowed = set === "basic" ? BASIC_GATES : ALL_GATES;
        for (const g of recipe.gates) expect(allowed).toContain(g);
        // It fits on the smallest bench of every frame.
        for (const kind of FRAMES) {
          const benches = kind === "wall" ? 3 : 1;
          const l = layoutOf(kind, { goals: true, benches }).benches[0]!;
          expect(recipe.gates.length).toBeLessThanOrEqual(l.gateSockets.length);
        }
        const b = start(card);
        expect(checkCard(b.c, card, b.inputs, b.posts).every(Boolean)).toBe(false);
        solve(b, recipe);
        expect(validate(b.c)).toEqual([]);
        expect(checkCard(b.c, card, b.inputs, b.posts)).toEqual(rowsOf(card).map(() => true));
      });
    }
  }

  it("rejects a circuit that blinks at the post", () => {
    const card = CARDS.find((c) => c.id === "copy")!;
    const b = start(card);
    const blink = addPiece(b.c, "blinker", b.gateSockets[0]!)!;
    connect(b.c, blink.id, b.posts[0]!, 0);
    expect(runRow(b.c, b.inputs, b.posts.slice(0, 1), [true])).toBeNull();
    expect(checkCard(b.c, card, b.inputs, b.posts)).toEqual([false, false]);
  });

  it("tests rows on a hidden copy, leaving the bench as it was", () => {
    const card = CARDS.find((c) => c.id === "and")!;
    const b = start(card);
    solve(b, card.solutions.all);
    setOn(b.c, b.inputs[0]!, true);
    const before = JSON.stringify(b.c);
    checkCard(b.c, card, b.inputs, b.posts);
    expect(JSON.stringify(b.c)).toBe(before);
  });

  it("plans from a messy bench: wrong gates out, wrong wires off, then the solution", () => {
    const card = CARDS.find((c) => c.id === "xor")!;
    const b = start(card);
    const s = b.gateSockets;
    const or = addPiece(b.c, "or", s[0]!)!;
    const not = addPiece(b.c, "not", s[1]!)!;
    addPiece(b.c, "blinker", s[2]!);
    connect(b.c, b.inputs[0]!, or.id, 0);
    connect(b.c, b.inputs[0]!, or.id, 1);
    connect(b.c, not.id, b.posts[0]!, 0);
    const lamp = addPiece(b.c, "lamp", 7)!;
    connect(b.c, b.inputs[1]!, lamp.id, 0);
    const steps = solve(b, card.solutions.basic);
    expect(steps).toBeGreaterThan(4);
    expect(checkCard(b.c, card, b.inputs, b.posts).every(Boolean)).toBe(true);
    // The extra lamp was left alone.
    expect(b.c.pieces.some((p) => p.id === lamp.id)).toBe(true);
    expect(b.c.pieces.filter((p) => KINDS[p.kind].group === "gate")).toHaveLength(4);
  });

  it("accepts swapped inputs on AND, OR and XOR", () => {
    const card = CARDS.find((c) => c.id === "and")!;
    const b = start(card);
    const and = addPiece(b.c, "and", b.gateSockets[0]!)!;
    connect(b.c, b.inputs[1]!, and.id, 0);
    connect(b.c, b.inputs[0]!, and.id, 1);
    connect(b.c, and.id, b.posts[0]!, 0);
    expect(nextStep(b.c, card.solutions.all, b)).toBeNull();
    expect(checkCard(b.c, card, b.inputs, b.posts).every(Boolean)).toBe(true);
  });

  it("pins a card's inputs in the layout's goal sockets in the card's colours", () => {
    for (const card of CARDS) {
      const b = start(card, "wall", 3);
      expect(b.inputs).toHaveLength(card.inputs.length);
      b.inputs.forEach((id, i) => {
        const p = b.c.pieces.find((q) => q.id === id)!;
        expect(p.pinned).toBe(true);
        expect(p.kind).toBe(card.inputs[i]);
        expect(p.hue).toBe(i);
      });
    }
  });
});
