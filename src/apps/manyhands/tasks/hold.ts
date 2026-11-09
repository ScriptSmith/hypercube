/**
 * Hold: hold both pads at once for 2 s, with two hands or two children. On a panel the pads are
 * at most 500 venue px apart so one child can span them.
 */
import { hold } from "../gesture";
import {
  circle,
  clamp,
  dist,
  paced,
  SOFT,
  type Task,
  type TaskDef,
  type TaskEnv,
  TAU,
} from "./common";

const HOLD_S = 2;

export const createHold = (env: TaskEnv): Task => {
  const { w, h } = env;
  // About 0.6 m apart on the wall, which is coarser in px per metre than a panel.
  const gap = Math.min(env.coarse ? 300 : 420, w * 0.62);
  const r = clamp(Math.min(h * 0.2, (w - gap) * 0.45), env.target * 0.58, env.target * 0.85);
  const y = h * 0.6;
  const pads = [
    { x: w / 2 - gap / 2, y },
    { x: w / 2 + gap / 2, y },
  ];
  const on = [new Set<number>(), new Set<number>()];
  const pos = new Map<number, number>();
  let fill = 0;
  let t = 0;
  let finished = false;

  const padAt = (x: number, yy: number) => {
    for (let i = 0; i < pads.length; i++) {
      if (dist(x, yy, pads[i]!.x, pads[i]!.y) <= r * 1.3) return i;
    }
    return -1;
  };
  const release = (id: number) => {
    const i = pos.get(id);
    if (i !== undefined) on[i]!.delete(id);
    pos.delete(id);
  };

  return {
    id: "hold",
    get progress() {
      return fill;
    },
    get done() {
      return finished;
    },
    down(id, x, yy) {
      const i = padAt(x, yy);
      if (i < 0) return;
      release(id);
      on[i]!.add(id);
      pos.set(id, i);
    },
    move(id, x, yy) {
      const i = pos.get(id);
      if (i === undefined) return;
      if (dist(x, yy, pads[i]!.x, pads[i]!.y) > r * 1.7) release(id);
    },
    up(id) {
      release(id);
    },
    update(dt) {
      t += dt;
      if (finished) return;
      const both = on[0]!.size > 0 && on[1]!.size > 0;
      fill = both ? fill + dt / HOLD_S : Math.max(0, fill - dt / 1.2);
      if (fill >= 1) {
        fill = 1;
        finished = true;
      }
    },
    draw(g) {
      const both = on[0]!.size > 0 && on[1]!.size > 0;
      // The bar between the pads fills while both are held.
      const bx = pads[0]!.x;
      const bw = pads[1]!.x - bx;
      const bh = r * 0.36;
      g.fillStyle = SOFT;
      g.fillRect(bx, y - bh / 2, bw, bh);
      g.fillStyle = env.color;
      g.fillRect(bx + bw * (0.5 - fill / 2), y - bh / 2, bw * fill, bh);
      pads.forEach((p, i) => {
        const pressed = on[i]!.size > 0;
        const pulse = pressed ? 0 : (Math.sin(t * 4 + i * Math.PI) + 1) / 2;
        g.fillStyle = `rgba(255,255,255,${0.06 + pulse * 0.08})`;
        circle(g, p.x, p.y, r * (1.18 + pulse * 0.08));
        g.fill();
        g.fillStyle = pressed ? env.color : "#2b3a5c";
        circle(g, p.x, p.y, r);
        g.fill();
        g.lineWidth = Math.max(5, r * 0.08);
        g.strokeStyle = env.color;
        g.stroke();
        // An open hand on each pad.
        g.fillStyle = pressed ? "#0b1222" : "rgba(230,238,255,0.85)";
        const s = r * 0.5;
        g.beginPath();
        g.ellipse(p.x, p.y + s * 0.25, s * 0.55, s * 0.5, 0, 0, TAU);
        g.fill();
        for (let f = 0; f < 4; f++) {
          const fx = p.x - s * 0.42 + f * s * 0.28;
          g.beginPath();
          g.ellipse(fx, p.y - s * 0.38, s * 0.11, s * 0.36, 0, 0, TAU);
          g.fill();
        }
        g.beginPath();
        g.ellipse(
          p.x + (i === 0 ? s * 0.6 : -s * 0.6),
          p.y + s * 0.05,
          s * 0.12,
          s * 0.3,
          i === 0 ? -0.7 : 0.7,
          0,
          TAU,
        );
        g.fill();
      });
      if (both && !finished) {
        g.strokeStyle = "rgba(255,255,255,0.8)";
        g.lineWidth = 6;
        g.beginPath();
        g.arc(w / 2, y, bh * 1.4, -Math.PI / 2, -Math.PI / 2 + TAU * fill);
        g.stroke();
      }
    },
    bot(pace) {
      if (finished) return null;
      return hold(pads, HOLD_S * 1000 + paced(260, pace));
    },
  };
};

export const HOLD: TaskDef = { id: "hold", band: "low", create: createHold };
