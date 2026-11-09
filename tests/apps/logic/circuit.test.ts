import { describe, expect, it } from "vitest";
import {
  addError,
  addPiece,
  BLINK_TICKS,
  type Circuit,
  clearCircuit,
  cloneCircuit,
  connect,
  countGroup,
  createCircuit,
  disconnect,
  fanout,
  freePins,
  gateOut,
  LIMITS,
  movePiece,
  pieceById,
  type PieceKind,
  pieceCount,
  postsOf,
  powered,
  removePiece,
  replug,
  setOn,
  step,
  TICK_MS,
  validate,
  wireError,
} from "../../../src/apps/logic/circuit";
import { SOCKETS } from "./helpers";

const CHILD = [0, 1, 2, 3, 4, 5, 6, 7];
const ADULT = [8, 9, 10, 11, 12, 13];

const fresh = () => createCircuit(SOCKETS);

/** Run a gate with both inputs from switches and read its output after one tick. */
const truth = (kind: PieceKind, a: boolean, b: boolean): boolean => {
  const c = fresh();
  const sa = addPiece(c, "switch", 0)!;
  const sb = addPiece(c, "switch", 1)!;
  const g = addPiece(c, kind, 8)!;
  connect(c, sa.id, g.id, 0);
  if (kind !== "not") connect(c, sb.id, g.id, 1);
  setOn(c, sa.id, a);
  setOn(c, sb.id, b);
  step(c);
  return g.out;
};

describe("logic circuit", () => {
  it("starts with a pinned post in every post socket and nothing else", () => {
    const c = fresh();
    expect(c.pieces.map((p) => p.kind)).toEqual(["post", "post", "post"]);
    expect(c.pieces.every((p) => p.pinned)).toBe(true);
    expect(pieceCount(c)).toBe(0);
    expect(postsOf(c).map((p) => p.socket)).toEqual([14, 15, 16]);
    expect(removePiece(c, c.pieces[0]!.id)).toBe(false);
  });

  it("has the usual truth tables", () => {
    const rows: [boolean, boolean][] = [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ];
    expect(rows.map(([a, b]) => truth("and", a, b))).toEqual([false, false, false, true]);
    expect(rows.map(([a, b]) => truth("or", a, b))).toEqual([false, true, true, true]);
    expect(rows.map(([a, b]) => truth("xor", a, b))).toEqual([false, true, true, false]);
    expect(rows.map(([a]) => truth("not", a, false))).toEqual([true, true, false, false]);
    expect(gateOut("lamp", true, true, 0)).toBe(false);
  });

  it("reads unwired inputs as off", () => {
    const c = fresh();
    const not = addPiece(c, "not", 8)!;
    const and = addPiece(c, "and", 9)!;
    const or = addPiece(c, "or", 10)!;
    step(c);
    expect(not.out).toBe(true);
    expect(and.out).toBe(false);
    expect(or.out).toBe(false);
  });

  it("changes a gate only on a tick, one tick per gate along a chain", () => {
    const c = fresh();
    const s = addPiece(c, "switch", 0)!;
    const lamp = addPiece(c, "lamp", 1)!;
    const g1 = addPiece(c, "not", 8)!;
    const g2 = addPiece(c, "not", 9)!;
    const g3 = addPiece(c, "not", 10)!;
    connect(c, s.id, g1.id, 0);
    connect(c, g1.id, g2.id, 0);
    connect(c, g2.id, g3.id, 0);
    connect(c, g3.id, lamp.id, 0);
    // Settle with the switch off: NOT NOT NOT off = on.
    for (let i = 0; i < 5; i++) step(c);
    expect(powered(c, lamp)).toBe(true);
    setOn(c, s.id, true);
    // The switch itself changes at once; the gates don't until the ticks come.
    expect(s.out).toBe(true);
    expect(g1.out).toBe(true);
    step(c);
    expect([g1.out, g2.out, g3.out]).toEqual([false, false, true]);
    step(c);
    expect([g1.out, g2.out, g3.out]).toEqual([false, true, true]);
    step(c);
    expect([g1.out, g2.out, g3.out]).toEqual([false, true, false]);
    expect(powered(c, lamp)).toBe(false);
    expect(TICK_MS).toBe(200);
  });

  it("lights a lamp wired straight to a switch at once, with no tick", () => {
    const c = fresh();
    const s = addPiece(c, "switch", 0)!;
    const lamp = addPiece(c, "lamp", 1)!;
    connect(c, s.id, lamp.id, 0);
    setOn(c, s.id, true);
    expect(powered(c, lamp)).toBe(true);
    setOn(c, s.id, false);
    expect(powered(c, lamp)).toBe(false);
  });

  it("blinks a NOT wired to itself at 2.5 Hz, and a ring of NOTs no faster", () => {
    const c = fresh();
    const not = addPiece(c, "not", 8)!;
    expect(connect(c, not.id, not.id, 0)).not.toBeNull();
    const seen: boolean[] = [];
    for (let i = 0; i < 20; i++) {
      step(c);
      seen.push(not.out);
    }
    // It changes every tick: 200 ms on, 200 ms off, so 400 ms a cycle.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBe(!seen[i - 1]);
    const hz = 1000 / (2 * TICK_MS);
    expect(hz).toBe(2.5);

    const r = fresh();
    const a = addPiece(r, "not", 8)!;
    const b = addPiece(r, "not", 9)!;
    const d = addPiece(r, "not", 10)!;
    connect(r, a.id, b.id, 0);
    connect(r, b.id, d.id, 0);
    connect(r, d.id, a.id, 0);
    const outs: boolean[] = [];
    for (let i = 0; i < 40; i++) {
      step(r);
      outs.push(a.out);
    }
    let changes = 0;
    for (let i = 1; i < outs.length; i++) if (outs[i] !== outs[i - 1]) changes++;
    // A ring changes at most once a tick (it starts in step, so it does exactly that).
    expect(changes).toBeGreaterThan(0);
    expect(changes).toBeLessThanOrEqual(outs.length - 1);
  });

  it("never changes any gate output twice within one tick, whatever is wired", () => {
    const c = fresh();
    const kinds: PieceKind[] = ["not", "xor", "and", "or", "xor", "blinker"];
    const gates = kinds.map((k, i) => addPiece(c, k, ADULT[i]!)!);
    const s = addPiece(c, "switch", 0)!;
    // A tangle of loops.
    connect(c, gates[0]!.id, gates[1]!.id, 0);
    connect(c, gates[1]!.id, gates[0]!.id, 0);
    connect(c, s.id, gates[1]!.id, 1);
    connect(c, gates[1]!.id, gates[2]!.id, 0);
    connect(c, gates[5]!.id, gates[2]!.id, 1);
    connect(c, gates[2]!.id, gates[3]!.id, 0);
    connect(c, gates[3]!.id, gates[4]!.id, 0);
    connect(c, gates[4]!.id, gates[3]!.id, 1);
    let last = gates.map((g) => g.out);
    for (let i = 0; i < 60; i++) {
      if (i % 7 === 0) setOn(c, s.id, !s.on);
      const before = gates.map((g) => g.out);
      expect(before).toEqual(last);
      step(c);
      last = gates.map((g) => g.out);
    }
  });

  it("blinks the blinker about once a second", () => {
    const c = fresh();
    const b = addPiece(c, "blinker", 8)!;
    const outs: boolean[] = [];
    for (let i = 0; i < 24; i++) {
      step(c);
      outs.push(b.out);
    }
    expect(outs.slice(0, 12)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    const period = 2 * BLINK_TICKS * TICK_MS;
    expect(period).toBeGreaterThanOrEqual(800);
    expect(period).toBeLessThanOrEqual(1500);
  });

  it("puts pieces only in free sockets of their own band", () => {
    const c = fresh();
    expect(addPiece(c, "and", 0)).toBeNull();
    expect(addPiece(c, "lamp", 8)).toBeNull();
    expect(addPiece(c, "switch", 14)).toBeNull();
    expect(addPiece(c, "post", 0)).toBeNull();
    expect(addPiece(c, "switch", 99)).toBeNull();
    const s = addPiece(c, "switch", 0)!;
    expect(addPiece(c, "lamp", 0)).toBeNull();
    expect(movePiece(c, s.id, 8)).toBe(false);
    expect(movePiece(c, s.id, 3)).toBe(true);
    expect(s.socket).toBe(3);
    expect(addPiece(c, "lamp", 0)).not.toBeNull();
    expect(validate(c)).toEqual([]);
  });

  it("refuses pieces over the limits", () => {
    const c = fresh();
    for (let i = 0; i < 4; i++) expect(addPiece(c, "switch", CHILD[i]!)).not.toBeNull();
    expect(addError(c, "switch")).toBe("source");
    expect(addError(c, "button")).toBe("source");
    expect(addPiece(c, "button", 4)).toBeNull();
    for (let i = 4; i < 8; i++) expect(addPiece(c, "lamp", CHILD[i]!)).not.toBeNull();
    expect(addError(c, "bell")).toBe("sink");
    for (const s of ADULT) expect(addPiece(c, "or", s)).not.toBeNull();
    expect(countGroup(c, "gate")).toBe(LIMITS.gate);
    expect(pieceCount(c)).toBe(LIMITS.pieces);
    expect(addError(c, "not")).toBe("pieces");
    expect(validate(c)).toEqual([]);
  });

  it("counts the six-gate limit on gates and blinkers together", () => {
    const sockets = [...Array(8).fill("adult"), "post"] as const;
    const c = createCircuit([...sockets]);
    for (let i = 0; i < 3; i++) addPiece(c, "blinker", i);
    for (let i = 3; i < 6; i++) addPiece(c, "and", i);
    expect(addError(c, "not")).toBe("gate");
    expect(addPiece(c, "not", 6)).toBeNull();
  });

  it("refuses wires over the limits and into busy or missing ports", () => {
    const c = fresh();
    const s = addPiece(c, "switch", 0)!;
    const lamp = addPiece(c, "lamp", 1)!;
    const gates = ADULT.map((sock) => addPiece(c, "and", sock)!);
    expect(wireError(c, lamp.id, s.id, 0)).toBe("port");
    expect(wireError(c, s.id, lamp.id, 1)).toBe("port");
    expect(wireError(c, s.id, 999, 0)).toBe("missing");
    expect(connect(c, s.id, lamp.id, 0)).not.toBeNull();
    expect(wireError(c, s.id, lamp.id, 0)).toBe("taken");
    // A fanout of four from the switch.
    for (let i = 0; i < 3; i++) expect(connect(c, s.id, gates[i]!.id, 0)).not.toBeNull();
    expect(fanout(c, s.id)).toBe(LIMITS.fanout);
    expect(wireError(c, s.id, gates[3]!.id, 0)).toBe("fanout");
    // Fill to the wire limit.
    let made = c.wires.length;
    for (const from of gates) {
      for (const to of gates) {
        for (const pin of [0, 1]) {
          if (made >= LIMITS.wires) break;
          if (connect(c, from.id, to.id, pin)) made++;
        }
      }
    }
    const a = addPiece(c, "lamp", 2)!;
    expect(c.wires.length).toBeLessThanOrEqual(LIMITS.wires);
    if (c.wires.length === LIMITS.wires) {
      const spare = gates.find((g) => fanout(c, g.id) < LIMITS.fanout);
      if (spare) expect(wireError(c, spare.id, a.id, 0)).toBe("wires");
    }
    expect(validate(c)).toEqual([]);
  });

  it("takes a piece's wires with it when it goes", () => {
    const c = fresh();
    const s = addPiece(c, "switch", 0)!;
    const lamp = addPiece(c, "lamp", 1)!;
    const g = addPiece(c, "not", 8)!;
    const post = postsOf(c)[0]!;
    connect(c, s.id, g.id, 0);
    connect(c, g.id, lamp.id, 0);
    connect(c, g.id, post.id, 0);
    connect(c, s.id, postsOf(c)[1]!.id, 0);
    expect(c.wires).toHaveLength(4);
    expect(removePiece(c, g.id)).toBe(true);
    expect(c.wires).toHaveLength(1);
    expect(c.wires[0]!.from).toBe(s.id);
    expect(pieceById(c, g.id)).toBeUndefined();
    expect(validate(c)).toEqual([]);
  });

  it("moves a wire's input end only to a free input", () => {
    const c = fresh();
    const s = addPiece(c, "switch", 0)!;
    const t = addPiece(c, "switch", 1)!;
    const g = addPiece(c, "and", 8)!;
    const w = connect(c, s.id, g.id, 0)!;
    connect(c, t.id, g.id, 1);
    expect(replug(c, w.id, g.id, 1)).toBe(false);
    const lamp = addPiece(c, "lamp", 2)!;
    expect(replug(c, w.id, lamp.id, 0)).toBe(true);
    expect(freePins(c, g.id)).toEqual([0]);
    expect(replug(c, w.id, lamp.id, 0)).toBe(true);
    expect(disconnect(c, w.id)).toBe(true);
    expect(disconnect(c, w.id)).toBe(false);
  });

  it("follows buttons while held, and only switches and buttons can be set", () => {
    const c = fresh();
    const b = addPiece(c, "button", 0)!;
    const lamp = addPiece(c, "lamp", 1)!;
    connect(c, b.id, lamp.id, 0);
    expect(setOn(c, b.id, true)).toBe(true);
    expect(powered(c, lamp)).toBe(true);
    setOn(c, b.id, false);
    expect(powered(c, lamp)).toBe(false);
    expect(setOn(c, lamp.id, true)).toBe(false);
  });

  it("clears to the posts and pinned pieces, and clones without sharing", () => {
    const c = fresh();
    const s = addPiece(c, "switch", 0, true)!;
    const g = addPiece(c, "not", 8)!;
    connect(c, s.id, g.id, 0);
    connect(c, s.id, postsOf(c)[0]!.id, 0);
    const k: Circuit = cloneCircuit(c);
    clearCircuit(c);
    expect(c.pieces.map((p) => p.kind).sort()).toEqual(["post", "post", "post", "switch"]);
    expect(c.wires).toHaveLength(1);
    expect(k.pieces).toHaveLength(5);
    setOn(k, s.id, true);
    expect(pieceById(c, s.id)!.on).toBe(false);
    clearCircuit(c, false);
    expect(c.pieces.map((p) => p.kind)).toEqual(["post", "post", "post"]);
    expect(c.wires).toHaveLength(0);
  });

  it("gives pieces of a group distinct colour slots", () => {
    const c = fresh();
    const hues = [0, 1, 2, 3].map((i) => addPiece(c, i % 2 ? "button" : "switch", i)!.hue);
    expect(new Set(hues).size).toBe(4);
    const lamps = [4, 5].map((i) => addPiece(c, "lamp", i)!.hue);
    expect(lamps).toEqual([0, 1]);
  });
});
