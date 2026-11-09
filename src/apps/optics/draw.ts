/**
 * Canvas drawings of the bench's parts, in venue px. Glass is a cool tint with bright edges,
 * mirrors a silver face on a dark back, crystals faceted gems whose shape says their colour
 * (white round, red triangle, green diamond, blue hexagon) for colour-blind visitors.
 */
import type { PieceKind } from "./pieces";
import { STEP, lensFace, prismCorners, SKY_SCALE, shapeOf } from "./pieces";
import type { Crystal, Lamp } from "./puzzle";
import { BAND_COLOURS, type Band, type ColourBand, LASER_BITS, maskColour } from "./spectrum";
import type { Seg } from "./trace";

type G = CanvasRenderingContext2D;

export const INK = {
  bench: "#070b14",
  benchEdge: "#101a2e",
  socket: "rgba(140,170,220,0.22)",
  socketChild: "rgba(255,210,140,0.2)",
  tray: "rgba(120,150,200,0.07)",
  trayEdge: "rgba(150,180,230,0.22)",
  glassFill: "rgba(150,210,255,0.16)",
  glassEdge: "rgba(205,236,255,0.92)",
  silver: "#e8eef7",
  back: "#2a3140",
  ring: "rgba(170,200,255,",
  disc: "rgba(20,30,52,0.82)",
} as const;

const withA = (hex: string, a: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** The dark disc a placed piece sits on. */
export const drawDisc = (g: G, x: number, y: number, r: number, alpha = 1) => {
  g.save();
  g.globalAlpha = alpha;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = INK.disc;
  g.fill();
  g.lineWidth = r * 0.035;
  g.strokeStyle = "rgba(150,180,240,0.35)";
  g.stroke();
  g.restore();
};

const roundRect = (g: G, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
};

/** A piece at (x, y), turned `turn` detents, sized by radius `r`. */
export const drawPiece = (
  g: G,
  kind: PieceKind | "block" | "sky",
  x: number,
  y: number,
  turn: number,
  r: number,
  opts: { band?: ColourBand; alpha?: number } = {},
) => {
  const sh = shapeOf(r);
  g.save();
  g.globalAlpha = opts.alpha ?? 1;
  g.translate(x, y);
  g.rotate(turn * STEP);
  g.lineJoin = "round";
  switch (kind) {
    case "mirror": {
      const h = sh.half;
      const t = r * 0.15;
      roundRect(g, -h, 0, 2 * h, t, t * 0.4);
      g.fillStyle = INK.back;
      g.fill();
      // Hatching on the dark back, so it reads as the side that doesn't reflect.
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.lineWidth = r * 0.02;
      for (let k = -h + t; k < h; k += t * 0.9) {
        g.beginPath();
        g.moveTo(k, t);
        g.lineTo(k + t * 0.7, 0);
        g.stroke();
      }
      const grad = g.createLinearGradient(-h, 0, h, 0);
      grad.addColorStop(0, "#9fb0c8");
      grad.addColorStop(0.45, "#ffffff");
      grad.addColorStop(1, "#aebdd4");
      roundRect(g, -h, -r * 0.07, 2 * h, r * 0.09, r * 0.04);
      g.fillStyle = grad;
      g.fill();
      break;
    }
    case "filter": {
      const h = sh.half;
      const c = BAND_COLOURS[opts.band ?? "r"];
      roundRect(g, -h, -r * 0.07, 2 * h, r * 0.14, r * 0.05);
      g.fillStyle = withA(c, 0.55);
      g.fill();
      g.lineWidth = r * 0.03;
      g.strokeStyle = withA(c, 0.95);
      g.stroke();
      break;
    }
    case "splitter":
    case "sky": {
      const h = sh.half * (kind === "sky" ? SKY_SCALE : 1);
      roundRect(g, -h, -r * 0.05, 2 * h, r * 0.1, r * 0.04);
      g.fillStyle = "rgba(170,225,255,0.28)";
      g.fill();
      g.lineWidth = r * 0.025;
      g.strokeStyle = INK.glassEdge;
      g.stroke();
      // Half-silvered: a broken silver line down the middle.
      g.setLineDash([r * 0.08, r * 0.07]);
      g.strokeStyle = INK.silver;
      g.lineWidth = r * 0.035;
      g.beginPath();
      g.moveTo(-h * 0.92, 0);
      g.lineTo(h * 0.92, 0);
      g.stroke();
      g.setLineDash([]);
      if (kind === "sky") {
        // Fixed in place: bolts at both ends.
        for (const s of [-1, 1]) {
          g.beginPath();
          g.arc(s * (h + r * 0.1), 0, r * 0.09, 0, Math.PI * 2);
          g.fillStyle = "#56627a";
          g.fill();
          g.lineWidth = r * 0.02;
          g.strokeStyle = "#9aa8c2";
          g.stroke();
        }
      }
      break;
    }
    case "prism": {
      const pts = prismCorners(r);
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.closePath();
      g.fillStyle = INK.glassFill;
      g.fill();
      g.lineWidth = r * 0.035;
      g.strokeStyle = INK.glassEdge;
      g.stroke();
      g.beginPath();
      const [a, b] = [pts[0]!, pts[2]!];
      g.moveTo(a[0] * 0.7, a[1] * 0.7);
      g.lineTo(b[0] * 0.7, b[1] * 0.7);
      g.strokeStyle = "rgba(255,255,255,0.35)";
      g.lineWidth = r * 0.02;
      g.stroke();
      break;
    }
    case "convex":
    case "concave": {
      const { radius, angle } = lensFace(sh.lensHalf, sh.lensSag);
      g.beginPath();
      if (kind === "convex") {
        const off = radius - sh.lensSag;
        g.arc(off, 0, radius, Math.PI - angle, Math.PI + angle);
        g.arc(-off, 0, radius, -angle, angle);
      } else {
        const w = sh.waist;
        const e = w + sh.lensSag;
        g.moveTo(-e, -sh.lensHalf);
        g.lineTo(e, -sh.lensHalf);
        g.arc(w + radius, 0, radius, Math.PI + angle, Math.PI - angle, true);
        g.lineTo(-e, sh.lensHalf);
        g.arc(-w - radius, 0, radius, angle, -angle, true);
      }
      g.closePath();
      g.fillStyle = INK.glassFill;
      g.fill();
      g.lineWidth = r * 0.035;
      g.strokeStyle = INK.glassEdge;
      g.stroke();
      break;
    }
    case "block": {
      const h = sh.block;
      roundRect(g, -h, -h, 2 * h, 2 * h, h * 0.18);
      const grad = g.createLinearGradient(-h, -h, h, h);
      grad.addColorStop(0, "#3a3f4c");
      grad.addColorStop(1, "#16191f");
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = r * 0.03;
      g.strokeStyle = "#5b6274";
      g.stroke();
      break;
    }
  }
  g.restore();
};

/** The rotation ring around a placed piece, with its knob at the piece's turn. */
export const drawRing = (
  g: G,
  x: number,
  y: number,
  ring: number,
  knob: number,
  turn: number,
  bright: number,
) => {
  g.save();
  g.lineWidth = Math.max(2, ring * 0.035);
  g.strokeStyle = `${INK.ring}${0.16 + 0.34 * bright})`;
  g.beginPath();
  g.arc(x, y, ring, 0, Math.PI * 2);
  g.stroke();
  if (bright > 0.05) {
    // Detent ticks.
    g.lineWidth = Math.max(1.5, ring * 0.016);
    g.strokeStyle = `${INK.ring}${0.4 * bright})`;
    g.beginPath();
    for (let k = 0; k < 24; k++) {
      const a = k * STEP;
      g.moveTo(x + Math.cos(a) * ring * 0.93, y + Math.sin(a) * ring * 0.93);
      g.lineTo(x + Math.cos(a) * ring * 1.0, y + Math.sin(a) * ring * 1.0);
    }
    g.stroke();
  }
  const a = turn * STEP - Math.PI / 2;
  const kx = x + Math.cos(a) * ring;
  const ky = y + Math.sin(a) * ring;
  g.beginPath();
  g.arc(kx, ky, knob, 0, Math.PI * 2);
  g.fillStyle = `rgba(20,32,60,${0.55 + 0.3 * bright})`;
  g.fill();
  g.lineWidth = knob * 0.12;
  g.strokeStyle = `${INK.ring}${0.35 + 0.55 * bright})`;
  g.stroke();
  // Curved arrows on the knob: it turns both ways.
  g.lineWidth = knob * 0.11;
  g.lineCap = "round";
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(kx, ky, knob * 0.5, a + s * 0.5, a + s * 1.9, s < 0);
    g.stroke();
  }
  g.restore();
};

const gemPath = (g: G, band: Band, x: number, y: number, r: number) => {
  const poly = (n: number, rot: number) => {
    g.beginPath();
    for (let k = 0; k < n; k++) {
      const a = rot + (k * Math.PI * 2) / n;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (k) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.closePath();
  };
  switch (band) {
    case "w":
      poly(8, Math.PI / 8);
      break;
    case "r":
      poly(3, -Math.PI / 2);
      break;
    case "g":
      poly(4, 0);
      break;
    case "b":
      poly(6, 0);
      break;
  }
};

/** A crystal; `shown` is 0 when dark, about 0.4 lit by guide light, 1 lit by real light. */
export const drawCrystal = (g: G, c: Crystal, shown: number, t: number, scale = 1) => {
  const col = BAND_COLOURS[c.band];
  const r = c.r * (c.band === "r" ? 1.25 : 1.05) * scale;
  g.save();
  if (shown > 0.01) {
    // Bright halo; slow shimmer so lit crystals look alive without flashing.
    const pulse = 1 + 0.06 * Math.sin(t / 700 + c.x * 0.01);
    const halo = r * (2.2 + 1.6 * shown) * pulse;
    const grad = g.createRadialGradient(c.x, c.y, r * 0.3, c.x, c.y, halo);
    grad.addColorStop(0, withA(col, 0.55 * shown));
    grad.addColorStop(1, withA(col, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c.x, c.y, halo, 0, Math.PI * 2);
    g.fill();
  }
  gemPath(g, c.band, c.x, c.y, r);
  const fill = g.createRadialGradient(c.x - r * 0.3, c.y - r * 0.3, r * 0.1, c.x, c.y, r);
  fill.addColorStop(0, withA(col, 0.25 + 0.75 * shown));
  fill.addColorStop(1, withA(col, 0.1 + 0.55 * shown));
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = Math.max(1.5, r * 0.09);
  g.strokeStyle = withA(col, 0.55 + 0.45 * shown);
  g.stroke();
  // Facets.
  g.lineWidth = Math.max(1, r * 0.04);
  g.strokeStyle = `rgba(255,255,255,${0.15 + 0.5 * shown})`;
  gemPath(g, c.band, c.x, c.y, r * 0.5);
  g.stroke();
  if (c.small) {
    // A target ring: the lens has to bring the light together here.
    g.setLineDash([r * 0.5, r * 0.4]);
    g.lineWidth = Math.max(1.5, r * 0.1);
    g.strokeStyle = withA(col, 0.35 + 0.4 * shown);
    g.beginPath();
    g.arc(c.x, c.y, r * 2.1, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  g.restore();
};

/** A lamp's housing behind its aperture, lit in the colour of its light. */
export const drawLamp = (g: G, l: Lamp, size: number, bundle: number) => {
  const col =
    l.kind === "laser"
      ? maskColour(LASER_BITS[l.band ?? "r"])
      : l.kind === "wide"
        ? "#fff6d8"
        : "#ffffff";
  g.save();
  g.translate(l.x, l.y);
  g.rotate(l.angle);
  const len = size * 0.9;
  const half = l.kind === "wide" ? Math.max(size * 0.36, bundle * 2.6) : size * 0.36;
  const grad = g.createLinearGradient(0, -half, 0, half);
  grad.addColorStop(0, "#3b4458");
  grad.addColorStop(0.5, "#5a657e");
  grad.addColorStop(1, "#2a3142");
  roundRect(g, -len, -half, len - size * 0.1, 2 * half, size * 0.14);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = size * 0.04;
  g.strokeStyle = "#8d9bb8";
  g.stroke();
  // Fins.
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = size * 0.035;
  for (let k = 1; k <= 3; k++) {
    const fx = -len + (k * (len - size * 0.1)) / 4.2;
    g.beginPath();
    g.moveTo(fx, -half * 0.7);
    g.lineTo(fx, half * 0.7);
    g.stroke();
  }
  const ap = l.kind === "wide" ? half * 0.86 : size * 0.16;
  const glow = g.createRadialGradient(-size * 0.1, 0, 0, -size * 0.1, 0, size * 0.6 + ap);
  glow.addColorStop(0, withA(col.startsWith("#") ? col : "#ffffff", 0.7));
  glow.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glow;
  g.beginPath();
  g.arc(-size * 0.1, 0, size * 0.6 + ap, -Math.PI / 2, Math.PI / 2);
  g.fill();
  roundRect(g, -size * 0.16, -ap, size * 0.1, 2 * ap, size * 0.04);
  g.fillStyle = col;
  g.fill();
  g.restore();
};

/** Glowing beams: a wide soft stroke under a thin bright core, added together. */
export const drawBeams = (g: G, segs: readonly Seg[], width: number) => {
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  const passes = [
    { w: width * 7, a: 0.07 },
    { w: width * 3.2, a: 0.16 },
    { w: width, a: 0.9 },
  ];
  for (const pass of passes) {
    for (const s of segs) {
      const k = Math.min(1, Math.sqrt(s.level));
      const a = pass.a * k * (s.guide ? 0.4 : 1);
      if (a < 0.01) continue;
      if (s.guide && pass.w === width) g.setLineDash([width * 4, width * 4]);
      g.strokeStyle = maskColour(s.bits);
      g.globalAlpha = a;
      g.lineWidth = pass.w;
      g.beginPath();
      g.moveTo(s.x0, s.y0);
      g.lineTo(s.x1, s.y1);
      g.stroke();
      if (s.guide && pass.w === width) g.setLineDash([]);
    }
  }
  g.restore();
};

/** A soft ghost fingertip where the attract hand or a bot is touching. */
export const drawHand = (g: G, x: number, y: number, r: number) => {
  g.save();
  const grad = g.createRadialGradient(x, y, 0, x, y, r * 1.6);
  grad.addColorStop(0, "rgba(255,255,255,0.45)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r * 1.6, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = r * 0.12;
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.beginPath();
  g.arc(x, y, r * 0.55, 0, Math.PI * 2);
  g.stroke();
  g.restore();
};

/** A row of small progress lamps: `on` lit, the next one gently pulsing. */
export const drawProgress = (
  g: G,
  box: { x: number; y: number; width: number; height: number },
  n: number,
  on: (i: number) => number,
  current: number,
  t: number,
) => {
  if (n <= 0) return;
  const r = Math.min(box.height * 0.32, box.width / (n * 2.6));
  const gap = Math.min(box.width / n, r * 3.2);
  const x0 = box.x + box.width / 2 - (gap * (n - 1)) / 2;
  const y = box.y + box.height / 2;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * gap;
    const v = on(i);
    const pulse = i === current ? 0.5 + 0.5 * Math.sin(t / 420) : 0;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = v > 0 ? `rgba(255,214,110,${0.35 + 0.65 * v})` : "rgba(70,86,120,0.45)";
    g.fill();
    if (v > 0) {
      const grad = g.createRadialGradient(x, y, r * 0.5, x, y, r * 2.6);
      grad.addColorStop(0, `rgba(255,214,110,${0.35 * v})`);
      grad.addColorStop(1, "rgba(255,214,110,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r * 2.6, 0, Math.PI * 2);
      g.fill();
    }
    g.lineWidth = Math.max(1.5, r * 0.18);
    g.strokeStyle = `rgba(255,224,150,${0.25 + 0.5 * pulse})`;
    g.beginPath();
    g.arc(x, y, r * (1 + 0.25 * pulse), 0, Math.PI * 2);
    g.stroke();
  }
};
