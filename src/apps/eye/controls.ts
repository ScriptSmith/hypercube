/**
 * What a touch lands on, in venue px: a slider, a tile, a button, More, a part chip or the eye.
 * Pure, so tests can check every control is reachable and none overlap.
 */
import { type ButtonId, inRect, type Layout, type Rect } from "./layout";

export type Hit =
  | { kind: "slider"; slot: number }
  | { kind: "tile"; index: number }
  | { kind: "button"; id: ButtonId }
  | { kind: "more" }
  | { kind: "chip"; index: number }
  | { kind: "eye" };

export interface Shown {
  sliders: number;
  buttons: ReadonlySet<ButtonId>;
  more: boolean;
}

/** The knob's radius in a slider slot, venue px (ui.ts draws it the same). */
export const knobRadius = (r: Rect): number => Math.min(r.height * 0.3, 40);

/** The value (0 to 1) under x in a slider slot. */
export const sliderValue = (r: Rect, x: number): number => {
  const k = knobRadius(r);
  return Math.min(1, Math.max(0, (x - r.x - k) / Math.max(1, r.width - 2 * k)));
};

/** The x of value v in a slider slot, for bots and the ghost hand. */
export const sliderX = (r: Rect, v: number): number => {
  const k = knobRadius(r);
  return r.x + k + Math.min(1, Math.max(0, v)) * (r.width - 2 * k);
};

export const hitAt = (l: Layout, x: number, y: number, shown: Shown): Hit | null => {
  for (let i = 0; i < Math.min(shown.sliders, l.sliderSlots.length); i++) {
    if (inRect(l.sliderSlots[i]!, x, y)) return { kind: "slider", slot: i };
  }
  for (let i = 0; i < l.tiles.length; i++)
    if (inRect(l.tiles[i]!, x, y)) return { kind: "tile", index: i };
  for (const [id, r] of Object.entries(l.buttons) as [ButtonId, Rect][]) {
    if (shown.buttons.has(id) && inRect(r, x, y)) return { kind: "button", id };
  }
  if (shown.more && inRect(l.more, x, y)) return { kind: "more" };
  for (let i = 0; i < l.chips.length; i++)
    if (inRect(l.chips[i]!, x, y)) return { kind: "chip", index: i };
  if (inRect(l.eye, x, y)) return { kind: "eye" };
  return null;
};
