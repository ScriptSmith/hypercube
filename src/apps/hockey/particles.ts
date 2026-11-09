/**
 * A fixed pool of sparks and confetti in frame venue px. When the pool is full the oldest
 * particle is reused, so bursts can never grow memory.
 */
export const MAX_PARTICLES = 640;

export interface Particles {
  /** Colours by index; set once per layout. */
  colors: string[];
  burst(x: number, y: number, n: number, color: number, speed: number, size: number): void;
  /** Confetti that falls and flutters. */
  confetti(x: number, y: number, n: number, color: number, spread: number, size: number): void;
  step(dt: number): void;
  each(
    cb: (x: number, y: number, size: number, alpha: number, color: number, flat: boolean) => void,
  ): void;
  clear(): void;
  readonly count: number;
}

export const createParticles = (rand: () => number = Math.random): Particles => {
  const x = new Float32Array(MAX_PARTICLES);
  const y = new Float32Array(MAX_PARTICLES);
  const vx = new Float32Array(MAX_PARTICLES);
  const vy = new Float32Array(MAX_PARTICLES);
  const life = new Float32Array(MAX_PARTICLES);
  const span = new Float32Array(MAX_PARTICLES);
  const size = new Float32Array(MAX_PARTICLES);
  const color = new Uint8Array(MAX_PARTICLES);
  const falls = new Uint8Array(MAX_PARTICLES);
  let next = 0;
  let count = 0;

  const add = (
    px: number,
    py: number,
    pvx: number,
    pvy: number,
    s: number,
    c: number,
    t: number,
    fall: boolean,
  ) => {
    const i = next;
    next = (next + 1) % MAX_PARTICLES;
    if (life[i]! <= 0) count++;
    x[i] = px;
    y[i] = py;
    vx[i] = pvx;
    vy[i] = pvy;
    size[i] = s;
    color[i] = c;
    life[i] = t;
    span[i] = t;
    falls[i] = fall ? 1 : 0;
  };

  return {
    colors: [],
    burst(px, py, n, c, speed, s) {
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        const v = speed * (0.3 + rand() * 0.7);
        add(
          px,
          py,
          Math.cos(a) * v,
          Math.sin(a) * v,
          s * (0.5 + rand() * 0.8),
          c,
          0.5 + rand() * 0.6,
          false,
        );
      }
    },
    confetti(px, py, n, c, spread, s) {
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + (rand() - 0.5) * 1.6;
        const v = spread * (0.6 + rand() * 0.8);
        add(
          px + (rand() - 0.5) * spread * 0.3,
          py,
          Math.cos(a) * v,
          Math.sin(a) * v,
          s * (0.6 + rand() * 0.8),
          c,
          1.8 + rand() * 1.4,
          true,
        );
      }
    },
    step(dt) {
      const drag = Math.exp(-2.2 * dt);
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (life[i]! <= 0) continue;
        life[i]! -= dt;
        if (life[i]! <= 0) {
          count--;
          continue;
        }
        if (falls[i]) {
          vy[i]! += 900 * dt;
          vx[i]! *= Math.exp(-1.2 * dt);
          vy[i]! *= Math.exp(-1.6 * dt);
        } else {
          vx[i]! *= drag;
          vy[i]! *= drag;
        }
        x[i]! += vx[i]! * dt;
        y[i]! += vy[i]! * dt;
      }
    },
    each(cb) {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (life[i]! <= 0) continue;
        cb(
          x[i]!,
          y[i]!,
          size[i]!,
          Math.min(1, (life[i]! / span[i]!) * 1.5),
          color[i]!,
          falls[i] === 1,
        );
      }
    },
    clear() {
      life.fill(0);
      count = 0;
    },
    get count() {
      return count;
    },
  };
};
