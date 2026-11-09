import { describe, expect, it } from "vitest";
import { fillBurst, newBurst, newShell } from "../../../src/apps/fireworks/records";
import { SHAPE } from "../../../src/apps/fireworks/recipe";
import {
  decodeBoom,
  decodeBurst,
  decodeLaunch,
  decodeShell,
  decodeVolley,
  encodeBurst,
  encodeLaunch,
  encodeShell,
  type LaunchMsg,
} from "../../../src/apps/fireworks/wire";

const good: LaunchMsg = {
  p: 0,
  n: 2,
  pos: 3,
  fw: 2160,
  fh: 1920,
  u: 0.2,
  d: 1530,
  a: 0.1,
  v: 3400,
  g: 420,
  c: 6,
  s: SHAPE.heart,
  z: 0.5,
  k: 123456,
  t: 1_792_000_000_000,
};

const wire = <T>(x: T): unknown => JSON.parse(JSON.stringify(x));

describe("fireworks messages", () => {
  it("round-trips a launch and rejects anything out of range", () => {
    expect(decodeLaunch(wire(encodeLaunch(good)))).toEqual(good);
    for (const bad of [
      null,
      "x",
      [],
      { ...good, p: 2 },
      { ...good, s: SHAPE.cascade },
      { ...good, c: 7 },
      { ...good, a: 1 },
      { ...good, z: 1.5 },
      { ...good, v: Number.NaN },
      { ...good, k: -1 },
      { ...good, pos: 1.5 },
      { ...good, t: "now" },
    ]) {
      expect(decodeLaunch(bad)).toBeNull();
    }
  });

  it("round-trips shells and bursts for the corner", () => {
    const s = newShell();
    Object.assign(s, {
      t0: 1000,
      tb: 3500,
      color: 2,
      shape: SHAPE.ring,
      size: 0.25,
      seed: 77,
      radius: 1500,
      star: 40,
      boost: 1.45,
    });
    s.path = { x: -540, y: -1530, vx: 1200, vy: 3300, g: 420, k: 0 };
    const out = newShell();
    expect(decodeShell(wire(encodeShell(s)), out)).toBe(true);
    expect(out.path).toEqual(s.path);
    expect(out.tb).toBe(3500);
    expect(out.boost).toBeCloseTo(1.45, 3);

    const b = fillBurst(newBurst(), s);
    const back = newBurst();
    expect(decodeBurst(wire(encodeBurst(b)), back)).toBe(true);
    expect(back.seed).toBe(77);
    expect(back.x).toBeCloseTo(b.x, 0);
    expect(back.count).toBe(b.count);

    const untouched = newShell();
    expect(decodeShell({ ...encodeShell(s), tb: 0 }, untouched)).toBe(false);
    expect(decodeShell({ ...encodeShell(s), s: 99 }, untouched)).toBe(false);
    expect(untouched).toEqual(newShell());
    expect(decodeBurst({ ...encodeBurst(b), l: 60 }, newBurst())).toBe(false);
  });

  it("checks echoes and volley counts", () => {
    expect(decodeBoom({ p: 1, c: 3, u: 0.4 })).toEqual({ p: 1, c: 3, u: 0.4 });
    expect(decodeBoom({ p: 1, c: 9, u: 0.4 })).toBeNull();
    expect(decodeVolley({ s: 1, c: 4, t: 5 })).toEqual({ s: 1, c: 4, t: 5 });
    expect(decodeVolley({ s: 2, c: 4, t: 5 })).toBeNull();
  });
});
