/**
 * Canvas2D drawing shared by touch frames and the screen, in venue px (callers set the
 * transform): the circle with its triangle, squares, tan and arc; the graphs with the lines
 * carrying each height across; the readout, captions, the wheel, step dots, beads and the
 * ghost hand. Glow is layered strokes, never blur filters, which cost too much at wall size.
 *
 * Negative lengths are striped: a faint underlay with bright dashes over it.
 */
import { COLOUR, type Fn, INK, MUTED, rgba, TAU, type Units } from "./config";
import { type Circle, graphX, type Pic, type TextBox } from "./layout";
import {
  decimal,
  decimalIsExact,
  MINUS,
  type Exact,
  piFraction,
  SPECIAL_DEG,
  tanUndefined,
  type Values,
} from "./maths";
import { drawRun, exactItems, fitLines, font, type Item, runWidth } from "./text";
import type { Parts, StepId } from "./walk";

export interface Look {
  theta: number;
  v: Values;
  parts: Parts;
  /** Which functions the visitor has on. */
  show: Record<Fn, boolean>;
  units: Units;
  /** The walk-through step being shown, how far into it, and its caption. */
  step: { id: StepId | null; t: number; u: number; line: number };
  /** The waves step: curves drawn up to θ, the rest faint. */
  traced: boolean;
  /** Bank frames: their colour, ringed round the point. */
  ring: string | null;
  /** Screen: every frame's point, in its colour. */
  others: readonly { theta: number; colour: string }[];
  /** Seconds, for pulses. */
  time: number;
  /** How much of the graphs shows while the picture slides out of its zoom (default 1). */
  graphAlpha?: number;
}

const HALO = "rgba(5,7,13,0.85)";

const dashed = (g: CanvasRenderingContext2D, on: number, off: number) => g.setLineDash([on, off]);

/** A length: solid if positive, striped if negative. */
const length = (
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colour: string,
  width: number,
  negative: boolean,
  glow = 0,
) => {
  g.lineCap = negative ? "butt" : "round";
  if (glow > 0) {
    g.strokeStyle = rgba(colour, 0.22 * glow);
    g.lineWidth = width * 3.2;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  if (negative) {
    g.strokeStyle = rgba(colour, 0.32);
    g.lineWidth = width;
    g.stroke();
    dashed(g, width * 1.15, width * 0.85);
    g.strokeStyle = colour;
    g.lineWidth = width * 0.8;
    g.stroke();
    g.setLineDash([]);
  } else {
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.stroke();
  }
};

const dot = (g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) => {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = HALO;
  g.fill();
  g.beginPath();
  g.arc(x, y, r * 0.78, 0, TAU);
  g.fillStyle = fill;
  g.fill();
};

/** Text with a dark halo so it reads over lines. */
export const label = (
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  align: CanvasTextAlign = "center",
) => {
  g.font = font(size);
  g.textAlign = align;
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.strokeStyle = HALO;
  g.lineWidth = size * 0.22;
  g.strokeText(text, x, y);
  g.fillStyle = colour;
  g.fillText(text, x, y);
};

const textWidth = (g: CanvasRenderingContext2D, text: string, size: number) => {
  g.font = font(size);
  return g.measureText(text).width;
};

/** A pulse from 0 to 1 and back, `period` seconds. */
const pulse = (t: number, period = 1.6) => 0.5 - 0.5 * Math.cos((TAU * t) / period);

/** The function's curve from θ = a to b. */
const curve = (
  g: CanvasRenderingContext2D,
  p: Pic,
  fn: "sin" | "cos",
  a: number,
  b: number,
  step: number,
) => {
  const f = fn === "sin" ? Math.sin : Math.cos;
  const n = Math.max(2, Math.ceil(((b - a) * p.s) / step));
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const th = a + ((b - a) * i) / n;
    const x = p.x0 + th * p.s;
    const y = p.cy - p.r * f(th);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
};

/**
 * tan's three branches, each sampled evenly in height so it stays smooth up to where it
 * leaves the picture, and never joined across an asymptote. Only θ in [a, b] is drawn.
 */
const tanPath = (g: CanvasRenderingContext2D, p: Pic, a: number, b: number) => {
  const up = (p.cy - p.top) / p.r;
  const down = (p.bottom - p.cy) / p.r;
  const n = 64;
  g.beginPath();
  for (const base of [0, Math.PI, TAU]) {
    let started = false;
    for (let i = 0; i <= n; i++) {
      const v = -down + ((up + down) * i) / n;
      const th = base + Math.atan(v);
      if (th < a - 1e-9 || th > b + 1e-9) {
        started = false;
        continue;
      }
      const x = p.x0 + th * p.s;
      const y = p.cy - p.r * v;
      if (!started) {
        g.moveTo(x, y);
        started = true;
      } else g.lineTo(x, y);
    }
  }
};

const strokeCurve = (g: CanvasRenderingContext2D, colour: string, width: number, alpha: number) => {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = rgba(colour, 0.16 * alpha);
  g.lineWidth = width * 3;
  g.stroke();
  g.strokeStyle = rgba(colour, alpha);
  g.lineWidth = width;
  g.stroke();
};

const angleText = (deg: number, units: Units): string => {
  if (units === "deg") return `${deg}°`;
  const pf = piFraction(deg);
  const rad = pf ? (pf.den === 1 ? pf.num : `${pf.num}/${pf.den}`) : null;
  if (units === "rad") return rad ?? "";
  return rad ? `${deg}° ${rad}` : `${deg}°`;
};

/** The circle, its triangle and everything grown from it, and the graphs. */
export const drawPicture = (g: CanvasRenderingContext2D, p: Pic, look: Look) => {
  const { parts, show, v } = look;
  const th = look.theta;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const L = p.line;
  const P = { x: p.cx + p.r * c, y: p.cy - p.r * s };
  const F = { x: P.x, y: p.cy };
  const focus = parts.focus;
  const time = look.time;
  const signs = parts.signs;
  const xm = graphX(p, th);
  const showTan = parts.tan && show.tan;
  const parallel = Math.abs(c) < 1e-9 || (tanUndefined(v.deg) && Math.abs(c) < 0.02);
  const ga = parts.graphs ? Math.max(0, Math.min(1, look.graphAlpha ?? 1)) : 0;
  const graphs = ga > 0.001;

  g.save();
  g.beginPath();
  g.rect(p.left, p.top, p.right - p.left, p.bottom - p.top);
  g.clip();

  // Half the plane tinted where the caption says a value is negative.
  if (focus === "signs") {
    const sinHalf = look.step.line === 0;
    const colour = sinHalf ? COLOUR.sin : COLOUR.cos;
    const a = 0.1 + 0.06 * pulse(time, 2);
    g.fillStyle = rgba(colour, a);
    g.beginPath();
    if (sinHalf) {
      g.arc(p.cx, p.cy, p.r, 0, Math.PI);
      g.closePath();
      g.fill();
      if (graphs) g.fillRect(p.x0, p.cy, p.x1 - p.x0, p.bottom - p.cy);
    } else {
      g.arc(p.cx, p.cy, p.r, Math.PI / 2, (3 * Math.PI) / 2);
      g.closePath();
      g.fill();
    }
  }

  // Axes, and the graph's guide lines at 1 and -1.
  g.lineCap = "butt";
  g.strokeStyle = rgba(INK, 0.3);
  g.lineWidth = L * 0.35;
  g.beginPath();
  g.moveTo(p.cx - p.r - L * 6, p.cy);
  g.lineTo(graphs || parts.radians ? p.x1 + L * 4 : p.x0 + L * 6, p.cy);
  g.moveTo(p.cx, p.cy - p.r - L * 6);
  g.lineTo(p.cx, p.cy + p.r + L * 6);
  g.stroke();
  if (graphs) {
    g.globalAlpha = ga;
    g.strokeStyle = rgba(INK, 0.13);
    dashed(g, L * 1.4, L * 1.4);
    g.beginPath();
    for (const u of [1, -1]) {
      g.moveTo(p.x0, p.cy - u * p.r);
      g.lineTo(p.x1, p.cy - u * p.r);
    }
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = rgba(INK, 0.3);
    g.beginPath();
    g.moveTo(p.x0, p.cy - p.r - L * 4);
    g.lineTo(p.x0, p.cy + p.r + L * 4);
    g.stroke();
    // 1 and -1 past the graph's end where there is room, else by its upright axis.
    const right = p.x1 + p.axis * 2.2 < p.right;
    const lx = right ? p.x1 + p.axis * 0.5 : p.x0 - p.axis * 0.4;
    label(g, "1", lx, p.cy - p.r, p.axis, MUTED, right ? "left" : "right");
    label(g, MINUS + "1", lx, p.cy + p.r, p.axis, MUTED, right ? "left" : "right");
    // Ticks at the special angles; names at the right angles.
    g.strokeStyle = rgba(INK, 0.45);
    g.lineWidth = L * 0.4;
    g.beginPath();
    for (const d of SPECIAL_DEG) {
      const x = p.x0 + ((d * Math.PI) / 180) * p.s;
      const big = d % 90 === 0;
      g.moveTo(x, p.cy - (big ? L * 2.4 : L * 1.4));
      g.lineTo(x, p.cy + (big ? L * 2.4 : L * 1.4));
    }
    g.stroke();
    for (const d of [90, 180, 270, 360]) {
      const x = p.x0 + ((d * Math.PI) / 180) * p.s;
      const lines =
        look.units === "both" ? [`${d}°`, angleText(d, "rad")] : [angleText(d, look.units)];
      lines.forEach((t, i) =>
        label(g, t, x, p.cy + p.axis * (1.05 + i * 1.1), p.axis, i === 0 ? MUTED : rgba(INK, 0.55)),
      );
    }
    g.globalAlpha = 1;
  }

  // The circle and its tick marks.
  g.strokeStyle = rgba(INK, focus === "circle" ? 0.95 : 0.8);
  g.lineWidth = L * (focus === "circle" ? 1.2 : 0.9);
  g.beginPath();
  g.arc(p.cx, p.cy, p.r, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(INK, 0.5);
  g.lineWidth = L * 0.5;
  g.beginPath();
  for (const d of SPECIAL_DEG) {
    const a = (d * Math.PI) / 180;
    const r0 = p.r + L * 0.8;
    const r1 = p.r + L * (d % 90 === 0 ? 3.6 : 2.4);
    g.moveTo(p.cx + r0 * Math.cos(a), p.cy - r0 * Math.sin(a));
    g.lineTo(p.cx + r1 * Math.cos(a), p.cy - r1 * Math.sin(a));
  }
  g.stroke();

  // The waves.
  if (graphs) {
    g.globalAlpha = ga;
    const step = Math.max(2, p.s / 40);
    const traced = look.traced;
    for (const fn of ["cos", "sin"] as const) {
      if (!show[fn]) continue;
      const w = L * (focus === "waves" ? 1.25 : 1.05);
      curve(g, p, fn, 0, TAU, step);
      strokeCurve(g, COLOUR[fn], w, traced ? 0.22 : 0.95);
      if (traced && th > 0) {
        curve(g, p, fn, 0, th, step);
        strokeCurve(g, COLOUR[fn], w, 1);
      }
    }
    if (showTan) {
      g.strokeStyle = rgba(COLOUR.tan, 0.45);
      g.lineWidth = L * 0.45;
      dashed(g, L * 1.6, L * 1.3);
      g.beginPath();
      for (const a of [Math.PI / 2, (3 * Math.PI) / 2]) {
        const x = graphX(p, a);
        g.moveTo(x, p.top);
        g.lineTo(x, p.bottom);
      }
      g.stroke();
      g.setLineDash([]);
      tanPath(g, p, 0, TAU);
      strokeCurve(g, COLOUR.tan, L * 0.95, traced ? 0.22 : 0.85);
      if (traced && th > 0) {
        tanPath(g, p, 0, th);
        strokeCurve(g, COLOUR.tan, L * 0.95, 1);
      }
    }
    g.globalAlpha = 1;
  }

  // The squares on the triangle's sides.
  const areas = parts.squares && parts.triangle ? drawSquares(g, p, th, look) : [];

  // Radian marks round the circle and along the axis.
  if (parts.radians) {
    for (let k = 1; k <= 6; k++) {
      const a = k;
      const x = p.cx + p.r * Math.cos(a);
      const y = p.cy - p.r * Math.sin(a);
      dot(g, x, y, L * 1.5, COLOUR.theta);
      const lx = p.cx + (p.r - p.label * 0.7) * Math.cos(a);
      const ly = p.cy - (p.r - p.label * 0.7) * Math.sin(a);
      label(g, String(k), lx, ly, p.axis, COLOUR.theta);
      // Along the axis too, a radius apart where the graph's scale is the circle's.
      if (graphs || p.s === p.r) {
        const gx = p.x0 + k * p.s;
        dot(g, gx, p.cy, L * 1.5, COLOUR.theta);
        label(g, String(k), gx, p.cy - p.axis * 0.9, p.axis, COLOUR.theta);
      }
    }
  }

  // tan: the line x = 1, the radius made longer to meet it, and the height where it does.
  let T: { x: number; y: number; clipped: boolean } | null = null;
  if (showTan) {
    g.strokeStyle = rgba(COLOUR.tan, 0.4);
    g.lineWidth = L * 0.6;
    g.beginPath();
    g.moveTo(p.x0, p.top);
    g.lineTo(p.x0, p.bottom);
    g.stroke();
    const glow = focus === "tan" ? 0.6 + 0.4 * pulse(time) : 0;
    if (parallel) {
      // Upright: the line never meets x = 1.
      const dir = s > 0 ? -1 : 1;
      g.strokeStyle = rgba(COLOUR.tan, 0.8);
      g.lineWidth = L * 0.7;
      dashed(g, L * 1.8, L * 1.4);
      g.beginPath();
      g.moveTo(P.x, P.y);
      g.lineTo(P.x, dir < 0 ? p.top : p.bottom);
      g.stroke();
      g.setLineDash([]);
    } else {
      const tv = s / c;
      const ty = p.cy - p.r * tv;
      const cy = Math.max(p.top + L * 2, Math.min(p.bottom - L * 2, ty));
      T = { x: p.x0, y: cy, clipped: cy !== ty };
      // Where the longer radius crosses the picture's edge when T is off it.
      const k = (cy - p.cy) / (ty - p.cy);
      const ex = p.cx + (p.x0 - p.cx) * k;
      const from = c > 0 ? P : { x: p.cx, y: p.cy };
      g.strokeStyle = rgba(COLOUR.tan, 0.85);
      g.lineWidth = L * 0.75;
      dashed(g, L * 1.8, L * 1.4);
      g.beginPath();
      g.moveTo(from.x, from.y);
      g.lineTo(T.clipped ? ex : p.x0, cy);
      g.stroke();
      g.setLineDash([]);
      // The larger triangle: 1 along the axis, tan θ up the line.
      if (!T.clipped) {
        g.fillStyle = rgba(COLOUR.tan, focus === "tan" ? 0.13 : 0.07);
        g.beginPath();
        g.moveTo(p.cx, p.cy);
        g.lineTo(p.x0, p.cy);
        g.lineTo(p.x0, cy);
        g.closePath();
        g.fill();
      }
      length(g, p.x0, p.cy, p.x0, cy, COLOUR.tan, L * 1.7, signs && tv < 0, glow);
      if (T.clipped) {
        // An arrowhead: it carries on off the picture.
        const d = cy < p.cy ? -1 : 1;
        g.fillStyle = COLOUR.tan;
        g.beginPath();
        g.moveTo(p.x0, cy + d * L * 3);
        g.lineTo(p.x0 - L * 2.6, cy - d * L * 1.4);
        g.lineTo(p.x0 + L * 2.6, cy - d * L * 1.4);
        g.closePath();
        g.fill();
      } else dot(g, p.x0, cy, L * 1.7, COLOUR.tan);
    }
  }

  // The arc from (1, 0) to the point: θ long.
  if (parts.arc && th > 0) {
    const glow = focus === "arc" ? 0.5 + 0.5 * pulse(time) : 0;
    g.lineCap = "round";
    if (glow > 0) {
      g.strokeStyle = rgba(COLOUR.theta, 0.25 * glow);
      g.lineWidth = L * 5;
      g.beginPath();
      g.arc(p.cx, p.cy, p.r, 0, -th, true);
      g.stroke();
    }
    g.strokeStyle = rgba(COLOUR.theta, 0.9);
    g.lineWidth = L * 1.5;
    g.beginPath();
    g.arc(p.cx, p.cy, p.r, 0, -th, true);
    g.stroke();
  }

  // The right triangle under the radius.
  if (parts.triangle) {
    g.fillStyle = rgba(INK, 0.06);
    g.beginPath();
    g.moveTo(p.cx, p.cy);
    g.lineTo(F.x, F.y);
    g.lineTo(P.x, P.y);
    g.closePath();
    g.fill();
    if (Math.abs(s) > 0.12 && Math.abs(c) > 0.12) {
      const q = Math.min(p.r * 0.09, Math.abs(s) * p.r * 0.4, Math.abs(c) * p.r * 0.4);
      const dx = c > 0 ? -q : q;
      const dy = s > 0 ? -q : q;
      g.strokeStyle = rgba(INK, 0.6);
      g.lineWidth = L * 0.4;
      g.beginPath();
      g.moveTo(F.x + dx, F.y);
      g.lineTo(F.x + dx, F.y + dy);
      g.lineTo(F.x, F.y + dy);
      g.stroke();
    }
    const line = focus === "triangle" ? look.step.line : -1;
    if (show.cos) {
      const glow = line === 1 ? 0.6 + 0.4 * pulse(time) : 0;
      length(g, p.cx, p.cy, F.x, F.y, COLOUR.cos, L * 1.7, signs && c < 0, glow);
    }
    if (show.sin) {
      const glow = line === 0 ? 0.6 + 0.4 * pulse(time) : 0;
      length(g, F.x, F.y, P.x, P.y, COLOUR.sin, L * 1.7, signs && s < 0, glow);
    }
  }

  // Each height carried across to its curve.
  if (graphs) {
    g.globalAlpha = ga;
    g.strokeStyle = rgba(COLOUR.theta, 0.35);
    g.lineWidth = L * 0.4;
    g.beginPath();
    g.moveTo(xm, p.top);
    g.lineTo(xm, p.bottom);
    g.stroke();
    const across = (y: number, x: number, colour: string) => {
      g.strokeStyle = rgba(colour, 0.75);
      g.lineWidth = L * 0.5;
      dashed(g, L * 1.2, L * 1.2);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(xm, y);
      g.stroke();
      g.setLineDash([]);
    };
    if (show.cos) {
      // The width stood upright on the y axis: its height is cos θ.
      const y = p.cy - p.r * c;
      const lift = focus === "waves" && look.step.line === 1 ? 0.6 + 0.4 * pulse(time) : 0;
      length(g, p.cx, p.cy, p.cx, y, COLOUR.cos, L * 1.1, signs && c < 0, lift);
      across(y, p.cx, COLOUR.cos);
      dot(g, xm, y, L * 2, COLOUR.cos);
    }
    if (show.sin) {
      across(P.y, P.x, COLOUR.sin);
      dot(g, xm, P.y, L * 2, COLOUR.sin);
    }
    if (T && !T.clipped) {
      across(T.y, T.x, COLOUR.tan);
      dot(g, xm, T.y, L * 1.8, COLOUR.tan);
    }
    g.globalAlpha = 1;
  }

  // Other frames' points (the screen), under this one.
  for (const o of look.others) {
    const ox = p.cx + p.r * Math.cos(o.theta);
    const oy = p.cy - p.r * Math.sin(o.theta);
    g.strokeStyle = rgba(o.colour, 0.7);
    g.lineWidth = L * 0.6;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(p.cx, p.cy);
    g.lineTo(ox, oy);
    g.stroke();
    dot(g, ox, oy, L * 2.2, o.colour);
    if (graphs) {
      g.globalAlpha = ga;
      const gx = graphX(p, o.theta);
      if (show.sin) dot(g, gx, p.cy - p.r * Math.sin(o.theta), L * 1.9, o.colour);
      if (show.cos) dot(g, gx, p.cy - p.r * Math.cos(o.theta), L * 1.9, o.colour);
      g.globalAlpha = 1;
    }
  }

  // The radius, the small angle mark, and the point.
  g.strokeStyle = COLOUR.radius;
  g.lineWidth = L * 1.35;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(p.cx, p.cy);
  g.lineTo(P.x, P.y);
  g.stroke();
  if (th > 0.01) {
    g.strokeStyle = COLOUR.theta;
    g.lineWidth = L * 0.8;
    g.beginPath();
    g.arc(p.cx, p.cy, p.r * 0.2, 0, -th, true);
    g.stroke();
  }
  dot(g, p.cx, p.cy, L * 1.3, INK);
  if (look.ring) {
    g.strokeStyle = look.ring;
    g.lineWidth = L * 1.2;
    g.beginPath();
    g.arc(P.x, P.y, L * 4.6, 0, TAU);
    g.stroke();
  }
  dot(g, P.x, P.y, L * 3, INK);

  if (parts.radians && p.s === p.r) drawUnroll(g, p, th, look.step.u);

  drawLabels(g, p, look, P, T, parallel, areas);
  g.restore();
};

/** The squares on the triangle's sides, each with its area; returns where the areas are written. */
const drawSquares = (g: CanvasRenderingContext2D, p: Pic, th: number, look: Look): Box[] => {
  const written: Box[] = [];
  const c = Math.cos(th);
  const s = Math.sin(th);
  const R = p.r;
  const O = { x: p.cx, y: p.cy };
  const F = { x: p.cx + R * c, y: p.cy };
  const P = { x: F.x, y: p.cy - R * s };
  const grow = Math.min(1, look.step.t / 1.2);
  const sq = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    nx: number,
    ny: number,
    side: number,
    colour: string,
    area: string,
  ) => {
    const k = side * grow;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.lineTo(b.x + nx * k, b.y + ny * k);
    g.lineTo(a.x + nx * k, a.y + ny * k);
    g.closePath();
    g.fillStyle = rgba(colour, 0.2);
    g.fill();
    g.strokeStyle = rgba(colour, 0.85);
    g.lineWidth = p.line * 0.6;
    g.stroke();
    if (k > p.label * 1.6) {
      const mx = (a.x + b.x) / 2 + (nx * k) / 2;
      const my = (a.y + b.y) / 2 + (ny * k) / 2;
      const size = p.label * 0.9;
      label(g, area, mx, my, size, colour);
      const w = textWidth(g, area, size) + size * 0.2;
      written.push({ x: mx - w / 2, y: my - size * 0.55, w, h: size * 1.1 });
    }
  };
  // On cos: away from the point. On sin: away from the centre. On the radius: away from both.
  sq(O, F, 0, s >= 0 ? 1 : -1, Math.abs(c) * R, COLOUR.cos, decimal(c * c));
  sq(F, P, c >= 0 ? 1 : -1, 0, Math.abs(s) * R, COLOUR.sin, decimal(s * s));
  const flip = s * c >= 0 ? 1 : -1;
  sq(O, P, -s * flip, -c * flip, R, COLOUR.radius, "1");
  return written;
};

/** The arc peeling off the circle onto the line x = 1, then lying down along the axis. */
const drawUnroll = (g: CanvasRenderingContext2D, p: Pic, th: number, u: number) => {
  const a = Math.max(0, Math.min(1, (u - 0.25) / 0.3));
  const b = Math.max(0, Math.min(1, (u - 0.6) / 0.2));
  if (a <= 0 || th <= 0.02) return;
  const len = th * p.r;
  const kappa = (1 - a * a * (3 - 2 * a)) / p.r;
  const turn = (b * b * (3 - 2 * b) * Math.PI) / 2;
  const n = 64;
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const l = (len * i) / n;
    // Math coordinates from (1, 0), heading up, bending towards the centre.
    let mx: number;
    let my: number;
    if (kappa > 1e-9) {
      mx = (Math.sin(Math.PI / 2 + kappa * l) - 1) / kappa;
      my = -Math.cos(Math.PI / 2 + kappa * l) / kappa;
    } else {
      mx = 0;
      my = l;
    }
    // Then turned clockwise about (1, 0) until it lies along the axis.
    const rx = mx * Math.cos(turn) + my * Math.sin(turn);
    const ry = -mx * Math.sin(turn) + my * Math.cos(turn);
    const x = p.x0 + rx;
    const y = p.cy - ry;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.lineCap = "round";
  g.strokeStyle = rgba(COLOUR.theta, 0.3);
  g.lineWidth = p.line * 5;
  g.stroke();
  g.strokeStyle = COLOUR.theta;
  g.lineWidth = p.line * 1.8;
  g.stroke();
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The picture's names, each at the first of its candidate places that is inside the picture
 * and clear of the names already placed and of the points. Small triangles drop names that
 * find no room rather than pile them up.
 */
const drawLabels = (
  g: CanvasRenderingContext2D,
  p: Pic,
  look: Look,
  P: { x: number; y: number },
  T: { x: number; y: number; clipped: boolean } | null,
  parallel: boolean,
  obstacles: readonly Box[],
) => {
  const { parts, show } = look;
  const th = look.theta;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const z = p.label;
  const L = p.line;
  const placed: Box[] = [
    { x: P.x - L * 3.2, y: P.y - L * 3.2, w: L * 6.4, h: L * 6.4 },
    { x: p.cx - L * 1.2, y: p.cy - L * 1.2, w: L * 2.4, h: L * 2.4 },
    ...obstacles,
  ];
  if (T && !T.clipped) placed.push({ x: T.x - L * 2.4, y: T.y - L * 2.4, w: L * 4.8, h: L * 4.8 });
  const place = (text: string, colour: string, spots: readonly [number, number][], size = z) => {
    const w = textWidth(g, text, size) + size * 0.2;
    const h = size * 1.05;
    for (const [x, y] of spots) {
      const b = { x: x - w / 2, y: y - h / 2, w, h };
      if (b.x < p.left || b.x + b.w > p.right || b.y < p.top || b.y + b.h > p.bottom) continue;
      if (placed.some((o) => overlaps(o, b))) continue;
      placed.push(b);
      label(g, text, x, y, size, colour);
      return true;
    }
    return false;
  };
  const gap = z * 0.4;
  if (th > 0.05) {
    const rr = p.r * 0.2 + z * 0.75;
    const a = th / 2;
    place("θ", COLOUR.theta, [
      [p.cx + rr * Math.cos(a), p.cy - rr * Math.sin(a)],
      [p.cx + rr * 1.6 * Math.cos(a), p.cy - rr * 1.6 * Math.sin(a)],
      [p.cx + rr * Math.cos(-0.3), p.cy - rr * Math.sin(-0.3)],
    ]);
  }
  const midY = (p.cy + P.y) / 2;
  if (parts.triangle && show.sin && Math.abs(s) * p.r > z * 0.5) {
    const w = textWidth(g, "sin θ", z);
    const out = c >= 0 ? 1 : -1;
    const spots: [number, number][] = [
      [P.x - out * (gap + w / 2), midY],
      [P.x + out * (gap + w / 2), midY],
    ];
    // Outside first where it stays clear of the line x = 1.
    if (out < 0 || P.x + gap + w < p.x0 - gap) spots.reverse();
    place("sin θ", COLOUR.sin, spots);
  }
  if (parts.triangle && show.cos && Math.abs(c) * p.r > z * 0.7) {
    const away = s >= 0 ? 1 : -1;
    const mx = (p.cx + P.x) / 2;
    place("cos θ", COLOUR.cos, [
      [mx, p.cy + away * z * 0.78],
      [mx, p.cy + away * z * 1.3],
      [mx, p.cy - away * z * 0.78],
    ]);
  }
  if (parts.tan && show.tan) {
    if (parallel) {
      const y = s > 0 ? p.top + z * 1.2 : p.bottom - z * 1.2;
      const w = textWidth(g, "tan θ has no value", z * 0.85);
      place(
        "tan θ has no value",
        COLOUR.tan,
        [
          [P.x + gap + w / 2, y],
          [P.x - gap - w / 2, y],
        ],
        z * 0.85,
      );
    } else if (T) {
      const w = textWidth(g, "tan θ", z);
      const my = (p.cy + T.y) / 2;
      const up = T.y < p.cy ? -1 : 1;
      if (Math.abs(T.y - p.cy) > z * 0.6 || T.clipped) {
        place("tan θ", COLOUR.tan, [
          [p.x0 + gap + w / 2, my],
          [p.x0 - gap - w / 2, my],
          [p.x0 + gap + w / 2, T.y + up * z * 0.75],
          [p.x0 - gap - w / 2, T.y + up * z * 0.75],
        ]);
      }
    }
  }
  // "1" along the radius, first on the side away from the triangle.
  const flip = s * c >= 0 ? 1 : -1;
  const nx = -s * flip;
  const ny = -c * flip;
  const along = (f: number, side: number): [number, number] => [
    p.cx + (P.x - p.cx) * f + side * nx * z * 0.7,
    p.cy + (P.y - p.cy) * f + side * ny * z * 0.7,
  ];
  place("1", COLOUR.radius, [
    along(0.5, 1),
    along(0.7, 1),
    along(0.32, 1),
    along(0.5, -1),
    along(0.72, -1),
  ]);
};

/** The values: θ, then sin, cos and tan, exact at the special angles. */
export const drawReadout = (
  g: CanvasRenderingContext2D,
  box: TextBox,
  v: Values,
  fns: readonly Fn[],
  units: Units,
  thetaColour = COLOUR.theta,
) => {
  const rows: Item[][] = [];
  const angle: Item[] = [
    { k: "t", s: "θ", c: thetaColour },
    { k: "t", s: " = " },
  ];
  const pf = piFraction(v.deg === 360 ? 360 : v.deg);
  const rad: Item[] = pf
    ? pf.den === 1
      ? [{ k: "t", s: pf.num }]
      : [{ k: "frac", num: pf.num, den: String(pf.den) }]
    : [{ k: "t", s: `${decimal((v.deg * Math.PI) / 180)} rad` }];
  if (units !== "rad") angle.push({ k: "t", s: `${v.deg}°` });
  if (units === "both") angle.push({ k: "t", s: " = " });
  if (units !== "deg") angle.push(...rad);
  rows.push(angle);
  for (const fn of fns) {
    const c = COLOUR[fn];
    const row: Item[] = [{ k: "t", s: `${fn} θ`, c }];
    const value = v[fn];
    const exact: Exact | null | undefined = v.exact ? v.exact[fn] : undefined;
    if (value === null) {
      row.push({ k: "t", s: " has no value", c: MUTED, bold: false });
    } else if (exact) {
      row.push({ k: "t", s: " = " }, ...exactItems(exact));
      if (exact.den !== 1 || exact.num.startsWith("√")) {
        row.push({ k: "t", s: decimalIsExact(exact) ? " = " : " ≈ ", c: MUTED });
        row.push({ k: "t", s: decimal(value), c: MUTED, bold: false });
      }
    } else {
      row.push({ k: "t", s: " = " }, { k: "t", s: decimal(value) });
    }
    rows.push(row);
  }
  // As many columns as fit, then shrink to fit.
  let size = box.size;
  let cols = 1;
  for (; size > box.size * 0.55; size *= 0.94) {
    const widths = rows.map((r) => runWidth(g, r, size));
    const widest = Math.max(...widths);
    const gap = size * 1.2;
    cols = Math.max(1, Math.min(rows.length, Math.floor((box.width + gap) / (widest + gap))));
    const lines = Math.ceil(rows.length / cols);
    if (widest <= box.width && lines * size * 1.45 <= box.height) break;
  }
  const lines = Math.ceil(rows.length / cols);
  const pitch = Math.min(size * 1.6, box.height / lines);
  const colW = box.width / cols;
  rows.forEach((r, i) => {
    const col = Math.floor(i / lines);
    const line = i % lines;
    drawRun(g, r, box.x + col * colW, box.y + pitch * (line + 0.5), size, INK);
  });
};

/**
 * A caption, centred in its box. Several parts go on one line when they fit, else one to a
 * line; a single part wraps.
 */
export const drawCaption = (
  g: CanvasRenderingContext2D,
  box: TextBox & { lines: number },
  text: string | readonly string[],
  alpha: number,
  colour = INK,
) => {
  const parts = typeof text === "string" ? [text] : [...text];
  if (parts.length === 0 || alpha <= 0.01) return;
  const joined = parts.join("      ");
  g.font = font(box.size);
  let lines: string[];
  let size: number;
  if (parts.length === 1 || box.lines < parts.length || g.measureText(joined).width <= box.width) {
    const fit = fitLines(
      g,
      parts.length === 1 ? parts[0]! : joined,
      box.width,
      box.size,
      box.lines,
    );
    lines = fit.lines;
    size = fit.size;
  } else {
    lines = parts;
    size = box.size;
    const widest = () => Math.max(...lines.map((l) => textWidth(g, l, size)));
    while (size > box.size * 0.6 && widest() > box.width) size *= 0.94;
  }
  const pitch = size * 1.18;
  const y0 = box.y + box.height / 2 - (pitch * (lines.length - 1)) / 2;
  g.globalAlpha = Math.max(0, Math.min(1, alpha));
  lines.forEach((l, i) => label(g, l, box.x + box.width / 2, y0 + i * pitch, size, colour));
  g.globalAlpha = 1;
};

/** The wheel: grips that turn with θ, a spoke at θ, and arrows round its rim. */
export const drawWheel = (
  g: CanvasRenderingContext2D,
  w: Circle,
  theta: number,
  active: boolean,
  line: number,
  hint: number,
) => {
  g.beginPath();
  g.arc(w.x, w.y, w.r, 0, TAU);
  g.fillStyle = "rgba(20,28,58,0.92)";
  g.fill();
  g.strokeStyle = active ? rgba(COLOUR.theta, 0.95) : rgba(INK, 0.55);
  g.lineWidth = line * 1.4;
  g.stroke();
  g.fillStyle = rgba(INK, active ? 0.5 : 0.32);
  for (let i = 0; i < 18; i++) {
    const a = theta + (i * TAU) / 18;
    g.beginPath();
    g.arc(w.x + w.r * 0.84 * Math.cos(a), w.y - w.r * 0.84 * Math.sin(a), w.r * 0.055, 0, TAU);
    g.fill();
  }
  g.strokeStyle = rgba(INK, 0.18);
  g.lineWidth = line * 0.6;
  g.beginPath();
  g.arc(w.x, w.y, w.r * 0.62, 0, TAU);
  g.stroke();
  // The spoke points the way the radius does.
  g.strokeStyle = COLOUR.radius;
  g.lineWidth = line * 1.6;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(w.x, w.y);
  g.lineTo(w.x + w.r * 0.66 * Math.cos(theta), w.y - w.r * 0.66 * Math.sin(theta));
  g.stroke();
  dot(g, w.x + w.r * 0.66 * Math.cos(theta), w.y - w.r * 0.66 * Math.sin(theta), line * 2.6, INK);
  dot(g, w.x, w.y, line * 1.8, INK);
  // Two curved arrows: turn me either way.
  if (hint > 0.01) {
    const rr = w.r + line * 4.5;
    g.strokeStyle = rgba(INK, 0.55 * hint);
    g.fillStyle = rgba(INK, 0.55 * hint);
    g.lineWidth = line * 1.2;
    for (const [a0, a1] of [
      [0.35, 1.25],
      [Math.PI + 0.35, Math.PI + 1.25],
    ] as const) {
      g.beginPath();
      g.arc(w.x, w.y, rr, -a0, -a1, true);
      g.stroke();
      const hx = w.x + rr * Math.cos(a1);
      const hy = w.y - rr * Math.sin(a1);
      const tx = -Math.sin(a1);
      const ty = -Math.cos(a1);
      const k = line * 3.2;
      g.beginPath();
      g.moveTo(hx + tx * k, hy + ty * k);
      g.lineTo(hx - ty * k * 0.7, hy + tx * k * 0.7);
      g.lineTo(hx + ty * k * 0.7, hy - tx * k * 0.7);
      g.closePath();
      g.fill();
    }
  }
};

export const drawDots = (
  g: CanvasRenderingContext2D,
  d: { x: number; y: number; gap: number; r: number },
  n: number,
  current: number,
) => {
  const x0 = d.x - ((n - 1) * d.gap) / 2;
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.arc(x0 + i * d.gap, d.y, d.r, 0, TAU);
    if (i === current) {
      g.fillStyle = INK;
      g.fill();
    } else {
      g.strokeStyle = rgba(INK, 0.5);
      g.lineWidth = d.r * 0.3;
      g.stroke();
    }
  }
};

/** The screen's beads: one above each frame, at the height of that frame's sin θ. */
export const drawBeads = (
  g: CanvasRenderingContext2D,
  b: { y: number; amp: number; r: number },
  width: number,
  beads: readonly { x: number; theta: number; colour: string; lead: boolean }[],
  line: number,
) => {
  g.strokeStyle = rgba(INK, 0.25);
  g.lineWidth = line * 0.4;
  g.beginPath();
  g.moveTo(0, b.y);
  g.lineTo(width, b.y);
  g.stroke();
  g.strokeStyle = rgba(INK, 0.1);
  dashed(g, line, line);
  g.beginPath();
  g.moveTo(0, b.y - b.amp);
  g.lineTo(width, b.y - b.amp);
  g.moveTo(0, b.y + b.amp);
  g.lineTo(width, b.y + b.amp);
  g.stroke();
  g.setLineDash([]);
  if (beads.length === 0) return;
  // A thread through the beads, so the wave reads as one.
  if (beads.length > 2) {
    g.beginPath();
    beads.forEach((bd, i) => {
      const y = b.y - b.amp * Math.sin(bd.theta);
      if (i === 0) g.moveTo(bd.x, y);
      else {
        const prev = beads[i - 1]!;
        const py = b.y - b.amp * Math.sin(prev.theta);
        const mx = (prev.x + bd.x) / 2;
        g.bezierCurveTo(mx, py, mx, y, bd.x, y);
      }
    });
    strokeCurve(g, COLOUR.sin, line * 0.7, 0.55);
  }
  for (const bd of beads) {
    const y = b.y - b.amp * Math.sin(bd.theta);
    length(g, bd.x, b.y, bd.x, y, COLOUR.sin, line * 1.3, Math.sin(bd.theta) < 0);
    if (bd.lead) {
      g.strokeStyle = rgba(bd.colour, 0.5);
      g.lineWidth = line * 1.4;
      g.beginPath();
      g.arc(bd.x, y, b.r * 1.45, 0, TAU);
      g.stroke();
    }
    dot(g, bd.x, y, b.r, bd.colour);
  }
};

/** A ghost hand, its fingertip at (x, y), `size` venue px tall. */
export const drawHand = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha: number,
) => {
  if (alpha <= 0.01) return;
  const k = size / 100;
  g.save();
  // The fingertip sits at (41, 3) of the 100 x 100 drawing.
  g.translate(x - 41 * k, y - 3 * k);
  g.scale(k, k);
  g.fillStyle = `rgba(242,245,250,${0.7 * alpha})`;
  g.strokeStyle = `rgba(5,7,13,${0.6 * alpha})`;
  g.lineWidth = 4;
  const body = new Path2D();
  body.roundRect(33, 3, 17, 62, 8.5);
  body.roundRect(53, 44, 14, 26, 7);
  body.roundRect(70, 47, 13, 24, 6.5);
  body.roundRect(86, 51, 11, 22, 5.5);
  body.addPath(new Path2D("M31 58H97V74C97 87 87 97 74 97H53C40 97 31 88 31 76Z"));
  g.stroke(body);
  g.fill(body);
  g.lineCap = "round";
  g.lineWidth = 15;
  g.strokeStyle = `rgba(242,245,250,${0.7 * alpha})`;
  g.beginPath();
  g.moveTo(33, 64);
  g.lineTo(19, 50);
  g.stroke();
  g.restore();
};
