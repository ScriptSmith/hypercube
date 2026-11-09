import { describe, expect, it } from "vitest";
import {
  AMBERS,
  createShow,
  FADE,
  PARTY,
  planScene,
  spinAngle,
  spinRate,
  TURN_SECONDS,
  WHITES,
} from "../../../src/apps/discoball/show";

const totalPower = (show: ReturnType<typeof createShow>, t: number) =>
  show.at(t).spots.reduce((s, x) => s + x.power, 0);

describe("discoball show", { timeout: 60_000 }, () => {
  it("never uses a saturated red", () => {
    for (const c of [...PARTY, ...WHITES, ...AMBERS]) {
      expect(c[0] / (c[0] + c[1] + c[2])).toBeLessThan(0.6);
      expect(Math.max(...c)).toBeCloseTo(1, 9);
    }
  });

  it("is the same show for the same seed and a different one for another", () => {
    const a = createShow("x", "party");
    const b = createShow("x", "party");
    const c = createShow("y", "party");
    let differs = false;
    for (let t = 0; t < 600; t += 7) {
      const la = a.at(t);
      const lb = b.at(t);
      expect(la.scene).toBe(lb.scene);
      expect(la.spots.map((s) => s.dir)).toEqual(lb.spots.map((s) => s.dir));
      const lc = c.at(t);
      if (lc.scene !== la.scene || lc.spots[0]?.dir[0] !== la.spots[0]?.dir[0]) differs = true;
    }
    expect(differs).toBe(true);
  });

  it("starts with party colours, or white sparkle, already up", () => {
    expect(createShow(1, "party").at(0).scene).toBe("party");
    expect(createShow(1, "white").at(0).scene).toBe("sparkle");
    expect(totalPower(createShow(1, "party"), 0)).toBeGreaterThan(8);
  });

  it("moves through every kind of scene over an hour, never the same twice running", () => {
    for (const mode of ["party", "white"] as const) {
      const show = createShow("hour", mode);
      const kinds: string[] = [];
      let index = -1;
      for (let t = 0; t < 3600; t += 1) {
        const l = show.at(t);
        if (l.index !== index) {
          expect(l.index).toBe(index + 1);
          index = l.index;
          kinds.push(l.scene);
        }
        expect(show.current.length).toBeLessThanOrEqual(2);
      }
      for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1]);
      const want = mode === "party" ? 5 : 4;
      expect(new Set(kinds).size).toBe(want);
      // About a minute a scene.
      expect(kinds.length).toBeGreaterThan(40);
      expect(kinds.length).toBeLessThan(110);
    }
  });

  it("keeps white lights white", () => {
    const show = createShow("w", "white");
    for (let t = 0; t < 3600; t += 3) {
      for (const s of show.at(t).spots) expect(Math.min(...s.color)).toBeGreaterThan(0.6);
    }
  });

  it("fades between scenes without a jump in light", () => {
    const show = createShow("fade", "party");
    let last = totalPower(show, 0);
    let fades = 0;
    for (let t = 0.05; t < 1200; t += 0.05) {
      const now = totalPower(show, t);
      // A fade changes the light by about a percent every twentieth of a second; a light
      // switching on or off would change it by a quarter or more.
      expect(Math.abs(now - last)).toBeLessThan(0.025 * Math.max(now, last, 1));
      last = now;
      const l = show.at(t);
      if (l.next) fades++;
      for (const g of l.glows) expect(Math.max(...g.color)).toBeLessThan(0.15);
    }
    expect(fades * 0.05).toBeGreaterThan(FADE * 5);
  });

  it("moves its spotlights slowly", () => {
    const show = createShow("move", "party");
    const prev = show.at(0).spots.map((s) => [...s.dir]);
    for (let t = 1 / 60; t < 300; t += 1 / 60) {
      const l = show.at(t);
      if (l.next) {
        prev.length = 0;
        continue;
      }
      if (prev.length === l.spots.length) {
        l.spots.forEach((s, i) => {
          const p = prev[i]!;
          const step = Math.acos(
            Math.min(1, s.dir[0] * p[0]! + s.dir[1] * p[1]! + s.dir[2] * p[2]!),
          );
          // Under 20 degrees a second.
          expect(step * 60).toBeLessThan(0.35);
        });
      }
      prev.length = 0;
      for (const s of l.spots) prev.push([...s.dir]);
    }
  });

  it("works out any moment, also after going back and after days", () => {
    const show = createShow("days", "party");
    show.at(5000);
    const back = show.at(10);
    const fresh = createShow("days", "party").at(10);
    expect(back.scene).toBe(fresh.scene);
    expect(back.spots.map((s) => s.dir)).toEqual(fresh.spots.map((s) => s.dir));
    const far = createShow("days", "party");
    const t0 = performance.now();
    for (let t = 0; t < 3 * 86400; t += 30) far.at(t);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(far.current.length).toBeLessThanOrEqual(2);
  });

  it("plans each scene with a handful of lights, mostly high, most with one low", () => {
    let low = 0;
    for (let k = 1; k < 200; k++) {
      const plan = planScene("plan", "party", k, 0, null);
      expect(plan.spots.length).toBeGreaterThanOrEqual(1);
      expect(plan.spots.length).toBeLessThanOrEqual(5);
      expect(plan.glows.length).toBeLessThanOrEqual(3);
      if (plan.spots.some((s) => s.el < -0.5)) low++;
      const length = plan.end - plan.start;
      expect(length).toBeGreaterThanOrEqual(25);
      expect(length).toBeLessThanOrEqual(90);
    }
    expect(low).toBeGreaterThan(150);
  });
});

describe("discoball spin", { timeout: 60_000 }, () => {
  it("turns once every 20 to 40 s, steadily, with slow changes of speed", () => {
    for (const turn of Object.values(TURN_SECONDS)) {
      expect(turn).toBeGreaterThanOrEqual(20);
      expect(turn).toBeLessThanOrEqual(40);
      const base = (2 * Math.PI) / turn;
      let lo = Infinity;
      let hi = 0;
      for (let t = 0; t < 600; t += 0.5) {
        const r = spinRate(t, turn);
        lo = Math.min(lo, r);
        hi = Math.max(hi, r);
        // The angle is the integral of the rate.
        const h = 1e-3;
        let d = spinAngle(t + h, turn) - spinAngle(t - h, turn);
        if (d < -Math.PI) d += 2 * Math.PI;
        expect(d / (2 * h)).toBeCloseTo(r, 4);
        // Never faster than 3 % a second.
        expect(Math.abs(spinRate(t + 1, turn) - r) / base).toBeLessThan(0.03);
      }
      expect(lo / base).toBeGreaterThan(0.75);
      expect(hi / base).toBeLessThan(1.25);
      expect(spinAngle(0, turn)).toBe(0);
      const day = spinAngle(86400.5, turn);
      expect(day).toBeGreaterThanOrEqual(0);
      expect(day).toBeLessThan(2 * Math.PI);
    }
  });
});
