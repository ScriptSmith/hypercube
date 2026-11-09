import type { Box } from "./config";
import { E, type ElementId, isFlowing } from "./elements";
import type { ToolKind } from "./swatches";

/**
 * Gadgets: a geyser that throws whatever falls on it up into the sky, a fan that blows things
 * sideways, a heater and a cooler, and a spout that pours by itself for a minute. They act
 * through zones and emitters and are never stamped into the world, so they leave no shape behind;
 * like pieces they are few (the oldest is recycled) and kept apart.
 */
export type GadgetKind = Exclude<ToolKind, "beetle">;

export interface Gadget {
  id: number;
  kind: GadgetKind;
  /** Centre in venue px. */
  x: number;
  y: number;
  /** A fan blows this way. */
  dir: 1 | -1;
  /** What a spout pours. */
  element: ElementId;
  placedAt: number;
  /** A spout stops pouring and goes away at this time. */
  until: number;
}

export interface GadgetRules {
  cap: number;
  /** Gadgets closer than this (venue px, centre to centre) to a new one are recycled. */
  gap: number;
  bounds: Box;
  /** How long a spout pours (ms). */
  spoutMs: number;
}

/** A zone in venue px (y down). */
export interface GadgetZone {
  box: Box;
  kind: "lift" | "right" | "left";
  strength: number;
}

export interface GadgetSizes {
  /** Geyser column width. */
  jetWidth: number;
  /** Venue y a geyser's column reaches. */
  jetTop: number;
  fanReach: number;
  fanHeight: number;
  heatRadius: number;
}

export interface Gadgets {
  readonly list: readonly Gadget[];
  place(
    kind: GadgetKind,
    x: number,
    y: number,
    element: ElementId,
    now: number,
  ): { gadget: Gadget; removed: Gadget[] };
  /** The gadget under (x, y), with slop. */
  at(x: number, y: number, slop: number): Gadget | null;
  /** Turn a fan round. */
  flip(id: number): void;
  remove(id: number): void;
  /** Drop spouts that have run out. */
  expire(now: number): void;
  zones(sizes: GadgetSizes, out: GadgetZone[]): number;
  clear(): void;
}

export const createGadgets = (rules: GadgetRules): Gadgets => {
  let list: Gadget[] = [];
  let nextId = 1;
  const b = rules.bounds;
  const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  return {
    get list() {
      return list;
    },

    place(kind, x, y, element, now) {
      const cx = clampTo(x, b.x + 40, b.x + b.width - 40);
      const cy = clampTo(y, b.y + 40, b.y + b.height - 40);
      const g: Gadget = {
        id: nextId++,
        kind,
        x: cx,
        y: cy,
        // Fans blow towards the middle of the world.
        dir: cx < b.x + b.width / 2 ? 1 : -1,
        element: isFlowing(element) ? element : E.WATER,
        placedAt: now,
        until: kind === "spout" ? now + rules.spoutMs : Infinity,
      };
      const removed = list.filter((o) => Math.hypot(o.x - cx, o.y - cy) < rules.gap);
      list = list.filter((o) => !removed.includes(o));
      while (list.length >= Math.max(1, rules.cap)) {
        const oldest = list.shift();
        if (oldest) removed.push(oldest);
      }
      list.push(g);
      return { gadget: g, removed };
    },

    at(x, y, slop) {
      for (let i = list.length - 1; i >= 0; i--) {
        const g = list[i];
        if (g && Math.hypot(g.x - x, g.y - y) <= slop) return g;
      }
      return null;
    },

    flip(id) {
      const g = list.find((o) => o.id === id);
      if (g) g.dir = g.dir === 1 ? -1 : 1;
    },

    remove(id) {
      list = list.filter((g) => g.id !== id);
    },

    expire(now) {
      list = list.filter((g) => g.until > now);
    },

    zones(sizes, out) {
      let n = 0;
      for (const g of list) {
        if (g.kind === "geyser") {
          const top = Math.min(sizes.jetTop, g.y - 200);
          out[n++] = {
            box: {
              x: g.x - sizes.jetWidth / 2,
              y: top,
              width: sizes.jetWidth,
              height: g.y + 50 - top,
            },
            kind: "lift",
            strength: 0.92,
          };
        } else if (g.kind === "fan") {
          const x0 = g.dir === 1 ? g.x : g.x - sizes.fanReach;
          out[n++] = {
            box: {
              x: x0,
              y: g.y - sizes.fanHeight / 2,
              width: sizes.fanReach,
              height: sizes.fanHeight,
            },
            kind: g.dir === 1 ? "right" : "left",
            strength: 0.55,
          };
        }
      }
      return n;
    },

    clear() {
      list = [];
    },
  };
};
