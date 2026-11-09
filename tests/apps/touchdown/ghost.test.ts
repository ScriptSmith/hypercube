import { describe, expect, it } from "vitest";
import {
  clearTrack,
  copyTrack,
  createTrack,
  GHOST_CAP,
  type Pose,
  poseAt,
  record,
  trackSeconds,
} from "../../../src/apps/touchdown/ghost";
import { crewOf, run } from "./helpers";

describe("touchdown ghosts", () => {
  it("never holds more than 90 s at 15 Hz, however long the run", () => {
    const t = createTrack();
    const size = t.data.length;
    let kept = true;
    for (let i = 0; i < 200 * 120; i++) kept = record(t, i / 120, i, -i, 0, 1);
    expect(kept).toBe(false);
    expect(t.n).toBe(GHOST_CAP);
    expect(GHOST_CAP).toBe(1350);
    expect(t.data.length).toBe(size);
    expect(trackSeconds(t)).toBe(90);
  });

  it("samples at 15 Hz and interpolates between samples", () => {
    const t = createTrack();
    for (let i = 0; i <= 120; i++) record(t, i / 120, i * 10, 0, 0, 0);
    expect(t.n).toBe(16);
    const p: Pose = { x: 0, y: 0, a: 0, flags: 0 };
    expect(poseAt(t, 0.5, p)).toBe(true);
    expect(p.x).toBeCloseTo(600, -1);
    // Past the end it holds the last pose.
    poseAt(t, 50, p);
    expect(p.x).toBe(t.data[(t.n - 1) * 4]);
    expect(poseAt(createTrack(), 1, p)).toBe(false);
  });

  it("copies and clears without allocating", () => {
    const a = createTrack();
    const b = createTrack();
    for (let i = 0; i < 30; i++) record(a, i / 15, i, i, i, 3);
    a.stars = 2;
    const buffer = b.data;
    copyTrack(a, b);
    expect(b.data).toBe(buffer);
    expect(b.n).toBe(30);
    expect(b.stars).toBe(2);
    clearTrack(b);
    expect(b.n).toBe(0);
    expect(b.stars).toBe(0);
  });

  it("keeps a crew's ghost buffers bounded across many runs", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    let now = 0;
    for (let i = 0; i < 6; i++) {
      crew.touched(true, now);
      now = run(crew, 32, now);
      if (crew.ghost) expect(crew.ghost.n).toBeLessThanOrEqual(GHOST_CAP);
    }
    expect(crew.counts.runs).toBeGreaterThan(5);
  });
});
