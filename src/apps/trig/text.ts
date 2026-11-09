/**
 * Text on the canvas: runs of plain text, stacked fractions and square roots, laid out on one
 * line, so "√3/2" reads as a fraction from across a room. Coordinates are venue px; text is
 * centred on `y`.
 */
import { FONT } from "../../core/ui/style";
import type { Exact } from "./maths";
import { MINUS } from "./maths";

export type Item =
  | { k: "t"; s: string; c?: string; bold?: boolean }
  | { k: "frac"; num: string; den: string; c?: string }
  | { k: "gap"; em: number };

export const font = (size: number, bold = true): string =>
  `${bold ? 700 : 500} ${Math.max(1, size)}px ${FONT}`;

const FRAC = 0.66;

/** Width of text that may start with a root sign, drawn with its bar. */
const rootWidth = (g: CanvasRenderingContext2D, s: string, size: number): number => {
  g.font = font(size);
  return g.measureText(s).width + (s.startsWith("√") ? size * 0.06 : 0);
};

/** Text with a leading √ gets a bar over what follows it. */
const drawRoot = (
  g: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  colour: string,
) => {
  g.font = font(size);
  g.fillStyle = colour;
  g.textAlign = "left";
  g.textBaseline = "middle";
  if (!s.startsWith("√")) {
    g.fillText(s, x, y);
    return;
  }
  const rootW = g.measureText("√").width;
  const body = s.slice(1);
  g.fillText("√", x, y);
  const bx = x + rootW + size * 0.03;
  g.fillText(body, bx, y);
  const bw = g.measureText(body).width;
  g.fillRect(x + rootW * 0.82, y - size * 0.5, bw + rootW * 0.18 + size * 0.06, size * 0.065);
};

const itemWidth = (g: CanvasRenderingContext2D, it: Item, size: number): number => {
  if (it.k === "gap") return it.em * size;
  if (it.k === "t") {
    if (it.s.startsWith("√")) return rootWidth(g, it.s, size);
    g.font = font(size, it.bold !== false);
    return g.measureText(it.s).width;
  }
  const fs = size * FRAC;
  return Math.max(rootWidth(g, it.num, fs), rootWidth(g, it.den, fs)) + size * 0.16;
};

export const runWidth = (g: CanvasRenderingContext2D, items: readonly Item[], size: number) =>
  items.reduce((w, it) => w + itemWidth(g, it, size), 0);

/** Draw a run with its left end at x; returns its width. */
export const drawRun = (
  g: CanvasRenderingContext2D,
  items: readonly Item[],
  x: number,
  y: number,
  size: number,
  colour: string,
): number => {
  let cx = x;
  for (const it of items) {
    const w = itemWidth(g, it, size);
    if (it.k === "t") {
      if (it.s.startsWith("√")) drawRoot(g, it.s, cx, y, size, it.c ?? colour);
      else {
        g.font = font(size, it.bold !== false);
        g.fillStyle = it.c ?? colour;
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.fillText(it.s, cx, y);
      }
    } else if (it.k === "frac") {
      const fs = size * FRAC;
      const c = it.c ?? colour;
      const nw = rootWidth(g, it.num, fs);
      const dw = rootWidth(g, it.den, fs);
      const inner = w - size * 0.16;
      drawRoot(g, it.num, cx + size * 0.08 + (inner - nw) / 2, y - size * 0.36, fs, c);
      drawRoot(g, it.den, cx + size * 0.08 + (inner - dw) / 2, y + size * 0.42, fs, c);
      g.fillStyle = c;
      g.fillRect(cx + size * 0.04, y + size * 0.01, w - size * 0.08, Math.max(1, size * 0.06));
    }
    cx += w;
  }
  return cx - x;
};

/** An exact value as items: "−", then a fraction or a plain number. */
export const exactItems = (e: Exact, c?: string): Item[] => {
  const out: Item[] = [];
  if (e.neg) out.push({ k: "t", s: MINUS, c });
  if (e.den === 1) out.push({ k: "t", s: e.num, c });
  else out.push({ k: "frac", num: e.num, den: String(e.den), c });
  return out;
};

/** Split text into at most `lines` lines that fit `width` at `size`; shrinks the size if not. */
export const fitLines = (
  g: CanvasRenderingContext2D,
  text: string,
  width: number,
  size: number,
  lines: number,
  minSize = size * 0.6,
): { lines: string[]; size: number } => {
  for (let sz = size; sz >= minSize; sz *= 0.92) {
    g.font = font(sz);
    const words = text.split(" ");
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (g.measureText(next).width <= width || !cur) cur = next;
      else {
        out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
    if (out.length <= lines && out.every((l) => g.measureText(l).width <= width)) {
      return { lines: out, size: sz };
    }
  }
  g.font = font(minSize);
  return { lines: [text], size: minSize };
};
