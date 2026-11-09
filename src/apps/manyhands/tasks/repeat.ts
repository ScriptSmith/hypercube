/**
 * Repeat: three or four lights flash in order; tap them in the same order. A wrong light shakes
 * and the same order plays again.
 */
import { tap } from "../gesture";
import {
  circle,
  clamp,
  createShake,
  drawMark,
  paced,
  PIECES,
  type Task,
  type TaskDef,
  type TaskEnv,
} from "./common";

const ON_S = 0.55;
const OFF_S = 0.25;
/** Waiting this long for the next tap plays the order again. */
const REPLAY_S = 7;

export const createRepeat = (env: TaskEnv): Task => {
  const { w, h, rng } = env;
  // Four lights in a row, else three in a row on a short area, else four in a square.
  const four = w >= PIECES.length * env.target * 1.3;
  const three = !four && w >= 3 * env.target * 1.2 && h < w * 0.75;
  const n = three ? 3 : PIECES.length;
  const cols = four || three ? n : 2;
  const rows = four || three ? 1 : 2;
  const r = clamp(Math.min(w / cols, h / rows) * 0.36, env.target * 0.5, env.target * 0.95);
  const lights = PIECES.slice(0, n).map((_, i) => ({
    x: (w * ((i % cols) + 0.5)) / cols,
    y: (h * (Math.floor(i / cols) + 0.5)) / rows,
  }));
  const length = 3 + rng.int(2);
  const order = Array.from({ length }, () => 0);
  for (let i = 0; i < length; i++) {
    let k = rng.int(n);
    if (i > 0 && k === order[i - 1]) k = (k + 1 + rng.int(n - 1)) % n;
    order[i] = k;
  }
  const shake = createShake();
  let phase: "show" | "input" | "wrong" = "show";
  let clock = -0.6;
  let entered = 0;
  let lit = -1;
  let litFor = 0;
  let wait = 0;

  const showLit = () => {
    if (clock < 0) return -1;
    const step = Math.floor(clock / (ON_S + OFF_S));
    if (step >= length) return -1;
    return clock - step * (ON_S + OFF_S) < ON_S ? order[step]! : -1;
  };

  return {
    id: "repeat",
    get progress() {
      return entered / length;
    },
    get done() {
      return entered >= length;
    },
    down(_id, x, y) {
      if (phase !== "input" || entered >= length) return;
      let best = -1;
      let bd = r * 1.35;
      lights.forEach((l, i) => {
        const d = Math.hypot(x - l.x, y - l.y);
        if (d < bd) {
          best = i;
          bd = d;
        }
      });
      if (best < 0) return;
      lit = best;
      litFor = 0.3;
      wait = 0;
      if (best === order[entered]) {
        entered++;
      } else {
        shake.kick();
        phase = "wrong";
        clock = 0;
        entered = 0;
      }
    },
    move() {},
    up() {},
    update(dt) {
      shake.update(dt);
      litFor = Math.max(0, litFor - dt);
      if (entered >= length) return;
      clock += dt;
      if (phase === "show" && clock > length * (ON_S + OFF_S)) {
        phase = "input";
        wait = 0;
      } else if (phase === "wrong" && clock > 0.8) {
        phase = "show";
        clock = -0.3;
      } else if (phase === "input") {
        wait += dt;
        if (wait > REPLAY_S) {
          phase = "show";
          clock = -0.3;
          entered = 0;
        }
      }
    },
    draw(g, time) {
      const sx = shake.dx(w);
      const flash = phase === "show" ? showLit() : litFor > 0 ? lit : -1;
      lights.forEach((l, i) => {
        const p = PIECES[i]!;
        const on = flash === i;
        const x = l.x + sx;
        if (on) {
          g.fillStyle = "rgba(255,255,255,0.18)";
          circle(g, x, l.y, r * 1.3);
          g.fill();
        }
        g.fillStyle = on ? p.color : "#1d2742";
        circle(g, x, l.y, r);
        g.fill();
        g.lineWidth = Math.max(5, r * 0.1);
        const ready = phase === "input" && entered < length;
        const pulse = ready ? 0.55 + Math.sin(time * 5) * 0.25 : 0.35;
        g.strokeStyle = on ? "#ffffff" : p.color;
        g.globalAlpha = on ? 1 : pulse + 0.2;
        g.stroke();
        g.globalAlpha = 1;
        drawMark(g, p.mark, x, l.y, r * 0.3, on ? "#0b1222" : p.color);
      });
      // Dots for the length of the order, filled as it is entered.
      const dr = Math.min(r * 0.12, 14);
      for (let i = 0; i < length; i++) {
        const dx = w / 2 + (i - (length - 1) / 2) * dr * 3.2;
        g.fillStyle = i < entered ? env.color : "rgba(220,230,250,0.25)";
        circle(g, dx, Math.min(h - dr * 1.5, h * 0.97), dr);
        g.fill();
      }
    },
    bot(pace) {
      if (phase !== "input" || entered >= length) return null;
      const l = lights[order[entered]!]!;
      return tap(l, paced(90, pace));
    },
  };
};

export const REPEAT: TaskDef = { id: "repeat", band: "high", create: createRepeat };
