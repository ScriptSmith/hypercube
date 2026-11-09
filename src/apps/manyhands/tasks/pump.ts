/** Pump: press the big handle eight times to fill the tank. */
import { hold } from "../gesture";
import {
  clamp,
  inside,
  INK,
  LINE,
  paced,
  roundRect,
  SOFT,
  type Task,
  type TaskDef,
  type TaskEnv,
} from "./common";

const PRESSES = 8;
/** Presses closer together than this count once, so a drumming hand isn't a shortcut. */
const MIN_GAP_S = 0.14;

export const createPump = (env: TaskEnv): Task => {
  const { w, h } = env;
  const handleW = clamp(w * 0.46, env.target * 1.6, w * 0.6);
  const handleH = clamp(h * 0.2, env.target * 0.9, h * 0.3);
  const pumpX = w * 0.36;
  const handle = { x: pumpX - handleW / 2, y: h * 0.12, w: handleW, h: handleH };
  const travel = h * 0.16;
  const tank = { x: w * 0.68, y: h * 0.18, w: Math.min(w * 0.26, h * 0.5), h: h * 0.7 };
  const body = { x: pumpX - handleW * 0.22, y: h * 0.5, w: handleW * 0.44, h: h * 0.42 };
  const held = new Set<number>();
  let presses = 0;
  let level = 0;
  let push = 0;
  let since = 1;
  let t = 0;

  return {
    id: "pump",
    get progress() {
      return presses / PRESSES;
    },
    get done() {
      return presses >= PRESSES;
    },
    down(id, x, y) {
      if (presses >= PRESSES) return;
      if (!inside(handle, x, y - push * travel, env.target * 0.35)) return;
      held.add(id);
      if (since >= MIN_GAP_S) {
        presses++;
        since = 0;
      }
    },
    move() {},
    up(id) {
      held.delete(id);
    },
    update(dt) {
      t += dt;
      since += dt;
      const goal = held.size > 0 ? 1 : 0;
      push += (goal - push) * Math.min(1, dt * (goal ? 22 : 9));
      level += (presses / PRESSES - level) * Math.min(1, dt * 5);
    },
    draw(g) {
      const dy = push * travel;
      // Pipe from the pump to the tank.
      g.strokeStyle = "#5d6f93";
      g.lineWidth = Math.max(10, w * 0.03);
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(body.x + body.w, body.y + body.h * 0.75);
      g.lineTo(tank.x - 6, body.y + body.h * 0.75);
      g.stroke();
      // Pump body and rod.
      g.fillStyle = "#3a4b70";
      roundRect(g, body.x, body.y, body.w, body.h, body.w * 0.18);
      g.fill();
      g.fillStyle = "#93a3c4";
      g.fillRect(
        pumpX - handleW * 0.05,
        handle.y + handle.h + dy,
        handleW * 0.1,
        body.y - handle.y - handle.h - dy + 8,
      );
      // Handle.
      const hy = handle.y + dy;
      g.fillStyle = env.color;
      roundRect(g, handle.x, hy, handle.w, handle.h, handle.h * 0.45);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 6;
      g.stroke();
      // A down arrow on the handle, bobbing while it waits.
      const bob = presses < PRESSES ? Math.sin(t * 5) * handle.h * 0.06 : 0;
      g.fillStyle = INK;
      const ax = pumpX;
      const ay = hy + handle.h / 2 + bob;
      const a = handle.h * 0.28;
      g.beginPath();
      g.moveTo(ax - a, ay - a * 0.5);
      g.lineTo(ax + a, ay - a * 0.5);
      g.lineTo(ax, ay + a * 0.7);
      g.closePath();
      g.fill();
      // Tank.
      g.fillStyle = SOFT;
      roundRect(g, tank.x, tank.y, tank.w, tank.h, tank.w * 0.3);
      g.fill();
      g.save();
      roundRect(g, tank.x, tank.y, tank.w, tank.h, tank.w * 0.3);
      g.clip();
      const lh = tank.h * level;
      const wave = Math.sin(t * 6) * tank.w * 0.04 * (1 - level);
      g.fillStyle = "#4fc1f0";
      g.beginPath();
      g.moveTo(tank.x, tank.y + tank.h - lh + wave);
      g.lineTo(tank.x + tank.w, tank.y + tank.h - lh - wave);
      g.lineTo(tank.x + tank.w, tank.y + tank.h);
      g.lineTo(tank.x, tank.y + tank.h);
      g.closePath();
      g.fill();
      g.restore();
      g.strokeStyle = LINE;
      g.lineWidth = 6;
      roundRect(g, tank.x, tank.y, tank.w, tank.h, tank.w * 0.3);
      g.stroke();
      // Ticks for each press.
      g.strokeStyle = "rgba(220,230,250,0.4)";
      g.lineWidth = 3;
      for (let i = 1; i < PRESSES; i++) {
        const y = tank.y + tank.h - (tank.h * i) / PRESSES;
        g.beginPath();
        g.moveTo(tank.x + tank.w * 0.72, y);
        g.lineTo(tank.x + tank.w, y);
        g.stroke();
      }
    },
    bot(pace) {
      if (presses >= PRESSES) return null;
      const p = { x: handle.x + handle.w * 0.5, y: handle.y + handle.h * 0.5 };
      return hold([p], paced(140, pace));
    },
  };
};

export const PUMP: TaskDef = { id: "pump", band: "low", create: createPump };
