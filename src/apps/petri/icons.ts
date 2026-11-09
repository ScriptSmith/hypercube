import { type Pattern, soupCells } from "./life";
import type { Family, StampDef } from "./stamps";

/**
 * Icons for stamps and conditions, as SVG on a 100 x 100 grid. Bold shapes that read from across
 * a room; no text anywhere.
 */
const svg = (body: string) =>
  `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" style="display:block;overflow:visible">${body}</svg>`;

const cellsSvg = (
  cells: readonly (readonly [number, number])[],
  w: number,
  h: number,
  color: string,
) => {
  const size = Math.min(78 / Math.max(w, h), 22);
  const ox = 50 - (w * size) / 2;
  const oy = 50 - (h * size) / 2;
  const pad = size * 0.12;
  return cells
    .map(
      ([x, y]) =>
        `<rect x="${(ox + x * size + pad).toFixed(1)}" y="${(oy + y * size + pad).toFixed(1)}" ` +
        `width="${(size - 2 * pad).toFixed(1)}" height="${(size - 2 * pad).toFixed(1)}" ` +
        `rx="${(size * 0.32).toFixed(1)}" fill="${color}"/>`,
    )
    .join("");
};

const patternSvg = (p: Pattern, color: string) => cellsSvg(p.cells, p.width, p.height, color);

const SOUP = soupCells(4.6, 0.5, 7).map(([x, y]) => [x + 5, y + 5] as const);

const ring = (n: number, r: number, dot: number, color: string, phase = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return `<circle cx="${(50 + Math.cos(a) * r).toFixed(1)}" cy="${(50 + Math.sin(a) * r).toFixed(1)}" r="${dot}" fill="${color}"/>`;
  }).join("");

const stroke = (d: string, color: string, width = 7) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The colour a stamp's tile glows in. */
export const stampTint = (s: StampDef): string => {
  switch (s.kind) {
    case "soup":
    case "pattern":
      return "#8fe8c8";
    case "spore":
      return "#f5c542";
    case "food":
      return "#ffbe5c";
    case "salt":
      return "#bfe3ff";
    case "reagent":
      return "#5fe0ea";
    case "wash":
      return "#9fd4ff";
  }
};

export const stampIcon = (s: StampDef): string => {
  const c = stampTint(s);
  switch (s.kind) {
    case "soup":
      return svg(cellsSvg(SOUP, 11, 11, c));
    case "pattern":
      return svg(s.pattern ? patternSvg(s.pattern, c) : "");
    case "spore":
      return svg(
        ring(10, 30, 6.5, c) +
          ring(5, 13, 5, c, 0.6) +
          `<circle cx="50" cy="50" r="5" fill="${c}"/>`,
      );
    case "food":
      return svg(
        `<circle cx="50" cy="52" r="30" fill="${c}"/>` +
          `<circle cx="40" cy="41" r="9" fill="#fff6dc" opacity="0.85"/>` +
          `<circle cx="66" cy="66" r="6" fill="#d9822b" opacity="0.5"/>`,
      );
    case "salt":
      return svg(
        `<path d="M50 14L81 32V68L50 86L19 68V32Z" fill="${c}" opacity="0.28"/>` +
          stroke("M50 14L81 32V68L50 86L19 68V32Z", c, 6) +
          stroke("M50 14V50M19 68L50 50L81 68", c, 4),
      );
    case "reagent": {
      const r = s.id === "drop-s" ? 14 : s.id === "drop-l" ? 34 : 23;
      return svg(
        `<circle cx="50" cy="50" r="${r}" fill="${c}"/>` +
          `<circle cx="${50 - r * 0.35}" cy="${50 - r * 0.38}" r="${r * 0.28}" fill="#ffffff" opacity="0.7"/>`,
      );
    }
    case "wash":
      return svg(
        `<circle cx="50" cy="50" r="34" fill="none" stroke="${c}" stroke-width="6" stroke-dasharray="9 9"/>` +
          stroke("M30 56C37 48 43 48 50 56C57 64 63 64 70 56", c, 7),
      );
  }
};

const network = (lines: string, nodes: [number, number][], color: string, width: number) =>
  stroke(lines, color, width) +
  nodes
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${width * 0.9}" fill="${color}"/>`)
    .join("");

/** Icons for the dial's detents, by family and preset index. */
export const presetIcon = (family: Family, index: number, color = "#e6f2f6"): string => {
  if (family === "slime") {
    switch (index) {
      case 0:
        return svg(
          stroke(
            "M18 30q8-8 16 0M58 22q8 6 18 2M24 66q6 8 16 4M62 58q4 10 14 12M42 46q6-6 12 0",
            color,
            6,
          ),
        );
      case 1:
        return svg(
          network(
            "M20 30L50 46L80 26M50 46L44 80M20 30L26 70L44 80",
            [
              [20, 30],
              [50, 46],
              [80, 26],
              [44, 80],
              [26, 70],
            ],
            color,
            5,
          ),
        );
      case 2:
        return svg(
          network(
            "M16 24L40 18L62 30L84 22M40 18L36 48L62 30L66 58L84 64M36 48L18 62L40 82L66 58M40 82L70 86",
            [
              [40, 18],
              [62, 30],
              [36, 48],
              [66, 58],
              [18, 62],
              [40, 82],
            ],
            color,
            4,
          ),
        );
      default:
        return svg(
          stroke("M14 70C34 62 46 50 52 30M52 30C58 46 70 56 88 60M52 30L56 12", color, 11),
        );
    }
  }
  switch (index) {
    case 0:
      return svg(
        `<circle cx="30" cy="38" r="12" fill="${color}"/><circle cx="66" cy="30" r="10" fill="${color}"/>` +
          `<path d="M44 64a11 11 0 1 1 0.1 0ZM62 70a11 11 0 1 1 0.1 0Z" fill="${color}"/>` +
          `<rect x="44" y="56" width="18" height="12" rx="6" fill="${color}"/>`,
      );
    case 1:
      return svg(
        stroke(
          "M50 88V54M50 54L28 30M50 54L74 34M28 30L22 12M28 30L40 14M74 34L66 14M74 34L88 22M50 70L30 62M50 70L70 64",
          color,
          7,
        ),
      );
    case 2:
      return svg(
        stroke(
          "M14 30c10-10 20 10 30 0M54 22c8 8 18-6 28 2M18 62c8-8 18 8 26-2M52 54c10 10 20-8 30 2M30 84c8-6 16 6 26 0",
          color,
          7,
        ),
      );
    default:
      return svg(stroke("M14 14H86V86H26V26H74V74H38V38H62V62H50", color, 7));
  }
};
