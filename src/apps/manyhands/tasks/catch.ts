/** Catch: slide the basket left and right to catch three falling parts. A miss shakes and drops another. */
import { follow } from "../gesture";
import {
  circle,
  clamp,
  createShake,
  INK,
  roundRect,
  type Task,
  type TaskDef,
  type TaskEnv,
  TAU,
} from "./common";

const CATCHES = 3;

export const createCatch = (env: TaskEnv): Task => {
  const { w, h, rng } = env;
  const bw = clamp(w * 0.3, env.target * 1.5, w * 0.48);
  const bh = clamp(h * 0.16, env.target * 0.7, h * 0.24);
  const by = h - bh - h * 0.03;
  const pr = clamp(Math.min(w, h) * 0.07, 28, env.target * 0.45);
  const fall = (h + pr) / 3.1;
  const shake = createShake();
  let bx = w / 2;
  let goal = w / 2;
  const hands = new Map<number, number>();
  let caught = 0;
  let px = 0;
  let py = -pr;
  let spin = 0;
  let wait = 0.5;
  let flash = 0;

  const drop = () => {
    px = rng.range(Math.max(pr, bw * 0.3), w - Math.max(pr, bw * 0.3));
    py = -pr;
  };
  drop();

  const steer = (x: number) => {
    goal = clamp(x, bw / 2, w - bw / 2);
  };

  return {
    id: "catch",
    get progress() {
      return caught / CATCHES;
    },
    get done() {
      return caught >= CATCHES;
    },
    down(id, x, y) {
      if (y < h * 0.25) return;
      hands.set(id, x);
      steer(x);
    },
    move(id, x) {
      if (!hands.has(id)) return;
      hands.set(id, x);
      steer(x);
    },
    up(id) {
      hands.delete(id);
    },
    update(dt) {
      shake.update(dt);
      flash = Math.max(0, flash - dt);
      const max = 2600 * dt;
      bx += clamp(goal - bx, -max, max);
      if (caught >= CATCHES) return;
      if (wait > 0) {
        wait -= dt;
        return;
      }
      py += fall * dt;
      spin += dt * 2;
      if (py + pr >= by && py - pr < by + bh * 0.3) {
        if (Math.abs(px - bx) <= bw / 2 + pr * 0.4) {
          caught++;
          flash = 0.35;
          drop();
          wait = caught >= CATCHES ? 0 : 0.45;
          return;
        }
      }
      if (py - pr > h) {
        shake.kick();
        drop();
        wait = 0.5;
      }
    },
    draw(g) {
      const sx = shake.dx(w);
      if (caught < CATCHES && wait <= 0) {
        // A falling gear.
        g.save();
        g.translate(px, py);
        g.rotate(spin);
        g.fillStyle = env.color;
        g.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU;
          const rr = i % 2 === 0 ? pr : pr * 0.78;
          g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        g.closePath();
        g.fill();
        g.fillStyle = INK;
        circle(g, 0, 0, pr * 0.32);
        g.fill();
        g.restore();
        // Where it will land, faint, to help small players.
        g.fillStyle = "rgba(255,255,255,0.08)";
        g.fillRect(px - pr, py + pr, pr * 2, Math.max(0, by - py - pr));
      }
      // Basket.
      const x = bx - bw / 2 + sx;
      g.fillStyle = flash > 0 ? "#ffffff" : "#c98a4b";
      g.beginPath();
      g.moveTo(x, by);
      g.lineTo(x + bw, by);
      g.lineTo(x + bw * 0.88, by + bh);
      g.lineTo(x + bw * 0.12, by + bh);
      g.closePath();
      g.fill();
      g.strokeStyle = "#7a4f25";
      g.lineWidth = Math.max(4, bh * 0.05);
      for (let i = 1; i < 4; i++) {
        const yy = by + (bh * i) / 4;
        const inset = (bw * 0.12 * i) / 4;
        g.beginPath();
        g.moveTo(x + inset, yy);
        g.lineTo(x + bw - inset, yy);
        g.stroke();
      }
      g.fillStyle = "#e0a868";
      roundRect(g, x - bw * 0.03, by - bh * 0.12, bw * 1.06, bh * 0.2, bh * 0.1);
      g.fill();
      // Caught gears sit in the basket.
      for (let i = 0; i < caught; i++) {
        g.fillStyle = env.color;
        circle(g, x + bw * (0.3 + i * 0.2), by + bh * 0.25, Math.min(pr * 0.7, bh * 0.3));
        g.fill();
      }
      // Arrows either side, while nobody steers.
      if (hands.size === 0 && caught < CATCHES) {
        g.fillStyle = "rgba(230,238,255,0.55)";
        for (const s of [-1, 1]) {
          const ax = bx + sx + s * (bw / 2 + bh * 0.45);
          const ay = by + bh / 2;
          const a = bh * 0.28;
          g.beginPath();
          g.moveTo(ax + s * a, ay);
          g.lineTo(ax - s * a * 0.4, ay - a);
          g.lineTo(ax - s * a * 0.4, ay + a);
          g.closePath();
          g.fill();
        }
      }
    },
    bot(pace) {
      if (caught >= CATCHES) return null;
      return follow(
        { x: bx, y: by + bh / 2 },
        () => (caught >= CATCHES ? null : { x: clamp(px, bw / 2, w - bw / 2), y: by + bh / 2 }),
        1500 * pace,
        25_000,
      );
    },
  };
};

export const CATCH: TaskDef = { id: "catch", band: "low", create: createCatch };
