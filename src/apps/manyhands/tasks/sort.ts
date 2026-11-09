/**
 * Sort: drag four blocks into the bins of their colour. A block dropped in the wrong bin shakes
 * and slides back. Bins and blocks also carry a mark, so colour is never the only clue.
 */
import { drag } from "../gesture";
import {
  clamp,
  createShake,
  drawMark,
  inside,
  paced,
  PIECES,
  roundRect,
  shuffled,
  type Task,
  type TaskDef,
  type TaskEnv,
} from "./common";

const BLOCKS = 4;

interface Block {
  piece: number;
  hx: number;
  hy: number;
  x: number;
  y: number;
  /** In its bin. */
  home: boolean;
  held: number | null;
  ox: number;
  oy: number;
}

export const createSort = (env: TaskEnv): Task => {
  const { w, h, rng } = env;
  const pair = shuffled(PIECES.length, rng).slice(0, 2);
  const binW = Math.min(w * 0.44, Math.max(env.target * 1.5, w * 0.36));
  const binH = clamp(h * 0.3, env.target * 0.9, h * 0.38);
  const bins = pair.map((piece, i) => ({
    piece,
    x: i === 0 ? w * 0.04 : w * 0.96 - binW,
    y: h - binH - h * 0.02,
    w: binW,
    h: binH,
  }));
  const bigS = clamp(Math.min(w / 5.2, (h - binH) * 0.4), env.target, env.target * 1.3);
  // One row of blocks when they fit at near full size, else two rows.
  const rowS = Math.min(bigS, w / (BLOCKS * 1.05));
  const row = rowS >= Math.max(120, env.target * 0.85);
  const s = row ? rowS : bigS;
  const free = h - binH - h * 0.02 - 10;
  const order = shuffled(BLOCKS, rng);
  const blocks: Block[] = order.map((k, i) => {
    const piece = pair[k % 2]!;
    const cols = row ? BLOCKS : 2;
    const col = row ? i : i % 2;
    const r = row ? 0 : Math.floor(i / 2);
    const hx = (w * (col + 0.5)) / cols;
    const top = row
      ? Math.max(s / 2 + 4, free * 0.42)
      : Math.max(s / 2 + 4, Math.min(free - s / 2, free * (0.28 + r * 0.44)));
    return { piece, hx, hy: top, x: hx, y: top, home: false, held: null, ox: 0, oy: 0 };
  });
  const shakes = blocks.map(() => createShake());
  let placed = 0;

  const binFor = (b: Block) => bins.find((x) => x.piece === b.piece)!;
  const settle = (b: Block) => {
    const bin = binFor(b);
    const k = blocks.filter((x) => x.home && x.piece === b.piece).length;
    b.home = true;
    b.hx = bin.x + bin.w * (0.3 + 0.4 * k);
    b.hy = bin.y + bin.h * 0.42;
    placed++;
  };

  return {
    id: "sort",
    get progress() {
      return placed / BLOCKS;
    },
    get done() {
      return placed >= BLOCKS;
    },
    down(id, x, y) {
      // The top-most free block under the finger.
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i]!;
        if (b.home || b.held !== null) continue;
        if (Math.abs(x - b.x) <= s * 0.65 && Math.abs(y - b.y) <= s * 0.65) {
          b.held = id;
          b.ox = b.x - x;
          b.oy = b.y - y;
          blocks.splice(i, 1);
          blocks.push(b);
          const sh = shakes.splice(i, 1)[0]!;
          shakes.push(sh);
          return;
        }
      }
    },
    move(id, x, y) {
      for (const b of blocks) {
        if (b.held !== id) continue;
        b.x = clamp(x + b.ox, s / 2, w - s / 2);
        b.y = clamp(y + b.oy, s / 2, h - s / 2);
      }
    },
    up(id) {
      blocks.forEach((b, i) => {
        if (b.held !== id) return;
        b.held = null;
        const over = bins.find((bin) => inside(bin, b.x, b.y, s * 0.35));
        if (over && over.piece === b.piece) settle(b);
        else if (over) shakes[i]!.kick();
      });
    },
    update(dt) {
      for (const sh of shakes) sh.update(dt);
      const k = Math.min(1, dt * 12);
      for (const b of blocks) {
        if (b.held !== null) continue;
        b.x += (b.hx - b.x) * k;
        b.y += (b.hy - b.y) * k;
      }
    },
    draw(g) {
      for (const bin of bins) {
        const p = PIECES[bin.piece]!;
        g.fillStyle = "rgba(255,255,255,0.07)";
        roundRect(g, bin.x, bin.y, bin.w, bin.h, bin.h * 0.16);
        g.fill();
        g.strokeStyle = p.color;
        g.lineWidth = Math.max(6, bin.h * 0.05);
        g.beginPath();
        g.moveTo(bin.x, bin.y);
        g.lineTo(bin.x + bin.w * 0.08, bin.y + bin.h);
        g.lineTo(bin.x + bin.w * 0.92, bin.y + bin.h);
        g.lineTo(bin.x + bin.w, bin.y);
        g.stroke();
        drawMark(g, p.mark, bin.x + bin.w / 2, bin.y + bin.h * 0.78, bin.h * 0.1, p.color);
      }
      blocks.forEach((b, i) => {
        const p = PIECES[b.piece]!;
        const x = b.x + shakes[i]!.dx(w);
        const size = b.home ? s * 0.62 : b.held !== null ? s * 1.08 : s;
        g.fillStyle = p.color;
        roundRect(g, x - size / 2, b.y - size / 2, size, size, size * 0.18);
        g.fill();
        g.strokeStyle = "rgba(11,18,34,0.6)";
        g.lineWidth = Math.max(3, size * 0.04);
        g.stroke();
        drawMark(g, p.mark, x, b.y, size * 0.2, "#0b1222");
      });
    },
    bot(pace) {
      // The top-most free block, the one a finger on it would pick up.
      const b = blocks.findLast((x) => !x.home && x.held === null);
      if (!b) return null;
      const bin = binFor(b);
      return drag(
        [
          { x: b.x, y: b.y },
          { x: bin.x + bin.w / 2, y: bin.y + bin.h * 0.4 },
        ],
        paced(600, pace),
      );
    },
  };
};

export const SORT: TaskDef = { id: "sort", band: "low", create: createSort };
