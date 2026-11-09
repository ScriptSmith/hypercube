import { describe, expect, it } from "vitest";
import { DEFAULT_VENUE, displayFor, reachFor } from "../../src/core/venue";
import { buildPreset, PRESET_IDS, type PhysRect, type SimFrame } from "../../src/pages/sim/presets";
import { defaultVenue, profileOf, type VenueValues } from "../../src/pages/sim/venue";

const overlaps = (a: PhysRect, b: PhysRect) =>
  a.x < b.x + b.w - 1e-9 &&
  b.x < a.x + a.w - 1e-9 &&
  a.y < b.y + b.h - 1e-9 &&
  b.y < a.y + a.h - 1e-9;

const touch = (frames: SimFrame[]) => frames.filter((f) => f.kind !== "screen");
const screens = (frames: SimFrame[]) => frames.filter((f) => f.kind === "screen");
const venue = (v: Partial<VenueValues> = {}): VenueValues => ({ ...defaultVenue(), ...v });
const { panel: PANEL, bezelM: BEZEL } = DEFAULT_VENUE;

/** The screen is exactly as wide as its row, directly above it, with its pixel aspect. */
const expectSpansRow = (screen: SimFrame, row: SimFrame[]) => {
  const start = row[0]!.phys.x;
  const last = row.at(-1)!;
  expect(screen.phys.x).toBeCloseTo(start, 9);
  expect(screen.phys.x + screen.phys.w).toBeCloseTo(last.phys.x + last.phys.w, 9);
  expect(screen.phys.w / screen.phys.h).toBeCloseTo(screen.width / screen.height, 9);
  expect(screen.phys.y).toBeGreaterThanOrEqual(last.phys.y + last.phys.h);
};

describe("buildPreset", () => {
  it.each(PRESET_IDS)("%s has unique ids, venue sizes and no overlapping frames", (id) => {
    const preset = buildPreset(id);
    const ids = preset.frames.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of preset.frames) {
      const d = displayFor(f.kind, f.span);
      expect([f.width, f.height]).toEqual([d.width, d.height]);
      const twoSided = id === "corner" || id === "versus";
      expect(f.group).toBe(twoSided ? id : "main");
      expect(f.side).toBe(twoSided ? f.zone : null);
      expect(f.reach).toEqual(d.touch ? reachFor(d) : null);
    }
    for (const a of preset.frames) {
      for (const b of preset.frames) {
        if (a !== b) expect(overlaps(a.phys, b.phys), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it.each(["panel", "pair", "wall", "kiosk", "screen", "sphere"] as const)(
    "%s is one solo frame of that kind",
    (id) => {
      const [frame, ...rest] = buildPreset(id).frames;
      expect(rest).toHaveLength(0);
      expect(frame?.kind).toBe(id);
      expect(frame?.setup).toBe("solo");
      expect(frame?.role).toBe(id === "screen" ? "screen" : "solo");
      expect([frame?.pos, frame?.count]).toEqual([0, 1]);
    },
  );

  it("makes the default bank the venue's row of panels at their mounting height under a screen", () => {
    const preset = buildPreset("bank");
    const panels = touch(preset.frames);
    const [screen] = screens(preset.frames);
    const n = DEFAULT_VENUE.bankCount;
    expect(panels).toHaveLength(n);
    panels.forEach((p, i) => {
      expect([p.kind, p.span, p.setup, p.role, p.pos, p.count]).toEqual([
        "panel",
        1,
        "bank",
        "station",
        i,
        n,
      ]);
      expect(p.phys).toEqual({
        x: expect.closeTo(i * (PANEL.widthM + BEZEL), 9),
        y: PANEL.bottomM,
        w: PANEL.widthM,
        h: PANEL.heightM,
      });
    });
    expect([screen?.role, screen?.setup, screen?.pos, screen?.count]).toEqual([
      "screen",
      "bank",
      0,
      n,
    ]);
    expectSpansRow(screen!, panels);
    const rowWidth = n * PANEL.widthM + (n - 1) * BEZEL;
    const { screen: SCREEN } = DEFAULT_VENUE;
    expect(screen!.phys.h).toBeCloseTo((rowWidth * SCREEN.height) / SCREEN.width, 9);
  });

  it("builds a bank of any count and span", () => {
    const preset = buildPreset("bank", venue({ count: 4, span: 3 }));
    const frames = touch(preset.frames);
    expect(frames.map((f) => [f.kind, f.span, f.width, f.height, f.pos, f.count])).toEqual(
      Array.from({ length: 4 }, (_, i) => ["pair", 3, 3240, 1920, i, 4]),
    );
    expect(frames.map((f) => f.short)).toEqual(["A1-3", "A4-6", "A7-9", "A10-12"]);
    expect(frames[0]!.phys.w).toBeCloseTo(3 * PANEL.widthM + 2 * BEZEL, 9);
    expectSpansRow(screens(preset.frames)[0]!, frames);

    const five = buildPreset("bank", venue({ count: 5, span: 1 }));
    expect(touch(five.frames).map((f) => f.short)).toEqual(["A1", "A2", "A3", "A4", "A5"]);
    expectSpansRow(screens(five.frames)[0]!, touch(five.frames));
  });

  it("covers the same row with three pairs as with six panels", () => {
    const pairs = touch(buildPreset("bank", venue({ count: 3, span: 2 })).frames);
    const panels = touch(buildPreset("bank", venue({ count: 6, span: 1 })).frames);
    expect(pairs.map((p) => p.short)).toEqual(["A1+2", "A3+4", "A5+6"]);
    pairs.forEach((pair, i) => {
      expect(pair.phys.x).toBeCloseTo(panels[2 * i]!.phys.x, 9);
      const end = panels[2 * i + 1]!.phys.x + panels[2 * i + 1]!.phys.w;
      expect(pair.phys.x + pair.phys.w).toBeCloseTo(end, 9);
    });
  });

  it("follows custom display sizes", () => {
    const v = venue({
      count: 3,
      sw: 3840,
      sh: 2160,
      pw: 720,
      ph: 1280,
      pwm: 0.5,
      phm: 0.9,
      pb: 1.1,
    });
    const preset = buildPreset("bank", v);
    const panels = touch(preset.frames);
    const [screen] = screens(preset.frames);
    expect([panels[0]!.width, panels[0]!.height]).toEqual([720, 1280]);
    expect(panels[0]!.phys).toMatchObject({ y: 1.1, w: 0.5, h: 0.9 });
    expect(panels[0]!.reach).toEqual(reachFor(profileOf(v).panel));
    expect([screen!.width, screen!.height]).toEqual([3840, 2160]);
    expectSpansRow(screen!, panels);
    expect(screen!.phys.h).toBeCloseTo(((3 * 0.5 + 2 * BEZEL) * 2160) / 3840, 9);
    const wall = buildPreset("wall", venue({ ww: 7680, wh: 2160, wwm: 16, whm: 4.5 })).frames[0]!;
    expect([wall.width, wall.height, wall.phys.w, wall.phys.h]).toEqual([7680, 2160, 16, 4.5]);
  });

  it("unfolds the corner with zone A on the left and the two screens meeting at the corner", () => {
    const preset = buildPreset("corner");
    expect(preset.zones.map((z) => z.label)).toEqual(["Zone A", "Zone B"]);
    const n = DEFAULT_VENUE.bankCount;
    expect(preset.frames).toHaveLength(2 * n + 2);
    const panels = touch(preset.frames);
    const perSide = Array.from({ length: n }, (_, i) => i);
    expect(panels.map((p) => p.pos)).toEqual([...perSide, ...perSide]);
    expect(panels.map((p) => p.side)).toEqual([...Array(n).fill("a"), ...Array(n).fill("b")]);
    expect(panels.every((p) => p.count === n && p.setup === "corner")).toBe(true);
    const corner = preset.corners[0]!;
    const [a, b] = screens(preset.frames);
    expect([a?.side, a?.pos, a?.count]).toEqual(["a", 0, n]);
    expect([b?.side, b?.pos, b?.count]).toEqual(["b", 0, n]);
    expectSpansRow(a!, panels.slice(0, n));
    expectSpansRow(b!, panels.slice(n));
    expect(a!.phys.x + a!.phys.w).toBeCloseTo(corner, 9);
    expect(b!.phys.x).toBeCloseTo(corner, 9);

    const small = buildPreset("corner", venue({ count: 3, span: 2 }));
    expect(touch(small.frames).map((f) => [f.side, f.pos, f.count, f.span])).toEqual([
      ["a", 0, 3, 2],
      ["a", 1, 3, 2],
      ["a", 2, 3, 2],
      ["b", 0, 3, 2],
      ["b", 1, 3, 2],
      ["b", 2, 3, 2],
    ]);
  });

  it("draws a versus setup's two walls side by side, one per zone", () => {
    const preset = buildPreset("versus");
    expect(
      preset.frames.map((f) => [f.kind, f.setup, f.role, f.side, f.pos, f.count, f.group]),
    ).toEqual([
      ["wall", "versus", "station", "a", 0, 1, "versus"],
      ["wall", "versus", "station", "b", 0, 1, "versus"],
    ]);
    expect(preset.zones.map((z) => z.label)).toEqual(["Zone A", "Zone B"]);
    expect(preset.zones[1]!.x0).toBeGreaterThan(preset.zones[0]!.x1);
  });

  it("hangs the sphere from the ceiling at its true size, with people beside and under it", () => {
    const { sphere: SPHERE } = DEFAULT_VENUE;
    const preset = buildPreset("sphere");
    const [ball] = preset.frames;
    expect([ball?.id, ball?.short, ball?.name]).toEqual(["a-sphere", "A sphere", "Zone A sphere"]);
    expect([ball?.width, ball?.height]).toEqual([SPHERE.width, SPHERE.height]);
    expect(ball?.phys).toEqual({
      x: 0,
      y: SPHERE.bottomM,
      w: SPHERE.diameterM,
      h: SPHERE.diameterM,
    });
    expect(preset.ceiling).toBeGreaterThan(SPHERE.bottomM + SPHERE.diameterM);
    const under = preset.people.filter((p) => p.x > 0 && p.x < SPHERE.diameterM);
    const beside = preset.people.filter((p) => p.x < 0);
    expect(under.map((p) => p.kind).sort()).toEqual(["adult", "child"]);
    expect(beside.map((p) => p.kind).sort()).toEqual(["adult", "child"]);
    for (const p of under) expect(p.height).toBeLessThan(SPHERE.bottomM);
    for (const id of PRESET_IDS) {
      if (id !== "sphere") expect(buildPreset(id).ceiling, id).toBeUndefined();
    }
  });

  it("follows custom sphere sizes", () => {
    const preset = buildPreset("sphere", venue({ spw: 8192, sph: 4096, spd: 3, spb: 4 }));
    const [ball] = preset.frames;
    expect([ball?.width, ball?.height]).toEqual([8192, 4096]);
    expect(ball?.phys).toEqual({ x: 0, y: 4, w: 3, h: 3 });
    expect(ball?.reach).toBeNull();
    expect(profileOf(venue({ spd: 3, spb: 4 })).sphere).toMatchObject({ diameterM: 3, bottomM: 4 });
  });

  it("stands people next to the frames for scale", () => {
    for (const id of PRESET_IDS) {
      const kinds = buildPreset(id).people.map((p) => p.kind);
      expect(kinds).toContain("adult");
      expect(kinds).toContain("child");
    }
  });
});
