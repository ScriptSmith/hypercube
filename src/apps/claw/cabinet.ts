/**
 * Drawing one cabinet in strip px. The parts that never change go into the strip's background
 * once; each frame draws the claw and prizes behind the glass, the glass itself, and the lights,
 * joystick, button and prize door. Coordinates: the body's left edge at x = 0 and the marquee's
 * top at y = 0; the physics floor at `box.floorY`.
 */
import type { Rng } from "../../core/types";
import type { DesignId } from "./designs";
import type { CabinetBox } from "./layout";
import type { Machine } from "./machine";
import { blitSprite, type SpriteSet } from "./plush";
import type { Theme } from "./themes";
import { CHUTE, FILLET, FINGER, HEAD, HINGE } from "./world";

type G = CanvasRenderingContext2D;

export const FONT = 'ui-rounded, "Segoe UI Rounded", "Segoe UI", system-ui, sans-serif';
const BULB_SPACING = 0.034;
const CHASE_STEPS = 6;
const WIN_FLASH_S = 3;
const SPARKLES = 14;

export interface LiveState {
  now: number;
  /** How open the prize door is. */
  door: number;
}

export interface CabinetArt {
  readonly box: CabinetBox;
  /** The door's middle and half size, px from the cabinet's origin. */
  readonly door: { x: number; y: number; hw: number; hh: number };
  drawStatic(g: G, x: number, y: number): void;
  drawLive(g: G, x: number, y: number, s: LiveState): void;
  dispose(): void;
}

/**
 * Everything below the glass, drawn by someone else: the wall's control panel and prize hatch
 * in place of the sphere's ledge, base and door. Cabinet px, as the rest.
 */
export interface CabinetFront {
  drawStatic(g: G): void;
  drawLive(g: G, now: number): void;
}

export interface CabinetArtOptions {
  theme: Theme;
  box: CabinetBox;
  machine: Machine;
  sprites: SpriteSet;
  mix: readonly DesignId[];
  colours: (d: DesignId) => number;
  rng: Rng;
  front?: CabinetFront;
  /**
   * Paint the glass's reflections each frame rather than keeping them in a picture of the
   * glass's size: cheaper on the GPU when there are several large cabinets.
   */
  glassLive?: boolean;
}

export const canvas2d = (w: number, h: number): [HTMLCanvasElement, G | null] => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext("2d")];
};

export const vertical = (g: G, y0: number, y1: number, stops: readonly [number, string][]) => {
  const grad = g.createLinearGradient(0, y0, 0, y1);
  for (const [k, c] of stops) grad.addColorStop(k, c);
  return grad;
};

export const horizontal = (g: G, x0: number, x1: number, stops: readonly [number, string][]) => {
  const grad = g.createLinearGradient(x0, 0, x1, 0);
  for (const [k, c] of stops) grad.addColorStop(k, c);
  return grad;
};

export const starPath = (g: G, cx: number, cy: number, r: number, points = 5, inner = 0.45) => {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    const x = cx + rr * Math.cos(a);
    const y = cy + rr * Math.sin(a);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
};

export const heartPath = (g: G, cx: number, cy: number, r: number) => {
  g.beginPath();
  g.moveTo(cx, cy + r * 0.95);
  g.bezierCurveTo(
    cx - r * 0.4,
    cy + r * 0.6,
    cx - r * 1.05,
    cy + r * 0.15,
    cx - r * 0.95,
    cy - r * 0.3,
  );
  g.bezierCurveTo(cx - r * 0.85, cy - r * 0.85, cx - r * 0.2, cy - r * 0.9, cx, cy - r * 0.45);
  g.bezierCurveTo(
    cx + r * 0.2,
    cy - r * 0.9,
    cx + r * 0.85,
    cy - r * 0.85,
    cx + r * 0.95,
    cy - r * 0.3,
  );
  g.bezierCurveTo(cx + r * 1.05, cy + r * 0.15, cx + r * 0.4, cy + r * 0.6, cx, cy + r * 0.95);
  g.closePath();
};

/** A little claw: a head and three prongs. */
export const clawIcon = (g: G, cx: number, cy: number, r: number) => {
  g.beginPath();
  g.roundRect(cx - r * 0.42, cy - r * 0.85, r * 0.84, r * 0.55, r * 0.15);
  g.fill();
  g.lineWidth = r * 0.2;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(cx, cy - r * 1.2);
  g.lineTo(cx, cy - r * 0.85);
  for (const side of [-1, 1]) {
    g.moveTo(cx + side * r * 0.3, cy - r * 0.3);
    g.quadraticCurveTo(cx + side * r * 0.85, cy + r * 0.2, cx + side * r * 0.35, cy + r * 0.85);
  }
  g.moveTo(cx, cy - r * 0.3);
  g.lineTo(cx, cy + r * 0.75);
  g.stroke();
};

export const smileIcon = (g: G, cx: number, cy: number, r: number, ink: string, bg: string) => {
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = bg;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + side * r * 0.36, cy - r * 0.25, r * 0.12, r * 0.18, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = bg;
  g.lineWidth = r * 0.14;
  g.lineCap = "round";
  g.beginPath();
  g.arc(cx, cy + r * 0.05, r * 0.52, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  g.fillStyle = ink;
};

const bulbSprite = (r: number, color: string): HTMLCanvasElement => {
  const [c, g] = canvas2d(r * 6, r * 6);
  if (g) {
    const m = r * 3;
    const glow = g.createRadialGradient(m, m, 0, m, m, m);
    glow.addColorStop(0, color);
    glow.addColorStop(0.18, color);
    glow.addColorStop(0.3, "rgba(255,240,200,0.35)");
    glow.addColorStop(1, "rgba(255,220,160,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(m - r * 0.25, m - r * 0.25, r * 0.35, 0, Math.PI * 2);
    g.fill();
  }
  return c;
};

export const sparkleSprite = (r: number): HTMLCanvasElement => {
  const [c, g] = canvas2d(r * 2, r * 2);
  if (g) {
    g.fillStyle = "#ffffff";
    starPath(g, r, r, r, 4, 0.18);
    g.fill();
    const glow = g.createRadialGradient(r, r, 0, r, r, r * 0.6);
    glow.addColorStop(0, "rgba(255,255,255,0.9)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, c.width, c.height);
  }
  return c;
};

export const createCabinetArt = (o: CabinetArtOptions): CabinetArt => {
  const { theme, box, machine, sprites, front } = o;
  const w = machine.world;
  // Trim, lights and lettering follow `scale`, which is the cabinet's height on the sphere.
  const H = box.scale ?? box.height;
  const B = box.bodyW;
  const k = box.k;
  const gx = box.glass.x;
  const gy = box.glass.y;
  const gw = box.glass.w;
  const gh = box.glass.h;
  const fy = box.floorY;
  const X = (x: number) => gx + x * k;
  const Y = (y: number) => fy - y * k;
  const holeL = X(w.hole.x0);
  const holeR = X(w.hole.x1);
  const holeMid = (holeL + holeR) / 2;
  const door = {
    x: holeMid,
    y: 0.8 * H,
    hw: Math.min(0.44 * (holeR - holeL), 0.14 * H),
    hh: 0.062 * H,
  };
  const ledge = box.rows.ledge;
  const stickAt = { x: B * (machine.world.spec.chute > 0 ? 0.28 : 0.42), y: ledge[0] + 0.012 * H };
  const buttonAt = { x: B * (machine.world.spec.chute > 0 ? 0.58 : 0.72), y: ledge[0] + 0.014 * H };
  const timerAt = {
    x: B * (machine.world.spec.chute > 0 ? 0.43 : 0.57),
    y: (ledge[0] + ledge[1]) / 2,
  };

  // The sign's bulbs, round the inside of its frame.
  const mq = box.rows.marquee;
  const over = 0.035 * H;
  const bulbs: { x: number; y: number }[] = [];
  {
    const inset = 0.022 * H;
    const x0 = -over + inset;
    const x1 = B + over - inset;
    const y0 = mq[0] + inset;
    const y1 = mq[1] - inset;
    const step = BULB_SPACING * H;
    const across = Math.max(4, Math.round((x1 - x0) / step));
    const down = Math.max(2, Math.round((y1 - y0) / step));
    for (let i = 0; i < across; i++) bulbs.push({ x: x0 + ((x1 - x0) * i) / across, y: y0 });
    for (let i = 0; i < down; i++) bulbs.push({ x: x1, y: y0 + ((y1 - y0) * i) / down });
    for (let i = 0; i < across; i++) bulbs.push({ x: x1 - ((x1 - x0) * i) / across, y: y1 });
    for (let i = 0; i < down; i++) bulbs.push({ x: x0, y: y1 - ((y1 - y0) * i) / down });
  }
  const bulbR = Math.max(1, 0.0075 * H);
  const bulbOn = bulbSprite(bulbR, theme.bulb);
  const sparkle = sparkleSprite(Math.max(2, 0.03 * H));
  const sparkles = Array.from({ length: SPARKLES }, () => ({
    x: o.rng.range(-0.1, 1.1),
    y: o.rng.range(0, 1),
    delay: o.rng.range(0, 1.6),
    size: o.rng.range(0.5, 1),
    at: o.rng.next() < 0.5 ? ("chute" as const) : ("sign" as const),
  }));

  // The glass's front: reflections and the chute's clear box, in cabinet px.
  const paintGlassFront = (gf: G) => {
    const top = Y(CHUTE.guard);
    const cx0 = w.spec.chute > 0 ? X(w.hole.guardX) : X(0);
    const cx1 = w.spec.chute > 0 ? X(w.spec.width) : X(w.hole.guardX + CHUTE.wall);
    gf.fillStyle = "rgba(190,235,255,0.10)";
    gf.fillRect(cx0, top, cx1 - cx0, fy - top);
    gf.strokeStyle = "rgba(225,250,255,0.55)";
    gf.lineWidth = Math.max(1, 0.012 * k);
    gf.strokeRect(cx0, top, cx1 - cx0, fy - top);
    gf.fillStyle = "rgba(235,252,255,0.35)";
    const guardX = X(w.hole.guardX);
    gf.fillRect(guardX, top, CHUTE.wall * k, fy - top);
    gf.fillStyle = "rgba(255,255,255,0.5)";
    gf.fillRect(cx0, top, cx1 - cx0, Math.max(1, 0.02 * k));
    // Two broad reflections and a thin streak across the glass.
    gf.save();
    gf.beginPath();
    gf.rect(gx, gy, gw, gh);
    gf.clip();
    const band = (x: number, width: number, alpha: number) => {
      gf.save();
      gf.translate(gx + x * gw, gy);
      gf.transform(1, 0, -0.45, 1, 0, 0);
      const grad = horizontal(gf, 0, width * gw, [
        [0, "rgba(255,255,255,0)"],
        [0.5, `rgba(255,255,255,${alpha})`],
        [1, "rgba(255,255,255,0)"],
      ]);
      gf.fillStyle = grad;
      gf.fillRect(0, 0, width * gw, gh * 1.2);
      gf.restore();
    };
    band(0.25, 0.22, 0.075);
    band(0.55, 0.08, 0.06);
    band(0.82, 0.03, 0.12);
    // A soft shadow round the inside edge.
    const edge = 0.06 * gw;
    gf.fillStyle = horizontal(gf, gx, gx + edge, [
      [0, "rgba(0,0,0,0.35)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    gf.fillRect(gx, gy, edge, gh);
    gf.fillStyle = horizontal(gf, gx + gw - edge, gx + gw, [
      [0, "rgba(0,0,0,0)"],
      [1, "rgba(0,0,0,0.35)"],
    ]);
    gf.fillRect(gx + gw - edge, gy, edge, gh);
    gf.restore();
  };
  // Made once, unless it is painted live each frame.
  const [glassFront, gfc] = o.glassLive ? canvas2d(1, 1) : canvas2d(gw, gh);
  if (gfc && !o.glassLive) {
    gfc.translate(-gx, -gy);
    paintGlassFront(gfc);
  }

  /** The prizes stacked behind, too far back to reach: they make the machine look full. */
  const backPile = (() => {
    const out: { design: DesignId; colour: number; x: number; y: number; a: number; s: number }[] =
      [];
    const lo = w.spec.chute > 0 ? 0.25 : w.hole.x1 + 0.2;
    const hi = w.spec.chute > 0 ? w.hole.guardX - 0.2 : w.spec.width - 0.25;
    const n = Math.max(4, Math.round((hi - lo) * 3.2));
    for (let i = 0; i < n; i++) {
      const design = o.rng.pick(o.mix);
      out.push({
        design,
        colour: o.colours(design),
        x: lo + ((hi - lo) * (i + o.rng.range(0.1, 0.9))) / n,
        y: o.rng.range(0.25, 0.75) + (i % 2) * 0.12,
        a: o.rng.range(-0.7, 0.7),
        s: o.rng.range(0.78, 0.92),
      });
    }
    return out;
  })();

  const drawSign = (g: G) => {
    const x0 = -over;
    const x1 = B + over;
    const y0 = mq[0];
    const y1 = mq[1];
    const r = 0.035 * H;
    g.beginPath();
    g.roundRect(x0, y0, x1 - x0, y1 - y0, [r, r, r * 0.3, r * 0.3]);
    g.fillStyle = vertical(g, y0, y1, [
      [0, theme.light],
      [0.25, theme.body],
      [1, theme.dark],
    ]);
    g.fill();
    g.lineWidth = Math.max(1, 0.006 * H);
    g.strokeStyle = theme.trim;
    g.stroke();
    const inset = 0.04 * H;
    g.beginPath();
    g.roundRect(x0 + inset, y0 + inset, x1 - x0 - 2 * inset, y1 - y0 - 2 * inset, r * 0.6);
    g.fillStyle = vertical(g, y0 + inset, y1 - inset, [
      [0, theme.sign[0]],
      [1, theme.sign[1]],
    ]);
    g.fill();
    // Unlit bulb sockets.
    g.fillStyle = "rgba(40,20,30,0.75)";
    for (const b of bulbs) {
      g.beginPath();
      g.arc(b.x, b.y, bulbR * 1.15, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "rgba(255,240,220,0.22)";
    for (const b of bulbs) {
      g.beginPath();
      g.arc(b.x, b.y, bulbR * 0.8, 0, Math.PI * 2);
      g.fill();
    }
    // The word and an icon either side.
    const cy = (y0 + y1) / 2;
    const size = 0.07 * H;
    g.font = `800 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const textW = g.measureText(theme.word).width;
    g.lineJoin = "round";
    g.lineWidth = size * 0.16;
    g.strokeStyle = "rgba(20,8,30,0.85)";
    g.strokeText(theme.word, B / 2, cy + size * 0.04);
    g.fillStyle = theme.ink;
    g.shadowColor = theme.bulb;
    g.shadowBlur = size * 0.35;
    g.fillText(theme.word, B / 2, cy + size * 0.04);
    g.shadowBlur = 0;
    const ir = size * 0.42;
    for (const side of [-1, 1]) {
      const ix = B / 2 + side * (textW / 2 + ir * 1.9);
      g.fillStyle = theme.trim;
      g.strokeStyle = theme.trim;
      if (theme.icon === "star") {
        starPath(g, ix, cy, ir);
        g.fill();
      } else if (theme.icon === "heart") {
        heartPath(g, ix, cy, ir);
        g.fill();
      } else if (theme.icon === "smile") {
        smileIcon(g, ix, cy, ir, theme.trim, theme.sign[0]);
      } else {
        clawIcon(g, ix, cy, ir);
      }
    }
  };

  const drawGlassInside = (g: G) => {
    g.save();
    g.beginPath();
    g.rect(gx, gy, gw, gh);
    g.clip();
    g.fillStyle = vertical(g, gy, fy, [
      [0, theme.backdrop[0]],
      [1, theme.backdrop[1]],
    ]);
    g.fillRect(gx, gy, gw, gh);
    // A scatter of little stars on the back wall.
    const pr = o.rng.fork("pattern");
    g.fillStyle = theme.pattern;
    const count = Math.round((gw * gh) / (0.012 * H * H));
    for (let i = 0; i < count; i++) {
      starPath(
        g,
        gx + pr.next() * gw,
        gy + pr.next() * gh,
        (0.006 + 0.008 * pr.next()) * H,
        4,
        0.4,
      );
      g.fill();
    }
    // Lights in the roof.
    g.fillStyle = vertical(g, gy, gy + gh * 0.45, [
      [0, "rgba(255,255,240,0.32)"],
      [1, "rgba(255,255,240,0)"],
    ]);
    g.fillRect(gx, gy, gw, gh * 0.45);
    // The heaped prizes at the back, dimmed by distance.
    for (const p of backPile) {
      const s = sprites.get(p.design, p.colour);
      blitSprite(g, s, X(p.x), Y(p.y), p.a, p.s);
    }
    g.fillStyle = vertical(g, Y(1.1), fy, [
      [0, "rgba(16,8,32,0.35)"],
      [1, "rgba(16,8,32,0.6)"],
    ]);
    g.fillRect(gx, Y(1.1), gw, fy - Y(1.1));
    // The padded floor and its sloping corners.
    const fl0 = w.spec.chute > 0 ? X(0) : X(w.hole.x1 + CHUTE.wall);
    const fl1 = w.spec.chute > 0 ? X(w.hole.guardX) : X(w.spec.width);
    g.beginPath();
    g.moveTo(fl0, fy + 2);
    g.lineTo(fl0, Y(FILLET.h));
    g.lineTo(fl0 + FILLET.w * k, fy - 0.04 * k);
    g.lineTo(fl1 - FILLET.w * k, fy - 0.04 * k);
    g.lineTo(fl1, Y(FILLET.h));
    g.lineTo(fl1, fy + 2);
    g.closePath();
    g.fillStyle = vertical(g, Y(FILLET.h), fy, [
      [0, theme.dark],
      [1, "#140a1e"],
    ]);
    g.fill();
    // The chute's opening, dark beneath its clear walls.
    g.fillStyle = vertical(g, Y(CHUTE.guard), fy, [
      [0, "rgba(5,3,10,0)"],
      [1, "rgba(5,3,10,0.85)"],
    ]);
    g.fillRect(holeL, Y(CHUTE.guard), holeR - holeL, fy - Y(CHUTE.guard));
    // The gantry's rail.
    const ry = Y(w.railY);
    g.fillStyle = vertical(g, ry - 0.05 * k, ry + 0.05 * k, [
      [0, "#f2f4f8"],
      [0.5, "#9aa0ad"],
      [1, "#4b4f5c"],
    ]);
    g.fillRect(gx, ry - 0.045 * k, gw, 0.09 * k);
    g.restore();
  };

  const drawBody = (g: G) => {
    const pillar = gx;
    const can = box.rows.canopy;
    // Pillars, rounded by their shading.
    for (const [x0, x1] of [
      [0, pillar],
      [B - pillar, B],
    ] as const) {
      g.fillStyle = horizontal(g, x0, x1, [
        [0, theme.dark],
        [0.35, theme.body],
        [0.7, theme.light],
        [1, theme.body],
      ]);
      g.fillRect(x0, can[0], x1 - x0, ledge[0] - can[0]);
    }
    g.fillStyle = vertical(g, can[0], can[1], [
      [0, theme.dark],
      [0.6, theme.body],
      [1, theme.dark],
    ]);
    g.fillRect(0, can[0], B, can[1] - can[0]);
    g.fillStyle = theme.led;
    g.globalAlpha = 0.85;
    g.fillRect(gx, can[1] - 0.006 * H, gw, 0.006 * H);
    g.globalAlpha = 1;
    // Chrome round the glass.
    g.strokeStyle = "rgba(235,240,250,0.8)";
    g.lineWidth = Math.max(1, 0.006 * H);
    g.strokeRect(gx, gy, gw, gh);

    if (front) {
      front.drawStatic(g);
      return;
    }
    // The ledge with the controls, sticking out a little.
    const lo = 0.025 * H;
    g.fillStyle = vertical(g, ledge[0], ledge[0] + 0.02 * H, [
      [0, theme.light],
      [1, theme.body],
    ]);
    g.fillRect(-lo, ledge[0], B + 2 * lo, 0.02 * H);
    g.fillStyle = vertical(g, ledge[0] + 0.02 * H, ledge[1], [
      [0, theme.body],
      [1, theme.dark],
    ]);
    g.fillRect(-lo, ledge[0] + 0.02 * H, B + 2 * lo, ledge[1] - ledge[0] - 0.02 * H);
    g.fillStyle = theme.trim;
    g.fillRect(-lo, ledge[0] + 0.02 * H, B + 2 * lo, Math.max(1, 0.004 * H));
    // The joystick's plate and the button's ring.
    g.fillStyle = "#1c1826";
    g.beginPath();
    g.ellipse(stickAt.x, stickAt.y, 0.05 * H, 0.012 * H, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#d9dce6";
    g.beginPath();
    g.ellipse(buttonAt.x, buttonAt.y, 0.042 * H, 0.014 * H, 0, 0, Math.PI * 2);
    g.fill();
    // The timer's window.
    g.fillStyle = "#08060c";
    g.beginPath();
    g.roundRect(timerAt.x - 0.035 * H, timerAt.y - 0.02 * H, 0.07 * H, 0.04 * H, 0.006 * H);
    g.fill();

    // The base, with the prize door under the chute and the coin slot on the other side.
    const base = box.rows.base;
    g.fillStyle = horizontal(g, 0, B, [
      [0, theme.dark],
      [0.12, theme.body],
      [0.5, theme.light],
      [0.88, theme.body],
      [1, theme.dark],
    ]);
    g.fillRect(0, base[0], B, base[1] - base[0]);
    g.fillStyle = vertical(g, base[0], base[0] + 0.05 * H, [
      [0, "rgba(0,0,0,0.35)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    g.fillRect(0, base[0], B, 0.05 * H);
    g.fillStyle = theme.led;
    g.globalAlpha = 0.7;
    g.fillRect(0.02 * H, base[0] + 0.02 * H, 0.008 * H, base[1] - base[0] - 0.04 * H);
    g.fillRect(B - 0.028 * H, base[0] + 0.02 * H, 0.008 * H, base[1] - base[0] - 0.04 * H);
    g.globalAlpha = 1;
    g.fillStyle = theme.trim;
    g.beginPath();
    g.roundRect(
      door.x - door.hw * 1.14,
      door.y - door.hh * 1.2,
      door.hw * 2.28,
      door.hh * 2.4,
      0.01 * H,
    );
    g.fill();
    g.fillStyle = "#0a0710";
    g.fillRect(door.x - door.hw, door.y - door.hh, door.hw * 2, door.hh * 2);
    const coinX = w.spec.chute > 0 ? B * 0.3 : B * 0.7;
    g.fillStyle = vertical(g, door.y - 0.06 * H, door.y + 0.06 * H, [
      [0, "#e9ecf3"],
      [1, "#8d93a3"],
    ]);
    g.beginPath();
    g.roundRect(coinX - 0.035 * H, door.y - 0.06 * H, 0.07 * H, 0.12 * H, 0.01 * H);
    g.fill();
    g.fillStyle = "#15121c";
    g.fillRect(coinX - 0.004 * H, door.y - 0.035 * H, 0.008 * H, 0.03 * H);
    g.fillStyle = theme.led;
    g.beginPath();
    g.arc(coinX, door.y + 0.03 * H, 0.009 * H, 0, Math.PI * 2);
    g.fill();
    // A round badge with the cabinet's icon between the coin slot and the door.
    {
      const bx = (coinX + door.x) / 2;
      const r = Math.min(0.065 * H, Math.abs(door.x - coinX) / 2 - door.hw - 0.01 * H);
      if (r > 0.02 * H) {
        g.fillStyle = theme.trim;
        g.beginPath();
        g.arc(bx, door.y, r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = vertical(g, door.y - r, door.y + r, [
          [0, theme.sign[0]],
          [1, theme.sign[1]],
        ]);
        g.beginPath();
        g.arc(bx, door.y, r * 0.86, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = theme.trim;
        g.strokeStyle = theme.trim;
        const ir = r * 0.5;
        if (theme.icon === "star") {
          starPath(g, bx, door.y, ir);
          g.fill();
        } else if (theme.icon === "heart") {
          heartPath(g, bx, door.y, ir);
          g.fill();
        } else if (theme.icon === "smile") {
          smileIcon(g, bx, door.y, ir, theme.trim, theme.sign[0]);
        } else {
          clawIcon(g, bx, door.y + ir * 0.1, ir);
        }
      }
    }
    g.fillStyle = theme.trim;
    g.fillRect(0, base[0] + 0.012 * H, B, Math.max(1, 0.005 * H));
    // The kick plate.
    const pl = box.rows.plinth;
    g.fillStyle = vertical(g, pl[0], pl[1], [
      [0, "#2a2436"],
      [1, "#08060c"],
    ]);
    g.fillRect(-0.01 * H, pl[0], B + 0.02 * H, pl[1] - pl[0]);
  };

  const drawClaw = (g: G) => {
    const head = w.head;
    const hp = head.getPosition();
    const ha = head.getAngle();
    const tp = w.trolley.getPosition();
    const top = head.getWorldPoint({ x: 0, y: HEAD.hh });
    // The cable, then the trolley on its rail.
    g.strokeStyle = "#c9ced8";
    g.lineWidth = Math.max(1, 0.025 * k);
    g.beginPath();
    g.moveTo(X(tp.x), Y(tp.y));
    g.lineTo(X(top.x), Y(top.y));
    g.stroke();
    const tw = 0.42 * k;
    const th = 0.16 * k;
    g.fillStyle = vertical(g, Y(tp.y) - th / 2, Y(tp.y) + th / 2, [
      [0, "#f4f5f8"],
      [1, "#6d7384"],
    ]);
    g.beginPath();
    g.roundRect(X(tp.x) - tw / 2, Y(tp.y) - th / 2, tw, th, th * 0.3);
    g.fill();
    g.fillStyle = theme.trim;
    g.fillRect(X(tp.x) - tw / 2, Y(tp.y) - th * 0.08, tw, th * 0.16);

    // Fingers: thick round bars from the hinge to the knee to the tip.
    const open = w.openness();
    const metal = (g2: G, x0: number, x1: number) =>
      horizontal(g2, x0, x1, [
        [0, "#8a7a4a"],
        [0.45, "#ffe9a8"],
        [1, "#a8904c"],
      ]);
    // The third prong, behind, pointing at whoever is watching: shorter the wider it opens.
    {
      const p0 = head.getWorldPoint({ x: 0, y: -HEAD.hh * 0.6 });
      const len = (0.46 - 0.24 * open) * k;
      const x = X(p0.x);
      const y = Y(p0.y);
      g.lineCap = "round";
      g.lineWidth = 2 * FINGER.thick * k;
      g.strokeStyle = "#7a6a3c";
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.sin(ha) * len, y + Math.cos(ha) * len);
      g.stroke();
    }
    for (const f of w.fingers) {
      const side = f === w.fingers[0] ? -1 : 1;
      const a = f.getWorldPoint({ x: 0, y: 0 });
      const b = f.getWorldPoint({ x: FINGER.knee[0] * side, y: FINGER.knee[1] });
      const c = f.getWorldPoint({ x: FINGER.tip[0] * side, y: FINGER.tip[1] });
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = 2 * FINGER.thick * k + Math.max(1, 0.012 * k);
      g.strokeStyle = "#4a3e22";
      g.beginPath();
      g.moveTo(X(a.x), Y(a.y));
      g.lineTo(X(b.x), Y(b.y));
      g.lineTo(X(c.x), Y(c.y));
      g.stroke();
      g.lineWidth = 2 * FINGER.thick * k;
      g.strokeStyle = metal(g, X(Math.min(a.x, c.x)) - 4, X(Math.max(a.x, c.x)) + 4);
      g.stroke();
    }
    // The head over the hinges.
    g.save();
    g.translate(X(hp.x), Y(hp.y));
    g.rotate(-ha);
    const hw = HEAD.hw * k;
    const hh = HEAD.hh * k;
    g.fillStyle = horizontal(g, -hw, hw, [
      [0, "#7c8394"],
      [0.4, "#f6f7fb"],
      [1, "#5d6373"],
    ]);
    g.beginPath();
    g.roundRect(-hw, -hh, 2 * hw, 2 * hh, hh * 0.35);
    g.fill();
    g.fillStyle = theme.trim;
    g.fillRect(-hw, -hh * 0.15, 2 * hw, hh * 0.3);
    g.fillStyle = "#d9dde6";
    g.beginPath();
    g.roundRect(-hw * 0.55, -hh * 1.45, hw * 1.1, hh * 0.5, hh * 0.2);
    g.fill();
    for (const side of [-1, 1]) {
      g.fillStyle = "#3b3f4b";
      g.beginPath();
      g.arc(side * HINGE.x * k, -HINGE.y * k, 0.03 * k, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  };

  const drawPrizes = (g: G) => {
    for (const p of w.prizes) {
      const pos = p.body.getPosition();
      const s = sprites.get(p.design, p.colour);
      blitSprite(g, s, X(pos.x), Y(pos.y), -p.body.getAngle());
    }
  };

  /** Lights: a chase while idle, a quicker one in play, alternate flashes after a win. */
  const drawBulbs = (g: G, now: number) => {
    const sinceWin = machine.sinceWin;
    const winning = sinceWin < WIN_FLASH_S;
    const rate = machine.phase === "idle" ? 0.5 : 1;
    const step = Math.floor(now * CHASE_STEPS * rate);
    const n = bulbs.length;
    const size = bulbOn.width;
    for (let i = 0; i < n; i++) {
      let on: number;
      if (winning) on = (i + Math.floor(sinceWin * 4)) % 2 ? 1 : 0.15;
      else on = (i + step) % 3 === 0 ? 1 : 0.12;
      if (on < 0.05) continue;
      g.globalAlpha = on;
      g.drawImage(bulbOn, bulbs[i]!.x - size / 2, bulbs[i]!.y - size / 2);
    }
    g.globalAlpha = 1;
  };

  const drawControls = (g: G, now: number) => {
    // The joystick leans with the player's hand.
    const lean = machine.stickShown * 0.38;
    const len = 0.055 * H;
    const tx = stickAt.x + Math.sin(lean) * len;
    const ty = stickAt.y - Math.cos(lean) * len;
    g.lineCap = "round";
    g.strokeStyle = "#2c2a34";
    g.lineWidth = Math.max(1, 0.012 * H);
    g.beginPath();
    g.moveTo(stickAt.x, stickAt.y);
    g.lineTo(tx, ty);
    g.stroke();
    const r = 0.02 * H;
    const knob = g.createRadialGradient(tx - r * 0.35, ty - r * 0.35, r * 0.1, tx, ty, r);
    knob.addColorStop(0, "#ffffff");
    knob.addColorStop(0.3, theme.knob);
    knob.addColorStop(1, "#1a1424");
    g.fillStyle = knob;
    g.beginPath();
    g.arc(tx, ty, r, 0, Math.PI * 2);
    g.fill();
    // The button glows while there is a game on, brightest as it is pressed.
    const phase = machine.phase;
    const pressed = phase === "drop" && machine.phaseT < 0.35;
    const glow =
      phase === "play" ? 0.55 + 0.35 * Math.sin(now * Math.PI * 2 * 0.8) : pressed ? 1 : 0.25;
    g.fillStyle = theme.led;
    g.globalAlpha = 0.4 + 0.6 * glow;
    g.beginPath();
    g.ellipse(
      buttonAt.x,
      buttonAt.y - (pressed ? 0 : 0.004 * H),
      0.032 * H,
      0.011 * H,
      0,
      0,
      Math.PI * 2,
    );
    g.fill();
    if (glow > 0.5) {
      g.globalAlpha = (glow - 0.5) * 0.8;
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.ellipse(
        buttonAt.x - 0.008 * H,
        buttonAt.y - 0.006 * H,
        0.012 * H,
        0.004 * H,
        0,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
    g.globalAlpha = 1;
    // Seconds left while someone plays.
    if (phase === "play") {
      g.fillStyle = "#ffb44a";
      g.font = `700 ${0.032 * H}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(
        String(Math.ceil(machine.timeLeft)).padStart(2, "0"),
        timerAt.x,
        timerAt.y + 0.002 * H,
      );
    }
  };

  const drawDoor = (g: G, open: number) => {
    if (open <= 0.001) {
      // Shut: a hinged flap with a push plate.
      g.fillStyle = vertical(g, door.y - door.hh, door.y + door.hh, [
        [0, "#3a3446"],
        [1, "#17131f"],
      ]);
      g.fillRect(door.x - door.hw, door.y - door.hh, door.hw * 2, door.hh * 2);
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.fillRect(door.x - door.hw * 0.5, door.y - door.hh * 0.15, door.hw, door.hh * 0.3);
      return;
    }
    // Swinging up and out, so it looks shorter as it opens.
    const hh = door.hh * 2 * (1 - 0.85 * open);
    g.fillStyle = vertical(g, door.y - door.hh, door.y - door.hh + hh, [
      [0, "#5a536a"],
      [1, "#2a2434"],
    ]);
    g.fillRect(door.x - door.hw, door.y - door.hh, door.hw * 2, hh);
  };

  const drawSparkles = (g: G, now: number) => {
    const since = machine.sinceWin;
    if (since > 2.6) return;
    const size = sparkle.width;
    for (const s of sparkles) {
      const t = (since - s.delay * 0.5) / 1.1;
      if (t < 0 || t > 1) continue;
      const a = Math.sin(Math.PI * t);
      const cx = s.at === "chute" ? holeMid + (s.x - 0.5) * (holeR - holeL) * 1.4 : s.x * B;
      const cy = s.at === "chute" ? Y(CHUTE.guard * (0.3 + s.y)) : mq[0] + s.y * (mq[1] - mq[0]);
      g.globalAlpha = a;
      const sz = size * s.size * (0.6 + 0.4 * a);
      g.save();
      g.translate(cx, cy);
      g.rotate(now * 1.5 + s.delay);
      g.drawImage(sparkle, -sz / 2, -sz / 2, sz, sz);
      g.restore();
    }
    g.globalAlpha = 1;
  };

  return {
    box,
    door,
    drawStatic(g, x, y) {
      g.save();
      g.translate(x, y);
      // A soft shadow on the wall behind.
      g.save();
      g.shadowColor = "rgba(0,0,0,0.6)";
      g.shadowBlur = 0.05 * H;
      g.fillStyle = "#000";
      g.fillRect(0.01 * H, 0.03 * H, B - 0.02 * H, box.height - 0.03 * H);
      g.restore();
      drawGlassInside(g);
      drawBody(g);
      drawSign(g);
      if (!front) drawDoor(g, 0);
      g.restore();
    },
    drawLive(g, x, y, s) {
      g.save();
      g.translate(x, y);
      g.save();
      g.beginPath();
      g.rect(gx, gy, gw, gh);
      g.clip();
      drawPrizes(g);
      drawClaw(g);
      g.restore();
      if (o.glassLive) paintGlassFront(g);
      else g.drawImage(glassFront, gx, gy);
      drawBulbs(g, s.now);
      if (front) front.drawLive(g, s.now);
      else drawControls(g, s.now);
      if (!front && s.door > 0.001) {
        g.fillStyle = "#0a0710";
        g.fillRect(door.x - door.hw, door.y - door.hh, door.hw * 2, door.hh * 2);
        drawDoor(g, s.door);
      }
      drawSparkles(g, s.now);
      g.restore();
    },
    dispose() {
      glassFront.width = glassFront.height = 0;
      bulbOn.width = bulbOn.height = 0;
      sparkle.width = sparkle.height = 0;
    },
  };
};
