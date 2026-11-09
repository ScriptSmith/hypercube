import { describe, expect, it } from "vitest";
import {
  agentCount,
  readConfig,
  trailCell,
  turingCell,
  WALL_AGENTS,
} from "../../../src/apps/petri/config";
import type { Box } from "../../../src/apps/petri/dish";
import {
  angleFromUp,
  computeLayout,
  controlBoxes,
  detentAngles,
  dialBounds,
  labelBoxes,
  type Layout,
  MIN_SWATCH,
  type Mode,
  nearestDetent,
  padAt,
  SEAM_CLEAR,
} from "../../../src/apps/petri/layout";
import { FAMILIES, type Family } from "../../../src/apps/petri/stamps";
import type { FrameKind, Reach } from "../../../src/core/types";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const CASES: [FrameKind, Mode][] = [
  ["wall", "solo"],
  ["panel", "solo"],
  ["pair", "solo"],
  ["panel", "dropper"],
  ["pair", "dropper"],
];
const layoutsFor = (
  fn: (l: Layout, kind: FrameKind, mode: Mode, family: Family, reach: Reach) => void,
) => {
  for (const [kind, mode] of CASES) {
    const reaches: Reach[] = [
      DEFAULT_REACH[kind],
      kind === "wall" ? { adult: 0.45, child: 0.25 } : { adult: 0.85, child: 0.5 },
    ];
    for (const reach of reaches) {
      for (const family of FAMILIES) {
        for (const regions of [1, 2, 3]) {
          fn(
            computeLayout(kind, mode, VENUE_SIZE[kind], reach, family, regions),
            kind,
            mode,
            family,
            reach,
          );
        }
      }
    }
  }
};

describe("petri layout", () => {
  it("makes every swatch at least 200 venue px", () => {
    layoutsFor((l) => {
      for (const p of l.pads)
        for (const s of p.swatches) expect(s.box.width).toBeGreaterThanOrEqual(MIN_SWATCH);
    });
  });

  it("keeps everything on the frame and nothing overlapping", () => {
    layoutsFor((l, kind, mode, family) => {
      const boxes = controlBoxes(l);
      for (const b of boxes) {
        expect(b.x, `${kind} ${mode} ${family}`).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(l.venue.width);
        expect(b.y + b.height).toBeLessThanOrEqual(l.venue.height);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(overlaps(boxes[i]!, boxes[j]!), `${kind} ${mode} ${family} ${i} ${j}`).toBe(false);
        }
      }
    });
  });

  it("puts trays and pipettes in the child band and dials in the adult band", () => {
    layoutsFor((l, kind, mode, family, reach) => {
      const H = l.venue.height;
      const childTop = H * (1 - reach.child);
      for (const p of l.pads) {
        for (const s of p.swatches) {
          const centre = s.box.y + s.box.height / 2;
          if (s.stamp.band === "child")
            expect(centre, `${kind} ${s.stamp.id}`).toBeGreaterThan(childTop);
          else expect(centre, `${kind} ${s.stamp.id}`).toBeLessThan(childTop);
        }
        if (p.pipette) expect(p.pipette.y).toBeGreaterThanOrEqual(childTop);
        expect(p.reset.y + p.reset.height / 2).toBeGreaterThan(H * (1 - Math.min(1, reach.adult)));
      }
      for (const d of l.dials) {
        expect(d.cy + d.r, `${kind} ${mode} ${family}`).toBeLessThanOrEqual(childTop);
        expect(d.cy - d.r).toBeGreaterThanOrEqual(H * (1 - Math.min(1, reach.adult)) - 1);
      }
      if (family === "life") expect(l.dials).toEqual([]);
    });
  });

  it("keeps a pair's trays, pipettes and dials 220 venue px from the seam", () => {
    layoutsFor((l, kind) => {
      if (kind !== "pair") return;
      const seam = l.venue.width / 2;
      const clear = (x0: number, x1: number) => x1 <= seam - SEAM_CLEAR || x0 >= seam + SEAM_CLEAR;
      for (const b of [...controlBoxes(l), ...labelBoxes(l)]) {
        expect(clear(b.x, b.x + b.width)).toBe(true);
      }
      for (const d of l.dials) {
        const b = dialBounds(d);
        expect(clear(b.x, b.x + b.width)).toBe(true);
      }
    });
  });

  it("gives a wall one dial per region, and both ends a tray", () => {
    for (const regions of [1, 2, 3]) {
      const l = computeLayout(
        "wall",
        "solo",
        VENUE_SIZE.wall,
        DEFAULT_REACH.wall,
        "slime",
        regions,
      );
      expect(l.regions).toBe(regions);
      expect(l.pads.length).toBe(2);
      expect(new Set(l.dials.map((d) => d.region)).size).toBe(regions);
      expect(l.marks.length).toBe(regions - 1);
    }
  });

  it("shows a bank touch frame's culture above its bench", () => {
    const l = computeLayout("panel", "dropper", VENUE_SIZE.panel, DEFAULT_REACH.panel, "slime", 1);
    expect(l.benchTop).toBe(l.world.height);
    expect(l.world.height).toBeLessThan(l.venue.height * 0.6);
    expect(l.pads[0]!.flick).not.toBeNull();
    const solo = computeLayout("panel", "solo", VENUE_SIZE.panel, DEFAULT_REACH.panel, "slime", 1);
    expect(solo.world.height).toBe(solo.venue.height);
    expect(solo.pads[0]!.flick).toBeNull();
  });

  it("puts the screen's world around its dish", () => {
    const l = computeLayout("screen", "screen", VENUE_SIZE.screen, DEFAULT_REACH.screen, "life", 1);
    expect(l.dish).not.toBeNull();
    expect(l.world.width).toBeCloseTo(2 * l.dish!.r);
    expect(l.pads).toEqual([]);
  });

  it("knows which pad a tap belongs to", () => {
    const l = computeLayout("wall", "solo", VENUE_SIZE.wall, DEFAULT_REACH.wall, "life", 2);
    expect(padAt(l, 100)?.side).toBe(0);
    expect(padAt(l, 6400)?.side).toBe(1);
    expect(padAt(l, 2000)?.side).toBe(0);
    expect(padAt(l, 4500)?.side).toBe(1);
  });
});

describe("petri dial", () => {
  it("spreads detents evenly around straight up", () => {
    const a = detentAngles(4, Math.PI / 2);
    expect(a[0]).toBeCloseTo(-Math.PI / 4);
    expect(a[3]).toBeCloseTo(Math.PI / 4);
    expect(a[1]! - a[0]!).toBeCloseTo(a[2]! - a[1]!);
  });

  it("snaps a finger's angle to the nearest detent", () => {
    expect(angleFromUp(0, -1)).toBeCloseTo(0);
    expect(angleFromUp(1, 0)).toBeCloseTo(Math.PI / 2);
    const spread = (130 * Math.PI) / 180;
    expect(nearestDetent(-spread / 2 - 0.4, 4, spread)).toBe(0);
    expect(nearestDetent(spread / 2 + 0.4, 4, spread)).toBe(3);
    expect(nearestDetent(0.05, 4, spread)).toBe(2);
  });
});

describe("petri config", () => {
  it("reads its options with safe fallbacks", () => {
    const c = readConfig(
      "slime",
      { cell: "8", speed: "fast", regions: 3, slices: false, rain: false },
      "wall",
    );
    expect(c).toEqual({
      family: "slime",
      cell: 8,
      speed: "fast",
      regions: 3,
      slices: false,
      rain: false,
    });
    const d = readConfig("lenia", { cell: "5", speed: "warp" }, "panel");
    expect(d.family).toBe("life");
    expect(d.cell).toBe(6);
    expect(d.speed).toBe("normal");
    expect(d.regions).toBe(1);
  });

  it("scales the slime's agents with res squared and with area", () => {
    const wall = VENUE_SIZE.wall.width * VENUE_SIZE.wall.height;
    expect(agentCount(wall, 1, false)).toBe(WALL_AGENTS);
    expect(agentCount(wall, 0.5, false)).toBe(WALL_AGENTS / 4);
    expect(agentCount(wall / 4, 1, false)).toBe(WALL_AGENTS / 4);
    expect(agentCount(wall, 1, true)).toBe(WALL_AGENTS / 32);
  });

  it("uses half-venue-resolution trails and 3 px reaction cells at full res", () => {
    expect(trailCell(1, false)).toBe(2);
    expect(turingCell(1, false)).toBe(3);
    // About 1920 x 720 reaction cells on the wall.
    expect(Math.round(VENUE_SIZE.wall.width / turingCell(1, false))).toBe(1920);
    expect(turingCell(0.5, false)).toBeGreaterThan(turingCell(1, false));
  });
});
