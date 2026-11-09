import { describe, expect, it } from "vitest";
import { DROP_MS, FADE_MS } from "../../../src/apps/kites/config";
import {
  blankPose,
  createFleet,
  MAX_FRAMES,
  MIN_DELAY,
  type KitePose,
} from "../../../src/apps/kites/fleet";
import type { KiteMsg } from "../../../src/apps/kites/wire";

const msg = (t: number, x: number, pos = 1): KiteMsg => ({
  t,
  pos,
  count: 4,
  kites: [
    { slot: 0, u: 0.5, u2: 0.5, x, y: 0.5, spin: 0, tension: 1, flags: 0, color: 1, shape: 0 },
    {
      slot: 1,
      u: 0.4,
      u2: 0.45,
      x: x + 0.1,
      y: 0.6,
      spin: 0.2,
      tension: 1,
      flags: 0,
      color: 1,
      shape: 1,
    },
  ],
});

describe("the screen's fleet", () => {
  it("draws kites between messages", () => {
    const f = createFleet();
    const r = f.accept(msg(1000, 0.2), "p1", 0, 1000)!;
    f.accept(msg(1100, 0.3), "p1", 100, 1100);
    const out: KitePose[] = [];
    expect(f.poses(r, 1050, 100, out)).toBe(2);
    expect(out[0]!.x).toBeCloseTo(0.25);
    expect(out[1]!.x).toBeCloseTo(0.35);
    // Before the first message: the first. Just after the last: carried on briefly.
    f.poses(r, 900, 100, out);
    expect(out[0]!.x).toBeCloseTo(0.2);
    f.poses(r, 1150, 100, out);
    expect(out[0]!.x).toBeCloseTo(0.35);
    // Never carried on more than 150 ms past the newest.
    f.poses(r, 2000, 100, out);
    expect(out[0]!.x).toBeCloseTo(0.45);
  });

  it("ignores repeated or old messages and restarts on a reload", () => {
    const f = createFleet();
    const r = f.accept(msg(5000, 0.2), "p1", 0, 5000)!;
    f.accept(msg(5000, 0.9), "p1", 10, 5010);
    f.accept(msg(4900, 0.9), "p1", 20, 5020);
    expect(r.n).toBe(1);
    f.accept(msg(1000, 0.4), "p1", 30, 5030);
    expect(r.n).toBe(1);
    const out: KitePose[] = [];
    f.poses(r, 1000, 30, out);
    expect(out[0]!.x).toBeCloseTo(0.4);
  });

  it("draws further behind when messages arrive late", () => {
    const f = createFleet();
    for (let i = 0; i < 100; i++) {
      const t = 10_000 + i * 66;
      f.accept(msg(t, 0.5), "p1", t + 300, t + 300);
      f.tick(0.066);
    }
    expect(f.delay).toBeGreaterThan(300 + 50);
    expect(f.delay).toBeLessThan(600);
    for (let i = 0; i < 600; i++) {
      const t = 20_000 + i * 66;
      f.accept(msg(t, 0.5), "p1", t + 10, t + 10);
      f.tick(0.066);
    }
    expect(f.delay).toBeLessThan(MIN_DELAY + 100);
  });

  it("never draws time backwards while the delay grows", () => {
    const f = createFleet();
    let last = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 400; i++) {
      const clock = 10_000 + i * 16;
      // Messages turn up 50 ms late, then suddenly 900 ms late.
      const late = i < 100 ? 50 : 900;
      f.accept(msg(clock - late, 0.5), "p1", clock, clock);
      f.tick(0.016);
      const at = clock - f.delay;
      expect(at).toBeGreaterThanOrEqual(last);
      last = at;
    }
    expect(f.delay).toBeGreaterThan(900);
  });

  it("reels in, fades and drops a frame that went quiet", () => {
    const f = createFleet();
    const r = f.accept(msg(1000, 0.2), "p1", 0, 1000)!;
    f.accept(msg(1000, 0.2, 2), "p2", 0, 1000);
    const out = [blankPose()];
    f.poses(r, 1000, DROP_MS - 10, out);
    expect(out[0]!.alpha).toBe(1);
    f.poses(r, 1000, DROP_MS + FADE_MS / 2, out);
    expect(out[0]!.alpha).toBeCloseTo(0.5, 1);
    f.accept(msg(9000, 0.2, 2), "p2", DROP_MS + FADE_MS, 9000);
    expect(f.prune(DROP_MS + FADE_MS + 10)).toBe(1);
    expect([...f.frames()].map((x) => x.frame)).toEqual(["p2"]);
  });

  it("holds a bounded number of frames", () => {
    const f = createFleet();
    for (let i = 0; i < MAX_FRAMES + 10; i++) f.accept(msg(1000, 0.2, 0), `p${i}`, 0, 1000);
    expect(f.size).toBe(MAX_FRAMES);
  });
});
