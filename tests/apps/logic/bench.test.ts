import { describe, expect, it } from "vitest";
import { CHECK_MS, TRICK_MS } from "../../../src/apps/logic/config";
import {
  BASIC_GATES,
  KINDS,
  LIMITS,
  type Piece,
  pieceById,
  powered,
  validate,
} from "../../../src/apps/logic/circuit";
import { pieceSize, pointOn, portOf, route, socketPoint } from "../../../src/apps/logic/geometry";
import { CARDS } from "../../../src/apps/logic/goals";
import { benchOf, type TestBench } from "./helpers";

const kinds = (t: TestBench) => t.bench.circuit.pieces.map((p) => p.kind).sort();
const byKind = (t: TestBench, kind: string): Piece[] =>
  t.bench.circuit.pieces.filter((p) => p.kind === kind);
/** A point low on a piece, away from its port. */
const grip = (t: TestBench, p: Piece) => {
  const c = socketPoint(t.bench.layout, p.socket);
  const s = pieceSize(t.bench.layout, p.kind);
  return KINDS[p.kind].band === "child" ? { x: c.x, y: c.y + s.h * 0.25 } : c;
};
const trayItem = (t: TestBench, kind: string) => {
  for (const tray of t.bench.layout.trays) {
    const it = tray.items.find((i) => i.kind === kind);
    if (it) return { x: it.x, y: it.y };
  }
  throw new Error(`no ${kind} in the tray`);
};
const freeSocket = (t: TestBench, band: string) =>
  t.bench.layout.sockets.findIndex(
    (s, i) => s.band === band && !t.bench.circuit.pieces.some((p) => p.socket === i),
  );

describe("logic bench", () => {
  for (const kind of ["pair", "wall", "kiosk"] as const) {
    it(`starts a ${kind} with a working circuit that the first flip lights`, () => {
      const t = benchOf(kind);
      expect(kinds(t)).toEqual(["and", "lamp", "or", "post", "post", "switch", "switch"]);
      expect(t.bench.circuit.wires).toHaveLength(4);
      expect(validate(t.bench.circuit)).toEqual([]);
      const [a, b] = byKind(t, "switch");
      expect(a!.on).toBe(true);
      expect(b!.on).toBe(false);
      const lamp = byKind(t, "lamp")[0]!;
      t.run(400);
      expect(powered(t.bench.circuit, lamp)).toBe(false);
      t.tap(grip(t, b!));
      expect(b!.on).toBe(true);
      // The AND changes at the next tick.
      t.run(210);
      expect(powered(t.bench.circuit, lamp)).toBe(true);
      expect(t.bench.posts()[0]).toBe(true);
    });
  }

  it("flips a switch on a tap even near its port, and pulls a wire on a drag from there", () => {
    const t = benchOf("pair");
    const b = byKind(t, "switch")[1]!;
    const port = t.port(b.id, -1);
    const s = pieceSize(t.bench.layout, "switch");
    const near = { x: port.x, y: port.y + s.h * 0.12 };
    t.tap(near);
    expect(b.on).toBe(true);
    expect(t.bench.circuit.wires).toHaveLength(4);
    const lamp = byKind(t, "lamp")[0]!;
    // Free the lamp's input, then drag from near the switch's port to it.
    const into = t.bench.circuit.wires.find((w) => w.to === lamp.id)!;
    t.drag(t.port(lamp.id, 0), { x: t.port(lamp.id, 0).x + 400, y: t.port(lamp.id, 0).y + 300 });
    expect(t.bench.circuit.wires.some((w) => w.id === into.id)).toBe(false);
    t.drag(near, t.port(lamp.id, 0));
    expect(b.on).toBe(true);
    expect(t.bench.circuit.wires.some((w) => w.from === b.id && w.to === lamp.id)).toBe(true);
  });

  it("makes a wire only when the drag ends near a free, suitable input", () => {
    const t = benchOf("pair");
    const or = byKind(t, "or")[0]!;
    const sw = byKind(t, "switch")[0]!;
    const n = t.bench.circuit.wires.length;
    const from = t.port(sw.id, -1);
    // Ending in empty space springs back.
    t.drag(from, { x: from.x + 10, y: from.y - 380 });
    expect(t.bench.circuit.wires).toHaveLength(n);
    expect(t.bench.fx.some((f) => f.kind === "spring")).toBe(true);
    // Ending within the snap distance of a free input snaps to it.
    const pin = t.port(or.id, 0);
    t.drag(from, { x: pin.x - 70, y: pin.y - 60 });
    expect(t.bench.circuit.wires).toHaveLength(n + 1);
    const w = t.bench.circuit.wires[t.bench.circuit.wires.length - 1]!;
    expect(w).toEqual({ id: w.id, from: sw.id, to: or.id, pin: 0 });
    // A wire is only its two ends: the finger's path is never kept.
    expect(Object.keys(w).sort()).toEqual(["from", "id", "pin", "to"]);
    // The same input is now taken; the other pin is the nearest free one.
    t.drag(from, pin);
    expect(
      t.bench.circuit.wires
        .filter((x) => x.to === or.id)
        .map((x) => x.pin)
        .sort(),
    ).toEqual([0, 1]);
    // Both taken: nothing to snap to.
    const lamp = byKind(t, "lamp")[0]!;
    t.drag(t.port(lamp.id, 0), { x: pin.x, y: pin.y });
    expect(validate(t.bench.circuit)).toEqual([]);
  });

  it("never snaps an output to another output, nor beyond the snap distance", () => {
    const t = benchOf("pair");
    const [a, b] = byKind(t, "switch");
    const n = t.bench.circuit.wires.length;
    t.drag(t.port(a!.id, -1), t.port(b!.id, -1));
    expect(t.bench.circuit.wires).toHaveLength(n);
    const or = byKind(t, "or")[0]!;
    const pin = t.port(or.id, 1);
    const far = t.bench.layout.snap + 30;
    t.drag(t.port(a!.id, -1), { x: pin.x, y: pin.y + far });
    expect(t.bench.circuit.wires).toHaveLength(n);
  });

  it("wires from a free input back to an output too", () => {
    const t = benchOf("pair");
    const or = byKind(t, "or")[0]!;
    const sw = byKind(t, "switch")[1]!;
    t.drag(t.port(or.id, 1), t.port(sw.id, -1));
    expect(
      t.bench.circuit.wires.some((w) => w.from === sw.id && w.to === or.id && w.pin === 1),
    ).toBe(true);
  });

  it("moves a wire's input end to another input, or drops it off the port", () => {
    const t = benchOf("pair");
    const lamp = byKind(t, "lamp")[0]!;
    const or = byKind(t, "or")[0]!;
    const w = t.bench.circuit.wires.find((x) => x.to === lamp.id)!;
    t.drag(t.port(lamp.id, 0), t.port(or.id, 0));
    expect(t.bench.circuit.wires.find((x) => x.id === w.id)).toMatchObject({ to: or.id, pin: 0 });
    const n = t.bench.circuit.wires.length;
    const p = t.port(or.id, 0);
    t.drag(p, { x: p.x + 500, y: p.y + 500 });
    expect(t.bench.circuit.wires).toHaveLength(n - 1);
    // Dropping it back where it was keeps it.
    const and = byKind(t, "and")[0]!;
    const before = JSON.stringify(t.bench.circuit.wires);
    t.drag(t.port(and.id, 0), t.port(and.id, 0));
    expect(JSON.stringify(t.bench.circuit.wires)).toBe(before);
  });

  it("cuts a wire with a tap on its middle, but not with a drag", () => {
    const t = benchOf("kiosk");
    const n = t.bench.circuit.wires.length;
    const l = t.bench.layout;
    const middle = (id: number) => {
      const w = t.bench.circuit.wires.find((x) => x.id === id)!;
      const a = portOf(l, pieceById(t.bench.circuit, w.from)!, -1)!;
      const z = portOf(l, pieceById(t.bench.circuit, w.to)!, w.pin)!;
      return pointOn(route(a, z, l.child * 0.35), 0.5);
    };
    // A wire whose middle is clear of pieces and ports.
    const w = t.bench.circuit.wires.find((x) => {
      const m = middle(x.id);
      t.bench.down(7, m.x, m.y, true);
      const g = t.bench.gestures.get(7);
      t.bench.cancel(7);
      return g?.t === "cut" && g.wire === x.id;
    })!;
    expect(w).toBeDefined();
    const m = middle(w.id);
    t.drag(m, { x: m.x + 200, y: m.y });
    expect(t.bench.circuit.wires).toHaveLength(n);
    t.tap(m);
    expect(t.bench.circuit.wires).toHaveLength(n - 1);
    expect(t.bench.circuit.wires.some((x) => x.id === w.id)).toBe(false);
  });

  it("adds pieces from the tray only into free sockets of their band, within the limits", () => {
    const t = benchOf("pair");
    const n = t.bench.circuit.pieces.length;
    // A lamp dropped on a gate socket goes nowhere.
    const gateSock = freeSocket(t, "adult");
    t.drag(trayItem(t, "lamp"), socketPoint(t.bench.layout, gateSock));
    expect(t.bench.circuit.pieces).toHaveLength(n);
    const childSock = freeSocket(t, "child");
    t.drag(trayItem(t, "fan"), socketPoint(t.bench.layout, childSock));
    expect(t.bench.circuit.pieces).toHaveLength(n + 1);
    expect(t.bench.circuit.pieces.find((p) => p.socket === childSock)!.kind).toBe("fan");
    t.drag(trayItem(t, "xor"), socketPoint(t.bench.layout, gateSock));
    expect(t.bench.circuit.pieces.find((p) => p.socket === gateSock)!.kind).toBe("xor");
    // Fill the sinks to the limit; the next one is refused with a shake.
    for (let i = 0; i < 4; i++) {
      const s = freeSocket(t, "child");
      if (s < 0) break;
      t.drag(trayItem(t, "bell"), socketPoint(t.bench.layout, s));
    }
    const sinks = t.bench.circuit.pieces.filter((p) => KINDS[p.kind].group === "sink");
    expect(sinks).toHaveLength(LIMITS.sink);
    const before = t.bench.circuit.pieces.length;
    const s = freeSocket(t, "child");
    t.bench.down(3, trayItem(t, "lamp").x, trayItem(t, "lamp").y, true);
    expect(t.bench.gestures.get(3)?.t).toBe("none");
    expect(t.bench.fx[t.bench.fx.length - 1]!.kind).toBe("shake");
    t.bench.up(3, socketPoint(t.bench.layout, s).x, socketPoint(t.bench.layout, s).y);
    expect(t.bench.circuit.pieces).toHaveLength(before);
    expect(validate(t.bench.circuit)).toEqual([]);
  });

  it("offers only the basic gates when asked", () => {
    const t = benchOf("pair", "bench", BASIC_GATES);
    const kinds = t.bench.layout.trays.flatMap((tr) => tr.items.map((i) => i.kind));
    expect(kinds).not.toContain("xor");
    expect(kinds).not.toContain("blinker");
    expect(kinds).toContain("not");
  });

  it("moves pieces between sockets with their wires, and back to the tray removes them", () => {
    const t = benchOf("pair");
    const and = byKind(t, "and")[0]!;
    const wires = t.bench.circuit.wires.filter((w) => w.from === and.id || w.to === and.id).length;
    expect(wires).toBe(4);
    const to = freeSocket(t, "adult");
    t.drag(grip(t, and), socketPoint(t.bench.layout, to));
    expect(and.socket).toBe(to);
    expect(t.bench.circuit.wires.filter((w) => w.from === and.id || w.to === and.id)).toHaveLength(
      4,
    );
    // Dropped where nothing fits, it springs back.
    t.drag(grip(t, and), { x: 1080, y: 40 });
    expect(and.socket).toBe(to);
    // Into the tray: gone, with its wires.
    const tray = t.bench.layout.trays.find((x) => x.band === "adult")!.box;
    t.drag(grip(t, and), { x: tray.x + tray.width / 2, y: tray.y + tray.height / 2 });
    expect(pieceById(t.bench.circuit, and.id)).toBeUndefined();
    expect(t.bench.circuit.wires.some((w) => w.from === and.id || w.to === and.id)).toBe(false);
    expect(validate(t.bench.circuit)).toEqual([]);
  });

  it("holds a button on only while the finger stays", () => {
    const t = benchOf("pair");
    const s = freeSocket(t, "child");
    t.drag(trayItem(t, "button"), socketPoint(t.bench.layout, s));
    const b = t.bench.circuit.pieces.find((p) => p.socket === s)!;
    expect(b.kind).toBe("button");
    const at = grip(t, b);
    t.bench.down(5, at.x, at.y, true);
    expect(b.on).toBe(true);
    t.bench.move(5, at.x + 3, at.y + 2);
    expect(b.on).toBe(true);
    t.bench.up(5, at.x + 3, at.y + 2);
    expect(b.on).toBe(false);
    // Sliding away turns the press into a move, and the button lets go.
    t.bench.down(6, at.x, at.y, true);
    t.bench.move(6, at.x + 200, at.y);
    expect(b.on).toBe(false);
    expect(t.bench.gestures.get(6)?.t).toBe("move");
    t.bench.cancel(6);
  });

  it("keeps a button on while any finger holds it, and wires it while it's held", () => {
    const t = benchOf("pair");
    const s = freeSocket(t, "child");
    t.drag(trayItem(t, "button"), socketPoint(t.bench.layout, s));
    const b = t.bench.circuit.pieces.find((p) => p.socket === s)!;
    const at = grip(t, b);
    t.bench.down(21, at.x, at.y, true);
    t.bench.down(22, at.x + 20, at.y, true);
    t.bench.up(21, at.x, at.y);
    expect(b.on).toBe(true);
    // An adult wires the button while a child holds it.
    const or = byKind(t, "or")[0]!;
    t.drag(t.port(b.id, -1), t.port(or.id, 0), 23);
    expect(t.bench.circuit.wires.some((w) => w.from === b.id && w.to === or.id)).toBe(true);
    expect(b.on).toBe(true);
    t.bench.up(22, at.x + 20, at.y);
    expect(b.on).toBe(false);
  });

  it("drops a finger whose lift never comes", () => {
    const t = benchOf("pair");
    const or = byKind(t, "or")[0]!;
    const p = t.port(or.id, 0);
    t.bench.down(11, p.x, p.y, true);
    expect(t.bench.gestures.size).toBe(1);
    t.run(31_000);
    expect(t.bench.gestures.size).toBe(0);
  });

  it("restores the starting circuit and clears to the posts", () => {
    const t = benchOf("pair");
    t.bench.clear();
    expect(kinds(t)).toEqual(["post", "post"]);
    expect(t.bench.circuit.wires).toHaveLength(0);
    t.bench.starter();
    expect(kinds(t)).toEqual(["and", "lamp", "or", "post", "post", "switch", "switch"]);
    expect(t.bench.circuit.wires).toHaveLength(4);
  });

  it("counts a person's touch, but not a bot's", () => {
    const t = benchOf("pair");
    t.clock.t = 500;
    t.bench.down(1, 10, 10, false);
    t.bench.up(1, 10, 10);
    expect(t.bench.lastHuman).toBe(Number.NEGATIVE_INFINITY);
    t.bench.down(2, 10, 10, true);
    t.bench.up(2, 10, 10);
    expect(t.bench.lastHuman).toBe(500);
  });
});

describe("logic bench with goal cards", () => {
  it("starts on the first card with pinned inputs that flip but don't move", () => {
    const t = benchOf("pair", "goals");
    expect(t.bench.card!.id).toBe(CARDS[0]!.id);
    expect(t.bench.inputs).toHaveLength(1);
    const sw = pieceById(t.bench.circuit, t.bench.inputs[0]!)!;
    expect(sw.pinned).toBe(true);
    const at = grip(t, sw);
    t.tap(at);
    expect(sw.on).toBe(true);
    const socket = sw.socket;
    t.drag(at, socketPoint(t.bench.layout, freeSocket(t, "child")));
    expect(sw.socket).toBe(socket);
  });

  it("ticks the card off when the wiring is right, shows off, then brings the next card", () => {
    const t = benchOf("pair", "goals");
    t.run(CHECK_MS + 50);
    expect(t.bench.rows).toEqual([true, false]);
    const sw = t.bench.inputs[0]!;
    const post = t.bench.circuit.pieces.find((p) => p.kind === "post")!;
    t.drag(t.port(sw, -1), t.port(post.id, 0));
    expect(t.bench.circuit.wires).toHaveLength(1);
    t.run(CHECK_MS + 50);
    expect(t.bench.rows).toEqual([true, true]);
    expect(t.bench.doneAt).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    expect(t.bench.completed).toBe(1);
    t.run(TRICK_MS + 50);
    expect(t.bench.card!.id).toBe(CARDS[1]!.id);
    expect(t.bench.circuit.wires).toHaveLength(0);
    // Reset goes back to the first card; the reset control restarts the current one.
    t.bench.setCard(4);
    expect(t.bench.card!.id).toBe(CARDS[4]!.id);
    t.bench.starter();
    expect(t.bench.card!.id).toBe(CARDS[4]!.id);
    t.bench.reset();
    expect(t.bench.card!.id).toBe(CARDS[0]!.id);
  });

  it("loops back to the first card after the last", () => {
    const t = benchOf("pair", "goals");
    t.bench.setCard(CARDS.length - 1);
    const card = t.bench.card!;
    const c = t.bench.circuit;
    // Build the known solution through the model, then let the checker see it.
    const recipe = card.solutions.all;
    const ids: number[] = [];
    for (const [i, g] of recipe.gates.entries()) {
      const s = t.bench.layout.gateSockets[i]!;
      t.drag(trayItem(t, g), socketPoint(t.bench.layout, s));
      ids.push(c.pieces.find((p) => p.socket === s)!.id);
    }
    const posts = c.pieces.filter((p) => p.kind === "post").sort((a, b) => a.socket - b.socket);
    for (const w of recipe.wires) {
      const from = "in" in w.from ? t.bench.inputs[w.from.in]! : ids[w.from.gate]!;
      const [to, pin] = "post" in w.to ? [posts[w.to.post]!.id, 0] : [ids[w.to.gate]!, w.to.pin];
      t.drag(t.port(from, -1), t.port(to, pin));
    }
    expect(c.wires).toHaveLength(recipe.wires.length);
    t.run(CHECK_MS + 50);
    expect(t.bench.rows.every(Boolean)).toBe(true);
    t.run(TRICK_MS + 50);
    expect(t.bench.cardIndex).toBe(0);
  });
});
