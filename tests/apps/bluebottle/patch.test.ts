import { describe, expect, it } from "vitest";
import { distance, regionOf } from "../../../src/apps/bluebottle/board";
import { IDLE_GUARD_MS, WASH_GUARD_MS } from "../../../src/apps/bluebottle/config";
import { crabTarget } from "../../../src/apps/bluebottle/crab";
import { generate } from "../../../src/apps/bluebottle/generate";
import {
  compareEv,
  createPatch,
  DIG,
  type Ev,
  FLAG,
  HINT,
  type Kind,
  type Patch,
  type PatchRules,
  stateHash,
  TIDE,
  UNFLAG,
  visibleOf,
  WASH,
} from "../../../src/apps/bluebottle/patch";
import { createSolver } from "../../../src/apps/bluebottle/solver";
import { boardOf, rngOf, specOf } from "./helpers";

const RULES: PatchRules = { sting: 1, flags: true };

let q = 0;
const ev = (k: Kind, c: number, t: number, s = "a", h = true): Ev => ({ k, c, t, s, q: ++q, h });

const snapshot = (p: Patch) => ({
  hash: stateHash(p),
  dug: [...p.dug],
  flag: [...p.flag],
  found: [...p.found],
  end: p.end,
  stings: p.stings,
  hints: p.hints,
  flags: p.flags,
  dugSafe: p.dugSafe,
});

/** A random session from three frames: digs (some sting), flags, unflags, crab hints, washes. */
const session = (seed: string, p: Patch, n: number): Ev[] => {
  const rng = rngOf(seed);
  const out: Ev[] = [];
  const senders = ["a", "b", "c"];
  for (let i = 0; i < n; i++) {
    const r = rng.next();
    let c = rng.int(p.board.size);
    const k: Kind = r < 0.6 ? DIG : r < 0.75 ? FLAG : r < 0.85 ? UNFLAG : r < 0.985 ? HINT : WASH;
    if (k === HINT) while (p.board.bottle[c]) c = rng.int(p.board.size);
    // Pairs of events share a time, so ties fall back to sender and sequence.
    const t = 1000 + Math.floor(i / 2) * 40 + (rng.next() < 0.3 ? 0 : rng.int(30));
    out.push({ k, c, t, s: senders[rng.int(3)]!, q: i + 1, h: rng.next() < 0.8 });
  }
  return out;
};

describe("patch replay", () => {
  it("reaches the same beach whatever order the events arrive in", () => {
    for (let trial = 0; trial < 80; trial++) {
      const rng = rngOf(`order${trial}`);
      const spec = specOf(16 + 8 * rng.int(3), 11, 6, "normal", trial + 1, 9);
      const board = generate(spec);
      const rules: PatchRules = { sting: 1 + rng.int(2), flags: true };
      const make = () => createPatch(board, rules, { start: 0, rw: spec.rw });
      const a = make();
      const evs = session(`s${trial}`, a, 30 + rng.int(200));
      for (const e of [...evs].sort(compareEv)) a.add(e);

      const b = make();
      const shuffled = [...evs];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      for (const e of shuffled) b.add(e);
      // Duplicates change nothing.
      for (const e of shuffled.slice(0, 10)) expect(b.add(e)).toBe("dup");

      const c = make();
      for (let i = 0; i < shuffled.length; i += 25) c.addMany(shuffled.slice(i, i + 25));

      expect(snapshot(b), `trial ${trial}`).toEqual(snapshot(a));
      expect(snapshot(c), `trial ${trial}`).toEqual(snapshot(a));
      expect(b.hash).toBe(a.hash);
      expect(c.hash).toBe(a.hash);
    }
  });

  it("starts with each opening and its neighbours dug, without flooding", () => {
    const b = boardOf(["o.....", "......", ".....*"]);
    const p = createPatch(b, RULES, { start: 0, rw: 8 });
    expect([...p.dug]).toEqual([1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(p.end).toBeNull();
    // A tap on a blank cell at the clearing's edge floods everything it touches.
    p.add(ev(DIG, 1, 10));
    expect(p.dugSafe).toBe(b.safe);
    expect(p.end?.why).toBe("clear");
  });

  it("finds the hidden bluebottles for the group when the patch clears", () => {
    const b = boardOf(["o.*", "...", "*.."]);
    const p = createPatch(b, RULES, { start: 0, rw: 8 });
    for (let i = 0; i < b.size; i++) if (!b.bottle[i] && !p.dug[i]) p.add(ev(DIG, i, 10 + i));
    expect(p.end?.why).toBe("clear");
    expect(p.found[2]).toBe(2);
    expect(p.found[6]).toBe(2);
    expect(p.foundCount).toBe(2);
  });
});

describe("stings", () => {
  for (const radius of [1, 2]) {
    it(`cover again exactly the dug sand within ${radius} of the bluebottle`, () => {
      const rng = rngOf(`sting${radius}`);
      for (let trial = 0; trial < 40; trial++) {
        const spec = specOf(24, 11, 6, "normal", trial + 1, 31);
        const board = generate(spec);
        const p = createPatch(board, { sting: radius, flags: true }, { start: 0, rw: spec.rw });
        // Dig a good part of the beach first.
        for (let i = 0; i < board.size; i++)
          if (!board.bottle[i] && rng.next() < 0.5) p.add(ev(HINT, i, 100 + i));
        if (p.end) continue;
        const hidden = [...board.bottle.keys()].filter((i) => board.bottle[i] && !p.found[i]);
        const target = hidden[rng.int(hidden.length)]!;
        const before = [...p.dug];
        p.add(ev(DIG, target, 10_000));
        expect(p.found[target]).toBe(1);
        expect(p.stings).toBe(1);
        for (let i = 0; i < board.size; i++) {
          const near = distance(board.cols, i, target) <= radius;
          if (near) expect(p.dug[i], `cell ${i}`).toBe(0);
          else expect(p.dug[i], `cell ${i}`).toBe(before[i]);
        }
      }
    });
  }

  it("never end a patch", () => {
    const board = generate(specOf(8, 11, 6, "hard", 2, 2));
    const p = createPatch(board, RULES, { start: 0, rw: 8 });
    for (let i = 0; i < board.size; i++) if (board.bottle[i]) p.add(ev(DIG, i, 10 + i));
    expect(p.end).toBeNull();
    expect(p.foundCount).toBe(board.bottles);
  });

  it("are never caused by a crab", () => {
    const board = generate(specOf(8, 11, 6, "hard", 3, 2));
    const p = createPatch(board, RULES, { start: 0, rw: 8 });
    const at = [...board.bottle.keys()].find((i) => board.bottle[i])!;
    p.add(ev(HINT, at, 10));
    expect(p.stings).toBe(0);
    expect(p.found[at]).toBe(0);
  });
});

describe("flags", () => {
  it("go only on covered sand next to dug sand, one per bluebottle", () => {
    const board = generate(specOf(16, 11, 6, "normal", 4, 8));
    const p = createPatch(board, RULES, { start: 0, rw: 8 });
    const far = [...board.bottle.keys()].find((i) => {
      if (p.dug[i]) return false;
      return !p.canFlag(i);
    });
    if (far !== undefined) {
      p.add(ev(FLAG, far, 5));
      expect(p.flag[far]).toBe(0);
    }
    const edge = [...board.bottle.keys()].filter((i) => p.canFlag(i));
    let placed = 0;
    for (const [k, i] of edge.entries()) {
      p.add(ev(FLAG, i, 10 + k));
      if (p.flag[i]) placed++;
    }
    expect(p.flags).toBe(Math.min(edge.length, board.bottles));
    expect(placed).toBe(p.flags);
    expect(p.flagsLeft()).toBe(board.bottles - p.flags);
    // A tap on a flag never digs it; lifting it does.
    const one = edge.find((i) => p.flag[i])!;
    p.add(ev(DIG, one, 1000));
    expect(p.dug[one]).toBe(0);
    p.add(ev(UNFLAG, one, 1001));
    expect(p.flag[one]).toBe(0);
  });

  it("stop when every bluebottle has a flag or has been found", () => {
    const b = boardOf(["o..*", "....", "*..."]);
    const p = createPatch(b, RULES, { start: 0, rw: 8 });
    const cand = [...Array(b.size).keys()].filter((i) => p.canFlag(i));
    for (const [k, i] of cand.entries()) p.add(ev(FLAG, i, 10 + k));
    expect(p.flags).toBeLessThanOrEqual(b.bottles);
  });

  it("are switched off by the flags option", () => {
    const board = generate(specOf(8, 11, 6, "normal", 5, 8));
    const p = createPatch(board, { sting: 1, flags: false }, { start: 0, rw: 8 });
    const i = [...board.bottle.keys()].find((c) => p.canFlag(c));
    if (i !== undefined) p.add(ev(FLAG, i, 10));
    expect(p.flags).toBe(0);
  });
});

describe("washes", () => {
  it("are refused while another frame's visitors are digging", () => {
    const board = generate(specOf(16, 11, 6, "normal", 6, 8));
    const p = createPatch(board, RULES, { start: 0, rw: 8 });
    const safe = [...board.bottle.keys()].filter((i) => !board.bottle[i] && !p.dug[i]);
    p.add(ev(DIG, safe[0]!, 1000, "b", true));
    p.add(ev(WASH, 0, 1000 + WASH_GUARD_MS - 1, "a", true));
    expect(p.end).toBeNull();
    // Its own visitors and bots don't hold it up.
    p.add(ev(DIG, safe[1]!, 1000 + WASH_GUARD_MS, "a", true));
    p.add(ev(DIG, safe[2]!, 1000 + WASH_GUARD_MS, "b", false));
    p.add(ev(WASH, 0, 1001 + WASH_GUARD_MS, "a", true));
    expect(p.end?.why).toBe("wash");
  });

  it("from an idle frame wait longer for others to finish", () => {
    const board = generate(specOf(16, 11, 6, "normal", 8, 8));
    const p = createPatch(board, RULES, { start: 0, rw: 8 });
    const safe = [...board.bottle.keys()].filter((i) => !board.bottle[i] && !p.dug[i]);
    p.add(ev(DIG, safe[0]!, 1000, "b", true));
    p.add(ev(WASH, 0, 1000 + WASH_GUARD_MS + 1, "a", false));
    expect(p.end).toBeNull();
    p.add(ev(WASH, 0, 1000 + IDLE_GUARD_MS + 1, "a", false));
    expect(p.end?.why).toBe("wash");
  });

  it("from admin are never refused", () => {
    const board = generate(specOf(16, 11, 6, "normal", 7, 8));
    const p = createPatch(board, RULES, { start: 0, rw: 8 });
    const safe = [...board.bottle.keys()].filter((i) => !board.bottle[i] && !p.dug[i]);
    p.add(ev(DIG, safe[0]!, 1000, "b", true));
    p.add(ev(TIDE, 0, 1001, "a", false));
    expect(p.end?.why).toBe("wash");
  });
});

describe("the log", () => {
  it("keeps the earliest events when full, the same on every frame", () => {
    const board = generate(specOf(8, 3, 2, "easy", 1, 1));
    const make = () => createPatch(board, RULES, { start: 0, rw: 8 });
    const a = make();
    const b = make();
    const rng = rngOf("cap");
    const evs: Ev[] = [];
    for (let i = 0; i < 400; i++)
      evs.push(ev(rng.next() < 0.5 ? FLAG : UNFLAG, rng.int(24), i * 3));
    for (const e of evs) a.add(e);
    for (const e of [...evs].reverse()) b.add(e);
    expect(a.events.length).toBe(Math.max(64, 24 * 4));
    expect(b.events.map((e) => `${e.s}${e.q}`)).toEqual(a.events.map((e) => `${e.s}${e.q}`));
    expect(stateHash(b)).toBe(stateHash(a));
  });
});

describe("crabs", () => {
  it("always find covered safe sand while any is left, and never a bluebottle", () => {
    const rng = rngOf("crab");
    for (let trial = 0; trial < 60; trial++) {
      const spec = specOf(24, 11, 6, "hard", trial + 1, 12);
      const board = generate(spec);
      const p = createPatch(board, { sting: 2, flags: true }, { start: 0, rw: spec.rw });
      const solver = createSolver(spec.cols, spec.rows);
      let t = 10;
      for (let step = 0; step < 400 && !p.end; step++) {
        // Visitors dig at random, stinging often, and crabs keep the beach moving.
        if (rng.next() < 0.4) p.add(ev(DIG, rng.int(board.size), t++));
        const g = rng.int(3);
        const ded = rng.next() < 0.5 ? solver.deduce(visibleOf(p)).safe : null;
        const target = crabTarget(p, g, spec.rw, ded, step);
        let left = 0;
        for (let i = 0; i < board.size; i++)
          if (!p.dug[i] && !board.bottle[i] && regionOf(spec.cols, spec.rw, i) === g) left++;
        if (left === 0) {
          expect(target).toBe(-1);
          continue;
        }
        expect(target).toBeGreaterThanOrEqual(0);
        expect(board.bottle[target]).toBe(0);
        expect(p.dug[target]).toBe(0);
        expect(regionOf(spec.cols, spec.rw, target)).toBe(g);
        p.add(ev(HINT, target, t++, "leader", false));
      }
      expect(p.end?.why, `trial ${trial}`).toBe("clear");
    }
  });

  it("prefer what the solver can deduce", () => {
    const board = generate(specOf(16, 11, 6, "normal", 9, 12));
    const p = createPatch(board, RULES, { start: 0, rw: 8 });
    const ded = createSolver(16, 11).deduce(visibleOf(p)).safe;
    const inRegion = ded.filter((i) => regionOf(16, 8, i) === 0);
    if (inRegion.length > 0) expect(inRegion).toContain(crabTarget(p, 0, 8, ded, 1));
  });
});
