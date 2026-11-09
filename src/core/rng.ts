import type { Rng } from "./types";

/** 128-bit string hash (cyrb128), used to seed sfc32 from any string. */
const hash128 = (text: string): [number, number, number, number] => {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
};

/** Deterministic across browsers and machines for the same seed, so frames can share courses. */
export const createRng = (seed: number | string): Rng => {
  const label = String(seed);
  let [a, b, c, d] = hash128(label);
  const next = (): number => {
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    range: (min, max) => min + next() * (max - min),
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("pick from empty list");
      return items[Math.floor(next() * items.length)] as T;
    },
    fork: (name) => createRng(`${label}:${name}`),
  };
};

export const hashSeed = (text: string): number => hash128(text)[0];
