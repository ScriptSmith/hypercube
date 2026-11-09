/**
 * Gauge: slide the valve until the needle sits in the marked zone, and keep it there for 2 s
 * while the zone drifts. Leaving the zone lets the timer run back slowly; nothing resets.
 */
import { follow } from "../gesture";
import {
  circle,
  clamp,
  INK,
  roundRect,
  SOFT,
  type Task,
  type TaskDef,
  type TaskEnv,
  TAU,
} from "./common";

const HOLD_S = 2;
const ZONE = 0.11;

export const createGauge = (env: TaskEnv): Task => {
  const { w, h, rng } = env;
  const wide = w > h * 1.5;
  const knob = clamp(env.target * 0.55, 60, env.target * 0.7);
  // Tall areas get a dial (a half circle, its pivot at the bottom centre) over the valve;
  // short wide ones a straight gauge along the top with the valve below it.
  const dr = Math.min(w * 0.4, h * 0.46);
  const dx = w / 2;
  const dy = h * 0.06 + dr;
  const tx0 = wide ? knob * 1.15 : w * 0.1 + knob;
  const tx1 = wide ? w - knob * 1.15 : w * 0.9 - knob;
  const ty = wide ? h - knob - h * 0.06 : Math.min(h - knob * 1.3, dy + (h - dy) * 0.55);
  const bar = { y: h * 0.07, h: Math.max(30, (ty - knob - h * 0.07) * 0.55) };
  const phase = rng.range(0, TAU);
  let value = rng.next() < 0.5 ? 0.06 : 0.94;
  let needle = value;
  let held = 0;
  let t = 0;
  let finger: number | null = null;
  let finished = false;

  const zone = () => 0.5 + 0.3 * Math.sin(t * 0.33 + phase);
  const xOf = (v: number) => tx0 + (tx1 - tx0) * v;
  const set = (x: number) => {
    value = clamp((x - tx0) / (tx1 - tx0), 0, 1);
  };
  const angleOf = (v: number) => Math.PI + v * Math.PI;

  return {
    id: "gauge",
    get progress() {
      return held / HOLD_S;
    },
    get done() {
      return finished;
    },
    down(id, x, y) {
      if (finger !== null || finished) return;
      const onKnob = Math.hypot(x - xOf(value), y - ty) <= knob * 1.5;
      const onTrack = x >= tx0 - knob && x <= tx1 + knob && Math.abs(y - ty) <= knob * 1.3;
      if (!onKnob && !onTrack) return;
      finger = id;
      set(x);
    },
    move(id, x) {
      if (id === finger && !finished) set(x);
    },
    up(id) {
      if (id === finger) finger = null;
    },
    update(dt) {
      t += dt;
      needle += (value - needle) * Math.min(1, dt * 5);
      if (finished) return;
      const inZone = Math.abs(needle - zone()) <= ZONE;
      held = inZone ? held + dt : Math.max(0, held - dt * 0.5);
      if (held >= HOLD_S) {
        held = HOLD_S;
        finished = true;
      }
    },
    draw(g, time) {
      const z = zone();
      if (wide) {
        g.fillStyle = "#e9eef8";
        roundRect(g, tx0 - knob * 0.4, bar.y, tx1 - tx0 + knob * 0.8, bar.h, bar.h * 0.3);
        g.fill();
        g.fillStyle = "#59c27a";
        g.fillRect(xOf(clamp(z - ZONE, 0, 1)), bar.y, (tx1 - tx0) * ZONE * 2, bar.h);
        g.fillStyle = env.color;
        g.fillRect(
          tx0 - knob * 0.4,
          bar.y + bar.h * 0.8,
          (tx1 - tx0 + knob * 0.8) * (held / HOLD_S),
          bar.h * 0.2,
        );
        const nx = xOf(needle);
        g.fillStyle = INK;
        g.fillRect(nx - 4, bar.y, 8, bar.h);
        const s = Math.min(knob * 0.4, (ty - knob - bar.y - bar.h) * 0.8);
        g.fillStyle = "#e9eef8";
        g.beginPath();
        g.moveTo(nx, bar.y + bar.h + 2);
        g.lineTo(nx + s * 0.7, bar.y + bar.h + 2 + s);
        g.lineTo(nx - s * 0.7, bar.y + bar.h + 2 + s);
        g.closePath();
        g.fill();
      } else {
        g.fillStyle = "#e9eef8";
        g.beginPath();
        g.arc(dx, dy, dr, Math.PI, TAU);
        g.closePath();
        g.fill();
        g.strokeStyle = "#59c27a";
        g.lineWidth = dr * 0.2;
        g.beginPath();
        g.arc(dx, dy, dr * 0.8, angleOf(clamp(z - ZONE, 0, 1)), angleOf(clamp(z + ZONE, 0, 1)));
        g.stroke();
        g.strokeStyle = "#9aa6bf";
        g.lineWidth = Math.max(3, dr * 0.025);
        for (let i = 0; i <= 10; i++) {
          const a = angleOf(i / 10);
          g.beginPath();
          g.moveTo(dx + Math.cos(a) * dr * 0.9, dy + Math.sin(a) * dr * 0.9);
          g.lineTo(dx + Math.cos(a) * dr * 0.98, dy + Math.sin(a) * dr * 0.98);
          g.stroke();
        }
        // A ring round the pivot fills while the needle stays in the zone.
        g.strokeStyle = env.color;
        g.lineWidth = dr * 0.07;
        g.beginPath();
        g.arc(dx, dy, dr * 0.2, Math.PI, Math.PI + Math.PI * (held / HOLD_S));
        g.stroke();
        const a = angleOf(needle);
        g.strokeStyle = INK;
        g.lineWidth = Math.max(6, dr * 0.05);
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(dx, dy);
        g.lineTo(dx + Math.cos(a) * dr * 0.86, dy + Math.sin(a) * dr * 0.86);
        g.stroke();
        g.fillStyle = INK;
        circle(g, dx, dy, dr * 0.08);
        g.fill();
      }
      // Valve track and knob.
      g.fillStyle = SOFT;
      roundRect(
        g,
        tx0 - knob * 0.4,
        ty - knob * 0.32,
        tx1 - tx0 + knob * 0.8,
        knob * 0.64,
        knob * 0.32,
      );
      g.fill();
      if (!wide) {
        g.fillStyle = "rgba(89,194,122,0.35)";
        g.fillRect(
          xOf(clamp(z - ZONE, 0, 1)),
          ty - knob * 0.32,
          (tx1 - tx0) * ZONE * 2,
          knob * 0.64,
        );
      }
      const kx = xOf(value);
      const pulse = finger === null && !finished ? (Math.sin(time * 4) + 1) * 0.05 : 0;
      g.fillStyle = env.color;
      circle(g, kx, ty, knob * (1 + pulse));
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = INK;
      g.lineWidth = Math.max(4, knob * 0.1);
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(kx + s * knob * 0.25, ty - knob * 0.35);
        g.lineTo(kx + s * knob * 0.25, ty + knob * 0.35);
        g.stroke();
      }
    },
    bot(pace) {
      if (finished) return null;
      return follow(
        { x: xOf(value), y: ty },
        () => (finished ? null : { x: xOf(zone()), y: ty }),
        1300 * pace,
        25_000,
      );
    },
  };
};

export const GAUGE: TaskDef = { id: "gauge", band: "high", create: createGauge };
