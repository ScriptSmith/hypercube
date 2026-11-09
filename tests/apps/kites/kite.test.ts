import { describe, expect, it } from "vitest";
import {
  spoolAutopilot,
  spoolPilot,
  stuntAutopilot,
  stuntPilot,
} from "../../../src/apps/kites/autopilot";
import {
  createSpool,
  createStunt,
  type SkyBounds,
  SPOOL,
  stepSpool,
  stepStunt,
  STUNT,
  type StuntWindow,
  WIND_SPEED,
  type WindFn,
} from "../../../src/apps/kites/kite";
import { createWindField, WIND_PRESETS, windAt, windDir } from "../../../src/apps/kites/wind";

const DT = 1 / 120;
const SKY: SkyBounds = { xmin: 0.04, xmax: 1.06, floor: 0.07, top: 0.97 };
const WIN: StuntWindow = { a: 0.3, b: 0.92, shift: 0.09 };
const T0 = 1_760_000_000;

/** A field and a moment when it blows steadily one way. */
const steadyWind = (preset: "gentle" | "breezy" | "gusty", seed: number) => {
  const field = createWindField(seed, WIND_PRESETS[preset]);
  let t = T0 + seed * 97;
  while (Math.abs(windDir(field, t)) < 0.97 || Math.abs(windDir(field, t + 40)) < 0.97) t += 7;
  return { field, t };
};

const flySpool = (
  preset: "gentle" | "breezy" | "gusty",
  seed: number,
  col?: readonly [number, number],
) => {
  const { field, t: t0 } = steadyWind(preset, seed);
  const k = createSpool(0.55, Math.sign(windDir(field, t0)), col);
  let t = t0;
  const wind: WindFn = (x, y) => windAt(field, t, x / 1.1, y) * WIND_SPEED;
  const run = (s: number, haul: (i: number) => number) => {
    const ys: number[] = [];
    let outside = 0;
    let wandered = 0;
    for (let i = 0; i < s / DT; i++) {
      stepSpool(k, haul(i), wind, SKY, DT);
      t += DT;
      ys.push(k.y);
      if (k.y < SKY.floor - 1e-9 || k.x < SKY.xmin - 1e-9 || k.x > SKY.xmax + 1e-9) outside++;
      if (col && (k.x < col[0] - 1e-9 || k.x > col[1] + 1e-9)) wandered++;
    }
    expect(outside, "steps outside the sky").toBe(0);
    expect(wandered, "steps outside its column").toBe(0);
    return ys;
  };
  return { k, run };
};

const held = () => SPOOL.hold;
const free = () => 0;

describe("spool kite", () => {
  for (const preset of ["gentle", "breezy", "gusty"] as const) {
    it(`climbs steadily while held and drifts down slowly once let go (${preset})`, () => {
      for (const seed of [1, 2, 3]) {
        const { k, run } = flySpool(preset, seed);
        run(8, free);
        const rest = k.y;
        const up = run(4, held);
        const high = k.y;
        expect(high, `seed ${seed}: climbs`).toBeGreaterThan(rest + 0.45);
        expect(high).toBeGreaterThan(0.7);
        // Steadily: higher every half second of the climb.
        for (let i = 60; i < 360; i += 60) expect(up[i]!).toBeGreaterThan(up[i - 60]!);
        // Slowly: still well up a second after letting go.
        const down = run(12, free);
        expect(down[Math.round(1 / DT)]!, `seed ${seed}: drifts`).toBeGreaterThan(high - 0.2);
        expect(down.at(-1)!, `seed ${seed}: sinks`).toBeLessThan(high - 0.35);
        run(20, free);
        expect(k.y, `seed ${seed}: hovers low`).toBeLessThan(0.35);
        expect(k.y, `seed ${seed}: never down`).toBeGreaterThan(SKY.floor);
        expect(k.length).toBeLessThan(SPOOL.rest + 0.05);
      }
    });
  }

  it("climbs as soon as it is held", () => {
    const { k, run } = flySpool("breezy", 4);
    run(6, free);
    const rest = k.y;
    run(0.3, held);
    expect(k.y).toBeGreaterThan(rest + 0.03);
  });

  it("hops on a tap and settles back", () => {
    for (const preset of ["gentle", "breezy", "gusty"] as const) {
      const { k, run } = flySpool(preset, 5);
      run(8, free);
      const rest = k.y;
      run(0.35, held);
      const hop = Math.max(...run(1.5, free));
      expect(hop, preset).toBeGreaterThan(rest + 0.05);
      expect(hop, preset).toBeLessThan(rest + 0.3);
      run(8, free);
      expect(k.y, preset).toBeLessThan(rest + 0.03);
    }
  });

  it("stays in its own column, even a narrow one", () => {
    for (const preset of ["gentle", "breezy", "gusty"] as const) {
      for (const col of [
        [0.5, 0.56],
        [0.42, 0.68],
      ] as const) {
        const { run } = flySpool(preset, 6, col);
        const ys = run(60, (i) => ((i * DT) % 9 < 3 ? SPOOL.hold : 0));
        expect(Math.max(...ys), `${preset}: still climbs`).toBeGreaterThan(0.75);
        expect(Math.min(...ys.slice(600)), `${preset}: never down`).toBeGreaterThan(SKY.floor);
      }
    }
  });

  it("never crashes with nobody touching, and hovers above the floor", () => {
    for (const preset of ["gentle", "breezy", "gusty"] as const) {
      const field = createWindField(11, WIND_PRESETS[preset]);
      const k = createSpool(0.5);
      let t = T0;
      const wind: WindFn = (x, y) => windAt(field, t, x / 1.1, y) * WIND_SPEED;
      let low = 0;
      let bad = 0;
      for (let i = 0; i < 600 / DT; i++) {
        stepSpool(k, 0, wind, SKY, DT);
        t += DT;
        if (!Number.isFinite(k.x + k.y + k.theta + k.omega)) bad++;
        if (k.y <= SKY.floor + 0.005) low++;
      }
      expect(bad).toBe(0);
      // Grounded only while the wind swings over (a few short spells in ten minutes).
      expect(low * DT).toBeLessThan(240);
    }
  });

  it("flies downwind of its anchor", () => {
    for (const dir of [1, -1]) {
      const k = createSpool(0.55, dir);
      const wind: WindFn = () => dir * 0.6;
      for (let i = 0; i < 10 / DT; i++) stepSpool(k, 0, wind, SKY, DT);
      expect(Math.sign(k.x - k.ax)).toBe(dir);
      expect(k.y).toBeGreaterThan(0.1);
    }
  });

  it("loses lift and wobbles while tangled", () => {
    const wind: WindFn = () => 0.6;
    const loose = createSpool(0.55, 1);
    const caught = createSpool(0.55, 1);
    caught.tangled = true;
    for (let i = 0; i < 4 / DT; i++) {
      stepSpool(loose, SPOOL.hold * 0.5, wind, SKY, DT);
      stepSpool(caught, SPOOL.hold * 0.5, wind, SKY, DT);
    }
    expect(caught.y).toBeLessThan(loose.y);
    expect(caught.tangle).toBeGreaterThan(0.9);
  });

  it("sparkles in the top band of the sky", () => {
    const { k, run } = flySpool("breezy", 5);
    run(10, held);
    expect(k.y).toBeGreaterThan(0.8 * SKY.top);
    expect(k.sparkle).toBe(true);
    run(25, free);
    expect(k.sparkle).toBe(false);
  });
});

const flyStunt = (wind: WindFn = () => 0.6) => {
  const k = createStunt(0.55, WIN, 1);
  const step = (s: number, left: number, right: number, held = true) => {
    let below = 0;
    for (let i = 0; i < s / DT; i++) {
      stepStunt(k, { held, left, right }, wind, WIN, SKY, DT);
      if (k.y < SKY.floor - 1e-9) below++;
    }
    expect(below).toBe(0);
  };
  return { k, step };
};

describe("stunt kite", () => {
  it("turns towards the lower handle", () => {
    const a = flyStunt();
    a.k.heading = 0;
    a.k.y = 0.5;
    a.step(0.3, 1, 0);
    expect(a.k.heading).toBeGreaterThan(0.5);
    const b = flyStunt();
    b.k.heading = Math.PI;
    b.k.y = 0.5;
    b.step(0.3, 0, 1);
    expect(b.k.heading).toBeGreaterThan(Math.PI - 0.01 - Math.PI * 2);
    // From pointing left, the right handle turns it right, which is towards up.
    const c = flyStunt();
    c.k.heading = Math.PI;
    c.k.y = 0.5;
    c.step(0.25, 0, 1);
    expect(Math.sin(c.k.heading)).toBeGreaterThan(0.3);
  });

  it("flies faster with both handles pulled", () => {
    const slow = flyStunt();
    const fast = flyStunt();
    for (const s of [slow, fast]) {
      s.k.y = 0.4;
      s.k.heading = 0;
      s.k.x = s.k.ax - 0.1;
    }
    slow.step(0.4, 0, 0);
    fast.step(0.4, 1, 1);
    expect(fast.k.speed).toBeGreaterThan(slow.k.speed * 1.5);
  });

  it("is fast in the middle of its window and slow at the edge", () => {
    const mid = flyStunt();
    mid.k.y = 0.25;
    mid.k.heading = 0.3;
    mid.step(0.5, 0, 0);
    const edge = flyStunt();
    edge.k.y = 0.85;
    edge.k.heading = 0.3;
    edge.step(0.5, 0, 0);
    expect(mid.k.speed).toBeGreaterThan(edge.k.speed * 1.5);
  });

  it("loops with one handle held down", () => {
    const { k, step } = flyStunt();
    k.y = 0.45;
    k.x = k.ax + 0.09;
    let turned = 0;
    let last = k.heading;
    for (let i = 0; i < 4 / DT; i++) {
      step(DT, 1, 0.2);
      let d = k.heading - last;
      if (d < -Math.PI) d += Math.PI * 2;
      if (d > Math.PI) d -= Math.PI * 2;
      turned += d;
      last = k.heading;
    }
    expect(turned).toBeGreaterThan(Math.PI * 2);
  });

  it("parks at the top of its window when let go", () => {
    const { k, step } = flyStunt();
    k.y = 0.3;
    k.heading = -2;
    step(12, 0, 0, false);
    expect(k.y).toBeGreaterThan(0.75);
    expect(k.parked).toBeGreaterThan(0.8);
    expect(k.speed).toBeLessThan(0.1);
  });

  it("lands with a bump when flown into the ground and relaunches after 2 s", () => {
    const { k, step } = flyStunt();
    k.y = 0.2;
    k.heading = -Math.PI / 2;
    k.speed = STUNT.speed;
    step(0.6, 0.5, 0.5);
    expect(k.phase).toBe("down");
    step(1.5, 0, 0);
    expect(k.phase).toBe("down");
    step(0.7, 0, 0);
    expect(k.phase).toBe("fly");
    step(3, 0, 0, false);
    expect(k.y).toBeGreaterThan(0.3);
  });

  it("stays inside its window and the sky", () => {
    const field = createWindField(8, WIND_PRESETS.gusty);
    let t = T0;
    const wind: WindFn = (x, y) => windAt(field, t, x / 1.1, y) * WIND_SPEED;
    const { k } = flyStunt(wind);
    let outside = 0;
    for (let i = 0; i < 120 / DT; i++) {
      const turn = Math.sin(i * DT * 0.7);
      stepStunt(
        k,
        { held: true, left: Math.max(0, turn), right: Math.max(0, -turn) },
        wind,
        WIN,
        SKY,
        DT,
      );
      t += DT;
      if (k.x < SKY.xmin - 1e-9 || k.x > SKY.xmax + 1e-9 || k.y > SKY.top + 1e-9) outside++;
    }
    expect(outside).toBe(0);
  });
});

describe("autopilot", () => {
  it("holds the spool while the kite climbs and lets go while it drifts down", () => {
    for (const preset of ["gentle", "breezy", "gusty"] as const) {
      const { field, t: t0 } = steadyWind(preset, 6);
      const k = createSpool(0.55, Math.sign(windDir(field, t0)));
      let t = t0;
      const wind: WindFn = (x, y) => windAt(field, t, x / 1.1, y) * WIND_SPEED;
      const pilot = spoolPilot(1);
      const ys: number[] = [];
      const spells: { hold: boolean; s: number }[] = [];
      let last = false;
      let since = 0;
      for (let i = 0; i < 90 / DT; i++) {
        const hold = spoolAutopilot(k, t, 1, SKY.top, pilot, DT);
        stepSpool(k, hold ? SPOOL.hold : 0, wind, SKY, DT);
        t += DT;
        since += DT;
        if (hold !== last) {
          if (i * DT > 10) spells.push({ hold: last, s: since });
          last = hold;
          since = 0;
        }
        if (i * DT > 10) ys.push(k.y);
      }
      expect(Math.min(...ys), preset).toBeGreaterThan(0.12);
      expect(Math.min(...ys), preset).toBeLessThan(0.35);
      expect(Math.max(...ys), preset).toBeGreaterThan(0.55);
      expect(Math.max(...ys), preset).toBeLessThan(0.85);
      const holds = spells.filter((x) => x.hold);
      const rests = spells.filter((x) => !x.hold);
      expect(holds.length, preset).toBeGreaterThanOrEqual(6);
      // Long enough to see, so the ghost finger never flickers.
      for (const h of holds) expect(h.s).toBeGreaterThanOrEqual(0.8 - 1e-6);
      for (const r of rests) expect(r.s).toBeGreaterThanOrEqual(1.6 - 1e-6);
    }
  });

  it("keeps a stunt kite looping without crashing often", () => {
    for (const preset of ["gentle", "breezy", "gusty"] as const) {
      const field = createWindField(12, WIND_PRESETS[preset]);
      let t = T0;
      const wind: WindFn = (x, y) => windAt(field, t, x / 1.1, y) * WIND_SPEED;
      const k = createStunt(0.55, WIN, 1);
      const handles = stuntPilot();
      let crashes = 0;
      let travelled = 0;
      for (let i = 0; i < 120 / DT; i++) {
        stuntAutopilot(k, WIN, t, 2, handles, DT);
        const was = k.phase;
        const x = k.x;
        const y = k.y;
        stepStunt(k, { held: true, left: handles.left, right: handles.right }, wind, WIN, SKY, DT);
        travelled += Math.hypot(k.x - x, k.y - y);
        if (was === "fly" && k.phase === "down") crashes++;
        t += DT;
      }
      expect(crashes, preset).toBeLessThanOrEqual(3);
      expect(travelled, preset).toBeGreaterThan(10);
    }
  });
});
