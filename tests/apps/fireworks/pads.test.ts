import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { readConfig } from "../../../src/apps/fireworks/config";
import {
  aimAngle,
  aimKnob,
  flickOf,
  layoutPads,
  MAX_AIM,
  mouthOf,
  type PadFrame,
  SEAM_GAP,
} from "../../../src/apps/fireworks/pads";

const panel: PadFrame = { kind: "panel", width: 1080, height: 1920, span: 1 };
const pair: PadFrame = { kind: "pair", width: 2160, height: 1920, span: 2 };
const wall: PadFrame = { kind: "wall", ...VENUE_SIZE.wall, span: 1 };
const build = readConfig("build", {});

const circles = (p: ReturnType<typeof layoutPads>[number]) =>
  [p.color, p.shape, p.size].filter((c) => c !== null);

describe("fireworks pad layout", () => {
  it("gives recipe buttons at least 240 venue px and reset at least 120", () => {
    for (const f of [panel, pair, wall]) {
      for (const p of layoutPads(f, build)) {
        expect(circles(p)).toHaveLength(3);
        for (const c of circles(p)) expect(2 * c.r).toBeGreaterThanOrEqual(240);
        expect(2 * p.reset.r).toBeGreaterThanOrEqual(120);
        expect(p.tubeHit.width).toBeGreaterThanOrEqual(240);
      }
    }
  });

  it("keeps everything needed to launch in the child band, and the aim in the adult band", () => {
    const check = (f: PadFrame, childTop: number, adultTop: number) => {
      for (const p of layoutPads(f, build)) {
        for (const c of circles(p)) expect(c.y - c.r).toBeGreaterThanOrEqual(childTop);
        expect(p.tubeHit.y).toBeGreaterThanOrEqual(childTop);
        expect(p.reset.y - p.reset.r).toBeGreaterThanOrEqual(childTop);
        const a = p.aim!;
        for (const angle of [-a.max, 0, a.max]) {
          const k = aimKnob(a, angle);
          expect(k.y + a.band).toBeLessThanOrEqual(childTop);
          expect(k.y - a.band).toBeGreaterThanOrEqual(adultTop);
        }
      }
    };
    check(panel, 960, 0);
    check(pair, 960, 0);
    // Wall: bottom quarter to launch, 25 to 45 % of height for the aim.
    check(wall, wall.height * 0.75, wall.height * 0.55);
  });

  it("keeps each pad on a pair 220 px clear of the seam", () => {
    const pads = layoutPads(pair, build);
    expect(pads).toHaveLength(2);
    for (const p of pads) {
      const parts = [...circles(p), p.reset];
      const left = Math.min(...parts.map((c) => c.x - c.r), p.tubeHit.x);
      const right = Math.max(...parts.map((c) => c.x + c.r), p.tubeHit.x + p.tubeHit.width);
      const aim = p.aim!;
      const arc = [aimKnob(aim, -aim.max).x - aim.band, aimKnob(aim, aim.max).x + aim.band];
      if (p.index === 0) expect(Math.max(right, arc[1]!)).toBeLessThanOrEqual(1080 - SEAM_GAP);
      else expect(Math.min(left, arc[0]!)).toBeGreaterThanOrEqual(1080 + SEAM_GAP);
    }
  });

  it("spaces wall pads a pad apart, 6 or 8 of them, fewer where 8 don't fit", () => {
    const wide: PadFrame = { kind: "wall", width: 8 * 800, height: wall.height, span: 1 };
    const eight = layoutPads(wide, build);
    expect(eight).toHaveLength(8);
    expect(eight[1]!.cx - eight[0]!.cx).toBeCloseTo(800, 6);
    for (const f of [wide, wall]) {
      for (const p of layoutPads(f, build)) {
        const parts = [...circles(p), p.reset];
        expect(Math.min(...parts.map((c) => c.x - c.r))).toBeGreaterThanOrEqual(p.x0);
        expect(Math.max(...parts.map((c) => c.x + c.r))).toBeLessThanOrEqual(p.x1);
      }
    }
    expect(layoutPads(wall, build)).toHaveLength(7);
    expect(layoutPads(wall, readConfig("build", { pads: "6" }))).toHaveLength(6);
  });

  it("offers only the colour in colour-only recipes, and nothing but the drag in flick", () => {
    const colour = layoutPads(panel, readConfig("build", { recipe: "colour" }))[0]!;
    expect(colour.color).not.toBeNull();
    expect(colour.shape).toBeNull();
    const flick = layoutPads(panel, readConfig("flick", {}))[0]!;
    expect(flick.color).toBeNull();
    expect(flick.aim).toBeNull();
    expect(flick.flick!.y).toBeGreaterThanOrEqual(960);
    const noAim = layoutPads(panel, readConfig("build", { aim: false }))[0]!;
    expect(noAim.aim).toBeNull();
  });

  it("turns aim drags and flicks into tilts within the limits", () => {
    const p = layoutPads(panel, build)[0]!;
    const a = p.aim!;
    const k = aimKnob(a, 0.2);
    expect(aimAngle(a, k.x, k.y, true)).toBeCloseTo(0.2, 6);
    expect(aimAngle(a, k.x, k.y - 400, true)).toBeNull();
    expect(aimAngle(a, 5000, k.y, false)).toBe(a.max);
    const m = mouthOf(p, 0);
    expect(m.x).toBe(p.tube.x);
    expect(m.y).toBe(p.tube.base - p.tube.length);
    expect(flickOf(p, 500, 1800, 500, 1750)).toBeNull();
    expect(flickOf(p, 500, 1800, 520, 1900)).toBeNull();
    const f = flickOf(p, 500, 1800, 900, 1000)!;
    expect(f.angle).toBeCloseTo(Math.min(MAX_AIM, Math.atan2(400, 800)), 6);
    expect(f.size).toBeGreaterThan(0.5);
    expect(flickOf(p, 500, 1800, 1500, 1700)!.angle).toBe(MAX_AIM);
  });
});
