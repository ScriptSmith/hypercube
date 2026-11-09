/**
 * Our own drawings: kites (diamonds, deltas and a few creatures), tails, lines, rings, sparkles,
 * clouds, tree tops and a windsock. Everything is in canvas px with y down. Kite `spin` is the
 * kites' own convention (0 up, positive leans left), so the canvas rotation is its negative.
 */
import { withAlpha } from "../../core/ui";
import type { Shape } from "./wire";
import type { Tail } from "./tail";

type Ctx = CanvasRenderingContext2D;

const shade = (hex: string, k: number): string => {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  if (!Number.isFinite(n)) return hex;
  const f = (c: number) =>
    Math.round(Math.min(255, Math.max(0, k >= 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

const shadeCache = new Map<string, string>();
/** `hex` lightened (k > 0) or darkened (k < 0), cached. */
export const tint = (hex: string, k: number): string => {
  const key = `${hex}:${k}`;
  let v = shadeCache.get(key);
  if (!v) {
    v = shade(hex, k);
    if (shadeCache.size > 256) shadeCache.clear();
    shadeCache.set(key, v);
  }
  return v;
};

export const LINE_COLOR = "rgba(236,242,250,0.82)";

/**
 * A kite centred at (x, y), `size` px across its long side. `alpha` fades it; `glow` draws a
 * soft halo in its colour (people are flying it).
 */
export const drawKite = (
  g: Ctx,
  shape: Shape,
  x: number,
  y: number,
  size: number,
  spin: number,
  color: string,
  alpha = 1,
  glow = false,
): void => {
  g.save();
  g.translate(x, y);
  g.rotate(-spin);
  g.globalAlpha = alpha;
  if (glow) {
    g.shadowColor = withAlpha(color, 0.9);
    g.shadowBlur = size * 0.35;
  }
  const s = size;
  const light = tint(color, 0.45);
  const dark = tint(color, -0.35);
  g.lineJoin = "round";
  switch (shape) {
    case "diamond": {
      g.beginPath();
      g.moveTo(0, -0.55 * s);
      g.lineTo(0.38 * s, -0.12 * s);
      g.lineTo(0, 0.45 * s);
      g.lineTo(-0.38 * s, -0.12 * s);
      g.closePath();
      g.fillStyle = color;
      g.fill();
      g.shadowBlur = 0;
      g.beginPath();
      g.moveTo(0, -0.55 * s);
      g.lineTo(0.38 * s, -0.12 * s);
      g.lineTo(0, -0.12 * s);
      g.closePath();
      g.fillStyle = light;
      g.fill();
      g.beginPath();
      g.moveTo(0, -0.12 * s);
      g.lineTo(-0.38 * s, -0.12 * s);
      g.lineTo(0, 0.45 * s);
      g.closePath();
      g.fillStyle = dark;
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.lineWidth = Math.max(1, s * 0.025);
      g.beginPath();
      g.moveTo(0, -0.55 * s);
      g.lineTo(0, 0.45 * s);
      g.moveTo(-0.38 * s, -0.12 * s);
      g.lineTo(0.38 * s, -0.12 * s);
      g.stroke();
      break;
    }
    case "delta": {
      g.beginPath();
      g.moveTo(0, -0.42 * s);
      g.lineTo(0.55 * s, 0.26 * s);
      g.lineTo(0, 0.12 * s);
      g.lineTo(-0.55 * s, 0.26 * s);
      g.closePath();
      g.fillStyle = color;
      g.fill();
      g.shadowBlur = 0;
      g.beginPath();
      g.moveTo(0, -0.42 * s);
      g.lineTo(0.22 * s, -0.02 * s);
      g.lineTo(0, 0.12 * s);
      g.lineTo(-0.22 * s, -0.02 * s);
      g.closePath();
      g.fillStyle = light;
      g.fill();
      g.beginPath();
      g.moveTo(0.55 * s, 0.26 * s);
      g.lineTo(0.38 * s, 0.05 * s);
      g.lineTo(0.3 * s, 0.2 * s);
      g.closePath();
      g.moveTo(-0.55 * s, 0.26 * s);
      g.lineTo(-0.38 * s, 0.05 * s);
      g.lineTo(-0.3 * s, 0.2 * s);
      g.closePath();
      g.fillStyle = dark;
      g.fill();
      break;
    }
    case "fish": {
      g.beginPath();
      g.ellipse(0, -0.08 * s, 0.24 * s, 0.4 * s, 0, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.shadowBlur = 0;
      g.beginPath();
      g.moveTo(0, 0.24 * s);
      g.lineTo(0.22 * s, 0.5 * s);
      g.lineTo(-0.22 * s, 0.5 * s);
      g.closePath();
      g.fillStyle = dark;
      g.fill();
      g.beginPath();
      g.ellipse(0, -0.02 * s, 0.13 * s, 0.24 * s, 0, 0, Math.PI * 2);
      g.fillStyle = light;
      g.fill();
      g.beginPath();
      g.arc(-0.09 * s, -0.3 * s, 0.045 * s, 0, Math.PI * 2);
      g.arc(0.09 * s, -0.3 * s, 0.045 * s, 0, Math.PI * 2);
      g.fillStyle = "#0b1020";
      g.fill();
      break;
    }
    case "bird": {
      g.beginPath();
      g.moveTo(0, -0.12 * s);
      g.quadraticCurveTo(-0.25 * s, -0.42 * s, -0.56 * s, -0.12 * s);
      g.quadraticCurveTo(-0.3 * s, -0.16 * s, 0, 0.08 * s);
      g.quadraticCurveTo(0.3 * s, -0.16 * s, 0.56 * s, -0.12 * s);
      g.quadraticCurveTo(0.25 * s, -0.42 * s, 0, -0.12 * s);
      g.fillStyle = color;
      g.fill();
      g.shadowBlur = 0;
      g.beginPath();
      g.ellipse(0, 0.02 * s, 0.09 * s, 0.26 * s, 0, 0, Math.PI * 2);
      g.fillStyle = light;
      g.fill();
      g.beginPath();
      g.moveTo(0, 0.24 * s);
      g.lineTo(0.13 * s, 0.42 * s);
      g.lineTo(-0.13 * s, 0.42 * s);
      g.closePath();
      g.fillStyle = dark;
      g.fill();
      break;
    }
    case "dragon": {
      g.beginPath();
      g.arc(0, -0.12 * s, 0.3 * s, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.shadowBlur = 0;
      g.beginPath();
      g.moveTo(-0.22 * s, -0.32 * s);
      g.lineTo(-0.34 * s, -0.56 * s);
      g.lineTo(-0.08 * s, -0.4 * s);
      g.moveTo(0.22 * s, -0.32 * s);
      g.lineTo(0.34 * s, -0.56 * s);
      g.lineTo(0.08 * s, -0.4 * s);
      g.fillStyle = light;
      g.fill();
      g.beginPath();
      g.arc(-0.11 * s, -0.16 * s, 0.06 * s, 0, Math.PI * 2);
      g.arc(0.11 * s, -0.16 * s, 0.06 * s, 0, Math.PI * 2);
      g.fillStyle = "#0b1020";
      g.fill();
      g.beginPath();
      g.ellipse(0, 0.02 * s, 0.14 * s, 0.07 * s, 0, 0, Math.PI * 2);
      g.fillStyle = dark;
      g.fill();
      break;
    }
  }
  g.restore();
};

/** A ribbon tail with bows, or (dragon) a chain of shrinking scales. */
export const drawTail = (
  g: Ctx,
  t: Tail,
  shape: Shape,
  color: string,
  width: number,
  alpha = 1,
): void => {
  if (!t.placed || t.n < 2) return;
  g.save();
  g.globalAlpha = alpha;
  if (shape === "dragon") {
    for (let i = t.n - 1; i >= 1; i--) {
      const r = width * (2.4 - (1.7 * i) / t.n);
      g.beginPath();
      g.arc(t.x[i]!, t.y[i]!, r, 0, Math.PI * 2);
      g.fillStyle = i % 2 ? color : tint(color, 0.35);
      g.fill();
    }
    g.restore();
    return;
  }
  g.strokeStyle = shape === "fish" ? tint(color, 0.3) : "rgba(236,242,250,0.75)";
  g.lineWidth = width * 0.45;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(t.x[0]!, t.y[0]!);
  for (let i = 1; i < t.n; i++) g.lineTo(t.x[i]!, t.y[i]!);
  g.stroke();
  const bow = width * 1.6;
  for (let i = 2; i < t.n; i += 2) {
    const x = t.x[i]!;
    const y = t.y[i]!;
    const dx = x - t.x[i - 1]!;
    const dy = y - t.y[i - 1]!;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + nx * bow + (dx / len) * bow * 0.5, y + ny * bow + (dy / len) * bow * 0.5);
    g.lineTo(x + nx * bow - (dx / len) * bow * 0.5, y + ny * bow - (dy / len) * bow * 0.5);
    g.closePath();
    g.moveTo(x, y);
    g.lineTo(x - nx * bow + (dx / len) * bow * 0.5, y - ny * bow + (dy / len) * bow * 0.5);
    g.lineTo(x - nx * bow - (dx / len) * bow * 0.5, y - ny * bow - (dy / len) * bow * 0.5);
    g.closePath();
    g.fillStyle = i % 4 === 0 ? color : tint(color, 0.4);
    g.fill();
  }
  g.restore();
};

/**
 * A kite line from (x0, y0) to (x1, y1), sagging under its own weight when slack. With `via`
 * the line bends through that point (a tangle's twist).
 */
export const drawLine = (
  g: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tension: number,
  width: number,
  via: { x: number; y: number } | null = null,
  color = LINE_COLOR,
): void => {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x0, y0);
  if (via) {
    g.lineTo(via.x, via.y);
    g.lineTo(x1, y1);
  } else {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const sag = Math.max(0, 1 - Math.min(1, tension)) * len * 0.14 + len * 0.012;
    g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag, x1, y1);
  }
  g.stroke();
};

/**
 * A hand with its index finger pointing up, the fingertip at (x, y), `size` px tall, white with a
 * dark outline (the same shape as the UI kit's hand icon).
 */
export const drawHand = (g: Ctx, x: number, y: number, size: number, alpha: number): void => {
  if (alpha <= 0.01) return;
  const shape = (grow: number) => {
    g.beginPath();
    g.roundRect(33 - grow, 3 - grow, 17 + 2 * grow, 62 + 2 * grow, 8.5 + grow);
    g.roundRect(53 - grow, 44 - grow, 14 + 2 * grow, 26 + 2 * grow, 7 + grow);
    g.roundRect(70 - grow, 47 - grow, 13 + 2 * grow, 24 + 2 * grow, 6.5 + grow);
    g.roundRect(86 - grow, 51 - grow, 11 + 2 * grow, 22 + 2 * grow, 5.5 + grow);
    g.moveTo(31 - grow, 58 - grow);
    g.lineTo(97 + grow, 58 - grow);
    g.lineTo(97 + grow, 74);
    g.bezierCurveTo(97 + grow, 87 + grow, 87 + grow, 97 + grow, 74, 97 + grow);
    g.lineTo(53, 97 + grow);
    g.bezierCurveTo(40 - grow, 97 + grow, 31 - grow, 88 + grow, 31 - grow, 76);
    g.closePath();
    g.fill();
    g.lineWidth = 15 + 2 * grow;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(33, 64);
    g.lineTo(19, 50);
    g.stroke();
  };
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.scale(size / 100, size / 100);
  g.translate(-41.5, -3);
  g.fillStyle = g.strokeStyle = "rgba(8,14,26,0.9)";
  shape(4);
  g.fillStyle = g.strokeStyle = "#f4f7fb";
  shape(0);
  g.restore();
};

/** The point on a sagging line (as drawLine draws it) at fraction `f` from its start. */
export const linePoint = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tension: number,
  f: number,
): { x: number; y: number } => {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const sag = Math.max(0, 1 - Math.min(1, tension)) * len * 0.14 + len * 0.012;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2 + sag;
  const a = (1 - f) * (1 - f);
  const b = 2 * (1 - f) * f;
  const c = f * f;
  return { x: a * x0 + b * cx + c * x1, y: a * y0 + b * cy + c * y1 };
};

/** A twist where two lines are caught together. */
export const drawTwist = (
  g: Ctx,
  x: number,
  y: number,
  r: number,
  a: string,
  b: string,
  t: number,
): void => {
  g.save();
  g.translate(x, y);
  g.rotate(t * 3);
  g.lineWidth = Math.max(1.5, r * 0.28);
  for (let i = 0; i < 3; i++) {
    g.strokeStyle = i % 2 ? a : b;
    g.beginPath();
    g.ellipse(0, 0, r, r * 0.45, (i * Math.PI) / 3, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
};

/** A ring to fly through. */
export const drawRing = (g: Ctx, x: number, y: number, r: number, t: number, alpha = 1): void => {
  g.save();
  g.globalAlpha = alpha;
  const pulse = 1 + 0.04 * Math.sin(t * 3);
  g.lineWidth = r * 0.16;
  g.strokeStyle = "rgba(255,240,170,0.92)";
  g.shadowColor = "rgba(255,230,140,0.8)";
  g.shadowBlur = r * 0.35;
  g.beginPath();
  g.ellipse(x, y, r * 0.78 * pulse, r * pulse, 0, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 0;
  g.lineWidth = r * 0.05;
  g.strokeStyle = "rgba(255,255,255,0.8)";
  g.beginPath();
  g.ellipse(x, y, r * 0.78 * pulse, r * pulse, 0, Math.PI * 1.1, Math.PI * 1.6);
  g.stroke();
  g.restore();
};

/** A small tally ring, filled with a colour. */
export const drawTallyRing = (g: Ctx, x: number, y: number, r: number, color: string): void => {
  g.lineWidth = r * 0.36;
  g.strokeStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
};

/** A soft cloud sprite, drawn once. */
export const makeCloud = (w: number, seed: number): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  const h = Math.round(w * 0.45);
  c.width = Math.max(8, Math.round(w));
  c.height = Math.max(4, h);
  const g = c.getContext("2d");
  if (!g) return c;
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 9; i++) {
    const cx = w * (0.18 + 0.64 * rnd());
    const cy = h * (0.45 + 0.25 * rnd());
    // Kept inside the sprite, so no blob is cut off square.
    const r = Math.min(h * (0.22 + 0.22 * rnd()), cx, w - cx, cy, h - cy);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, "rgba(225,236,250,0.5)");
    grad.addColorStop(1, "rgba(225,236,250,0)");
    g.fillStyle = grad;
    g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  }
  return c;
};

const TREE_GREENS = ["#0d2c22", "#11352a", "#0a251c", "#14402f"];

/**
 * Tree tops along a line at `base` (their bottom), from x0 to x1, each swaying with `sway(x)`
 * px. `size` is a crown's radius.
 */
export const drawTreeTops = (
  g: Ctx,
  x0: number,
  x1: number,
  base: number,
  size: number,
  sway: (x: number) => number,
  seed: number,
): void => {
  const step = size * 1.5;
  let i = 0;
  for (let x = x0 - size; x < x1 + size; x += step, i++) {
    const h = ((Math.imul(i + seed, 2654435761) >>> 0) % 1000) / 1000;
    const r = size * (0.8 + 0.45 * h);
    const lean = sway(x) * (0.6 + 0.6 * h);
    const top = base - r * (1.1 + 0.6 * h);
    g.fillStyle = TREE_GREENS[i % TREE_GREENS.length]!;
    g.beginPath();
    g.arc(x + lean * 0.5, base - r * 0.3, r, 0, Math.PI * 2);
    g.arc(x + lean, top + r * 0.4, r * 0.82, 0, Math.PI * 2);
    g.arc(x - r * 0.5 + lean * 0.7, base - r * 0.65, r * 0.7, 0, Math.PI * 2);
    g.arc(x + r * 0.55 + lean * 0.7, base - r * 0.6, r * 0.72, 0, Math.PI * 2);
    g.fill();
  }
};

/**
 * A windsock on a pole whose foot is at (x, y), `h` px tall. `wind` is signed, about -2 to 2
 * wind units: the sock streams out further and points downwind as it rises.
 */
export const drawWindsock = (
  g: Ctx,
  x: number,
  y: number,
  h: number,
  wind: number,
  t: number,
): void => {
  g.save();
  g.strokeStyle = "#c9d3ea";
  g.lineWidth = Math.max(2, h * 0.04);
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - h);
  g.stroke();
  const strength = Math.min(1, Math.abs(wind) / 1.4);
  const dir = wind >= 0 ? 1 : -1;
  // Hangs down in no wind, straight out in a strong one, flapping a little.
  const angle = (Math.PI / 2) * (1 - strength) + 0.06 * Math.sin(t * 7) * strength;
  const len = h * 0.62;
  g.translate(x, y - h * 0.97);
  g.scale(dir, 1);
  g.rotate(angle);
  const bands = 4;
  for (let i = 0; i < bands; i++) {
    const a = (i / bands) * len;
    const b = ((i + 1) / bands) * len;
    const ra = h * 0.12 * (1 - (0.5 * i) / bands);
    const rb = h * 0.12 * (1 - (0.5 * (i + 1)) / bands);
    g.fillStyle = i % 2 ? "#f2f5fa" : "#6fa4fc";
    g.beginPath();
    g.moveTo(a, -ra);
    g.lineTo(b, -rb);
    g.lineTo(b, rb);
    g.lineTo(a, ra);
    g.closePath();
    g.fill();
  }
  g.restore();
};

/** Sparkles: a fixed pool of short-lived glints. */
export interface Sparkles {
  emit(x: number, y: number, color: string, n: number, speed: number): void;
  step(dt: number): void;
  draw(g: Ctx, size: number): void;
  clear(): void;
  readonly live: number;
}

export const createSparkles = (max = 360): Sparkles => {
  const x = new Float32Array(max);
  const y = new Float32Array(max);
  const vx = new Float32Array(max);
  const vy = new Float32Array(max);
  const life = new Float32Array(max);
  const color: string[] = Array.from({ length: max }, () => "#ffffff");
  let next = 0;
  let live = 0;
  return {
    emit(px, py, c, n, speed) {
      for (let i = 0; i < n; i++) {
        const j = next;
        next = (next + 1) % max;
        if (life[j]! <= 0) live++;
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.3 + 0.7 * Math.random());
        x[j] = px;
        y[j] = py;
        vx[j] = Math.cos(a) * v;
        vy[j] = Math.sin(a) * v;
        life[j] = 0.6 + 0.6 * Math.random();
        color[j] = c;
      }
    },
    step(dt) {
      live = 0;
      for (let i = 0; i < max; i++) {
        if (life[i]! <= 0) continue;
        life[i] = life[i]! - dt;
        x[i] = x[i]! + vx[i]! * dt;
        y[i] = y[i]! + vy[i]! * dt;
        vx[i] = vx[i]! * 0.96;
        vy[i] = vy[i]! * 0.96 + 20 * dt;
        if (life[i]! > 0) live++;
      }
    },
    draw(g, size) {
      if (live === 0) return;
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < max; i++) {
        const l = life[i]!;
        if (l <= 0) continue;
        const r = size * Math.min(1, l * 1.6);
        g.globalAlpha = Math.min(1, l * 1.4);
        g.fillStyle = color[i]!;
        g.beginPath();
        g.moveTo(x[i]!, y[i]! - r);
        g.lineTo(x[i]! + r * 0.3, y[i]! - r * 0.3);
        g.lineTo(x[i]! + r, y[i]!);
        g.lineTo(x[i]! + r * 0.3, y[i]! + r * 0.3);
        g.lineTo(x[i]!, y[i]! + r);
        g.lineTo(x[i]! - r * 0.3, y[i]! + r * 0.3);
        g.lineTo(x[i]! - r, y[i]!);
        g.lineTo(x[i]! - r * 0.3, y[i]! - r * 0.3);
        g.closePath();
        g.fill();
      }
      g.restore();
    },
    clear() {
      life.fill(0);
      live = 0;
    },
    get live() {
      return live;
    },
  };
};

/** Sky colours, top to bottom: deep for a bright room, light enough for dark kites' lines. */
export const SKY_STOPS: readonly [number, string][] = [
  [0, "#071330"],
  [0.55, "#123a66"],
  [1, "#2b6e93"],
];

export const fillSky = (g: Ctx, x: number, y: number, w: number, h: number): void => {
  const grad = g.createLinearGradient(0, y, 0, y + h);
  for (const [at, c] of SKY_STOPS) grad.addColorStop(at, c);
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
};
