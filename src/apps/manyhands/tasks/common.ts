/**
 * The task contract. A task is one small job in one slot: it lays itself out from the size of
 * its area, takes touches, draws itself and knows how a bot would do it. Tasks can't be failed:
 * a miss shakes and resets that step. New tasks need only a module like these and an entry in
 * `library.ts`.
 */
import type { Rng } from "../../../core/types";
import type { Gesture, Pt } from "../gesture";

export type Band = "low" | "high";
export type TaskId =
  | "pop"
  | "pump"
  | "hold"
  | "catch"
  | "sort"
  | "crank"
  | "plug"
  | "repeat"
  | "gauge"
  | "count";

export interface TaskEnv {
  /** The task's area, venue px. Tasks draw and take touches in 0..w by 0..h. */
  w: number;
  h: number;
  rng: Rng;
  /** The station's colour. */
  color: string;
  /** Smallest touch target here, venue px. */
  target: number;
  /** The wall: coarse touch, and fewer px to a person's reach. */
  coarse: boolean;
}

export interface Task {
  readonly id: TaskId;
  /** 0 to 1. */
  readonly progress: number;
  readonly done: boolean;
  down(id: number, x: number, y: number): void;
  move(id: number, x: number, y: number): void;
  up(id: number): void;
  /** Seconds. */
  update(dt: number): void;
  /** In the task's own venue px. `time` is seconds, for idle motion. */
  draw(g: CanvasRenderingContext2D, time: number): void;
  /**
   * The next gesture a bot would make now, or null to wait and ask again. `pace` 1 is a bot at
   * full speed; lower slows the gesture for the attract ghost.
   */
  bot(pace: number): Gesture | null;
}

export interface TaskDef {
  id: TaskId;
  band: Band;
  create(env: TaskEnv): Task;
}

export const TAU = Math.PI * 2;

/** Colours for task pieces, each with its own mark so colour is never the only clue. */
export const PIECES = [
  { color: "#4f8cf7", mark: "circle" },
  { color: "#f2a03d", mark: "square" },
  { color: "#59c27a", mark: "triangle" },
  { color: "#e85fa8", mark: "diamond" },
] as const;
export type Mark = (typeof PIECES)[number]["mark"];

export const INK = "#0b1222";
export const SOFT = "rgba(220,230,250,0.16)";
export const LINE = "rgba(220,230,250,0.55)";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);

/** A gentle sideways shake after a miss. */
export interface Shake {
  kick(): void;
  update(dt: number): void;
  /** Sideways offset now, venue px. */
  dx(scale: number): number;
}

export const createShake = (): Shake => {
  let left = 0;
  let t = 0;
  return {
    kick() {
      left = 0.45;
    },
    update(dt) {
      t += dt;
      left = Math.max(0, left - dt);
    },
    dx(scale) {
      return left > 0 ? Math.sin(t * 38) * scale * 0.06 * (left / 0.45) : 0;
    },
  };
};

export const roundRect = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
};

export const circle = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  g.beginPath();
  g.arc(x, y, Math.max(0, r), 0, TAU);
};

/** A piece's mark, filled, centred on (x, y). */
export const drawMark = (
  g: CanvasRenderingContext2D,
  mark: Mark,
  x: number,
  y: number,
  r: number,
  color: string,
) => {
  g.fillStyle = color;
  g.beginPath();
  switch (mark) {
    case "circle":
      g.arc(x, y, r, 0, TAU);
      break;
    case "square":
      g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
      break;
    case "triangle":
      g.moveTo(x, y - r);
      g.lineTo(x + r * 0.95, y + r * 0.7);
      g.lineTo(x - r * 0.95, y + r * 0.7);
      g.closePath();
      break;
    case "diamond":
      g.moveTo(x, y - r * 1.05);
      g.lineTo(x + r * 0.95, y);
      g.lineTo(x, y + r * 1.05);
      g.lineTo(x - r * 0.95, y);
      g.closePath();
      break;
  }
  g.fill();
};

/** Shuffled 0..n-1. */
export const shuffled = (n: number, rng: Rng): number[] => {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

/** Ms of a bot gesture at `pace`. */
export const paced = (ms: number, pace: number) => ms / Math.max(0.05, pace);

export const centre = (r: { x: number; y: number; w: number; h: number }): Pt => ({
  x: r.x + r.w / 2,
  y: r.y + r.h / 2,
});

export const inside = (
  r: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
  pad = 0,
) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
