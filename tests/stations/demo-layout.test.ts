import { describe, expect, it } from "vitest";
import { demoStations } from "../../src/apps/stationdemo/layout";
import { newPuck, PUCK_VENUE_PX, stepPuck } from "../../src/apps/stationdemo/shared";
import type { FrameInfo, FrameKind } from "../../src/core/types";

const frame = (kind: FrameKind, width: number, height: number, adult: number): FrameInfo => ({
  kind,
  venueWidth: width,
  venueHeight: height,
  width,
  height,
  unit: 1,
  pixelRatio: 1,
  touch: true,
  reach: { adult, child: adult / 2 },
  reachTop: { adult: height * (1 - adult), child: height * (1 - adult / 2) },
  seams: kind === "pair" ? [width / 2] : [],
});

describe("station demo layout", () => {
  it("gives a panel one station", () => {
    expect(demoStations(frame("panel", 1080, 1920, 1))).toHaveLength(1);
  });

  it("keeps pair stations at the outer halves, clear of the seam", () => {
    const f = frame("pair", 2160, 1920, 1);
    const [left, right] = demoStations(f);
    expect(left && right).toBeTruthy();
    expect(left!.rect.x + left!.rect.width).toBeLessThanOrEqual(1080 - 2160 * 0.1);
    expect(right!.rect.x).toBeGreaterThanOrEqual(1080 + 2160 * 0.1);
    expect(right!.rect.x + right!.rect.width).toBeLessThanOrEqual(2160);
  });

  it("puts four to six wall stations along the bottom inside adult reach", () => {
    const f = frame("wall", 5760, 2160, 0.45);
    for (const count of [3, 4, 6, 9]) {
      const list = demoStations(f, count);
      expect(list.length).toBe(Math.min(6, Math.max(4, count)));
      for (const s of list) {
        expect(s.rect.y).toBeGreaterThanOrEqual(f.reachTop.adult);
        expect(s.rect.y + s.rect.height).toBe(2160);
      }
      const ids = new Set(list.map((s) => s.id));
      expect(ids.size).toBe(list.length);
    }
  });

  it("gives a kiosk two stations", () => {
    expect(demoStations(frame("kiosk", 1920, 1080, 1))).toHaveLength(2);
  });
});

describe("station demo shared puck", () => {
  it("stays inside the common band and the frame", () => {
    const puck = newPuck();
    const band = { top: 800, bottom: 1400 };
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const paddles = [{ x: 400, y: 1100, vx: 900, vy: -300, r: 70 }];
    for (let i = 0; i < 5000; i++) {
      paddles[0]!.x = 400 + 300 * Math.sin(i / 40);
      stepPuck(puck, band, 2160, 1, paddles, 1 / 60, random);
      expect(puck.y).toBeGreaterThanOrEqual(band.top + PUCK_VENUE_PX - 1e-6);
      expect(puck.y).toBeLessThanOrEqual(band.bottom - PUCK_VENUE_PX + 1e-6);
      expect(puck.x).toBeGreaterThanOrEqual(PUCK_VENUE_PX - 1e-6);
      expect(puck.x).toBeLessThanOrEqual(2160 - PUCK_VENUE_PX + 1e-6);
    }
  });
});
