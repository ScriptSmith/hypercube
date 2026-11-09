/**
 * Drawings of every part kind, our own simple vector shapes. Each fills the box it is given, so
 * the same drawing serves a slot on the build, a part in flight and the order card. `lit` (0 to
 * 1) lights lamps, lanterns and robot lights while a build is alive.
 */
import { circle, roundRect, TAU } from "./tasks/common";
import type { ThemeId } from "./config";

type G = CanvasRenderingContext2D;

const gearPath = (g: G, cx: number, cy: number, r: number, teeth: number, rot = 0) => {
  g.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = rot + (i / (teeth * 2)) * TAU;
    const rr = i % 2 === 0 ? r : r * 0.78;
    const a0 = a - (Math.PI / (teeth * 2)) * 0.5;
    const a1 = a + (Math.PI / (teeth * 2)) * 0.5;
    g.lineTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr);
    g.lineTo(cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr);
  }
  g.closePath();
};

const outline = (g: G, w: number, h: number, color = "rgba(10,14,28,0.55)") => {
  g.strokeStyle = color;
  g.lineWidth = Math.max(0.5, Math.min(w, h) * 0.06);
  g.stroke();
};

/** A metal plate with a rivet in each corner. */
const plate = (g: G, x: number, y: number, w: number, h: number, fill: string) => {
  const r = Math.min(w, h) * 0.14;
  g.fillStyle = fill;
  roundRect(g, x, y, w, h, r);
  g.fill();
  outline(g, w, h);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(x + w * 0.1, y + h * 0.12, w * 0.8, h * 0.1);
  g.fillStyle = "rgba(40,50,70,0.55)";
  const rv = Math.min(w, h) * 0.07;
  for (const [fx, fy] of [
    [0.16, 0.2],
    [0.84, 0.2],
    [0.16, 0.8],
    [0.84, 0.8],
  ] as const) {
    circle(g, x + w * fx, y + h * fy, rv);
    g.fill();
  }
};

const glow = (g: G, cx: number, cy: number, r: number, color: string, a: number) => {
  if (a <= 0) return;
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(255,220,120,0)");
  g.globalAlpha = Math.min(1, a);
  g.fillStyle = grad;
  circle(g, cx, cy, r);
  g.fill();
  g.globalAlpha = 1;
};

const rocketPart = (g: G, kind: number, x: number, y: number, w: number, h: number, v: number) => {
  switch (kind) {
    case 0:
      plate(g, x, y, w, h, "#c8d2e4");
      return;
    case 1: {
      plate(g, x, y, w, h, "#c8d2e4");
      const r = Math.min(w, h) * 0.32;
      g.fillStyle = "#e8eef8";
      circle(g, x + w / 2, y + h / 2, r * 1.25);
      g.fill();
      g.fillStyle = "#3aa7e8";
      circle(g, x + w / 2, y + h / 2, r);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.7)";
      circle(g, x + w / 2 - r * 0.35, y + h / 2 - r * 0.35, r * 0.28);
      g.fill();
      return;
    }
    case 2: {
      // A fin pointing away from the hull (v < 0 points left).
      g.fillStyle = "#f07d5a";
      g.beginPath();
      if (v < 0) {
        g.moveTo(x + w, y);
        g.lineTo(x + w, y + h);
        g.lineTo(x, y + h);
        g.lineTo(x + w * 0.35, y + h * 0.45);
      } else {
        g.moveTo(x, y);
        g.lineTo(x, y + h);
        g.lineTo(x + w, y + h);
        g.lineTo(x + w * 0.65, y + h * 0.45);
      }
      g.closePath();
      g.fill();
      outline(g, w, h);
      return;
    }
    default: {
      g.fillStyle = "#e8edf5";
      roundRect(g, x, y, w, h, Math.min(w, h) * 0.25);
      g.fill();
      outline(g, w, h);
      g.fillStyle = "#6fa4fc";
      g.fillRect(x + w * 0.06, y + h * 0.42, w * 0.88, h * 0.16);
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.fillRect(x + w * 0.18, y + h * 0.1, w * 0.14, h * 0.8);
      if (v === 1) {
        // The top tank of a booster carries its cone.
        g.fillStyle = "#f07d5a";
        g.beginPath();
        g.moveTo(x, y + h * 0.02);
        g.lineTo(x + w / 2, y - Math.min(w * 0.9, h * 0.6));
        g.lineTo(x + w, y + h * 0.02);
        g.closePath();
        g.fill();
      }
    }
  }
};

const treePart = (
  g: G,
  kind: number,
  x: number,
  y: number,
  w: number,
  h: number,
  v: number,
  lit: number,
) => {
  switch (kind) {
    case 0: {
      g.fillStyle = v === 1 ? "#a65f3a" : "#c68a4e";
      roundRect(g, x, y, w, h, Math.min(w, h) * 0.18);
      g.fill();
      outline(g, w, h, "rgba(70,40,15,0.6)");
      g.strokeStyle = "rgba(90,55,25,0.55)";
      g.lineWidth = Math.max(0.4, h * 0.05);
      g.beginPath();
      g.moveTo(x + w * 0.1, y + h * 0.4);
      g.quadraticCurveTo(x + w * 0.5, y + h * 0.25, x + w * 0.9, y + h * 0.45);
      g.moveTo(x + w * 0.15, y + h * 0.7);
      g.quadraticCurveTo(x + w * 0.5, y + h * 0.8, x + w * 0.85, y + h * 0.65);
      g.stroke();
      return;
    }
    case 1: {
      g.fillStyle = "#8b5a2b";
      roundRect(g, x, y, w, h, Math.min(w, h) * 0.12);
      g.fill();
      const p = Math.min(w, h) * 0.16;
      g.fillStyle = lit > 0 ? "#ffd77a" : "#ffe7a8";
      g.fillRect(x + p, y + p, w - 2 * p, h - 2 * p);
      g.fillStyle = "#8b5a2b";
      g.fillRect(x + w / 2 - p * 0.3, y + p, p * 0.6, h - 2 * p);
      g.fillRect(x + p, y + h / 2 - p * 0.3, w - 2 * p, p * 0.6);
      if (lit > 0)
        glow(g, x + w / 2, y + h / 2, Math.max(w, h) * 0.9, "rgba(255,215,120,0.6)", lit);
      return;
    }
    case 2:
      g.fillStyle = "#b07a42";
      roundRect(g, x, y, w, h, h * 0.45);
      g.fill();
      outline(g, w, h, "rgba(70,40,15,0.6)");
      return;
    default: {
      const cx = x + w / 2;
      g.strokeStyle = "#5b3a1e";
      g.lineWidth = Math.max(0.4, w * 0.06);
      g.beginPath();
      g.moveTo(cx, y);
      g.lineTo(cx, y + h * 0.25);
      g.stroke();
      if (lit > 0) glow(g, cx, y + h * 0.6, w * 1.6, "rgba(255,200,90,0.8)", lit);
      g.fillStyle = "#5b3a1e";
      roundRect(g, x + w * 0.2, y + h * 0.22, w * 0.6, h * 0.12, h * 0.04);
      g.fill();
      g.fillStyle = lit > 0 ? "#ffd36b" : "#f2b84b";
      roundRect(g, x + w * 0.12, y + h * 0.32, w * 0.76, h * 0.56, w * 0.22);
      g.fill();
      g.fillStyle = "#5b3a1e";
      roundRect(g, x + w * 0.24, y + h * 0.86, w * 0.52, h * 0.1, h * 0.04);
      g.fill();
    }
  }
};

const lighthousePart = (
  g: G,
  kind: number,
  x: number,
  y: number,
  w: number,
  h: number,
  v: number,
  lit: number,
) => {
  switch (kind) {
    case 0: {
      const stripe = Math.floor(v / 2) % 2 === 1;
      g.fillStyle = stripe ? "#3d6fd1" : "#eef1f6";
      roundRect(g, x, y, w, h, Math.min(w, h) * 0.16);
      g.fill();
      outline(g, w, h, "rgba(30,40,60,0.45)");
      g.fillStyle = stripe ? "rgba(255,255,255,0.18)" : "rgba(60,80,120,0.12)";
      g.fillRect(x + w * 0.1, y + h * 0.15, w * 0.8, h * 0.18);
      return;
    }
    case 1: {
      g.fillStyle = "#eef1f6";
      roundRect(g, x, y, w, h, Math.min(w, h) * 0.16);
      g.fill();
      outline(g, w, h, "rgba(30,40,60,0.45)");
      const ww = Math.min(w * 0.45, h * 0.4);
      const wh = h * 0.62;
      const wx = x + w / 2 - ww / 2;
      const wy = y + h * 0.22;
      g.fillStyle = lit > 0 ? "#ffd77a" : "#23324f";
      g.beginPath();
      g.moveTo(wx, wy + wh);
      g.lineTo(wx, wy + ww / 2);
      g.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, TAU);
      g.lineTo(wx + ww, wy + wh);
      g.closePath();
      g.fill();
      return;
    }
    case 2: {
      g.strokeStyle = "#2d3542";
      g.lineWidth = Math.max(0.5, w * 0.08);
      g.beginPath();
      g.moveTo(x, y + h * 0.15);
      g.lineTo(x + w, y + h * 0.15);
      g.moveTo(x + w * 0.2, y + h * 0.15);
      g.lineTo(x + w * 0.2, y + h);
      g.moveTo(x + w * 0.5, y + h * 0.15);
      g.lineTo(x + w * 0.5, y + h);
      g.moveTo(x + w * 0.8, y + h * 0.15);
      g.lineTo(x + w * 0.8, y + h);
      g.stroke();
      return;
    }
    default: {
      g.fillStyle = "#2d3542";
      g.fillRect(x, y, w, h);
      const p = Math.min(w, h) * 0.08;
      g.fillStyle = lit > 0 ? "#fff2b0" : "#9fb7cc";
      g.fillRect(x + p, y + p, w - 2 * p, h - 2 * p);
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.fillRect(x + w * 0.2, y + p, w * 0.12, h - 2 * p);
      if (lit > 0)
        glow(g, x + w / 2, y + h / 2, Math.max(w, h) * 1.5, "rgba(255,240,160,0.9)", lit);
    }
  }
};

const robotPart = (
  g: G,
  kind: number,
  x: number,
  y: number,
  w: number,
  h: number,
  v: number,
  lit: number,
  t: number,
) => {
  switch (kind) {
    case 0: {
      plate(g, x, y, w, h, "#9aa6bf");
      const r = Math.min(w, h) * 0.36;
      g.fillStyle = "#f2a03d";
      gearPath(g, x + w / 2, y + h / 2, r, 8, lit > 0 ? t * 2 : 0);
      g.fill();
      g.fillStyle = "#5d6a85";
      circle(g, x + w / 2, y + h / 2, r * 0.32);
      g.fill();
      return;
    }
    case 1: {
      plate(g, x, y, w, h, "#b8c2d6");
      const r = Math.min(w, h) * 0.24;
      g.fillStyle = "#6b768c";
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        g.lineTo(x + w / 2 + Math.cos(a) * r, y + h / 2 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = "#d8dfee";
      g.lineWidth = Math.max(0.3, r * 0.2);
      g.beginPath();
      g.moveTo(x + w / 2 - r * 0.5, y + h / 2);
      g.lineTo(x + w / 2 + r * 0.5, y + h / 2);
      g.stroke();
      return;
    }
    case 2: {
      const r = Math.min(w, h) * 0.46;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const hue = ["#6cf7f8", "#89da9b", "#ad83d1"][v % 3]!;
      if (lit > 0) glow(g, cx, cy, r * 2.4, "rgba(140,250,250,0.8)", lit);
      g.fillStyle = "#5d6a85";
      circle(g, cx, cy, r);
      g.fill();
      g.fillStyle = lit > 0 && Math.sin(t * 6 + v) > -0.6 ? "#ffffff" : hue;
      circle(g, cx, cy, r * 0.7);
      g.fill();
      return;
    }
    default: {
      g.fillStyle = "#8fa0bf";
      roundRect(g, x + w * 0.15, y, w * 0.7, h, w * 0.3);
      g.fill();
      outline(g, w, h, "rgba(30,40,60,0.5)");
      g.fillStyle = "#5d6a85";
      circle(g, x + w / 2, y + Math.min(w, h) * 0.3, Math.min(w, h) * 0.22);
      g.fill();
      if (v === 1) {
        // A hand on the last segment.
        g.fillStyle = "#c9d3ea";
        circle(g, x + w / 2, y + h, w * 0.32);
        g.fill();
      }
    }
  }
};

const castlePart = (g: G, kind: number, x: number, y: number, w: number, h: number, v: number) => {
  const dots = (fill: string) => {
    g.fillStyle = fill;
    for (let i = 0; i < 5; i++) {
      circle(
        g,
        x + w * (0.15 + ((i * 0.37) % 0.7)),
        y + h * (0.25 + ((i * 0.53) % 0.55)),
        Math.min(w, h) * 0.04,
      );
      g.fill();
    }
  };
  switch (kind) {
    case 0:
      g.fillStyle = v === 1 ? "#e6c27c" : "#dcb36a";
      roundRect(g, x, y, w, h, Math.min(w, h) * 0.12);
      g.fill();
      outline(g, w, h, "rgba(110,80,30,0.45)");
      dots("rgba(160,120,60,0.6)");
      return;
    case 1: {
      g.fillStyle = "#e2bc72";
      g.beginPath();
      if (v === 1) {
        // The top segment ends in battlements.
        const n = 3;
        const bw = w / (n * 2 - 1);
        g.moveTo(x, y + h);
        g.lineTo(x, y);
        for (let i = 0; i < n * 2 - 1; i++) {
          const bx = x + i * bw;
          const top = i % 2 === 0 ? y : y + h * 0.18;
          g.lineTo(bx, top);
          g.lineTo(bx + bw, top);
        }
        g.lineTo(x + w, y + h);
      } else {
        g.rect(x, y, w, h);
      }
      g.closePath();
      g.fill();
      outline(g, w, h, "rgba(110,80,30,0.45)");
      dots("rgba(160,120,60,0.55)");
      g.fillStyle = "rgba(90,60,25,0.5)";
      roundRect(g, x + w * 0.38, y + h * 0.42, w * 0.24, h * 0.32, w * 0.12);
      g.fill();
      return;
    }
    case 2: {
      g.strokeStyle = "#6b4b2a";
      g.lineWidth = Math.max(0.4, w * 0.06);
      g.beginPath();
      g.moveTo(x + w * 0.2, y + h);
      g.lineTo(x + w * 0.2, y);
      g.stroke();
      g.fillStyle = v % 2 === 0 ? "#8a5cf0" : "#2ec4b6";
      g.beginPath();
      g.moveTo(x + w * 0.22, y + h * 0.02);
      g.lineTo(x + w * 0.98, y + h * 0.22);
      g.lineTo(x + w * 0.22, y + h * 0.44);
      g.closePath();
      g.fill();
      return;
    }
    default: {
      const cx = x + w / 2;
      const by = y + h * 0.9;
      const r = Math.min(w * 0.5, h * 0.85);
      g.fillStyle = v === 1 ? "#f3c6d9" : "#f6d7c3";
      g.beginPath();
      g.moveTo(cx, by);
      g.arc(cx, by, r, Math.PI * 1.1, Math.PI * 1.9);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(170,110,90,0.6)";
      g.lineWidth = Math.max(0.3, r * 0.06);
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (1.18 + i * 0.16);
        g.moveTo(cx, by);
        g.lineTo(cx + Math.cos(a) * r * 0.95, by + Math.sin(a) * r * 0.95);
      }
      g.stroke();
    }
  }
};

/** Draw a part filling the box. */
export const drawPart = (
  g: G,
  theme: ThemeId,
  kind: number,
  x: number,
  y: number,
  w: number,
  h: number,
  v = 0,
  lit = 0,
  t = 0,
): void => {
  switch (theme) {
    case "rocket":
      rocketPart(g, kind, x, y, w, h, v);
      return;
    case "treehouse":
      treePart(g, kind, x, y, w, h, v, lit);
      return;
    case "lighthouse":
      lighthousePart(g, kind, x, y, w, h, v, lit);
      return;
    case "robot":
      robotPart(g, kind, x, y, w, h, v, lit, t);
      return;
    case "sandcastle":
      castlePart(g, kind, x, y, w, h, v);
  }
};

/** Width over height of each kind's icon, for order cards and parts in flight. */
const ICON: Record<ThemeId, readonly number[]> = {
  rocket: [1.3, 1.1, 0.6, 0.7],
  treehouse: [2.4, 1.1, 3.2, 0.6],
  lighthouse: [1.4, 1, 1.5, 1],
  robot: [1.1, 1.1, 1, 0.5],
  sandcastle: [1.5, 0.8, 0.8, 1.3],
};

/** A part centred on (cx, cy), fitted in a square of `size`. */
export const drawIcon = (
  g: G,
  theme: ThemeId,
  kind: number,
  cx: number,
  cy: number,
  size: number,
  t = 0,
): void => {
  const a = ICON[theme][kind] ?? 1;
  const w = a >= 1 ? size : size * a;
  const h = a >= 1 ? size / a : size;
  // Fins point right; a tank shows without its booster cone so it stays inside the box.
  const v = theme === "rocket" && kind === 2 ? 1 : 0;
  drawPart(g, theme, kind, cx - w / 2, cy - h / 2, w, h, v, 0, t);
};

/** A small helper robot, as drawn carrying parts in. Centred on (x, y), `s` across. */
export const drawHelper = (g: G, x: number, y: number, s: number, t: number, face = 1): void => {
  const r = s * 0.32;
  // Propeller.
  g.strokeStyle = "#d8dfee";
  g.lineWidth = Math.max(1, s * 0.04);
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x, y - r * 1.5);
  g.stroke();
  const spin = Math.abs(Math.cos(t * 30));
  g.beginPath();
  g.moveTo(x - r * 1.1 * spin, y - r * 1.55);
  g.lineTo(x + r * 1.1 * spin, y - r * 1.55);
  g.stroke();
  g.fillStyle = "#c9d3ea";
  circle(g, x, y, r);
  g.fill();
  g.fillStyle = "#3a4b70";
  roundRect(g, x - r * 0.75 + face * r * 0.1, y - r * 0.4, r * 1.5, r * 0.7, r * 0.3);
  g.fill();
  g.fillStyle = "#6cf7f8";
  circle(g, x - r * 0.3 + face * r * 0.12, y - r * 0.05, r * 0.14);
  g.fill();
  circle(g, x + r * 0.3 + face * r * 0.12, y - r * 0.05, r * 0.14);
  g.fill();
  // Arms reaching down for the part.
  g.strokeStyle = "#c9d3ea";
  g.lineWidth = Math.max(1, s * 0.05);
  g.beginPath();
  g.moveTo(x - r * 0.6, y + r * 0.6);
  g.lineTo(x - r * 0.4, y + r * 1.2);
  g.moveTo(x + r * 0.6, y + r * 0.6);
  g.lineTo(x + r * 0.4, y + r * 1.2);
  g.stroke();
};

/** A trophy cup centred on (x, y), `s` tall. */
export const drawTrophy = (g: G, x: number, y: number, s: number): void => {
  g.fillStyle = "#ffcc33";
  g.beginPath();
  g.moveTo(x - s * 0.32, y - s * 0.45);
  g.lineTo(x + s * 0.32, y - s * 0.45);
  g.quadraticCurveTo(x + s * 0.3, y + s * 0.05, x, y + s * 0.1);
  g.quadraticCurveTo(x - s * 0.3, y + s * 0.05, x - s * 0.32, y - s * 0.45);
  g.fill();
  g.fillRect(x - s * 0.06, y + s * 0.08, s * 0.12, s * 0.2);
  roundRect(g, x - s * 0.24, y + s * 0.26, s * 0.48, s * 0.14, s * 0.04);
  g.fill();
  g.strokeStyle = "#ffcc33";
  g.lineWidth = Math.max(1, s * 0.07);
  g.beginPath();
  g.arc(x - s * 0.32, y - s * 0.25, s * 0.13, Math.PI * 0.5, Math.PI * 1.5);
  g.moveTo(x + s * 0.32, y - s * 0.38);
  g.arc(x + s * 0.32, y - s * 0.25, s * 0.13, -Math.PI * 0.5, Math.PI * 0.5);
  g.stroke();
};
