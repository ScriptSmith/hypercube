import { describe, expect, it } from "vitest";
import { buildNoise, NOISE_SIZE } from "../../../src/apps/orb/noise";

const N = NOISE_SIZE;
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const at = (d: Uint8Array, x: number, y: number, z: number, c: number) =>
  d[(((z % N) * N + (y % N)) * N + (x % N)) * 4 + c]!;

describe("orb smoke noise", { timeout: 30_000 }, () => {
  const data = buildNoise(20261102);

  it("is the same every time and fills each channel from 0 to 255", () => {
    expect(data).toHaveLength(N * N * N * 4);
    expect(same(buildNoise(20261102), data)).toBe(true);
    expect(same(buildNoise(1), data)).toBe(false);
    for (let c = 0; c < 4; c++) {
      let min = 255;
      let max = 0;
      let sum = 0;
      for (let i = c; i < data.length; i += 4) {
        min = Math.min(min, data[i]!);
        max = Math.max(max, data[i]!);
        sum += data[i]!;
      }
      expect(min).toBe(0);
      expect(max).toBe(255);
      const mean = sum / (N * N * N);
      expect(mean).toBeGreaterThan(90);
      expect(mean).toBeLessThan(165);
    }
  });

  it("tiles: across its edges it changes no more than between any two neighbours", () => {
    for (let c = 0; c < 4; c++) {
      let across = 0;
      let within = 0;
      let count = 0;
      for (let y = 0; y < N; y += 3) {
        for (let z = 0; z < N; z += 3) {
          across += Math.abs(at(data, N - 1, y, z, c) - at(data, 0, y, z, c));
          across += Math.abs(at(data, y, N - 1, z, c) - at(data, y, 0, z, c));
          across += Math.abs(at(data, y, z, N - 1, c) - at(data, y, z, 0, c));
          within += Math.abs(at(data, 30, y, z, c) - at(data, 31, y, z, c));
          within += Math.abs(at(data, y, 30, z, c) - at(data, y, 31, z, c));
          within += Math.abs(at(data, y, z, 30, c) - at(data, y, z, 31, c));
          count += 3;
        }
      }
      expect(across / count).toBeLessThan(2.5 * (within / count) + 1);
    }
  });

  it("is smooth: neighbouring voxels differ far less than distant ones", () => {
    let near = 0;
    let far = 0;
    for (let i = 0; i < 2000; i++) {
      const x = (i * 37) % N;
      const y = (i * 11) % N;
      const z = (i * 5) % N;
      near += Math.abs(at(data, x, y, z, 0) - at(data, x + 1, y, z, 0));
      far += Math.abs(at(data, x, y, z, 0) - at(data, x + 23, y + 17, z + 9, 0));
    }
    expect(near * 4).toBeLessThan(far);
  });
});
