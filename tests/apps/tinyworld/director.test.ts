import { describe, expect, it } from "vitest";
import {
  createDirector,
  CYCLE_SECONDS,
  DRAIN_SECONDS,
  type DrainLevels,
  drainLevels,
  sinkFor,
} from "../../../src/apps/tinyworld/director";

const levels = (): DrainLevels => ({ sink: 0, crumble: 0, fade: 0 });

describe("tinyworld director", () => {
  it("opens the floor only once the world is getting full", () => {
    expect(sinkFor(0)).toBe(0);
    expect(sinkFor(0.3)).toBe(0);
    expect(sinkFor(0.45)).toBeGreaterThan(0);
    expect(sinkFor(0.9)).toBe(sinkFor(0.55));
    expect(sinkFor(0.9)).toBeLessThan(0.5);
  });

  it("crumbles about nine in ten solid cells whatever the drain length", () => {
    for (const seconds of [7, 20]) {
      const out = levels();
      let survive = 1;
      for (let tick = 0; tick < seconds * 60; tick++) {
        drainLevels(tick / (seconds * 60), seconds, out);
        survive *= 1 - out.crumble;
      }
      expect(survive).toBeGreaterThan(0.05);
      expect(survive).toBeLessThan(0.15);
    }
  });

  it("opens the floor early and fades leftovers at the end", () => {
    const out = levels();
    drainLevels(0.05, 20, out);
    expect(out.sink).toBeGreaterThan(0.3);
    expect(out.fade).toBe(0);
    drainLevels(0.99, 20, out);
    expect(out.fade).toBeGreaterThan(0.05);
  });

  it("drains for about 20 s when idle, then regrows and reveals the land", () => {
    let drained = 0;
    const d = createDirector({ onDrained: () => drained++, onCycle: () => {} });
    d.startDrain("idle");
    expect(d.draining).toBe(true);
    for (let i = 0; i < (DRAIN_SECONDS.idle - 0.5) * 60; i++) d.update(1 / 60, i * 16);
    expect(drained).toBe(0);
    for (let i = 0; i < 60; i++) d.update(1 / 60, 0);
    expect(drained).toBe(1);
    expect(d.draining).toBe(false);
    d.reveal0();
    expect(d.reveal).toBe(0);
    for (let i = 0; i < 4 * 60; i++) d.update(1 / 60, 0);
    expect(d.reveal).toBeCloseTo(1.2);
  });

  it("stops an idle drain when someone touches, but not a reset they asked for", () => {
    const d = createDirector({ onDrained: () => {}, onCycle: () => {} });
    d.startDrain("idle");
    d.interrupt();
    expect(d.draining).toBe(false);
    d.startDrain("manual");
    d.interrupt();
    expect(d.draining).toBe(true);
  });

  it("starts a fresh cycle every few minutes of attract", () => {
    let cycles = 0;
    const d = createDirector({ onDrained: () => {}, onCycle: () => cycles++ });
    d.setAttract(true, 0);
    d.update(1 / 60, (CYCLE_SECONDS - 1) * 1000);
    expect(cycles).toBe(0);
    d.update(1 / 60, (CYCLE_SECONDS + 1) * 1000);
    expect(cycles).toBe(1);
    d.setAttract(false, 0);
    d.update(1 / 60, CYCLE_SECONDS * 3000);
    expect(cycles).toBe(1);
  });

  it("uses the fullness sink only outside a drain", () => {
    const d = createDirector({ onDrained: () => {}, onCycle: () => {} });
    d.setFullness(0.6);
    const out = levels();
    d.levels(out);
    expect(out.sink).toBe(sinkFor(0.6));
    expect(out.crumble).toBe(0);
  });
});
