/**
 * Count: the picture shows some gears; tap the box with that many dots (up to six). Two pictures
 * make a task. A wrong box shakes; the picture stays.
 */
import { tap } from "../gesture";
import {
  circle,
  clamp,
  createShake,
  inside,
  paced,
  roundRect,
  type Shake,
  shuffled,
  type Task,
  type TaskDef,
  type TaskEnv,
  TAU,
} from "./common";

const ROUNDS = 2;

/** Dot positions on a die face, in units of the face, for 1 to 6. */
const PIPS: readonly (readonly [number, number])[][] = [
  [[0.5, 0.5]],
  [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  [
    [0.25, 0.25],
    [0.5, 0.5],
    [0.75, 0.75],
  ],
  [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.5, 0.5],
    [0.25, 0.75],
    [0.75, 0.75],
  ],
  [
    [0.27, 0.22],
    [0.73, 0.22],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.78],
    [0.73, 0.78],
  ],
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
  shake: Shake;
}

export const createCount = (env: TaskEnv): Task => {
  const { w, h, rng } = env;
  const wide = w > h * 1.5;
  // Three boxes where they fit beside the picture at full size, else two.
  const roomFor = (n: number) => n * env.target * 1.12 + w * 0.09;
  const choices = !wide || w - Math.min(h * 0.88, w * 0.36) >= roomFor(3) ? 3 : 2;
  const pic = wide
    ? {
        x: w * 0.02,
        y: h * 0.06,
        w: Math.min(h * 0.88, w * 0.36, w - roomFor(choices)),
        h: h * 0.88,
      }
    : { x: w * 0.18, y: h * 0.03, w: w * 0.64, h: h * 0.44 };
  const area = wide
    ? { x: pic.x + pic.w + w * 0.04, y: 0, w: w - pic.x - pic.w - w * 0.05, h }
    : { x: 0, y: pic.y + pic.h + h * 0.04, w, h: h - pic.y - pic.h - h * 0.05 };
  const side = clamp(
    Math.min(area.w / (choices + 0.6), area.h * 0.9),
    env.target,
    env.target * 1.8,
  );
  const gap = (area.w - side * choices) / (choices + 1);
  const boxes: Box[] = Array.from({ length: choices }, (_, i) => ({
    x: area.x + gap + i * (side + gap),
    y: area.y + (area.h - side) / 2,
    w: side,
    h: side,
    value: 1,
    shake: createShake(),
  }));
  let round = 0;
  let answer = 1;
  let spots: { x: number; y: number; a: number }[] = [];
  let flash = 0;

  const deal = () => {
    let next = 1 + rng.int(6);
    if (next === answer) next = (next % 6) + 1;
    answer = next;
    const others = shuffled(6, rng)
      .map((v) => v + 1)
      .filter((v) => v !== answer)
      .slice(0, choices - 1);
    const values = [answer, ...others];
    shuffled(choices, rng).forEach((k, i) => {
      boxes[i]!.value = values[k]!;
    });
    // Gears scattered over a 3 by 2 grid of the picture, not in the boxes' dice pattern.
    const cells = shuffled(6, rng).slice(0, answer);
    spots = cells.map((c) => ({
      x: pic.x + (pic.w * ((c % 3) + 0.5 + rng.range(-0.15, 0.15))) / 3,
      y: pic.y + (pic.h * (Math.floor(c / 3) + 0.5 + rng.range(-0.12, 0.12))) / 2,
      a: rng.range(0, TAU),
    }));
  };
  deal();

  return {
    id: "count",
    get progress() {
      return round / ROUNDS;
    },
    get done() {
      return round >= ROUNDS;
    },
    down(_id, x, y) {
      if (round >= ROUNDS || flash > 0) return;
      const box = boxes.find((b) => inside(b, x, y, env.target * 0.12));
      if (!box) return;
      if (box.value === answer) {
        round++;
        flash = 0.45;
      } else {
        box.shake.kick();
      }
    },
    move() {},
    up() {},
    update(dt) {
      for (const b of boxes) b.shake.update(dt);
      if (flash > 0) {
        flash -= dt;
        if (flash <= 0 && round < ROUNDS) deal();
      }
    },
    draw(g) {
      g.fillStyle = "rgba(255,255,255,0.07)";
      roundRect(g, pic.x, pic.y, pic.w, pic.h, Math.min(pic.w, pic.h) * 0.08);
      g.fill();
      const gr = Math.min(pic.w / 3, pic.h / 2) * 0.3;
      for (const s of spots) {
        g.save();
        g.translate(s.x, s.y);
        g.rotate(s.a);
        g.fillStyle = flash > 0 ? env.color : "#c9d3ea";
        g.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU;
          const rr = i % 2 === 0 ? gr : gr * 0.76;
          g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        g.closePath();
        g.fill();
        g.fillStyle = "#0b1222";
        circle(g, 0, 0, gr * 0.3);
        g.fill();
        g.restore();
      }
      for (const b of boxes) {
        const x = b.x + b.shake.dx(w);
        const right = flash > 0 && b.value === answer;
        g.fillStyle = right ? env.color : "#e9eef8";
        roundRect(g, x, b.y, b.w, b.h, b.w * 0.16);
        g.fill();
        g.fillStyle = "#0b1222";
        for (const [px, py] of PIPS[b.value - 1] ?? []) {
          circle(g, x + b.w * px, b.y + b.h * py, b.w * 0.085);
          g.fill();
        }
      }
    },
    bot(pace) {
      if (round >= ROUNDS || flash > 0) return null;
      const box = boxes.find((b) => b.value === answer)!;
      return tap({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, paced(90, pace));
    },
  };
};

export const COUNT: TaskDef = { id: "count", band: "high", create: createCount };
