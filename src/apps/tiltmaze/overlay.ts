/**
 * The 2D layer over the 3D view: each board's tilt pad (or a pair's two levers in together mode)
 * with a ball-shaped knob under the finger and the board's tilt shown as shading on the pad, the
 * demonstration's ghost hands, and each board's level number between its two buttons.
 */
import type { FrameInfo } from "../../core/types";
import type { Layout, Lever } from "./layout";

type G = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

export interface PadState {
  /** The board's command, unit disc, and its tilt as a share of the largest. */
  command: { x: number; y: number };
  tilt: { x: number; y: number };
  /** Who moves it: a finger (person or bot) shows the knob bright; the demo shows a ghost hand. */
  touched: boolean;
  ghost: boolean;
  /** Levers in together mode: which are touched, and which help on their own. */
  lever: { h: boolean; v: boolean; helpH: boolean; helpV: boolean };
  accent: string;
  level: number;
  /** Seconds since the level last went up by a full jar (a pulse). */
  bumped: number;
}

export interface Overlay {
  setup(layout: Layout, frame: FrameInfo): void;
  draw(states: readonly PadState[], time: number): void;
  dispose(): void;
}

const rgba = (hex: string, a: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** A translucent hand with its fingertip at (x, y), venue px. */
const drawHand = (g: G, x: number, y: number, size: number, alpha: number) => {
  g.save();
  g.globalAlpha = alpha;
  g.translate(x - size * 0.42, y - size * 0.03);
  g.scale(size / 100, size / 100);
  g.fillStyle = "#f2f5fa";
  g.strokeStyle = "rgba(10,14,24,0.6)";
  g.lineWidth = 4;
  const shape = new Path2D();
  shape.roundRect(33, 3, 17, 62, 8.5);
  shape.roundRect(53, 44, 14, 26, 7);
  shape.roundRect(70, 47, 13, 24, 6.5);
  shape.roundRect(86, 51, 11, 22, 5.5);
  shape.moveTo(31, 58);
  shape.lineTo(97, 58);
  shape.lineTo(97, 74);
  shape.bezierCurveTo(97, 87, 87, 97, 74, 97);
  shape.lineTo(53, 97);
  shape.bezierCurveTo(40, 97, 31, 88, 31, 76);
  shape.closePath();
  g.stroke(shape);
  g.fill(shape);
  g.restore();
};

const drawKnob = (g: G, x: number, y: number, r: number, accent: string, bright: boolean) => {
  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = r * 0.6;
  g.shadowOffsetY = r * 0.2;
  const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.35, bright ? accent : rgba(accent, 0.75));
  grad.addColorStop(1, rgba("#10151f", 0.95));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.restore();
};

const drawLever = (g: G, l: Lever, value: number, s: PadState, active: boolean, help: boolean) => {
  const { x0, y0, x1, y1, knob } = l;
  g.save();
  g.lineCap = "round";
  g.strokeStyle = "rgba(10,14,24,0.7)";
  g.lineWidth = knob * 1.5;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = rgba(s.accent, active ? 0.9 : 0.5);
  g.lineWidth = 6;
  g.stroke();
  // Arrow tips at each end show which way it tips the board.
  const ang = Math.atan2(y1 - y0, x1 - x0);
  for (const [px, py, a] of [
    [x0, y0, ang + Math.PI],
    [x1, y1, ang],
  ] as const) {
    g.fillStyle = rgba(s.accent, 0.55);
    g.beginPath();
    g.moveTo(px + Math.cos(a) * knob * 0.95, py + Math.sin(a) * knob * 0.95);
    g.lineTo(px + Math.cos(a + 2.4) * knob * 0.5, py + Math.sin(a + 2.4) * knob * 0.5);
    g.lineTo(px + Math.cos(a - 2.4) * knob * 0.5, py + Math.sin(a - 2.4) * knob * 0.5);
    g.closePath();
    g.fill();
  }
  const f = (value + 1) / 2;
  const kx = x0 + (x1 - x0) * f;
  const ky = y0 + (y1 - y0) * f;
  drawKnob(g, kx, ky, knob * 0.62, s.accent, active || help);
  g.restore();
  return { x: kx, y: ky };
};

export const createOverlay = (root: HTMLElement): Overlay => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;";
  root.append(canvas);
  const g = canvas.getContext("2d");
  let layout: Layout | null = null;
  let k = 1;

  return {
    setup(l, frame) {
      layout = l;
      const ratio = Math.min(frame.pixelRatio, 2);
      canvas.width = Math.max(1, Math.round(frame.width * ratio));
      canvas.height = Math.max(1, Math.round(frame.height * ratio));
      k = frame.unit * ratio;
    },
    draw(states, time) {
      if (!g || !layout) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(k, 0, 0, k, 0, 0);
      layout.boards.forEach((slot, i) => {
        const s = states[i];
        if (!s) return;
        let hand: { x: number; y: number } | null = null;
        if (slot.pad) {
          const { x, y, r } = slot.pad;
          g.save();
          g.fillStyle = "rgba(8,11,20,0.62)";
          g.beginPath();
          g.arc(x, y, r, 0, TAU);
          g.fill();
          // The pad tips with the board: lighter on the raised side, darker where it goes down.
          const tl = Math.hypot(s.tilt.x, s.tilt.y);
          if (tl > 0.02) {
            const ux = s.tilt.x / tl;
            const uy = s.tilt.y / tl;
            const grad = g.createLinearGradient(x - ux * r, y - uy * r, x + ux * r, y + uy * r);
            grad.addColorStop(0, `rgba(255,255,255,${0.2 * Math.min(1, tl)})`);
            grad.addColorStop(0.5, "rgba(255,255,255,0)");
            grad.addColorStop(1, `rgba(0,0,0,${0.45 * Math.min(1, tl)})`);
            g.fillStyle = grad;
            g.beginPath();
            g.arc(x, y, r, 0, TAU);
            g.fill();
          }
          g.lineWidth = 7;
          g.strokeStyle = rgba(s.accent, s.touched ? 0.95 : 0.6);
          g.beginPath();
          g.arc(x, y, r - 4, 0, TAU);
          g.stroke();
          g.lineWidth = 3;
          g.strokeStyle = rgba(s.accent, 0.25);
          g.beginPath();
          g.arc(x, y, r * 0.5, 0, TAU);
          g.stroke();
          // Chevrons: tip it this way.
          g.fillStyle = rgba(s.accent, 0.5);
          for (let a = 0; a < 4; a++) {
            const ang = (a * Math.PI) / 2;
            const cx = x + Math.cos(ang) * r * 0.78;
            const cy = y + Math.sin(ang) * r * 0.78;
            g.beginPath();
            g.moveTo(cx + Math.cos(ang) * r * 0.1, cy + Math.sin(ang) * r * 0.1);
            g.lineTo(cx + Math.cos(ang + 2.3) * r * 0.08, cy + Math.sin(ang + 2.3) * r * 0.08);
            g.lineTo(cx + Math.cos(ang - 2.3) * r * 0.08, cy + Math.sin(ang - 2.3) * r * 0.08);
            g.closePath();
            g.fill();
          }
          const kx = x + s.command.x * r * 0.78;
          const ky = y + s.command.y * r * 0.78;
          if (!s.touched && !s.ghost) {
            // Idle: the knob breathes in the middle.
            const b = 1 + 0.06 * Math.sin(time * 2.4);
            drawKnob(g, kx, ky, r * 0.26 * b, s.accent, false);
          } else {
            drawKnob(g, kx, ky, r * 0.28, s.accent, true);
          }
          g.restore();
          if (s.ghost) hand = { x: kx, y: ky };
          if (s.ghost) drawHand(g, hand!.x, hand!.y, r * 0.9, 0.55);
        }
        if (slot.levers) {
          const h = drawLever(g, slot.levers.h, s.command.x, s, s.lever.h, s.lever.helpH);
          const v = drawLever(g, slot.levers.v, s.command.y, s, s.lever.v, s.lever.helpV);
          if (s.ghost) {
            drawHand(g, h.x, h.y, slot.levers.h.knob * 2, 0.55);
            drawHand(g, v.x, v.y, slot.levers.v.knob * 2, 0.55);
          } else {
            if (s.lever.helpH) drawHand(g, h.x, h.y, slot.levers.h.knob * 2, 0.35);
            if (s.lever.helpV) drawHand(g, v.x, v.y, slot.levers.v.knob * 2, 0.35);
          }
        }
        // The level, between its buttons.
        const lb = slot.label;
        const pulse = s.bumped < 1.2 ? 1 + 0.25 * Math.sin((s.bumped / 1.2) * Math.PI) : 1;
        g.save();
        g.translate(lb.x, lb.y);
        g.scale(pulse, pulse);
        g.fillStyle = "rgba(8,11,20,0.55)";
        g.beginPath();
        g.roundRect(-58, -48, 116, 96, 24);
        g.fill();
        g.fillStyle = s.bumped < 1.2 ? "#ffe08a" : "#f2f5fa";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `800 ${lb.size}px system-ui, sans-serif`;
        g.fillText(String(s.level), 0, 4);
        g.restore();
      });
    },
    dispose() {
      canvas.remove();
    },
  };
};
