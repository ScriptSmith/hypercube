import { describe, expect, it } from "vitest";
import { KINDS, nearestStep, WINDS } from "../../../src/apps/airflow/config";
import {
  ACTS,
  actAt,
  actLength,
  createDirector,
  SHOW_WINDS,
  sizeAt,
  WIND_HOLD_S,
} from "../../../src/apps/airflow/director";
import { SHAPE_IDS } from "../../../src/apps/airflow/shapes";

describe("attract show", () => {
  it("has an act for every shape, with keys in order and places within the handle's travel", () => {
    expect(new Set(ACTS.map((a) => a.shape))).toEqual(new Set(SHAPE_IDS));
    for (const act of ACTS) {
      expect(actLength(act)).toBeGreaterThan(15);
      act.keys.forEach((k, i) => {
        if (i > 0) expect(k.t).toBeGreaterThan(act.keys[i - 1]!.t);
        expect(k.u).toBeGreaterThanOrEqual(0);
        expect(k.u).toBeLessThanOrEqual(1);
        expect(k.v).toBeGreaterThanOrEqual(0);
        expect(k.v).toBeLessThanOrEqual(1);
        expect(Math.abs(k.turn)).toBeLessThanOrEqual(90);
      });
    }
  });

  it("eases between keys without jumps", () => {
    for (const act of ACTS) {
      let prev = actAt(act, 0);
      for (let t = 0.05; t <= actLength(act) + 1; t += 0.05) {
        const p = actAt(act, t);
        expect(Math.abs(p.turn - prev.turn)).toBeLessThan(1.5);
        expect(Math.abs(p.u - prev.u)).toBeLessThan(0.02);
        expect(Math.abs(p.v - prev.v)).toBeLessThan(0.02);
        prev = p;
      }
    }
  });

  it("grows the disc a step at a time, and ends every act at the usual size", () => {
    const disc = ACTS.find((a) => a.shape === "disc")!;
    const seen = new Set<number>();
    for (let t = 0; t <= actLength(disc); t += 0.5) seen.add(sizeAt(disc, t));
    expect(Math.min(...seen)).toBeLessThan(1);
    // It grows to the wall's largest size.
    expect(Math.max(...seen)).toBe(Math.max(...KINDS.wall.sizes));
    // Small first, then larger: it grows.
    expect(sizeAt(disc, 0)).toBeLessThan(sizeAt(disc, actLength(disc) / 2));
    for (const act of ACTS) {
      expect(sizeAt(act, actLength(act))).toBe(1);
      // The last size key leaves time for the shape to settle before the next act swaps it.
      const last = [...act.keys].reverse().find((k) => k.size !== undefined);
      if (last) expect(actLength(act) - last.t).toBeGreaterThanOrEqual(2);
      // Every size the show asks for is a step on the wall; elsewhere it snaps to the nearest
      // step a lane has room for, the largest for anything larger.
      for (const k of act.keys) {
        if (k.size === undefined) continue;
        expect(KINDS.wall.sizes).toContain(k.size);
        const panel = KINDS.panel.sizes;
        const step = panel[nearestStep(panel, k.size)]!;
        expect(step).toBe(k.size > Math.max(...panel) ? Math.max(...panel) : k.size);
      }
    }
    expect(actAt(disc, 1).size).toBe(sizeAt(disc, 1));
  });

  it("shows the wing stalling: its nose goes up by more than 15 degrees", () => {
    const wing = ACTS.find((a) => a.shape === "wing")!;
    expect(Math.min(...wing.keys.map((k) => k.turn))).toBeLessThan(-15);
  });

  it("gives each sting its own act, moves on when one ends, and changes the wind now and then", () => {
    const d = createDirector(3, 0);
    const first = d.update(0.1).map((a) => a.shape);
    expect(new Set(first).size).toBe(3);
    const winds = new Set<number>();
    const shapes = new Set<string>();
    for (let t = 0; t < WIND_HOLD_S * SHOW_WINDS.length; t += 0.5) {
      for (const a of d.update(0.5)) shapes.add(a.shape);
      winds.add(d.wind());
    }
    expect(shapes.size).toBe(SHAPE_IDS.length);
    expect(winds).toEqual(new Set([WINDS.gentle, WINDS.steady, WINDS.strong]));
    d.restart();
    expect(d.update(0.1).map((a) => a.shape)).toEqual(first);
    expect(d.wind()).toBe(SHOW_WINDS[0]);
  });

  it("plays the operator's wind where it would play the steady one", () => {
    const d = createDirector(1, 0, WINDS.strong);
    expect(d.wind()).toBe(WINDS.strong);
    const winds = new Set<number>();
    for (let t = 0; t < WIND_HOLD_S * SHOW_WINDS.length; t += 1) {
      d.update(1);
      winds.add(d.wind());
    }
    expect(winds).toEqual(new Set([WINDS.gentle, WINDS.strong]));
  });
});
