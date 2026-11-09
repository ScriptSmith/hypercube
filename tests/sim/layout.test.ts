import { describe, expect, it } from "vitest";
import {
  autoRes,
  focusRect,
  layoutCompact,
  layoutPhysical,
  pictureRect,
  type ScreenRect,
} from "../../src/pages/sim/layout";
import { DEFAULT_VENUE } from "../../src/core/venue";
import { buildPreset, PRESET_IDS } from "../../src/pages/sim/presets";
import { defaultVenue } from "../../src/pages/sim/venue";

const PANEL = DEFAULT_VENUE.panel;

const VIEW = { width: 1600, height: 820 };

const inside = (r: ScreenRect, view: { width: number; height: number }) =>
  r.left >= -1e-6 &&
  r.top >= -1e-6 &&
  r.left + r.width <= view.width + 1e-6 &&
  r.top + r.height <= view.height + 1e-6;

const disjoint = (a: ScreenRect, b: ScreenRect) =>
  a.left + a.width <= b.left + 1e-6 ||
  b.left + b.width <= a.left + 1e-6 ||
  a.top + a.height <= b.top + 1e-6 ||
  b.top + b.height <= a.top + 1e-6;

describe("layoutPhysical", () => {
  it.each(PRESET_IDS)("%s fits the view with uniform scales and no overlaps", (id) => {
    const preset = buildPreset(id);
    const layout = layoutPhysical(preset, VIEW);
    const rects = preset.frames.map((f) => layout.frames.get(f.id)!);
    preset.frames.forEach((f, i) => {
      const r = rects[i]!;
      expect(inside(r, VIEW), f.id).toBe(true);
      expect(r.width).toBeCloseTo(f.width * r.scale, 6);
      expect(r.height).toBeCloseTo(f.height * r.scale, 6);
    });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(disjoint(rects[i]!, rects[j]!)).toBe(true);
      }
    }
  });

  it("puts panel bottoms at their physical height and the screen above them", () => {
    const preset = buildPreset("bank");
    const layout = layoutPhysical(preset, VIEW);
    const screen = layout.frames.get("a-screen")!;
    for (const f of preset.frames.filter((x) => x.kind === "panel")) {
      const r = layout.frames.get(f.id)!;
      // Content is fitted inside the physical box, so allow a fraction of a pixel.
      expect(Math.abs(r.top + r.height - layout.y(PANEL.bottomM))).toBeLessThan(0.5);
      expect(r.width).toBeCloseTo(PANEL.widthM * layout.pxPerM, 1);
      expect(screen.top + screen.height).toBeLessThanOrEqual(r.top);
    }
    expect(layout.y(0)).toBeLessThanOrEqual(VIEW.height);
  });

  it.each([
    ["bank", 6, 1],
    ["bank", 3, 2],
    ["bank", 4, 3],
    ["corner", 6, 1],
  ] as const)(
    "%s of %i frames of %i panels draws each screen exactly over its row",
    (id, count, span) => {
      const preset = buildPreset(id, { ...defaultVenue(), count, span });
      const layout = layoutPhysical(preset, VIEW);
      for (const screen of preset.frames.filter((f) => f.kind === "screen")) {
        const s = layout.frames.get(screen.id)!;
        const row = preset.frames.filter((f) => f.kind !== "screen" && f.zone === screen.zone);
        const left = layout.x(Math.min(...row.map((f) => f.phys.x)));
        const right = layout.x(Math.max(...row.map((f) => f.phys.x + f.phys.w)));
        expect(s.left).toBeCloseTo(left, 6);
        expect(s.left + s.width).toBeCloseTo(right, 6);
        // Drawn row content stays inside the screen's span (a pair's seam bezel insets it).
        for (const f of row) {
          const r = layout.frames.get(f.id)!;
          expect(r.left).toBeGreaterThanOrEqual(s.left - 1e-6);
          expect(r.left + r.width).toBeLessThanOrEqual(s.left + s.width + 1e-6);
        }
      }
    },
  );

  it("draws a panel and a wall at the same metres-to-px scale", () => {
    const layout = layoutPhysical(buildPreset("versus"), VIEW);
    const wall = layout.frames.get("a-wall")!;
    expect(wall.width / layout.pxPerM).toBeCloseTo(DEFAULT_VENUE.wall.widthM, 1);
  });
});

describe("sphere layout", () => {
  it("fits the feed inside the ball's outline, centred on it, below the ceiling", () => {
    const preset = buildPreset("sphere");
    const ball = preset.frames[0]!;
    const layout = layoutPhysical(preset, VIEW);
    const r = layout.frames.get(ball.id)!;
    const radius = (ball.phys.w / 2) * layout.pxPerM;
    const cx = layout.x(ball.phys.x + ball.phys.w / 2);
    const cy = layout.y(ball.phys.y + ball.phys.h / 2);
    expect(r.left + r.width / 2).toBeCloseTo(cx, 6);
    expect(r.top + r.height / 2).toBeCloseTo(cy, 6);
    // Its corners touch the outline, so it is as large as it can be inside.
    expect(Math.hypot(r.width / 2, r.height / 2)).toBeCloseTo(radius, 6);
    expect(r.width / r.height).toBeCloseTo(ball.width / ball.height, 6);
    expect(layout.y(preset.ceiling!)).toBeGreaterThanOrEqual(0);
    expect(layout.y(ball.phys.y)).toBeCloseTo(layout.y(0) - ball.phys.y * layout.pxPerM, 6);
  });

  it("leaves other frames filling their display area", () => {
    const wall = buildPreset("wall").frames[0]!;
    expect(pictureRect(wall)).toBe(wall.phys);
  });
});

describe("layoutCompact", () => {
  it.each(PRESET_IDS)("%s packs frames inside the view at one scale", (id) => {
    const preset = buildPreset(id);
    const rects = layoutCompact(preset.frames, VIEW);
    const all = preset.frames.map((f) => rects.get(f.id)!);
    const scale = all[0]!.scale;
    for (const r of all) {
      expect(inside(r, VIEW)).toBe(true);
      expect(r.scale).toBeCloseTo(scale, 9);
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(disjoint(all[i]!, all[j]!)).toBe(true);
    }
  });

  it("keeps screens above touch frames and draws panels larger than the physical view", () => {
    const preset = buildPreset("bank");
    const compact = layoutCompact(preset.frames, VIEW);
    const physical = layoutPhysical(preset, VIEW).frames;
    const screen = compact.get("a-screen")!;
    const panel = compact.get("a-p1")!;
    expect(screen.top + screen.height).toBeLessThanOrEqual(panel.top);
    expect(panel.width).toBeGreaterThan(physical.get("a-p1")!.width);
  });
});

describe("focusRect", () => {
  it("fills the view along one axis and keeps the aspect", () => {
    const r = focusRect({ width: 1080, height: 1920 }, { width: 1600, height: 900 });
    expect(r.height).toBeCloseTo(900, 6);
    expect(r.width / r.height).toBeCloseTo(1080 / 1920, 9);
    expect(r.left).toBeCloseTo((1600 - r.width) / 2, 6);
    const wall = focusRect({ width: 5760, height: 2160 }, { width: 1600, height: 900 });
    expect(wall.width).toBeCloseTo(1600, 6);
  });
});

describe("autoRes", () => {
  it("rounds up to steps of 0.05 within the runtime's range", () => {
    expect(autoRes(0.01)).toBe(0.1);
    expect(autoRes(0.12)).toBe(0.15);
    expect(autoRes(0.5)).toBe(0.5);
    expect(autoRes(3)).toBe(1);
  });
});
