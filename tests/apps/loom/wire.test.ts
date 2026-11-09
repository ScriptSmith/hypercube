import { describe, expect, it } from "vitest";
import { createConductor } from "../../../src/apps/loom/conductor";
import { TAU } from "../../../src/apps/loom/config";
import { beaconFrom, createMirror } from "../../../src/apps/loom/mirror";
import { phaseDelta, targetFor } from "../../../src/apps/loom/series";
import {
  decodeBeacon,
  decodeState,
  encodeBeacon,
  encodeState,
  Q,
  quantAmp,
  quantPhase,
  unquantAmp,
  unquantPhase,
} from "../../../src/apps/loom/wire";
import { createRng } from "../../../src/core/rng";
import { DT } from "./helpers";

describe("loom messages", () => {
  it("quantise amplitude and phase to 512ths, surviving a round trip", () => {
    const rng = createRng("q");
    for (let i = 0; i < 500; i++) {
      const a = rng.next();
      const p = rng.range(-10, 10);
      expect(Math.abs(unquantAmp(quantAmp(a)) - a)).toBeLessThanOrEqual(0.5 / Q + 1e-12);
      expect(Math.abs(phaseDelta(unquantPhase(quantPhase(p)), p))).toBeLessThanOrEqual(
        (0.5 / Q) * TAU + 1e-9,
      );
      expect(quantPhase(p)).toBeLessThan(Q);
    }
    expect(quantAmp(1)).toBe(Q);
    expect(quantAmp(-1)).toBe(0);
    expect(quantPhase(TAU - 1e-6)).toBe(0);
  });

  it("carry a frame's harmonics through JSON unchanged", () => {
    const m = { p: 3, h: [{ k: 7, a: 300, ph: 511, f: 5 }] };
    const d = decodeState(JSON.parse(JSON.stringify(encodeState(m))));
    expect(d).toEqual(m);
  });

  it("drop malformed states whole", () => {
    const bad: unknown[] = [
      null,
      [],
      { p: -1, h: [[1, 0, 0, 0]] },
      { p: 0, h: [] },
      { p: 0, h: [[0, 0, 0, 0]] },
      { p: 0, h: [[21, 0, 0, 0]] },
      { p: 0, h: [[1, 513, 0, 0]] },
      { p: 0, h: [[1, 0, 512, 0]] },
      { p: 0, h: [[1, 0, 0, 8]] },
      { p: 0, h: [[1, 0.5, 0, 0]] },
      { p: 0, h: [[1, 0, 0]] },
      {
        p: 0,
        h: [
          [1, 0, 0, 0],
          [2, 0, 0, 0],
          [3, 0, 0, 0],
          [4, 0, 0, 0],
          [5, 0, 0, 0],
        ],
      },
      { p: 0, h: "x" },
    ];
    for (const b of bad) expect(decodeState(b), JSON.stringify(b)).toBeNull();
  });

  it("carry the beacon through JSON, and drop malformed ones", () => {
    const c = createConductor({ n: 10, variant: "match", rng: createRng("b") });
    for (let i = 0; i < 200; i++) c.step(DT);
    const b = beaconFrom(c, 0, true);
    const d = decodeBeacon(JSON.parse(JSON.stringify(encodeBeacon(b))));
    expect(d).toEqual(encodeBeacon(b));
    expect(d!.v).toHaveLength(10);
    const ok = encodeBeacon(b);
    const broken: unknown[] = [
      { ...ok, s: 2 },
      { ...ok, c: 3 },
      { ...ok, g: 300 },
      { ...ok, m: 3 },
      { ...ok, f: 101 },
      { ...ok, p: 2 },
      { ...ok, v: [] },
      { ...ok, v: Array.from({ length: 21 }, () => [0, 0, 0]) },
      { ...ok, v: [[0, 0, 4]] },
      { ...ok, v: [[0, 512, 0]] },
      { ...ok, r: "1" },
    ];
    for (const x of broken) expect(decodeBeacon(x)).toBeNull();
  });

  it("let a follower track the conductor between beacons four times a second", () => {
    const c = createConductor({ n: 10, variant: "match", rng: createRng("m") });
    const m = createMirror("match");
    let worst = 0;
    let worstAt = 0;
    for (let i = 0; i < 60 * 40; i++) {
      c.step(DT);
      if (i % 15 === 0)
        m.apply(decodeBeacon(JSON.parse(JSON.stringify(encodeBeacon(beaconFrom(c, 0, true)))))!);
      else m.step(DT);
      if (!m.heard) continue;
      c.values.forEach((v, j) => {
        const w = m.values[j]!;
        const e = Math.abs(v.amp - w.amp) + Math.abs(phaseDelta(v.phase, w.phase)) * v.amp;
        if (e > worst) {
          worst = e;
          worstAt = i;
        }
      });
    }
    // Quantising is 1/512 of a turn and of the slider; prediction keeps the rest small.
    expect(worst, `at step ${worstAt}`).toBeLessThan(0.012);
    expect(m.target()!.id).toBe(c.target()!.id);
  });

  it("let a follower know the target, the mode and which harmonics are right", () => {
    const c = createConductor({ n: 6, variant: "match", rng: createRng("m2") });
    for (let i = 0; i < 60 * 8; i++) c.step(DT);
    const m = createMirror("match");
    m.apply(beaconFrom(c, 1, false));
    expect(m.n).toBe(6);
    expect(m.target()).toEqual(targetFor(c.targetIndex, 6));
    expect(m.ok).toEqual(c.ok);
    expect(m.live).toEqual(c.live);
    expect(m.mode).toBe(c.mode);
    expect(m.fill).toBeCloseTo(c.fill, 2);
  });
});
