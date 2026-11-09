import { describe, expect, it } from "vitest";
import {
  createGrid,
  type Pattern,
  persistEvery,
  place,
  population,
  setCell,
  shapeOf,
  soupCells,
  step,
} from "../../../src/apps/petri/life";
import {
  defaultPreset,
  defaultStamp,
  FAMILIES,
  presetCount,
  SLIME_PRESETS,
  STAMPS,
  stampAt,
  stampIndex,
  stampsIn,
  TURING_PRESETS,
} from "../../../src/apps/petri/stamps";

const RULES = { every: persistEvery(12), fade: false };

/**
 * True when the cells repeat in place within `period` generations: a still life (period 1) or an
 * oscillator. Spaceships repeat too, but somewhere else, which is fine: they move.
 */
const staysPut = (seed: (g: ReturnType<typeof createGrid>) => void, period = 30, size = 240) => {
  const g = createGrid(size, size);
  seed(g);
  const seen = new Map<string, number>();
  // Short of the edges, where a glider would crash into a block.
  for (let i = 0; i <= 160; i++) {
    const s = shapeOf(g);
    const key = `${s.x},${s.y}:${s.key}`;
    const at = seen.get(key);
    if (at !== undefined && i - at <= period && population(g) > 0) return true;
    seen.set(key, i);
    step(g, RULES);
  }
  return false;
};

describe("petri stamp catalogue", () => {
  it("has a default stamp, children's stamps and something for adults in every family", () => {
    for (const f of FAMILIES) {
      expect(defaultStamp(f).family).toBe(f);
      expect(defaultStamp(f).band).toBe("child");
      expect(stampsIn(f, "child").length).toBeGreaterThanOrEqual(2);
    }
    // Life has no dial, so adults get the larger stamps instead.
    expect(stampsIn("life", "adult").map((s) => s.id)).toEqual(["ship", "bloom", "spark"]);
    expect(stampsIn("slime", "adult")).toEqual([]);
    expect(stampsIn("turing", "adult")).toEqual([]);
  });

  it("uses each family's own first-touch stamp", () => {
    expect(defaultStamp("life").id).toBe("soup");
    expect(defaultStamp("slime").id).toBe("spore");
    expect(defaultStamp("turing").kind).toBe("reagent");
  });

  it("finds stamps by index and id, and rejects anything else", () => {
    for (const f of FAMILIES) {
      STAMPS[f].forEach((s, i) => {
        expect(stampIndex(f, s.id)).toBe(i);
        expect(stampAt(f, i)).toBe(s);
      });
      expect(stampAt(f, STAMPS[f].length)).toBeNull();
      expect(stampAt(f, -1)).toBeNull();
      expect(stampAt(f, 0.5)).toBeNull();
    }
  });

  it("has only Life patterns that move or evolve, never a still life or oscillator", () => {
    for (const s of STAMPS.life) {
      if (s.pattern) {
        const p: Pattern = s.pattern;
        for (let rot = 0; rot < 4; rot++) {
          const t = { rot, mirror: rot % 2 === 1 };
          expect(
            staysPut((g) => place(g, p, 120, 120, 0, t)),
            s.id,
          ).toBe(false);
        }
      }
    }
  });

  it("makes soups that evolve for every seed", () => {
    const soup = STAMPS.life.find((s) => s.kind === "soup")!.soup!;
    for (let seed = 0; seed < 60; seed++) {
      const cells = soupCells(soup.cells, soup.density, seed * 7919);
      expect(cells.length).toBeGreaterThan(20);
      const g = createGrid(120, 120);
      for (const [x, y] of cells) setCell(g, 60 + x, 60 + y, 0);
      const start = shapeOf(g).key;
      step(g, RULES);
      expect(shapeOf(g).key, `seed ${seed}`).not.toBe(start);
    }
  });

  it("fills a soup blob to about its density", () => {
    const soup = STAMPS.life.find((s) => s.kind === "soup")!.soup!;
    let cells = 0;
    let area = 0;
    for (let seed = 0; seed < 40; seed++) {
      cells += soupCells(soup.cells, soup.density, seed).length;
      area += Math.PI * soup.cells * soup.cells;
    }
    expect(cells / area).toBeGreaterThan(soup.density * 0.8);
    expect(cells / area).toBeLessThan(soup.density * 1.25);
  });

  it("makes the methuselah bloom for hundreds of generations and the firecracker burn out", () => {
    const bloom = STAMPS.life.find((s) => s.id === "bloom")!.pattern!;
    const g = createGrid(400, 400);
    place(g, bloom, 200, 200, 0);
    for (let i = 0; i < 400; i++) step(g, RULES);
    expect(population(g)).toBeGreaterThan(100);
    const spark = STAMPS.life.find((s) => s.id === "spark")!.pattern!;
    const h = createGrid(80, 80);
    place(h, spark, 40, 40, 0);
    for (let i = 0; i < 130; i++) step(h, RULES);
    expect(population(h)).toBe(0);
  });

  it("keeps food and salt the only stamps that stay put", () => {
    const persistent = FAMILIES.flatMap((f) => STAMPS[f]).filter(
      (s) => s.kind === "food" || s.kind === "salt",
    );
    expect(persistent.map((s) => s.id).sort()).toEqual(["food", "salt"]);
  });
});

describe("petri conditions", () => {
  it("gives every dial three to five detents and a valid default", () => {
    for (const f of ["slime", "turing"] as const) {
      expect(presetCount(f)).toBeGreaterThanOrEqual(3);
      expect(presetCount(f)).toBeLessThanOrEqual(5);
      expect(defaultPreset(f)).toBeLessThan(presetCount(f));
    }
    expect(presetCount("life")).toBe(0);
  });

  it("runs slime presets from loose exploring to tight networks", () => {
    const reach = SLIME_PRESETS.map((p) => p.params.sensorDist);
    expect(reach[0]).toBeLessThan(reach[reach.length - 1]!);
    const decay = SLIME_PRESETS.map((p) => p.params.decay);
    expect(decay[0]).toBeLessThan(decay[decay.length - 1]!);
  });
});

/** Gray-Scott on the CPU with the shader's stencil and step, for checking presets. */
const grayScott = (feed: number, kill: number, n: number, iterations: number, radius: number) => {
  let u = new Float32Array(n * n).fill(1);
  let v = new Float32Array(n * n);
  let u2 = new Float32Array(n * n);
  let v2 = new Float32Array(n * n);
  let k = 1;
  const rand = () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (Math.hypot(x - n / 2, y - n / 2) > radius) continue;
      const r = rand();
      u[y * n + x] = 0.42 + 0.1 * r;
      v[y * n + x] = 0.36 + 0.14 * r;
    }
  }
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < n; y++) {
      const ym = (y > 0 ? y - 1 : 0) * n;
      const yp = (y < n - 1 ? y + 1 : n - 1) * n;
      const yc = y * n;
      for (let x = 0; x < n; x++) {
        const xm = x > 0 ? x - 1 : 0;
        const xp = x < n - 1 ? x + 1 : n - 1;
        const i = yc + x;
        const ui = u[i]!;
        const vi = v[i]!;
        const lu =
          -ui +
          0.2 * (u[yc + xp]! + u[yc + xm]! + u[yp + x]! + u[ym + x]!) +
          0.05 * (u[yp + xp]! + u[yp + xm]! + u[ym + xp]! + u[ym + xm]!);
        const lv =
          -vi +
          0.2 * (v[yc + xp]! + v[yc + xm]! + v[yp + x]! + v[ym + x]!) +
          0.05 * (v[yp + xp]! + v[yp + xm]! + v[ym + xp]! + v[ym + xm]!);
        const uvv = ui * vi * vi;
        u2[i] = Math.min(1, Math.max(0, ui + lu - uvv + feed * (1 - ui)));
        v2[i] = Math.min(1, Math.max(0, vi + 0.5 * lv + uvv - (feed + kill) * vi));
      }
    }
    [u, u2] = [u2, u];
    [v, v2] = [v2, v];
  }
  let on = 0;
  for (const x of v) if (x > 0.12) on++;
  return on / (n * n);
};

describe("petri reaction presets", () => {
  it("grows a single drop into pattern under every preset", { timeout: 60_000 }, () => {
    const n = 100;
    const drop = (Math.PI * 7 * 7) / (n * n);
    for (const p of TURING_PRESETS) {
      // About four seconds at twelve iterations a frame.
      const cover = grayScott(p.params.feed, p.params.kill, n, 2800, 7);
      expect(cover, p.id).toBeGreaterThan(drop * 3);
    }
  });

  it("would catch a preset where drops die away", { timeout: 60_000 }, () => {
    // Off the edge of the pattern-forming region: a drop fades out.
    expect(grayScott(0.03, 0.07, 80, 1500, 7)).toBe(0);
  });
});
