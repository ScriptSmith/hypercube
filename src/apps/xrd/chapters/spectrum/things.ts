/**
 * Chapter 1's things for scale, drawn simply: a house, a person, a bee, a cell, a virus and an
 * atom. Each is drawn centred on (x, y) with its size (height for the house and the person,
 * length for the bee, width for the rest) `s` px. The atom is green like every real-space thing;
 * the others keep to colours the colour code leaves free.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { COLOR } from "../../config";
import { TAU } from "../../draw";
import type { ThingId } from "./physics";

const INK = "#c8d0de";
const HONEY = "#c9a34a";
const CELL = "#b9a6d8";
const VIRUS = "#9fb3c8";

type Draw = (g: CanvasRenderingContext2D, x: number, y: number, s: number) => void;

const house: Draw = (g, x, y, s) => {
  const w = s * 0.86;
  const top = y - s / 2;
  const eaves = top + s * 0.42;
  const base = y + s / 2;
  g.fillStyle = withAlpha(INK, 0.16);
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1, s * 0.022);
  g.lineJoin = "round";
  // Walls and roof.
  g.beginPath();
  g.moveTo(x - w / 2, base);
  g.lineTo(x - w / 2, eaves);
  g.lineTo(x, top);
  g.lineTo(x + w / 2, eaves);
  g.lineTo(x + w / 2, base);
  g.closePath();
  g.fill();
  g.stroke();
  // Chimney.
  g.strokeRect(x + w * 0.22, top + s * 0.1, w * 0.1, s * 0.16);
  // Two floors of windows and a door.
  const win = s * 0.12;
  for (const fx of [-0.28, 0.28]) {
    g.strokeRect(x + fx * w - win / 2, eaves + s * 0.07, win, win);
  }
  g.strokeRect(x - w * 0.28 - win / 2, eaves + s * 0.3, win, win);
  g.strokeRect(x + w * 0.1, base - s * 0.27, w * 0.18, s * 0.27);
};

const person: Draw = (g, x, y, s) => {
  const top = y - s / 2;
  g.fillStyle = withAlpha(INK, 0.85);
  g.beginPath();
  g.arc(x, top + s * 0.075, s * 0.07, 0, TAU);
  g.fill();
  g.strokeStyle = withAlpha(INK, 0.85);
  g.lineCap = "round";
  g.lineWidth = s * 0.085;
  const shoulder = top + s * 0.2;
  const hip = top + s * 0.53;
  g.beginPath();
  g.moveTo(x, shoulder);
  g.lineTo(x, hip);
  // Legs.
  g.moveTo(x, hip);
  g.lineTo(x - s * 0.08, y + s / 2 - s * 0.04);
  g.moveTo(x, hip);
  g.lineTo(x + s * 0.08, y + s / 2 - s * 0.04);
  g.stroke();
  // Arms, one held out.
  g.lineWidth = s * 0.065;
  g.beginPath();
  g.moveTo(x, shoulder + s * 0.03);
  g.lineTo(x - s * 0.13, shoulder + s * 0.25);
  g.moveTo(x, shoulder + s * 0.03);
  g.lineTo(x + s * 0.17, shoulder + s * 0.16);
  g.stroke();
};

const bee: Draw = (g, x, y, s) => {
  const rx = s * 0.36;
  const ry = s * 0.22;
  // Wings behind.
  g.fillStyle = withAlpha("#dfe8f5", 0.45);
  for (const k of [-1, 1]) {
    g.beginPath();
    g.ellipse(x - s * 0.02 + k * s * 0.1, y - ry * 1.15, s * 0.16, s * 0.1, k * 0.5, 0, TAU);
    g.fill();
  }
  // Body, stripes and head.
  g.save();
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
  g.fillStyle = HONEY;
  g.fill();
  g.clip();
  g.fillStyle = "#2a2418";
  for (const k of [-0.15, 0.05, 0.25]) g.fillRect(x + k * s - s * 0.045, y - ry, s * 0.09, 2 * ry);
  g.restore();
  g.fillStyle = "#2a2418";
  g.beginPath();
  g.arc(x - rx - s * 0.06, y - s * 0.02, s * 0.11, 0, TAU);
  g.fill();
  // Sting.
  g.beginPath();
  g.moveTo(x + rx - s * 0.01, y - s * 0.03);
  g.lineTo(x + rx + s * 0.1, y);
  g.lineTo(x + rx - s * 0.01, y + s * 0.03);
  g.fill();
};

const cell: Draw = (g, x, y, s) => {
  const r = s / 2;
  g.fillStyle = withAlpha(CELL, 0.18);
  g.strokeStyle = CELL;
  g.lineWidth = Math.max(1, s * 0.025);
  g.beginPath();
  // A slightly lumpy outline, so it reads as a cell rather than a ring.
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * TAU;
    const rr = r * (1 + 0.04 * Math.sin(a * 3) + 0.03 * Math.sin(a * 5 + 1));
    const px = x + rr * Math.cos(a);
    const py = y + rr * Math.sin(a);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = withAlpha(CELL, 0.55);
  g.beginPath();
  g.arc(x - r * 0.12, y - r * 0.05, r * 0.3, 0, TAU);
  g.fill();
  g.fillStyle = withAlpha(CELL, 0.4);
  for (const [dx, dy, k] of [
    [0.45, 0.3, 0.09],
    [0.35, -0.42, 0.07],
    [-0.5, 0.4, 0.08],
  ] as const) {
    g.beginPath();
    g.ellipse(x + dx * r, y + dy * r, k * r * 1.8, k * r, dx, 0, TAU);
    g.fill();
  }
};

const virus: Draw = (g, x, y, s) => {
  const r = s * 0.36;
  g.strokeStyle = VIRUS;
  g.fillStyle = VIRUS;
  g.lineWidth = Math.max(1, s * 0.03);
  g.lineCap = "round";
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    g.beginPath();
    g.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
    g.lineTo(x + s * 0.47 * Math.cos(a), y + s * 0.47 * Math.sin(a));
    g.stroke();
    g.beginPath();
    g.arc(x + s * 0.47 * Math.cos(a), y + s * 0.47 * Math.sin(a), s * 0.035, 0, TAU);
    g.fill();
  }
  g.fillStyle = withAlpha(VIRUS, 0.3);
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.stroke();
};

const atom: Draw = (g, x, y, s) => {
  const r = s / 2;
  const grad = g.createRadialGradient(x - r * 0.25, y - r * 0.25, 0, x, y, r);
  grad.addColorStop(0, withAlpha(COLOR.real, 0.95));
  grad.addColorStop(0.6, withAlpha(COLOR.real, 0.45));
  grad.addColorStop(1, withAlpha(COLOR.real, 0));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(x, y, Math.max(1, r * 0.06), 0, TAU);
  g.fill();
};

const DRAW: Record<ThingId, Draw> = { house, person, bee, cell, virus, atom };

/** Draw a thing centred on (x, y), `s` px across its size, at `alpha`. */
export const drawThing = (
  g: CanvasRenderingContext2D,
  id: ThingId,
  x: number,
  y: number,
  s: number,
  alpha = 1,
): void => {
  if (alpha <= 0.01 || s < 1) return;
  g.save();
  g.globalAlpha = alpha;
  DRAW[id](g, x, y, s);
  g.restore();
};

/** Visible light's colour at a wavelength (nm), roughly; dim at the ends of the band. */
export const lightColour = (nm: number): string => {
  const stops: readonly [number, [number, number, number]][] = [
    [380, [120, 40, 170]],
    [440, [70, 70, 230]],
    [490, [40, 190, 220]],
    [530, [70, 200, 80]],
    [580, [240, 220, 60]],
    [620, [245, 120, 50]],
    [700, [215, 40, 60]],
  ];
  const v = Math.max(380, Math.min(700, nm));
  for (let i = 0; i + 1 < stops.length; i++) {
    const [a, ca] = stops[i]!;
    const [b, cb] = stops[i + 1]!;
    if (v >= a && v <= b) {
      const t = (v - a) / (b - a);
      const c = ca.map((x, k) => Math.round(x + (cb[k]! - x) * t));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "rgb(215,40,60)";
};
