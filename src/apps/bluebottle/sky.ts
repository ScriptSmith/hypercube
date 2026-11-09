/**
 * The sky above the beach, in two layers: the sea (sky, sun, waves and foam), drawn at low
 * resolution with gentle motion, and the HUD (lifeguard tower, progress, flags left, today's
 * cleared patches, the bank's map and the celebration), drawn sharp and only when it changes.
 */
import { FONT } from "../../core/ui";
import { COLORS, drawFlag, drawFlagIcon, drawTower } from "./art";
import type { Box } from "./layout";
import type { Current } from "./shore";

type G = CanvasRenderingContext2D;

const SEA_FPS = 12;
const SEA_RES = 0.5;
const CELEBRATE_MS = 5200;
const MAX_CONFETTI = 160;

export interface SeaSpec {
  /** Area to paint, venue px. */
  box: Box;
  horizon: number;
  /** Top of the wet sand; null when the sea runs off the bottom (the screen). */
  shore: number | null;
}

export interface Sea {
  set(spec: SeaSpec, unit: number, pixelRatio: number): void;
  draw(now: number): void;
  dispose(): void;
}

export const createSea = (root: HTMLElement, spec0: SeaSpec, u0: number, p0: number): Sea => {
  const c = document.createElement("canvas");
  c.style.cssText = "position:absolute;pointer-events:none;z-index:0;";
  root.append(c);
  const g = c.getContext("2d");
  let spec = spec0;
  let scale = 1;
  let last = -Infinity;
  const set = (s: SeaSpec, unit: number, pr: number) => {
    spec = s;
    scale = Math.max(0.05, unit * pr * SEA_RES);
    const b = s.box;
    c.style.left = `${b.x * unit}px`;
    c.style.top = `${b.y * unit}px`;
    c.style.width = `${b.width * unit}px`;
    c.style.height = `${b.height * unit}px`;
    c.width = Math.max(1, Math.round(b.width * scale));
    c.height = Math.max(1, Math.round(b.height * scale));
    last = -Infinity;
  };
  set(spec0, u0, p0);

  const paint = (now: number) => {
    if (!g) return;
    const { box: b, horizon } = spec;
    const W = b.width;
    const H = b.height;
    const shore = spec.shore ?? H + 400;
    g.setTransform(scale, 0, 0, scale, -b.x * scale, -b.y * scale);
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#0d1a3c");
    sky.addColorStop(0.55, "#2c3a74");
    sky.addColorStop(1, "#f0a47a");
    g.fillStyle = sky;
    g.fillRect(b.x, 0, W, horizon);
    // Low sun.
    const sx = b.x + W * 0.8;
    const sr = Math.min(W, horizon) * 0.16;
    const glow = g.createRadialGradient(sx, horizon, sr * 0.3, sx, horizon, sr * 3);
    glow.addColorStop(0, "rgba(255,214,140,0.85)");
    glow.addColorStop(1, "rgba(255,214,140,0)");
    g.fillStyle = glow;
    g.fillRect(sx - sr * 3, horizon - sr * 3, sr * 6, sr * 3);
    g.beginPath();
    g.arc(sx, horizon, sr, Math.PI, 0);
    g.fillStyle = "#ffd88f";
    g.fill();
    const sea = g.createLinearGradient(0, horizon, 0, Math.min(shore, H));
    sea.addColorStop(0, "#1a4672");
    sea.addColorStop(1, "#2a8d9f");
    g.fillStyle = sea;
    g.fillRect(b.x, horizon, W, Math.min(shore, H) - horizon);
    // Swell lines, closer together near the horizon.
    const t = now / 1000;
    const span = Math.min(shore, H) - horizon;
    g.lineCap = "round";
    for (let k = 1; k <= 7; k++) {
      const f = (k / 8) ** 1.5;
      const y = horizon + span * f;
      g.strokeStyle = `rgba(200,235,255,${0.08 + 0.12 * f})`;
      g.lineWidth = Math.max(2, span * 0.012 * (0.5 + f));
      g.beginPath();
      const len = W / (6 + k);
      for (let x = b.x - len; x < b.x + W + len; x += len) {
        const ph = x / len + t * (0.4 + 0.08 * k) + k;
        g.moveTo(x, y + Math.sin(ph) * span * 0.01);
        g.quadraticCurveTo(x + len * 0.25, y - span * 0.012, x + len * 0.5, y);
      }
      g.stroke();
    }
    if (spec.shore !== null) {
      const wet = g.createLinearGradient(0, shore, 0, H);
      wet.addColorStop(0, COLORS.wet);
      wet.addColorStop(1, "#c79a63");
      g.fillStyle = wet;
      g.fillRect(b.x, shore, W, H - shore);
      // Foam that runs up the sand and back.
      const reach = (Math.sin(t * 0.9) * 0.5 + 0.5) * (H - shore) * 0.35;
      g.fillStyle = "rgba(245,250,255,0.85)";
      g.beginPath();
      g.moveTo(b.x, shore - 6);
      const steps = 24;
      for (let k = 0; k <= steps; k++) {
        const x = b.x + (W * k) / steps;
        g.lineTo(x, shore + reach + Math.sin(k * 1.3 + t * 1.7) * (H - shore) * 0.06);
      }
      g.lineTo(b.x + W, shore - 6);
      g.closePath();
      g.fill();
    }
  };

  return {
    set,
    draw(now) {
      if (now - last < 1000 / SEA_FPS) return;
      last = now;
      paint(now);
    },
    dispose() {
      c.remove();
    },
  };
};

// ---- HUD --------------------------------------------------------------------------------------

export interface HudBoxes {
  /** The whole HUD canvas, venue px. */
  area: Box;
  tower: Box;
  progress: Box;
  flags: Box;
  today: Box;
  banner: Box;
  map: Box | null;
}

export interface HudState {
  /** Patch progress 0 to 1, or null to hide it. */
  progress: number | null;
  flagsLeft: number | null;
  today: number;
  /** Local ms when the current celebration began. */
  celebrate: number;
  map: { cur: Current; c0: number; c1: number } | null;
}

export interface Hud {
  set(boxes: HudBoxes, unit: number, pixelRatio: number): void;
  draw(now: number, s: HudState): void;
  dispose(): void;
}

interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  color: string;
  born: number;
}

const CONFETTI_COLORS = [COLORS.flag, COLORS.roof, "#6fe0ff", "#ffffff", "#9ff0a0", COLORS.crest];

const rr = (g: G, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
};

export const drawProgress = (g: G, b: Box, v: number) => {
  const r = b.height / 2;
  rr(g, b.x, b.y, b.width, b.height, r);
  g.fillStyle = "rgba(8,14,30,0.7)";
  g.fill();
  g.lineWidth = Math.max(2, b.height * 0.08);
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.stroke();
  const inset = b.height * 0.14;
  const w = Math.max(0, (b.width - 2 * inset - b.height) * Math.min(1, Math.max(0, v)));
  if (w > 0) {
    rr(g, b.x + inset, b.y + inset, w + b.height - 2 * inset, b.height - 2 * inset, r - inset);
    const grad = g.createLinearGradient(b.x, 0, b.x + b.width, 0);
    grad.addColorStop(0, COLORS.sandKid);
    grad.addColorStop(1, "#7fe08a");
    g.fillStyle = grad;
    g.fill();
  }
  drawFlag(g, b.x + b.width - b.height * 0.55, b.y + b.height * 0.95, b.height * 1.5);
};

const number = (g: G, text: string, x: number, y: number, size: number) => {
  g.font = `900 ${Math.round(size)}px ${FONT}`;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.lineWidth = size * 0.16;
  g.strokeStyle = "rgba(5,8,20,0.85)";
  g.lineJoin = "round";
  g.strokeText(text, x, y);
  g.fillStyle = "#ffffff";
  g.fillText(text, x, y);
};

export const drawFlagsLeft = (g: G, b: Box, n: number) => {
  const s = b.height;
  drawFlagIcon(g, b.x + s * 0.45, b.y + s * 0.42, s * 0.95);
  number(g, String(n), b.x + s * 1.05, b.y + s * 0.55, s * 0.78);
};

/** One small flag per patch cleared today, as many as fit, newest on the right. */
export const drawToday = (g: G, b: Box, n: number) => {
  if (n <= 0) return;
  const s = b.height;
  const step = s * 0.55;
  const fit = Math.max(1, Math.floor((b.width - s * 0.4) / step));
  const shown = Math.min(n, fit);
  for (let k = 0; k < shown; k++) {
    drawFlag(g, b.x + s * 0.2 + k * step, b.y + s * 0.95, s * 0.95);
  }
};

const MAP_COLORS = {
  covered: COLORS.sandAdult,
  coveredKid: COLORS.sandKid,
  dug: "#f4e6c8",
  found: COLORS.bottle,
  flag: COLORS.flag,
};

/** The whole patch in miniature, with this frame's columns outlined. */
export const drawMap = (g: G, b: Box, cur: Current, c0: number, c1: number) => {
  const { cols, rows, kid } = cur.spec;
  const cell = Math.min(b.width / cols, b.height / rows);
  const w = cell * cols;
  const h = cell * rows;
  const x0 = b.x + (b.width - w) / 2;
  const y0 = b.y + (b.height - h) / 2;
  const p = cur.patch;
  g.fillStyle = COLORS.gutter;
  g.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
  for (let i = 0; i < p.board.size; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    g.fillStyle = p.found[i]
      ? MAP_COLORS.found
      : p.dug[i]
        ? MAP_COLORS.dug
        : p.flag[i]
          ? MAP_COLORS.flag
          : r >= rows - kid
            ? MAP_COLORS.coveredKid
            : MAP_COLORS.covered;
    g.fillRect(x0 + c * cell, y0 + r * cell, Math.max(1, cell - 0.6), Math.max(1, cell - 0.6));
  }
  if (c1 > c0) {
    g.lineWidth = Math.max(2, cell * 0.5);
    g.strokeStyle = "#ffffff";
    g.strokeRect(x0 + c0 * cell, y0 - 1, (c1 - c0) * cell, h + 2);
  }
};

export const createHud = (root: HTMLElement, b0: HudBoxes, u0: number, p0: number): Hud => {
  const c = document.createElement("canvas");
  c.style.cssText = "position:absolute;pointer-events:none;z-index:1;";
  root.append(c);
  const g = c.getContext("2d");
  let boxes = b0;
  let scale = 1;
  let key = "";
  const confetti: Confetti[] = [];
  let burstFor = -Infinity;

  const set = (b: HudBoxes, unit: number, pr: number) => {
    boxes = b;
    scale = unit * pr;
    const a = b.area;
    c.style.left = `${a.x * unit}px`;
    c.style.top = `${a.y * unit}px`;
    c.style.width = `${a.width * unit}px`;
    c.style.height = `${a.height * unit}px`;
    c.width = Math.max(1, Math.round(a.width * scale));
    c.height = Math.max(1, Math.round(a.height * scale));
    key = "";
  };
  set(b0, u0, p0);

  const burst = (now: number) => {
    const a = boxes.area;
    for (let k = 0; k < 90; k++) {
      confetti.push({
        x: a.x + Math.random() * a.width,
        y: a.y - Math.random() * a.height * 0.2,
        vx: (Math.random() - 0.5) * a.width * 0.05,
        vy: a.height * (0.15 + Math.random() * 0.3),
        spin: Math.random() * 6,
        color: CONFETTI_COLORS[k % CONFETTI_COLORS.length]!,
        born: now,
      });
    }
    while (confetti.length > MAX_CONFETTI) confetti.shift();
  };

  return {
    set,
    draw(now, s) {
      if (!g) return;
      const party = now - s.celebrate < CELEBRATE_MS;
      if (party && burstFor !== s.celebrate) {
        burstFor = s.celebrate;
        burst(now);
      }
      for (let k = confetti.length - 1; k >= 0; k--) {
        if (now - confetti[k]!.born > CELEBRATE_MS) confetti.splice(k, 1);
      }
      const animating = party || confetti.length > 0;
      const p = s.map?.cur.patch;
      const mapKey = s.map
        ? `${s.map.cur.spec.b}:${s.map.cur.spec.n}:${p!.events.length}:${p!.dugSafe}:${p!.flags}:${p!.foundCount}:${s.map.c0}`
        : "";
      const next = `${s.progress === null ? "-" : Math.round(s.progress * 400)}|${s.flagsLeft}|${s.today}|${mapKey}`;
      if (!animating && next === key) return;
      key = animating ? "" : next;
      const a = boxes.area;
      g.setTransform(scale, 0, 0, scale, -a.x * scale, -a.y * scale);
      g.clearRect(a.x, a.y, a.width, a.height);
      const wave = party ? 0.5 + 0.5 * Math.sin((now - s.celebrate) / 140) : 0;
      drawTower(g, boxes.tower, wave);
      if (s.map && boxes.map) drawMap(g, boxes.map, s.map.cur, s.map.c0, s.map.c1);
      if (s.progress !== null) drawProgress(g, boxes.progress, s.progress);
      if (s.flagsLeft !== null) drawFlagsLeft(g, boxes.flags, s.flagsLeft);
      drawToday(g, boxes.today, s.today);
      if (party) {
        const k = Math.min(1, (now - s.celebrate) / 400);
        const b = boxes.banner;
        g.save();
        g.globalAlpha = Math.min(1, (CELEBRATE_MS - (now - s.celebrate)) / 500);
        g.translate(b.x + b.width / 2, b.y + b.height / 2);
        g.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
        rr(g, -b.width / 2, -b.height / 2, b.width, b.height, b.height * 0.3);
        g.fillStyle = "rgba(255,255,255,0.95)";
        g.fill();
        g.lineWidth = b.height * 0.06;
        g.strokeStyle = COLORS.roof;
        g.stroke();
        const size = Math.min(b.height * 0.56, b.width / 7.5);
        g.font = `900 ${Math.round(size)}px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = "#14204a";
        g.fillText("Beach clear!", b.height * 0.25, b.height * 0.04);
        drawFlag(g, -b.width / 2 + b.height * 0.42, b.height * 0.36, b.height * 0.8);
        g.restore();
      }
      for (const cf of confetti) {
        const t = (now - cf.born) / 1000;
        const x = cf.x + cf.vx * t + Math.sin(t * 3 + cf.spin) * a.height * 0.02;
        const y = cf.y + cf.vy * t;
        if (y > a.y + a.height) continue;
        g.save();
        g.translate(x, y);
        g.rotate(cf.spin + t * 4);
        g.fillStyle = cf.color;
        const s2 = a.height * 0.018;
        g.fillRect(-s2, -s2 * 0.5, s2 * 2, s2);
        g.restore();
      }
    },
    dispose() {
      c.remove();
      confetti.length = 0;
    },
  };
};
