import { describe, expect, it } from "vitest";
import interference from "../../../../src/apps/xrd/chapters/interference";
import { TEXT } from "../../../../src/apps/xrd/captions";
import {
  apart,
  brightness,
  decode,
  encode,
  extremeAt,
  field,
  fringe,
  pushInWaves,
  START,
  STATE_RANGES,
  sumHeight,
} from "../../../../src/apps/xrd/chapters/interference/physics";
import type { ChapterEnv } from "../../../../src/apps/xrd/chapter";
import { readConfig } from "../../../../src/apps/xrd/config";
import type { Control, Touch } from "../../../../src/apps/xrd/controls";
import { createLink } from "../../../../src/apps/xrd/formula";
import { layoutFrame, withSplit } from "../../../../src/apps/xrd/layout";
import type { Rng } from "../../../../src/core/types";

const rng = (): Rng => {
  const r: Rng = {
    next: () => 0.5,
    int: (n) => Math.floor(n / 2),
    range: (lo, hi) => (lo + hi) / 2,
    pick: (items) => items[0]!,
    fork: () => r,
  };
  return r;
};

const envWith = (onEarn: () => void): ChapterEnv => ({
  id: "interference",
  kind: "panel",
  config: readConfig({}),
  rng: rng(),
  engine: () => {
    throw new Error("no engine here");
  },
  layer3d: () => {
    throw new Error("no 3D here");
  },
  maps: { canvas: () => null, ready: () => false, draw: () => null, dispose() {} },
  link: createLink(),
  earn: onEarn,
  now: () => 0,
});

const panelCard = () =>
  withSplit(
    layoutFrame({
      kind: "panel",
      width: 1080,
      height: 1920,
      reachTop: { adult: 0, child: 960 },
      cards: [{ bottom: "tabs", tabs: 11 }],
      maths: true,
    }).cards[0]!,
    interference.split ?? 0.5,
  );

/** Play a control's gesture as one finger: down, along the path, up. */
const play = (c: Control, to: number, time: number) => {
  const g = c.gesture(to)!;
  const t = (i: number): Touch => ({
    id: 7,
    x: g.path[i]!.x,
    y: g.path[i]!.y,
    synthetic: true,
    time: time + i,
  });
  c.begin(t(0));
  for (let i = 1; i < g.path.length; i++) c.move(t(i));
  c.end(t(g.path.length - 1), false);
};

describe("chapter 2's waves", () => {
  it("adds two waves to twice the height in step and to nothing half a wave apart", () => {
    expect(sumHeight(0)).toBeCloseTo(2, 12);
    expect(sumHeight(180)).toBeCloseTo(0, 12);
    expect(sumHeight(120)).toBeCloseTo(1, 12);
    expect(sumHeight(360)).toBeCloseTo(2, 12);
    // The sum's height is 2A cos(πΔ/λ) for a push of Δ = φλ/2π.
    for (const phi of [0, 30, 75, 150, 210, 300]) {
      const delta = pushInWaves(phi);
      expect(sumHeight(phi)).toBeCloseTo(2 * Math.abs(Math.cos(Math.PI * delta)), 12);
      // Brightness goes as the height squared.
      expect(brightness(phi)).toBeCloseTo((sumHeight(phi) / 2) ** 2, 12);
    }
  });

  it("matches the sum of the two waves point by point", () => {
    const k = (2 * Math.PI) / 10;
    for (const phi of [0, 90, 180, 250]) {
      const p = (phi * Math.PI) / 180;
      let peak = 0;
      for (let x = 0; x < 10; x += 0.01) peak = Math.max(peak, Math.abs(field(x, x, k, 0, p)));
      expect(peak).toBeCloseTo(sumHeight(phi), 2);
    }
  });

  it("draws fringes bright where the paths differ by whole waves and dark at half waves", () => {
    const lam = 30;
    expect(fringe(100, 100, lam, 0)).toBeCloseTo(1, 12);
    expect(fringe(100, 130, lam, 0)).toBeCloseTo(1, 12);
    expect(fringe(100, 115, lam, 0)).toBeCloseTo(0, 12);
    // Pushing the second wave half a wave moves the bright fringe to where the paths differ by half.
    expect(fringe(100, 100, lam, 180)).toBeCloseTo(0, 12);
    expect(fringe(100, 115, lam, 180)).toBeCloseTo(1, 12);
  });

  it("knows in step from half a wave apart, round the circle", () => {
    expect(apart(355, 0)).toBeCloseTo(5, 12);
    expect(extremeAt(358)).toBe("add");
    expect(extremeAt(185)).toBe("cancel");
    expect(extremeAt(60)).toBeNull();
  });

  it("packs its state for the screen within its ranges", () => {
    for (const s of [START, { phi: 359.6, lam: 160 }, { phi: 0, lam: 60 }]) {
      const v = encode(s);
      v.forEach((x, i) => {
        expect(x).toBeGreaterThanOrEqual(STATE_RANGES[i]![0]);
        expect(x).toBeLessThanOrEqual(STATE_RANGES[i]![1]);
      });
    }
    expect(decode(encode({ phi: 181, lam: 120 }))).toEqual({ phi: 181, lam: 120 });
  });

  it("shows its So line only after a full add and a full cancel, in either order", () => {
    let earned = 0;
    const ch = interference.create(envWith(() => earned++));
    ch.layout(panelCard());
    const dial = ch.controls.find((c) => c.id === "dial")!;
    for (let i = 0; i < 30; i++) ch.update(1 / 60, i * 16);
    expect(earned).toBe(0);
    play(dial, 180, 1000);
    for (let i = 0; i < 60; i++) ch.update(1 / 60, 1000 + i * 16);
    expect(earned).toBe(0);
    expect(ch.status().bright).toBeLessThan(0.02);
    play(dial, 0, 3000);
    for (let i = 0; i < 60; i++) ch.update(1 / 60, 3000 + i * 16);
    expect(earned).toBeGreaterThan(0);
    expect(ch.status().bright).toBeGreaterThan(0.98);
    ch.reset();
    expect(ch.state()).toEqual(encode(START));
  });

  it("lets the lower slit slide along the wall, and keeps it where it is let go", () => {
    const ch = interference.create(envWith(() => {}));
    ch.layout(panelCard());
    const slit = ch.controls.find((c) => c.id === "slit")!;
    const before = ch.status().slit as number;
    play(slit, 1, 0);
    ch.update(1 / 60, 100);
    const after = ch.status().slit as number;
    expect(after).toBeGreaterThan(before);
    for (let i = 0; i < 60; i++) ch.update(1 / 60, 200 + i * 16);
    expect(ch.status().slit).toBe(after);
    ch.reset();
    ch.update(1 / 60, 2000);
    expect(ch.status().slit).toBe(before);
  });

  it("writes φ in degrees in its formula, symbols and numbers, and keeps the waves in view with the Maths open", () => {
    const m = TEXT.interference.maths;
    expect(m.formula.map((r) => r.t).join("")).toBe("y = A sin(360° · x/λ + φ)");
    expect(m.symbols.find((x) => x.part === "phi")!.text).toMatch(/degrees/);
    expect(m.symbols.find((x) => x.part === "lam")!.text).not.toMatch(/Å/);
    const ch = interference.create(envWith(() => {}));
    ch.layout(panelCard());
    expect(ch.numbers()[0]).toMatch(/^φ = 60°/);
    // The fold covers the caption and figure, so the waves' symbols show while it is open.
    expect(interference.foldOver).toBe("figure");
  });
});
