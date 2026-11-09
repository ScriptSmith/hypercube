import { describe, expect, it } from "vitest";
import {
  ALL,
  COUNT,
  crystal,
  decode,
  donors,
  encode,
  ENOUGH,
  enough,
  has,
  kept,
  keepList,
  nextRipple,
  playAt,
  rhoJob,
  RIPPLES,
  rippleOf,
  S_MAX,
  SPAN,
  START,
  STATE_RANGES,
  swapJob,
  type SynthesisState,
  toggle,
} from "../../../../src/apps/xrd/chapters/synthesis/model";
import { picture } from "../../../../src/apps/xrd/chapters/synthesis/pictures";
import { checkState } from "../../../../src/apps/xrd/chapter";
import { rasterise } from "../../../../src/apps/xrd/engine/model";
import { synthesise } from "../../../../src/apps/xrd/engine/pattern";

const correlate = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return sab / Math.sqrt(saa * sbb);
};

/** Each pixel less its neighbourhood's mean: the edges, which is what the eye matches shapes by. */
const highPass = (a: ArrayLike<number>, n: number, r = 4) => {
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          s += a[yy * n + xx]!;
          c++;
        }
      out[y * n + x] = a[y * n + x]! - s / c;
    }
  return out;
};

const firstN = (n: number) => {
  let added = 0;
  for (let i = 0; i < n; i++) added = toggle(added, i);
  return added;
};

describe("chapter 9", () => {
  it("has 24 ripples, lowest |S| first, each a spot and its mirror", () => {
    expect(COUNT).toBe(24);
    for (let i = 1; i < COUNT; i++) expect(RIPPLES[i]!.S).toBeGreaterThanOrEqual(RIPPLES[i - 1]!.S);
    expect(rippleOf(-1, 0)).toBe(rippleOf(1, 0));
    expect(rippleOf(2, -3)).toBe(rippleOf(-2, 3));
    expect(new Set(RIPPLES.map((r) => `${r.h},${r.k}`)).size).toBe(COUNT);
    expect(S_MAX).toBeGreaterThanOrEqual(Math.max(...RIPPLES.map((r) => r.S)));
  });

  it("round-trips its state, every ripple's bit included", () => {
    const s: SynthesisState = { mode: "pictures", role: 1, cutoff: 0.55, added: ALL - 5, last: 23 };
    expect(decode(encode(s))).toEqual(s);
    expect(checkState({ state: STATE_RANGES }, encode({ ...START, added: ALL }))).not.toBeNull();
    for (let t = 0; t < 60; t += 0.8)
      expect(checkState({ state: STATE_RANGES }, encode(playAt(t)))).not.toBeNull();
    expect(has(toggle(0, 17), 17)).toBe(true);
    expect(nextRipple(firstN(5))).toBe(5);
    expect(nextRipple(ALL)).toBe(-1);
  });

  it("keeps only the added ripples within the detail slider's reach", () => {
    const s = { ...START, added: ALL, cutoff: 0.35 };
    const k = kept(s);
    expect(k.length).toBeGreaterThan(0);
    expect(k.length).toBeLessThan(COUNT);
    for (const i of k) expect(RIPPLES[i]!.S).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(enough({ ...START, added: firstN(ENOUGH) })).toBe(true);
    expect(enough({ ...START, added: firstN(ENOUGH - 1) })).toBe(false);
    // Each spot lands on a whole pixel: h·3 from the middle of the 15 Å picture.
    expect(Array.from(keepList([rippleOf(1, 2)]))).toEqual([0, 0, 3, 6]);
  });

  it("approaches the model's atoms as ripples are added, lowest first", () => {
    const n = 128;
    const truth = rasterise(crystal(), n, SPAN, new Float64Array(n * n));
    const scores = [2, 6, 14, COUNT].map((m) =>
      correlate(synthesise(rhoJob({ ...START, added: firstN(m) }, n)), truth),
    );
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
    expect(scores.at(-1)!).toBeGreaterThan(0.9);
  });

  it("makes the swapped picture look like the picture whose positions it kept", () => {
    const n = 128;
    for (const role of [0, 1] as const) {
      const d = donors(role);
      const out = synthesise(swapJob(role, n));
      const P = picture(d.place, n);
      const B = picture(d.bright, n);
      expect(correlate(out, P), `role ${role}`).toBeGreaterThan(correlate(out, B) + 0.15);
      // Both animals sit in the middle, so compare their edges too.
      const place = correlate(highPass(out, n), highPass(P, n));
      const bright = correlate(highPass(out, n), highPass(B, n));
      expect(place, `role ${role}`).toBeGreaterThan(0.6);
      expect(place, `role ${role}`).toBeGreaterThan(bright + 0.5);
    }
  });

  it("draws two different pictures, never blank", () => {
    const a = picture("lorikeet", 64);
    const b = picture("turtle", 64);
    const filled = (p: Float32Array) => p.reduce((s, v) => s + (v > 0.5 ? 1 : 0), 0) / p.length;
    expect(filled(a)).toBeGreaterThan(0.08);
    expect(filled(b)).toBeGreaterThan(0.08);
    expect(correlate(highPass(a, 64), highPass(b, 64))).toBeLessThan(0.2);
    // A job hands its arrays to the worker, so the cached pictures stay whole.
    swapJob(0, 64);
    expect(picture("lorikeet", 64)).toBe(a);
  });
});
