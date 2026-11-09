import type { Rng } from "../../core/types";
import type { PlateBox, Rect } from "./layout";
import type { PlateShape } from "./modes";

/**
 * The plates' brushed dark metal, drawn once per layout into one canvas per plate under the
 * sand. Streaks run one way across each plate; a soft sheen and a bevelled edge make it read as a
 * metal sheet. A stretched plate stretches its canvas, so nothing is redrawn while a slider moves.
 */
export interface PlateArt {
  /** Draw plate `index` at `rect` (venue px). */
  place(index: number, rect: Rect): void;
  dispose(): void;
}

/** Room around the plate for its shadow, as a share of the plate's size. */
const PAD = 0.06;

export const createPlateArt = (
  host: HTMLElement,
  plates: readonly PlateBox[],
  shape: PlateShape,
  unit: number,
  pixelRatio: number,
  rng: Rng,
): PlateArt => {
  const scale = unit * Math.min(2, pixelRatio);
  const canvases = plates.map((p) => {
    const c = document.createElement("canvas");
    const side = p.size * (1 + 2 * PAD);
    c.width = Math.max(1, Math.round(side * scale));
    c.height = c.width;
    c.style.cssText = "position:absolute;display:block;";
    drawPlate(c, p.size * scale, PAD * p.size * scale, shape, scale, rng);
    host.append(c);
    return { c, size: p.size, last: "" };
  });
  const art: PlateArt = {
    place(index, rect) {
      const d = canvases[index];
      if (!d) return;
      const key = `${rect.cx.toFixed(1)}:${rect.cy.toFixed(1)}:${rect.width.toFixed(1)}:${rect.height.toFixed(1)}`;
      if (key === d.last) return;
      d.last = key;
      const w = rect.width * (1 + 2 * PAD);
      const h = rect.height * (1 + 2 * PAD);
      d.c.style.left = `${(rect.cx - w / 2) * unit}px`;
      d.c.style.top = `${(rect.cy - h / 2) * unit}px`;
      d.c.style.width = `${w * unit}px`;
      d.c.style.height = `${h * unit}px`;
    },
    dispose() {
      for (const d of canvases) d.c.remove();
    },
  };
  plates.forEach((p, i) => art.place(i, { cx: p.cx, cy: p.cy, width: p.size, height: p.size }));
  return art;
};

const drawPlate = (
  canvas: HTMLCanvasElement,
  s: number,
  pad: number,
  shape: PlateShape,
  scale: number,
  rng: Rng,
): void => {
  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const x = pad;
  const y = pad;
  const cx = x + s / 2;
  const cy = y + s / 2;
  g.save();
  g.beginPath();
  if (shape === "round") g.arc(cx, cy, s / 2, 0, Math.PI * 2);
  else g.roundRect(x, y, s, s, 26 * scale);
  // A shadow first, so the plate floats a little above the background.
  g.shadowColor = "rgba(0,0,0,0.7)";
  g.shadowBlur = Math.min(pad * 0.9, 40 * scale);
  g.fillStyle = "#1b2027";
  g.fill();
  g.shadowBlur = 0;
  g.clip();
  const base = g.createLinearGradient(x, y, x + s, y + s);
  base.addColorStop(0, "#2a3039");
  base.addColorStop(0.5, "#1c2129");
  base.addColorStop(1, "#262c35");
  g.fillStyle = base;
  g.fillRect(x, y, s, s);
  // Brushed streaks: many faint horizontal hairlines of varying length and brightness.
  const lines = Math.min(1400, Math.round(s / 1.6));
  for (let i = 0; i < lines; i++) {
    const ly = y + rng.next() * s;
    const lx = x + rng.range(-0.2, 0.9) * s;
    const len = rng.range(0.15, 0.7) * s;
    const light = rng.next() < 0.5;
    g.strokeStyle = light
      ? `rgba(200,215,235,${rng.range(0.015, 0.05)})`
      : `rgba(0,0,0,${rng.range(0.03, 0.09)})`;
    g.lineWidth = Math.max(0.5, rng.range(0.6, 1.8) * scale);
    g.beginPath();
    g.moveTo(lx, ly);
    g.lineTo(lx + len, ly + rng.range(-0.004, 0.004) * s);
    g.stroke();
  }
  const sheen = g.createRadialGradient(cx - s * 0.2, cy - s * 0.25, 0, cx, cy, s * 0.75);
  sheen.addColorStop(0, "rgba(170,190,215,0.10)");
  sheen.addColorStop(1, "rgba(0,0,0,0.18)");
  g.fillStyle = sheen;
  g.fillRect(x, y, s, s);
  g.restore();
  // Bevel: a light edge above and a dark one below.
  g.save();
  g.beginPath();
  if (shape === "round") g.arc(cx, cy, s / 2 - 2 * scale, 0, Math.PI * 2);
  else g.roundRect(x + 2 * scale, y + 2 * scale, s - 4 * scale, s - 4 * scale, 24 * scale);
  const edge = g.createLinearGradient(x, y, x, y + s);
  edge.addColorStop(0, "rgba(220,230,245,0.28)");
  edge.addColorStop(1, "rgba(0,0,0,0.5)");
  g.strokeStyle = edge;
  g.lineWidth = Math.max(1, 5 * scale);
  g.stroke();
  g.restore();
};
