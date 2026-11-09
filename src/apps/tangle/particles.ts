/** A fixed pool of sparks for crashes and food, in arena units. */
const CAP = 768;

export interface Particles {
  burst(x: number, y: number, n: number, color: number, speed: number, life: number): void;
  step(dt: number): void;
  each(fn: (x: number, y: number, size: number, alpha: number, color: number) => void): void;
  clear(): void;
}

export const createParticles = (random: () => number, size: number): Particles => {
  const x = new Float32Array(CAP);
  const y = new Float32Array(CAP);
  const vx = new Float32Array(CAP);
  const vy = new Float32Array(CAP);
  const age = new Float32Array(CAP);
  const life = new Float32Array(CAP);
  const color = new Uint8Array(CAP);
  let next = 0;
  let live = 0;

  return {
    burst(px, py, n, c, speed, span) {
      for (let k = 0; k < n; k++) {
        const i = next;
        next = (next + 1) % CAP;
        const a = random() * Math.PI * 2;
        const s = speed * (0.25 + random() * 0.75);
        x[i] = px;
        y[i] = py;
        vx[i] = Math.cos(a) * s;
        vy[i] = Math.sin(a) * s;
        age[i] = 0;
        life[i] = span * (0.5 + random() * 0.5);
        color[i] = c;
      }
      live = Math.min(CAP, live + n);
    },
    step(dt) {
      if (live === 0) return;
      const drag = Math.exp(-2.2 * dt);
      let any = 0;
      for (let i = 0; i < CAP; i++) {
        if (age[i]! >= life[i]!) continue;
        any++;
        age[i]! += dt;
        x[i]! += vx[i]! * dt;
        y[i]! += vy[i]! * dt;
        vx[i]! *= drag;
        vy[i]! *= drag;
      }
      live = any;
    },
    each(fn) {
      if (live === 0) return;
      for (let i = 0; i < CAP; i++) {
        if (age[i]! >= life[i]!) continue;
        const t = age[i]! / life[i]!;
        fn(x[i]!, y[i]!, size * (1 - t * 0.5), (1 - t) * (1 - t), color[i]!);
      }
    },
    clear() {
      age.fill(1);
      life.fill(0);
      live = 0;
    },
  };
};
