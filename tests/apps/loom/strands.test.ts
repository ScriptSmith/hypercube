import { describe, expect, it } from "vitest";
import { AUTO_MS, FREE_LIVE_MS } from "../../../src/apps/loom/config";
import { sliderY } from "../../../src/apps/loom/layout";
import { phaseDelta } from "../../../src/apps/loom/series";
import { createStrands, SETTLE_AMP } from "../../../src/apps/loom/strands";
import { DT, layoutOf } from "./helpers";

const panel = () => {
  const layout = layoutOf("panel", { bank: true, firstK: 3 });
  return { layout, strands: createStrands(layout, "match") };
};

/** A finger round a dial by `turn` radians, clockwise positive, from angle `start`. */
const sweep = (
  st: ReturnType<typeof createStrands>,
  d: { x: number; y: number; r: number },
  turn: number,
  start = -Math.PI / 2,
  id = 1,
) => {
  const at = (a: number) => ({
    x: d.x + Math.cos(a) * d.r * 0.6,
    y: d.y + Math.sin(a) * d.r * 0.6,
  });
  const p0 = at(start);
  st.down(id, p0.x, p0.y, true, 0);
  const n = 40;
  for (let i = 1; i <= n; i++) {
    const p = at(start + (turn * i) / n);
    st.move(id, p.x, p.y, i);
  }
  st.up(id, n);
};

describe("loom strands", () => {
  it("set the amplitude to wherever a finger is on the slider, and follow it", () => {
    const { layout, strands } = panel();
    const s = layout.strands[0]!;
    const st = strands.list[0]!;
    expect(st.k).toBe(3);
    expect(strands.down(1, s.slider.x + 30, sliderY(s.slider, 0.7), true, 0)).toBe(true);
    expect(st.amp).toBeCloseTo(0.7, 9);
    expect(st.held).toBe(1);
    strands.move(1, s.slider.x - 200, sliderY(s.slider, 0.2), 16);
    expect(st.amp).toBeCloseTo(0.2, 9);
    strands.move(1, s.slider.x, s.slider.y1 - 400, 32);
    expect(st.amp).toBe(1);
    strands.up(1, 48);
    expect(st.held).toBe(0);
  });

  it("turn the phase one to one with the finger's turn round the dial, clockwise positive", () => {
    const { layout, strands } = panel();
    const d = layout.strands[0]!.dial;
    const st = strands.list[0]!;
    sweep(strands, d, Math.PI / 2);
    expect(st.phase).toBeCloseTo(Math.PI / 2, 6);
    // Starting anywhere, only the change counts.
    sweep(strands, d, -Math.PI / 4, 1.3);
    expect(st.phase).toBeCloseTo(Math.PI / 4, 6);
    // Round and round.
    sweep(strands, d, Math.PI * 1.9, 0.2);
    sweep(strands, d, Math.PI * 1.9, 0.2);
    expect(Math.abs(phaseDelta(st.phase, Math.PI / 4 + Math.PI * 3.8))).toBeLessThan(1e-6);
  });

  it("ignore a finger's jitter near the dial's centre", () => {
    const { layout, strands } = panel();
    const d = layout.strands[0]!.dial;
    const st = strands.list[0]!;
    strands.down(1, d.x + 5, d.y, true, 0);
    strands.move(1, d.x, d.y + 5, 1);
    strands.move(1, d.x - 5, d.y, 2);
    strands.up(1, 3);
    expect(st.phase).toBe(0);
  });

  it("let a second finger take a control over", () => {
    const { layout, strands } = panel();
    const s = layout.strands[0]!;
    const st = strands.list[0]!;
    strands.down(1, s.slider.x, sliderY(s.slider, 0.2), true, 0);
    strands.down(2, s.slider.x, sliderY(s.slider, 0.8), true, 1);
    expect(st.amp).toBeCloseTo(0.8, 9);
    expect(st.held).toBe(1);
    strands.move(1, s.slider.x, sliderY(s.slider, 0.1), 2);
    expect(st.amp).toBeCloseTo(0.8, 9);
    strands.up(2, 3);
    expect(st.held).toBe(0);
  });

  it("are live while touched and for AUTO_MS after, then auto", () => {
    const { layout, strands } = panel();
    const s = layout.strands[0]!;
    const st = strands.list[0]!;
    strands.step(DT, 0);
    expect(st.live).toBe(false);
    strands.down(1, s.slider.x, sliderY(s.slider, 0.5), true, 1000);
    strands.step(DT, 1000 + AUTO_MS * 2);
    expect(st.live).toBe(true);
    strands.up(1, 2000);
    strands.step(DT, 2000 + AUTO_MS - 1);
    expect(st.live).toBe(true);
    strands.step(DT, 2000 + AUTO_MS + 1);
    expect(st.live).toBe(false);
    // A person's touch is remembered; a bot's isn't counted as one.
    expect(st.lastPerson).toBe(2000);
    strands.down(2, s.slider.x, sliderY(s.slider, 0.5), false, 9000);
    strands.up(2, 9100);
    expect(st.lastPerson).toBe(2000);
    // Free play keeps a harmonic live for a minute.
    const free = createStrands(layout, "free");
    free.down(1, s.slider.x, sliderY(s.slider, 0.5), true, 0);
    free.up(1, 0);
    free.step(DT, FREE_LIVE_MS - 1);
    expect(free.list[0]!.live).toBe(true);
    free.step(DT, FREE_LIVE_MS + 1);
    expect(free.list[0]!.live).toBe(false);
  });

  it("settle onto the hint when let go close to it", () => {
    const { layout, strands } = panel();
    const s = layout.strands[0]!;
    const st = strands.list[0]!;
    const hint = () => ({ amp: 0.6, phase: 1 });
    strands.down(1, s.slider.x, sliderY(s.slider, 0.6 + SETTLE_AMP * 0.8), true, 0);
    strands.up(1, 0, hint);
    for (let i = 0; i < 60; i++) strands.step(DT, i * 16);
    expect(st.amp).toBeCloseTo(0.6, 4);
    // Too far: it stays.
    strands.down(1, s.slider.x, sliderY(s.slider, 0.3), true, 0);
    strands.up(1, 0, hint);
    for (let i = 0; i < 60; i++) strands.step(DT, i * 16);
    expect(st.amp).toBeCloseTo(0.3, 9);
    // The dial settles onto the hint's phase too.
    sweep(strands, s.dial, 1.12);
    strands.down(1, s.slider.x, sliderY(s.slider, 0.6), true, 0);
    strands.up(1, 0, hint);
    sweep(strands, s.dial, -0.05, 0.4);
    // The sweep's own release had no hint; give one now with a tap-free release.
    const d = s.dial;
    strands.down(3, d.x + d.r * 0.6, d.y, true, 0);
    strands.up(3, 0, hint);
    for (let i = 0; i < 60; i++) strands.step(DT, i * 16);
    expect(st.phase).toBeCloseTo(1, 4);
  });

  it("let go of every harmonic at once on reset", () => {
    const layout = layoutOf("wall");
    const strands = createStrands(layout, "match");
    layout.strands.forEach((s, i) =>
      strands.down(i + 1, s.slider.x, sliderY(s.slider, 0.5), true, 0),
    );
    strands.step(DT, 0);
    expect(strands.list.every((s) => s.live && s.held === 1)).toBe(true);
    strands.release(null);
    strands.step(DT, 1);
    expect(strands.list.every((s) => !s.live && s.held === 0)).toBe(true);
    expect(strands.holds.size).toBe(0);
  });
});
