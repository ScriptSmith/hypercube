/**
 * Touches on the controls, in venue px. Pure: real fingers, bots' injected touches and the
 * demonstration's ghost fingers all come through here.
 *
 * A dial turns with the finger's angle around its centre, one to one: a finger dragged a
 * quarter turn clockwise turns that joint's target a quarter turn the positive way. Only the
 * change counts, so a finger can take a dial anywhere on it. A second finger on a dial takes it
 * over. The grip button toggles on touch.
 */
import type { Cell } from "./cell";
import { controlAt, type Layout } from "./layout";
import { wrapAngle } from "./math";

/** A finger nearer the centre than this share of the radius gives no reliable angle. */
const DEAD_CENTRE = 0.16;
const MAX_FINGERS = 40;

export interface Hold {
  cell: number;
  joint: number;
  /** Last angle of the finger around the dial's centre, or null inside the dead centre. */
  last: number | null;
  x: number;
  y: number;
}

export interface Controls {
  /** `kind` says whose finger it is: a ghost finger never takes an arm off its demonstration. */
  down(id: number, x: number, y: number, kind: "person" | "bot" | "ghost", now: number): boolean;
  move(id: number, x: number, y: number, now: number): void;
  up(id: number): void;
  /** Fingers on dials. */
  readonly holds: ReadonlyMap<number, Hold>;
  /** The finger holding a cell's dial, if any. */
  holder(cell: number, joint: number): number | null;
  setLayout(layout: Layout): void;
  clear(): void;
}

export const createControls = (cells: readonly Cell[], initial: Layout): Controls => {
  let layout = initial;
  const holds = new Map<number, Hold>();
  const kinds = new Map<number, "person" | "bot" | "ghost">();

  const dialOf = (h: Hold) => layout.cells[h.cell]?.dials[h.joint] ?? null;

  const touch = (cell: Cell, kind: "person" | "bot" | "ghost", now: number) => {
    if (kind === "ghost") return;
    cell.lastTouch = now;
    if (kind === "person") cell.lastHuman = now;
    cell.mode = "people";
  };

  const holder = (cell: number, joint: number): number | null => {
    for (const [id, h] of holds) if (h.cell === cell && h.joint === joint) return id;
    return null;
  };

  return {
    holds,
    holder,
    down(id, x, y, kind, now) {
      const hit = controlAt(layout, x, y);
      if (!hit) return false;
      const cell = cells[hit.cell];
      if (!cell) return false;
      // A ghost finger yields to anyone else on the arm.
      if (kind === "ghost" && cell.mode !== "demo") return false;
      touch(cell, kind, now);
      if (hit.kind === "grip") {
        cell.pressGrip();
        return true;
      }
      const prev = holder(hit.cell, hit.joint);
      if (prev !== null) {
        holds.delete(prev);
        kinds.delete(prev);
      }
      if (holds.size >= MAX_FINGERS) {
        const oldest = holds.keys().next().value;
        if (oldest !== undefined) {
          holds.delete(oldest);
          kinds.delete(oldest);
        }
      }
      const h: Hold = { cell: hit.cell, joint: hit.joint, last: null, x, y };
      const d = dialOf(h);
      if (d && Math.hypot(x - d.x, y - d.y) >= d.r * DEAD_CENTRE)
        h.last = Math.atan2(y - d.y, x - d.x);
      holds.set(id, h);
      kinds.set(id, kind);
      return true;
    },
    move(id, x, y, now) {
      const h = holds.get(id);
      if (!h) return;
      h.x = x;
      h.y = y;
      const d = dialOf(h);
      const cell = cells[h.cell];
      if (!d || !cell) return;
      const kind = kinds.get(id) ?? "person";
      if (kind === "ghost" && cell.mode !== "demo") {
        holds.delete(id);
        kinds.delete(id);
        return;
      }
      if (Math.hypot(x - d.x, y - d.y) < d.r * DEAD_CENTRE) {
        h.last = null;
        return;
      }
      const a = Math.atan2(y - d.y, x - d.x);
      if (h.last !== null) {
        const delta = wrapAngle(a - h.last);
        if (delta !== 0) {
          cell.turn(h.joint, delta);
          touch(cell, kind, now);
        }
      }
      h.last = a;
    },
    up(id) {
      holds.delete(id);
      kinds.delete(id);
    },
    setLayout(next) {
      layout = next;
      holds.clear();
      kinds.clear();
    },
    clear() {
      holds.clear();
      kinds.clear();
    },
  };
};
