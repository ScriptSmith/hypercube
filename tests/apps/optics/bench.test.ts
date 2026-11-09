import { describe, expect, it } from "vitest";
import { type Bench, createBench } from "../../../src/apps/optics/bench";
import { TAP_MS } from "../../../src/apps/optics/config";
import { generate } from "../../../src/apps/optics/generate";
import { frameLayout } from "../../../src/apps/optics/layout";
import type { Puzzle } from "../../../src/apps/optics/puzzle";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";

const panel = frameLayout("panel", VENUE_SIZE.panel, DEFAULT_REACH.panel).benches[0]!;

const make = (puzzle: Puzzle | null, sandbox = false) => {
  let t = 0;
  const b = createBench({ layout: panel, sandbox, colour: true, now: () => t });
  if (puzzle) b.load(puzzle);
  return { b, advance: (ms: number) => (t += ms) };
};

const puzzleWith = (level: Puzzle["level"], seed: string) =>
  generate({ bench: panel, level, seed, colour: true, bank: null });

let id = 1;
const drag = (b: Bench, from: { x: number; y: number }, to: { x: number; y: number }) => {
  const p = id++;
  b.down(p, from.x, from.y, false);
  for (let k = 1; k <= 10; k++) {
    b.move(p, from.x + ((to.x - from.x) * k) / 10, from.y + ((to.y - from.y) * k) / 10);
  }
  b.up(p, to.x, to.y);
};

/** A puzzle whose first piece starts in its tray. */
const trayPuzzle = () => {
  for (let n = 0; n < 50; n++) {
    const p = puzzleWith("m2", `tray:${n}`);
    if (p.start[0]!.socket === null) return p;
  }
  throw new Error("no puzzle with a piece in its tray");
};

describe("bench touches", () => {
  it("drags a piece from its tray into a socket, and it keeps its turn", () => {
    const p = trayPuzzle();
    const { b } = make(p);
    const at = b.where(0)!;
    const target = panel.sockets[p.solution[0]!.socket!]!;
    const turn = b.items[0]!.place.turn;
    drag(b, at, { x: target.x + 30, y: target.y - 20 });
    expect(b.items[0]!.place.socket).toBe(p.solution[0]!.socket);
    expect(b.items[0]!.place.turn).toBe(turn);
  });

  it("turns a placed piece one detent clockwise on a tap", () => {
    const p = trayPuzzle();
    const { b, advance } = make(p);
    b.solve();
    const s = panel.sockets[b.items[0]!.place.socket!]!;
    const before = b.items[0]!.place.turn;
    const v = b.traceVersion;
    b.down(1, s.x + 20, s.y, false);
    advance(100);
    b.up(1, s.x + 20, s.y);
    expect(b.items[0]!.place.turn).toBe((before + 1) % 24);
    expect(b.traceVersion).toBeGreaterThan(v);
    // A long press is not a tap.
    b.down(2, s.x + 20, s.y, false);
    advance(TAP_MS + 100);
    b.up(2, s.x + 20, s.y);
    expect(b.items[0]!.place.turn).toBe((before + 1) % 24);
  });

  it("turns a piece in 15 degree detents by dragging round its ring", () => {
    const p = trayPuzzle();
    const { b } = make(p);
    b.solve();
    const s = panel.sockets[b.items[0]!.place.socket!]!;
    const before = b.items[0]!.place.turn;
    const R = panel.sizes.ring;
    // Start on the side away from the other piece.
    const other = panel.sockets[b.items[1]!.place.socket!]!;
    const away = Math.atan2(s.y - other.y, s.x - other.x);
    b.down(5, s.x + Math.cos(away) * R, s.y + Math.sin(away) * R, false);
    for (let k = 1; k <= 20; k++) {
      const a = away + (Math.PI / 4) * (k / 20);
      b.move(5, s.x + Math.cos(a) * R, s.y + Math.sin(a) * R);
    }
    b.up(5, s.x + Math.cos(away + Math.PI / 4) * R, s.y + Math.sin(away + Math.PI / 4) * R);
    expect(b.items[0]!.place.turn).toBe((before + 3) % 24);
    // And back the other way, past the start.
    b.down(6, s.x + Math.cos(away) * R, s.y + Math.sin(away) * R, false);
    for (let k = 1; k <= 20; k++) {
      const a = away - (Math.PI / 2) * (k / 20);
      b.move(6, s.x + Math.cos(a) * R, s.y + Math.sin(a) * R);
    }
    b.up(6, 0, 0);
    expect(b.items[0]!.place.turn).toBe((before + 24 - 3) % 24);
  });

  it("puts a piece dropped on a tray back in its tray, and one dropped nowhere back where it was", () => {
    const p = trayPuzzle();
    const { b } = make(p);
    b.solve();
    const s = panel.sockets[b.items[0]!.place.socket!]!;
    const tray = panel.trays[b.items[0]!.tray]!;
    drag(b, s, { x: tray.box.x + tray.box.width / 2, y: tray.box.y + tray.box.height / 2 });
    expect(b.items[0]!.place.socket).toBeNull();
    // From the tray into a socket, then dropped between sockets: back to that socket.
    const free = panel.sockets.findIndex((_, k) => !b.items.some((it) => it.place.socket === k));
    drag(b, b.where(0)!, panel.sockets[free]!);
    expect(b.items[0]!.place.socket).toBe(free);
    const f = panel.sockets[free]!;
    // In the middle of four sockets, too far from any of them to snap in.
    const mid = {
      x: (panel.sockets[0]!.x + panel.sockets[1]!.x) / 2,
      y: (panel.sockets[0]!.y + panel.sockets[3]!.y) / 2,
    };
    drag(b, f, mid);
    expect(b.items[0]!.place.socket).toBe(free);
  });

  it("solves a puzzle and restarts it", () => {
    const p = puzzleWith("split", "solve");
    const { b } = make(p);
    expect(b.solved).toBe(false);
    b.solve();
    expect(b.solved).toBe(true);
    expect(b.realSolved).toBe(true);
    expect(b.lit).toBe(p.crystals.length);
    b.restart();
    expect(b.solved).toBe(false);
    expect(b.places()).toEqual(p.start);
  });

  it("brightens crystals over about 300 ms rather than at once", () => {
    const p = puzzleWith("m1", "glow");
    const { b } = make(p);
    b.solve();
    expect(b.shown[0]).toBe(0);
    b.tick(0.1);
    expect(b.shown[0]!).toBeGreaterThan(0.2);
    expect(b.shown[0]!).toBeLessThan(0.5);
    b.tick(0.25);
    expect(b.shown[0]).toBe(1);
  });

  it("cancels a carried piece back to where it came from", () => {
    const p = trayPuzzle();
    const { b } = make(p);
    const from = b.where(0)!;
    b.down(9, from.x, from.y, false);
    b.move(9, from.x + 300, from.y - 400);
    expect(b.where(0)!.carried).toBe(true);
    b.cancel(9);
    expect(b.items[0]!.place.socket).toBeNull();
    expect(b.grabs.size).toBe(0);
  });
});

describe("free play", () => {
  it("takes new pieces from the dispensers, up to the limit", () => {
    const { b } = make(
      {
        level: "m1",
        lamps: [],
        crystals: [],
        fixed: [],
        pieces: [],
        solution: [],
        start: [],
        entry: [],
        exits: [],
        sky: [],
        fallback: false,
      },
      true,
    );
    expect(b.dispensers.length).toBeGreaterThanOrEqual(6);
    const mirror = b.dispensers.find((d) => d.kind === "mirror")!;
    const slot = panel.trays[mirror.tray]!.slots[mirror.slot]!;
    for (let k = 0; k < panel.sockets.length; k++) drag(b, slot, panel.sockets[k]!);
    expect(b.placedOn(0)).toBe(panel.limit);
    expect(b.items.length).toBe(panel.limit);
    // Back onto a tray: gone.
    drag(b, panel.sockets[b.items[0]!.place.socket!]!, slot);
    expect(b.items.length).toBe(panel.limit - 1);
  });

  it("moves a lamp to another spot", () => {
    const spot = panel.lampSpots[0]!;
    const { b } = make(
      {
        level: "m1",
        lamps: [{ kind: "white", x: spot.x, y: spot.y, angle: 0, spot: 0 }],
        crystals: [],
        fixed: [],
        pieces: [],
        solution: [],
        start: [],
        entry: [],
        exits: [],
        sky: [],
        fallback: false,
      },
      true,
    );
    const to = panel.lampSpots[4]!;
    const v = b.fixedVersion;
    drag(b, spot, to);
    expect(b.puzzle.lamps[0]!.spot).toBe(4);
    expect(b.puzzle.lamps[0]!.y).toBe(to.y);
    expect(b.fixedVersion).toBeGreaterThan(v);
  });
});
