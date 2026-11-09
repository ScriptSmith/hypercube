import { describe, expect, it } from "vitest";
import { newBuild } from "../../../src/apps/manyhands/build";
import { FLY_MS } from "../../../src/apps/manyhands/config";
import { fitBuild, flightPoint, slotCentre } from "../../../src/apps/manyhands/scene";
import { VENUE_SIZE } from "../../../src/core/frame";
import { bankFraction } from "../../../src/core/layout";

const area = { x: 0, y: 0, w: VENUE_SIZE.screen.width, h: VENUE_SIZE.screen.height };

describe("parts flying onto the screen", () => {
  const setup = (pos: number, u: number, count: number, t: number) => {
    const b = newBuild(1, "rocket", 12, 0, 150_000);
    const s = b.slots[3]!;
    s.state = "coming";
    s.maker = "person";
    s.departAt = t;
    s.arriveAt = t + FLY_MS;
    s.sx = bankFraction(pos, u, count);
    s.sy = 1;
    return { b, s, f: fitBuild(area, "rocket", { height: 0.72, bottom: 0.89, width: 0.8 }) };
  };

  it("start at the bottom edge right above the panel that made them", () => {
    for (const [pos, u] of [
      [0, 0.5],
      [3, 0.2],
      [5, 0.9],
    ] as const) {
      const { s, f } = setup(pos, u, 6, 5000);
      const p = flightPoint(s, f, area, 5000, 1500)!;
      expect(p.p).toBe(0);
      expect(p.y).toBeCloseTo(area.h, 6);
      expect(p.x).toBeCloseTo(((pos + u) / 6) * area.w, 6);
      expect(p.x).toBeGreaterThan((pos / 6) * area.w);
      expect(p.x).toBeLessThan(((pos + 1) / 6) * area.w);
    }
  });

  it("a late part starts further along the same path, and every path ends in its slot", () => {
    const { s, f } = setup(4, 0.5, 6, 5000);
    const onTime = [0, 300, 600, FLY_MS].map((d) => flightPoint(s, f, area, 5000 + d, 1500)!);
    // 300 ms late: drawing starts at the point an on-time part would have reached by then.
    expect(onTime[1]!.p).toBeCloseTo(300 / FLY_MS, 6);
    expect(onTime[1]!.y).toBeLessThan(onTime[0]!.y);
    const end = slotCentre(f, s);
    expect(onTime[3]!.x).toBeCloseTo(end.x, 6);
    expect(onTime[3]!.y).toBeCloseTo(end.y, 6);
    // No jumps along the way: small steps in time are small steps in space.
    let last = flightPoint(s, f, area, 5000, 1500)!;
    for (let t = 5016; t <= 5000 + FLY_MS; t += 16) {
      const p = flightPoint(s, f, area, t, 1500)!;
      expect(Math.hypot(p.x - last.x, p.y - last.y)).toBeLessThan(200);
      last = p;
    }
  });

  it("before it sets off a part isn't drawn", () => {
    const { s, f } = setup(1, 0.5, 6, 5000);
    expect(flightPoint(s, f, area, 4999, 1500)).toBeNull();
  });
});
