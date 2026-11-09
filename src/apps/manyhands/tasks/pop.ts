/** Pop: five bubbles drift up; tap each. A bubble that floats away comes back from below. */
import { tap } from "../gesture";
import { circle, clamp, dist, paced, type Task, type TaskDef, type TaskEnv, TAU } from "./common";

const TOTAL = 5;
const VISIBLE = 3;

interface Bubble {
  x: number;
  y: number;
  x0: number;
  phase: number;
  live: boolean;
  /** Seconds since it popped, or -1. */
  burst: number;
  bx: number;
  by: number;
}

export const createPop = (env: TaskEnv): Task => {
  const { w, h, rng } = env;
  const r = clamp(Math.min(w, h) * 0.13, env.target * 0.55, env.target * 0.95);
  const speed = h / 4.2;
  const sway = Math.min(w * 0.06, r * 0.6);
  let popped = 0;
  const spawn = (b: Bubble, first: boolean) => {
    b.x0 = rng.range(r + sway, w - r - sway);
    b.x = b.x0;
    b.y = first ? rng.range(h * 0.35, h + r) : h + r * rng.range(1, 2.2);
    b.phase = rng.range(0, TAU);
    b.live = true;
  };
  const bubbles: Bubble[] = Array.from({ length: VISIBLE }, (_, i) => {
    const b: Bubble = { x: 0, y: 0, x0: 0, phase: 0, live: true, burst: -1, bx: 0, by: 0 };
    spawn(b, true);
    b.y = h * (0.45 + 0.28 * i) + r;
    return b;
  });
  let t = 0;
  const live = () => bubbles.filter((b) => b.live);

  const hit = (x: number, y: number) => {
    let best: Bubble | null = null;
    let bd = r * 1.35;
    for (const b of bubbles) {
      if (!b.live) continue;
      const d = dist(x, y, b.x, b.y);
      if (d < bd) {
        best = b;
        bd = d;
      }
    }
    if (!best) return;
    popped++;
    best.burst = 0;
    best.bx = best.x;
    best.by = best.y;
    // Keep bubbles coming only while more are needed than are showing.
    if (TOTAL - popped >= VISIBLE) spawn(best, false);
    else best.live = false;
  };

  return {
    id: "pop",
    get progress() {
      return popped / TOTAL;
    },
    get done() {
      return popped >= TOTAL;
    },
    down(_id, x, y) {
      if (popped < TOTAL) hit(x, y);
    },
    move() {},
    up() {},
    update(dt) {
      t += dt;
      for (const b of bubbles) {
        if (b.burst >= 0) b.burst = b.burst > 0.5 ? -1 : b.burst + dt;
        if (!b.live) continue;
        b.y -= speed * dt;
        b.x = b.x0 + Math.sin(t * 1.7 + b.phase) * sway;
        if (b.y < -r) spawn(b, false);
      }
    },
    draw(g) {
      for (const b of bubbles) {
        if (b.burst >= 0) {
          const k = b.burst / 0.5;
          g.strokeStyle = `rgba(190,240,255,${(1 - k) * 0.9})`;
          g.lineWidth = r * 0.12 * (1 - k) + 2;
          circle(g, b.bx, b.by, r * (1 + k * 0.7));
          g.stroke();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU + 0.3;
            circle(g, b.bx + Math.cos(a) * r * (1 + k), b.by + Math.sin(a) * r * (1 + k), r * 0.09);
            g.fillStyle = `rgba(190,240,255,${1 - k})`;
            g.fill();
          }
        }
        if (!b.live || b.y > h + r) continue;
        const grad = g.createRadialGradient(b.x - r * 0.35, b.y - r * 0.4, r * 0.1, b.x, b.y, r);
        grad.addColorStop(0, "rgba(225,250,255,0.9)");
        grad.addColorStop(0.55, "rgba(110,200,245,0.55)");
        grad.addColorStop(1, "rgba(150,225,255,0.85)");
        g.fillStyle = grad;
        circle(g, b.x, b.y, r);
        g.fill();
        g.strokeStyle = "#d8f6ff";
        g.lineWidth = Math.max(5, r * 0.08);
        g.stroke();
        g.fillStyle = "rgba(255,255,255,0.85)";
        circle(g, b.x - r * 0.38, b.y - r * 0.4, r * 0.15);
        g.fill();
      }
    },
    bot(pace) {
      // The bubble most in view, at where it will be once the finger lands.
      let best: Bubble | null = null;
      for (const b of live()) {
        if (b.y > h - r * 0.6 || b.y < r * 0.6) continue;
        if (!best || Math.abs(b.y - h * 0.5) < Math.abs(best.y - h * 0.5)) best = b;
      }
      if (!best) return null;
      return tap({ x: best.x, y: best.y - speed * 0.02 }, paced(80, pace));
    },
  };
};

export const POP: TaskDef = { id: "pop", band: "low", create: createPop };
