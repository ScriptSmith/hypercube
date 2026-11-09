/**
 * Every picture in the game, drawn once with Canvas2D into one atlas at the scale the frame
 * draws at, then handed to the GL batcher. Sizes are in course px.
 *
 * - Flyers come in two layers: a greyscale body that the batcher tints in the player's colour,
 *   and small untinted markings (the lorikeet's blue head and orange beak, the glider's fold).
 *   The lorikeet is a slim side-on parrot with a long pointed tail.
 * - Obstacles are rock spires, gum trees and hanging vines over mossy logs, each as a cap at
 *   the gap, a body that repeats along its length, and a base where it meets the ground.
 * - Scenery: the night sky, stars, the moon, two parallax ridges, the ground and the canopy.
 */
import type { Flyer } from "./config";
import type { Region } from "./gl";

export type Piece = "rock" | "gum" | "vine";

/** Course px sizes of the parts every obstacle has. */
export const PIECE = {
  /** Art width of an obstacle body (the collision width is GATE_W). */
  width: 236,
  bodyH: 160,
  capH: 170,
  baseW: 330,
  baseH: 120,
} as const;

/** The flyer sprite box, and where the glider's centre sits in it (fractions). */
export const FLYER = { w: 210, h: 150, ax: 0.56, ay: 0.5 } as const;

/** Parallax tiles are soft silhouettes, so they are stored at no more than this scale. */
const SCENERY_SCALE = 0.6;
const PAD = 4;
const MAX_ATLAS = 4096;

export const TILE = {
  far: { w: 1600, h: 560 },
  mid: { w: 1600, h: 440 },
  ground: { w: 800, h: 130 },
  canopy: { w: 800, h: 120 },
  stars: { w: 640, h: 640 },
} as const;

export type SpriteName =
  | "white"
  | "glow"
  | "dot"
  | "ring"
  | "spark"
  | "feather"
  | "star"
  | "chevron"
  | "arrow"
  | "grad"
  | "sky"
  | "stars"
  | "moon"
  | "far"
  | "mid"
  | "ground"
  | "canopy"
  | "finish"
  | "start"
  | `${Piece}-${"top" | "bot"}-${"body" | "cap"}`
  | `${Piece}-base`
  | `fly-${0 | 1 | 2 | 3}`
  | `mark-${0 | 1 | 2 | 3}`;

export interface Atlas {
  canvas: HTMLCanvasElement;
  regions: Record<SpriteName, Region>;
  /** Atlas px per course px for most sprites. */
  scale: number;
}

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

interface Spec {
  name: SpriteName;
  w: number;
  h: number;
  draw: Draw;
  /** Stored at this scale instead of the atlas scale. */
  scale?: number;
}

/** A small fixed-seed generator so the art is the same every time. */
const seeded = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const TAU = Math.PI * 2;

// ---- Small shapes ---------------------------------------------------------------------------

const drawGlow: Draw = (g, w, h) => {
  const r = Math.min(w, h) / 2;
  const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.15)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
};

const drawDot: Draw = (g, w, h) => {
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(w / 2, h / 2, Math.min(w, h) / 2 - 1, 0, TAU);
  g.fill();
};

const drawRing: Draw = (g, w, h) => {
  g.strokeStyle = "#fff";
  g.lineWidth = w * 0.075;
  g.beginPath();
  g.arc(w / 2, h / 2, w / 2 - g.lineWidth, 0, TAU);
  g.stroke();
};

const drawSpark: Draw = (g, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const r = i % 2 === 0 ? w / 2 : w * 0.16;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
};

const drawFeather: Draw = (g, w, h) => {
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(1, h / 2);
  g.quadraticCurveTo(w * 0.45, -h * 0.15, w - 1, h / 2);
  g.quadraticCurveTo(w * 0.45, h * 1.15, 1, h / 2);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = Math.max(1, h * 0.08);
  g.beginPath();
  g.moveTo(2, h / 2);
  g.lineTo(w - 2, h / 2);
  g.stroke();
};

const drawStar: Draw = (g, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  g.fillStyle = "#fff";
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * TAU;
    const r = i % 2 === 0 ? w / 2 - 1 : w * 0.21;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
};

const drawChevron: Draw = (g, w, h) => {
  g.strokeStyle = "#fff";
  g.lineWidth = w * 0.2;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(w * 0.25, h * 0.15);
  g.lineTo(w * 0.72, h * 0.5);
  g.lineTo(w * 0.25, h * 0.85);
  g.stroke();
};

const drawArrow: Draw = (g, w, h) => {
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(w * 0.95, h / 2);
  g.lineTo(w * 0.2, h * 0.08);
  g.quadraticCurveTo(w * 0.38, h / 2, w * 0.2, h * 0.92);
  g.closePath();
  g.fill();
};

const drawGrad: Draw = (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
};

// ---- Scenery ---------------------------------------------------------------------------------

const drawSky: Draw = (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#050817");
  grad.addColorStop(0.42, "#0b1331");
  grad.addColorStop(0.75, "#182049");
  grad.addColorStop(1, "#2a2456");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
};

const drawStars: Draw = (g, w, h) => {
  const rnd = seeded(7);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 1.2 + rnd() * rnd() * 3.4;
    const a = 0.25 + rnd() * 0.65;
    if (r > 3) {
      const glow = g.createRadialGradient(x, y, 0, x, y, r * 4);
      glow.addColorStop(0, `rgba(220,230,255,${a * 0.5})`);
      glow.addColorStop(1, "rgba(220,230,255,0)");
      g.fillStyle = glow;
      g.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
    }
    g.fillStyle = `rgba(235,240,255,${a})`;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
};

const drawMoon: Draw = (g, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.3;
  const halo = g.createRadialGradient(cx, cy, r * 0.9, cx, cy, w / 2);
  halo.addColorStop(0, "rgba(255,244,214,0.28)");
  halo.addColorStop(1, "rgba(255,244,214,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, w, h);
  const body = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  body.addColorStop(0, "#fffaf0");
  body.addColorStop(1, "#e9dfc4");
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.fill();
  g.fillStyle = "rgba(190,176,140,0.35)";
  for (const [dx, dy, rr] of [
    [-0.3, -0.1, 0.22],
    [0.25, 0.25, 0.16],
    [0.1, -0.4, 0.1],
    [-0.15, 0.4, 0.12],
  ] as const) {
    g.beginPath();
    g.arc(cx + dx * r, cy + dy * r, rr * r, 0, TAU);
    g.fill();
  }
};

/** A ridge line that repeats every `w`: a sum of sines with whole periods across the tile. */
const ridge = (w: number, terms: readonly (readonly [number, number, number])[]) => (x: number) =>
  terms.reduce((y, [n, amp, phase]) => y + amp * Math.sin((x / w) * TAU * n + phase), 0);

const drawFar: Draw = (g, w, h) => {
  const back = ridge(w, [
    [2, 70, 0.4],
    [5, 40, 1.3],
    [11, 16, 2.1],
  ]);
  const front = ridge(w, [
    [3, 60, 2.2],
    [7, 30, 0.2],
    [17, 10, 1.1],
  ]);
  const fill = (fn: (x: number) => number, base: number, color: string, rim: string) => {
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, base + fn(x));
    g.lineTo(w, h);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.strokeStyle = rim;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= w; x += 8) g.lineTo(x, base + fn(x));
    g.stroke();
  };
  fill(back, h * 0.36, "#19224f", "rgba(120,140,220,0.25)");
  fill(front, h * 0.58, "#121a42", "rgba(110,130,210,0.2)");
};

const drawMid: Draw = (g, w, h) => {
  const rnd = seeded(23);
  const hill = ridge(w, [
    [2, 34, 1.7],
    [4, 18, 0.3],
  ]);
  g.fillStyle = "#0b1233";
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.66 + hill(x));
  g.lineTo(w, h);
  g.closePath();
  g.fill();
  // Gum tree silhouettes standing on the hills, spaced so the tile still repeats.
  const trees = 9;
  for (let i = 0; i < trees; i++) {
    const x = ((i + 0.3 + rnd() * 0.4) / trees) * w;
    const base = h * 0.66 + hill(x) + 6;
    const tall = h * (0.3 + rnd() * 0.25);
    g.strokeStyle = "#0b1233";
    g.lineWidth = 10 + rnd() * 6;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, base);
    g.quadraticCurveTo(
      x + (rnd() - 0.5) * 30,
      base - tall * 0.5,
      x + (rnd() - 0.5) * 40,
      base - tall * 0.8,
    );
    g.stroke();
    g.fillStyle = "#0b1233";
    for (let k = 0; k < 6; k++) {
      const cx = x + (rnd() - 0.5) * tall * 0.55;
      const cy = base - tall * (0.75 + rnd() * 0.3);
      const r = tall * (0.12 + rnd() * 0.1);
      g.beginPath();
      g.ellipse(cx, cy, r * 1.4, r, 0, 0, TAU);
      g.fill();
    }
  }
};

const drawGround: Draw = (g, w, h) => {
  const top = 34;
  const soil = g.createLinearGradient(0, top, 0, h);
  soil.addColorStop(0, "#3a2a1c");
  soil.addColorStop(1, "#1a120c");
  g.fillStyle = soil;
  g.fillRect(0, top, w, h - top);
  const rnd = seeded(5);
  // Pebbles.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${120 + rnd() * 50},${90 + rnd() * 40},${60 + rnd() * 30},0.5)`;
    g.beginPath();
    g.ellipse(
      rnd() * w,
      top + 20 + rnd() * (h - top - 26),
      3 + rnd() * 7,
      2 + rnd() * 4,
      0,
      0,
      TAU,
    );
    g.fill();
  }
  g.fillStyle = "#4b6b2e";
  g.fillRect(0, top - 2, w, 10);
  // Grass tufts, kept clear of the tile edges so the repeat is seamless.
  for (let i = 0; i < 70; i++) {
    const x = 6 + rnd() * (w - 12);
    const tall = 14 + rnd() * 26;
    g.strokeStyle = rnd() < 0.5 ? "#5f8a36" : "#7aa845";
    g.lineWidth = 3 + rnd() * 2;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, top + 6);
    g.quadraticCurveTo(
      x + (rnd() - 0.5) * 14,
      top - tall * 0.5,
      x + (rnd() - 0.5) * 18,
      top - tall,
    );
    g.stroke();
  }
  g.fillStyle = "rgba(160,200,110,0.35)";
  g.fillRect(0, top - 2, w, 3);
};

const drawCanopy: Draw = (g, w, h) => {
  const rnd = seeded(11);
  g.fillStyle = "#0c1f16";
  g.fillRect(0, 0, w, 44);
  for (let i = 0; i < 46; i++) {
    const x = 10 + rnd() * (w - 20);
    const len = 30 + rnd() * (h - 50);
    g.fillStyle = rnd() < 0.5 ? "#112c1d" : "#173a25";
    g.beginPath();
    g.ellipse(x, 30 + len * 0.4, 18 + rnd() * 16, len * 0.45, (rnd() - 0.5) * 0.4, 0, TAU);
    g.fill();
  }
  g.strokeStyle = "rgba(120,190,130,0.18)";
  g.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const x = 10 + rnd() * (w - 20);
    g.beginPath();
    g.moveTo(x, 40);
    g.lineTo(x + (rnd() - 0.5) * 20, 50 + rnd() * (h - 60));
    g.stroke();
  }
};

const drawFinish: Draw = (g, w, h) => {
  const cx = w / 2;
  const glow = g.createLinearGradient(0, 0, w, 0);
  glow.addColorStop(0, "rgba(255,204,51,0)");
  glow.addColorStop(0.5, "rgba(255,214,90,0.55)");
  glow.addColorStop(1, "rgba(255,204,51,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffe08a";
  g.fillRect(cx - w * 0.07, 0, w * 0.14, h);
  g.fillStyle = "#fff6d8";
  g.fillRect(cx - w * 0.025, 0, w * 0.05, h);
};

const drawStart: Draw = (g, w, h) => {
  g.fillStyle = "rgba(255,255,255,0.9)";
  const dash = h / 8;
  for (let y = 0; y < h; y += dash) g.fillRect(w * 0.35, y + dash * 0.2, w * 0.3, dash * 0.55);
};

// ---- Obstacles -------------------------------------------------------------------------------

const ROCK = { light: "#d79c64", mid: "#a8703f", dark: "#6a4126", crack: "rgba(70,40,20,0.55)" };
const GUM = { light: "#efe8d6", mid: "#cfc4ac", dark: "#9a8e78", patch: "rgba(196,160,140,0.5)" };
const LEAF = ["#5f7f40", "#7c9e52", "#4a6634", "#93b565"] as const;
const VINE = { dark: "#244d2c", mid: "#357040", leaf: ["#4f9450", "#6fb45a", "#3c7a40"] as const };
const WOOD = { light: "#9a6a42", mid: "#74502f", dark: "#4a321c" };
const MOSS = ["#5f9440", "#7cb350", "#4b7a34"] as const;

const sideShade = (
  g: CanvasRenderingContext2D,
  w: number,
  c: { light: string; mid: string; dark: string },
) => {
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, c.light);
  grad.addColorStop(0.32, c.mid);
  grad.addColorStop(1, c.dark);
  return grad;
};

/** A crack that wanders but meets itself at the top and bottom of a repeating tile. */
const crack = (g: CanvasRenderingContext2D, x: number, h: number, amp: number, phase: number) => {
  g.beginPath();
  for (let y = 0; y <= h; y += 4) g.lineTo(x + amp * Math.sin((y / h) * TAU + phase), y);
  g.stroke();
};

const rockBody: Draw = (g, w, h) => {
  const inset = (w - PIECE.width) / 2;
  g.save();
  g.translate(inset, 0);
  const bw = PIECE.width;
  g.fillStyle = sideShade(g, bw, ROCK);
  g.fillRect(0, 0, bw, h);
  g.strokeStyle = ROCK.crack;
  g.lineWidth = 4;
  crack(g, bw * 0.3, h, 8, 0.4);
  g.lineWidth = 3;
  crack(g, bw * 0.62, h, 10, 2.2);
  g.fillStyle = "rgba(255,220,170,0.12)";
  g.fillRect(0, h * 0.2, bw, 10);
  g.fillRect(0, h * 0.68, bw, 6);
  g.fillStyle = "rgba(255,226,180,0.45)";
  g.fillRect(0, 0, 5, h);
  g.fillStyle = "rgba(30,15,5,0.5)";
  g.fillRect(bw - 6, 0, 6, h);
  g.restore();
};

/** A rough rounded end for a rock: hanging from above when `top`, else standing up from below. */
const rockEnd = (g: CanvasRenderingContext2D, w: number, h: number, top: boolean) => {
  const rnd = seeded(top ? 31 : 37);
  const bw = PIECE.width;
  const x0 = (w - bw) / 2;
  const tip = top ? h - 4 : 4;
  const flat = top ? 0 : h;
  g.beginPath();
  g.moveTo(x0, flat);
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const round = Math.sin(f * Math.PI);
    const rough = (rnd() - 0.5) * 14;
    const reach = (h - 8) * (0.55 + 0.45 * Math.pow(round, 0.6)) + rough * round;
    g.lineTo(x0 + f * bw, top ? reach : h - reach);
  }
  g.lineTo(x0 + bw, flat);
  g.closePath();
  g.fillStyle = sideShade(g, w, ROCK);
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = ROCK.crack;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(x0 + bw * 0.3 + 8 * Math.sin(0.4), flat);
  g.lineTo(x0 + bw * 0.34, top ? tip * 0.6 : h - (h - tip) * 0.6);
  g.stroke();
  g.fillStyle = "rgba(30,15,5,0.4)";
  g.fillRect(x0 + bw - 8, 0, 8, h);
  g.restore();
  // Moonlight along the rim facing the gap.
  g.strokeStyle = "rgba(255,230,190,0.55)";
  g.lineWidth = 5;
  g.beginPath();
  const rim = seeded(top ? 31 : 37);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const round = Math.sin(f * Math.PI);
    const rough = (rim() - 0.5) * 14;
    const reach = (h - 8) * (0.55 + 0.45 * Math.pow(round, 0.6)) + rough * round;
    if (f > 0.08 && f < 0.75) g.lineTo(x0 + f * bw, top ? reach - 2 : h - reach + 2);
  }
  g.stroke();
  if (top) {
    // A few drips hanging off the underside.
    g.fillStyle = ROCK.mid;
    for (const f of [0.35, 0.55, 0.7]) {
      g.beginPath();
      g.moveTo(x0 + bw * f - 9, h * 0.8);
      g.lineTo(x0 + bw * f + 9, h * 0.8);
      g.lineTo(x0 + bw * f, h * 0.8 + 18 + rnd() * 10);
      g.fill();
    }
  }
};

const rockBase: Draw = (g, w, h) => {
  const rnd = seeded(41);
  g.fillStyle = sideShade(g, w, ROCK);
  g.beginPath();
  g.moveTo(w * 0.14, 0);
  g.lineTo(w * 0.86, 0);
  g.quadraticCurveTo(w * 0.9, h * 0.6, w, h);
  g.lineTo(0, h);
  g.quadraticCurveTo(w * 0.1, h * 0.6, w * 0.14, 0);
  g.fill();
  for (let i = 0; i < 7; i++) {
    const x = rnd() < 0.5 ? rnd() * w * 0.25 : w * 0.75 + rnd() * w * 0.25;
    g.fillStyle = rnd() < 0.5 ? ROCK.mid : ROCK.dark;
    g.beginPath();
    g.ellipse(x, h - 12 - rnd() * 18, 12 + rnd() * 14, 9 + rnd() * 8, 0, 0, TAU);
    g.fill();
  }
};

const leafCluster = (
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rnd: () => number,
  droop: number,
) => {
  for (let i = 0; i < 16; i++) {
    const a = rnd() * TAU;
    const d = rnd() * r;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.7;
    g.fillStyle = LEAF[Math.floor(rnd() * LEAF.length)]!;
    g.save();
    g.translate(x, y);
    g.rotate(droop + (rnd() - 0.5) * 0.9);
    g.beginPath();
    g.ellipse(0, 0, r * 0.18, r * 0.5, 0, 0, TAU);
    g.fill();
    g.restore();
  }
};

const gumBody: Draw = (g, w, h) => {
  const rnd = seeded(51);
  const bw = PIECE.width;
  const x0 = (w - bw) / 2;
  g.fillStyle = sideShade(g, w, GUM);
  g.fillRect(x0 + 18, 0, bw - 36, h);
  g.fillStyle = GUM.patch;
  for (let i = 0; i < 5; i++) {
    const y = ((i + 0.5) / 5) * h;
    g.beginPath();
    g.ellipse(x0 + 40 + rnd() * (bw - 90), y, 14 + rnd() * 18, 18 + rnd() * 14, 0, 0, TAU);
    g.fill();
  }
  g.strokeStyle = "rgba(120,100,80,0.35)";
  g.lineWidth = 3;
  crack(g, x0 + bw * 0.45, h, 6, 1.2);
  crack(g, x0 + bw * 0.7, h, 5, 0.1);
  g.fillStyle = "rgba(255,255,240,0.5)";
  g.fillRect(x0 + 18, 0, 5, h);
  g.fillStyle = "rgba(60,50,40,0.35)";
  g.fillRect(x0 + bw - 24, 0, 6, h);
};

const gumCap =
  (top: boolean): Draw =>
  (g, w, h) => {
    const rnd = seeded(top ? 61 : 67);
    const bw = PIECE.width;
    const x0 = (w - bw) / 2;
    const trunk = sideShade(g, w, GUM);
    g.fillStyle = trunk;
    if (top) {
      // A limb coming down, ending in a hanging spray of leaves.
      g.fillRect(x0 + 18, 0, bw - 36, h * 0.45);
      g.beginPath();
      g.moveTo(x0 + 18, h * 0.44);
      g.quadraticCurveTo(x0 + bw * 0.3, h * 0.6, x0 + bw * 0.42, h * 0.72);
      g.lineTo(x0 + bw * 0.62, h * 0.7);
      g.quadraticCurveTo(x0 + bw * 0.8, h * 0.55, x0 + bw - 18, h * 0.44);
      g.fill();
      leafCluster(g, w / 2, h * 0.68, w * 0.36, rnd, 0.1);
      leafCluster(g, w * 0.3, h * 0.6, w * 0.2, rnd, -0.3);
      leafCluster(g, w * 0.72, h * 0.62, w * 0.2, rnd, 0.3);
    } else {
      // The top of a trunk forking into two branches under a crown of leaves.
      g.fillRect(x0 + 18, h * 0.55, bw - 36, h * 0.45);
      g.beginPath();
      g.moveTo(x0 + 18, h * 0.56);
      g.quadraticCurveTo(x0 + 10, h * 0.4, x0 + bw * 0.18, h * 0.3);
      g.lineTo(x0 + bw * 0.38, h * 0.34);
      g.quadraticCurveTo(x0 + bw * 0.45, h * 0.46, x0 + bw * 0.5, h * 0.46);
      g.quadraticCurveTo(x0 + bw * 0.58, h * 0.4, x0 + bw * 0.7, h * 0.28);
      g.lineTo(x0 + bw * 0.86, h * 0.32);
      g.quadraticCurveTo(x0 + bw - 14, h * 0.42, x0 + bw - 18, h * 0.56);
      g.fill();
      leafCluster(g, w / 2, h * 0.24, w * 0.4, rnd, 0);
      leafCluster(g, w * 0.26, h * 0.3, w * 0.22, rnd, -0.5);
      leafCluster(g, w * 0.76, h * 0.28, w * 0.22, rnd, 0.5);
    }
  };

const gumBase: Draw = (g, w, h) => {
  const bw = PIECE.width;
  g.fillStyle = sideShade(g, w, GUM);
  g.beginPath();
  g.moveTo((w - bw) / 2 + 18, 0);
  g.lineTo((w + bw) / 2 - 18, 0);
  g.quadraticCurveTo((w + bw) / 2, h * 0.7, w - 4, h);
  g.lineTo(4, h);
  g.quadraticCurveTo((w - bw) / 2, h * 0.7, (w - bw) / 2 + 18, 0);
  g.fill();
  g.strokeStyle = "rgba(120,100,80,0.4)";
  g.lineWidth = 3;
  for (const f of [0.3, 0.5, 0.7]) {
    g.beginPath();
    g.moveTo(w * f, h * 0.2);
    g.quadraticCurveTo(w * (f + (f - 0.5) * 0.4), h * 0.7, w * (f + (f - 0.5) * 0.9), h);
    g.stroke();
  }
};

const vineBody: Draw = (g, w, h) => {
  const rnd = seeded(71);
  const bw = PIECE.width;
  const x0 = (w - bw) / 2;
  g.fillStyle = "rgba(20,48,28,0.92)";
  g.fillRect(x0 + 12, 0, bw - 24, h);
  const strands = 6;
  for (let i = 0; i < strands; i++) {
    const x = x0 + 22 + (i / (strands - 1)) * (bw - 44);
    g.strokeStyle = i % 2 ? VINE.mid : VINE.dark;
    g.lineWidth = 9;
    crack(g, x, h, 6, i * 1.3);
    for (let k = 0; k < 3; k++) {
      const y = ((k + (i % 2) * 0.5 + 0.25) / 3) * h;
      g.fillStyle = VINE.leaf[Math.floor(rnd() * VINE.leaf.length)]!;
      g.save();
      g.translate(x, y);
      g.rotate((k % 2 ? 1 : -1) * 0.9);
      g.beginPath();
      g.ellipse(14, 0, 16, 7, 0, 0, TAU);
      g.fill();
      g.restore();
    }
  }
};

const vineCap: Draw = (g, w, h) => {
  const rnd = seeded(73);
  const bw = PIECE.width;
  const x0 = (w - bw) / 2;
  g.fillStyle = "rgba(20,48,28,0.92)";
  g.beginPath();
  g.moveTo(x0 + 12, 0);
  g.lineTo(x0 + bw - 12, 0);
  g.lineTo(x0 + bw - 20, h * 0.55);
  g.quadraticCurveTo(w / 2, h * 0.75, x0 + 20, h * 0.55);
  g.closePath();
  g.fill();
  const strands = 6;
  for (let i = 0; i < strands; i++) {
    const x = x0 + 22 + (i / (strands - 1)) * (bw - 44);
    const end = h * (0.62 + 0.3 * Math.sin((i / (strands - 1)) * Math.PI)) - 14;
    g.strokeStyle = i % 2 ? VINE.mid : VINE.dark;
    g.lineWidth = 9;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x + 6 * Math.sin(i * 1.3), 0);
    g.quadraticCurveTo(x + (rnd() - 0.5) * 16, end * 0.6, x + (rnd() - 0.5) * 10, end);
    g.stroke();
    for (let k = 0; k < 3; k++) {
      const y = end * (0.3 + k * 0.3);
      g.fillStyle = VINE.leaf[Math.floor(rnd() * VINE.leaf.length)]!;
      g.save();
      g.translate(x, y);
      g.rotate((k % 2 ? 1 : -1) * 0.8);
      g.beginPath();
      g.ellipse(13, 0, 17, 7, 0, 0, TAU);
      g.fill();
      g.restore();
    }
    // Leafy tips, and a flower on some strands.
    g.fillStyle = VINE.leaf[1];
    g.beginPath();
    g.ellipse(x, end + 4, 12, 18, 0, 0, TAU);
    g.fill();
    if (i % 2 === 0) {
      g.fillStyle = i === 2 ? "#ffd166" : "#ff7aa2";
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * TAU;
        g.beginPath();
        g.arc(x + Math.cos(a) * 8, end - 18 + Math.sin(a) * 8, 6, 0, TAU);
        g.fill();
      }
      g.fillStyle = "#fff3c4";
      g.beginPath();
      g.arc(x, end - 18, 4, 0, TAU);
      g.fill();
    }
  }
};

const logBody: Draw = (g, w, h) => {
  const rnd = seeded(81);
  const bw = PIECE.width;
  const x0 = (w - bw) / 2;
  g.fillStyle = sideShade(g, w, WOOD);
  g.fillRect(x0 + 6, 0, bw - 12, h);
  g.strokeStyle = "rgba(30,18,8,0.5)";
  g.lineWidth = 4;
  crack(g, x0 + bw * 0.25, h, 4, 0.3);
  crack(g, x0 + bw * 0.5, h, 5, 1.9);
  crack(g, x0 + bw * 0.76, h, 4, 3.1);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = MOSS[Math.floor(rnd() * MOSS.length)]!;
    g.beginPath();
    g.ellipse(x0 + 10 + rnd() * 30, ((i + 0.5) / 4) * h, 12, 20 + rnd() * 10, 0, 0, TAU);
    g.fill();
  }
  g.fillStyle = "rgba(255,220,170,0.25)";
  g.fillRect(x0 + 6, 0, 5, h);
};

const logCap: Draw = (g, w, h) => {
  const rnd = seeded(83);
  const bw = PIECE.width;
  const x0 = (w - bw) / 2;
  g.fillStyle = sideShade(g, w, WOOD);
  g.beginPath();
  g.moveTo(x0 + 6, h);
  g.lineTo(x0 + 6, h * 0.42);
  g.quadraticCurveTo(w / 2, h * 0.26, x0 + bw - 6, h * 0.42);
  g.lineTo(x0 + bw - 6, h);
  g.fill();
  // Moss over the top, and a few ferns.
  for (let i = 0; i < 12; i++) {
    g.fillStyle = MOSS[Math.floor(rnd() * MOSS.length)]!;
    g.beginPath();
    g.ellipse(x0 + 12 + (i / 11) * (bw - 24), h * 0.36 + rnd() * 16, 22, 15, 0, 0, TAU);
    g.fill();
  }
  g.strokeStyle = "#7cb350";
  g.lineWidth = 4;
  g.lineCap = "round";
  for (const [f, lean] of [
    [0.25, -0.5],
    [0.55, 0.1],
    [0.8, 0.6],
  ] as const) {
    const bx = x0 + bw * f;
    const by = h * 0.34;
    const tx = bx + lean * 60;
    const ty = 10;
    g.beginPath();
    g.moveTo(bx, by);
    g.quadraticCurveTo(bx + lean * 10, by * 0.5, tx, ty);
    g.stroke();
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      const px = bx + (tx - bx) * t;
      const py = by + (ty - by) * t;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px - 14 * (1 - t), py - 6);
      g.moveTo(px, py);
      g.lineTo(px + 14 * (1 - t), py - 6);
      g.stroke();
    }
  }
  g.fillStyle = "rgba(255,240,200,0.8)";
  g.beginPath();
  g.arc(x0 + bw * 0.4, h * 0.3, 7, Math.PI, TAU);
  g.fill();
};

const logBase: Draw = (g, w, h) => {
  const bw = PIECE.width;
  g.fillStyle = sideShade(g, w, WOOD);
  g.beginPath();
  g.moveTo((w - bw) / 2 + 6, 0);
  g.lineTo((w + bw) / 2 - 6, 0);
  g.quadraticCurveTo((w + bw) / 2 + 10, h * 0.7, w - 6, h);
  g.lineTo(6, h);
  g.quadraticCurveTo((w - bw) / 2 - 10, h * 0.7, (w - bw) / 2 + 6, 0);
  g.fill();
  g.fillStyle = MOSS[0];
  g.beginPath();
  g.ellipse(w * 0.2, h * 0.85, 40, 16, 0, 0, TAU);
  g.ellipse(w * 0.82, h * 0.88, 36, 14, 0, 0, TAU);
  g.fill();
};

// ---- Flyers ----------------------------------------------------------------------------------

/** Wing tip and trailing-edge points per pose: up, half up, glide, down. */
const WING_POSES = [
  { tip: [78, 4], lead: [92, 22], trail: [112, 40] },
  { tip: [52, 28], lead: [80, 34], trail: [100, 52] },
  { tip: [38, 66], lead: [80, 56], trail: [90, 74] },
  { tip: [70, 134], lead: [96, 102], trail: [116, 92] },
] as const;

const lorikeetBody =
  (pose: number): Draw =>
  (g) => {
    // Tail: two long pointed feathers trailing behind.
    g.fillStyle = "#cfcfcf";
    g.beginPath();
    g.moveTo(84, 68);
    g.quadraticCurveTo(44, 84, 4, 108);
    g.quadraticCurveTo(46, 94, 82, 88);
    g.closePath();
    g.fill();
    g.fillStyle = "#b8b8b8";
    g.beginPath();
    g.moveTo(84, 76);
    g.quadraticCurveTo(50, 96, 18, 122);
    g.quadraticCurveTo(54, 102, 84, 90);
    g.closePath();
    g.fill();
    // Slim body, head integrated at the front.
    const body = g.createLinearGradient(0, 48, 0, 96);
    body.addColorStop(0, "#dedede");
    body.addColorStop(0.55, "#ffffff");
    body.addColorStop(1, "#f2f2f2");
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(70, 80);
    g.bezierCurveTo(84, 54, 132, 48, 160, 56);
    g.bezierCurveTo(176, 59, 182, 72, 172, 84);
    g.bezierCurveTo(146, 98, 96, 98, 70, 80);
    g.closePath();
    g.fill();
    // Near wing.
    const w = WING_POSES[pose] ?? WING_POSES[2];
    g.fillStyle = "#b0b0b0";
    g.beginPath();
    g.moveTo(132, 62);
    g.quadraticCurveTo(w.lead[0], w.lead[1], w.tip[0], w.tip[1]);
    g.quadraticCurveTo(w.trail[0], w.trail[1], 120, 76);
    g.closePath();
    g.fill();
    g.strokeStyle = "#8c8c8c";
    g.lineWidth = 2.5;
    for (const t of [0.35, 0.6, 0.82]) {
      g.beginPath();
      g.moveTo(126, 68);
      g.lineTo(126 + (w.tip[0] - 126) * t, 68 + (w.tip[1] - 68) * t);
      g.stroke();
    }
    g.strokeStyle = "#e8e8e8";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(132, 62);
    g.quadraticCurveTo(w.lead[0], w.lead[1], w.tip[0], w.tip[1]);
    g.stroke();
  };

const lorikeetMarks: Draw = (g) => {
  // A small violet-blue cap over the head, an orange hooked beak and a small eye.
  g.fillStyle = "#4a5be8";
  g.beginPath();
  g.moveTo(152, 56);
  g.bezierCurveTo(160, 49, 175, 52, 179, 66);
  g.quadraticCurveTo(166, 63, 152, 62);
  g.closePath();
  g.fill();
  g.fillStyle = "#ff8a1f";
  g.beginPath();
  g.moveTo(176, 64);
  g.quadraticCurveTo(193, 63, 191, 79);
  g.quadraticCurveTo(185, 74, 174, 77);
  g.closePath();
  g.fill();
  g.fillStyle = "#12121a";
  g.beginPath();
  g.arc(167, 64, 3.4, 0, TAU);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(168, 63, 1.2, 0, TAU);
  g.fill();
};

const GLIDER_TIPS = [28, 36, 46, 56] as const;

const gliderBody =
  (pose: number): Draw =>
  (g) => {
    const tipY = GLIDER_TIPS[pose] ?? 40;
    g.fillStyle = "#c8c8c8";
    g.beginPath();
    g.moveTo(196, 74);
    g.lineTo(34, tipY + 14);
    g.lineTo(62, 74);
    g.closePath();
    g.fill();
    g.fillStyle = "#a8a8a8";
    g.beginPath();
    g.moveTo(198, 77);
    g.lineTo(52, 79);
    g.lineTo(30, 104);
    g.closePath();
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(200, 76);
    g.lineTo(18, tipY);
    g.lineTo(52, 78);
    g.closePath();
    g.fill();
  };

const gliderMarks =
  (pose: number): Draw =>
  (g) => {
    const tipY = GLIDER_TIPS[pose] ?? 40;
    g.strokeStyle = "rgba(20,20,30,0.55)";
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(198, 77);
    g.lineTo(52, 78);
    g.stroke();
    g.strokeStyle = "rgba(20,20,30,0.25)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(190, 75);
    g.lineTo(40, tipY + 22);
    g.stroke();
  };

// ---- Packing ---------------------------------------------------------------------------------

const specsFor = (flyer: Flyer): Spec[] => {
  const s: Spec[] = [
    {
      name: "white",
      w: 8,
      h: 8,
      draw: (g, w, h) => ((g.fillStyle = "#fff"), g.fillRect(0, 0, w, h)),
    },
    { name: "glow", w: 128, h: 128, draw: drawGlow },
    { name: "dot", w: 64, h: 64, draw: drawDot },
    { name: "ring", w: 128, h: 128, draw: drawRing },
    { name: "spark", w: 48, h: 48, draw: drawSpark },
    { name: "feather", w: 44, h: 16, draw: drawFeather },
    { name: "star", w: 80, h: 80, draw: drawStar },
    { name: "chevron", w: 60, h: 80, draw: drawChevron },
    { name: "arrow", w: 96, h: 96, draw: drawArrow },
    { name: "grad", w: 8, h: 128, draw: drawGrad },
    { name: "sky", w: 8, h: 256, draw: drawSky, scale: 1 },
    { name: "stars", ...TILE.stars, draw: drawStars },
    { name: "moon", w: 260, h: 260, draw: drawMoon },
    { name: "far", ...TILE.far, draw: drawFar, scale: SCENERY_SCALE },
    { name: "mid", ...TILE.mid, draw: drawMid, scale: SCENERY_SCALE },
    { name: "ground", ...TILE.ground, draw: drawGround },
    { name: "canopy", ...TILE.canopy, draw: drawCanopy },
    { name: "finish", w: 120, h: 64, draw: drawFinish },
    { name: "start", w: 24, h: 256, draw: drawStart },
    { name: "rock-bot-body", w: PIECE.width, h: PIECE.bodyH, draw: rockBody },
    { name: "rock-top-body", w: PIECE.width, h: PIECE.bodyH, draw: rockBody },
    {
      name: "rock-bot-cap",
      w: PIECE.width,
      h: PIECE.capH,
      draw: (g, w, h) => rockEnd(g, w, h, false),
    },
    {
      name: "rock-top-cap",
      w: PIECE.width,
      h: PIECE.capH,
      draw: (g, w, h) => rockEnd(g, w, h, true),
    },
    { name: "rock-base", w: PIECE.baseW, h: PIECE.baseH, draw: rockBase },
    { name: "gum-bot-body", w: PIECE.width, h: PIECE.bodyH, draw: gumBody },
    { name: "gum-top-body", w: PIECE.width, h: PIECE.bodyH, draw: gumBody },
    { name: "gum-bot-cap", w: 320, h: PIECE.capH + 40, draw: gumCap(false) },
    { name: "gum-top-cap", w: 320, h: PIECE.capH + 40, draw: gumCap(true) },
    { name: "gum-base", w: PIECE.baseW, h: PIECE.baseH, draw: gumBase },
    { name: "vine-top-body", w: PIECE.width, h: PIECE.bodyH, draw: vineBody },
    { name: "vine-top-cap", w: PIECE.width, h: PIECE.capH, draw: vineCap },
    { name: "vine-bot-body", w: PIECE.width, h: PIECE.bodyH, draw: logBody },
    { name: "vine-bot-cap", w: PIECE.width, h: PIECE.capH, draw: logCap },
    { name: "vine-base", w: PIECE.baseW, h: PIECE.baseH, draw: logBase },
  ];
  for (let pose = 0; pose < 4; pose++) {
    const p = pose as 0 | 1 | 2 | 3;
    s.push({
      name: `fly-${p}`,
      w: FLYER.w,
      h: FLYER.h,
      draw: flyer === "glider" ? gliderBody(pose) : lorikeetBody(pose),
    });
    s.push({
      name: `mark-${p}`,
      w: FLYER.w,
      h: FLYER.h,
      draw: flyer === "glider" ? gliderMarks(pose) : lorikeetMarks,
    });
  }
  return s;
};

interface Placed {
  spec: Spec;
  scale: number;
  pw: number;
  ph: number;
  x: number;
  y: number;
}

const pack = (specs: Spec[], scale: number, width: number) => {
  const placed: Placed[] = specs.map((spec) => {
    const k = Math.min(scale, spec.scale ?? scale);
    return {
      spec,
      scale: k,
      pw: Math.max(1, Math.ceil(spec.w * k)) + PAD * 2,
      ph: Math.max(1, Math.ceil(spec.h * k)) + PAD * 2,
      x: 0,
      y: 0,
    };
  });
  const order = [...placed].sort((a, b) => b.ph - a.ph);
  let x = 0;
  let y = 0;
  let row = 0;
  for (const p of order) {
    if (x + p.pw > width) {
      x = 0;
      y += row;
      row = 0;
    }
    p.x = x;
    p.y = y;
    x += p.pw;
    row = Math.max(row, p.ph);
  }
  return { placed, height: y + row };
};

/** Draw every sprite into one atlas at `scale` atlas px per course px (smaller if it must be). */
export const buildAtlas = (scale: number, flyer: Flyer): Atlas => {
  const specs = specsFor(flyer);
  let k = Math.max(0.05, scale);
  let width = 2048;
  let layout = pack(specs, k, width);
  while (layout.height > MAX_ATLAS) {
    if (width < MAX_ATLAS) width = MAX_ATLAS;
    else k *= 0.85;
    layout = pack(specs, k, width);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.max(1, layout.height);
  const g = canvas.getContext("2d");
  const regions = {} as Record<SpriteName, Region>;
  for (const p of layout.placed) {
    const w = p.pw - PAD * 2;
    const h = p.ph - PAD * 2;
    if (g) {
      g.save();
      g.beginPath();
      g.rect(p.x + PAD, p.y + PAD, w, h);
      g.clip();
      g.translate(p.x + PAD, p.y + PAD);
      g.scale(w / p.spec.w, h / p.spec.h);
      p.spec.draw(g, p.spec.w, p.spec.h);
      g.restore();
    }
    regions[p.spec.name] = {
      u0: (p.x + PAD) / canvas.width,
      v0: (p.y + PAD) / canvas.height,
      u1: (p.x + PAD + w) / canvas.width,
      v1: (p.y + PAD + h) / canvas.height,
      w,
      h,
    };
  }
  return { canvas, regions, scale: k };
};
