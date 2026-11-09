/**
 * Drawing the screen above a bank: a live view of every touch frame's craft over that frame's own
 * terrain, in the frame's column, so each craft is always straight above the frame flying it.
 *
 * Each view is zoomed to ZOOM times the bank's own scale, so the crafts read from across the room
 * (at the bank's scale a craft on the screen is no bigger than on its panel). A column is then
 * narrower than its frame's world, so the view follows its craft sideways, easing, and stops at
 * the frame's edges. Neighbouring views are kept apart by a strip of sky. Pads, ghosts, flames,
 * dust and the stars of a landing are drawn as the frame draws them. All drawing is in the
 * screen's venue px.
 *
 * Two canvases: `back` holds the sky (and a quiet plateau under any column nobody is sending
 * from) and is repainted only when the columns change; `front` is redrawn every frame and covers
 * only the band where crafts can be.
 */
import { activeVenue } from "../../core/venue";
import type { FrameInfo } from "../../core/types";
import { createRng } from "../../core/rng";
import { bankFraction } from "../../core/layout";
import { withAlpha } from "../../core/ui";
import { drawCraft, drawFlames, drawGhost, type Flames, roundRect, star, TAU } from "./art";
import { ENGINE, FOOT, MAIN } from "./craft";
import type { ShipPose } from "./fleet";
import { FLAG } from "./ghost";
import type { Layout } from "./layout";
import { createParticles } from "./particles";
import { heightAt, type Terrain } from "./terrain";
import { SHIP_FLAG } from "./wire";

/** View scale over the bank's own scale: crafts are drawn this many times their size below. */
export const ZOOM = 2.3;
/** Where the frames' lowest ground sits, and the highest a view may reach, as screen fractions. */
const BOTTOM = 0.955;
const TOP = 0.03;
/** Sky left between neighbouring views, venue px each side. */
const GAP = 5;
/** How quickly a view follows its craft, per second. */
const FOLLOW = 1.8;
/** A new run's craft drops in on a streak this long, seconds. */
const ENTRY_S = 0.9;
/** Crafts nobody is flying are drawn this faint. */
export const ATTRACT_ALPHA = 0.42;
const MAX_STARS = 2600;
const MOTES = 10;
const MAX_KEYS = 96;

/** One craft to draw: a touch frame's, or one of the screen's own attract crews. */
export interface ShipView {
  key: string;
  pos: number;
  layout: Layout;
  terrain: Terrain;
  color: string;
  pose: ShipPose;
}

/** Where a frame's world goes on the screen: x' = x0 + x s, y' = Yb + (y - yb) s. */
export interface ColumnView {
  /** The column's left edge and width, screen px. */
  col0: number;
  colW: number;
  s: number;
  x0: number;
  yb: number;
  Yb: number;
}

export const emptyView = (): ColumnView => ({ col0: 0, colW: 1, s: 1, x0: 0, yb: 0, Yb: 0 });

/** The scale of a frame's view on a screen `W` by `H` venue px with `count` columns. */
export const viewScale = (l: Layout, count: number, W: number, H: number, zoom = ZOOM): number => {
  const bank = W / Math.max(1, count) / Math.max(1, l.width);
  const yTop = l.ceiling - 0.8 * l.craft;
  const fit = (H * (BOTTOM - TOP)) / Math.max(1, l.ground.bottom - yTop);
  return Math.min(zoom * bank, fit);
};

/** Frame x at the middle of the view when it looks at `x`: the craft, kept off the frame's edges. */
export const cameraFor = (l: Layout, x: number, colW: number, s: number): number => {
  const half = colW / 2 / s;
  if (2 * half >= l.width) return l.width / 2;
  return Math.min(l.width - half, Math.max(half, x));
};

/** The view of the frame at `pos` of `count`, centred on frame x `cam`. */
export const columnView = (
  l: Layout,
  pos: number,
  count: number,
  W: number,
  H: number,
  cam: number,
  out: ColumnView = emptyView(),
): ColumnView => {
  const n = Math.max(1, count);
  out.col0 = bankFraction(pos, 0, n) * W;
  out.colW = W / n;
  out.s = viewScale(l, n, W, H);
  out.x0 = out.col0 + out.colW / 2 - cam * out.s;
  out.yb = l.ground.bottom;
  out.Yb = H * BOTTOM;
  return out;
};

export const viewX = (v: ColumnView, x: number): number => v.x0 + x * v.s;
export const viewY = (v: ColumnView, y: number): number => v.Yb + (y - v.yb) * v.s;

export interface ScreenRenderer {
  setup(frame: FrameInfo): void;
  /** `count` is the number of touch frames the screen spans; `time` seconds; `dt` real seconds. */
  draw(ships: readonly ShipView[], count: number, time: number, dt: number): void;
  /** Screen venue px of a ship's craft as last drawn, and the view's scale. */
  place(ship: ShipView, count: number): { x: number; y: number; s: number };
  /** Drop dust, smoke and sparks. */
  clear(): void;
  readonly particles: number;
  dispose(): void;
}

interface Track {
  cam: number;
  emitAt: number;
  run: number;
  phase: string;
  phaseT: number;
  seen: number;
}

interface Mote {
  x: number;
  y: number;
  phase: number;
}

export const createScreenRenderer = (root: HTMLElement, seed: string): ScreenRenderer => {
  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;z-index:${z};`;
    root.append(c);
    return c;
  };
  const backCanvas = make(0);
  const frontCanvas = make(1);
  const back = backCanvas.getContext("2d");
  const g = frontCanvas.getContext("2d");
  let W = activeVenue().screen.width;
  let H = activeVenue().screen.height;
  let k = 1;
  /** Venue y where the front canvas starts; nothing moves above it. */
  let bandTop = -1;
  let painted: boolean[] = [];
  let paintedFor = "";
  const particles = createParticles(900);
  let groundGrad: CanvasGradient | null = null;
  let groundGradTop = Number.NaN;
  const tracks = new Map<string, Track>();
  const motes = new Map<number, Mote[]>();
  const occupied: boolean[] = [];
  const view = emptyView();
  const other = emptyView();
  let frameNo = 0;
  const flames: Flames = {
    left: false,
    right: false,
    main: false,
    turnLeft: false,
    turnRight: false,
    flicker: 1,
    faintLeft: false,
    faintRight: false,
  };

  const setFlames = (flags: number, flicker: number, faint: boolean) => {
    flames.left = (flags & FLAG.left) !== 0;
    flames.right = (flags & FLAG.right) !== 0;
    flames.main = (flags & FLAG.main) !== 0;
    flames.turnLeft = (flags & FLAG.turnLeft) !== 0;
    flames.turnRight = (flags & FLAG.turnRight) !== 0;
    flames.faintLeft = faint && (flags & SHIP_FLAG.faintLeft) !== 0;
    flames.faintRight = faint && (flags & SHIP_FLAG.faintRight) !== 0;
    flames.flicker = flicker;
  };

  const groundFill = (c: CanvasRenderingContext2D, top: number): CanvasGradient => {
    const grad = c.createLinearGradient(0, top, 0, H);
    grad.addColorStop(0, "#5d4b93");
    grad.addColorStop(0.35, "#3a2d68");
    grad.addColorStop(1, "#150f2c");
    return grad;
  };

  // ---- Static layer: the sky ------------------------------------------------------------------

  /** The sky over [x0, x1]; stars outside it are skipped but still drawn from the stream. */
  const drawSky = (c: CanvasRenderingContext2D, x0: number, x1: number, horizon: number) => {
    const sky = c.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#02040b");
    sky.addColorStop(0.6, "#0a0e2b");
    sky.addColorStop(1, "#2a1d55");
    c.fillStyle = sky;
    c.fillRect(x0, 0, x1 - x0, H);
    const rng = createRng(`${seed}:screen-sky`);
    const pr = Math.min(W, H) * 0.06;
    const px = W * rng.range(0.6, 0.85);
    const py = horizon * rng.range(0.3, 0.5);
    if (px + pr * 1.8 > x0 && px - pr * 1.8 < x1) {
      const pg = c.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
      pg.addColorStop(0, "#5a4c9c");
      pg.addColorStop(1, "#231b4a");
      c.fillStyle = pg;
      c.beginPath();
      c.arc(px, py, pr, 0, TAU);
      c.fill();
      c.strokeStyle = "rgba(170,150,230,0.35)";
      c.lineWidth = pr * 0.08;
      c.beginPath();
      c.ellipse(px, py, pr * 1.7, pr * 0.42, -0.25, 0, TAU);
      c.stroke();
    }
    const stars = Math.min(MAX_STARS, Math.round((W * horizon) / 9000));
    for (let i = 0; i < stars; i++) {
      const x = rng.range(0, W);
      const y = rng.range(0, horizon);
      const big = rng.next() < 0.06;
      const r = (big ? rng.range(2.4, 3.6) : rng.range(0.9, 2)) * 1.3;
      const alpha = rng.range(0.35, big ? 1 : 0.8);
      const warm = rng.next() < 0.2;
      if (x < x0 - 6 || x > x1 + 6) continue;
      c.globalAlpha = alpha;
      c.fillStyle = warm ? "#ffe9c2" : "#dfe8ff";
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;
  };

  /** A column nobody is sending from: a quiet plateau, so the ground has no hole. */
  const drawPlain = (c: CanvasRenderingContext2D, x0: number, x1: number, y: number) => {
    c.fillStyle = groundFill(c, y);
    c.fillRect(x0, y, x1 - x0, H - y);
    c.strokeStyle = "rgba(169,152,234,0.5)";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x0, y);
    c.lineTo(x1, y);
    c.stroke();
  };

  /** Screen y of the ground line of the first ship's frame, and of a quiet plateau. */
  const levels = (ships: readonly ShipView[], count: number) => {
    const first = ships[0];
    if (!first) return { horizon: Math.round(H * 0.8), plain: Math.round(H * 0.86) };
    const l = first.layout;
    columnView(l, 0, count, W, H, 0, other);
    const band = l.ground.bottom - l.ground.top;
    return {
      horizon: Math.round(viewY(other, l.ground.top)),
      plain: Math.round(viewY(other, l.ground.top + 0.4 * band)),
    };
  };

  const paint = (ships: readonly ShipView[], count: number) => {
    if (!back) return;
    occupied.length = count;
    occupied.fill(false);
    for (const sh of ships) if (sh.pos < count) occupied[sh.pos] = true;
    const { horizon, plain } = levels(ships, count);
    const key = `${W}x${H}:${k}:${count}:${horizon}:${plain}`;
    const full = key !== paintedFor;
    if (!full && occupied.every((o, i) => o === painted[i])) return;
    back.setTransform(k, 0, 0, k, 0, 0);
    for (let pos = 0; pos < count; pos++) {
      if (!full && occupied[pos] === painted[pos]) continue;
      const x0 = bankFraction(pos, 0, count) * W;
      const x1 = bankFraction(pos, 1, count) * W;
      // Whole device pixels, so the clip's edges don't blend into a seam; the sky is opaque.
      const d0 = Math.floor(x0 * k) / k;
      const d1 = Math.ceil(x1 * k) / k;
      back.save();
      back.beginPath();
      back.rect(d0, 0, d1 - d0, H);
      back.clip();
      drawSky(back, d0, d1, horizon);
      if (!occupied[pos]) drawPlain(back, x0, x1, plain);
      back.restore();
    }
    painted = [...occupied];
    paintedFor = key;
  };

  // ---- Moving layer -----------------------------------------------------------------------------

  const trackOf = (key: string): Track => {
    let t = tracks.get(key);
    if (!t) {
      t = { cam: Number.NaN, emitAt: 0, run: -1, phase: "", phaseT: 0, seen: frameNo };
      tracks.set(key, t);
    }
    t.seen = frameNo;
    return t;
  };

  /** The ship's view this frame, with its camera eased towards the craft. */
  const viewOf = (ship: ShipView, count: number, tr: Track, dt: number, out: ColumnView) => {
    const l = ship.layout;
    const s = viewScale(l, count, W, H);
    const target = cameraFor(l, ship.pose.x, W / Math.max(1, count), s);
    tr.cam = Number.isNaN(tr.cam) ? target : tr.cam + (target - tr.cam) * Math.min(1, dt * FOLLOW);
    return columnView(l, ship.pos, count, W, H, tr.cam, out);
  };

  const drawTerrain = (c: CanvasRenderingContext2D, ship: ShipView, v: ColumnView) => {
    const t = ship.terrain;
    const l = ship.layout;
    const n = t.xs.length;
    const S = l.craft * v.s;
    const top = viewY(v, l.ground.top);
    if (top !== groundGradTop || !groundGrad) {
      groundGrad = groundFill(c, top);
      groundGradTop = top;
    }
    c.fillStyle = groundGrad;
    if (n < 2) {
      c.fillRect(v.col0, top, v.colW, H - top);
      return;
    }
    // Only the vertices in view, with one either side.
    const xl = (v.col0 - v.x0) / v.s;
    const xr = (v.col0 + v.colW - v.x0) / v.s;
    let i0 = 0;
    while (i0 < n - 1 && t.xs[i0 + 1]! < xl) i0++;
    let i1 = n - 1;
    while (i1 > 0 && t.xs[i1 - 1]! > xr) i1--;
    const line = (dy: number) => {
      for (let i = i0; i <= i1; i++) {
        const x = viewX(v, t.xs[i]!);
        const y = viewY(v, t.ys[i]!) + dy;
        if (i === i0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
    };
    c.beginPath();
    c.moveTo(viewX(v, t.xs[i0]!), H);
    for (let i = i0; i <= i1; i++) c.lineTo(viewX(v, t.xs[i]!), viewY(v, t.ys[i]!));
    c.lineTo(viewX(v, t.xs[i1]!), H);
    c.closePath();
    c.fill();
    c.save();
    c.clip();
    c.strokeStyle = "rgba(20,12,40,0.35)";
    for (const [off, w] of [
      [0.38, 0.05],
      [0.85, 0.04],
      [1.5, 0.035],
    ] as const) {
      c.lineWidth = w * S;
      c.beginPath();
      line(off * S);
      c.stroke();
    }
    c.restore();
    c.strokeStyle = "#a998ea";
    c.lineWidth = 0.035 * S;
    c.lineJoin = "round";
    c.beginPath();
    line(0);
    c.stroke();

    for (const p of t.pads) {
      const x0 = viewX(v, p.x0);
      const x1 = viewX(v, p.x1);
      if (x1 < v.col0 || x0 > v.col0 + v.colW) continue;
      const y = viewY(v, p.y);
      const w = x1 - x0;
      c.fillStyle = "#2b2252";
      c.strokeStyle = "#7d6cc4";
      c.lineWidth = 0.02 * S;
      roundRect(c, x0 + 0.04 * S, y, w - 0.08 * S, 0.4 * S, 0.04 * S);
      c.fill();
      c.stroke();
      c.fillStyle = "#e9eef7";
      roundRect(c, x0, y - 0.02 * S, w, 0.08 * S, 0.03 * S);
      c.fill();
      c.fillStyle = withAlpha(ship.color, 0.95);
      c.fillRect(x0 + 0.02 * S, y + 0.035 * S, w - 0.04 * S, 0.025 * S);
      const r = 0.1 * S;
      const gap = 0.26 * S;
      for (let i = 0; i < p.stars; i++) {
        const sx = (x0 + x1) / 2 + (i - (p.stars - 1) / 2) * gap;
        c.fillStyle = "#ffcc33";
        c.strokeStyle = "#3a2a00";
        c.lineWidth = 0.015 * S;
        star(c, sx, y + 0.24 * S, r);
        c.fill();
        c.stroke();
      }
    }
  };

  const groundAt = (ship: ShipView, v: ColumnView, X: number) =>
    viewY(v, heightAt(ship.terrain, (X - v.x0) / v.s));

  const puff = (x: number, y: number, S: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const a = Math.PI + (i / (count - 1)) * Math.PI;
      const sp = (0.5 + Math.random() * 0.7) * S;
      particles.spawn(
        "dust",
        x,
        y,
        Math.cos(a) * sp,
        Math.sin(a) * sp * 0.5,
        1.2 + Math.random() * 0.6,
        0.12 * S,
      );
    }
  };

  /** Dust and sparks when a phase begins, as the frame shows them. */
  const events = (ship: ShipView, v: ColumnView, tr: Track, X: number, Y: number) => {
    const p = ship.pose;
    const S = ship.layout.craft * v.s;
    if (tr.run === p.run && tr.phase !== p.phase) {
      if (p.phase === "landed") {
        const gy = Y + FOOT.y * S;
        for (let i = 0; i < 12; i++) {
          const side = i % 2 ? 1 : -1;
          const sp = (0.4 + Math.random() * 0.6) * S;
          particles.spawn("dust", X + side * 0.3 * S, gy, side * sp, -0.08 * S, 0.9, 0.08 * S);
        }
        for (let i = 0; i < 8 + 8 * p.stars; i++) {
          const a = -Math.PI * Math.random();
          const sp = (0.6 + Math.random()) * S;
          const life = 1 + Math.random() * 0.5;
          const vy = Math.sin(a) * sp - 0.4 * S;
          particles.spawn("spark", X, Y - 0.5 * S, Math.cos(a) * sp, vy, life, 0.07 * S);
        }
      } else if (p.phase === "bumped") {
        puff(X, Y + 0.4 * S, S, 16);
      }
    }
    if (tr.run === p.run && p.phase === "bumped" && tr.phaseT < 1.15 && p.phaseT >= 1.15) {
      puff(X, groundAt(ship, v, X), S, 10);
    }
    tr.run = p.run;
    tr.phase = p.phase;
    tr.phaseT = p.phaseT;
  };

  /** Exhaust smoke at the nozzles and dust where the flames reach the ground. */
  const exhaust = (ship: ShipView, v: ColumnView, tr: Track, X: number, Y: number, dt: number) => {
    const p = ship.pose;
    tr.emitAt += dt;
    const sputter = (p.flags & SHIP_FLAG.sputter) !== 0;
    const engines = p.flags & (FLAG.left | FLAG.right | FLAG.main);
    if (!engines && !sputter) return;
    if (tr.emitAt < (sputter ? 0.12 : 0.05)) return;
    tr.emitAt = 0;
    const S = ship.layout.craft * v.s;
    const duo = ship.layout.variant === "duo";
    const cos = Math.cos(p.a);
    const sin = Math.sin(p.a);
    const nozzle = (lx: number, ly: number) => {
      const x = X + (cos * lx - sin * ly) * S;
      const y = Y + (sin * lx + cos * ly) * S;
      const sp = sputter ? 0.25 * S : 0.9 * S;
      const life = sputter ? 0.7 : 0.55;
      const size = (sputter ? 0.07 : 0.05) * S;
      const vx = p.vx * v.s - sin * sp + (Math.random() - 0.5) * 0.3 * S;
      particles.spawn("smoke", x, y, vx, p.vy * v.s + cos * sp, life, size);
      if (sputter) return;
      const ground = groundAt(ship, v, x);
      const gap = ground - y;
      if (gap > 0 && gap < 1.4 * S) {
        const strength = 1 - gap / (1.4 * S);
        const r = 0.07 * S * (0.6 + strength);
        for (const side of [-1, 1]) {
          const vx = side * (0.6 + strength) * S;
          particles.spawn("dust", x, ground - 0.03 * S, vx, -0.1 * S, 0.8, r);
        }
      }
    };
    if (sputter) {
      if (duo) {
        nozzle(-ENGINE.x, ENGINE.y + 0.1);
        nozzle(ENGINE.x, ENGINE.y + 0.1);
      } else nozzle(MAIN.x, MAIN.y + 0.1);
      return;
    }
    if (p.flags & FLAG.left) nozzle(-ENGINE.x, ENGINE.y + 0.35);
    if (p.flags & FLAG.right) nozzle(ENGINE.x, ENGINE.y + 0.35);
    if (p.flags & FLAG.main) nozzle(MAIN.x, MAIN.y + 0.45);
  };

  const drawPadLights = (ship: ShipView, v: ColumnView, time: number) => {
    if (!g) return;
    const p = ship.pose;
    const S = ship.layout.craft * v.s;
    const pads = ship.terrain.pads;
    let landedOn = -1;
    if (p.phase === "landed") {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i]!;
        const d = Math.max(0, pad.x0 - p.x, p.x - pad.x1);
        if (d < best) {
          best = d;
          landedOn = i;
        }
      }
    }
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i]!;
      const lit = landedOn === i;
      const on = lit ? 0.5 + 0.5 * Math.sin(time * 9) : 0.5 + 0.5 * Math.sin(time * 4 + pad.x0);
      const y = viewY(v, pad.y) - 0.06 * S;
      g.globalAlpha = (0.35 + 0.65 * on) * (p.attract ? 0.7 : 1);
      g.fillStyle = lit ? "#9dffb0" : "#ffcc33";
      for (const x of [viewX(v, pad.x0) + 0.05 * S, viewX(v, pad.x1) - 0.05 * S]) {
        g.beginPath();
        g.arc(x, y, 0.035 * S, 0, TAU);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  };

  const drawCelebration = (ship: ShipView, S: number, X: number, Y: number, alpha: number) => {
    if (!g) return;
    const p = ship.pose;
    const t = p.phaseT;
    if (p.phase === "landed") {
      for (let i = 0; i < p.stars; i++) {
        const local = t - 0.2 - i * 0.18;
        if (local <= 0) continue;
        const pop = local < 0.35 ? (local / 0.35) * 1.2 : 1.2 - Math.min(0.2, (local - 0.35) * 0.8);
        const fade = t > 3.2 ? Math.max(0, 1 - (t - 3.2) / 0.6) : 1;
        // A little larger than on the frame, to read from across the room.
        const sx = X + (i - (p.stars - 1) / 2) * 0.66 * S;
        const sy = Y - 1.05 * S - Math.sin(Math.min(1, local / 0.5) * Math.PI) * 0.14 * S;
        g.globalAlpha = fade * alpha;
        g.fillStyle = "#ffcc33";
        g.strokeStyle = "#ffffff";
        g.lineWidth = 0.035 * S;
        star(g, sx, sy, 0.28 * S * pop);
        g.fill();
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }
    if (p.phase !== "bumped" || t < 0.9 || t > 3.9) return;
    const fade = Math.min(1, (t - 0.9) / 0.3) * Math.min(1, (3.9 - t) / 0.4);
    for (let i = 0; i < 3; i++) {
      const a = t * 3.2 + (i * TAU) / 3;
      g.globalAlpha = fade * (0.6 + 0.4 * Math.sin(a)) * alpha;
      g.fillStyle = "#ffe07a";
      star(g, X + Math.cos(a) * 0.32 * S, Y - 0.45 * S + Math.sin(a) * 0.1 * S, 0.07 * S);
      g.fill();
    }
    g.globalAlpha = 1;
  };

  const drawMotes = (ship: ShipView, v: ColumnView, dt: number, time: number) => {
    if (!g) return;
    const w = ship.pose.wind;
    if (Math.abs(w) < 0.5) return;
    const l = ship.layout;
    let list = motes.get(ship.pos);
    if (!list) {
      if (motes.size >= MAX_KEYS) return;
      const rng = createRng(`${seed}:motes:${ship.pos}`);
      list = Array.from({ length: MOTES }, () => ({
        x: rng.range(0, l.width),
        y: rng.range(l.spawnY + l.drop * 0.3, l.ground.bottom),
        phase: rng.range(0, TAU),
      }));
      motes.set(ship.pos, list);
    }
    const S = l.craft * v.s;
    g.strokeStyle = "#d9cdf5";
    g.lineCap = "round";
    g.lineWidth = 0.045 * S;
    for (const m of list) {
      m.x += (w * 1.6 + Math.sin(time * 0.7 + m.phase) * 4) * dt;
      if (m.x < 0) m.x += l.width;
      if (m.x > l.width) m.x -= l.width;
      const X = viewX(v, m.x);
      const Y = viewY(v, m.y) + Math.sin(time * 1.3 + m.phase) * 0.12 * S;
      g.globalAlpha = (0.34 + 0.16 * Math.sin(time + m.phase)) * (ship.pose.attract ? 0.6 : 1);
      g.beginPath();
      g.moveTo(X, Y);
      g.lineTo(X - w * 1.6 * v.s, Y);
      g.stroke();
    }
    g.globalAlpha = 1;
  };

  const clipTo = (c: CanvasRenderingContext2D, v: ColumnView) => {
    c.beginPath();
    c.rect(v.col0 + GAP, bandTop, v.colW - 2 * GAP, H - bandTop);
    c.clip();
  };

  const drawShip = (ship: ShipView, count: number, time: number, dt: number) => {
    if (!g) return;
    const tr = trackOf(ship.key);
    const v = viewOf(ship, count, tr, dt, view);
    const p = ship.pose;
    const S = ship.layout.craft * v.s;
    const duo = ship.layout.variant === "duo";
    const alpha = p.attract ? ATTRACT_ALPHA : 1;
    g.save();
    clipTo(g, v);
    drawTerrain(g, ship, v);
    drawMotes(ship, v, dt, time);
    drawPadLights(ship, v, time);
    if (p.ghost && p.galpha > 0) {
      g.save();
      g.translate(viewX(v, p.gx), viewY(v, p.gy));
      g.rotate(p.ga);
      g.scale(S, S);
      setFlames(p.gf, 0.5, false);
      drawFlames(g, flames, duo, true, time);
      g.globalAlpha = 0.6 * p.galpha * alpha;
      drawGhost(g, ship.color);
      g.restore();
      g.globalAlpha = 1;
    }
    const X = viewX(v, p.x);
    const Y = viewY(v, p.y);
    events(ship, v, tr, X, Y);
    exhaust(ship, v, tr, X, Y, dt);
    drawCelebration(ship, S, X, Y, alpha);
    if (p.phase === "flying" && p.phaseT < ENTRY_S) {
      // The frame's top edge is mid-sky up here, so a new run drops in on a short streak.
      const f = p.phaseT / ENTRY_S;
      const trail = g.createLinearGradient(X, Y - 4 * S, X, Y);
      trail.addColorStop(0, withAlpha(ship.color, 0));
      trail.addColorStop(1, withAlpha(ship.color, 0.55 * (1 - f) * alpha));
      g.strokeStyle = trail;
      g.lineCap = "round";
      g.lineWidth = 0.35 * S;
      g.beginPath();
      g.moveTo(X, Y - 4 * S * (1 - 0.5 * f));
      g.lineTo(X, Y - 0.2 * S);
      g.stroke();
    }
    g.translate(X, Y);
    if (!p.attract) {
      // A wide glow in the crew's colour marks a craft someone is flying.
      const glow = g.createRadialGradient(0, 0, 0.2 * S, 0, 0, 1.25 * S);
      glow.addColorStop(0, withAlpha(ship.color, 0.3));
      glow.addColorStop(1, withAlpha(ship.color, 0));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(0, 0, 1.25 * S, 0, TAU);
      g.fill();
    }
    g.rotate(p.a);
    g.scale(S, S);
    const sputter = (p.flags & SHIP_FLAG.sputter) !== 0;
    if (sputter && Math.sin(time * 23 + ship.pos) > 0.82) {
      // A stutter of flame as the empty engines cough.
      setFlames(duo ? FLAG.left | FLAG.right : FLAG.main, 0.3, false);
      g.scale(1, 0.4);
      drawFlames(g, flames, duo, true, time);
      g.scale(1, 2.5);
    } else {
      setFlames(p.flags, 1, true);
      // Flames set their own alpha, so a faint craft gets the ghost's fainter flames.
      drawFlames(g, flames, duo, p.attract, time);
    }
    g.globalAlpha = alpha;
    drawCraft(g, ship.color, duo);
    g.restore();
  };

  /** The front canvas covers only the band where crafts can be. */
  const placeBand = (ships: readonly ShipView[], count: number) => {
    let top = ships.length ? H : 0;
    for (const sh of ships) {
      const l = sh.layout;
      const v = columnView(l, sh.pos, count, W, H, 0, other);
      top = Math.min(top, viewY(v, l.ceiling) - 1.5 * l.craft * v.s);
    }
    top = Math.max(0, Math.floor(top));
    if (top === bandTop) return;
    bandTop = top;
    frontCanvas.style.top = `${(bandTop / H) * 100}%`;
    frontCanvas.style.height = `${((H - bandTop) / H) * 100}%`;
    frontCanvas.height = Math.max(1, Math.round((H - bandTop) * k));
  };

  return {
    setup(frame) {
      W = frame.width / frame.unit;
      H = frame.height / frame.unit;
      k = frame.unit * frame.pixelRatio;
      backCanvas.width = Math.max(1, Math.round(frame.width * frame.pixelRatio));
      backCanvas.height = Math.max(1, Math.round(frame.height * frame.pixelRatio));
      frontCanvas.width = backCanvas.width;
      bandTop = -1;
      paintedFor = "";
      painted = [];
      groundGrad = null;
      particles.clear();
    },
    draw(ships, count, time, dt) {
      if (!g) return;
      frameNo++;
      const n = Math.max(1, count);
      paint(ships, n);
      placeBand(ships, n);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
      g.setTransform(k, 0, 0, k, 0, -bandTop * k);
      particles.update(dt);
      for (const sh of ships) drawShip(sh, n, time, dt);
      particles.draw(g);
      if (tracks.size > MAX_KEYS || frameNo % 600 === 0) {
        for (const [key, t] of tracks) if (frameNo - t.seen > 120) tracks.delete(key);
      }
    },
    place(ship, count) {
      const n = Math.max(1, count);
      const s = viewScale(ship.layout, n, W, H);
      const tr = tracks.get(ship.key);
      const cam =
        tr && !Number.isNaN(tr.cam) ? tr.cam : cameraFor(ship.layout, ship.pose.x, W / n, s);
      const v = columnView(ship.layout, ship.pos, n, W, H, cam, other);
      return { x: viewX(v, ship.pose.x), y: viewY(v, ship.pose.y), s: v.s };
    },
    clear() {
      particles.clear();
    },
    get particles() {
      return particles.live;
    },
    dispose() {
      backCanvas.remove();
      frontCanvas.remove();
      tracks.clear();
      motes.clear();
    },
  };
};
