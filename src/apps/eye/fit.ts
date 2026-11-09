/**
 * Fitting text into boxes. In the browser the card shrinks its font until the text fits; tests
 * use the estimate here (a conservative average glyph width) to check every caption fits its box
 * at or above the layout's smallest size.
 */

/** Average advance of a glyph in the UI font at weight 500 to 600, as a share of the size. */
export const GLYPH = 0.53;
export const LINE = 1.24;

/** Lines `text` wraps to at `px` in a box `width` wide (greedy, by words). */
export const wrapCount = (text: string, width: number, px: number): number => {
  const per = Math.max(1, Math.floor(width / (px * GLYPH)));
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    const n = word.length;
    if (used === 0) used = n;
    else if (used + 1 + n <= per) used += 1 + n;
    else {
      lines++;
      used = n;
    }
  }
  return lines;
};

/** Height of `text` at `px`, wrapped in `width`. */
export const textHeight = (text: string, width: number, px: number): number =>
  wrapCount(text, width, px) * px * LINE;

/** The largest size from `max` down to `min` at which a title and text fit the box, or null. */
export const fitSize = (
  box: { width: number; height: number },
  text: string,
  max: number,
  min: number,
  title?: { text: string; scale: number },
): number | null => {
  for (let px = max; px >= min; px -= 1) {
    const t = title ? textHeight(title.text, box.width, px * title.scale) + px * 0.35 : 0;
    if (t + textHeight(text, box.width, px) <= box.height) return px;
  }
  return null;
};

/** In the browser: shrink `el`'s font from `max` until its content fits, not below `min`. */
export const fitElement = (el: HTMLElement, max: number, min: number): number => {
  let px = max;
  el.style.fontSize = `${px}px`;
  while (px > min && el.scrollHeight > el.clientHeight + 1) {
    px = Math.max(min, px * 0.94);
    el.style.fontSize = `${px}px`;
  }
  return px;
};
