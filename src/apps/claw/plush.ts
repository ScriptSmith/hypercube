/**
 * The plush prizes drawn in Canvas2D: soft shading, a darker outline, a stitched seam and a simple
 * sewn face. Each is drawn once per size into a sprite and reused.
 */
import { type Colourway, type Design, type DesignId, DESIGNS } from "./designs";

type G = CanvasRenderingContext2D;

const INK = "#21152b";
const BLUSH = "rgba(255,110,150,0.42)";
const LINE = 0.016;

const shade = (g: G, c: Colourway, cx: number, cy: number, r: number, main = c.main) => {
  // The light comes from above and a little to the left (y is up here).
  const grad = g.createRadialGradient(cx - 0.35 * r, cy + 0.4 * r, 0.05 * r, cx, cy, 1.25 * r);
  grad.addColorStop(0, c.light);
  grad.addColorStop(0.55, main);
  grad.addColorStop(1, c.dark);
  return grad;
};

/** Fill the current path softly and outline it. */
const body = (g: G, c: Colourway, cx: number, cy: number, r: number, main?: string) => {
  g.fillStyle = shade(g, c, cx, cy, r, main);
  g.fill();
  g.lineWidth = LINE;
  g.strokeStyle = c.dark;
  g.stroke();
};

/** A dashed seam just inside the current path. */
const seam = (g: G, c: Colourway, cx: number, cy: number, inset = 0.86) => {
  g.save();
  g.translate(cx, cy);
  g.scale(inset, inset);
  g.translate(-cx, -cy);
  g.setLineDash([0.022, 0.018]);
  g.lineWidth = 0.008 / inset;
  g.strokeStyle = c.light;
  g.globalAlpha = 0.7;
  g.stroke();
  g.restore();
};

const ellipsePath = (g: G, x: number, y: number, rx: number, ry: number, rot = 0) => {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
};

const oval = (g: G, x: number, y: number, rx: number, ry: number, fill: string, rot = 0) => {
  ellipsePath(g, x, y, rx, ry, rot);
  g.fillStyle = fill;
  g.fill();
};

/** Two bead eyes, a stitched smile and pink cheeks, centred on (x, y), `s` wide. */
const face = (
  g: G,
  x: number,
  y: number,
  s: number,
  o: { cheeks?: boolean; wide?: boolean } = {},
) => {
  const ex = 0.42 * s;
  for (const side of [-1, 1]) {
    oval(g, x + side * ex, y, 0.11 * s, 0.14 * s, INK);
    oval(g, x + side * ex + 0.035 * s, y + 0.05 * s, 0.04 * s, 0.04 * s, "#ffffff");
  }
  g.beginPath();
  const w = o.wide ? 0.38 : 0.2;
  g.moveTo(x - w * s, y - 0.2 * s);
  g.quadraticCurveTo(x, y - (o.wide ? 0.5 : 0.42) * s, x + w * s, y - 0.2 * s);
  g.lineWidth = 0.055 * s;
  g.lineCap = "round";
  g.strokeStyle = INK;
  g.stroke();
  if (o.cheeks !== false) {
    for (const side of [-1, 1])
      oval(g, x + side * 0.66 * s, y - 0.22 * s, 0.15 * s, 0.09 * s, BLUSH);
  }
};

const roundRect = (g: G, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
};

const DRAW: Record<DesignId, (g: G, c: Colourway) => void> = {
  bear(g, c) {
    for (const side of [-1, 1]) {
      // Arms and feet behind the body.
      ellipsePath(g, side * 0.19, -0.1, 0.065, 0.1, side * 0.5);
      body(g, c, side * 0.19, -0.1, 0.1);
      ellipsePath(g, side * 0.11, -0.3, 0.08, 0.055);
      body(g, c, side * 0.11, -0.3, 0.08);
      oval(g, side * 0.11, -0.31, 0.045, 0.03, c.accent);
    }
    ellipsePath(g, 0, -0.15, 0.22, 0.19);
    body(g, c, 0, -0.15, 0.22);
    seam(g, c, 0, -0.15);
    oval(g, 0, -0.17, 0.12, 0.1, c.accent);
    for (const side of [-1, 1]) {
      ellipsePath(g, side * 0.15, 0.29, 0.065, 0.065);
      body(g, c, side * 0.15, 0.29, 0.065);
      oval(g, side * 0.15, 0.29, 0.034, 0.034, c.accent);
    }
    ellipsePath(g, 0, 0.15, 0.19, 0.19);
    body(g, c, 0, 0.15, 0.19);
    oval(g, 0, 0.09, 0.085, 0.065, c.accent);
    oval(g, 0, 0.115, 0.03, 0.022, INK);
    face(g, 0, 0.18, 0.18, { cheeks: true });
  },
  bunny(g, c) {
    for (const side of [-1, 1]) {
      ellipsePath(g, side * 0.075, 0.3, 0.05, 0.14, -side * 0.18);
      body(g, c, side * 0.075, 0.3, 0.12);
      oval(g, side * 0.078, 0.3, 0.024, 0.1, c.accent, -side * 0.18);
      ellipsePath(g, side * 0.1, -0.31, 0.075, 0.05);
      body(g, c, side * 0.1, -0.31, 0.075);
    }
    ellipsePath(g, 0, -0.19, 0.2, 0.15);
    body(g, c, 0, -0.19, 0.2);
    seam(g, c, 0, -0.19);
    ellipsePath(g, 0, 0.05, 0.17, 0.17);
    body(g, c, 0, 0.05, 0.17);
    oval(g, 0, 0.025, 0.028, 0.02, c.accent);
    face(g, 0, 0.07, 0.15);
  },
  octopus(g, c) {
    // Tentacles: a scalloped skirt under the dome, curling at the ends.
    g.beginPath();
    g.moveTo(-0.3, -0.02);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x0 = -0.3 + (0.6 * i) / n;
      const x1 = -0.3 + (0.6 * (i + 1)) / n;
      const xm = (x0 + x1) / 2;
      g.quadraticCurveTo(x0 - 0.01, -0.3, xm, -0.29);
      g.quadraticCurveTo(x1 + 0.01, -0.3, x1, -0.12);
    }
    g.lineTo(0.3, -0.02);
    g.closePath();
    body(g, c, 0, -0.12, 0.3);
    ellipsePath(g, 0, 0.07, 0.24, 0.24);
    body(g, c, 0, 0.07, 0.24);
    seam(g, c, 0, 0.07, 0.82);
    for (const [x, y, r] of [
      [-0.12, 0.2, 0.035],
      [0.13, 0.22, 0.028],
      [0.02, 0.27, 0.022],
    ] as const) {
      oval(g, x, y, r, r, c.accent);
    }
    face(g, 0, 0.03, 0.2, { wide: true });
  },
  whale(g, c) {
    g.beginPath();
    g.moveTo(-0.28, 0.04);
    g.quadraticCurveTo(-0.38, 0.06, -0.48, 0.17);
    g.quadraticCurveTo(-0.44, 0.07, -0.4, 0.05);
    g.quadraticCurveTo(-0.46, 0.0, -0.49, -0.07);
    g.quadraticCurveTo(-0.38, -0.03, -0.28, -0.04);
    g.closePath();
    body(g, c, -0.38, 0.04, 0.12);
    ellipsePath(g, 0.02, 0, 0.35, 0.21);
    body(g, c, 0.02, 0, 0.35);
    // A pale belly with grooves.
    g.save();
    ellipsePath(g, 0.02, 0, 0.35, 0.21);
    g.clip();
    oval(g, 0.06, -0.2, 0.3, 0.13, c.accent);
    g.strokeStyle = c.light;
    g.lineWidth = 0.008;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(-0.12 + i * 0.08, -0.12 + (i % 2) * 0.005);
      g.lineTo(-0.06 + i * 0.08, -0.17);
      g.stroke();
    }
    g.restore();
    ellipsePath(g, 0.02, 0, 0.35, 0.21);
    seam(g, c, 0.02, 0, 0.88);
    ellipsePath(g, -0.02, -0.1, 0.07, 0.035, 0.5);
    body(g, c, -0.02, -0.1, 0.07);
    oval(g, 0.22, 0.05, 0.03, 0.038, INK);
    oval(g, 0.23, 0.065, 0.011, 0.011, "#ffffff");
    g.beginPath();
    g.moveTo(0.21, -0.04);
    g.quadraticCurveTo(0.27, -0.08, 0.33, -0.03);
    g.lineWidth = 0.011;
    g.lineCap = "round";
    g.strokeStyle = INK;
    g.stroke();
    oval(g, 0.17, -0.03, 0.035, 0.02, BLUSH);
    // A little spout of water.
    g.strokeStyle = c.light;
    g.lineWidth = 0.014;
    for (const a of [-0.5, 0, 0.5]) {
      g.beginPath();
      g.moveTo(0.1, 0.21);
      g.quadraticCurveTo(0.1 + a * 0.08, 0.29, 0.1 + a * 0.14, 0.3);
      g.stroke();
    }
  },
  dino(g, c) {
    // Spikes along the back.
    for (const [x, y, a] of [
      [-0.2, 0.08, 0.6],
      [-0.08, 0.14, 0.25],
      [0.05, 0.14, -0.1],
      [0.14, 0.27, -0.3],
    ] as const) {
      g.save();
      g.translate(x, y);
      g.rotate(-a);
      g.beginPath();
      g.moveTo(-0.045, 0);
      g.quadraticCurveTo(0, 0.12, 0.045, 0);
      g.closePath();
      g.fillStyle = c.accent;
      g.fill();
      g.lineWidth = LINE * 0.8;
      g.strokeStyle = c.dark;
      g.stroke();
      g.restore();
    }
    g.beginPath();
    g.moveTo(-0.2, 0.02);
    g.quadraticCurveTo(-0.34, -0.02, -0.48, -0.15);
    g.quadraticCurveTo(-0.32, -0.18, -0.18, -0.17);
    g.closePath();
    body(g, c, -0.3, -0.08, 0.15);
    for (const side of [-1, 1]) {
      roundRect(g, -0.02 + side * 0.11 - 0.05, -0.29, 0.1, 0.12, 0.04);
      body(g, c, side * 0.11, -0.24, 0.07);
    }
    ellipsePath(g, -0.02, -0.06, 0.26, 0.2);
    body(g, c, -0.02, -0.06, 0.26);
    oval(g, 0.02, -0.11, 0.15, 0.1, c.accent);
    ellipsePath(g, -0.02, -0.06, 0.26, 0.2);
    seam(g, c, -0.02, -0.06, 0.88);
    ellipsePath(g, 0.2, 0.17, 0.14, 0.14);
    body(g, c, 0.2, 0.17, 0.14);
    face(g, 0.22, 0.19, 0.12);
    oval(g, 0.3, 0.13, 0.012, 0.01, c.dark);
  },
  star(g, c) {
    const outer = 0.31;
    const inner = 0.15;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? inner : outer;
      if (i === 0) g.moveTo(r * Math.cos(a), r * Math.sin(a));
      else g.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
    g.closePath();
    g.lineJoin = "round";
    // A thick outline in the body colour rounds the points like a stuffed star.
    g.lineWidth = 0.07;
    g.strokeStyle = c.main;
    g.stroke();
    body(g, c, 0, 0.02, 0.3);
    g.lineWidth = 0.07 + LINE;
    g.globalCompositeOperation = "destination-over";
    g.strokeStyle = c.dark;
    g.stroke();
    g.globalCompositeOperation = "source-over";
    seam(g, c, 0, 0, 0.8);
    face(g, 0, 0.02, 0.16);
  },
  heart(g, c) {
    g.beginPath();
    g.moveTo(0, -0.29);
    g.bezierCurveTo(-0.12, -0.18, -0.29, -0.05, -0.27, 0.08);
    g.bezierCurveTo(-0.25, 0.23, -0.05, 0.26, 0, 0.13);
    g.bezierCurveTo(0.05, 0.26, 0.25, 0.23, 0.27, 0.08);
    g.bezierCurveTo(0.29, -0.05, 0.12, -0.18, 0, -0.29);
    g.closePath();
    g.lineJoin = "round";
    body(g, c, -0.02, 0.02, 0.28);
    seam(g, c, 0, 0.0, 0.84);
    face(g, 0, 0.03, 0.15);
  },
  cactus(g, c) {
    const green = c;
    // The pot.
    g.beginPath();
    g.moveTo(-0.17, -0.22);
    g.lineTo(0.17, -0.22);
    g.lineTo(0.13, -0.41);
    g.lineTo(-0.13, -0.41);
    g.closePath();
    g.fillStyle = c.accent;
    g.fill();
    g.lineWidth = LINE;
    g.strokeStyle = "rgba(40,20,20,0.6)";
    g.stroke();
    roundRect(g, -0.19, -0.27, 0.38, 0.08, 0.02);
    g.fillStyle = c.accent;
    g.fill();
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(-0.15, -0.38, 0.05, 0.13);
    // Arms, then the trunk over them: thick rounded strokes, outlined.
    const arm = (y0: number, dir: number, up: number) => {
      const x0 = 0.08 * dir;
      const ex = 0.235 * dir;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(ex, y0);
      g.lineTo(ex, y0 + up);
      g.lineWidth = 0.11 + 2 * LINE;
      g.strokeStyle = green.dark;
      g.stroke();
      g.lineWidth = 0.11;
      g.strokeStyle = shade(g, green, ex, y0 + up * 0.5, 0.14);
      g.stroke();
    };
    arm(0.0, -1, 0.14);
    arm(0.08, 1, 0.11);
    roundRect(g, -0.12, -0.22, 0.24, 0.53, 0.12);
    body(g, green, 0, 0.05, 0.27);
    seam(g, c, 0, 0.05, 0.85);
    g.strokeStyle = "rgba(255,255,255,0.75)";
    g.lineWidth = 0.008;
    for (const [x, y] of [
      [-0.07, 0.2],
      [0.06, 0.12],
      [-0.05, -0.12],
      [0.07, -0.08],
      [0.0, 0.26],
    ] as const) {
      g.beginPath();
      g.moveTo(x - 0.012, y - 0.012);
      g.lineTo(x + 0.012, y + 0.012);
      g.moveTo(x + 0.012, y - 0.012);
      g.lineTo(x - 0.012, y + 0.012);
      g.stroke();
    }
    // A flower on top.
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      oval(g, 0.03 + 0.03 * Math.cos(a), 0.31 + 0.03 * Math.sin(a), 0.028, 0.028, "#ff8fc8");
    }
    oval(g, 0.03, 0.31, 0.018, 0.018, "#fff2a8");
    face(g, 0, 0.04, 0.13);
  },
  avocado(g, c) {
    const eggPath = (k: number, dy = 0) => {
      g.beginPath();
      g.moveTo(0, 0.32 * k + dy);
      g.bezierCurveTo(0.14 * k, 0.32 * k + dy, 0.17 * k, 0.12 * k + dy, 0.21 * k, -0.02 * k + dy);
      g.bezierCurveTo(0.29 * k, -0.24 * k + dy, 0.16 * k, -0.32 * k + dy, 0, -0.32 * k + dy);
      g.bezierCurveTo(
        -0.16 * k,
        -0.32 * k + dy,
        -0.29 * k,
        -0.24 * k + dy,
        -0.21 * k,
        -0.02 * k + dy,
      );
      g.bezierCurveTo(-0.17 * k, 0.12 * k + dy, -0.14 * k, 0.32 * k + dy, 0, 0.32 * k + dy);
      g.closePath();
    };
    eggPath(1);
    body(g, c, 0, 0, 0.32);
    eggPath(0.8, -0.01);
    g.fillStyle = (() => {
      const grad = g.createRadialGradient(-0.05, 0.08, 0.02, 0, -0.02, 0.3);
      grad.addColorStop(0, "#fbffd8");
      grad.addColorStop(0.7, c.accent);
      grad.addColorStop(1, "#b6cf5c");
      return grad;
    })();
    g.fill();
    seam(g, c, 0, -0.01, 0.92);
    ellipsePath(g, 0, -0.11, 0.1, 0.1);
    g.fillStyle = (() => {
      const grad = g.createRadialGradient(-0.03, -0.07, 0.01, 0, -0.11, 0.12);
      grad.addColorStop(0, "#c98a55");
      grad.addColorStop(1, "#6b3d1f");
      return grad;
    })();
    g.fill();
    g.lineWidth = LINE * 0.8;
    g.strokeStyle = "#4a2a14";
    g.stroke();
    face(g, 0, 0.1, 0.12);
  },
  frog(g, c) {
    for (const side of [-1, 1]) {
      ellipsePath(g, side * 0.2, -0.24, 0.1, 0.045, side * 0.2);
      body(g, c, side * 0.2, -0.24, 0.1);
    }
    ellipsePath(g, 0, -0.05, 0.3, 0.2);
    body(g, c, 0, -0.05, 0.3);
    oval(g, 0, -0.12, 0.18, 0.1, c.accent);
    ellipsePath(g, 0, -0.05, 0.3, 0.2);
    seam(g, c, 0, -0.05, 0.88);
    for (const side of [-1, 1]) {
      ellipsePath(g, side * 0.16, 0.15, 0.09, 0.09);
      body(g, c, side * 0.16, 0.15, 0.09);
      oval(g, side * 0.16, 0.16, 0.06, 0.06, "#ffffff");
      oval(g, side * 0.16, 0.155, 0.035, 0.042, INK);
      oval(g, side * 0.172, 0.17, 0.013, 0.013, "#ffffff");
    }
    g.beginPath();
    g.moveTo(-0.15, -0.01);
    g.quadraticCurveTo(0, -0.11, 0.15, -0.01);
    g.lineWidth = 0.014;
    g.lineCap = "round";
    g.strokeStyle = INK;
    g.stroke();
    for (const side of [-1, 1]) oval(g, side * 0.2, -0.04, 0.045, 0.026, BLUSH);
  },
};

/** Draw a design at the origin, 1 u to the canvas's current unit, y up. */
export const drawPlush = (g: G, design: Design, colour: number) => {
  const c = design.colourways[colour % design.colourways.length]!;
  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";
  DRAW[design.id](g, c);
  g.restore();
};

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Where the body's origin is in the sprite, px. */
  ox: number;
  oy: number;
  /** Sprite px per u. */
  scale: number;
}

const PAD = 3;

/** Sprites per size, kept for every design and colour. */
export interface SpriteSet {
  readonly scale: number;
  get(design: DesignId, colour: number): Sprite;
  dispose(): void;
}

export const createSprites = (scale: number): SpriteSet => {
  const cache = new Map<string, Sprite>();
  return {
    scale,
    get(id, colour) {
      const d = DESIGNS[id];
      const n = colour % d.colourways.length;
      const key = `${id}:${n}`;
      let s = cache.get(key);
      if (!s) {
        const c = document.createElement("canvas");
        const w = Math.max(2, Math.ceil((d.box.x1 - d.box.x0) * scale) + 2 * PAD);
        const h = Math.max(2, Math.ceil((d.box.y1 - d.box.y0) * scale) + 2 * PAD);
        c.width = w;
        c.height = h;
        const ox = -d.box.x0 * scale + PAD;
        const oy = d.box.y1 * scale + PAD;
        const g = c.getContext("2d");
        if (g) {
          g.translate(ox, oy);
          g.scale(scale, -scale);
          drawPlush(g, d, n);
        }
        s = { canvas: c, ox, oy, scale };
        cache.set(key, s);
      }
      return s;
    },
    dispose() {
      for (const s of cache.values()) s.canvas.width = s.canvas.height = 0;
      cache.clear();
    },
  };
};

/** Draw a sprite with its origin at (x, y), turned by `angle` (clockwise on the canvas). */
export const blitSprite = (g: G, s: Sprite, x: number, y: number, angle: number, size = 1) => {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  const k = size;
  g.drawImage(s.canvas, -s.ox * k, -s.oy * k, s.canvas.width * k, s.canvas.height * k);
  g.restore();
};
