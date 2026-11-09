import { describe, expect, it } from "vitest";
import {
  createGlaze,
  DROP_FROM,
  drive,
  EDGE_HIGH,
  glazeThickness,
  EDGE_LOW,
  type Glaze,
  type GlazeOptions,
  MAX_DRIPS,
  MAX_DROPS,
  MAX_SPEED,
  pinchVolume,
  POOL_FALL,
  POOL_GROW,
  SECTORS,
  SEEN_SPEED,
  wrapLon,
} from "../../../src/apps/cake/glaze";
import { CAKES, lookOf, TOPPING } from "../../../src/apps/cake/looks";
import { createRng } from "../../../src/core/rng";

const DEG = Math.PI / 180;
const SLOW: GlazeOptions = { pace: "slow", kind: "icing", turn: true, drips: "drops" };

const make = (seed: string, opts: Partial<GlazeOptions> = {}) =>
  createGlaze(createRng(seed), { ...SLOW, prewarm: 420, ...opts });

/** Step `g` for `seconds`, calling `each` after every step. */
const run = (g: Glaze, seconds: number, dt: number, each?: () => void) => {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    g.step(dt);
    each?.();
  }
};

/** Every drip that set, with where its tip stopped and how fast it ever went. */
const finishes = (g: Glaze, seconds: number, dt = 1 / 20) => {
  const fastest = new Map<number, number>();
  const born = new Map<number, number>();
  const out: { tip: number; fastest: number; ran: number; long: boolean }[] = [];
  const seenSet = new Set<number>();
  run(g, seconds, dt, () => {
    for (const d of g.drips) {
      if (!born.has(d.id)) born.set(d.id, g.time);
      fastest.set(d.id, Math.max(fastest.get(d.id) ?? 0, d.v));
      if (d.phase !== "run" && d.phase !== "pool" && !seenSet.has(d.id)) {
        seenSet.add(d.id);
        out.push({
          tip: d.tip,
          fastest: fastest.get(d.id)!,
          ran: g.time - born.get(d.id)!,
          long: d.long,
        });
      }
    }
  });
  return out;
};

describe("pudding glaze", () => {
  it("drives glaze hardest on the steep sides and keeps a hanging bead creeping", () => {
    expect(drive(80 * DEG)).toBeLessThan(0.2);
    expect(drive(0)).toBeCloseTo(1);
    expect(drive(-90 * DEG)).toBeGreaterThan(0.5);
    expect(pinchVolume(-90 * DEG)).toBeLessThan(pinchVolume(-30 * DEG));
  });

  it("slows each drip smoothly to a stop within a few minutes", () => {
    const g = make("slow");
    const traces = new Map<number, number[]>();
    run(g, 1200, 1 / 30, () => {
      for (const d of g.drips) {
        if (d.phase !== "run" || d.neck > 0 || d.drops > 0 || d.long) continue;
        const t = traces.get(d.id) ?? [];
        t.push(d.v);
        traces.set(d.id, t);
      }
    });
    let checked = 0;
    for (const [id, v] of traces) {
      const done = g.drips.find((d) => d.id === id);
      if (done && done.phase === "run") continue;
      checked++;
      // A tip never jumps: speed changes only a little between steps, and it never exceeds the
      // promised crawl.
      for (let i = 1; i < v.length; i++) {
        expect(Math.abs(v[i]! - v[i - 1]!)).toBeLessThan(0.0006);
        expect(v[i]!).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
      }
      // After its fastest moment it only slows (allowing the last of its feed to nudge it).
      const peak = v.indexOf(Math.max(...v));
      for (let i = peak + 1; i < v.length; i++) expect(v[i]!).toBeLessThanOrEqual(v[i - 1]! + 2e-5);
    }
    expect(checked).toBeGreaterThan(20);

    const ends = finishes(make("stops"), 3600);
    const short = ends.filter((e) => !e.long);
    const ran = short.map((e) => e.ran).sort((a, b) => a - b);
    // Short drips come to rest after one to four minutes or so.
    expect(ran[Math.floor(ran.length * 0.1)]!).toBeGreaterThan(50);
    expect(ran[Math.floor(ran.length * 0.9)]!).toBeLessThan(300);
    for (const e of ends) expect(e.fastest).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
  }, 60_000);

  it("stops most drips above the equator, some well below it and a few at the bottom", () => {
    const ends = finishes(make("lengths"), 7200);
    const n = ends.length;
    expect(n).toBeGreaterThan(150);
    const above = ends.filter((e) => e.tip > 0).length / n;
    const below = ends.filter((e) => e.tip < -30 * DEG).length / n;
    const bottom = ends.filter((e) => e.tip < -70 * DEG).length / n;
    expect(above).toBeGreaterThan(0.6);
    expect(below).toBeGreaterThan(0.05);
    expect(bottom).toBeGreaterThan(0.02);
    expect(bottom).toBeLessThan(0.25);
  }, 60_000);

  it("lets drops go only from under the overhang, and the bottom drop grows and falls", () => {
    const g = make("drops");
    let known = new Set(g.drops);
    let overhang = 0;
    const falls: number[] = [];
    let lastFalls = g.pool.falls;
    run(g, 7200, 1 / 30, () => {
      for (const d of g.drops) {
        if (known.has(d)) continue;
        if (d.bottom) expect(d.lat).toBeCloseTo(-Math.PI / 2);
        else {
          expect(d.lat).toBeLessThan(DROP_FROM);
          overhang++;
        }
      }
      known = new Set(g.drops);
      expect(g.drops.length).toBeLessThanOrEqual(MAX_DROPS);
      if (g.pool.falls !== lastFalls) {
        falls.push(g.time);
        lastFalls = g.pool.falls;
      }
      expect(g.pool.vol).toBeLessThan(POOL_FALL * 2);
    });
    expect(overhang).toBeGreaterThan(10);
    expect(falls.length).toBeGreaterThan(10);
    // Each fall follows at least a minute or so of growing.
    for (let i = 1; i < falls.length; i++) {
      expect(falls[i]! - falls[i - 1]!).toBeGreaterThanOrEqual(POOL_GROW);
    }
  }, 60_000);

  it("gives every side of the room a moving drip within two minutes, turning or not", () => {
    for (const turn of [true, false]) {
      const g = make(`sides-${turn}`, { turn });
      const last = Array.from({ length: SECTORS }, () => g.time);
      let worst = 0;
      run(g, 3600, 1 / 20, () => {
        for (const d of g.drips) {
          if (d.v <= SEEN_SPEED) continue;
          const room = wrapLon(d.lon + g.yaw);
          const k = Math.min(SECTORS - 1, Math.floor(((room + Math.PI) / (2 * Math.PI)) * SECTORS));
          last[k] = g.time;
        }
        for (const t of last) worst = Math.max(worst, g.time - t);
      });
      expect(worst).toBeLessThan(120);
    }
  }, 60_000);

  it("keeps its pools bounded for a day, and the day's last hour looks like its first", () => {
    const g = make("day", {});
    const hour = () => {
      const start = { pours: g.pours, falls: g.pool.falls, released: g.released };
      let drips = 0;
      let n = 0;
      run(g, 3600, 0.1, () => {
        expect(g.drips.length).toBeLessThanOrEqual(MAX_DRIPS);
        expect(g.drops.length).toBeLessThanOrEqual(MAX_DROPS);
        drips += g.drips.length;
        n++;
      });
      return {
        pours: g.pours - start.pours,
        falls: g.pool.falls - start.falls,
        drips: drips / n,
      };
    };
    const first = hour();
    run(g, 22 * 3600, 0.1, () => {
      expect(g.drips.length).toBeLessThanOrEqual(MAX_DRIPS);
    });
    const last = hour();
    for (const e of g.edge) {
      expect(e).toBeGreaterThanOrEqual(EDGE_LOW - 1e-6);
      expect(e).toBeLessThanOrEqual(EDGE_HIGH + 1e-6);
    }
    expect(first.pours).toBeGreaterThanOrEqual(10);
    expect(first.pours).toBeLessThanOrEqual(21);
    expect(Math.abs(last.pours - first.pours)).toBeLessThanOrEqual(6);
    expect(last.drips).toBeGreaterThan(first.drips * 0.7);
    expect(last.drips).toBeLessThan(first.drips * 1.3);
    expect(last.falls).toBeGreaterThan(0);
  }, 120_000);

  it("pushes the cap's edge down with each pour and lets it drift back up between", () => {
    const g = make("edge");
    const mean = () => g.edge.reduce((s, e) => s + e, 0) / g.edge.length;
    // Wait for a pour to arrive and finish moving the edge.
    const pours = g.pours;
    run(g, 400, 0.05, () => undefined);
    expect(g.pours).toBeGreaterThan(pours);
    g.pour();
    const before = mean();
    run(g, 80, 0.05);
    const after = mean();
    expect(after).toBeLessThan(before - 1.5 * DEG);
    run(g, 150, 0.05);
    if (g.nextPour > g.time) expect(mean()).toBeGreaterThan(after);
  }, 60_000);

  it("gives the same show for the same seed and a different one for another", () => {
    const a = make("same");
    const b = make("same");
    const c = make("other");
    run(a, 900, 1 / 60);
    run(b, 900, 1 / 60);
    run(c, 900, 1 / 60);
    const sig = (g: Glaze) =>
      g.drips.map((d) => `${d.id}:${d.lon.toFixed(6)}:${d.tip.toFixed(6)}`).join(",");
    expect(sig(a)).toBe(sig(b));
    expect(a.pool.vol).toBe(b.pool.vol);
    expect(sig(c)).not.toBe(sig(a));
  }, 60_000);

  it("pours more often and runs faster when lively, and custard runs further", () => {
    const lively = make("lively", { pace: "lively" });
    const start = lively.pours;
    let fastest = 0;
    run(lively, 1200, 1 / 20, () => {
      for (const d of lively.drips) fastest = Math.max(fastest, d.v);
    });
    expect(lively.pours - start).toBeGreaterThanOrEqual(9);
    expect(fastest).toBeGreaterThan(MAX_SPEED);
    expect(fastest).toBeLessThanOrEqual(2 * MAX_SPEED + 1e-9);

    const median = (o: Partial<GlazeOptions>) => {
      const tips = finishes(make("runny", o), 3600)
        .filter((e) => !e.long)
        .map((e) => e.tip)
        .sort((x, y) => x - y);
      return tips[Math.floor(tips.length / 2)]!;
    };
    expect(median({ kind: "custard" })).toBeLessThan(median({ kind: "icing" }));
  }, 60_000);
});

describe("pudding glaze modes", () => {
  const lum = (g: Glaze) => g.edge.reduce((s, e) => s + e, 0);

  it("keeps a smooth cap still for a day: no drips, no pours, the edge unchanged", () => {
    const g = make("none", { drips: "none" });
    const edge = lum(g);
    expect(g.moving).toBe(false);
    expect(g.pour()).toBe(false);
    run(g, 24 * 3600, 1, () => {
      expect(g.drips.length).toBe(0);
      expect(g.drops.length).toBe(0);
    });
    expect(g.pours).toBe(0);
    expect(g.pool.vol).toBe(0);
    expect(lum(g)).toBe(edge);
    expect(g.yaw).toBeGreaterThan(0);
  });

  it("sets drips once, all above the equator, and never moves them", () => {
    const g = make("set", { drips: "set" });
    const tips = g.drips.map((d) => d.tip);
    expect(tips.length).toBeGreaterThanOrEqual(18);
    expect(tips.length).toBeLessThanOrEqual(24);
    for (const d of g.drips) {
      expect(d.phase).toBe("set");
      expect(d.tip).toBeGreaterThan(2 * DEG);
      expect(d.tip).toBeLessThan(g.edgeAt(d.lon));
      const s = g.shape(d);
      // Beads only a little wider than their stems.
      expect(s.rb).toBeLessThan(1.3 * s.w1);
    }
    run(g, 24 * 3600, 1);
    expect(g.drips.map((d) => d.tip)).toEqual(tips);
    expect(g.drips.every((d) => d.phase === "set")).toBe(true);
    expect(g.pours).toBe(0);
  });

  it("lets drips run and stop around the equator or above, with nothing letting go", () => {
    const g = make("runs", { drips: "runs" });
    const last = Array.from({ length: SECTORS }, () => g.time);
    let worst = 0;
    let lowest = 1;
    let widest = 0;
    run(g, 7200, 1 / 20, () => {
      for (const d of g.drips) {
        lowest = Math.min(lowest, d.tip);
        const s = g.shape(d);
        widest = Math.max(widest, s.rb / s.w1);
        if (d.v <= SEEN_SPEED) continue;
        const room = wrapLon(d.lon + g.yaw);
        const k = Math.min(SECTORS - 1, Math.floor(((room + Math.PI) / (2 * Math.PI)) * SECTORS));
        last[k] = g.time;
      }
      for (const t of last) worst = Math.max(worst, g.time - t);
      expect(g.drops.length).toBe(0);
      expect(g.drips.every((d) => d.neck === 0 && d.phase !== "pool")).toBe(true);
    });
    expect(g.released).toBe(0);
    expect(g.pool.vol).toBe(0);
    expect(g.pours).toBeGreaterThan(15);
    expect(lowest).toBeGreaterThan(-8 * DEG);
    expect(widest).toBeLessThan(1.4);
    expect(worst).toBeLessThan(120);
  }, 60_000);
});

describe("cakes", () => {
  it("give each cake its own glaze, toppings only where they belong, and holly only on the pudding", () => {
    const icing = lookOf("pudding", "icing");
    const luma = (c: readonly number[]) => 0.3 * c[0]! + 0.55 * c[1]! + 0.15 * c[2]!;
    for (const cake of CAKES) {
      const look = lookOf(cake, "icing");
      expect(look.holly).toBe(cake === "pudding");
      expect(glazeThickness(look.kind)).toBeGreaterThan(0.5);
      // No glaze brighter than the ivory icing, which the dazzle rule already holds down.
      expect(luma(look.glaze)).toBeLessThanOrEqual(luma(icing.glaze) + 1e-9);
      for (const c of look.glaze) expect(c).toBeGreaterThanOrEqual(0);
    }
    expect(lookOf("pudding", "custard").kind).toBe("custard");
    expect(lookOf("chocolate", "custard").kind).toBe("ganache");
    expect(lookOf("chocolate", "icing").topping).toBe(TOPPING.chocolate);
    expect(lookOf("strawberry", "icing").topping).toBe(TOPPING.rainbow);
    expect(lookOf("galaxy", "icing").marble).toBe(true);
  });
});
