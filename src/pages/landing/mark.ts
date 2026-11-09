/**
 * The brand mark: a tesseract in perspective, seen face on, which is two nested squares joined
 * at the corners. Every few seconds it turns a quarter turn through the fourth dimension, so one
 * cube passes through the other: sideways (the xw plane), then up (yw), then straight through
 * itself (zw). A quarter turn maps the tesseract onto itself, so each pass ends where it began.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** The 16 corners of a tesseract, (x, y, z, w) each ±1. */
const CORNERS: readonly (readonly number[])[] = Array.from({ length: 16 }, (_, i) =>
  [0, 1, 2, 3].map((axis) => ((i >> axis) & 1 ? 1 : -1)),
);

/** The 32 edges join corners that differ in one coordinate. */
export const EDGES: readonly (readonly [number, number])[] = CORNERS.flatMap((_, i) =>
  [0, 1, 2, 3].map((axis) => [i, i ^ (1 << axis)] as const).filter(([a, b]) => a < b),
);

/** Rotation planes for successive passes: xw, yw, zw. */
export const PLANES: readonly (readonly [number, number])[] = [
  [0, 3],
  [1, 3],
  [2, 3],
];

/** Distance of the eye along w. It sets the inner cube to 7/17 of the outer, as the mark drew it. */
const EYE = 2.4;
const CENTRE = 10;
/** Half the drawn size: the outer square at rest, and the furthest corner while turning. */
const HALF = 8.5;
export const PASS_MS = 1700;
export const REST_MS = 2600;

export interface Projected {
  x: number;
  y: number;
  /** Depth along w after the turn, from -√2 (far) to √2 (near). */
  w: number;
}

/**
 * Corners after turning `angle` radians in `plane`, in perspective along w and seen along z, in
 * the mark's 20-unit box. The drawing is scaled to keep its furthest corner `HALF` from the
 * centre, so at rest it is exactly the static mark and mid-turn it stays inside the box.
 */
export const projectTesseract = (plane: readonly [number, number], angle: number): Projected[] => {
  const [a, b] = plane;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const raw = CORNERS.map((corner) => {
    const v = [...corner];
    const p = v[a]!;
    const q = v[b]!;
    v[a] = p * c - q * s;
    v[b] = p * s + q * c;
    const scale = 1 / (EYE - v[3]!);
    return { x: v[0]! * scale, y: v[1]! * scale, w: v[3]! };
  });
  const reach = Math.max(...raw.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const fit = HALF / reach;
  return raw.map((p) => ({ x: CENTRE + p.x * fit, y: CENTRE + p.y * fit, w: p.w }));
};

export const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * The mark as an SVG that animates while it is in the document. Nearer edges are brighter.
 * It stays still for people who ask for reduced motion, and pauses while the page is hidden.
 */
export const createMark = (size = 20): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("fill", "none");
  g.setAttribute("stroke", "currentColor");
  g.setAttribute("stroke-width", "1.6");
  g.setAttribute("stroke-linecap", "round");
  const lines = EDGES.map(() => g.appendChild(document.createElementNS(SVG_NS, "line")));
  svg.append(g);

  const draw = (plane: readonly [number, number], angle: number) => {
    const pts = projectTesseract(plane, angle);
    EDGES.forEach(([i, j], k) => {
      const p = pts[i]!;
      const q = pts[j]!;
      const line = lines[k]!;
      line.setAttribute("x1", r2(p.x));
      line.setAttribute("y1", r2(p.y));
      line.setAttribute("x2", r2(q.x));
      line.setAttribute("y2", r2(q.y));
      const depth = (p.w + q.w) / (4 * Math.SQRT2) + 0.5;
      line.setAttribute("stroke-opacity", r2(0.55 + 0.45 * depth));
    });
  };
  draw(PLANES[0]!, 0);

  const motion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (typeof requestAnimationFrame !== "function") return svg;

  let pass = 0;
  let timer = 0;
  const rest = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(turn, REST_MS);
  };
  const turn = () => {
    // A mark taken out of the page stops for good; the rest wait until it can be seen.
    if (!svg.isConnected) return;
    if (document.hidden || motion?.matches) {
      rest();
      return;
    }
    const plane = PLANES[pass++ % PLANES.length]!;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / PASS_MS);
      draw(plane, (ease(t) * Math.PI) / 2);
      if (t < 1 && svg.isConnected) requestAnimationFrame(step);
      else rest();
    };
    requestAnimationFrame(step);
  };
  rest();
  return svg;
};
