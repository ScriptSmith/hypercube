import { describe, expect, it } from "vitest";
import { axisMap, controlMap, mapAxis } from "../../../src/apps/hockey/control";

describe("control mapping", () => {
  it("drives the mallet directly when the control range covers the mallet's range", () => {
    const m = axisMap(100, 1000, 120, 980);
    expect(m.direct).toBe(true);
    expect(mapAxis(m, 500)).toBe(500);
    expect(mapAxis(m, 110)).toBe(120);
    expect(mapAxis(m, 999)).toBe(980);
  });

  it("stretches a short band over the whole range", () => {
    const m = axisMap(1500, 1900, 1000, 2000);
    expect(m.direct).toBe(false);
    expect(mapAxis(m, 1500)).toBe(1000);
    expect(mapAxis(m, 1700)).toBe(1500);
    expect(mapAxis(m, 1900)).toBe(2000);
    expect(mapAxis(m, 2400)).toBe(2000);
  });

  it("tolerates a band a little short of the ends", () => {
    expect(axisMap(140, 960, 120, 980).direct).toBe(true);
    expect(axisMap(300, 960, 120, 980).direct).toBe(false);
  });

  it("shows a control strip only when stretched", () => {
    const station = { x: 0, y: 0, width: 800, height: 1920 };
    const zone = { x: 80, y: 100, width: 640, height: 1720 };
    expect(controlMap(station, { top: 60, bottom: 1880 }, zone).strip).toBeNull();
    const child = controlMap(station, { top: 1100, bottom: 1880 }, zone);
    expect(child.x.direct).toBe(true);
    expect(child.y.direct).toBe(false);
    expect(child.strip).toEqual({ x: 0, y: 1100, width: 800, height: 780 });
  });

  it("pins a paddle's fixed axis", () => {
    const m = axisMap(0, 800, 92, 92);
    expect(mapAxis(m, 10)).toBe(92);
    expect(mapAxis(m, 700)).toBe(92);
  });
});
