import { describe, expect, it } from "vitest";
import {
  assessThrottle,
  browserVersion,
  candidateTone,
  createRing,
  formatBytes,
  formatDuration,
} from "../../src/apps/diag/probes";

describe("createRing", () => {
  it("never holds more than its capacity", () => {
    const ring = createRing(8);
    for (let i = 0; i < 10_000; i++) ring.push(i);
    expect(ring.length).toBe(8);
    expect(ring.values()).toEqual([9992, 9993, 9994, 9995, 9996, 9997, 9998, 9999]);
    expect(ring.max()).toBe(9999);
    expect(ring.mean()).toBeCloseTo(9995.5, 9);
  });

  it("summarises a partly filled ring", () => {
    const ring = createRing(16);
    expect(ring.mean()).toBe(0);
    expect(ring.median()).toBe(0);
    for (const v of [5, 1, 9]) ring.push(v);
    expect(ring.values()).toEqual([5, 1, 9]);
    expect(ring.median()).toBe(5);
    ring.clear();
    expect(ring.length).toBe(0);
  });
});

describe("assessThrottle", () => {
  it("passes a healthy page", () => {
    expect(assessThrottle({ sinceFrame: 16, timerLate: 2, hidden: false })).toEqual({
      throttled: false,
      reasons: [],
    });
  });

  it("flags stopped frames, late timers and hidden pages", () => {
    const v = assessThrottle({ sinceFrame: 1500, timerLate: 900, hidden: true });
    expect(v.throttled).toBe(true);
    expect(v.reasons).toEqual([
      "page hidden",
      "no animation frame for 1.5 s",
      "timers 900 ms late",
    ]);
  });
});

describe("candidateTone", () => {
  it("rates direct paths good and relays bad", () => {
    expect(candidateTone("host/host")).toBe("good");
    expect(candidateTone("relay/host")).toBe("bad");
    expect(candidateTone("srflx/relay")).toBe("bad");
    expect(candidateTone("srflx/host")).toBe("warn");
  });
});

describe("formatting", () => {
  it("formats bytes and durations", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(3 * 86_400_000 + 3_600_000)).toBe("3d 1h 0m");
  });

  it("pulls engine versions out of a kiosk user agent", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "kiosk/2.1.0 Chrome/138.0.7204.100 Electron/37.2.3 Safari/537.36";
    expect(browserVersion(ua)).toBe("Chrome 138 · Electron 37.2.3 · Windows NT 10.0");
  });
});
