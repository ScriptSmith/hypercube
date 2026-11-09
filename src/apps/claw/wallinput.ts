/**
 * Touches on the wall, from stage px to the arcade: a finger on a button holds or presses it, a
 * finger elsewhere on a cabinet makes its buttons flash, and one in its hatch makes the prizes
 * there hop. A finger may wander a little off its button and keep holding it.
 */
import type { Hand, WallArcade } from "./wallarcade";
import { type Button, buttonAt, cabinetAt, type WallLayout } from "./walllayout";

export interface TouchLike {
  id: number;
  /** Stage px. */
  x: number;
  y: number;
  synthetic: boolean;
}

export interface WallInput {
  down(p: TouchLike): void;
  move(p: TouchLike): void;
  up(id: number): void;
  clear(): void;
}

export interface WallInputOptions {
  arcade(): WallArcade;
  layout(): WallLayout;
  /** Stage px per venue px. */
  unit(): number;
}

/** How far past its press radius a held finger may wander. */
const KEEP = 1.35;
const MAX_HELD = 40;

export const createWallInput = (o: WallInputOptions): WallInput => {
  const held = new Map<number, { cabinet: number; button: Button }>();
  const venue = (p: TouchLike) => ({ x: p.x / o.unit(), y: p.y / o.unit() });
  const hand = (p: TouchLike): Hand => (p.synthetic ? "bot" : "person");

  return {
    down(p) {
      const l = o.layout();
      const a = o.arcade();
      const v = venue(p);
      const hit = buttonAt(l, v.x, v.y);
      if (hit) {
        if (held.size >= MAX_HELD) {
          const first = held.keys().next().value;
          if (first !== undefined) {
            held.delete(first);
            a.up(first);
          }
        }
        held.set(p.id, hit);
        a.down(p.id, hit.cabinet, hit.button, hand(p));
        return;
      }
      const c = cabinetAt(l, v.x, v.y);
      if (c === null) return;
      a.poke(c, hand(p));
      const h = l.cabinets[c]!.hatch;
      if (v.x >= h.x && v.x <= h.x + h.width && v.y >= h.y && v.y <= h.y + h.height) {
        a.seats[c]!.tray.poke((v.x - h.x) / h.width, a.time);
      }
    },
    move(p) {
      const h = held.get(p.id);
      if (!h) return;
      const l = o.layout();
      const v = venue(p);
      const cab = l.cabinets[h.cabinet];
      const b = cab?.buttons[h.button];
      if (cab && b && Math.hypot(v.x - b.x, v.y - b.y) <= cab.hit[h.button] * KEEP) {
        // Still on its own button, unless it has reached the other arrow.
        const other = buttonAt(l, v.x, v.y);
        if (!other || other.button === h.button || other.cabinet !== h.cabinet) return;
      }
      const to = buttonAt(l, v.x, v.y);
      o.arcade().slide(p.id, to);
      if (to && to.cabinet === h.cabinet && to.button !== "drop" && h.button !== "drop") {
        held.set(p.id, to);
      } else {
        held.delete(p.id);
      }
    },
    up(id) {
      held.delete(id);
      o.arcade().up(id);
    },
    clear() {
      held.clear();
    },
  };
};
