/**
 * Drawings, all as Canvas2D paths so they stay crisp at any size: sand tiles, counts (digits or
 * dice-style dots), the bluebottle (a friendly blue float with a smile), the crab, the marker
 * pennant and the lifeguard tower. Tiles are rendered once per size into small canvases and reused.
 */
import { FONT } from "../../core/ui";

type G = CanvasRenderingContext2D;

export const COLORS = {
  gutter: "#3a2717",
  sandKid: "#e8bd72",
  sandAdult: "#d39a52",
  dugKid: "#f7ead0",
  dugAdult: "#f1dfbd",
  wet: "#a9794a",
  stung: "#ffd9cc",
  lifeguard: "#d4f1ee",
  crab: "#ff7a3d",
  crabDark: "#b0401a",
  bottle: "#5aa6ff",
  bottleDark: "#1d4fb8",
  crest: "#b58cff",
  flag: "#e2368f",
  flagLight: "#ff86c2",
  flagDark: "#7d1450",
  pole: "#5b3a1e",
  roof: "#36c2b4",
  roofDark: "#0f625b",
  board: "#7fd9ce",
  shirt: "#dfe5ea",
  hat: "#d6c69e",
  hatDark: "#a8966b",
  ink: "#1d1a16",
};

/** Count colours, one per number, all dark enough to read on pale sand from a distance. */
export const COUNT_COLORS = [
  "",
  "#1b56d1",
  "#16803a",
  "#cf2a2a",
  "#6a28b0",
  "#9a3f0b",
  "#08787b",
  "#262626",
  "#5c5c5c",
];

const rr = (g: G, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
};

const hash = (n: number) => {
  let h = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

const shade = (hex: string, f: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};

/** Gap between neighbouring tiles, as a share of the cell. */
export const GAP = 0.035;

/** Covered sand: a raised, rippled mound. */
export const drawCovered = (g: G, s: number, kid: boolean, variant: number) => {
  const base = kid ? COLORS.sandKid : COLORS.sandAdult;
  const p = s * GAP;
  const r = s * 0.16;
  rr(g, p, p, s - 2 * p, s - 2 * p, r);
  const grad = g.createLinearGradient(0, p, 0, s - p);
  grad.addColorStop(0, shade(base, 0.22));
  grad.addColorStop(0.55, base);
  grad.addColorStop(1, shade(base, -0.16));
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  // Wind ripples.
  g.strokeStyle = shade(base, -0.12);
  g.lineWidth = s * 0.022;
  g.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    const y = s * (0.3 + 0.2 * k + 0.06 * (hash(variant * 7 + k) - 0.5));
    const x0 = s * (0.12 + 0.2 * hash(variant * 13 + k));
    g.beginPath();
    g.moveTo(x0, y);
    g.quadraticCurveTo(x0 + s * 0.2, y - s * 0.05, x0 + s * 0.45, y);
    g.stroke();
  }
  // Grains.
  for (let k = 0; k < 18; k++) {
    const x = s * (0.1 + 0.8 * hash(variant * 101 + k * 3));
    const y = s * (0.1 + 0.8 * hash(variant * 103 + k * 5));
    g.fillStyle = k % 3 === 0 ? shade(base, 0.35) : shade(base, -0.25);
    g.beginPath();
    g.arc(x, y, s * (0.008 + 0.01 * hash(variant + k)), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  // Rim light on top, shadow at the bottom.
  rr(g, p, p, s - 2 * p, s - 2 * p, r);
  g.lineWidth = s * 0.02;
  g.strokeStyle = shade(base, -0.3);
  g.stroke();
};

/** Dug sand: flat and pale, with the shadow of the hole's top edge. */
export const drawDug = (g: G, s: number, kid: boolean, tint?: string) => {
  const base = tint ?? (kid ? COLORS.dugKid : COLORS.dugAdult);
  const p = s * GAP;
  const r = s * 0.12;
  rr(g, p, p, s - 2 * p, s - 2 * p, r);
  g.fillStyle = base;
  g.fill();
  g.save();
  g.clip();
  const grad = g.createLinearGradient(0, p, 0, p + s * 0.2);
  grad.addColorStop(0, "rgba(90,60,25,0.35)");
  grad.addColorStop(1, "rgba(90,60,25,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s * 0.3);
  g.restore();
};

/** Dice positions on a 3 x 3 grid for 1 to 8. */
const DOTS: readonly (readonly [number, number][])[] = [
  [],
  [[1, 1]],
  [
    [0, 0],
    [2, 2],
  ],
  [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
];

export const drawCount = (g: G, s: number, n: number, dots: boolean) => {
  if (n <= 0) return;
  const color = COUNT_COLORS[n] ?? COLORS.ink;
  if (dots) {
    const span = s * 0.52;
    const x0 = (s - span) / 2;
    const rad = s * (n >= 7 ? 0.078 : 0.102);
    g.fillStyle = color;
    for (const [cx, cy] of DOTS[n] ?? []) {
      g.beginPath();
      g.arc(x0 + (cx * span) / 2, x0 + (cy * span) / 2, rad, 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  g.fillStyle = color;
  g.font = `900 ${Math.round(s * 0.66)}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(n), s / 2, s * 0.54);
};

/** The bluebottle: a translucent float with a crest, big eyes, a smile and curly tentacles. */
export const drawBottle = (g: G, x: number, y: number, size: number, wobble = 0, happy = true) => {
  g.save();
  g.translate(x, y);
  const s = size;
  g.rotate(-0.12 + wobble * 0.08);
  // Tentacles.
  g.strokeStyle = "rgba(70,120,230,0.85)";
  g.lineWidth = s * 0.045;
  g.lineCap = "round";
  for (let k = 0; k < 4; k++) {
    const bx = -s * 0.2 + k * s * 0.13;
    g.beginPath();
    g.moveTo(bx, s * 0.08);
    g.bezierCurveTo(
      bx - s * 0.08,
      s * 0.2 + wobble * s * 0.03,
      bx + s * 0.08,
      s * 0.28,
      bx - s * 0.02 + Math.sin(k + wobble) * s * 0.04,
      s * 0.38,
    );
    g.stroke();
  }
  // Crest.
  g.beginPath();
  g.moveTo(-s * 0.22, -s * 0.12);
  g.quadraticCurveTo(-s * 0.05, -s * 0.42, s * 0.2, -s * 0.16);
  g.closePath();
  g.fillStyle = COLORS.crest;
  g.fill();
  g.lineWidth = s * 0.03;
  g.strokeStyle = "#6a49c9";
  g.stroke();
  // Float.
  g.beginPath();
  g.ellipse(0, -s * 0.02, s * 0.34, s * 0.17, 0, 0, Math.PI * 2);
  const body = g.createLinearGradient(0, -s * 0.2, 0, s * 0.16);
  body.addColorStop(0, "#9fd0ff");
  body.addColorStop(1, COLORS.bottle);
  g.fillStyle = body;
  g.fill();
  g.lineWidth = s * 0.035;
  g.strokeStyle = COLORS.bottleDark;
  g.stroke();
  // Shine.
  g.beginPath();
  g.ellipse(-s * 0.17, -s * 0.09, s * 0.07, s * 0.035, -0.4, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.fill();
  // Eyes.
  for (const ex of [-s * 0.07, s * 0.1]) {
    g.beginPath();
    g.arc(ex, -s * 0.04, s * 0.06, 0, Math.PI * 2);
    g.fillStyle = "#ffffff";
    g.fill();
    g.lineWidth = s * 0.015;
    g.strokeStyle = COLORS.bottleDark;
    g.stroke();
    g.beginPath();
    g.arc(ex + s * 0.012, -s * 0.03, s * 0.03, 0, Math.PI * 2);
    g.fillStyle = "#14204a";
    g.fill();
  }
  // Smile.
  g.beginPath();
  if (happy) g.arc(s * 0.015, s * 0.035, s * 0.07, 0.15 * Math.PI, 0.85 * Math.PI);
  else g.arc(s * 0.015, s * 0.1, s * 0.05, 1.2 * Math.PI, 1.8 * Math.PI);
  g.lineWidth = s * 0.028;
  g.strokeStyle = "#14204a";
  g.stroke();
  // Cheeks.
  g.fillStyle = "rgba(255,120,160,0.45)";
  for (const cx of [-s * 0.16, s * 0.2]) {
    g.beginPath();
    g.ellipse(cx, s * 0.04, s * 0.04, s * 0.025, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
};

/** The crab, facing the viewer. `step` (0 to 1) moves its legs; `wave` lifts its claws. */
export const drawCrab = (g: G, x: number, y: number, size: number, step = 0, wave = 0) => {
  g.save();
  g.translate(x, y);
  const s = size;
  const legLift = Math.sin(step * Math.PI * 2) * s * 0.04;
  g.strokeStyle = COLORS.crabDark;
  g.lineWidth = s * 0.05;
  g.lineCap = "round";
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const lift = (k % 2 === 0 ? 1 : -1) * legLift * side;
      g.beginPath();
      g.moveTo(side * s * 0.2, s * (0.02 + k * 0.07));
      g.lineTo(side * s * 0.38, s * (0.06 + k * 0.09) + lift);
      g.lineTo(side * s * 0.44, s * (0.16 + k * 0.08) + lift);
      g.stroke();
    }
  }
  // Claws.
  for (const side of [-1, 1]) {
    const up = wave * s * 0.12;
    g.beginPath();
    g.moveTo(side * s * 0.22, -s * 0.04);
    g.lineTo(side * s * 0.36, -s * 0.2 - up);
    g.stroke();
    g.beginPath();
    g.arc(side * s * 0.38, -s * 0.27 - up, s * 0.1, 0, Math.PI * 2);
    g.fillStyle = COLORS.crab;
    g.fill();
    g.lineWidth = s * 0.03;
    g.stroke();
    g.beginPath();
    g.moveTo(side * s * 0.38, -s * 0.27 - up);
    g.lineTo(side * s * 0.46, -s * 0.36 - up);
    g.strokeStyle = COLORS.crabDark;
    g.stroke();
    g.lineWidth = s * 0.05;
  }
  // Body.
  g.beginPath();
  g.ellipse(0, s * 0.04, s * 0.27, s * 0.17, 0, 0, Math.PI * 2);
  g.fillStyle = COLORS.crab;
  g.fill();
  g.lineWidth = s * 0.03;
  g.strokeStyle = COLORS.crabDark;
  g.stroke();
  // Eyes on stalks.
  for (const ex of [-s * 0.08, s * 0.08]) {
    g.beginPath();
    g.moveTo(ex, -s * 0.08);
    g.lineTo(ex, -s * 0.17);
    g.lineWidth = s * 0.03;
    g.strokeStyle = COLORS.crabDark;
    g.stroke();
    g.beginPath();
    g.arc(ex, -s * 0.2, s * 0.05, 0, Math.PI * 2);
    g.fillStyle = "#ffffff";
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(ex, -s * 0.2, s * 0.022, 0, Math.PI * 2);
    g.fillStyle = "#1a1a1a";
    g.fill();
  }
  // Smile.
  g.beginPath();
  g.arc(0, s * 0.04, s * 0.07, 0.15 * Math.PI, 0.85 * Math.PI);
  g.lineWidth = s * 0.03;
  g.strokeStyle = "#5a1c06";
  g.stroke();
  g.restore();
};

/** A pennant whose hoist runs down the pole from (x, top). */
const pennant = (g: G, x: number, top: number, fw: number, fh: number, line: number) => {
  g.beginPath();
  g.moveTo(x, top);
  g.quadraticCurveTo(x + fw * 0.55, top + fh * 0.12, x + fw, top + fh * 0.5);
  g.quadraticCurveTo(x + fw * 0.5, top + fh * 0.72, x, top + fh);
  g.closePath();
  const grad = g.createLinearGradient(0, top, 0, top + fh);
  grad.addColorStop(0, COLORS.flagLight);
  grad.addColorStop(0.45, COLORS.flag);
  grad.addColorStop(1, COLORS.flag);
  g.fillStyle = grad;
  g.fill();
  g.lineJoin = "round";
  g.lineWidth = line;
  g.strokeStyle = COLORS.flagDark;
  g.stroke();
};

/** A marker pennant on a pole, planted at (x, y) at the pole's foot. */
export const drawFlag = (g: G, x: number, y: number, size: number, rise = 1) => {
  const s = size;
  const h = s * 0.78 * rise;
  g.save();
  g.translate(x, y);
  // Little mound.
  g.beginPath();
  g.ellipse(0, 0, s * 0.16, s * 0.05, 0, 0, Math.PI * 2);
  g.fillStyle = "rgba(80,50,20,0.35)";
  g.fill();
  g.lineCap = "round";
  g.strokeStyle = COLORS.pole;
  g.lineWidth = s * 0.06;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, -h);
  g.stroke();
  pennant(g, 0, -h + s * 0.02, s * 0.46, s * 0.34, s * 0.03);
  g.restore();
};

/**
 * The lifeguard tower standing on the bottom edge of the box, with the lifeguard in its hut.
 * `wave` (0 to 1) raises the lifeguard's arm.
 */
export const drawTower = (
  g: G,
  b: { x: number; y: number; width: number; height: number },
  wave = 0,
) => {
  const w = b.width;
  const h = b.height;
  const cx = b.x + w / 2;
  const foot = b.y + h;
  const hutW = w * 0.78;
  const hutH = Math.min(h * 0.3, w * 0.62);
  // Flag, pole and roof above the hut all stay inside the box.
  const hutY = b.y + h * 0.13 + hutH * 0.38;
  g.save();
  g.lineCap = "round";
  // Legs and braces.
  g.strokeStyle = "#7a4d24";
  g.lineWidth = w * 0.07;
  const legTop = hutY + hutH;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + side * hutW * 0.38, legTop);
    g.lineTo(cx + side * w * 0.46, foot);
    g.stroke();
  }
  g.lineWidth = w * 0.035;
  const span = foot - legTop;
  for (let k = 1; k <= 2; k++) {
    const y0 = legTop + (span * (k - 1)) / 2;
    const y1 = legTop + (span * k) / 2;
    const x0 = hutW * 0.38 + ((w * 0.46 - hutW * 0.38) * (k - 1)) / 2;
    const x1 = hutW * 0.38 + ((w * 0.46 - hutW * 0.38) * k) / 2;
    g.beginPath();
    g.moveTo(cx - x0, y0);
    g.lineTo(cx + x1, y1);
    g.moveTo(cx + x0, y0);
    g.lineTo(cx - x1, y1);
    g.stroke();
  }
  // Ladder.
  g.strokeStyle = "#9a6a3a";
  g.lineWidth = w * 0.03;
  g.beginPath();
  g.moveTo(cx - w * 0.06, legTop);
  g.lineTo(cx - w * 0.1, foot);
  g.moveTo(cx + w * 0.06, legTop);
  g.lineTo(cx + w * 0.1, foot);
  for (let k = 1; k < 6; k++) {
    const y = legTop + (span * k) / 6;
    const dx = 0.06 + (0.04 * k) / 6;
    g.moveTo(cx - w * dx, y);
    g.lineTo(cx + w * dx, y);
  }
  g.stroke();
  // Hut.
  rr(g, cx - hutW / 2, hutY, hutW, hutH, w * 0.05);
  g.fillStyle = "#f4efe6";
  g.fill();
  g.lineWidth = w * 0.025;
  g.strokeStyle = "#6b4a2a";
  g.stroke();
  // Window with the lifeguard.
  const winX = cx - hutW * 0.36;
  const winW = hutW * 0.72;
  const winY = hutY + hutH * 0.18;
  const winH = hutH * 0.55;
  g.fillStyle = "#2b4a6e";
  g.fillRect(winX, winY, winW, winH);
  const head = winH * 0.24;
  const px = cx;
  const py = winY + winH * 0.42;
  g.fillStyle = COLORS.shirt;
  rr(g, px - head * 1.1, py + head * 0.7, head * 2.2, winH * 0.6, head * 0.5);
  g.fill();
  g.beginPath();
  g.arc(px, py, head, 0, Math.PI * 2);
  g.fillStyle = "#e9b48a";
  g.fill();
  // Sun hat.
  g.beginPath();
  g.ellipse(px, py - head * 0.5, head * 1.4, head * 0.3, 0, 0, Math.PI * 2);
  g.fillStyle = COLORS.hatDark;
  g.fill();
  g.beginPath();
  g.ellipse(px, py - head * 0.55, head * 0.82, head * 0.75, 0, Math.PI, 0);
  g.fillStyle = COLORS.hat;
  g.fill();
  // Arm, waving when asked.
  g.strokeStyle = "#e9b48a";
  g.lineWidth = head * 0.55;
  g.beginPath();
  g.moveTo(px + head * 0.9, py + head * 1.1);
  const ang = -0.3 - wave * 1.6;
  g.lineTo(
    px + head * 0.9 + Math.cos(ang) * head * 1.8,
    py + head * 1.1 + Math.sin(ang) * head * 1.8,
  );
  g.stroke();
  // Boards under the window, and the roof.
  const stripeY = winY + winH + hutH * 0.06;
  const stripeH = hutY + hutH - stripeY - hutH * 0.06;
  const n = 5;
  for (let k = 0; k < n; k++) {
    g.fillStyle = k % 2 === 0 ? COLORS.roof : COLORS.board;
    g.fillRect(cx - hutW * 0.42 + (k * hutW * 0.84) / n, stripeY, (hutW * 0.84) / n, stripeH);
  }
  g.beginPath();
  g.moveTo(cx - hutW * 0.62, hutY + w * 0.02);
  g.lineTo(cx, hutY - hutH * 0.38);
  g.lineTo(cx + hutW * 0.62, hutY + w * 0.02);
  g.closePath();
  g.fillStyle = COLORS.roof;
  g.fill();
  g.strokeStyle = COLORS.roofDark;
  g.lineWidth = w * 0.02;
  g.stroke();
  // Flag pole on the roof.
  const poleTop = hutY - hutH * 0.38 - h * 0.12;
  g.strokeStyle = COLORS.pole;
  g.lineWidth = w * 0.025;
  g.beginPath();
  g.moveTo(cx, hutY - hutH * 0.38);
  g.lineTo(cx, poleTop);
  g.stroke();
  pennant(g, cx, poleTop, w * 0.36, h * 0.08, w * 0.015);
  g.restore();
};

/** A small flag icon centred on (x, y) for the sky's counters. */
export const drawFlagIcon = (g: G, x: number, y: number, size: number) =>
  drawFlag(g, x - size * 0.15, y + size * 0.42, size);

export interface TileSet {
  size: number;
  /** [kid][variant] covered sand. */
  covered: HTMLCanvasElement[][];
  dug: HTMLCanvasElement[];
  stung: HTMLCanvasElement;
  lifeguard: HTMLCanvasElement;
  /** [dots][n] counts drawn on transparent canvases. */
  counts: HTMLCanvasElement[][];
  flag: HTMLCanvasElement;
  bottle: HTMLCanvasElement;
}

export const VARIANTS = 4;

const canvas = (px: number, draw: (g: G) => void): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(px));
  c.height = Math.max(1, Math.ceil(px));
  const g = c.getContext("2d");
  if (g) {
    g.scale(c.width / px, c.height / px);
    draw(g);
  }
  return c;
};

/** Tiles for cells of `px` device pixels. */
export const createTiles = (px: number): TileSet => ({
  size: px,
  covered: [false, true].map((kid) =>
    Array.from({ length: VARIANTS }, (_, v) => canvas(px, (g) => drawCovered(g, px, kid, v + 1))),
  ),
  dug: [false, true].map((kid) => canvas(px, (g) => drawDug(g, px, kid))),
  stung: canvas(px, (g) => drawDug(g, px, false, COLORS.stung)),
  lifeguard: canvas(px, (g) => drawDug(g, px, false, COLORS.lifeguard)),
  counts: [false, true].map((dots) =>
    Array.from({ length: 9 }, (_, n) => canvas(px, (g) => drawCount(g, px, n, dots))),
  ),
  flag: canvas(px, (g) => drawFlag(g, px * 0.42, px * 0.84, px * 0.92)),
  bottle: canvas(px, (g) => drawBottle(g, px * 0.5, px * 0.48, px * 0.92)),
});

export const variantOf = (cell: number) => Math.floor(hash(cell * 31 + 7) * VARIANTS);
