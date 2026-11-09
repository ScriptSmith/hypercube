/**
 * Crank: turn the handle three times around the hub, either way. Turning winds a rope that lifts
 * a crate. Only the net turn counts, so wiggling back and forth doesn't.
 */
import type { Gesture } from "../gesture";
import {
  circle,
  clamp,
  INK,
  paced,
  roundRect,
  SOFT,
  type Task,
  type TaskDef,
  type TaskEnv,
  TAU,
} from "./common";

const TURNS = 3;

export const createCrank = (env: TaskEnv): Task => {
  const { w, h } = env;
  const wide = w > h * 1.8;
  const knob = Math.max(env.target * 0.4, 46);
  const R = Math.max(knob * 1.05, Math.min(h / 2 - knob - 8, Math.min(w, h) * 0.36));
  const cx = wide ? R + knob + w * 0.08 : w * 0.4;
  const cy = h / 2;
  const colX = wide ? w * 0.72 : Math.min(w - knob, cx + R + knob + (w - cx - R - knob) / 2);
  const crate = Math.min(knob * 1.5, wide ? h * 0.36 : w * 0.16);
  let angle = -Math.PI / 2;
  let total = 0;
  let finger: number | null = null;
  let last = 0;

  const done = () => Math.abs(total) >= TURNS * TAU;
  const toAngle = (x: number, y: number) => Math.atan2(y - cy, x - cx);

  return {
    id: "crank",
    get progress() {
      return Math.min(1, Math.abs(total) / (TURNS * TAU));
    },
    get done() {
      return done();
    },
    down(id, x, y) {
      if (finger !== null || done()) return;
      const d = Math.hypot(x - cx, y - cy);
      if (d > R + knob * 1.9 || d < R * 0.2) return;
      finger = id;
      last = toAngle(x, y);
    },
    move(id, x, y) {
      if (id !== finger || done()) return;
      const d = Math.hypot(x - cx, y - cy);
      if (d < R * 0.2) return;
      const a = toAngle(x, y);
      let da = a - last;
      if (da > Math.PI) da -= TAU;
      if (da < -Math.PI) da += TAU;
      last = a;
      total += da;
      angle += da;
    },
    up(id) {
      if (id === finger) finger = null;
    },
    update() {},
    draw(g, time) {
      const p = Math.min(1, Math.abs(total) / (TURNS * TAU));
      // Rope and crate.
      const top = h * 0.08;
      const bottom = h - crate - h * 0.06;
      const cyCrate = bottom - (bottom - top) * p;
      g.strokeStyle = "#b99a6b";
      g.lineWidth = Math.max(4, knob * 0.1);
      g.beginPath();
      g.moveTo(cx, cy - R * 0.32);
      g.lineTo(colX, top);
      g.lineTo(colX, cyCrate);
      g.stroke();
      g.fillStyle = "#7c8db0";
      circle(g, colX, top, knob * 0.32);
      g.fill();
      g.fillStyle = "#b5813d";
      roundRect(g, colX - crate / 2, cyCrate, crate, crate, crate * 0.1);
      g.fill();
      g.strokeStyle = "#6b4520";
      g.lineWidth = Math.max(3, crate * 0.06);
      g.beginPath();
      g.moveTo(colX - crate / 2, cyCrate);
      g.lineTo(colX + crate / 2, cyCrate + crate);
      g.moveTo(colX + crate / 2, cyCrate);
      g.lineTo(colX - crate / 2, cyCrate + crate);
      g.stroke();
      // Wheel and spokes.
      g.fillStyle = SOFT;
      circle(g, cx, cy, R + knob * 0.5);
      g.fill();
      g.strokeStyle = "#8ea0c6";
      g.lineWidth = Math.max(8, R * 0.08);
      circle(g, cx, cy, R);
      g.stroke();
      for (let i = 0; i < 4; i++) {
        const a = angle + (i * TAU) / 4;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        g.stroke();
      }
      g.fillStyle = "#c9d3ea";
      circle(g, cx, cy, R * 0.22);
      g.fill();
      // Turn pips round the hub.
      for (let i = 0; i < TURNS; i++) {
        const a = -Math.PI / 2 + (i - 1) * 0.5;
        g.fillStyle = Math.abs(total) >= (i + 1) * TAU ? env.color : "rgba(11,18,34,0.7)";
        circle(g, cx + Math.cos(a) * R * 0.12, cy + Math.sin(a) * R * 0.12 + R * 0.02, R * 0.045);
        g.fill();
      }
      // The handle, pulsing while nobody turns it.
      const kx = cx + Math.cos(angle) * R;
      const ky = cy + Math.sin(angle) * R;
      const pulse = finger === null && !done() ? (Math.sin(time * 4) + 1) * 0.06 : 0;
      g.fillStyle = env.color;
      circle(g, kx, ky, knob * (1 + pulse));
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 5;
      g.stroke();
      // A curved arrow showing the way round.
      if (finger === null && !done()) {
        g.strokeStyle = "rgba(230,238,255,0.6)";
        g.lineWidth = Math.max(5, knob * 0.14);
        g.beginPath();
        g.arc(cx, cy, R + knob * 1.35, angle + 0.35, angle + 1.25);
        g.stroke();
        const a = angle + 1.25;
        const ax = cx + Math.cos(a) * (R + knob * 1.35);
        const ay = cy + Math.sin(a) * (R + knob * 1.35);
        const s = knob * 0.35;
        g.fillStyle = "rgba(230,238,255,0.6)";
        g.beginPath();
        g.moveTo(ax + Math.cos(a + Math.PI / 2) * s, ay + Math.sin(a + Math.PI / 2) * s);
        g.lineTo(ax + Math.cos(a) * s * 0.8, ay + Math.sin(a) * s * 0.8);
        g.lineTo(ax - Math.cos(a) * s * 0.8, ay - Math.sin(a) * s * 0.8);
        g.closePath();
        g.fill();
      }
    },
    bot(pace): Gesture | null {
      if (done()) return null;
      const period = paced(900, pace);
      const a0 = angle;
      const left = (TURNS * TAU - Math.abs(total)) / TAU + 0.15;
      const turns = clamp(left, 0.2, TURNS + 0.2);
      const ms = turns * period;
      const dir = total < 0 ? -1 : 1;
      return {
        at(t) {
          if (t > ms + 120) return null;
          const a = a0 + dir * (Math.min(t, ms) / period) * TAU;
          return [{ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }];
        },
      };
    },
  };
};

export const CRANK: TaskDef = { id: "crank", band: "high", create: createCrank };
