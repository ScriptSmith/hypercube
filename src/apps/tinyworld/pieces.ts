import type { FrameKind } from "../../core/types";
import { type Box, contains, overlaps } from "./config";
import { E, type ElementId } from "./elements";

/**
 * Pre-made solid pieces. Rule 4: solids are never traced along a finger path. A piece is
 * stamped whole where a finger lifts, pieces are large, come in fixed orientations (no tall
 * bars), never touch each other, and there are only a few, so they can't spell anything.
 */
export type PieceKind = "block" | "ramp" | "bowl" | "platform";

export const PIECE_KINDS: readonly PieceKind[] = ["block", "ramp", "bowl", "platform"];

export const PIECE_MATERIAL: Record<PieceKind, ElementId> = {
  block: E.STONE,
  ramp: E.WOOD,
  bowl: E.GLASS,
  platform: E.METAL,
};

/** Shape codes the stamp shader understands. */
export const PIECE_SHAPE: Record<PieceKind, number> = { block: 0, ramp: 1, bowl: 2, platform: 3 };

/** Width and height in venue px. Every piece is at least as wide as it is tall. */
const SIZES: Record<"wall" | "panel", Record<PieceKind, [number, number]>> = {
  wall: { block: [210, 210], ramp: [330, 210], bowl: [350, 200], platform: [450, 66] },
  panel: { block: [176, 176], ramp: [270, 176], bowl: [290, 168], platform: [360, 56] },
};

export const pieceSize = (kind: FrameKind, piece: PieceKind): { width: number; height: number } => {
  const [width, height] = SIZES[kind === "wall" ? "wall" : "panel"][piece];
  return { width, height };
};

export interface Piece {
  id: number;
  kind: PieceKind;
  /** Centre in venue px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Ramps slope down towards the middle of the world; mirrored ones on the right half. */
  mirror: boolean;
  placedAt: number;
}

export interface PieceRules {
  cap: number;
  /** Pieces closer than this (venue px) to a new one are recycled, so pieces never touch. */
  gap: number;
  /**
   * Pieces that share any horizontal span must also be this many times the taller one's height
   * apart vertically, or the older is recycled. No upright stroke, T or L can be built, and only
   * two or three rows fit within reach.
   */
  stack: number;
  /** Random offset as a fraction of the piece size, which spoils careful alignment. */
  jitter: number;
  /** Pieces must lie inside this box. */
  bounds: Box;
  /** Pieces are pushed out of these boxes. */
  keepOut: readonly Box[];
}

export interface Placement {
  piece: Piece;
  /** Pieces recycled to make room: crumble them in the world. */
  removed: Piece[];
}

export const pieceBox = (p: Pick<Piece, "x" | "y" | "width" | "height">): Box => ({
  x: p.x - p.width / 2,
  y: p.y - p.height / 2,
  width: p.width,
  height: p.height,
});

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Would these two pieces be too close to stand together? */
export const conflicts = (a: Box, b: Box, rules: Pick<PieceRules, "gap" | "stack">): boolean => {
  if (overlaps(a, b, rules.gap)) return true;
  const sameColumn = a.x < b.x + b.width + rules.gap && b.x < a.x + a.width + rules.gap;
  if (!sameColumn) return false;
  const vertical = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
  return vertical < rules.stack * Math.max(a.height, b.height);
};

export interface PieceSet {
  readonly list: readonly Piece[];
  /** Where a piece dropped at (x, y) would land, or null if it can't fit there. */
  fit(kind: PieceKind, x: number, y: number): Piece | null;
  place(kind: PieceKind, x: number, y: number, rnd: () => number, now: number): Placement | null;
  /** The newest piece under (x, y), with a little slop for fingers. */
  at(x: number, y: number, slop?: number): Piece | null;
  /** Take a piece out of the set, to move it. */
  remove(id: number): Piece | null;
  clear(): Piece[];
}

export const createPieceSet = (rules: PieceRules, frameKind: FrameKind): PieceSet => {
  let items: Piece[] = [];
  let nextId = 1;

  const fit = (kind: PieceKind, x: number, y: number): Piece | null => {
    const { width, height } = pieceSize(frameKind, kind);
    const b = rules.bounds;
    if (width > b.width || height > b.height) return null;
    const inside = (px: number, py: number) =>
      px >= b.x + width / 2 - 0.5 &&
      px <= b.x + b.width - width / 2 + 0.5 &&
      py >= b.y + height / 2 - 0.5 &&
      py <= b.y + b.height - height / 2 + 0.5;
    let cx = clamp(x, b.x + width / 2, b.x + b.width - width / 2);
    let cy = clamp(y, b.y + height / 2, b.y + b.height - height / 2);
    // Push out of each keep-out box the shorter way: sideways or upwards.
    for (let pass = 0; pass < 3; pass++) {
      for (const k of rules.keepOut) {
        if (!overlaps(pieceBox({ x: cx, y: cy, width, height }), k)) continue;
        const left = k.x - width / 2 - 1;
        const right = k.x + k.width + width / 2 + 1;
        const up = k.y - height / 2 - 1;
        const best = [
          { x: left, y: cy, d: Math.abs(cx - left) },
          { x: right, y: cy, d: Math.abs(cx - right) },
          { x: cx, y: up, d: Math.abs(cy - up) },
        ]
          .filter((o) => inside(o.x, o.y))
          .sort((p, q) => p.d - q.d)[0];
        if (!best) return null;
        cx = best.x;
        cy = best.y;
      }
    }
    const box = pieceBox({ x: cx, y: cy, width, height });
    if (rules.keepOut.some((k) => overlaps(box, k))) return null;
    return {
      id: 0,
      kind,
      x: cx,
      y: cy,
      width,
      height,
      mirror: kind === "ramp" && cx > b.x + b.width / 2,
      placedAt: 0,
    };
  };

  return {
    get list() {
      return items;
    },
    fit,
    place(kind, x, y, rnd, now) {
      const { width, height } = pieceSize(frameKind, kind);
      const j = rules.jitter;
      const spot = fit(kind, x + (rnd() * 2 - 1) * j * width, y + (rnd() * 2 - 1) * j * height);
      if (!spot) return null;
      const piece: Piece = { ...spot, id: nextId++, placedAt: now };
      const box = pieceBox(piece);
      const removed = items.filter((p) => conflicts(pieceBox(p), box, rules));
      items = items.filter((p) => !removed.includes(p));
      while (items.length >= Math.max(1, rules.cap)) {
        const oldest = items.shift();
        if (oldest) removed.push(oldest);
      }
      items.push(piece);
      return { piece, removed };
    },
    at(x, y, slop = 0) {
      for (let i = items.length - 1; i >= 0; i--) {
        const p = items[i];
        if (p && contains(pieceBox(p), x, y, slop)) return p;
      }
      return null;
    },
    remove(id) {
      const i = items.findIndex((p) => p.id === id);
      if (i < 0) return null;
      const [p] = items.splice(i, 1);
      return p ?? null;
    },
    clear() {
      const all = items;
      items = [];
      return all;
    },
  };
};
