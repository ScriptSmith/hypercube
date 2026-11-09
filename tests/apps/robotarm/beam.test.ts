import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LIFT } from "../../../src/apps/robotarm/bench";
import { BEAM_R, beamExit, frameCamera, toStage } from "../../../src/apps/robotarm/camera";
import { createExits, EXIT_TTL_MS } from "../../../src/apps/robotarm/link";
import { ORBIT } from "../../../src/apps/robotarm/orbit";
import { decodeExit, encodeExit, MAX_BEAM_W } from "../../../src/apps/robotarm/wire";
import { layoutOf } from "./helpers";

const ANGLES: [number, number][] = [
  [ORBIT.azimuth, ORBIT.elevation],
  [0, 27],
  [60, 40],
  [-120, 60],
  [150, 15],
  [ORBIT.azimuth, ORBIT.maxElevation],
];

/** A bank frame's camera, in venue px as stage px. */
const cameraFor = (kind: "panel" | "pair", az: number, el: number) => {
  const l = layoutOf(kind);
  const c = l.cells[0]!;
  const cam = new PerspectiveCamera(30, 1, 0.5, 80);
  frameCamera(cam, c.lane, c.focus, az, el);
  return { cam, lane: c.lane, width: l.width };
};

describe("robotarm beam exit", () => {
  for (const kind of ["panel", "pair"] as const) {
    for (const [az, el] of ANGLES) {
      it(`stands upright, evenly wide, and ends on the top edge: ${kind} at ${az}°, ${el}°`, () => {
        const { cam, lane, width } = cameraFor(kind, az, el);
        const e = beamExit(cam, lane, width, LIFT);
        const foot = toStage(cam, lane, e.base);
        const top = toStage(cam, lane, e.top);
        expect(foot.x).toBeCloseTo(e.u * width, 3);
        // Upright on the frame: the top is straight above the foot, on the top edge.
        expect(top.x).toBeCloseTo(foot.x, 3);
        expect(top.y).toBeCloseTo(lane.y, 3);
        expect(foot.y).toBeGreaterThan(top.y);
        // The strip's edges are the same distance apart at the foot and at the top edge.
        const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(BEAM_R);
        const wFoot =
          toStage(cam, lane, e.base.clone().add(right)).x -
          toStage(cam, lane, e.base.clone().sub(right)).x;
        const wTop =
          toStage(cam, lane, e.top.clone().add(right)).x -
          toStage(cam, lane, e.top.clone().sub(right)).x;
        expect(Math.abs(wTop)).toBeCloseTo(Math.abs(wFoot), 3);
        if (e.visible) expect(e.w * width).toBeCloseTo(Math.abs(wTop), 3);
        expect(e.length).toBeGreaterThan(0);
        expect(e.u).toBeGreaterThanOrEqual(0);
        expect(e.u).toBeLessThanOrEqual(1);
      });
    }

    it(`leaves the top of the ${kind} where the lift is in the usual view, a sensible width`, () => {
      const { cam, lane, width } = cameraFor(kind, ORBIT.azimuth, ORBIT.elevation);
      const e = beamExit(cam, lane, width, LIFT);
      expect(e.visible).toBe(true);
      expect(e.u).toBeGreaterThan(0.3);
      expect(e.u).toBeLessThan(0.9);
      expect(e.w).toBeGreaterThan(0.02);
      expect(e.w).toBeLessThan(0.25);
    });
  }

  it("moves when the view turns", () => {
    const a = cameraFor("panel", ORBIT.azimuth, ORBIT.elevation);
    const b = cameraFor("panel", ORBIT.azimuth + 60, ORBIT.elevation);
    const ea = beamExit(a.cam, a.lane, a.width, LIFT);
    const eb = beamExit(b.cam, b.lane, b.width, LIFT);
    expect(Math.abs(ea.u - eb.u)).toBeGreaterThan(0.05);
  });

  it("reports no width when the lift is off the frame", () => {
    const { cam, lane, width } = cameraFor("panel", ORBIT.azimuth, ORBIT.elevation);
    const e = beamExit(cam, lane, width, { ...LIFT, x: 40 });
    expect(e.visible).toBe(false);
    expect(e.w).toBe(0);
    expect(e.u).toBeGreaterThanOrEqual(0);
    expect(e.u).toBeLessThanOrEqual(1);
  });
});

describe("robotarm exit message and store", () => {
  it("round-trips and clamps the message, and drops malformed ones", () => {
    const m = encodeExit({ p: 3, u: 612.4, w: 98.6 });
    expect(decodeExit(JSON.parse(JSON.stringify(m)))).toEqual({ p: 3, u: 612, w: 99 });
    expect(encodeExit({ p: -2, u: 1400, w: 900 })).toEqual({ p: 0, u: 1000, w: MAX_BEAM_W });
    for (const bad of [
      null,
      "exit",
      [],
      { p: 1, u: 500 },
      { p: 1.5, u: 500, w: 50 },
      { p: 1, u: -1, w: 50 },
      { p: 1, u: 500, w: MAX_BEAM_W + 1 },
      { p: 64, u: 500, w: 50 },
      { p: "1", u: 500, w: 50 },
    ]) {
      expect(decodeExit(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("knows nothing about a column before it reports, keeps the last report, and forgets stale ones", () => {
    const s = createExits(16);
    expect(s.get(2, 0)).toBeNull();
    expect(s.live(0)).toEqual([]);
    expect(s.set(2, 0.6, 0.1, 100)).toBe(true);
    expect(s.set(2, 0.6, 0.1, 200)).toBe(false);
    expect(s.set(2, 0.62, 0.1, 300)).toBe(true);
    expect(s.get(2, 400)).toEqual({ u: 0.62, w: 0.1, at: 300 });
    s.set(0, 0.5, 0.12, 400);
    expect(s.live(500).map((e) => e.column)).toEqual([0, 2]);
    expect(s.get(2, 300 + EXIT_TTL_MS + 1)).toBeNull();
    expect(s.live(400 + EXIT_TTL_MS + 1)).toEqual([]);
  });

  it("refuses columns and values out of range, so it stays bounded", () => {
    const s = createExits(16);
    expect(s.set(16, 0.5, 0.1, 0)).toBe(false);
    expect(s.set(-1, 0.5, 0.1, 0)).toBe(false);
    expect(s.set(1.5, 0.5, 0.1, 0)).toBe(false);
    expect(s.set(1, 1.2, 0.1, 0)).toBe(false);
    expect(s.set(1, 0.5, Number.NaN, 0)).toBe(false);
    for (let c = 0; c < 100; c++) s.set(c % 20, 0.5, 0.1, c);
    expect(s.size).toBeLessThanOrEqual(16);
  });
});
