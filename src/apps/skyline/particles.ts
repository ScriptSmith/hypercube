/** Bounded sparkles and dust, in venue px. */
import type { G } from "./art";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  /** Pixels per second squared, down. */
  fall: number;
}

export const MAX_PARTICLES = 260;

export interface Particles {
  readonly list: readonly Particle[];
  burst(
    x: number,
    y: number,
    o: {
      n: number;
      speed: number;
      size: number;
      colors: readonly string[];
      fall: number;
      up?: number;
    },
    rand: () => number,
  ): void;
  step(dt: number): void;
  draw(g: G): void;
  clear(): void;
}

export const createParticles = (): Particles => {
  const list: Particle[] = [];
  return {
    list,
    burst(x, y, o, rand) {
      for (let i = 0; i < o.n; i++) {
        if (list.length >= MAX_PARTICLES) list.shift();
        const a = rand() * Math.PI * 2;
        const v = o.speed * (0.3 + 0.7 * rand());
        const life = 0.6 + rand() * 0.9;
        list.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - (o.up ?? 0),
          life,
          max: life,
          color: o.colors[Math.floor(rand() * o.colors.length)] ?? "#ffffff",
          size: o.size * (0.6 + 0.6 * rand()),
          fall: o.fall,
        });
      }
    },
    step(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]!;
        p.life -= dt;
        if (p.life <= 0) {
          list.splice(i, 1);
          continue;
        }
        p.vy += p.fall * dt;
        p.vx *= 1 - 0.8 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    },
    draw(g) {
      for (const p of list) {
        g.globalAlpha = Math.min(1, (p.life / p.max) * 1.4);
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    },
    clear() {
      list.length = 0;
    },
  };
};
