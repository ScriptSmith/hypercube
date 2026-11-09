import type { Rect } from "../../core/types";

export const px = (n: number): string => `${Math.round(n * 100) / 100}px`;

export const place = (el: HTMLElement, r: Rect): void => {
  el.style.left = px(r.x);
  el.style.top = px(r.y);
  el.style.width = px(r.width);
  el.style.height = px(r.height);
};

export const div = (className: string, text?: string): HTMLElement => {
  const el = document.createElement("div");
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

/**
 * Whether the text fits its box. One line only needs the width: glyphs can poke a pixel or two
 * past a tight line height without anything being cut off.
 */
const fits = (el: HTMLElement, oneLine: boolean) =>
  el.scrollWidth <= el.clientWidth + 1 && (oneLine || el.scrollHeight <= el.clientHeight + 2);

/** Shrink `el` in steps from `from` until it fits its box or reaches `floor`. */
export const shrink = (el: HTMLElement, from: number, floor: number, oneLine = false): boolean => {
  for (let s = from; ; s = Math.max(floor, s * 0.93)) {
    el.style.fontSize = px(s);
    if (fits(el, oneLine)) return true;
    if (s <= floor) return false;
  }
};

/**
 * One line reads best from a distance, so a long label first shrinks a little on one line,
 * then wraps onto two at full size and shrinks again if it must.
 */
export const fitLabel = (el: HTMLElement, size: number): void => {
  el.style.whiteSpace = "nowrap";
  if (shrink(el, size, size * 0.82, true)) return;
  el.style.whiteSpace = "normal";
  shrink(el, size, size * 0.5);
};
