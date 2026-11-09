/**
 * Canvas2D drawing shared by the screen and the touch frames: the picture (the epicycle chain,
 * the scrolling wave and the target's ghost), threads, the cloth and the ghost hand. Glow is
 * layered strokes, never blur filters, which cost too much at screen size. Coordinates are
 * venue px; callers set the transform.
 */
import { type Band, paintBand } from "./cloth";
import { TAU } from "./config";
import { GHOST, GLOW, rgba, WAVE } from "./palette";
import type { Target, Term } from "./series";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PictureState {
  values: readonly Term[];
  colours: readonly string[];
  live: readonly boolean[];
  target: Target | null;
  theta: number;
  /** 0 to 1, shown. */
  fill: number;
  /** 0 to 1, the match's glow. */
  glow: number;
  title: string | null;
}

export interface PictureGeometry {
  midY: number;
  halfH: number;
  /** Venue px per unit of the sum (the fundamental at full is one unit). */
  u: number;
  /** The chain's base, where the wave starts, where it ends, and one period's length. */
  cx: number;
  xw: number;
  xr: number;
  period: number;
}

/** The scale a picture wants for a target's (or the current sum's) peak. */
export const wantedScale = (box: Box, peak: number): number => {
  const halfH = box.height * 0.46;
  const byHeight = (halfH * 0.8) / Math.max(0.35, peak);
  // Keep at least about half the width for the wave.
  const byWidth = (box.width * 0.42) / 2.2;
  return Math.min(byHeight, byWidth);
};

export const pictureGeometry = (box: Box, u: number): PictureGeometry => {
  const pad = Math.min(box.width, box.height) * 0.05;
  const cx = box.x + pad + u * 1.05;
  const xw = cx + u * 1.12;
  const xr = box.x + box.width - pad;
  return {
    midY: box.y + box.height / 2,
    halfH: box.height * 0.46,
    u,
    cx,
    xw,
    xr,
    // About 1.7 periods across, or more on a wide picture, so the shape reads.
    period: Math.max(40, Math.min((xr - xw) / 1.7, box.height * 2.6)),
  };
};

const sumAt = (values: readonly Term[], theta: number): number => {
  let v = 0;
  for (let i = 0; i < values.length; i++) {
    const t = values[i]!;
    if (t.amp <= 0) continue;
    const k = i + 1;
    v += (t.amp / k) * Math.sin(k * theta + t.phase);
  }
  return v;
};

const wavePath = (
  g: CanvasRenderingContext2D,
  geo: PictureGeometry,
  terms: readonly Term[],
  theta: number,
  step: number,
) => {
  g.beginPath();
  for (let x = geo.xw; x <= geo.xr + 0.01; x += step) {
    const y = geo.midY - geo.u * sumAt(terms, theta - (TAU * (x - geo.xw)) / geo.period);
    if (x === geo.xw) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
};

/** Layered strokes along the current path: a wide faint halo, a glow, a bright core. */
export const glowStroke = (
  g: CanvasRenderingContext2D,
  colour: string,
  width: number,
  alpha: number,
  core = colour,
) => {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = rgba(colour, 0.1 * alpha);
  g.lineWidth = width * 5;
  g.stroke();
  g.strokeStyle = rgba(colour, 0.28 * alpha);
  g.lineWidth = width * 2.4;
  g.stroke();
  g.strokeStyle = rgba(core, alpha);
  g.lineWidth = width;
  g.stroke();
};

export const drawPicture = (
  g: CanvasRenderingContext2D,
  box: Box,
  s: PictureState,
  u: number,
  line: number,
  titleSize: number,
): PictureGeometry => {
  const geo = pictureGeometry(box, u);
  const step = Math.max(2, box.width / 700);
  g.save();
  g.beginPath();
  g.rect(box.x, box.y, box.width, box.height);
  g.clip();

  // The axis.
  g.strokeStyle = "rgba(160,176,216,0.18)";
  g.lineWidth = line * 0.4;
  g.beginPath();
  g.moveTo(geo.xw, geo.midY);
  g.lineTo(geo.xr, geo.midY);
  g.stroke();

  // The target's ghost, filling as the sum gets close.
  if (s.target) {
    wavePath(g, geo, s.target.terms, s.theta, step);
    g.lineTo(geo.xr, geo.midY);
    g.lineTo(geo.xw, geo.midY);
    g.closePath();
    g.fillStyle = rgba(GHOST, 0.05 + 0.22 * s.fill + 0.15 * s.glow);
    g.fill();
    wavePath(g, geo, s.target.terms, s.theta, step);
    g.setLineDash([line * 2.2, line * 1.6]);
    g.strokeStyle = rgba(GHOST, 0.55);
    g.lineWidth = line * 0.8;
    g.stroke();
    g.setLineDash([]);
  }

  // The chain: each harmonic a circle turning k times as fast, each starting on the last.
  let px = geo.cx;
  let py = geo.midY;
  for (let i = 0; i < s.values.length; i++) {
    const t = s.values[i]!;
    const k = i + 1;
    const r = (geo.u * t.amp) / k;
    if (r < 0.5) continue;
    const a = k * s.theta + t.phase;
    const nx = px + r * Math.cos(a);
    const ny = py - r * Math.sin(a);
    const c = s.colours[i] ?? WAVE;
    const dim = s.live[i] ? 1 : 0.6;
    g.beginPath();
    g.arc(px, py, r, 0, TAU);
    g.strokeStyle = rgba(c, 0.38 * dim);
    g.lineWidth = line * 0.45;
    g.stroke();
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(nx, ny);
    g.strokeStyle = rgba(c, 0.95 * dim);
    g.lineWidth = line * 0.7;
    g.stroke();
    g.beginPath();
    g.arc(px, py, line * 0.55, 0, TAU);
    g.fillStyle = rgba(c, dim);
    g.fill();
    px = nx;
    py = ny;
  }

  // From the chain's tip across to where the wave starts.
  g.setLineDash([line, line]);
  g.strokeStyle = "rgba(244,241,234,0.45)";
  g.lineWidth = line * 0.4;
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(geo.xw, py);
  g.stroke();
  g.setLineDash([]);

  // The sum.
  wavePath(g, geo, s.values, s.theta, step);
  if (s.glow > 0) {
    g.strokeStyle = rgba(GLOW, 0.22 * s.glow);
    g.lineWidth = line * 9;
    g.stroke();
  }
  glowStroke(g, s.glow > 0.3 ? GLOW : WAVE, line * (1 + 0.5 * s.glow), 1, WAVE);

  g.beginPath();
  g.arc(px, py, line * 1.1, 0, TAU);
  g.fillStyle = WAVE;
  g.fill();
  g.beginPath();
  g.arc(geo.xw, py, line * 0.9, 0, TAU);
  g.fill();
  g.restore();

  // The target's name, and the fill under it.
  if (s.title && titleSize > 0) {
    const tx = box.x + titleSize * 0.4;
    const ty = box.y + titleSize * 0.2;
    g.font = `600 ${titleSize}px system-ui, "Segoe UI", Roboto, sans-serif`;
    g.textBaseline = "top";
    g.textAlign = "left";
    g.fillStyle = rgba(WAVE, 0.85);
    g.fillText(s.title, tx, ty);
    const bw = titleSize * 3.2;
    const by = ty + titleSize * 1.2;
    const bh = titleSize * 0.16;
    g.fillStyle = "rgba(160,176,216,0.2)";
    g.beginPath();
    g.roundRect(tx, by, bw, bh, bh / 2);
    g.fill();
    g.fillStyle = s.fill >= 0.999 || s.glow > 0 ? GLOW : rgba(GHOST, 0.9);
    g.beginPath();
    g.roundRect(tx, by, Math.max(bh, bw * Math.min(1, s.fill)), bh, bh / 2);
    g.fill();
  }
  return geo;
};

/** A thread through `pts` (x, y pairs), with its glow. */
export const drawThread = (
  g: CanvasRenderingContext2D,
  pts: Float64Array,
  count: number,
  colour: string,
  width: number,
  alpha: number,
) => {
  if (count < 2) return;
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 1; i < count; i++) g.lineTo(pts[2 * i]!, pts[2 * i + 1]!);
  glowStroke(g, colour, width, alpha);
};

/** The cloth's bands, cached as small images at cell resolution. */
export interface ClothPainter {
  /** Draw the bands into `box`, newest at its bottom edge (the fell), `progress` of the newest woven. */
  draw(
    g: CanvasRenderingContext2D,
    box: Box,
    bands: readonly Band[],
    colours: readonly string[],
    progress: number,
    bandH: number,
    line: number,
  ): void;
  dispose(): void;
}

export const createClothPainter = (ends: number, picks: number, repeats: number): ClothPainter => {
  const cache = new Map<number, HTMLCanvasElement>();
  const imageOf = (b: Band, colours: readonly string[]) => {
    let c = cache.get(b.id);
    if (!c) {
      c = document.createElement("canvas");
      c.width = ends;
      c.height = picks;
      const cg = c.getContext("2d");
      if (cg) paintBand(cg, b, colours, ends, picks, repeats);
      cache.set(b.id, c);
    }
    return c;
  };
  return {
    draw(g, box, bands, colours, progress, bandH, line) {
      const live = new Set(bands.map((b) => b.id));
      for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
      const fell = box.y + box.height;
      g.save();
      g.beginPath();
      g.rect(box.x, box.y, box.width, box.height);
      g.clip();
      // An empty loom: faint warp.
      g.fillStyle = "rgba(20,26,48,0.6)";
      g.fillRect(box.x, box.y, box.width, box.height);
      g.strokeStyle = "rgba(160,176,216,0.07)";
      g.lineWidth = Math.max(1, line * 0.25);
      g.beginPath();
      const warpGap = box.width / ends;
      for (let x = box.x + warpGap / 2; x < box.x + box.width; x += warpGap * 2) {
        g.moveTo(x, box.y);
        g.lineTo(x, box.y + box.height);
      }
      g.stroke();
      g.imageSmoothingEnabled = true;
      let y = fell;
      for (let i = bands.length - 1; i >= 0 && y > box.y; i--) {
        const b = bands[i]!;
        const img = imageOf(b, colours);
        const p = i === bands.length - 1 ? Math.max(0, Math.min(1, progress)) : 1;
        if (p <= 0) continue;
        const h = bandH * p;
        // While weaving, the band's first picks show first, nearest the fell.
        g.drawImage(img, 0, 0, ends, Math.max(1, picks * p), box.x, y - h, box.width, h);
        y -= h;
        g.fillStyle = "rgba(4,6,12,0.55)";
        g.fillRect(box.x, y - line * 0.15, box.width, line * 0.3);
      }
      g.restore();
      // The shuttle, while weaving.
      if (progress > 0 && progress < 1 && bands.length > 0) {
        const pick = progress * picks;
        const f = pick - Math.floor(pick);
        const dir = Math.floor(pick) % 2 === 0 ? f : 1 - f;
        const sx = box.x + box.width * (0.04 + 0.92 * dir);
        const sw = Math.max(line * 6, box.width * 0.03);
        const sh = Math.max(line * 1.4, bandH * 0.12);
        g.fillStyle = rgba(GLOW, 0.9);
        g.beginPath();
        g.roundRect(sx - sw / 2, fell - sh / 2, sw, sh, sh / 2);
        g.fill();
      }
    },
    dispose() {
      cache.clear();
    },
  };
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
