/**
 * Plug: drag three plugs to the sockets of their colour. Each cable is a curve computed from its
 * fixed end to the plug, never the finger's path. A wrong socket shakes the plug back home.
 */
import { drag } from "../gesture";
import {
  circle,
  clamp,
  createShake,
  dist,
  drawMark,
  paced,
  PIECES,
  roundRect,
  shuffled,
  type Task,
  type TaskDef,
  type TaskEnv,
} from "./common";

const PLUGS = 3;

interface Plug {
  piece: number;
  ax: number;
  ay: number;
  hx: number;
  hy: number;
  x: number;
  y: number;
  held: number | null;
  ox: number;
  oy: number;
  in: number;
}

export const createPlug = (env: TaskEnv): Task => {
  const { w, h, rng } = env;
  const pieces = shuffled(PIECES.length, rng).slice(0, PLUGS);
  const column = h >= PLUGS * env.target * 1.25 && w < h * 1.9;
  // Short areas (the wall's adult band) put plugs in a row along the top and sockets below.
  const r = column
    ? clamp(Math.min(h / (PLUGS * 2.6), w * 0.1), env.target * 0.5, env.target * 0.8)
    : clamp(Math.min(h * 0.2, w / 9), Math.max(60, env.target * 0.4), env.target * 0.75);
  const spots = (i: number, side: 0 | 1) =>
    column
      ? { x: side === 0 ? w * 0.24 : w * 0.82, y: (h * (i + 0.5)) / PLUGS }
      : { x: (w * (i + 0.5)) / PLUGS, y: side === 0 ? r * 1.15 : h - r * 1.3 };
  const socketOrder = shuffled(PLUGS, rng);
  const sockets = pieces.map((piece, i) => ({ piece, ...spots(socketOrder[i]!, 1), full: false }));
  const plugs: Plug[] = pieces.map((piece, i) => {
    const s = spots(i, 0);
    const a = column ? { x: 0, y: s.y } : { x: s.x, y: 0 };
    return {
      piece,
      ax: a.x,
      ay: a.y,
      hx: s.x,
      hy: s.y,
      x: s.x,
      y: s.y,
      held: null,
      ox: 0,
      oy: 0,
      in: -1,
    };
  });
  const shakes = plugs.map(() => createShake());
  let placed = 0;

  return {
    id: "plug",
    get progress() {
      return placed / PLUGS;
    },
    get done() {
      return placed >= PLUGS;
    },
    down(id, x, y) {
      for (const p of plugs) {
        if (p.in >= 0 || p.held !== null) continue;
        if (dist(x, y, p.x, p.y) <= r * 1.45) {
          p.held = id;
          p.ox = p.x - x;
          p.oy = p.y - y;
          return;
        }
      }
    },
    move(id, x, y) {
      for (const p of plugs) {
        if (p.held !== id) continue;
        p.x = clamp(x + p.ox, r, w - r);
        p.y = clamp(y + p.oy, r, h - r);
      }
    },
    up(id) {
      plugs.forEach((p, i) => {
        if (p.held !== id) return;
        p.held = null;
        let best = -1;
        let bd = r * 1.6;
        sockets.forEach((s, k) => {
          const d = dist(p.x, p.y, s.x, s.y);
          if (!s.full && d < bd) {
            best = k;
            bd = d;
          }
        });
        const s = sockets[best];
        if (s && s.piece === p.piece) {
          s.full = true;
          p.in = best;
          p.hx = s.x;
          p.hy = s.y;
          placed++;
        } else if (s) {
          shakes[i]!.kick();
        }
      });
    },
    update(dt) {
      for (const sh of shakes) sh.update(dt);
      const k = Math.min(1, dt * 12);
      for (const p of plugs) {
        if (p.held !== null) continue;
        p.x += (p.hx - p.x) * k;
        p.y += (p.hy - p.y) * k;
      }
    },
    draw(g) {
      for (const s of sockets) {
        const pc = PIECES[s.piece]!;
        g.fillStyle = "#1b2440";
        roundRect(g, s.x - r * 1.15, s.y - r * 1.15, r * 2.3, r * 2.3, r * 0.4);
        g.fill();
        g.strokeStyle = pc.color;
        g.lineWidth = Math.max(5, r * 0.12);
        g.stroke();
        g.fillStyle = "#05070d";
        circle(g, s.x, s.y, r * 0.78);
        g.fill();
        drawMark(g, pc.mark, s.x + r * 0.82, s.y - r * 0.82, r * 0.2, pc.color);
        if (s.full) {
          g.fillStyle = pc.color;
          circle(g, s.x - r * 0.82, s.y - r * 0.82, r * 0.18);
          g.fill();
        }
      }
      plugs.forEach((p, i) => {
        const pc = PIECES[p.piece]!;
        const x = p.x + shakes[i]!.dx(w);
        // The cable sags between its fixed end and the plug.
        const mx = (p.ax + x) / 2;
        const my = Math.max(p.ay, p.y) + Math.min(h * 0.25, dist(p.ax, p.ay, x, p.y) * 0.25);
        g.strokeStyle = pc.color;
        g.lineWidth = Math.max(10, r * 0.3);
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(p.ax, p.ay);
        g.quadraticCurveTo(mx, Math.min(h, my), x, p.y);
        g.stroke();
        g.fillStyle = "#d8dfee";
        circle(g, x, p.y, r);
        g.fill();
        g.strokeStyle = pc.color;
        g.lineWidth = Math.max(6, r * 0.18);
        g.stroke();
        drawMark(g, pc.mark, x, p.y, r * 0.42, pc.color);
      });
    },
    bot(pace) {
      const p = plugs.find((x) => x.in < 0 && x.held === null);
      if (!p) return null;
      const s = sockets.find((x) => x.piece === p.piece)!;
      return drag(
        [
          { x: p.x, y: p.y },
          { x: s.x, y: s.y },
        ],
        paced(650, pace),
      );
    },
  };
};

export const PLUG: TaskDef = { id: "plug", band: "high", create: createPlug };
