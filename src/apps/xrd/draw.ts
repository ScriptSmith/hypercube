/**
 * Canvas helpers every chapter shares: the beam and waves, arrows, brackets, glows, labels and
 * the dark "well" a watch view sits in. Venue px; colours from the colour code in config.ts.
 */
import { withAlpha } from "../../core/ui/palette";
import { COLOR } from "./config";
import { font, roundRect } from "./controls";
import type { Rect } from "./layout";

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The dark rounded panel a watch view or figure sits in. */
export const well = (
  g: CanvasRenderingContext2D,
  r: Rect,
  opts: { edge?: string; fill?: string; radius?: number } = {},
): void => {
  g.save();
  roundRect(g, r, opts.radius ?? 28);
  g.fillStyle = opts.fill ?? COLOR.well;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = opts.edge ?? COLOR.edge;
  g.stroke();
  g.restore();
};

/** Clip later drawing to a rounded rect; call `g.restore()` after. */
export const clipTo = (g: CanvasRenderingContext2D, r: Rect, radius = 28): void => {
  g.save();
  roundRect(g, r, radius);
  g.clip();
};

export const line = (
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width = 4,
  dash?: number[],
): void => {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  if (dash) g.setLineDash(dash);
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.restore();
};

/**
 * A wave drawn along a line from (x0, y0) to (x1, y1), `lambda` px long, starting at `phase`
 * (radians). Returns the phase at the far end, so the next leg can carry on in step.
 */
export const wave = (
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  o: { lambda: number; amp: number; phase: number; color: string; width?: number; alpha?: number },
): number => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) return o.phase;
  const ux = dx / len;
  const uy = dy / len;
  const steps = Math.max(8, Math.ceil(len / 6));
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.strokeStyle = o.color;
  g.lineWidth = o.width ?? 4;
  g.lineJoin = "round";
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const s = (len * i) / steps;
    const off = o.amp * Math.sin(o.phase + (TAU * s) / o.lambda);
    const x = x0 + ux * s - uy * off;
    const y = y0 + uy * s + ux * off;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.restore();
  return o.phase + (TAU * len) / o.lambda;
};

/** The X-ray beam: a blue line with a soft glow. */
export const beam = (
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  o: { width?: number; alpha?: number; color?: string } = {},
): void => {
  const c = o.color ?? COLOR.beam;
  const w = o.width ?? 8;
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.lineCap = "round";
  g.strokeStyle = withAlpha(c, 0.22);
  g.lineWidth = w * 3;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = c;
  g.lineWidth = w;
  g.stroke();
  g.restore();
};

export const arrow = (
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width = 5,
  head = 22,
): void => {
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1 - Math.cos(a) * head * 0.7, y1 - Math.sin(a) * head * 0.7);
  g.stroke();
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x1 - Math.cos(a - 0.45) * head, y1 - Math.sin(a - 0.45) * head);
  g.lineTo(x1 - Math.cos(a + 0.45) * head, y1 - Math.sin(a + 0.45) * head);
  g.closePath();
  g.fill();
  g.restore();
};

/** A dimension bracket from (x0, y0) to (x1, y1) with a label beside its middle. */
export const bracket = (
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  o: { label?: string; color: string; width?: number; size?: number; side?: 1 | -1 },
): void => {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / len) * (o.side ?? 1);
  const ny = ((x1 - x0) / len) * (o.side ?? 1);
  const tick = 14;
  g.save();
  g.strokeStyle = o.color;
  g.lineWidth = o.width ?? 4;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x0 + nx * tick, y0 + ny * tick);
  g.lineTo(x0, y0);
  g.lineTo(x1, y1);
  g.lineTo(x1 + nx * tick, y1 + ny * tick);
  g.stroke();
  if (o.label) {
    const s = o.size ?? 40;
    label(g, o.label, (x0 + x1) / 2 - nx * s * 0.8, (y0 + y1) / 2 - ny * s * 0.8, {
      size: s,
      color: o.color,
      italic: true,
    });
  }
  g.restore();
};

export const label = (
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  o: {
    size?: number;
    color?: string;
    align?: CanvasTextAlign;
    weight?: number;
    italic?: boolean;
    baseline?: CanvasTextBaseline;
    alpha?: number;
  } = {},
): void => {
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  const size = o.size ?? 36;
  g.font = o.italic
    ? `italic 700 ${Math.round(size)}px Georgia, "Times New Roman", serif`
    : font(o.weight ?? 700, size);
  g.fillStyle = o.color ?? COLOR.ink;
  g.textAlign = o.align ?? "center";
  g.textBaseline = o.baseline ?? "middle";
  g.fillText(text, x, y);
  g.restore();
};

/** A soft round glow, for flashes and spots. */
export const glow = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
): void => {
  if (alpha <= 0.002 || r <= 0) return;
  g.save();
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, withAlpha("#ffffff", Math.min(1, alpha)));
  grad.addColorStop(0.18, withAlpha(color, Math.min(1, alpha)));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.restore();
};

export const disc = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
): void => {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.restore();
};

/** A small pill label in a corner of a rect, such as "A flat model". */
export const cornerTag = (
  g: CanvasRenderingContext2D,
  r: Rect,
  text: string,
  o: { size?: number; color?: string; corner?: "tl" | "tr" | "bl" | "br" } = {},
): void => {
  const size = o.size ?? 28;
  g.save();
  g.font = font(700, size);
  const w = g.measureText(text).width + size * 1.2;
  const h = size * 1.6;
  const pad = 16;
  const corner = o.corner ?? "bl";
  const x = corner === "tl" || corner === "bl" ? r.x + pad : r.x + r.width - pad - w;
  const y = corner === "tl" || corner === "tr" ? r.y + pad : r.y + r.height - pad - h;
  roundRect(g, { x, y, width: w, height: h }, h / 2);
  g.fillStyle = withAlpha(COLOR.background, 0.78);
  g.fill();
  g.fillStyle = o.color ?? COLOR.muted;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, x + w / 2, y + h / 2 + 1);
  g.restore();
};

/** Simple icons for controls, drawn in a box. */
export const ICON = {
  back(g: CanvasRenderingContext2D, b: Rect, c: string) {
    g.save();
    g.strokeStyle = c;
    g.lineWidth = b.width * 0.13;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(b.x + b.width * 0.62, b.y + b.height * 0.18);
    g.lineTo(b.x + b.width * 0.3, b.y + b.height * 0.5);
    g.lineTo(b.x + b.width * 0.62, b.y + b.height * 0.82);
    g.stroke();
    g.restore();
  },
  next(g: CanvasRenderingContext2D, b: Rect, c: string) {
    g.save();
    g.strokeStyle = c;
    g.lineWidth = b.width * 0.13;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(b.x + b.width * 0.38, b.y + b.height * 0.18);
    g.lineTo(b.x + b.width * 0.7, b.y + b.height * 0.5);
    g.lineTo(b.x + b.width * 0.38, b.y + b.height * 0.82);
    g.stroke();
    g.restore();
  },
  hammer(g: CanvasRenderingContext2D, b: Rect, c: string) {
    g.save();
    g.translate(b.x + b.width / 2, b.y + b.height / 2);
    g.rotate(-0.6);
    g.fillStyle = c;
    const s = b.width;
    g.fillRect(-s * 0.06, -s * 0.15, s * 0.12, s * 0.62);
    g.beginPath();
    g.roundRect(-s * 0.32, -s * 0.38, s * 0.64, s * 0.26, s * 0.05);
    g.fill();
    g.restore();
  },
};

// ---- Wrapped text, for the sentences some chapters show inside their figures ----------------
// The text always comes from captions.ts.

/** Words split into lines no wider than `width` at the context's current font. */
export const wrapLines = (g: CanvasRenderingContext2D, text: string, width: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && g.measureText(next).width > width) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
};

export interface WrapOpts {
  size: number;
  color: string;
  weight?: number;
  align?: CanvasTextAlign;
  /** Shrink the type, down to 60 %, until the text takes at most this many lines. */
  maxLines?: number;
  /** Shrink until it fits this height too. */
  maxHeight?: number;
  lineHeight?: number;
  alpha?: number;
}

/** Draw `text` wrapped to `width` from (x, top). Returns the height it took. */
export const drawWrapped = (
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  top: number,
  width: number,
  o: WrapOpts,
): number => {
  const weight = o.weight ?? 600;
  const lh = o.lineHeight ?? 1.2;
  let size = o.size;
  let lines: string[] = [];
  for (let i = 0; i < 12; i++) {
    g.font = font(weight, size);
    lines = wrapLines(g, text, width);
    const tooMany = o.maxLines !== undefined && lines.length > o.maxLines;
    const tooTall = o.maxHeight !== undefined && lines.length * size * lh > o.maxHeight;
    if ((!tooMany && !tooTall) || size <= o.size * 0.6) break;
    size *= 0.92;
  }
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.fillStyle = o.color;
  g.textAlign = o.align ?? "left";
  g.textBaseline = "top";
  const ax = o.align === "center" ? x + width / 2 : o.align === "right" ? x + width : x;
  lines.forEach((l, i) => g.fillText(l, ax, top + i * size * lh, width));
  g.restore();
  return lines.length * size * lh;
};
