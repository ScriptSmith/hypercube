import { describe, expect, it } from "vitest";
import { type Box, overlaps } from "../../../src/apps/tinyworld/config";
import {
  conflicts,
  createPieceSet,
  type Piece,
  pieceBox,
  PIECE_KINDS,
  pieceSize,
  type PieceSet,
} from "../../../src/apps/tinyworld/pieces";
import { createRng } from "../../../src/core/rng";

const WALL: Box = { x: 0, y: 0, width: 5760, height: 2160 };
const CABINETS: Box[] = [
  { x: 0, y: 1130, width: 640, height: 1030 },
  { x: 5120, y: 1130, width: 640, height: 1030 },
];
const GAP = 50;

const STACK = 1.25;
const set = (cap = 8, jitter = 0): PieceSet =>
  createPieceSet({ cap, gap: GAP, stack: STACK, jitter, bounds: WALL, keepOut: CABINETS }, "wall");

const half = () => 0.5;

const noneTouch = (list: readonly Piece[]) => {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = pieceBox(list[i]!);
      const b = pieceBox(list[j]!);
      expect(overlaps(a, b, GAP - 0.01)).toBe(false);
      expect(conflicts(a, b, { gap: GAP - 0.01, stack: STACK - 0.01 })).toBe(false);
    }
  }
};

describe("tinyworld pieces", () => {
  it("are large and never taller than they are wide", () => {
    for (const kind of ["wall", "panel", "pair"] as const) {
      for (const p of PIECE_KINDS) {
        const { width, height } = pieceSize(kind, p);
        expect(width).toBeGreaterThanOrEqual(kind === "wall" ? 200 : 170);
        expect(height).toBeLessThanOrEqual(width);
      }
    }
  });

  it("caps the world at eight and recycles the oldest", () => {
    const s = set(8);
    const placed: Piece[] = [];
    for (let i = 0; i < 12; i++) {
      const r = s.place("block", 800 + i * 350, 1800, half, i);
      expect(r).not.toBeNull();
      placed.push(r!.piece);
      if (i >= 8) expect(r!.removed.map((p) => p.id)).toEqual([placed[i - 8]!.id]);
    }
    expect(s.list).toHaveLength(8);
    expect(s.list.map((p) => p.id)).toEqual(placed.slice(4).map((p) => p.id));
  });

  it("recycles any piece a new one would touch, so pieces never join up", () => {
    const s = set();
    const a = s.place("platform", 2000, 1800, half, 0)!.piece;
    const r = s.place("block", 2000 + a.width / 2 + 60, 1800, half, 1)!;
    expect(r.removed.map((p) => p.id)).toEqual([a.id]);
    expect(s.list).toHaveLength(1);
  });

  it("keeps pieces inside the world and out of the cabinets", () => {
    const s = set(8, 0.06);
    const rng = createRng("pieces");
    for (let i = 0; i < 400; i++) {
      const kind = rng.pick(PIECE_KINDS);
      s.place(kind, rng.range(-200, 5960), rng.range(-200, 2360), () => rng.next(), i);
      for (const p of s.list) {
        const b = pieceBox(p);
        expect(b.x).toBeGreaterThanOrEqual(-0.5);
        expect(b.y).toBeGreaterThanOrEqual(-0.5);
        expect(b.x + b.width).toBeLessThanOrEqual(WALL.width + 0.5);
        expect(b.y + b.height).toBeLessThanOrEqual(WALL.height + 0.5);
        for (const c of CABINETS) expect(overlaps(b, c)).toBe(false);
      }
      expect(s.list.length).toBeLessThanOrEqual(8);
      noneTouch(s.list);
    }
  });

  it("slopes ramps down towards the middle of the world", () => {
    const s = set();
    expect(s.place("ramp", 1500, 1800, half, 0)!.piece.mirror).toBe(false);
    expect(s.place("ramp", 5000, 1800, half, 1)!.piece.mirror).toBe(true);
  });

  it("picks up the newest piece under a finger and lets it be moved", () => {
    const s = set();
    const a = s.place("block", 3000, 1800, half, 0)!.piece;
    expect(s.at(3000 + a.width / 2 + 20, 1800, 30)?.id).toBe(a.id);
    expect(s.at(3000 + a.width / 2 + 40, 1800, 30)).toBeNull();
    expect(s.remove(a.id)?.id).toBe(a.id);
    expect(s.list).toHaveLength(0);
  });

  // Rule 4. Someone tries to spell "HI" in the reachable band (up to 1100 px above the floor):
  // two uprights and a crossbar for the H, an upright for the I. Pieces can't stack because
  // touching pieces recycle each other, and none is taller than wide, so no upright longer
  // than one block can exist, and at most eight pieces stand at once.
  it("can't be arranged into a word", () => {
    const s = set(8, 0.06);
    const rng = createRng("letters");
    const block = pieceSize("wall", "block");
    const column = (x: number) =>
      [0, 1, 2].map((k) => ({ x, y: 2130 - block.height / 2 - k * block.height }));
    const strokes = [
      ...column(1500),
      ...column(2100),
      { x: 1800, y: 2130 - block.height * 1.5 },
      ...column(2700),
    ];
    strokes.forEach((p, i) => s.place("block", p.x, p.y, () => rng.next(), i));
    noneTouch(s.list);
    // Every column holds at most one block, so no upright is ever taller than one piece.
    for (const x of [1500, 2100, 2700]) {
      const inColumn = s.list.filter((p) => Math.abs(p.x - x) < block.width);
      expect(inColumn.length).toBeLessThanOrEqual(1);
    }
    expect(s.list.length).toBeLessThanOrEqual(8);
  });

  it("can't make a dotted letter from blocks spaced just apart", () => {
    // A 3 x 3 dot-matrix H, each dot one gap from the next.
    const s = set();
    const b = pieceSize("wall", "block");
    const pitch = b.width + GAP + 1;
    const dots = [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
      [2, 0],
      [2, 1],
      [2, 2],
    ];
    dots.forEach(([c, r], i) => s.place("block", 2000 + c! * pitch, 2030 - r! * pitch, half, i));
    noneTouch(s.list);
    // Each column keeps one dot, so the uprights are gone and what's left can't read as an H.
    expect(s.list.length).toBeLessThanOrEqual(3);
  });

  it("can't build a T or an L, but can still stagger a cascade of platforms", () => {
    const s = set();
    const p = pieceSize("wall", "platform");
    const b = pieceSize("wall", "block");
    s.place("platform", 3000, 1700, half, 0);
    s.place("block", 3000, 1700 + p.height / 2 + GAP + b.height / 2 + 1, half, 1);
    expect(s.list).toHaveLength(1);
    const c = set();
    const step = p.height * (1 + STACK) + 2;
    for (let i = 0; i < 4; i++) c.place("platform", 2000 + i * 200, 1500 + i * step, half, i);
    expect(c.list).toHaveLength(4);
  });
});
