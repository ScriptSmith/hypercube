import { describe, expect, it } from "vitest";
import { PLUME_TIMEOUT_MS, SCREEN_UREF } from "../../../src/apps/airflow/config";
import {
  buildInlet,
  createSlots,
  defaultPlume,
  rakeAt,
  screenInlet,
} from "../../../src/apps/airflow/inflow";
import { makeTunnel } from "../../../src/apps/airflow/layout";
import { VENUE_SIZE } from "../../../src/core/frame";
import { decodePlume, encodeValues } from "../../../src/apps/airflow/wire";

const screenTunnel = () => makeTunnel("up", { x: 0, y: 0, ...VENUE_SIZE.screen }, 24);

const plume = (pos: number, up: number, right: number, smoke: [number, number, number], n = 40) =>
  decodePlume(
    encodeValues(
      pos,
      Array(n).fill(up),
      Array(n).fill(right),
      Array.from({ length: n * 3 }, (_, k) => smoke[k % 3]!),
      0,
      false,
    ),
  )!;

describe("inflow", () => {
  it("rakes thin streaks of smoke, one colour each, taking turns", () => {
    const out = new Float32Array(4);
    const colours = new Set<number>();
    let lit = 0;
    for (let r = 0; r < 200; r++) {
      rakeAt(r, 10, out, 0);
      const on = [out[0]!, out[1]!, out[2]!].filter((v) => v > 0);
      expect(on.length).toBeLessThanOrEqual(1);
      for (const v of on) {
        expect(v).toBeLessThanOrEqual(1);
        lit++;
      }
      [0, 1, 2].forEach((c) => out[c]! > 0.5 && colours.add(c));
    }
    expect(colours.size).toBe(3);
    // Streaks, not a wash: most rows carry no smoke.
    expect(lit).toBeLessThan(100);
    expect(lit).toBeGreaterThan(20);
  });

  it("blows each zone's wind over its own rows and nothing over the rest", () => {
    const data = buildInlet(
      20,
      [
        { rows: [0, 9], speed: 0.04, tau: 0.52 },
        { rows: [11, 20], speed: 0.06, tau: 0.55 },
      ],
      6,
    );
    expect(data[0]).toBeCloseTo(0.04, 6);
    expect(data[2]).toBeCloseTo(0.52, 6);
    expect(data[10 * 4]).toBe(0);
    expect(data[15 * 4]).toBeCloseTo(0.06, 6);
    expect(data[15 * 4 + 2]).toBeCloseTo(0.55, 6);
    for (let r = 0; r < 20; r++) expect(data[r * 4 + 1]).toBe(0);
  });

  it("puts each frame's plume above that frame on the screen", () => {
    const t = screenTunnel();
    const slots = createSlots(4);
    slots.hear(plume(1, 2, 0, [1, 0, 0]), 0);
    slots.hear(plume(1, 2, 0, [1, 0, 0]), 10);
    for (let i = 0; i < 40; i++) slots.update(10 + i * 50, 0.05);
    const data = screenInlet(t, 4, slots, 2000, 0, 0.52, 5);
    for (let r = 0; r < t.height; r++) {
      // Lattice rows run right to left across the screen.
      const x = t.rect.width - (r + 0.5) * t.cell;
      const f = x / t.rect.width;
      if (f > 0.27 && f < 0.48) {
        expect(data[r * 4]).toBeCloseTo(2 * SCREEN_UREF, 2);
        expect(data[(t.height + r) * 4]).toBeGreaterThan(0.95);
      } else if (f < 0.23 || f > 0.52) {
        expect(data[r * 4]).toBeLessThan(1.1 * SCREEN_UREF);
      }
    }
  });

  it("turns a frame's sideways air into the lattice's across direction (to the left)", () => {
    const t = screenTunnel();
    const slots = createSlots(1);
    slots.hear(plume(0, 1, 1, [0, 0, 0]), 0);
    slots.hear(plume(0, 1, 1, [0, 0, 0]), 1);
    for (let i = 0; i < 40; i++) slots.update(i * 50, 0.05);
    const data = screenInlet(t, 1, slots, 2000, 0, 0.52, 5);
    const r = Math.floor(t.height / 2);
    expect(data[r * 4 + 1]).toBeCloseTo(-SCREEN_UREF, 2);
  });

  it("fades a silent frame back to the screen's own updraft", () => {
    const t = screenTunnel();
    const slots = createSlots(2);
    slots.hear(plume(0, 2, 0, [0, 0, 1]), 0);
    for (let i = 0; i < 40; i++) slots.update(i * 25, 0.025);
    expect(slots.update(1000, 0)).toEqual([0]);
    let now = 1000;
    while (now < PLUME_TIMEOUT_MS + 4000) {
      now += 50;
      slots.update(now, 0.05);
    }
    expect(slots.get(0)).toBeUndefined();
    const data = screenInlet(t, 2, slots, now, 3, 0.52, 5);
    const r = Math.floor(t.height * 0.75);
    const x = t.rect.width - (r + 0.5) * t.cell;
    const d = defaultPlume(0, (x / t.rect.width) * 2, 3);
    expect(data[r * 4]).toBeCloseTo(d.up * SCREEN_UREF, 6);
  });

  it("ignores plumes from positions beyond the bank", () => {
    const slots = createSlots(2);
    slots.hear(plume(5, 1, 0, [0, 0, 0]), 0);
    expect(slots.update(10, 0)).toEqual([]);
  });

  it("keeps the screen's own updraft rising and its sway bounded", () => {
    for (let pos = 0; pos < 10; pos++) {
      for (let u = 0; u <= 1; u += 0.05) {
        for (const t of [0, 1.3, 7.7]) {
          const d = defaultPlume(pos, u, t);
          expect(d.up).toBeGreaterThan(0.5);
          expect(d.up).toBeLessThan(1.1);
          expect(Math.abs(d.right)).toBeLessThan(0.25);
        }
      }
    }
  });
});
