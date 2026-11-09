/**
 * Drawing the craft, its ghost and its flames with Canvas2D, in craft sizes about the centre of
 * mass. The caller sets the transform. Pure drawing, no state.
 */
import { withAlpha } from "../../core/ui";
import { ENGINE, FOOT, MAIN, THRUSTER } from "./craft";

export type G = CanvasRenderingContext2D;

export const TAU = Math.PI * 2;

const LINE = "#0b0f1e";
const METAL = "#d6deec";
const BELL = "#68728c";
const DOME = "#eef2fa";
const GLASS = "#1d2b4d";

export interface Flames {
  left: boolean;
  right: boolean;
  main: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  /** 0 to 1, flicker strength. */
  flicker: number;
  /** Drawn faint, for the helper's engine or a ghost. */
  faintLeft: boolean;
  faintRight: boolean;
}

export const roundRect = (g: G, x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
};

export const star = (g: G, x: number, y: number, r: number, inner = 0.45) => {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * inner;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
};

/** A flame from (x, y) pointing along (dx, dy), in the current transform's units. */
const flame = (
  g: G,
  x: number,
  y: number,
  dx: number,
  dy: number,
  length: number,
  width: number,
  alpha: number,
) => {
  const nx = -dy;
  const ny = dx;
  const tipX = x + dx * length;
  const tipY = y + dy * length;
  const shape = (l: number, w: number) => {
    g.beginPath();
    g.moveTo(x + nx * w, y + ny * w);
    g.quadraticCurveTo(
      x + dx * l * 0.45 + nx * w * 1.25,
      y + dy * l * 0.45 + ny * w * 1.25,
      x + dx * l,
      y + dy * l,
    );
    g.quadraticCurveTo(
      x + dx * l * 0.45 - nx * w * 1.25,
      y + dy * l * 0.45 - ny * w * 1.25,
      x - nx * w,
      y - ny * w,
    );
    g.closePath();
  };
  g.globalAlpha = alpha;
  const grad = g.createLinearGradient(x, y, tipX, tipY);
  grad.addColorStop(0, "#ffd36b");
  grad.addColorStop(0.5, "#ff8a2a");
  grad.addColorStop(1, "rgba(255,80,30,0)");
  g.fillStyle = grad;
  shape(length, width);
  g.fill();
  g.fillStyle = "#fff7d6";
  shape(length * 0.5, width * 0.5);
  g.fill();
  g.globalAlpha = 1;
};

/** Flames and thruster puffs. Exhaust points away from the thrust. */
export const drawFlames = (g: G, f: Flames, duo: boolean, ghost: boolean, time: number) => {
  const base = ghost ? 0.35 : 1;
  const flick = (k: number) => 0.85 + 0.3 * f.flicker * (0.5 + 0.5 * Math.sin(time * 37 + k * 2.1));
  const tilt = 0.14;
  if (duo) {
    if (f.left) {
      flame(
        g,
        -ENGINE.x,
        ENGINE.y + 0.03,
        -Math.sin(tilt),
        Math.cos(tilt),
        0.46 * flick(1),
        0.075,
        base * (f.faintLeft ? 0.45 : 1),
      );
    }
    if (f.right) {
      flame(
        g,
        ENGINE.x,
        ENGINE.y + 0.03,
        Math.sin(tilt),
        Math.cos(tilt),
        0.46 * flick(2),
        0.075,
        base * (f.faintRight ? 0.45 : 1),
      );
    }
  } else {
    if (f.main) flame(g, MAIN.x, MAIN.y + 0.03, 0, 1, 0.55 * flick(3), 0.1, base);
    // Turning right (clockwise) pushes the top rightwards: the left thruster blows left.
    if (f.turnRight) flame(g, -THRUSTER.x - 0.04, THRUSTER.y, -1, 0, 0.22 * flick(4), 0.04, base);
    if (f.turnLeft) flame(g, THRUSTER.x + 0.04, THRUSTER.y, 1, 0, 0.22 * flick(5), 0.04, base);
  }
};

const bell = (g: G, x: number, y: number, top: number, bottom: number, h: number) => {
  g.beginPath();
  g.moveTo(x - top / 2, y);
  g.lineTo(x + top / 2, y);
  g.lineTo(x + bottom / 2, y + h);
  g.lineTo(x - bottom / 2, y + h);
  g.closePath();
};

/** The craft body. `color` is the crew's. */
export const drawCraft = (g: G, color: string, duo: boolean) => {
  g.lineJoin = "round";
  g.lineCap = "round";
  // A faint halo in the crew's colour so the craft stands out from across the room.
  const halo = g.createRadialGradient(0, -0.02, 0.1, 0, -0.02, 0.75);
  halo.addColorStop(0, withAlpha(color, 0.22));
  halo.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = halo;
  g.beginPath();
  g.arc(0, -0.02, 0.75, 0, TAU);
  g.fill();
  // Legs, struts and feet.
  const legs = (width: number, style: string) => {
    g.strokeStyle = style;
    g.lineWidth = width;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(s * 0.2, 0.1);
      g.lineTo(s * FOOT.x, FOOT.y - 0.02);
      g.moveTo(s * 0.33, 0.06);
      g.lineTo(s * 0.37, 0.27);
      g.stroke();
    }
  };
  legs(0.11, LINE);
  legs(0.065, METAL);
  g.fillStyle = METAL;
  g.strokeStyle = LINE;
  g.lineWidth = 0.025;
  for (const s of [-1, 1]) {
    roundRect(g, s * FOOT.x - 0.11, FOOT.y - 0.045, 0.22, 0.065, 0.03);
    g.fill();
    g.stroke();
  }
  // Engines.
  g.fillStyle = BELL;
  if (duo) {
    for (const s of [-1, 1]) {
      bell(g, s * ENGINE.x, 0.15, 0.09, 0.15, 0.12);
      g.fill();
      g.stroke();
    }
  } else {
    bell(g, MAIN.x, 0.15, 0.12, 0.2, 0.13);
    g.fill();
    g.stroke();
    for (const s of [-1, 1]) {
      roundRect(g, s * THRUSTER.x - 0.04, THRUSTER.y - 0.035, 0.08, 0.07, 0.015);
      g.fill();
      g.stroke();
    }
  }
  // Lower body in the crew's colour.
  g.fillStyle = color;
  g.lineWidth = 0.03;
  roundRect(g, -0.34, -0.05, 0.68, 0.22, 0.07);
  g.fill();
  g.stroke();
  g.fillStyle = "rgba(0,0,0,0.22)";
  roundRect(g, -0.34, 0.09, 0.68, 0.08, 0.04);
  g.fill();
  // Dome and window.
  g.fillStyle = DOME;
  g.beginPath();
  g.arc(0, -0.06, 0.3, Math.PI, 0);
  g.lineTo(0.3, -0.04);
  g.lineTo(-0.3, -0.04);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = GLASS;
  g.beginPath();
  g.arc(0, -0.13, 0.13, 0, TAU);
  g.fill();
  g.strokeStyle = "#c9d6ee";
  g.lineWidth = 0.035;
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.lineWidth = 0.025;
  g.beginPath();
  g.arc(0, -0.13, 0.08, Math.PI * 1.1, Math.PI * 1.45);
  g.stroke();
  // Antenna.
  g.strokeStyle = LINE;
  g.lineWidth = 0.03;
  g.beginPath();
  g.moveTo(0.1, -0.34);
  g.lineTo(0.15, -0.47);
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.arc(0.15, -0.48, 0.035, 0, TAU);
  g.fill();
  g.stroke();
};

/** The ghost: the craft's outline only. */
export const drawGhost = (g: G, color: string) => {
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = color;
  g.lineWidth = 0.04;
  g.setLineDash([0.07, 0.05]);
  g.beginPath();
  g.arc(0, -0.06, 0.3, Math.PI, 0);
  g.lineTo(0.3, -0.04);
  g.moveTo(-0.34, -0.05);
  g.lineTo(0.34, -0.05);
  g.lineTo(0.34, 0.17);
  g.lineTo(-0.34, 0.17);
  g.closePath();
  for (const s of [-1, 1]) {
    g.moveTo(s * 0.2, 0.17);
    g.lineTo(s * FOOT.x, FOOT.y);
    g.moveTo(s * FOOT.x - 0.09, FOOT.y);
    g.lineTo(s * FOOT.x + 0.09, FOOT.y);
  }
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = color;
  g.globalAlpha *= 0.18;
  g.beginPath();
  g.arc(0, -0.06, 0.3, Math.PI, 0);
  g.lineTo(0.3, 0.17);
  g.lineTo(-0.3, 0.17);
  g.closePath();
  g.fill();
};
