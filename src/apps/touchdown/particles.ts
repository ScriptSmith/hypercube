/** A fixed pool of short-lived particles: exhaust, dust and sparkles. The oldest are reused. */
import { type G, star, TAU } from "./art";

export type ParticleKind = "smoke" | "dust" | "spark";

export interface Particles {
  spawn(
    kind: ParticleKind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
  ): void;
  update(dt: number): void;
  /** Draw in venue px; the caller sets the transform. */
  draw(g: G): void;
  readonly live: number;
  clear(): void;
}

const KINDS: ParticleKind[] = ["smoke", "dust", "spark"];

export const createParticles = (capacity: number): Particles => {
  const n = Math.max(16, capacity);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const age = new Float32Array(n);
  const life = new Float32Array(n);
  const size = new Float32Array(n);
  const kind = new Uint8Array(n);
  let next = 0;
  let live = 0;

  return {
    spawn(k, px, py, pvx, pvy, plife, psize) {
      const i = next;
      next = (next + 1) % n;
      if (life[i]! <= age[i]!) live++;
      x[i] = px;
      y[i] = py;
      vx[i] = pvx;
      vy[i] = pvy;
      age[i] = 0;
      life[i] = plife;
      size[i] = psize;
      kind[i] = KINDS.indexOf(k);
    },
    update(dt) {
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (age[i]! >= life[i]!) continue;
        age[i] = age[i]! + dt;
        const drag = kind[i] === 2 ? 0.98 : 0.94;
        const k = drag ** (dt * 60);
        vx[i] = vx[i]! * k;
        vy[i] = vy[i]! * k + (kind[i] === 2 ? 40 : -6) * dt;
        x[i] = x[i]! + vx[i]! * dt;
        y[i] = y[i]! + vy[i]! * dt;
        if (age[i]! < life[i]!) count++;
      }
      live = count;
    },
    draw(g) {
      for (let i = 0; i < n; i++) {
        const a = age[i]!;
        const l = life[i]!;
        if (a >= l) continue;
        const f = a / l;
        const k = kind[i];
        if (k === 2) {
          g.globalAlpha = (1 - f) * 0.95;
          g.fillStyle = "#ffe07a";
          star(g, x[i]!, y[i]!, size[i]! * (1 - 0.5 * f), 0.4);
          g.fill();
          continue;
        }
        const r = size[i]! * (0.6 + 1.4 * f);
        g.globalAlpha = (k === 0 ? 0.32 : 0.55) * (1 - f) * (1 - f);
        g.fillStyle = k === 0 ? "#c8cbe0" : "#b9a6d6";
        g.beginPath();
        g.arc(x[i]!, y[i]!, r, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    },
    get live() {
      return live;
    },
    clear() {
      age.fill(0);
      life.fill(0);
      live = 0;
    },
  };
};
