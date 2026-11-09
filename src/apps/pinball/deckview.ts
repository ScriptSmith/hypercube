/**
 * Draws the upper deck with Canvas2D on one visible canvas and two offscreen ones:
 *
 * - art: the deck's fixed pieces, drawn once per layout and size;
 * - base: the art plus the board (scores, the shared total, lit targets); a board item that
 *   changes is restored from the art and redrawn inside its own box;
 * - the visible canvas: each frame only the boxes around moving things (balls, moving bumpers,
 *   the nest, bubbles, devices at work, flashes) are copied back from the base and drawn again,
 *   because a screen this size can't afford to repaint or composite whole layers sixty times a
 *   second without a GPU.
 *
 * Big pieces change only by fades of at least half a second, and nothing flashes more than a few
 * times a second; bumper hit flashes are small and white.
 */
import { withAlpha } from "../../core/ui/palette";
import { FONT } from "../../core/ui/style";
import type { FrameInfo } from "../../core/types";
import { RAIN_STEP } from "./config";
import type { Deck, DeckGeometry } from "./deck";
import { LOCK_SIZE, MAGNET_MS, SAUCER_MS, VUK_MS } from "./deckparts";
import type { Rail } from "./deckgeo";
import { drawGiftIcon, GIFT_COLOR } from "./gifticon";
import { formatScore } from "./tableview";
import type { Region } from "./wallgeo";

const RAIL = "#cfe6ff";
const RAIL_GLOW = "#3b8cff";
const AMBER = "#ffcc33";
const POP = "#6fa4fc";
const MAGNET = "#c86bff";
const VUK = "#5ee0ff";
const LOCK = "#6cf7a0";
const NEST = "#ffb36b";
const SHUTTLE = "#ff6f91";
const MUSHROOM = "#4ff0d2";
const GLASS = "#7fd7ff";
const BIG = ["#4f8dff", "#a46bff", "#ff8a3d"];

export interface DeckView {
  /**
   * Size the canvases for the frame, covering `region` (venue px) or the whole frame, with `f`
   * venue px per deck px (1 on a screen).
   */
  resize(frame: FrameInfo, region?: Region, f?: number): void;
  draw(deck: Deck, alpha: number, time: number): void;
  dispose(): void;
}

/** A box in deck px. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const box = (x: number, y: number, r: number): Box => ({
  x0: x - r,
  y0: y - r,
  x1: x + r,
  y1: y + r,
});

const ring = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
};

const starPath = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const k = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) g.moveTo(x + Math.cos(a) * k, y + Math.sin(a) * k);
    else g.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k);
  }
  g.closePath();
};

const drawRail = (g: CanvasRenderingContext2D, r: Rail, U: number) => {
  const pts = r.pts;
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
  g.strokeStyle = withAlpha(GLASS, 0.1);
  g.lineWidth = U * 2.4;
  g.stroke();
  // Two wires either side of the ball's path.
  g.strokeStyle = withAlpha(GLASS, 0.55);
  g.lineWidth = Math.max(2, U * 0.12);
  for (const side of [-1, 1]) {
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = (-(b.y - a.y) / l) * U * 1.15 * side;
      const ny = ((b.x - a.x) / l) * U * 1.15 * side;
      const p = pts[i]!;
      if (i === 0) g.moveTo(p.x + nx, p.y + ny);
      else g.lineTo(p.x + nx, p.y + ny);
    }
    g.stroke();
  }
  // Chevrons along the way, showing which way balls ride.
  g.fillStyle = withAlpha(GLASS, 0.35);
  const every = U * 5;
  let next = U * 3;
  let at = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    while (next <= at + l) {
      const k = (next - at) / l;
      g.save();
      g.translate(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
      g.rotate(Math.atan2(b.x - a.x, -(b.y - a.y)));
      g.beginPath();
      g.moveTo(0, -U * 0.5);
      g.lineTo(U * 0.55, U * 0.3);
      g.lineTo(0, 0);
      g.lineTo(-U * 0.55, U * 0.3);
      g.closePath();
      g.fill();
      g.restore();
      next += every;
    }
    at += l;
  }
  g.restore();
};

const drawArt = (g: CanvasRenderingContext2D, geo: DeckGeometry, palette: readonly string[]) => {
  const { W, H, R, U } = geo;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#04051a");
  bg.addColorStop(0.55, "#0a0f33");
  bg.addColorStop(1, "#111a4a");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // Each table's colour, faintly, over its own part of the floor.
  for (const s of geo.slots) {
    const c = palette[s.color % palette.length] ?? AMBER;
    const lane = g.createLinearGradient(0, geo.edgeY - H * 0.2, 0, H);
    lane.addColorStop(0, withAlpha(c, 0));
    lane.addColorStop(1, withAlpha(c, 0.14));
    g.fillStyle = lane;
    g.fillRect(s.x0, geo.edgeY - H * 0.2, s.x1 - s.x0, H);
  }
  // Inserts under the cluster and the shuttle's track.
  const cl = geo.cluster;
  const disc = g.createRadialGradient(cl.x, cl.y, cl.radius * 0.3, cl.x, cl.y, cl.radius * 1.5);
  disc.addColorStop(0, "rgba(79,141,255,0.16)");
  disc.addColorStop(1, "rgba(79,141,255,0)");
  g.fillStyle = disc;
  ring(g, cl.x, cl.y, cl.radius * 1.5);
  g.fill();
  g.strokeStyle = withAlpha(POP, 0.22);
  g.lineWidth = U * 0.25;
  g.setLineDash([U * 0.6, U * 0.6]);
  ring(g, cl.x, cl.y, cl.radius);
  g.stroke();
  g.setLineDash([]);
  const sh = geo.shuttle;
  g.lineCap = "round";
  g.strokeStyle = withAlpha(SHUTTLE, 0.25);
  g.lineWidth = U * 0.5;
  g.beginPath();
  g.moveTo(sh.x0, sh.y);
  g.lineTo(sh.x1, sh.y);
  g.stroke();
  for (const x of [sh.x0, sh.x1]) {
    g.fillStyle = withAlpha(SHUTTLE, 0.45);
    ring(g, x, sh.y, U * 0.45);
    g.fill();
  }
  // The nest's track.
  const n = geo.nest;
  g.strokeStyle = withAlpha(NEST, 0.2);
  g.lineWidth = U * 0.3;
  g.beginPath();
  g.moveTo(n.minX - U * 8, n.y - n.depth - U * 1.6);
  g.lineTo(n.maxX + U * 8, n.y - n.depth - U * 1.6);
  g.stroke();
  // Magnets: coils round a horseshoe.
  for (const m of geo.magnets) {
    const glow = g.createRadialGradient(m.x, m.y, m.r * 0.3, m.x, m.y, m.r * 1.3);
    glow.addColorStop(0, withAlpha(MAGNET, 0.22));
    glow.addColorStop(1, withAlpha(MAGNET, 0));
    g.fillStyle = glow;
    ring(g, m.x, m.y, m.r * 1.3);
    g.fill();
    for (let k = 3; k >= 1; k--) {
      ring(g, m.x, m.y, (m.r * k) / 3);
      g.strokeStyle = withAlpha(MAGNET, 0.35 + 0.15 * (3 - k));
      g.lineWidth = U * 0.28;
      g.stroke();
    }
    ring(g, m.x, m.y, m.r * 0.5);
    g.fillStyle = "#1a0f33";
    g.fill();
    g.save();
    g.translate(m.x, m.y);
    g.lineCap = "butt";
    g.lineWidth = U * 0.38;
    g.strokeStyle = MAGNET;
    g.beginPath();
    g.arc(0, 0, m.r * 0.24, 0, Math.PI);
    g.moveTo(-m.r * 0.24, 0);
    g.lineTo(-m.r * 0.24, -m.r * 0.26);
    g.moveTo(m.r * 0.24, 0);
    g.lineTo(m.r * 0.24, -m.r * 0.26);
    g.stroke();
    g.strokeStyle = "#f2f5fa";
    g.beginPath();
    g.moveTo(-m.r * 0.24, -m.r * 0.18);
    g.lineTo(-m.r * 0.24, -m.r * 0.3);
    g.moveTo(m.r * 0.24, -m.r * 0.18);
    g.lineTo(m.r * 0.24, -m.r * 0.3);
    g.stroke();
    g.restore();
  }
  // Star rollovers, unlit.
  for (const st of geo.stars) {
    starPath(g, st.x, st.y, st.r * 0.8);
    g.fillStyle = withAlpha("#ffffff", 0.08);
    g.fill();
    g.strokeStyle = withAlpha("#ffffff", 0.3);
    g.lineWidth = U * 0.12;
    g.stroke();
  }
  // Saucers and the scoop: holes with rims.
  const hole = (x: number, y: number, r: number, c: string) => {
    const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    gr.addColorStop(0, "#000000");
    gr.addColorStop(1, "#090c22");
    g.fillStyle = gr;
    ring(g, x, y, r);
    g.fill();
    g.strokeStyle = withAlpha(c, 0.75);
    g.lineWidth = U * 0.28;
    g.stroke();
  };
  /** A chevron by a hole, pointing the way it kicks. */
  const kickArrow = (x: number, y: number, vx: number, vy: number, d: number, c: string) => {
    const l = Math.hypot(vx, vy) || 1;
    g.save();
    g.translate(x + (vx / l) * d, y + (vy / l) * d);
    g.rotate(Math.atan2(vx, -vy));
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(0, -U * 0.7);
    g.lineTo(U * 0.6, U * 0.35);
    g.lineTo(0, 0);
    g.lineTo(-U * 0.6, U * 0.35);
    g.closePath();
    g.fill();
    g.restore();
  };
  for (const s of geo.saucers) {
    hole(s.x, s.y, s.r * 0.9, AMBER);
    kickArrow(s.x, s.y, s.kick.vx, s.kick.vy, s.r * 1.7, withAlpha(AMBER, 0.6));
  }
  hole(geo.vuk.x, geo.vuk.y, geo.vuk.r * 0.85, VUK);
  kickArrow(geo.vuk.x, geo.vuk.y, 0, -1, geo.vuk.r * 1.7, withAlpha(VUK, 0.6));
  // The lock's tube.
  const lk = geo.lock;
  g.fillStyle = withAlpha(LOCK, 0.07);
  g.strokeStyle = withAlpha(LOCK, 0.5);
  g.lineWidth = U * 0.18;
  g.beginPath();
  g.roundRect(lk.x - U * 1.25, lk.top, U * 2.5, lk.bottom - lk.top + U * 0.3, U * 1.2);
  g.fill();
  g.stroke();
  // The captive ball's chamber, faintly lit inside.
  const cb = geo.captive.box;
  g.fillStyle = "rgba(255,204,51,0.06)";
  g.fillRect(cb.x0, cb.y0, cb.x1 - cb.x0, cb.y1 - cb.y0);
  // Walls and gutters.
  g.save();
  g.shadowColor = RAIL_GLOW;
  g.shadowBlur = U * 0.8;
  g.strokeStyle = RAIL;
  for (const s of [...geo.walls, ...geo.floor]) {
    g.lineWidth = s.r * 2;
    g.beginPath();
    g.moveTo(s.ax, s.ay);
    g.lineTo(s.bx, s.by);
    g.stroke();
  }
  g.restore();
  // Slingshots.
  for (const s of geo.slings) {
    const [a, b, c] = s.pts as [(typeof s.pts)[0], (typeof s.pts)[0], (typeof s.pts)[0]];
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.lineTo(c.x, c.y);
    g.closePath();
    g.fillStyle = "rgba(255,111,145,0.22)";
    g.fill();
    g.strokeStyle = withAlpha(RAIL, 0.6);
    g.lineWidth = s.under.r * 2;
    g.beginPath();
    g.moveTo(s.under.ax, s.under.ay);
    g.lineTo(s.under.bx, s.under.by);
    g.stroke();
    g.strokeStyle = "#ff6f91";
    g.lineWidth = s.face.r * 2.4;
    g.beginPath();
    g.moveTo(s.face.ax, s.face.ay);
    g.lineTo(s.face.bx, s.face.by);
    g.stroke();
  }
  // Posts and mushrooms.
  for (const p of geo.posts) {
    ring(g, p.x, p.y, p.r);
    g.fillStyle = "#dfe8ff";
    g.fill();
  }
  for (const m of geo.captive.posts) {
    ring(g, m.x, m.y, m.r);
    g.fillStyle = "#dfe8ff";
    g.fill();
  }
  // Mushrooms: flat caps in teal with a dark stem, nothing like a ball.
  for (const m of geo.mushrooms) {
    ring(g, m.x, m.y, m.r);
    g.fillStyle = "#127a6c";
    g.fill();
    g.lineWidth = U * 0.22;
    g.strokeStyle = MUSHROOM;
    g.stroke();
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      ring(g, m.x + Math.cos(a) * m.r * 0.6, m.y + Math.sin(a) * m.r * 0.6, m.r * 0.1);
      g.fillStyle = withAlpha(MUSHROOM, 0.8);
      g.fill();
    }
    ring(g, m.x, m.y, m.r * 0.28);
    g.fillStyle = "#06221e";
    g.fill();
  }
  // Pop bumpers.
  for (const b of geo.pops) {
    const glow = g.createRadialGradient(b.x, b.y, b.r * 0.5, b.x, b.y, b.r * 2);
    glow.addColorStop(0, "rgba(111,164,252,0.22)");
    glow.addColorStop(1, "rgba(111,164,252,0)");
    g.fillStyle = glow;
    ring(g, b.x, b.y, b.r * 2);
    g.fill();
    g.fillStyle = "#151c44";
    ring(g, b.x, b.y, b.r);
    g.fill();
    g.lineWidth = U * 0.3;
    g.strokeStyle = POP;
    g.stroke();
    g.fillStyle = "rgba(111,164,252,0.7)";
    ring(g, b.x, b.y, b.r * 0.6);
    g.fill();
  }
  for (const gate of geo.spinners) {
    g.fillStyle = withAlpha(RAIL, 0.5);
    const w = U * 0.4;
    g.fillRect(gate.ax - w, gate.ay - w / 2, w, w);
    g.fillRect(gate.bx, gate.by - w / 2, w, w);
  }
  // Ramps and orbits ride over everything else.
  for (const r of geo.rails) drawRail(g, r, U);
  // Chutes: glass tubes from the bottom edge up through the floor, capped at the top.
  for (const p of geo.pillars) {
    const s = geo.slots.find((x) => Math.abs(x.chuteX - p.ax) < 1);
    const c = s ? (palette[s.color % palette.length] ?? AMBER) : AMBER;
    g.save();
    g.lineCap = "round";
    g.strokeStyle = withAlpha(c, 0.22);
    g.lineWidth = p.r * 2;
    g.beginPath();
    g.moveTo(p.ax, H + p.r);
    g.lineTo(p.bx, p.by);
    g.stroke();
    g.strokeStyle = withAlpha(c, 0.75);
    g.lineWidth = Math.max(3, R * 0.18);
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(p.ax + side * p.r, H);
      g.lineTo(p.bx + side * p.r, p.by);
      g.stroke();
    }
    g.beginPath();
    g.arc(p.bx, p.by, p.r, Math.PI, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  // Return holes.
  for (const s of geo.slots) {
    const c = palette[s.color % palette.length] ?? AMBER;
    g.save();
    g.fillStyle = "#010208";
    g.beginPath();
    g.ellipse(s.holeX, geo.holeY + R * 0.6, R * 1.5, R * 0.75, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = Math.max(3, R * 0.22);
    g.strokeStyle = c;
    g.stroke();
    g.restore();
  }
  // The rail under the floor that carries balls across to other tables.
  g.save();
  g.strokeStyle = withAlpha(RAIL, 0.18);
  g.lineWidth = Math.max(2, R * 0.12);
  g.setLineDash([R, R * 0.8]);
  g.beginPath();
  g.moveTo(0, geo.railY);
  g.lineTo(W, geo.railY);
  g.stroke();
  g.restore();
};

const ballAt = (g: CanvasRenderingContext2D, x: number, y: number, r: number, tint: string) => {
  const body = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.35, "#d9e2f0");
  body.addColorStop(0.8, "#7c8aa6");
  body.addColorStop(1, "#3b4458");
  g.fillStyle = withAlpha(tint, 0.4);
  ring(g, x, y, r * 1.3);
  g.fill();
  g.fillStyle = body;
  ring(g, x, y, r);
  g.fill();
  g.lineWidth = Math.max(2, r * 0.16);
  g.strokeStyle = tint;
  g.stroke();
};

/** Where a table's score goes, and how big it is. */
const columnOf = (geo: DeckGeometry, i: number) => {
  const s = geo.slots[i]!;
  const w = s.x1 - s.x0;
  const base = geo.launchY - geo.R * 3;
  const size = Math.min(w * 0.2, geo.R * 4.2);
  return { base, size, box: { x0: s.x0, y0: base - size * 1.05, x1: s.x1, y1: base + size * 0.4 } };
};

const totalOf = (geo: DeckGeometry) => {
  const size = geo.totalSize ?? Math.min(geo.W * 0.06, geo.H * 0.07);
  const ty = geo.ceiling + geo.U * 2.6 + size * 0.75;
  return {
    size,
    ty,
    by: ty + size * 0.68,
    box: {
      x0: geo.W / 2 - size * 3.4,
      y0: ty - size * 0.75,
      x1: geo.W / 2 + size * 3.4,
      y1: ty + size * 0.95,
    },
  };
};

const targetBox = (geo: DeckGeometry, i: number): Box | null => {
  const t = geo.targets[i];
  if (!t) return null;
  const pad = t.r + geo.R;
  return {
    x0: Math.min(t.ax, t.bx) - pad,
    y0: Math.min(t.ay, t.by) - pad,
    x1: Math.max(t.ax, t.bx) + pad,
    y1: Math.max(t.ay, t.by) + pad,
  };
};

/** What the board shows, per item, so a change can be spotted. */
const boardKeys = (deck: Deck, time: number): string[] => {
  const geo = deck.geo;
  const cols = geo.columns !== false;
  const keys = geo.slots.map((s) => (s.frame && cols ? `${s.score}|${s.playing}` : ""));
  const frac = (deck.total % RAIN_STEP) / RAIN_STEP;
  const blink = frac > 0.9 && Math.sin(time * 4) > 0;
  keys.push(`${deck.total}|${Math.round(frac * 200)}|${blink}`);
  for (let i = 0; i < geo.targets.length; i++) keys.push(String(deck.lit[i] ?? false));
  return keys;
};

const drawBoard = (
  g: CanvasRenderingContext2D,
  deck: Deck,
  time: number,
  palette: readonly string[],
) => {
  const geo = deck.geo;
  const { W, R } = geo;
  geo.slots.forEach((s, i) => {
    if (!s.frame || geo.columns === false) return;
    const c = palette[s.color % palette.length] ?? AMBER;
    const w = s.x1 - s.x0;
    const col = columnOf(geo, i);
    const text = formatScore(s.score);
    g.font = `800 ${col.size}px ${FONT}`;
    // Kept inside the table's own column, so redrawing one column never leaves a neighbour's
    // digits behind.
    const fit = Math.min(1, (w * 0.9) / Math.max(1, g.measureText(text).width));
    if (fit < 1) g.font = `800 ${col.size * fit}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillStyle = s.playing ? c : withAlpha(c, 0.35);
    g.fillText(text, (s.x0 + s.x1) / 2, col.base);
  });
  geo.targets.forEach((t, i) => {
    const s = geo.slots[i];
    const c = s ? (palette[s.color % palette.length] ?? AMBER) : AMBER;
    g.save();
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(t.ax, t.ay);
    g.lineTo(t.bx, t.by);
    if (deck.lit[i]) {
      // A halo that stays inside the target's repaint box (a shadow blur would spill out of it).
      g.lineWidth = t.r * 2 + R * 0.9;
      g.strokeStyle = withAlpha(c, 0.25);
      g.stroke();
    }
    g.lineWidth = t.r * 2;
    g.strokeStyle = deck.lit[i] ? c : withAlpha(AMBER, 0.35);
    g.stroke();
    g.restore();
  });
  // The shared total, and how close the next bonus ball for everyone is.
  const tot = totalOf(geo);
  const { size, ty, by } = tot;
  g.save();
  g.font = `800 ${size}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(0,0,0,0.5)";
  g.fillText(formatScore(deck.total), W / 2 + size * 0.04, ty + size * 0.04);
  g.fillStyle = "#f2f5fa";
  g.fillText(formatScore(deck.total), W / 2, ty);
  const frac = (deck.total % RAIN_STEP) / RAIN_STEP;
  const bw = size * 5;
  g.fillStyle = "rgba(242,245,250,0.15)";
  g.beginPath();
  g.roundRect(W / 2 - bw / 2, by, bw, size * 0.14, size * 0.07);
  g.fill();
  g.fillStyle = AMBER;
  g.beginPath();
  g.roundRect(W / 2 - bw / 2, by, Math.max(size * 0.14, bw * frac), size * 0.14, size * 0.07);
  g.fill();
  if (frac > 0.9 && Math.sin(time * 4) > 0) {
    g.strokeStyle = AMBER;
    g.lineWidth = size * 0.04;
    g.stroke();
  }
  g.restore();
};

/** Pre-drawn balls, bubbles and gifts, since gradients each frame are slow on a big screen. */
const createSprites = (scale: () => number) => {
  const cache = new Map<string, HTMLCanvasElement>();
  const get = (key: string, half: number, paint: (g: CanvasRenderingContext2D) => void) => {
    let c = cache.get(key);
    if (c) {
      cache.delete(key);
      cache.set(key, c);
      return c;
    }
    c = document.createElement("canvas");
    c.width = half * 2;
    c.height = half * 2;
    const g = c.getContext("2d");
    if (g) paint(g);
    cache.set(key, c);
    while (cache.size > 128) {
      const first = cache.keys().next().value;
      if (first === undefined) break;
      cache.delete(first);
    }
    return c;
  };
  return {
    ball(r: number, color: string): HTMLCanvasElement {
      const k = scale();
      // Sizes in steps of two backing px: balls grow and shrink in the chutes and holes.
      const rq = Math.max(2, Math.round((r * k) / 2) * 2);
      const half = Math.ceil(rq * 1.3 + 2 * k);
      return get(`b|${color}|${rq}`, half, (g) => ballAt(g, half, half, rq, color));
    },
    bubble(r: number, kind: Parameters<typeof drawGiftIcon>[1]): HTMLCanvasElement {
      const rq = Math.max(4, Math.round(r * scale()));
      const half = rq + 4;
      return get(`u|${kind}|${rq}`, half, (g) => {
        const body = g.createRadialGradient(
          half - rq * 0.35,
          half - rq * 0.4,
          rq * 0.1,
          half,
          half,
          rq,
        );
        body.addColorStop(0, "rgba(255,255,255,0.5)");
        body.addColorStop(0.6, "rgba(160,220,255,0.12)");
        body.addColorStop(1, "rgba(160,220,255,0.35)");
        g.fillStyle = body;
        ring(g, half, half, rq);
        g.fill();
        g.strokeStyle = "rgba(220,240,255,0.8)";
        g.lineWidth = Math.max(2, rq * 0.06);
        g.stroke();
        drawGiftIcon(g, kind, half, half, rq * 0.58, GIFT_COLOR[kind]);
      });
    },
    gift(r: number, kind: Parameters<typeof drawGiftIcon>[1]): HTMLCanvasElement {
      const rq = Math.max(4, Math.round(r * scale()));
      const half = rq + 2;
      return get(`g|${kind}|${rq}`, half, (g) =>
        drawGiftIcon(g, kind, half, half, rq, GIFT_COLOR[kind]),
      );
    },
  };
};

type Sprites = ReturnType<typeof createSprites>;

/** Moving things, drawn on top each frame; returns the boxes they cover. */
const drawLive = (
  g: CanvasRenderingContext2D,
  deck: Deck,
  alpha: number,
  time: number,
  palette: readonly string[],
  sprites: Sprites,
  out: Box[],
) => {
  const geo = deck.geo;
  const { H, R, U } = geo;
  const parts = deck.parts;
  const flash = (tag: string, i: number, s = 0.3) => {
    const a = deck.flashAge(tag, i);
    return a < s ? 1 - a / s : 0;
  };
  geo.slots.forEach((s, i) => {
    const f = flash("rain", i);
    if (f <= 0) return;
    // A beam down into the hole of a table that gets a bonus ball.
    const c = palette[s.color % palette.length] ?? AMBER;
    const x0 = s.holeX - R * 1.6;
    g.fillStyle = withAlpha(c, 0.3 * f);
    g.fillRect(x0, geo.ceiling, R * 3.2, geo.holeY - geo.ceiling);
    out.push({ x0, y0: geo.ceiling, x1: x0 + R * 3.2, y1: geo.holeY });
  });
  geo.targets.forEach((t, i) => {
    if (flash("target", i) <= 0) return;
    g.save();
    g.lineCap = "round";
    g.lineWidth = t.r * 2;
    g.strokeStyle = "#ffffff";
    g.beginPath();
    g.moveTo(t.ax, t.ay);
    g.lineTo(t.bx, t.by);
    g.stroke();
    g.restore();
    const b = targetBox(geo, i);
    if (b) out.push(b);
  });
  // Bumper hits: a white centre and a ring that widens and fades.
  const hit = (x: number, y: number, r: number, f: number) => {
    g.save();
    ring(g, x, y, r * 0.6);
    g.fillStyle = "#ffffff";
    g.fill();
    g.globalAlpha = f;
    g.lineWidth = U * 0.4;
    g.strokeStyle = "#ffffff";
    ring(g, x, y, r * (1.1 + (1 - f) * 0.5));
    g.stroke();
    g.restore();
    out.push(box(x, y, r * 1.6 + U * 0.4));
  };
  for (const b of geo.pops) {
    const f = flash("bumper", b.index);
    if (f > 0) hit(b.x, b.y, b.r, f);
  }
  for (const m of geo.mushrooms) {
    const f = flash("mushroom", m.index);
    if (f <= 0) continue;
    g.save();
    g.globalAlpha = f;
    g.lineWidth = U * 0.3;
    g.strokeStyle = "#ffffff";
    ring(g, m.x, m.y, m.r);
    g.stroke();
    g.restore();
    out.push(box(m.x, m.y, m.r + U * 0.4));
  }
  for (const s of geo.slings) {
    const f = flash("sling", s.face.index);
    if (f <= 0) continue;
    g.save();
    g.lineCap = "round";
    g.globalAlpha = f;
    g.strokeStyle = "#ffffff";
    g.lineWidth = s.face.r * 2.6;
    g.beginPath();
    g.moveTo(s.face.ax, s.face.ay);
    g.lineTo(s.face.bx, s.face.by);
    g.stroke();
    g.restore();
    out.push({
      x0: Math.min(s.face.ax, s.face.bx) - U,
      y0: Math.min(s.face.ay, s.face.by) - U,
      x1: Math.max(s.face.ax, s.face.bx) + U,
      y1: Math.max(s.face.ay, s.face.by) + U,
    });
  }
  // Stars light in the colour of the ball that rolled over them, fading over a second and a half.
  geo.stars.forEach((st, i) => {
    const lit = parts.stars[i];
    if (!lit) return;
    const age = deck.world.t - lit.at;
    if (age > 1.5) return;
    const k = 1 - age / 1.5;
    const c = palette[lit.color % palette.length] ?? AMBER;
    g.save();
    g.globalAlpha = 0.25 + 0.75 * k;
    starPath(g, st.x, st.y, st.r * 0.8);
    g.fillStyle = c;
    g.fill();
    g.restore();
    out.push(box(st.x, st.y, st.r + 2));
  });
  // The big bumper: its colour and a ring of lamps show how near it is to bursting.
  const bb = geo.big;
  const big = parts.big;
  const bc = BIG[big.level] ?? BIG[0]!;
  const bf = flash("big", 0, 0.2);
  const burst = flash("burst", 0, 0.8);
  g.save();
  const glow = g.createRadialGradient(bb.x, bb.y, bb.r * 0.6, bb.x, bb.y, bb.r * 1.9);
  glow.addColorStop(0, withAlpha(bc, 0.35 + 0.3 * burst));
  glow.addColorStop(1, withAlpha(bc, 0));
  g.fillStyle = glow;
  ring(g, bb.x, bb.y, bb.r * 1.9);
  g.fill();
  ring(g, bb.x, bb.y, bb.r);
  g.fillStyle = "#151c44";
  g.fill();
  g.lineWidth = U * 0.4;
  g.strokeStyle = bc;
  g.stroke();
  ring(g, bb.x, bb.y, bb.r * 0.62);
  g.fillStyle = bf > 0 ? "#ffffff" : withAlpha(bc, 0.8);
  g.fill();
  const lamps = 6;
  const lit = big.hits % lamps;
  for (let i = 0; i < lamps; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / lamps;
    ring(g, bb.x + Math.cos(a) * bb.r * 0.82, bb.y + Math.sin(a) * bb.r * 0.82, U * 0.24);
    g.fillStyle = i < lit ? "#ffffff" : withAlpha("#ffffff", 0.18);
    g.fill();
  }
  g.restore();
  out.push(box(bb.x, bb.y, bb.r * 1.9 + 2));
  // Moving bumpers.
  const mover = (x: number, y: number, r: number, c: string, f: number) => {
    g.save();
    ring(g, x, y, r * 1.35);
    g.fillStyle = withAlpha(c, 0.18);
    g.fill();
    ring(g, x, y, r);
    g.fillStyle = "#151c44";
    g.fill();
    g.lineWidth = U * 0.28;
    g.strokeStyle = c;
    g.stroke();
    ring(g, x, y, r * 0.58);
    g.fillStyle = f > 0 ? "#ffffff" : withAlpha(c, 0.8);
    g.fill();
    g.restore();
    out.push(box(x, y, r * 1.35 + 2));
  };
  for (const b of geo.cluster.bumpers) mover(b.x, b.y, b.r, POP, flash("cluster", b.index, 0.2));
  const sb = geo.shuttle.bumper;
  mover(sb.x, sb.y, sb.r, SHUTTLE, flash("shuttle", 0, 0.2));
  geo.spinners.forEach((gate, i) => {
    const sp = deck.spinners[i];
    if (!sp) return;
    const cx = (gate.ax + gate.bx) / 2;
    const half = Math.abs(gate.bx - gate.ax) / 2;
    const k = Math.abs(Math.cos(sp.angle));
    g.fillStyle = sp.speed > 1 ? "#ffffff" : withAlpha(AMBER, 0.85);
    g.fillRect(cx - half, gate.ay - U * 0.15 - U * 0.6 * k, half * 2, U * 0.3 + U * 1.2 * k);
    out.push({ x0: cx - half, y0: gate.ay - U * 0.9, x1: cx + half, y1: gate.ay + U * 0.9 });
  });
  // Magnets glow while they hold a ball, brighter as they charge.
  parts.magnets.forEach((m, i) => {
    const thrown = flash(`magnet${i}`, 0, 0.5);
    const holding = m.held.length > 0;
    if (!holding && thrown <= 0) return;
    const charge = holding ? Math.min(1, (lastClock(deck) - m.since) / MAGNET_MS) : 0;
    const sp = m.spec;
    g.save();
    const gl = g.createRadialGradient(sp.x, sp.y, sp.r * 0.2, sp.x, sp.y, sp.r * 1.4);
    gl.addColorStop(0, withAlpha(MAGNET, 0.15 + 0.45 * charge));
    gl.addColorStop(1, withAlpha(MAGNET, 0));
    g.fillStyle = gl;
    ring(g, sp.x, sp.y, sp.r * 1.4);
    g.fill();
    g.lineWidth = U * 0.35;
    g.strokeStyle = MAGNET;
    g.beginPath();
    g.arc(sp.x, sp.y, sp.r * 1.05, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge);
    g.stroke();
    g.restore();
    out.push(box(sp.x, sp.y, sp.r * 1.4 + 2));
  });
  // Saucers and the scoop: a ring runs round while they hold a ball.
  const holdRing = (x: number, y: number, r: number, c: string, k: number) => {
    g.save();
    g.lineWidth = U * 0.35;
    g.strokeStyle = c;
    g.beginPath();
    g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
    g.stroke();
    g.restore();
    out.push(box(x, y, r + U * 0.4));
  };
  for (const s of parts.saucers) {
    if (s.held.length > 0) {
      holdRing(
        s.spec.x,
        s.spec.y,
        s.spec.r,
        AMBER,
        Math.min(1, (lastClock(deck) - s.since) / SAUCER_MS),
      );
    }
  }
  if (parts.vuk.held.length > 0) {
    const v = geo.vuk;
    holdRing(v.x, v.y, v.r, VUK, Math.min(1, (lastClock(deck) - parts.vuk.since) / VUK_MS));
  }
  // The lock's lamps, one per ball held; all three light up together for a multiball.
  const lk = geo.lock;
  const multi = flash("multiball", 0, 1.2);
  for (let i = 0; i < LOCK_SIZE; i++) {
    const at = lk.stack[i]!;
    const x = lk.x - U * 2.3;
    const on = i < parts.lock.held.length || multi > 0;
    g.save();
    ring(g, x, at.y, U * 0.45);
    g.fillStyle = on ? LOCK : withAlpha(LOCK, 0.15);
    g.fill();
    g.restore();
    out.push(box(x, at.y, U * 0.6));
  }
  // The nest: a basket of cups on its track, tipping to pour.
  const nest = parts.nest;
  const nw = nest.width;
  const tilt = nest.tilt(lastClock(deck)) * 1.1;
  const ny = geo.nest.y;
  g.save();
  g.translate(nest.x, ny);
  g.strokeStyle = withAlpha(NEST, 0.5);
  g.lineWidth = U * 0.18;
  g.beginPath();
  g.moveTo(-nw * 0.35, -geo.nest.depth - U * 1.6);
  g.lineTo(-nw / 2, -U * 0.3);
  g.moveTo(nw * 0.35, -geo.nest.depth - U * 1.6);
  g.lineTo(nw / 2, -U * 0.3);
  g.stroke();
  g.rotate(tilt);
  g.fillStyle = withAlpha(NEST, 0.22);
  g.strokeStyle = NEST;
  g.lineWidth = U * 0.3;
  g.beginPath();
  g.moveTo(-nw / 2, -U * 0.8);
  g.quadraticCurveTo(-nw / 2, U * 0.9, 0, U * 0.9);
  g.quadraticCurveTo(nw / 2, U * 0.9, nw / 2, -U * 0.8);
  g.closePath();
  g.fill();
  g.stroke();
  const cw = nw / nest.cups;
  for (let i = 1; i < nest.cups; i++) {
    const x = -nw / 2 + i * cw;
    g.beginPath();
    g.moveTo(x, -U * 0.6);
    g.lineTo(x, U * 0.6);
    g.stroke();
  }
  g.restore();
  if (tilt > 0) {
    // Square round its pivot while it tips, so the box holds the basket however far it turns.
    const nr = Math.max(nw / 2 + U * 2, geo.nest.depth + U * 2.2);
    out.push({ x0: nest.x - nr, y0: ny - nr, x1: nest.x + nr, y1: ny + nr });
  } else {
    out.push({
      x0: nest.x - nw / 2 - U,
      y0: ny - geo.nest.depth - U * 2.2,
      x1: nest.x + nw / 2 + U,
      y1: ny + U * 1.4,
    });
  }
  // The captive ball, in gold.
  const cap = parts.captive;
  const cf = flash("captive", 0, 0.5);
  if (cf > 0) {
    const t = geo.captive.target;
    g.save();
    g.lineCap = "round";
    g.strokeStyle = "#ffffff";
    g.globalAlpha = cf;
    g.lineWidth = t.r * 3;
    g.beginPath();
    g.moveTo(t.ax, t.ay);
    g.lineTo(t.bx, t.by);
    g.stroke();
    g.restore();
    out.push({ x0: t.ax - U, y0: t.ay - U, x1: t.bx + U, y1: t.ay + U });
  }
  const cx = cap.px + (cap.x - cap.px) * alpha;
  const cy = cap.py + (cap.y - cap.py) * alpha;
  const capHalf = cap.r * 1.3 + 2;
  g.drawImage(sprites.ball(cap.r, AMBER), cx - capHalf, cy - capHalf, capHalf * 2, capHalf * 2);
  out.push(box(cx, cy, capHalf));
  // Gift bubbles, and the rings of popped ones.
  const br = geo.bubbles.r;
  for (const b of parts.bubbles.list) {
    if (b.popAt === Infinity) {
      const half = br + 4;
      g.drawImage(sprites.bubble(br, b.kind), b.x - half, b.y - half, half * 2, half * 2);
      out.push(box(b.x, b.y, half + 2));
    } else {
      const k = Math.min(1, (lastClock(deck) - b.popAt) / 600);
      g.save();
      g.globalAlpha = 1 - k;
      g.strokeStyle = GIFT_COLOR[b.kind];
      g.lineWidth = U * 0.3;
      ring(g, b.x, b.y, br * (1 + k * 1.2));
      g.stroke();
      g.restore();
      out.push(box(b.x, b.y, br * 2.3 + U));
    }
  }
  for (const t of parts.tokens) {
    if (t.y - U * 1.2 > H) continue;
    const r = U * 1.1;
    g.drawImage(sprites.gift(r, t.kind), t.x - r - 2, t.y - r - 2, (r + 2) * 2, (r + 2) * 2);
    out.push(box(t.x, t.y, r + 3));
  }
  for (const b of deck.balls) {
    const c = palette[b.color % palette.length] ?? AMBER;
    const x = b.phase === "free" ? b.px + (b.x - b.px) * alpha : b.x;
    const y = b.phase === "free" ? b.py + (b.y - b.py) * alpha : b.y;
    if (y - b.r * 1.3 > H) continue;
    const half = b.r * 1.3 + 2;
    g.drawImage(sprites.ball(b.r, c), x - half, y - half, half * 2, half * 2);
    out.push(box(x, y, half));
  }
  void time;
};

/** The deck's clock at its last update, ms. */
const lastClock = (deck: Deck) => deck.clock;

export const createDeckView = (root: HTMLElement, palette: readonly string[]): DeckView => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;";
  root.append(canvas);
  const art = document.createElement("canvas");
  const base = document.createElement("canvas");
  const g = canvas.getContext("2d");
  const ga = art.getContext("2d");
  const gb = base.getContext("2d");
  let scale = 1;
  let drawn: DeckGeometry | null = null;
  let keys: string[] = [];
  let last: Box[] = [];
  const sprites = createSprites(() => scale);

  /** Deck px to whole backing px, grown a little for antialiasing. */
  const px = (b: Box) => {
    const x0 = Math.max(0, Math.floor(b.x0 * scale) - 2);
    const y0 = Math.max(0, Math.floor(b.y0 * scale) - 2);
    const x1 = Math.min(canvas.width, Math.ceil(b.x1 * scale) + 2);
    const y1 = Math.min(canvas.height, Math.ceil(b.y1 * scale) + 2);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  const restore = (b: Box) => {
    if (!g) return;
    const r = px(b);
    if (r.w <= 0 || r.h <= 0) return;
    g.drawImage(base, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  };

  /** Redraw part of the base from the art, with the board on top, inside `b`. */
  const repaint = (deck: Deck, time: number, b: Box) => {
    if (!gb) return;
    const r = px(b);
    if (r.w <= 0 || r.h <= 0) return;
    gb.save();
    gb.setTransform(1, 0, 0, 1, 0, 0);
    gb.drawImage(art, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    gb.beginPath();
    gb.rect(r.x, r.y, r.w, r.h);
    gb.clip();
    gb.setTransform(scale, 0, 0, scale, 0, 0);
    drawBoard(gb, deck, time, palette);
    gb.restore();
  };

  return {
    resize(frame, region, f = 1) {
      const u = frame.unit;
      const w = Math.max(1, Math.round((region ? region.w * u : frame.width) * frame.pixelRatio));
      const h = Math.max(1, Math.round((region ? region.h * u : frame.height) * frame.pixelRatio));
      for (const c of [canvas, art, base]) {
        if (c.width !== w) c.width = w;
        if (c.height !== h) c.height = h;
      }
      if (region) {
        canvas.style.cssText =
          `position:absolute;left:${region.x * u}px;top:${region.y * u}px;` +
          `width:${region.w * u}px;height:${region.h * u}px;`;
      }
      scale = frame.unit * frame.pixelRatio * f;
      drawn = null;
    },
    draw(deck, alpha, time) {
      if (!g || !gb || !ga) return;
      const geo = deck.geo;
      const now = boardKeys(deck, time);
      const dirty: Box[] = [];
      if (drawn !== geo) {
        drawn = geo;
        ga.setTransform(scale, 0, 0, scale, 0, 0);
        drawArt(ga, geo, palette);
        gb.setTransform(1, 0, 0, 1, 0, 0);
        gb.drawImage(art, 0, 0);
        gb.setTransform(scale, 0, 0, scale, 0, 0);
        drawBoard(gb, deck, time, palette);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(base, 0, 0);
        last = [];
      } else {
        const n = geo.slots.length;
        now.forEach((k, i) => {
          if (k === keys[i]) return;
          const b =
            i < n ? columnOf(geo, i).box : i === n ? totalOf(geo).box : targetBox(geo, i - n - 1);
          if (!b) return;
          repaint(deck, time, b);
          dirty.push(b);
        });
      }
      keys = now;
      g.setTransform(1, 0, 0, 1, 0, 0);
      for (const b of last) restore(b);
      for (const b of dirty) restore(b);
      const live: Box[] = [];
      g.setTransform(scale, 0, 0, scale, 0, 0);
      drawLive(g, deck, alpha, time, palette, sprites, live);
      last = live;
    },
    dispose() {
      canvas.remove();
      canvas.width = 0;
      art.width = 0;
      base.width = 0;
    },
  };
};
