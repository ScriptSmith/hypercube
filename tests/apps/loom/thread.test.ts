import { describe, expect, it } from "vitest";
import { TAU } from "../../../src/apps/loom/config";
import { threadEdgeX, threadPoints } from "../../../src/apps/loom/frameview";
import { HEDDLE, screenGeometry } from "../../../src/apps/loom/screen";
import { valueAt } from "../../../src/apps/loom/series";
import { THREAD_D, THREAD_LAMBDA, threadOffset, turnAngle } from "../../../src/apps/loom/thread";
import { layoutOf } from "./helpers";
import { VENUE_SIZE } from "../../../src/core/frame";
import { bankFraction } from "../../../src/core/layout";
import { DEFAULT_VENUE } from "../../../src/core/venue";

/** Where the screen draws column i's thread at height h (column widths) above its bottom edge. */
const screenX = (W: number, n: number, i: number, amp: number, phase: number, th: number, h = 0) =>
  ((i + 0.5) / n) * W + threadOffset(i + 1, amp, phase, th, h) * (W / n);

describe("loom threads", () => {
  it("turn once per period on the shared clock, the same on every frame", () => {
    expect(turnAngle(0, 6)).toBe(0);
    expect(turnAngle(1500, 6)).toBeCloseTo(TAU / 4, 9);
    expect(turnAngle(6000, 6)).toBeCloseTo(0, 9);
    // Clock times as large as epoch milliseconds keep their precision.
    const t = 1_761_300_000_123;
    expect(Math.abs(turnAngle(t + 3000, 6) - turnAngle(t, 6) - Math.PI) % TAU).toBeLessThan(1e-6);
  });

  it("swing at the top edge by D times their term of the sum", () => {
    const amp = 0.7;
    const phase = 1.1;
    for (let k = 1; k <= 10; k++) {
      for (const th of [0, 0.4, 2.2, 5]) {
        const terms = Array.from({ length: k }, (_, i) => ({ amp: i === k - 1 ? amp : 0, phase }));
        expect(threadOffset(k, amp, phase, th, 0)).toBeCloseTo(THREAD_D * valueAt(terms, th), 12);
      }
    }
  });

  it("have a k-th of the fundamental's wavelength and size, so every thread has the same slope", () => {
    for (let k = 1; k <= 10; k++) {
      // A whole wavelength up, the thread repeats.
      for (const h of [-0.7, 0, 0.3]) {
        expect(threadOffset(k, 0.8, 0.3, 1, h + THREAD_LAMBDA / k)).toBeCloseTo(
          threadOffset(k, 0.8, 0.3, 1, h),
          9,
        );
      }
      let slope = 0;
      for (let i = 0; i < 400; i++) {
        const h = (i / 400) * THREAD_LAMBDA;
        const d = (threadOffset(k, 1, 0, 0, h + 1e-6) - threadOffset(k, 1, 0, 0, h)) / 1e-6;
        slope = Math.max(slope, Math.abs(d));
      }
      expect(slope).toBeCloseTo((TAU * THREAD_D) / THREAD_LAMBDA, 3);
    }
  });

  it("travel upwards as time goes on", () => {
    // A crest at height h moves up: the offset at h + dh later equals the offset at h now.
    const dt = 0.1;
    const dh = (dt * THREAD_LAMBDA) / TAU;
    expect(threadOffset(3, 0.6, 0.2, 1 + dt, 0.5 + dh)).toBeCloseTo(
      threadOffset(3, 0.6, 0.2, 1, 0.5),
      9,
    );
  });

  for (const [kind, count] of [
    ["panel", 6],
    ["panel", 4],
    ["pair", 3],
    ["pair", 2],
  ] as const) {
    it(`leave a ${kind}'s top edge where the screen above a bank of ${count} carries them on`, () => {
      const W = VENUE_SIZE.screen.width;
      const per = kind === "pair" ? 2 : 1;
      const n = count * per;
      for (let pos = 0; pos < count; pos++) {
        const l = layoutOf(kind, { bank: true, firstK: pos * per + 1 });
        for (const s of l.strands) {
          for (const [amp, phase, th] of [
            [0.8, 0, 0.3],
            [0.35, 2.1, 4.4],
            [1, 5.9, 1.7],
          ] as const) {
            const u = threadEdgeX(s, th, amp, phase) / l.width;
            const onScreen = bankFraction(pos, u, count) * W;
            expect(onScreen).toBeCloseTo(screenX(W, n, s.k - 1, amp, phase, th), 6);
            // The drawn thread ends exactly there too.
            const pts = new Float64Array(1024);
            const m = threadPoints(s, 0, th, amp, phase, pts);
            expect(pts[2 * (m - 1) + 1]).toBe(0);
            expect(pts[2 * (m - 1)]! / l.width).toBeCloseTo(u, 9);
          }
        }
      }
    });
  }

  it("keep the same physical wavelength on a panel and on the screen above the bank", () => {
    // A column is one panel wide on the frame and one panel's share of the screen above the
    // bank, which spans the bank exactly; the two differ only by the bezels.
    const panelM = DEFAULT_VENUE.panel.widthM;
    const n = DEFAULT_VENUE.bankCount;
    const screenColM = (n * panelM + (n - 1) * DEFAULT_VENUE.bezelM) / n;
    expect(Math.abs(screenColM / panelM - 1)).toBeLessThan(0.03);
    // The default screen spans the default bank too.
    expect(Math.abs(DEFAULT_VENUE.screen.widthM / n / panelM - 1)).toBeLessThan(0.03);
    // On both, the thread's wavelength and swing are set in column widths.
    const l = layoutOf("panel", { bank: true, firstK: 1 });
    const pts = new Float64Array(2048);
    const m = threadPoints(l.strands[0]!, -2 * THREAD_LAMBDA * 1080, 0, 1, 0, pts);
    // Crests one wavelength apart on the frame, measured in its column widths.
    const crests: number[] = [];
    for (let i = 1; i < m - 1; i++) {
      const x = pts[2 * i]!;
      if (x > pts[2 * i - 2]! && x >= pts[2 * i + 2]! && x > 540 + 100)
        crests.push(pts[2 * i + 1]!);
    }
    expect(crests.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(crests[0]! - crests[1]!) / 1080).toBeCloseTo(THREAD_LAMBDA, 1);
  });

  it("reach the screen's heddle above the bank, under the picture", () => {
    const { width, height } = VENUE_SIZE.screen;
    const g = screenGeometry(width, height);
    expect(g.heddle).toBeCloseTo(height * HEDDLE, 9);
    expect(g.picture.y + g.picture.height).toBeLessThan(g.heddle);
    expect(g.cloth.y + g.cloth.height).toBeLessThan(g.picture.y);
  });
});
