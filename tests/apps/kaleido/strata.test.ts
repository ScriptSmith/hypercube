import { describe, expect, it } from "vitest";
import {
  BAND_AMOUNT,
  bandLook,
  bandThickness,
  bandTotal,
  COLUMNS,
  createStrata,
  dayKey,
  MAX_BANDS,
  MAX_KEYS,
  memoryKV,
  parseStored,
  PREFIX,
  serialize,
} from "../../../src/apps/kaleido/strata";

const GOLD = [1, 0.8, 0.2] as const;
const BLUE = [0.2, 0.4, 1] as const;

describe("day's layers", () => {
  it("adds settled ink to the current hour's band, sums colour by amount", () => {
    const s = createStrata({ kv: memoryKV(), key: null, today: "2026-10-22" });
    s.add(9, 3, GOLD, 10);
    s.add(9, 3, BLUE, 30);
    s.add(10, 0, BLUE, 5);
    expect(s.bands.map((b) => b.hour)).toEqual([9, 10]);
    const b = s.bands[0]!;
    expect(b.amount[3]).toBe(40);
    expect(b.rgb[3 * 3]! / b.amount[3]!).toBeCloseTo((1 * 10 + 0.2 * 30) / 40);
    expect(bandTotal(s.bands[1]!)).toBe(5);
  });

  it("stacks the earliest hour first whatever order ink arrives in", () => {
    const s = createStrata({ kv: memoryKV(), key: null, today: "2026-10-22" });
    for (const h of [14, 9, 11, 9]) s.add(h, 0, GOLD, 1);
    expect(s.bands.map((b) => b.hour)).toEqual([9, 11, 14]);
  });

  it("ignores nonsense: bad hours, strips, amounts", () => {
    const s = createStrata({ kv: memoryKV(), key: null, today: "2026-10-22" });
    const v = s.version;
    s.add(24, 0, GOLD, 1);
    s.add(-1, 0, GOLD, 1);
    s.add(3, COLUMNS, GOLD, 1);
    s.add(3, -1, GOLD, 1);
    s.add(3, 0, GOLD, 0);
    s.add(3, 0, GOLD, Number.NaN);
    s.add(3, 0, GOLD, Number.POSITIVE_INFINITY);
    expect(s.bands).toHaveLength(0);
    expect(s.version).toBe(v);
  });

  it("holds at most one band an hour, 24 in all", () => {
    const s = createStrata({ kv: memoryKV(), key: null, today: "2026-10-22" });
    for (let i = 0; i < 200; i++) s.add(i % 24, i % COLUMNS, GOLD, 1);
    expect(s.bands).toHaveLength(MAX_BANDS);
    expect(new Set(s.bands.map((b) => b.hour)).size).toBe(24);
  });

  it("persists per frame, keyed by the local date, and survives a reload", () => {
    const kv = memoryKV();
    const a = createStrata({ kv, key: "f1.main", today: "2026-10-22" });
    a.add(10, 5, GOLD, 12);
    a.add(11, 6, BLUE, 3);
    expect(a.save()).toBe(true);
    expect(a.save()).toBe(false);
    const b = createStrata({ kv, key: "f1.main", today: "2026-10-22" });
    expect(b.bands.map((x) => x.hour)).toEqual([10, 11]);
    expect(b.bands[0]!.amount[5]).toBeCloseTo(12);
    const other = createStrata({ kv, key: "f2.main", today: "2026-10-22" });
    expect(other.bands).toHaveLength(0);
  });

  it("starts afresh on a new day, from storage or while running", () => {
    const kv = memoryKV();
    const a = createStrata({ kv, key: "f1.main", today: "2026-10-22" });
    a.add(20, 1, GOLD, 5);
    a.save();
    expect(createStrata({ kv, key: "f1.main", today: "2026-10-23" }).bands).toHaveLength(0);
    expect(a.roll("2026-10-22")).toBe(false);
    expect(a.roll("2026-10-23")).toBe(true);
    expect(a.bands).toHaveLength(0);
    expect(a.day).toBe("2026-10-23");
    a.save();
    expect(kv.get(`${PREFIX}f1.main`)).toBeNull();
  });

  it("clears for admin and forgets the stored day", () => {
    const kv = memoryKV();
    const s = createStrata({ kv, key: "f1.main", today: "2026-10-22" });
    s.add(9, 0, GOLD, 1);
    s.save();
    s.clear();
    expect(s.bands).toHaveLength(0);
    s.save();
    expect(createStrata({ kv, key: "f1.main", today: "2026-10-22" }).bands).toHaveLength(0);
  });

  it("keeps nothing for preview frames", () => {
    const kv = memoryKV();
    const s = createStrata({ kv, key: null, today: "2026-10-22" });
    s.add(9, 0, GOLD, 1);
    expect(s.save()).toBe(false);
    expect(kv.keys()).toHaveLength(0);
  });

  it("rejects malformed or tampered storage", () => {
    const today = "2026-10-22";
    const good = JSON.parse(serialize(today, [])) as Record<string, unknown>;
    const band = [9, Array(COLUMNS).fill(1), Array(COLUMNS * 3).fill(0.5)];
    expect(parseStored(JSON.stringify({ ...good, b: [band] }), today)).toHaveLength(1);
    const bad: unknown[] = [
      "not json",
      JSON.stringify({ ...good, v: 2 }),
      JSON.stringify({ ...good, d: "2026-10-21" }),
      JSON.stringify({ ...good, b: [[24, band[1], band[2]]] }),
      JSON.stringify({ ...good, b: [band, band] }),
      JSON.stringify({ ...good, b: [[9, Array(COLUMNS - 1).fill(1), band[2]]] }),
      JSON.stringify({ ...good, b: [[9, Array(COLUMNS).fill(-1), band[2]]] }),
      JSON.stringify({ ...good, b: [[9, band[1], Array(COLUMNS * 3).fill("x")]] }),
      JSON.stringify({ ...good, b: Array(MAX_BANDS + 1).fill(band) }),
    ];
    for (const raw of bad)
      expect(parseStored(raw as string, today), String(raw).slice(0, 60)).toBeNull();
    expect(parseStored(null, today)).toBeNull();
    // Colour sums can't claim more ink than the strip holds.
    const big = parseStored(
      JSON.stringify({ ...good, b: [[9, Array(COLUMNS).fill(1), Array(COLUMNS * 3).fill(50)]] }),
      today,
    );
    expect(big![0]!.rgb[0]).toBe(1);
  });

  it("prunes other days' keys and caps how many frames' days are kept", () => {
    const kv = memoryKV();
    kv.set(`${PREFIX}old.main`, serialize("2026-10-20", []));
    kv.set(`${PREFIX}junk`, "{");
    kv.set("hc.other.app", "keep me");
    for (let i = 0; i < MAX_KEYS + 5; i++)
      kv.set(`${PREFIX}f${i}.main`, serialize("2026-10-22", []));
    createStrata({ kv, key: "mine.main", today: "2026-10-22" });
    const keys = kv.keys();
    expect(keys).toContain("hc.other.app");
    expect(keys).not.toContain(`${PREFIX}old.main`);
    expect(keys).not.toContain(`${PREFIX}junk`);
    expect(keys.filter((k) => k.startsWith(PREFIX)).length).toBeLessThanOrEqual(MAX_KEYS);
  });

  it("formats the local date", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("band looks", () => {
  it("blur a band along its length, so it can only vary gently", () => {
    const s = createStrata({ kv: memoryKV(), key: null, today: "2026-10-22" });
    // Someone pours into one strip all hour, trying to make a mark.
    s.add(9, 16, GOLD, 500);
    const look = bandLook(s.bands[0]!);
    expect(look.level[16]).toBeGreaterThan(look.level[0]!);
    // The spike spreads over neighbours: no step between strips is large.
    for (let i = 1; i < COLUMNS; i++) {
      expect(Math.abs(look.level[i]! - look.level[i - 1]!), `strip ${i}`).toBeLessThan(0.2);
    }
    expect(look.level[15]! / look.level[16]!).toBeGreaterThan(0.75);
  });

  it("can't hold a pattern finer than a few strips", () => {
    const s = createStrata({ kv: memoryKV(), key: null, today: "2026-10-22" });
    // Alternate strips, the finest pattern anyone could aim for.
    for (let i = 0; i < COLUMNS; i += 2) s.add(9, i, GOLD, 200);
    const { level } = bandLook(s.bands[0]!);
    const inner = Array.from(level).slice(4, COLUMNS - 4);
    expect(Math.max(...inner) - Math.min(...inner)).toBeLessThan(0.02);
  });

  it("tints quiet strips with the band's own colour", () => {
    const s = createStrata({ kv: memoryKV(), key: null, today: "2026-10-22" });
    s.add(9, 0, BLUE, 300);
    const { rgb } = bandLook(s.bands[0]!);
    const far = [rgb[(COLUMNS - 1) * 3]!, rgb[(COLUMNS - 1) * 3 + 1]!, rgb[(COLUMNS - 1) * 3 + 2]!];
    expect(far[2]).toBeGreaterThan(far[0]!);
    for (const v of rgb) expect(v).toBeLessThanOrEqual(1);
  });

  it("thicken with ink settled, within bounds, and squeeze to fit the zone", () => {
    expect(bandThickness(0)).toBeGreaterThan(0);
    expect(bandThickness(BAND_AMOUNT)).toBeGreaterThan(bandThickness(10));
    expect(bandThickness(1e9)).toBeLessThanOrEqual(0.16);
    const s = createStrata({ kv: memoryKV(), key: null, today: "2026-10-22" });
    for (let h = 0; h < 24; h++) s.add(h, 0, GOLD, 1e5);
    const t = s.thicknesses();
    expect(t.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    const few = createStrata({ kv: memoryKV(), key: null, today: "2026-10-22" });
    few.add(9, 0, GOLD, 1);
    expect(few.thicknesses()[0]).toBeLessThan(0.1);
  });
});
