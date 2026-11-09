import { describe, expect, it } from "vitest";
import {
  addGust,
  createWindField,
  gustsAt,
  type Gust,
  liveParams,
  pruneGusts,
  WIND_PRESETS,
  windAt,
  windDir,
} from "../../../src/apps/kites/wind";

const T0 = 1_760_000_000; // shared clock, seconds

describe("wind", () => {
  it("is the same on every frame for the same seed, time and place", () => {
    for (const preset of ["gentle", "breezy", "gusty"] as const) {
      const a = createWindField(424242, WIND_PRESETS[preset]);
      const b = createWindField(424242, WIND_PRESETS[preset]);
      for (let i = 0; i < 200; i++) {
        const t = T0 + i * 1.37;
        const f = (i % 23) / 22;
        const h = (i % 7) / 6;
        expect(windAt(a, t, f, h)).toBe(windAt(b, t, f, h));
      }
    }
  });

  it("differs between rooms", () => {
    const a = createWindField(1, WIND_PRESETS.breezy);
    const b = createWindField(2, WIND_PRESETS.breezy);
    let same = 0;
    for (let i = 0; i < 50; i++)
      if (windAt(a, T0 + i * 3, 0.5, 0.5) === windAt(b, T0 + i * 3, 0.5, 0.5)) same++;
    expect(same).toBeLessThan(5);
  });

  it("blows harder in stronger settings and higher up", () => {
    const mean = (preset: "gentle" | "breezy" | "gusty", h: number) => {
      const w = createWindField(9, WIND_PRESETS[preset]);
      let s = 0;
      for (let i = 0; i < 2000; i++) s += Math.abs(windAt(w, T0 + i * 1.1, (i % 10) / 9, h));
      return s / 2000;
    };
    expect(mean("gentle", 0.5)).toBeLessThan(mean("breezy", 0.5));
    expect(mean("breezy", 0.5)).toBeLessThan(mean("gusty", 0.5));
    expect(mean("breezy", 0.1)).toBeLessThan(mean("breezy", 0.9));
  });

  it("swings over to the other side now and then, slowly", () => {
    const w = createWindField(77, WIND_PRESETS.breezy);
    let flips = 0;
    let last = Math.sign(windDir(w, T0));
    let swingStart: number | null = null;
    const swings: number[] = [];
    for (let s = 0; s < 3 * 3600; s += 1) {
      const d = windDir(w, T0 + s);
      if (Math.abs(d) < 0.9 && swingStart === null) swingStart = s;
      if (Math.abs(d) >= 0.9 && swingStart !== null) {
        swings.push(s - swingStart);
        swingStart = null;
      }
      if (Math.sign(d) !== last && Math.abs(d) > 0.5) {
        flips++;
        last = Math.sign(d);
      }
    }
    expect(flips).toBeGreaterThanOrEqual(2);
    expect(flips).toBeLessThan(60);
    // Each swing between steady directions takes tens of seconds, not a moment.
    const real = swings.filter((x) => x > 5);
    expect(real.length).toBeGreaterThan(0);
    expect(Math.max(...real)).toBeGreaterThan(30);
  });

  it("gusts travel downwind across the bank, reaching one place before the next", () => {
    const w = createWindField(5, WIND_PRESETS.gusty);
    const out: Gust[] = [];
    let checked = 0;
    for (let s = 0; s < 600 && checked < 20; s += 2) {
      const t = T0 + s;
      const dir = Math.sign(windDir(w, t));
      gustsAt(w, t, out);
      const before = out.map((g) => g.f);
      gustsAt(w, t + 0.5, out);
      if (out.length !== before.length || out.length === 0) continue;
      for (let i = 0; i < out.length; i++) {
        const moved = out[i]!.f - before[i]!;
        if (Math.sign(out[i]!.amp) !== dir) continue;
        expect(Math.sign(moved)).toBe(dir);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("feels a gust at the upwind end of the bank before the downwind end", () => {
    const w = createWindField(31, WIND_PRESETS.gusty);
    // Find a moment with steady wind to the right, then a commanded gust.
    let t = T0;
    while (windDir(w, t) < 0.95) t += 5;
    addGust(w, t, 1);
    const peakAt = (f: number) => {
      let best = -Infinity;
      let at = 0;
      for (let s = 0; s < 20; s += 0.05) {
        const v = windAt(w, t + s, f, 0.5);
        if (v > best) {
          best = v;
          at = s;
        }
      }
      return at;
    };
    expect(peakAt(0.1)).toBeLessThan(peakAt(0.5));
    expect(peakAt(0.5)).toBeLessThan(peakAt(0.9));
  });

  it("keeps few commanded gusts, ignores repeats and drops spent ones", () => {
    const w = createWindField(3, WIND_PRESETS.breezy);
    expect(addGust(w, T0, 1)).toBe(true);
    expect(addGust(w, T0 + 0.5, 1)).toBe(false);
    for (let i = 1; i < 10; i++) addGust(w, T0 + i * 3, 1);
    expect(w.commanded.length).toBeLessThanOrEqual(4);
    pruneGusts(w, T0 + 1000);
    expect(w.commanded).toHaveLength(0);
    expect(addGust(w, Number.NaN, 1)).toBe(false);
  });

  it("maps real wind onto the bank", () => {
    const west = liveParams(5, 9, 270); // from the west: blows east, to the right
    const east = liveParams(5, 9, 90);
    expect(west.dir).toBe(1);
    expect(east.dir).toBe(-1);
    expect(liveParams(0, 0, 0).mean).toBeGreaterThan(0.3);
    expect(liveParams(40, 60, 200).mean).toBeLessThanOrEqual(1.8);
    expect(liveParams(4.5, 4.5, 270).gust).toBeGreaterThan(0);
    const w = createWindField(1, west);
    for (let i = 0; i < 50; i++) expect(windDir(w, T0 + i * 60)).toBe(1);
  });
});
