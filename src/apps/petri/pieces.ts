/**
 * Slime food and salt: the only things in the dish that stay where they were put, so they are few
 * (at most six per world), far apart (600 venue px), and short-lived. Food is eaten over about
 * 90 s and salt dissolves over 30 s. A new piece close to an old one takes its place, and past the
 * cap the oldest goes, so the list can never spell anything.
 */
export type PieceKind = "food" | "salt";

export interface Piece {
  readonly id: number;
  readonly kind: PieceKind;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly bornAt: number;
  readonly lifeMs: number;
}

export interface PieceOptions {
  cap: number;
  /** Venue px between piece centres. */
  gap: number;
  foodMs: number;
  saltMs: number;
}

export const PIECE_DEFAULTS: PieceOptions = { cap: 6, gap: 600, foodMs: 90_000, saltMs: 30_000 };

export interface Pieces {
  readonly list: readonly Piece[];
  add(kind: PieceKind, x: number, y: number, r: number, now: number): Piece;
  /** What is left of a piece, 1 when new and 0 when gone. */
  left(p: Piece, now: number): number;
  expire(now: number): void;
  clear(): void;
}

export const createPieces = (opts: PieceOptions = PIECE_DEFAULTS): Pieces => {
  let list: Piece[] = [];
  let nextId = 1;
  return {
    get list() {
      return list;
    },
    add(kind, x, y, r, now) {
      list = list.filter((p) => Math.hypot(p.x - x, p.y - y) >= opts.gap);
      while (list.length >= opts.cap) list.shift();
      const piece: Piece = {
        id: nextId++,
        kind,
        x,
        y,
        r,
        bornAt: now,
        lifeMs: kind === "food" ? opts.foodMs : opts.saltMs,
      };
      list.push(piece);
      return piece;
    },
    left: (p, now) => Math.min(1, Math.max(0, 1 - (now - p.bornAt) / p.lifeMs)),
    expire(now) {
      if (list.some((p) => now - p.bornAt >= p.lifeMs)) {
        list = list.filter((p) => now - p.bornAt < p.lifeMs);
      }
    },
    clear() {
      list = [];
    },
  };
};
