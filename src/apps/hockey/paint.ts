/**
 * Drawing pieces shared by the frame renderer and the screen: the static board of a lane, and
 * pucks, mallets, paddles, targets and splitters. Everything is drawn in venue px or lane
 * coordinates through `k`, device px per venue px.
 */
import type { Palette } from "../../core/types";
import { withAlpha } from "../../core/ui";
import type { Affine, LaneSpec } from "./layout";
import type { Mouth } from "./physics";
import type { Sprites } from "./sprites";

export const BOARD = {
  surface: "#0c1629",
  surfaceEdge: "#081022",
  child: "#0a2023",
  rim: "#3a5384",
  rimGlow: "#4d84ff",
  slot: "#010208",
  puck: "#f2f5fa",
  puckRing: "#b9c6dd",
  puckGlow: "#cfe0ff",
  splitter: "#6cf7f8",
};

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const ease = (t: number) => 1 - (1 - t) * (1 - t);

export const rounded = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
};

export const star = (g: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
};

/** A drawing context with its scale and the shared sprites and colours. */
export interface Ink {
  g: CanvasRenderingContext2D;
  /** Device px per venue px. */
  k: number;
  sprites: Sprites;
  palette: Palette;
}

/** A player colour by palette index. */
export const hueOf = (palette: Palette, hue: number): string =>
  palette.players[
    ((hue % palette.players.length) + palette.players.length) % palette.players.length
  ]!;

export const venue = (ink: Ink) => ink.g.setTransform(ink.k, 0, 0, ink.k, 0, 0);

export const inLane = (ink: Pick<Ink, "g" | "k">, t: Affine) =>
  ink.g.setTransform(ink.k * t.a, ink.k * t.b, ink.k * t.c, ink.k * t.d, ink.k * t.e, ink.k * t.f);

/** A glow sprite centred at (x, y) with radius r. Set the composite mode first. */
export const glow = (ink: Ink, color: string, x: number, y: number, r: number, a: number) => {
  if (a <= 0.003 || r <= 0) return;
  ink.g.globalAlpha = Math.min(1, a);
  ink.g.drawImage(ink.sprites.glow(color), x - r, y - r, 2 * r, 2 * r);
};

/** Digits from the text cache, centred at (x, y), `size` venue px tall, scaled by `scale`. */
export const digits = (
  ink: Ink,
  text: string,
  color: string,
  x: number,
  y: number,
  size: number,
  a: number,
  outline = false,
  scale = 1,
) => {
  if (a <= 0) return;
  // Animated sizes scale the cached image rather than drawing new text every frame.
  const img = ink.sprites.text(text, color, size * ink.k, outline);
  const w = (img.width / ink.k) * scale;
  const h = (img.height / ink.k) * scale;
  ink.g.globalAlpha = a;
  ink.g.drawImage(img, x - w / 2, y - h / 2, w, h);
};

export const puckBody = (ink: Ink, x: number, y: number, r: number, angle: number, a = 1) => {
  const { g } = ink;
  g.globalCompositeOperation = "lighter";
  glow(ink, BOARD.puckGlow, x, y, r * 3.2, 0.55 * a);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = a;
  g.fillStyle = BOARD.puck;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.strokeStyle = BOARD.puckRing;
  g.lineWidth = r * 0.16;
  g.beginPath();
  g.arc(x, y, r * 0.68, 0, TAU);
  g.stroke();
  // A notch shows the spin.
  g.strokeStyle = "#5d6b85";
  g.lineWidth = r * 0.2;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x + Math.cos(angle) * r * 0.2, y + Math.sin(angle) * r * 0.2);
  g.lineTo(x + Math.cos(angle) * r * 0.55, y + Math.sin(angle) * r * 0.55);
  g.stroke();
  g.globalAlpha = 1;
};

export const malletBody = (ink: Ink, x: number, y: number, R: number, color: string, a = 1) => {
  const { g } = ink;
  g.globalCompositeOperation = "lighter";
  glow(ink, color, x, y, R * 2.4, 0.5 * a);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = a;
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, R, 0, TAU);
  g.fill();
  g.strokeStyle = withAlpha(ink.palette.background, 0.45);
  g.lineWidth = R * 0.1;
  g.beginPath();
  g.arc(x, y, R * 0.66, 0, TAU);
  g.stroke();
  g.fillStyle = withAlpha("#ffffff", 0.55);
  g.beginPath();
  g.arc(x, y, R * 0.34, 0, TAU);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, R * 0.22, 0, TAU);
  g.fill();
  g.globalAlpha = 1;
};

export const paddleBody = (
  ink: Ink,
  x: number,
  y: number,
  half: number,
  w: number,
  color: string,
  a = 1,
) => {
  const { g } = ink;
  g.globalCompositeOperation = "lighter";
  glow(ink, color, x, y, half * 1.5, 0.4 * a);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = a;
  g.fillStyle = color;
  rounded(g, x - w, y - half, w * 2, half * 2, w);
  g.fill();
  g.fillStyle = withAlpha("#ffffff", 0.35);
  rounded(g, x - w * 0.35, y - half * 0.8, w * 0.7, half * 1.6, w * 0.35);
  g.fill();
  g.globalAlpha = 1;
};

/**
 * A team target: a gold ring waiting to be struck, or a lit disc whose ring drains as its
 * light runs out (`lit` is the fraction of light left, 0 when unlit). `clock` animates it.
 */
export const targetBody = (
  ink: Ink,
  x: number,
  y: number,
  r: number,
  lit: number,
  clock: number,
) => {
  const { g, palette } = ink;
  const gold = palette.accent;
  g.globalCompositeOperation = "lighter";
  glow(
    ink,
    gold,
    x,
    y,
    r * (lit > 0 ? 3.2 : 2.2),
    lit > 0 ? 0.65 : 0.18 + 0.08 * Math.sin(clock * 3 + x),
  );
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  if (lit > 0) {
    g.fillStyle = gold;
    g.beginPath();
    g.arc(x, y, r * 0.78, 0, TAU);
    g.fill();
    g.strokeStyle = withAlpha("#ffffff", 0.9);
    g.lineWidth = r * 0.16;
    g.lineCap = "round";
    g.beginPath();
    g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * lit);
    g.stroke();
    return;
  }
  g.strokeStyle = withAlpha(gold, 0.9);
  g.lineWidth = r * 0.16;
  g.beginPath();
  g.arc(x, y, r * 0.92, 0, TAU);
  g.stroke();
  g.fillStyle = withAlpha(gold, 0.85);
  g.beginPath();
  g.arc(x, y, r * 0.3, 0, TAU);
  g.fill();
};

/** A splitter: a bright ring with a fork in it. */
export const splitterBody = (ink: Ink, x: number, y: number, r: number, clock: number) => {
  const { g } = ink;
  const c = BOARD.splitter;
  g.globalCompositeOperation = "lighter";
  glow(ink, c, x, y, r * 2.4, 0.3 + 0.1 * Math.sin(clock * 4));
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  g.fillStyle = withAlpha(ink.palette.background, 0.85);
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.strokeStyle = c;
  g.lineWidth = r * 0.16;
  g.beginPath();
  g.arc(x, y, r * 0.92, 0, TAU);
  g.stroke();
  g.lineWidth = r * 0.14;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(x - r * 0.45, y);
  g.lineTo(x, y);
  g.moveTo(x + r * 0.45, y - r * 0.4);
  g.lineTo(x, y);
  g.lineTo(x + r * 0.45, y + r * 0.4);
  g.stroke();
};

/** Colour of a goal mouth: its slot's player in defence, else the defending side. */
export type MouthColor = (end: 0 | 1, m: Mouth) => string;

/**
 * The static board of one lane, in its own coordinates: surface, no-man's land, markings,
 * rim with a soft glow, and the goal slots cut through the rim.
 */
export const drawLaneBoard = (
  ctx: CanvasRenderingContext2D,
  k: number,
  lane: LaneSpec,
  palette: Palette,
  mouthColor: MouthColor,
) => {
  const p = lane.params;
  const { length: L, width: W } = p;
  const rim = clamp(W * 0.014, 6, 14);
  const radius = Math.max(p.corner, rim * 1.5);
  const open1 = p.ends[1].kind === "open";
  const open0 = p.ends[0].kind === "open";
  const paddles = p.variant === "paddles";
  const team = p.mouths[0].length > 1 || p.variant === "defence";
  inLane({ g: ctx, k }, lane.toVenue);

  // Surface, square at an open end so it runs off the frame.
  const surface = ctx.createLinearGradient(0, 0, 0, W);
  surface.addColorStop(0, BOARD.surfaceEdge);
  surface.addColorStop(0.5, lane.child ? BOARD.child : BOARD.surface);
  surface.addColorStop(1, BOARD.surfaceEdge);
  const ext = rim * 4;
  ctx.beginPath();
  ctx.roundRect(open0 ? -ext : 0, 0, L + (open1 ? ext : 0) + (open0 ? ext : 0), W, [
    open0 ? 0 : radius,
    open1 ? 0 : radius,
    open1 ? 0 : radius,
    open0 ? 0 : radius,
  ]);
  ctx.fillStyle = surface;
  ctx.fill();

  // The no-man's land between players' strips along the lane (around a seam, between zones).
  if (!team) {
    const strips = [...lane.players].sort((a, b) => a.area.x0 - b.area.x0);
    for (let i = 1; i < strips.length; i++) {
      const a = strips[i - 1]!.area.x1;
      const b = strips[i]!.area.x0;
      if (b - a < rim * 3) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(a, 0, b - a, W);
      ctx.clip();
      ctx.strokeStyle = withAlpha(palette.muted, 0.08);
      ctx.lineWidth = rim * 1.4;
      for (let x = a - W; x < b + W; x += rim * 5) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + W, W);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Markings.
  ctx.lineCap = "round";
  const line = withAlpha(palette.muted, 0.38);
  const twoGoals = p.ends[0].kind === "goal" && p.ends[1].kind === "goal" && !team;
  if (twoGoals) {
    ctx.strokeStyle = line;
    ctx.lineWidth = rim * 0.9;
    ctx.setLineDash(paddles ? [rim * 3, rim * 3] : []);
    ctx.beginPath();
    ctx.moveTo(L / 2, rim);
    ctx.lineTo(L / 2, W - rim);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!paddles) {
      ctx.beginPath();
      ctx.arc(L / 2, W / 2, Math.min(W, L) * 0.16, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = line;
      ctx.beginPath();
      ctx.arc(L / 2, W / 2, rim * 1.2, 0, TAU);
      ctx.fill();
    }
  }
  if (open1 && !open0 && !team) {
    // Versus: the open end is the middle of the long table. Each frame draws its half of the
    // centre line and circle, so side by side the two read as one table.
    ctx.strokeStyle = line;
    ctx.lineWidth = rim * 0.9;
    ctx.setLineDash(paddles ? [rim * 3, rim * 3] : []);
    ctx.beginPath();
    ctx.moveTo(L, rim);
    ctx.lineTo(L, W - rim);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!paddles) {
      ctx.beginPath();
      ctx.arc(L, W / 2, W * 0.16, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.stroke();
      ctx.fillStyle = line;
      ctx.beginPath();
      ctx.arc(L, W / 2, rim * 1.2, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.fill();
    }
  }
  if (!team && lane.players.length > 2) {
    // Zone edges along a crowded lane (versus, the long wall table).
    const strips = [...lane.players].sort((a, b) => a.area.x0 - b.area.x0);
    ctx.strokeStyle = withAlpha(palette.muted, 0.22);
    ctx.lineWidth = rim * 0.6;
    ctx.setLineDash([rim * 2.5, rim * 2.5]);
    for (let i = 1; i < strips.length; i++) {
      if (strips[i - 1]!.side !== strips[i]!.side) continue;
      const x = (strips[i - 1]!.area.x1 + strips[i]!.area.x0) / 2;
      ctx.beginPath();
      ctx.moveTo(x, rim);
      ctx.lineTo(x, W - rim);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  if (team && lane.players.length > 0) {
    // Defence: the line the defenders guard from, and each player's lane up to it.
    const depth = Math.max(...lane.players.map((pl) => pl.area.x1));
    ctx.strokeStyle = withAlpha(palette.muted, 0.3);
    ctx.lineWidth = rim * 0.7;
    ctx.setLineDash([rim * 3, rim * 2.5]);
    ctx.beginPath();
    ctx.moveTo(depth, rim);
    ctx.lineTo(depth, W - rim);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const pl of lane.players) {
      ctx.fillStyle = withAlpha(hueOf(palette, pl.hue), 0.045);
      ctx.fillRect(0, pl.area.y0, depth, pl.area.y1 - pl.area.y0);
    }
  }
  // Creases mark where someone defends a goal; the screen's deck has nobody to defend it.
  if (!paddles && lane.players.length > 0) {
    for (const end of [0, 1] as const) {
      const x = end === 0 ? 0 : L;
      for (const m of p.mouths[end]) {
        const color = mouthColor(end, m);
        const cy = (m.y0 + m.y1) / 2;
        const crease = Math.min((m.y1 - m.y0) / 2, W / 2) * 1.15;
        ctx.beginPath();
        ctx.arc(
          x,
          cy,
          crease,
          end === 0 ? -Math.PI / 2 : Math.PI / 2,
          end === 0 ? Math.PI / 2 : (3 * Math.PI) / 2,
        );
        ctx.closePath();
        ctx.fillStyle = withAlpha(color, 0.08);
        ctx.fill();
        ctx.strokeStyle = withAlpha(color, 0.5);
        ctx.lineWidth = rim * 0.7;
        ctx.stroke();
      }
    }
  } else {
    for (const pl of lane.players) {
      const inset = Math.max(p.paddleR * 3, L * 0.05);
      const x = pl.goalEnd === 0 ? pl.area.x0 + inset : pl.area.x1 - inset;
      ctx.strokeStyle = withAlpha(hueOf(palette, pl.hue), 0.16);
      ctx.lineWidth = p.paddleR * 2;
      ctx.beginPath();
      ctx.moveTo(x, p.paddleR);
      ctx.lineTo(x, W - p.paddleR);
      ctx.stroke();
    }
  }

  // Rim, with a soft neon glow; open ends have none.
  ctx.save();
  ctx.shadowColor = withAlpha(BOARD.rimGlow, 0.7);
  ctx.shadowBlur = rim * 2.5 * k;
  ctx.strokeStyle = BOARD.rim;
  ctx.lineWidth = rim;
  ctx.beginPath();
  if (open0 && open1) {
    ctx.moveTo(-ext, 0);
    ctx.lineTo(L + ext, 0);
    ctx.moveTo(-ext, W);
    ctx.lineTo(L + ext, W);
  } else if (open1) {
    ctx.moveTo(L + ext, 0);
    ctx.arcTo(0, 0, 0, W, radius);
    ctx.arcTo(0, W, L, W, radius);
    ctx.lineTo(L + ext, W);
  } else if (open0) {
    ctx.moveTo(-ext, 0);
    ctx.arcTo(L, 0, L, W, radius);
    ctx.arcTo(L, W, 0, W, radius);
    ctx.lineTo(-ext, W);
  } else {
    ctx.roundRect(0, 0, L, W, radius);
  }
  ctx.stroke();
  ctx.restore();

  // Goal slots cut through the rim, lit in the colour of whoever defends them.
  for (const end of [0, 1] as const) {
    const x = end === 0 ? 0 : L;
    for (const m of p.mouths[end]) {
      const color = mouthColor(end, m);
      const y0 = Math.max(0, m.y0);
      const y1 = Math.min(W, m.y1);
      const depth = rim * 2.4;
      ctx.fillStyle = BOARD.slot;
      ctx.fillRect(end === 0 ? -depth : L - rim * 0.6, y0, depth + rim * 0.6, y1 - y0);
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = rim * 3 * k;
      ctx.strokeStyle = color;
      ctx.lineWidth = rim * 1.1;
      ctx.beginPath();
      ctx.moveTo(x, y0 + rim);
      ctx.lineTo(x, y1 - rim);
      ctx.stroke();
      ctx.restore();
    }
  }
};
