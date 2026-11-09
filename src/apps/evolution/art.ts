/**
 * Drawing pieces, all in venue px. Floors and fish markings follow the same rules from the same
 * six genes, so a fish whose genes match its floor really does vanish into it: spots are dots of
 * the marking colour (with a few light grains), stripes are bars across the body or stems across
 * the floor, and the scale gene sets their size.
 *
 * Floors are drawn once as square tiles that repeat seamlessly; fish bodies are drawn once per
 * fish into a small sprite. The heron is calm and stylised: a pale neck, a soft grey head with a
 * round eye and a long beak, and no harm shown.
 */
import { createRng } from "../../core/rng";
import { FLOOR_GENES, type FloorId, type Look, lookOf } from "./genes";

type Ctx = CanvasRenderingContext2D;

/** Floor tile size, venue px. */
export const TILE = 360;

export const FLOOR_LOOK: Record<FloorId, Look> = {
  sand: lookOf(FLOOR_GENES.sand),
  weed: lookOf(FLOOR_GENES.weed),
  mud: lookOf(FLOOR_GENES.mud),
  pebbles: lookOf(FLOOR_GENES.pebbles),
};

export const FLOOR_TITLE: Record<FloorId, string> = {
  sand: "Sand",
  weed: "Weed",
  mud: "Mud",
  pebbles: "Pebbles",
};

/** How markings are drawn for a look. */
export interface Marks {
  dotR: number;
  /** Dots per square venue px. */
  dots: number;
  dotAlpha: number;
  gap: number;
  barW: number;
  barAlpha: number;
}

export const marksOf = (look: Look): Marks => {
  const dotR = look.size * 0.62;
  const cover = 0.55 * look.spots;
  return {
    dotR,
    dots: cover / (Math.PI * dotR * dotR),
    dotAlpha: 0.35 + 0.55 * look.spots,
    gap: look.size * 2.3,
    barW: look.size * 2.3 * 0.42,
    barAlpha: 0.9 * look.stripes,
  };
};

const makeCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

/** Draw `fn` at (x, y) and again shifted by the tile size wherever it might cross an edge. */
const wrapDraw = (x: number, y: number, r: number, fn: (x: number, y: number) => void) => {
  for (const dx of [-TILE, 0, TILE]) {
    for (const dy of [-TILE, 0, TILE]) {
      const px = x + dx;
      const py = y + dy;
      if (px + r < 0 || px - r > TILE || py + r < 0 || py - r > TILE) continue;
      fn(px, py);
    }
  }
};

/** One repeating floor tile, drawn at `k` canvas px per venue px. */
export const floorTile = (floor: FloorId, k: number): HTMLCanvasElement => {
  const c = makeCanvas(TILE * k, TILE * k);
  const g = c.getContext("2d");
  if (!g) return c;
  g.scale(c.width / TILE, c.height / TILE);
  const look = FLOOR_LOOK[floor];
  const m = marksOf(look);
  const rng = createRng(`evolution:floor:${floor}`);
  g.fillStyle = look.body;
  g.fillRect(0, 0, TILE, TILE);
  // Soft unevenness, so a floor never looks flat.
  for (let i = 0; i < 26; i++) {
    const x = rng.next() * TILE;
    const y = rng.next() * TILE;
    const r = 30 + rng.next() * 70;
    const light = rng.next() < 0.5;
    wrapDraw(x, y, r, (px, py) => {
      const grad = g.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, light ? look.light : look.mark);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = floor === "mud" ? 0.16 : 0.09;
      g.fillStyle = grad;
      g.fillRect(px - r, py - r, 2 * r, 2 * r);
    });
  }
  g.globalAlpha = 1;
  if (floor === "sand") {
    // Ripples: faint wavy bands.
    g.strokeStyle = look.light;
    g.lineWidth = 7;
    g.globalAlpha = 0.18;
    for (let row = 0; row < 8; row++) {
      const y0 = (row + 0.5) * (TILE / 8);
      g.beginPath();
      for (let x = -10; x <= TILE + 10; x += 10) {
        const y = y0 + Math.sin((x / TILE) * Math.PI * 4 + row) * 6;
        if (x === -10) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  if (m.barAlpha > 0.02) {
    // Stems: wavy vertical bars at the stripe spacing, a few lighter.
    const n = Math.max(1, Math.round(TILE / m.gap));
    const gap = TILE / n;
    for (let i = 0; i < n; i++) {
      const x0 = (i + 0.5) * gap + (rng.next() - 0.5) * gap * 0.3;
      const phase = rng.next() * 6.28;
      g.strokeStyle = rng.next() < 0.25 ? look.light : look.mark;
      g.globalAlpha = m.barAlpha * (0.7 + 0.3 * rng.next());
      g.lineWidth = m.barW * (0.75 + 0.5 * rng.next());
      g.lineCap = "round";
      for (const dx of [-TILE, 0, TILE]) {
        g.beginPath();
        for (let y = -10; y <= TILE + 10; y += 12) {
          // A whole number of waves per tile, so stems join across the edge.
          const x = x0 + dx + Math.sin((y / TILE) * Math.PI * 2 * 2 + phase) * gap * 0.18;
          if (y === -10) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }
  if (m.dots > 0) {
    const count = Math.round(m.dots * TILE * TILE);
    for (let i = 0; i < count; i++) {
      const x = rng.next() * TILE;
      const y = rng.next() * TILE;
      const r = m.dotR * (0.65 + 0.7 * rng.next());
      const light = rng.next() < (floor === "pebbles" ? 0.4 : 0.22);
      g.fillStyle = light ? look.light : look.mark;
      g.globalAlpha = m.dotAlpha * (0.7 + 0.3 * rng.next());
      const sq = floor === "pebbles" ? 0.75 + rng.next() * 0.25 : 1;
      const rot = rng.next() * Math.PI;
      wrapDraw(x, y, r, (px, py) => {
        g.beginPath();
        g.ellipse(px, py, r, r * sq, rot, 0, Math.PI * 2);
        g.fill();
      });
    }
    g.globalAlpha = 1;
  }
  return c;
};

// ---- Fish ----------------------------------------------------------------------------------

/** Body width as a share of length. */
export const BODY_W = 0.36;

/** The body outline, nose at +x, centred on the origin. */
const bodyPath = (g: Ctx, len: number) => {
  const w = len * BODY_W;
  const hx = len * 0.5;
  g.beginPath();
  g.moveTo(hx, 0);
  g.bezierCurveTo(hx, -w * 0.55, hx * 0.15, -w * 0.62, -hx * 0.35, -w * 0.42);
  g.quadraticCurveTo(-hx * 0.92, -w * 0.12, -hx * 0.95, 0);
  g.quadraticCurveTo(-hx * 0.92, w * 0.12, -hx * 0.35, w * 0.42);
  g.bezierCurveTo(hx * 0.15, w * 0.62, hx, w * 0.55, hx, 0);
  g.closePath();
};

/**
 * A fish's body with its markings, nose to the right, into a new canvas at `k` px per venue px.
 * The sprite is `len` * 1.1 by `len` * BODY_W * 1.3 venue px, centred.
 */
export const fishSprite = (look: Look, len: number, k: number, seed: number): HTMLCanvasElement => {
  const sw = len * 1.1;
  const sh = len * BODY_W * 1.3;
  const c = makeCanvas(sw * k, sh * k);
  const g = c.getContext("2d");
  if (!g) return c;
  g.scale(c.width / sw, c.height / sh);
  g.translate(sw / 2, sh / 2);
  bodyPath(g, len);
  g.fillStyle = look.body;
  g.fill();
  g.save();
  bodyPath(g, len);
  g.clip();
  const m = marksOf(look);
  const rng = createRng(`evolution:fish:${seed}`);
  if (m.barAlpha > 0.02) {
    g.strokeStyle = look.mark;
    g.globalAlpha = m.barAlpha;
    g.lineWidth = m.barW;
    const n = Math.ceil(len / m.gap) + 1;
    const off = rng.next() * m.gap;
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + off + i * m.gap;
      g.beginPath();
      g.moveTo(x, -len);
      g.lineTo(x + len * 0.06, len);
      g.stroke();
    }
  }
  if (m.dots > 0) {
    const area = len * len * BODY_W * 0.8;
    const count = Math.round(m.dots * area * 1.15);
    for (let i = 0; i < count; i++) {
      const x = (rng.next() - 0.5) * len;
      const y = (rng.next() - 0.5) * len * BODY_W;
      const r = m.dotR * (0.65 + 0.7 * rng.next());
      g.fillStyle = rng.next() < 0.22 ? look.light : look.mark;
      g.globalAlpha = m.dotAlpha * (0.7 + 0.3 * rng.next());
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
  // Eyes: small and low-key, so markings rather than eyes decide how well it hides.
  g.globalAlpha = 0.55;
  g.fillStyle = look.mark;
  const w = len * BODY_W;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(len * 0.3, s * w * 0.24, len * 0.035, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return c;
};

/** Tail fin, drawn per frame so it can sway. At the origin of a fish pointing +x. */
export const drawTail = (g: Ctx, look: Look, len: number, sway: number) => {
  const base = -len * 0.44;
  const tip = -len * 0.72;
  const spread = len * 0.2;
  g.beginPath();
  g.moveTo(base, 0);
  g.quadraticCurveTo(base - len * 0.1, sway * len * 0.08, tip, -spread + sway * len * 0.12);
  g.quadraticCurveTo(tip + len * 0.08, sway * len * 0.12, tip, spread + sway * len * 0.12);
  g.quadraticCurveTo(base - len * 0.1, sway * len * 0.08, base, 0);
  g.fillStyle = look.mark;
  g.globalAlpha *= 0.85;
  g.fill();
};

/** A whole fish (sprite plus tail) at (x, y) facing `heading`. */
export const drawFish = (
  g: Ctx,
  sprite: HTMLCanvasElement,
  look: Look,
  len: number,
  x: number,
  y: number,
  heading: number,
  sway: number,
  alpha = 1,
) => {
  g.save();
  g.translate(x, y);
  g.rotate(heading);
  g.globalAlpha = alpha;
  drawTail(g, look, len, sway);
  g.globalAlpha = alpha;
  const sw = len * 1.1;
  const sh = len * BODY_W * 1.3;
  g.drawImage(sprite, -sw / 2, -sh / 2, sw, sh);
  g.restore();
};

// ---- Heron ---------------------------------------------------------------------------------

const HERON = {
  body: "#8d9cad",
  wing: "#71829a",
  plume: "#66778c",
  chest: "#d6dde4",
  neck: "#e6ebef",
  neckEdge: "#97a3b0",
  head: "#d0d7de",
  crest: "#4f5a68",
  beak: "#e6a85a",
  eye: "#1d2430",
};

/** Where a heron standing at `base` holds its head at rest: just past its chest, over the water. */
export const heronRest = (base: { x: number; y: number }, face: number, s: number) => ({
  x: base.x + face * s * 1.05,
  y: base.y + s * 0.45,
});

/**
 * A heron standing in the reeds at `base`, facing `face` (1 right, -1 left), leaning its neck out
 * to its head at `head`, the beak pointing along `dir` (radians) and open by `open` (0 to 1).
 * `s` is its size (about a head's length, venue px). Calm colours, a round eye, no harm shown.
 */
export const drawHeron = (
  g: Ctx,
  base: { x: number; y: number },
  head: { x: number; y: number },
  dir: number,
  open: number,
  s: number,
  alpha = 1,
  face = head.x >= base.x ? 1 : -1,
) => {
  g.save();
  g.globalAlpha = alpha;
  g.lineCap = "round";
  // Body, tail plumes and folded wing.
  g.save();
  g.translate(base.x, base.y);
  g.scale(face, 1);
  g.fillStyle = HERON.plume;
  g.beginPath();
  g.moveTo(-s * 0.35, -s * 0.12);
  g.quadraticCurveTo(-s * 1.15, -s * 0.1, -s * 1.35, s * 0.3);
  g.quadraticCurveTo(-s * 0.85, s * 0.28, -s * 0.2, s * 0.22);
  g.closePath();
  g.fill();
  g.fillStyle = HERON.body;
  g.beginPath();
  g.ellipse(0, 0, s * 0.9, s * 0.5, -0.12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = HERON.wing;
  g.beginPath();
  g.ellipse(-s * 0.22, -s * 0.04, s * 0.62, s * 0.3, -0.18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = HERON.chest;
  g.beginPath();
  g.ellipse(s * 0.58, -s * 0.1, s * 0.32, s * 0.34, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // Neck: rises from the chest and curves over to the head.
  const nx = base.x + face * s * 0.62;
  const ny = base.y - s * 0.3;
  const back = { x: head.x - Math.cos(dir) * s * 0.45, y: head.y - Math.sin(dir) * s * 0.45 };
  const reach = Math.hypot(back.x - nx, back.y - ny);
  const lift = s * (0.6 + Math.min(0.6, reach / (s * 8)));
  g.beginPath();
  g.moveTo(nx, ny);
  g.bezierCurveTo(
    nx + face * s * 0.15,
    ny - lift,
    back.x - Math.cos(dir) * s * 0.9,
    back.y - Math.sin(dir) * s * 0.9 - s * 0.3,
    back.x,
    back.y,
  );
  g.strokeStyle = HERON.neckEdge;
  g.lineWidth = s * 0.4;
  g.stroke();
  g.strokeStyle = HERON.neck;
  g.lineWidth = s * 0.3;
  g.stroke();
  // Head.
  g.translate(head.x, head.y);
  g.rotate(dir);
  const bx = -s * 0.25;
  g.fillStyle = HERON.head;
  g.beginPath();
  g.ellipse(bx, 0, s * 0.42, s * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  // Crest: a soft dark stripe back from the eye.
  g.strokeStyle = HERON.crest;
  g.lineWidth = s * 0.08;
  g.beginPath();
  g.moveTo(bx + s * 0.05, -s * 0.12);
  g.quadraticCurveTo(bx - s * 0.4, -s * 0.2, bx - s * 0.75, -s * 0.05);
  g.stroke();
  // Beak: two halves, opening a little.
  const a = 0.06 + 0.22 * open;
  g.fillStyle = HERON.beak;
  for (const sgn of [-1, 1]) {
    g.save();
    g.rotate(sgn * a * 0.5);
    g.beginPath();
    g.moveTo(bx + s * 0.25, sgn * s * 0.02);
    g.lineTo(bx + s * 1.25, 0);
    g.lineTo(bx + s * 0.25, sgn * s * 0.13);
    g.closePath();
    g.fill();
    g.restore();
  }
  // Eye: round and friendly.
  const up = Math.cos(dir) < 0 ? 1 : -1;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(bx + s * 0.08, up * s * 0.07, s * 0.085, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = HERON.eye;
  g.beginPath();
  g.arc(bx + s * 0.1, up * s * 0.07, s * 0.05, 0, Math.PI * 2);
  g.fill();
  g.restore();
};

// ---- Reeds ---------------------------------------------------------------------------------

/** The reed strip along a pond's top edge. */
export const drawRim = (g: Ctx, x: number, y: number, w: number, h: number, seed: number) => {
  const rng = createRng(`evolution:rim:${seed}`);
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, "#22301f");
  grad.addColorStop(1, "#2f4129");
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.lineCap = "round";
  const n = Math.floor(w / 9);
  for (let i = 0; i < n; i++) {
    const rx = x + (i + rng.next()) * (w / n);
    const top = y + h * (0.05 + rng.next() * 0.5);
    const lean = (rng.next() - 0.5) * 16;
    g.strokeStyle = rng.next() < 0.3 ? "#6f8a4c" : rng.next() < 0.5 ? "#4d6a38" : "#3b5530";
    g.lineWidth = 3 + rng.next() * 3;
    g.beginPath();
    g.moveTo(rx, y + h + 4);
    g.quadraticCurveTo(rx + lean * 0.3, (top + y + h) / 2, rx + lean, top);
    g.stroke();
  }
  // A soft shadow onto the water.
  const sh = g.createLinearGradient(0, y + h, 0, y + h + 26);
  sh.addColorStop(0, "rgba(5,10,8,0.45)");
  sh.addColorStop(1, "rgba(5,10,8,0)");
  g.fillStyle = sh;
  g.fillRect(x, y + h, w, 26);
};

// ---- Controls ------------------------------------------------------------------------------

/** A pictogram for the switch: a parent fish and its young, alike (small) or varied (big). */
export const drawBrood = (
  g: Ctx,
  cx: number,
  cy: number,
  s: number,
  big: boolean,
  alpha: number,
) => {
  const parent = lookOf([0.6, 0.45, 0.5, 0.3, 0, 0.3]);
  const young = big
    ? [
        lookOf([0.2, 0.15, 0.7, 0, 0.8, 0.4]),
        lookOf([0.9, 0.6, 0.2, 0.8, 0, 0.7]),
        lookOf([0.45, 0.9, 0.9, 0.2, 0, 0.2]),
      ]
    : [
        lookOf([0.62, 0.47, 0.5, 0.3, 0, 0.3]),
        lookOf([0.58, 0.44, 0.52, 0.32, 0, 0.3]),
        lookOf([0.6, 0.46, 0.48, 0.28, 0, 0.3]),
      ];
  g.save();
  g.globalAlpha = alpha;
  const one = (look: Look, x: number, y: number, len: number) => {
    g.save();
    g.translate(x, y);
    drawTail(g, look, len, 0);
    g.globalAlpha = alpha;
    bodyPath(g, len);
    g.fillStyle = look.body;
    g.fill();
    if (look.stripes > 0.3) {
      g.save();
      bodyPath(g, len);
      g.clip();
      g.strokeStyle = look.mark;
      g.lineWidth = len * 0.08;
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(i * len * 0.2, -len);
        g.lineTo(i * len * 0.2, len);
        g.stroke();
      }
      g.restore();
    }
    if (look.spots > 0.3) {
      g.fillStyle = look.mark;
      for (const [dx, dy] of [
        [-0.15, -0.05],
        [0.1, 0.06],
        [0.25, -0.07],
      ] as const) {
        g.beginPath();
        g.arc(dx * len, dy * len, len * 0.06, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  };
  one(parent, cx - s * 0.42, cy, s * 0.62);
  // An arrow from parent to young.
  g.strokeStyle = "rgba(242,245,250,0.7)";
  g.lineWidth = s * 0.05;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(cx - s * 0.06, cy);
  g.lineTo(cx + s * 0.1, cy);
  g.moveTo(cx + s * 0.04, cy - s * 0.06);
  g.lineTo(cx + s * 0.1, cy);
  g.lineTo(cx + s * 0.04, cy + s * 0.06);
  g.stroke();
  young.forEach((look, i) => one(look, cx + s * 0.38, cy + (i - 1) * s * 0.2, s * 0.32));
  g.restore();
};

/** A pointing hand, fingertip at (x, y), for hints. */
export const drawHand = (g: Ctx, x: number, y: number, s: number, alpha: number) => {
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.fillStyle = "#f2f5fa";
  g.strokeStyle = "rgba(5,7,13,0.7)";
  g.lineWidth = s * 0.05;
  g.beginPath();
  g.roundRect(-s * 0.1, 0, s * 0.2, s * 0.55, s * 0.1);
  g.fill();
  g.stroke();
  g.beginPath();
  g.roundRect(-s * 0.32, s * 0.38, s * 0.64, s * 0.55, s * 0.2);
  g.fill();
  g.stroke();
  g.restore();
};
