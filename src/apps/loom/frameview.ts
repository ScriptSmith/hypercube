/**
 * Drawing a touch frame: each harmonic's slider and dial, its thread rising from the top of the
 * dial, and on solo frames (or a bank frame standing in for its screen) the picture and cloth
 * above. One Canvas2D canvas, redrawn every frame, in venue px.
 */
import type { FrameInfo } from "../../core/types";
import type { Band } from "./cloth";
import { TAU } from "./config";
import {
  type Box,
  createClothPainter,
  drawHand,
  drawPicture,
  drawThread,
  type PictureState,
} from "./draw";
import { type Layout, sliderY, type StrandSpec } from "./layout";
import { GLOW, rgba, shade } from "./palette";
import type { Term } from "./series";
import { smooth, THREAD_W, threadOffset } from "./thread";

/** Over this many venue px above the dial the thread swings out to full and bends to its column. */
const RAMP = 140;
const BEND = 260;
const STEP = 8;

export interface StrandLook {
  k: number;
  colour: string;
  amp: number;
  phase: number;
  live: boolean;
  held: boolean;
  ok: boolean;
  hint: Term | null;
}

export interface FrameLook {
  theta: number;
  /** Seconds, for pulses. */
  time: number;
  strands: StrandLook[];
  /** Threads run out of the top edge (a screen above), else end at the heddle. */
  toTop: boolean;
  picture: PictureState | null;
  pictureScale: number;
  cloth: { bands: readonly Band[]; progress: number; colours: readonly string[] } | null;
  /** 0 to 1, a match's glow. */
  glow: number;
  hand: { x: number; y: number; alpha: number } | null;
}

const dialTop = (s: StrandSpec) => s.dial.y - s.dial.r;

/** Points of a strand's thread from the top of its dial up to `top` (venue y), into `out`. */
export const threadPoints = (
  s: StrandSpec,
  top: number,
  theta: number,
  amp: number,
  phase: number,
  out: Float64Array,
): number => {
  const y0 = dialTop(s);
  let n = 0;
  for (let y = y0; ; y -= STEP) {
    const yy = Math.max(top, y);
    const dist = y0 - yy;
    const env = smooth(0, RAMP, dist);
    const bend = smooth(0, BEND, dist);
    const cx = s.dial.x + (s.col.x - s.dial.x) * bend;
    const h = -yy / s.col.w;
    if (2 * n + 1 >= out.length) break;
    out[2 * n] = cx + env * threadOffset(s.k, amp, phase, theta, h) * s.col.w;
    out[2 * n + 1] = yy;
    n++;
    if (yy <= top) break;
  }
  return n;
};

/** Where a strand's thread crosses the frame's top edge, venue x. */
export const threadEdgeX = (s: StrandSpec, theta: number, amp: number, phase: number): number =>
  s.col.x + threadOffset(s.k, amp, phase, theta, 0) * s.col.w;

export interface FrameView {
  resize(frame: FrameInfo, layout: Layout): void;
  draw(look: FrameLook): void;
  dispose(): void;
}

export const createFrameView = (root: HTMLElement, frame: FrameInfo, layout: Layout): FrameView => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  root.append(canvas);
  const g = canvas.getContext("2d");
  let f = frame;
  let l = layout;
  let k = 1;
  const pts = new Float64Array(2 * 512);
  const cloth = createClothPainter(
    Math.round(l.width / 26),
    12,
    Math.max(2, Math.round(l.width / 700)),
  );

  const size = () => {
    const ratio = Math.min(f.pixelRatio, 2);
    canvas.width = Math.max(1, Math.round(f.width * ratio));
    canvas.height = Math.max(1, Math.round(f.height * ratio));
    k = f.unit * ratio;
  };
  size();

  const line = () => (l.kind === "wall" ? 7 : l.kind === "kiosk" ? 3.5 : 4.5);

  const drawSlider = (s: StrandSpec, st: StrandLook, time: number) => {
    if (!g) return;
    const sl = s.slider;
    const dim = st.live ? 1 : 0.55;
    const tw = Math.max(36, sl.w * 0.26);
    const top = sl.y1 - sl.h / 2;
    const bottom = sl.y0 + sl.h / 2;
    g.fillStyle = "rgba(14,18,36,0.92)";
    g.strokeStyle = rgba(st.colour, 0.45 * dim);
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(sl.x - tw / 2, top, tw, bottom - top, tw / 2);
    g.fill();
    g.stroke();
    const hy = sliderY(sl, st.amp);
    // The amplitude as a bar up the track.
    g.fillStyle = rgba(st.colour, 0.4 * dim);
    g.beginPath();
    g.roundRect(sl.x - tw / 2 + 5, hy, tw - 10, Math.max(0, bottom - 5 - hy), (tw - 10) / 2);
    g.fill();
    // The hint: a notch either side of the track.
    if (st.hint) {
      const ny = sliderY(sl, st.hint.amp);
      const ok = Math.abs(st.amp - st.hint.amp) < 0.06;
      const nw = sl.w * 0.2;
      g.fillStyle = ok ? rgba(GLOW, 0.95) : "rgba(242,245,250,0.75)";
      for (const side of [-1, 1]) {
        const x0 = sl.x + side * (sl.w / 2 + 10);
        g.beginPath();
        g.moveTo(x0 + side * nw, ny - nw * 0.6);
        g.lineTo(x0, ny);
        g.lineTo(x0 + side * nw, ny + nw * 0.6);
        g.closePath();
        g.fill();
      }
    }
    // The handle.
    const hw = sl.w;
    const hh = sl.h;
    const pulse = st.held ? 1 : 0.5 + 0.5 * Math.sin(time * 3 + st.k);
    if (st.held) {
      g.fillStyle = rgba(st.colour, 0.25);
      g.beginPath();
      g.roundRect(sl.x - hw / 2 - 14, hy - hh / 2 - 14, hw + 28, hh + 28, hh / 3 + 14);
      g.fill();
    }
    g.fillStyle = st.live ? st.colour : shade(st.colour, -0.35);
    g.beginPath();
    g.roundRect(sl.x - hw / 2, hy - hh / 2, hw, hh, hh / 3);
    g.fill();
    g.strokeStyle = st.held ? "#ffffff" : rgba("#ffffff", 0.25 + 0.15 * pulse * (st.live ? 0 : 1));
    g.lineWidth = st.held ? 6 : 3;
    g.stroke();
    g.strokeStyle = "rgba(5,7,13,0.45)";
    g.lineWidth = 5;
    for (const d of [-0.22, 0, 0.22]) {
      g.beginPath();
      g.moveTo(sl.x - hw * 0.28, hy + d * hh);
      g.lineTo(sl.x + hw * 0.28, hy + d * hh);
      g.stroke();
    }
  };

  const drawDial = (s: StrandSpec, st: StrandLook) => {
    if (!g) return;
    const d = s.dial;
    const dim = st.live ? 1 : 0.55;
    g.fillStyle = "rgba(14,18,36,0.94)";
    g.beginPath();
    g.arc(d.x, d.y, d.r, 0, TAU);
    g.fill();
    if (st.ok) {
      g.strokeStyle = rgba(GLOW, 0.5);
      g.lineWidth = Math.max(3, d.r * 0.035);
      g.beginPath();
      g.arc(d.x, d.y, d.r * 1.06, 0, TAU);
      g.stroke();
    }
    g.strokeStyle = rgba(st.colour, (st.held ? 1 : 0.7) * dim);
    g.lineWidth = d.r * 0.09;
    g.beginPath();
    g.arc(d.x, d.y, d.r * 0.94, 0, TAU);
    g.stroke();
    // Ticks every twelfth of a turn.
    g.strokeStyle = rgba(st.colour, 0.35 * dim);
    g.lineWidth = d.r * 0.025;
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      g.moveTo(d.x + Math.cos(a) * d.r * 0.72, d.y + Math.sin(a) * d.r * 0.72);
      g.lineTo(d.x + Math.cos(a) * d.r * 0.82, d.y + Math.sin(a) * d.r * 0.82);
    }
    g.stroke();
    // The hint notch outside the ring (none when the hint wants no amplitude).
    if (st.hint && st.hint.amp > 0.03) {
      const a = st.hint.phase - Math.PI / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const r0 = d.r * 0.98;
      const nw = d.r * 0.16;
      g.fillStyle = st.ok ? GLOW : "rgba(242,245,250,0.8)";
      g.beginPath();
      g.moveTo(d.x + ca * r0, d.y + sa * r0);
      g.lineTo(
        d.x + ca * (r0 + nw * 1.2) - sa * nw * 0.7,
        d.y + sa * (r0 + nw * 1.2) + ca * nw * 0.7,
      );
      g.lineTo(
        d.x + ca * (r0 + nw * 1.2) + sa * nw * 0.7,
        d.y + sa * (r0 + nw * 1.2) - ca * nw * 0.7,
      );
      g.closePath();
      g.fill();
    }
    // The pointer: the phase, clockwise from the top.
    const a = st.phase - Math.PI / 2;
    const kx = d.x + Math.cos(a) * d.r * 0.7;
    const ky = d.y + Math.sin(a) * d.r * 0.7;
    g.strokeStyle = rgba(st.colour, dim);
    g.lineWidth = d.r * 0.07;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(d.x + Math.cos(a) * d.r * 0.3, d.y + Math.sin(a) * d.r * 0.3);
    g.lineTo(kx, ky);
    g.stroke();
    g.fillStyle = st.live ? st.colour : shade(st.colour, -0.35);
    g.beginPath();
    g.arc(kx, ky, d.r * 0.17, 0, TAU);
    g.fill();
    g.strokeStyle = st.held ? "#ffffff" : "rgba(255,255,255,0.3)";
    g.lineWidth = st.held ? 5 : 2.5;
    g.stroke();
    // The harmonic's number.
    g.fillStyle = rgba(st.colour, 0.95 * dim);
    g.font = `700 ${Math.round(d.r * 0.52)}px system-ui, "Segoe UI", Roboto, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(st.k), d.x, d.y + d.r * 0.03);
  };

  return {
    resize(frame2, layout2) {
      f = frame2;
      l = layout2;
      size();
    },
    draw(look) {
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(k, 0, 0, k, 0, 0);
      const lw = line();

      if (look.cloth && l.cloth) {
        const box: Box = l.cloth;
        const bandH = Math.max(36, box.height / 4);
        cloth.draw(g, box, look.cloth.bands, look.cloth.colours, look.cloth.progress, bandH, lw);
      }
      if (look.picture) {
        drawPicture(
          g,
          l.picture,
          look.picture,
          look.pictureScale,
          lw,
          l.kind === "wall" ? 110 : l.kind === "kiosk" ? 42 : 56,
        );
      }

      const top = look.toTop ? 0 : l.heddle;
      // Threads under the controls, so they rise out of the dials.
      l.strands.forEach((s, i) => {
        const st = look.strands[i];
        if (!st) return;
        const n = threadPoints(s, top, look.theta, st.amp, st.phase, pts);
        const w = THREAD_W * s.col.w * (1 + 0.6 * look.glow);
        drawThread(g, pts, n, st.colour, w, st.live ? 1 : 0.6);
        if (!look.toTop && n > 0) {
          // A bead where the thread meets the heddle.
          const x = pts[2 * (n - 1)]!;
          g.beginPath();
          g.arc(x, top, Math.min(w * 1.6, lw * 3.2), 0, TAU);
          g.fillStyle = st.ok ? GLOW : st.colour;
          g.fill();
        }
      });
      if (!look.toTop) {
        g.strokeStyle = "rgba(160,176,216,0.3)";
        g.lineWidth = lw * 0.6;
        g.beginPath();
        g.moveTo(0, top);
        g.lineTo(l.width, top);
        g.stroke();
      }
      l.strands.forEach((s, i) => {
        const st = look.strands[i];
        if (!st) return;
        drawSlider(s, st, look.time);
        drawDial(s, st);
      });
      if (look.hand) {
        const size = l.kind === "wall" ? 190 : l.kind === "kiosk" ? 110 : 150;
        drawHand(g, look.hand.x, look.hand.y, size, look.hand.alpha);
      }
    },
    dispose() {
      cloth.dispose();
      canvas.remove();
    },
  };
};
