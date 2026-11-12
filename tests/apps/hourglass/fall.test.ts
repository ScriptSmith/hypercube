import { describe, expect, it } from "vitest";
import {
  driftOf,
  fallAt,
  fallOf,
  FALLS,
  feedOf,
  isStreams,
  LAST_S,
  SPIRAL_TURN_S,
  SPIRAL_TWIST,
  TAIL_S,
  TIME_WRAP_S,
  twistOf,
} from "../../../src/apps/hourglass/fall";
import manifest from "../../../src/apps/hourglass/manifest";
import { hourglassGlsl, VEIL_SPEED } from "../../../src/apps/hourglass/shader";
import { flowingCount, streamsAt } from "../../../src/apps/hourglass/streams";
import { phaseAt, type Schedule, TURN_MS } from "../../../src/apps/hourglass/time";

const DAY: Schedule = { start: 9 * 60, end: 17 * 60 };
const START = new Date(2026, 10, 12, 9).getTime();
const END = new Date(2026, 10, 12, 17).getTime();
const at = (ms: number) => fallAt(ms, phaseAt(ms, DAY));

describe("hourglass falls", () => {
  it("are the piece's variants, so a picker can list each, with the fine streams first", () => {
    expect((manifest.variants ?? []).map((v) => v.id)).toEqual([...FALLS]);
    expect((manifest.options ?? []).some((o) => o.key === "fall")).toBe(false);
    expect(FALLS[0]).toBe("streams");
    for (const id of FALLS) expect(fallOf(id)).toBe(id);
    for (const junk of [undefined, "", "rain", 3, true]) expect(fallOf(junk)).toBe("streams");
  });

  it("draw either the five streams or sand all round, and only the spiral winds", () => {
    expect(FALLS.filter(isStreams)).toEqual(["streams", "spiral"]);
    for (const id of FALLS) expect(twistOf(id)).toBe(id === "spiral" ? SPIRAL_TWIST : 0);
    expect(SPIRAL_TWIST).toBeGreaterThan(0.5);
    for (const id of FALLS) {
      if (id !== "spiral") expect(driftOf(id, START + 123_456)).toBe(0);
    }
    // The spiral's streams go once round the ball, steadily.
    const turn = SPIRAL_TURN_S * 1000;
    const base = Math.floor(START / turn) * turn;
    expect(driftOf("spiral", base)).toBeCloseTo(0, 9);
    expect(driftOf("spiral", base + turn / 4)).toBeCloseTo(Math.PI / 2, 9);
    expect(driftOf("spiral", base + turn - 1)).toBeLessThan(2 * Math.PI);
    expect(driftOf("spiral", base + turn - 1)).toBeGreaterThan(2 * Math.PI - 0.001);
    expect(driftOf("spiral", base + turn)).toBeCloseTo(0, 9);
    expect(driftOf("spiral", -1)).toBeGreaterThan(0);
  });

  it("build a shader each, the plain streams' untouched by the winding", () => {
    const sources = FALLS.map((id) => hourglassGlsl(id));
    expect(new Set(sources).size).toBe(FALLS.length);
    for (const src of sources) {
      expect(src).not.toContain("FALL_STYLE");
      expect(src).not.toContain("HEAP_EDGE");
      expect(src).toContain("vec4 surface(vec3 dir)");
    }
    const [streams, trails, grains, veil, spiral] = sources as [
      string,
      string,
      string,
      string,
      string,
    ];
    expect(streams).toContain("hgWrap(lon - s.x - sway * smoothstep(0.0, 0.3, arc)) * cosLat");
    expect(streams).toContain("float d = abs(side);");
    expect(streams).toContain("line += hgMounds(lon, level);");
    expect(spiral).toContain(`lon - s.x - ${SPIRAL_TWIST} * arc`);
    expect(spiral).toContain("line += hgMounds(lon, level);");
    expect(trails).toContain("hgTrails(arc, lon, cosLat");
    expect(grains).toContain("hgGrains(arc, lon, cosLat");
    expect(veil).toContain("hgFed(arc / VEIL_SPEED)");
    // Sand that falls all round leaves a level heap with ripples, not mounds.
    for (const src of [trails, grains, veil]) {
      expect(src).not.toContain("line += hgMounds(lon, level);");
      expect(src).toContain("line += 0.007 *");
    }
  });

  it("repeat a whole number of times before the shader's clock wraps", () => {
    // Seconds between a lane's grains and cells a second for the rain, as the shader has them.
    for (const period of [1.2, 1.8]) expect(Number.isInteger(TIME_WRAP_S / period)).toBe(true);
    for (let steps = 7; steps <= 11; steps++) {
      expect(Number.isInteger(steps * TIME_WRAP_S)).toBe(true);
    }
    // The veil's three patterns slide with it at 2.5, 7 and 100 cells to the arc, and each
    // repeats after exactly the cells it moves in one turn of the clock.
    const veil = hourglassGlsl("veil");
    expect(veil).toContain(`const float VEIL_SPEED = ${VEIL_SPEED};`);
    for (const scale of [2.5, 7, 100]) {
      const cells = scale * VEIL_SPEED * TIME_WRAP_S;
      expect(Math.abs(cells - Math.round(cells))).toBeLessThan(1e-6);
      expect(veil).toContain(
        `(arc - slide) * ${scale % 1 ? scale : `${scale}.0`}), ${Math.round(cells)}.0)`,
      );
    }
    // The ripples on a level heap, at a fifth of a cell a second.
    expect(veil).toContain(`uTime * 0.2), ${0.2 * TIME_WRAP_S}.0)`);
  });

  it("falls at full strength through the run", () => {
    const mid = at(START + 4 * 3_600_000);
    expect(mid.on).toBe(true);
    expect(mid.feed).toBe(1);
    expect(mid.remaining).toBe(4 * 3600);
    expect(mid.since).toBe(600);
    // Everything on the glass left the collar at full strength.
    for (const ago of [0, 1, 5, 30]) expect(feedOf(mid, ago)).toBe(1);
  });

  it("starts from the collar once the glass has turned over", () => {
    const turning = at(START + TURN_MS / 2);
    expect(turning.on).toBe(false);
    expect(turning.feed).toBe(0);
    const begun = at(START + TURN_MS + 2000);
    expect(begun.on).toBe(true);
    expect(begun.since).toBeCloseTo(2, 9);
    expect(begun.feed).toBe(1);
    // Nothing has been falling for longer than two seconds yet.
    expect(feedOf(begun, 1.5)).toBe(1);
    expect(feedOf(begun, 2.5)).toBe(0);
  });

  it("thins through the last minute and stops at the set time, in every style", () => {
    expect(at(END - (LAST_S + 1) * 1000).feed).toBe(1);
    let last = 1;
    for (let s = LAST_S; s >= 0; s -= 3) {
      const fall = at(END - s * 1000);
      expect(fall.feed).toBeCloseTo(s / LAST_S, 9);
      expect(fall.feed).toBeLessThanOrEqual(last);
      last = fall.feed;
    }
    expect(at(END - 1).feed).toBeGreaterThan(0);
    expect(at(END - 1).feed).toBeLessThan(0.001);
    expect(at(END).feed).toBe(0);
    // The streams' own count agrees: none is fed once the fall has stopped.
    expect(flowingCount(streamsAt(END, phaseAt(END, DAY)))).toBe(0);
    expect(flowingCount(streamsAt(END - 30_000, phaseAt(END - 30_000, DAY)))).toBeGreaterThan(0);
  });

  it("lets what is already on the glass run down after the end, then shows nothing", () => {
    const after = at(END + 2000);
    expect(after.on).toBe(true);
    expect(after.feed).toBe(0);
    expect(after.remaining).toBe(-2);
    // Sand that left the collar three seconds ago, before the end, is still coming down;
    // nothing left it in the last two.
    expect(feedOf(after, 3)).toBeGreaterThan(0);
    expect(feedOf(after, 3)).toBeLessThan(0.05);
    expect(feedOf(after, 1)).toBe(0);
    const later = at(END + TAIL_S * 1000);
    expect(later.on).toBe(false);
    for (const ago of [0, 5, 60, 600]) expect(feedOf(later, ago)).toBe(0);
    const night = at(END + 5 * 3_600_000);
    expect(night.on).toBe(false);
    expect(night.feed).toBe(0);
    expect(night.remaining).toBe(-TAIL_S);
  });
});
