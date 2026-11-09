/**
 * Drawing: blocks, cranes, the hook and the small pictures on buttons. Canvas2D in venue px;
 * callers set the transform. Every piece is our own simple flat design.
 */
import { BH, BLOCK_DRAW_W, KIND } from "./config";
import type { Scene } from "./layout";

export type G = CanvasRenderingContext2D;

export const BLOCK_COLORS: Record<number, { body: string; dark: string; light: string }> = {
  [KIND.plain]: { body: "#d6c7ad", dark: "#a8977c", light: "#efe4d0" },
  [KIND.glass]: { body: "#4f93c9", dark: "#2f6a9c", light: "#9fd3f2" },
  [KIND.balcony]: { body: "#e2a66a", dark: "#b67d45", light: "#f5c896" },
  [KIND.roof]: { body: "#5f6b86", dark: "#414a60", light: "#8a96b2" },
};

const WINDOW_DARK = "#26304a";
const WINDOW_LIT = "#ffd581";
const GLASS_LIT = "#d8f2ff";

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Mix two `#rrggbb` colours. */
export const mix = (a: string, b: string, t: number): string => {
  const p = hexToRgb(a);
  const q = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  const c = (i: number) => Math.round(p[i]! + (q[i]! - p[i]!) * k);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
};

export const rgba = (hex: string, a: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
};

/** A stable pseudo-random 0..1 for a window, so the same windows stay lit. */
const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export interface BlockLook {
  /** 0 dark windows, 1 every lit window on. */
  lit: number;
  /** Rounded sides, for the round tower. */
  round?: "left" | "right" | "both" | null;
  /** A roof in a spire's top slot. */
  spire?: boolean;
  alpha?: number;
  seed?: number;
}

/** A block with its bottom-left at (x, y + h) and size w x h, venue px. */
export const drawBlock = (
  g: G,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: number,
  look: BlockLook,
) => {
  const c = BLOCK_COLORS[kind] ?? BLOCK_COLORS[KIND.plain]!;
  const seed = look.seed ?? 0;
  g.save();
  g.globalAlpha = look.alpha ?? 1;
  if (kind === KIND.roof && look.spire) {
    drawSpire(g, x, y, w, h, c, look.lit);
    g.restore();
    return;
  }
  const rr = Math.min(w, h) * 0.42;
  const rl = look.round === "left" || look.round === "both" ? rr : 0;
  const rrt = look.round === "right" || look.round === "both" ? rr : 0;
  g.beginPath();
  g.roundRect(x, y, w, h, [rl, rrt, rrt, rl]);
  g.fillStyle = c.body;
  g.fill();
  // A shade along the bottom and a highlight along the top, so stacked blocks read as floors.
  g.fillStyle = c.dark;
  g.fillRect(x + rl * 0.3, y + h * 0.86, w - (rl + rrt) * 0.3, h * 0.14);
  g.fillStyle = c.light;
  g.fillRect(x + rl * 0.5, y, w - (rl + rrt) * 0.5, h * 0.07);
  const lit = Math.max(0, Math.min(1, look.lit));
  if (kind === KIND.glass) {
    g.fillStyle = mix("#3a74a6", GLASS_LIT, lit * 0.85);
    g.fillRect(x + w * 0.08, y + h * 0.14, w * 0.84, h * 0.64);
    g.strokeStyle = c.dark;
    g.lineWidth = Math.max(1, w * 0.025);
    g.beginPath();
    for (let i = 1; i < 4; i++) {
      const mx = x + w * 0.08 + (w * 0.84 * i) / 4;
      g.moveTo(mx, y + h * 0.14);
      g.lineTo(mx, y + h * 0.78);
    }
    g.moveTo(x + w * 0.08, y + h * 0.46);
    g.lineTo(x + w * 0.92, y + h * 0.46);
    g.stroke();
    // A sheen across the glass by day.
    g.fillStyle = `rgba(255,255,255,${0.18 * (1 - lit)})`;
    g.beginPath();
    g.moveTo(x + w * 0.2, y + h * 0.14);
    g.lineTo(x + w * 0.36, y + h * 0.14);
    g.lineTo(x + w * 0.22, y + h * 0.78);
    g.lineTo(x + w * 0.08, y + h * 0.78);
    g.fill();
  } else {
    const cols = kind === KIND.balcony ? 2 : 3;
    const rows = kind === KIND.roof ? 1 : 2;
    const top = kind === KIND.roof ? 0.42 : 0.16;
    const bottom = kind === KIND.balcony ? 0.66 : 0.8;
    const cw = (w * 0.8) / cols;
    const ch = ((bottom - top) * h) / rows;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < cols; i++) {
        const on = hash(seed * 7 + r, i) < 0.78 ? lit : lit * 0.15;
        g.fillStyle = mix(WINDOW_DARK, WINDOW_LIT, on);
        g.fillRect(
          x + w * 0.1 + i * cw + cw * 0.16,
          y + top * h + r * ch + ch * 0.14,
          cw * 0.68,
          ch * 0.66,
        );
      }
    }
    if (kind === KIND.balcony) {
      // The balcony: a slab and railing along the bottom.
      g.fillStyle = c.light;
      g.fillRect(x - w * 0.03, y + h * 0.7, w * 1.06, h * 0.06);
      g.strokeStyle = c.dark;
      g.lineWidth = Math.max(1, w * 0.02);
      g.beginPath();
      g.moveTo(x, y + h * 0.7);
      g.lineTo(x + w, y + h * 0.7);
      for (let i = 0; i <= 8; i++) {
        const bx = x + (w * i) / 8;
        g.moveTo(bx, y + h * 0.7);
        g.lineTo(bx, y + h * 0.84);
      }
      g.moveTo(x, y + h * 0.84);
      g.lineTo(x + w, y + h * 0.84);
      g.stroke();
    }
    if (kind === KIND.roof) {
      // A parapet and a rooftop plant box.
      g.fillStyle = c.dark;
      g.fillRect(x, y, w, h * 0.12);
      g.fillStyle = c.light;
      g.fillRect(x + w * 0.58, y - h * 0.18, w * 0.24, h * 0.2);
      g.fillStyle = c.dark;
      g.fillRect(x + w * 0.62, y - h * 0.26, w * 0.05, h * 0.1);
    }
  }
  g.restore();
};

const drawSpire = (
  g: G,
  x: number,
  y: number,
  w: number,
  h: number,
  c: { body: string; dark: string; light: string },
  lit: number,
) => {
  g.fillStyle = c.body;
  g.beginPath();
  g.moveTo(x + w * 0.06, y + h);
  g.lineTo(x + w * 0.94, y + h);
  g.lineTo(x + w * 0.62, y + h * 0.2);
  g.lineTo(x + w * 0.38, y + h * 0.2);
  g.closePath();
  g.fill();
  g.fillStyle = c.light;
  g.beginPath();
  g.moveTo(x + w * 0.5, y + h * 0.2);
  g.lineTo(x + w * 0.62, y + h * 0.2);
  g.lineTo(x + w * 0.94, y + h);
  g.lineTo(x + w * 0.62, y + h);
  g.closePath();
  g.fill();
  g.strokeStyle = c.dark;
  g.lineWidth = Math.max(1.5, w * 0.04);
  g.beginPath();
  g.moveTo(x + w * 0.5, y + h * 0.2);
  g.lineTo(x + w * 0.5, y - h * 0.55);
  g.stroke();
  // A small light on the mast's tip: steady, never flashing.
  g.fillStyle = mix("#7a4040", "#ff8a6a", 0.4 + 0.6 * lit);
  g.beginPath();
  g.arc(x + w * 0.5, y - h * 0.58, Math.max(2, w * 0.06), 0, Math.PI * 2);
  g.fill();
};

/** A block drawn at a world position (centre), in a scene, rotated by `spin`. */
export const drawWorldBlock = (
  g: G,
  sc: Scene,
  cx: number,
  cy: number,
  kind: number,
  look: BlockLook & { spin?: number; scale?: number },
) => {
  const k = look.scale ?? 1;
  const w = BLOCK_DRAW_W * sc.s * k;
  const h = BH * sc.s * 0.96 * k;
  const vx = sc.ox + cx * sc.s;
  const vy = sc.gy - cy * sc.s;
  if (look.spin) {
    g.save();
    g.translate(vx, vy);
    g.rotate(look.spin);
    drawBlock(g, -w / 2, -h / 2, w, h, kind, look);
    g.restore();
  } else drawBlock(g, vx - w / 2, vy - h / 2, w, h, kind, look);
};

/** A lattice: two rails and zigzag braces between (x0, y0) and (x1, y1), venue px, width `t`. */
const lattice = (g: G, x0: number, y0: number, x1: number, y1: number, t: number, lw: number) => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (t / 2);
  const ny = (dx / len) * (t / 2);
  g.lineWidth = lw;
  g.beginPath();
  g.moveTo(x0 + nx, y0 + ny);
  g.lineTo(x1 + nx, y1 + ny);
  g.moveTo(x0 - nx, y0 - ny);
  g.lineTo(x1 - nx, y1 - ny);
  const n = Math.max(1, Math.round(len / t));
  for (let i = 0; i < n; i++) {
    const a = i / n;
    const b = (i + 1) / n;
    const side = i % 2 === 0 ? 1 : -1;
    g.moveTo(x0 + dx * a + nx * side, y0 + dy * a + ny * side);
    g.lineTo(x0 + dx * b - nx * side, y0 + dy * b - ny * side);
  }
  g.stroke();
};

export interface CraneLook {
  color: string;
  /** Venue y the mast starts from (the ground, or a frame's edge on a bank). */
  footY?: number;
  /** Draw only the mast below this venue y (a bank frame shows just the foot). */
  mastOnly?: boolean;
}

/** The mast, jib, counter-jib and cab: everything that doesn't move. */
export const drawCraneStatic = (
  g: G,
  sc: Scene,
  w: {
    mastX: number;
    jibY: number;
    jibFrom: number;
    jibTo: number;
  },
  look: CraneLook,
) => {
  const s = sc.s;
  const mx = sc.ox + w.mastX * s;
  const foot = look.footY ?? sc.gy;
  const jy = sc.gy - w.jibY * s;
  const mastW = 0.42 * s;
  const lw = Math.max(1.5, 0.045 * s);
  g.strokeStyle = look.color;
  g.lineCap = "round";
  if (look.mastOnly) {
    lattice(g, mx, foot, mx, 0, mastW, lw);
    g.fillStyle = mix("#3a4256", look.color, 0.25);
    g.fillRect(mx - mastW * 0.9, foot - 0.12 * s, mastW * 1.8, 0.24 * s);
    return;
  }
  lattice(g, mx, foot, mx, jy + 0.12 * s, mastW, lw);
  // The base slab.
  g.fillStyle = "#3a4256";
  g.fillRect(mx - mastW * 1.1, sc.gy - 0.1 * s, mastW * 2.2, 0.16 * s);
  const jx0 = sc.ox + w.jibFrom * s;
  const jx1 = sc.ox + w.jibTo * s;
  const jibT = 0.3 * s;
  lattice(g, jx0, jy, jx1, jy, jibT, lw);
  // Tower head and ties.
  const apex = jy - 0.68 * s;
  g.lineWidth = lw;
  g.beginPath();
  g.moveTo(mx - mastW / 2, jy - jibT / 2);
  g.lineTo(mx, apex);
  g.lineTo(mx + mastW / 2, jy - jibT / 2);
  g.moveTo(mx, apex);
  g.lineTo(mx + (jx1 - mx) * 0.62, jy - jibT / 2);
  g.moveTo(mx, apex);
  g.lineTo(jx0 + (mx - jx0) * 0.1, jy - jibT / 2);
  g.stroke();
  // Counterweight at the short end.
  const cwW = Math.min(Math.abs(mx - jx0) * 0.45, 0.7 * s);
  const cwx = jx0 < mx ? jx0 + 0.05 * s : jx0 - cwW - 0.05 * s;
  g.fillStyle = "#4a5266";
  g.fillRect(cwx, jy + jibT / 2, cwW, 0.45 * s);
  g.fillStyle = "#5e677d";
  g.fillRect(cwx, jy + jibT / 2, cwW, 0.08 * s);
  // The cab, on the jib side of the mast.
  const side = jx1 > mx ? 1 : -1;
  const cabW = 0.45 * s;
  const cabX = side > 0 ? mx + mastW / 2 : mx - mastW / 2 - cabW;
  g.fillStyle = mix("#20283a", look.color, 0.35);
  g.beginPath();
  g.roundRect(cabX, jy + jibT / 2, cabW, 0.38 * s, 0.06 * s);
  g.fill();
  g.fillStyle = "rgba(170,220,255,0.75)";
  g.fillRect(
    cabX + (side > 0 ? cabW * 0.45 : cabW * 0.1),
    jy + jibT / 2 + 0.07 * s,
    cabW * 0.45,
    0.17 * s,
  );
};

/** Trolley, cable and hook (with sling lines when carrying). */
export const drawHook = (
  g: G,
  sc: Scene,
  trolleyX: number,
  sheaveY: number,
  hook: { x: number; y: number },
  carrying: { x: number; y: number } | null,
  color: string,
) => {
  const s = sc.s;
  const tx = sc.ox + trolleyX * s;
  const ty = sc.gy - sheaveY * s;
  const hx = sc.ox + hook.x * s;
  const hy = sc.gy - hook.y * s;
  // Trolley.
  g.fillStyle = mix("#2a3246", color, 0.55);
  g.beginPath();
  g.roundRect(tx - 0.28 * s, ty - 0.16 * s, 0.56 * s, 0.16 * s, 0.04 * s);
  g.fill();
  // Two falls of cable.
  g.strokeStyle = "rgba(220,228,240,0.9)";
  g.lineWidth = Math.max(1, 0.025 * s);
  g.beginPath();
  g.moveTo(tx - 0.07 * s, ty);
  g.lineTo(hx - 0.07 * s, hy - 0.2 * s);
  g.moveTo(tx + 0.07 * s, ty);
  g.lineTo(hx + 0.07 * s, hy - 0.2 * s);
  g.stroke();
  // Hook block and hook.
  g.fillStyle = "#f2c94c";
  g.beginPath();
  g.roundRect(hx - 0.13 * s, hy - 0.24 * s, 0.26 * s, 0.17 * s, 0.04 * s);
  g.fill();
  g.strokeStyle = "#d8dee9";
  g.lineWidth = Math.max(1.5, 0.05 * s);
  g.beginPath();
  g.moveTo(hx, hy - 0.07 * s);
  g.lineTo(hx, hy);
  g.arc(hx - 0.06 * s, hy, 0.06 * s, 0, Math.PI * 0.95);
  g.stroke();
  if (carrying) {
    const bx = sc.ox + carrying.x * s;
    const by = sc.gy - carrying.y * s;
    const halfW = (BLOCK_DRAW_W / 2) * s * 0.85;
    const top = by - (BH / 2) * s * 0.96;
    g.strokeStyle = "rgba(230,236,245,0.85)";
    g.lineWidth = Math.max(1, 0.022 * s);
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(bx - halfW, top);
    g.moveTo(hx, hy);
    g.lineTo(bx + halfW, top);
    g.stroke();
  }
};

/** A pennant on a short pole, rippling with `t` (seconds). */
export const drawFlag = (
  g: G,
  x: number,
  y: number,
  size: number,
  color: string,
  t: number,
  rise: number,
) => {
  const pole = size * 1.6;
  const top = y - pole * rise;
  g.strokeStyle = "#e6ebf2";
  g.lineWidth = Math.max(1.5, size * 0.08);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, top);
  g.stroke();
  if (rise < 0.3) return;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, top);
  const n = 6;
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    g.lineTo(x + size * f, top + size * 0.25 * f + Math.sin(t * 5 - f * 3) * size * 0.08 * f);
  }
  for (let i = n; i >= 0; i--) {
    const f = i / n;
    g.lineTo(
      x + size * f,
      top + size * 0.62 - size * 0.12 * f + Math.sin(t * 5 - f * 3) * size * 0.08 * f,
    );
  }
  g.closePath();
  g.fill();
};

/** A simple hand (palm and fingers) pointing up, centred at its fingertip (x, y). */
export const drawHand = (g: G, x: number, y: number, size: number, alpha: number) => {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = "#ffffff";
  g.strokeStyle = "rgba(10,14,24,0.6)";
  g.lineWidth = Math.max(1, size * 0.04);
  const u = size / 10;
  g.beginPath();
  g.roundRect(x - 1.1 * u, y, 2.2 * u, 5.5 * u, 1.1 * u);
  g.roundRect(x + 1.3 * u, y + 2.2 * u, 2 * u, 4.4 * u, 1 * u);
  g.roundRect(x + 3.5 * u, y + 3 * u, 1.9 * u, 3.8 * u, 0.95 * u);
  g.roundRect(x - 3.5 * u, y + 4.2 * u, 2 * u, 3.6 * u, 1 * u);
  g.roundRect(x - 3.6 * u, y + 5.2 * u, 9 * u, 5.8 * u, 2.4 * u);
  g.fill();
  g.stroke();
  g.restore();
};

/** The release button's picture: an open hook letting a block go. */
export const drawReleaseIcon = (g: G, x: number, y: number, r: number, color: string) => {
  const u = r / 10;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 1.1 * u;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x, y - 7 * u);
  g.lineTo(x, y - 2.5 * u);
  g.arc(x - 1.6 * u, y - 2.5 * u, 1.6 * u, 0, Math.PI * 0.9);
  g.stroke();
  // The block, falling free.
  g.beginPath();
  g.roundRect(x - 3.2 * u, y + 1.2 * u, 6.4 * u, 3.6 * u, 0.7 * u);
  g.fill();
  g.beginPath();
  g.moveTo(x - 5.2 * u, y + 6.4 * u);
  g.lineTo(x - 3.6 * u, y + 7.6 * u);
  g.moveTo(x + 5.2 * u, y + 6.4 * u);
  g.lineTo(x + 3.6 * u, y + 7.6 * u);
  g.stroke();
};
