import { describe, expect, it } from "vitest";
import { commonBand } from "../../src/core/stations/common";
import type { Station } from "../../src/core/types";

const station = (band: { top: number; bottom: number } | null): Station => ({
  id: "s",
  rect: { x: 0, y: 0, width: 1000, height: 1920 },
  color: "#fff",
  state: band ? "playing" : "idle",
  band,
  bot: false,
  end() {},
  claimForBot() {},
});

describe("commonBand", () => {
  it("is null when no station has a band", () => {
    expect(commonBand([])).toBeNull();
    expect(commonBand([station(null), station(null)])).toBeNull();
  });

  it("is the band itself for one player, skipping stations without one", () => {
    expect(commonBand([station({ top: 200, bottom: 900 }), station(null)])).toEqual({
      top: 200,
      bottom: 900,
    });
  });

  it("is the overlap when it is tall enough", () => {
    const bands = [
      station({ top: 200, bottom: 1400 }),
      station({ top: 600, bottom: 1700 }),
      station({ top: 400, bottom: 1500 }),
    ];
    expect(commonBand(bands)).toEqual({ top: 600, bottom: 1400 });
    expect(commonBand(bands, 800)).toEqual({ top: 600, bottom: 1400 });
  });

  it("falls back to the top of the lowest-reaching band when the overlap is short", () => {
    const adult = station({ top: 100, bottom: 1300 });
    const child = station({ top: 1200, bottom: 1900 });
    expect(commonBand([adult, child])).toEqual({ top: 1200, bottom: 1600 });
    expect(commonBand([child, adult], 300)).toEqual({ top: 1200, bottom: 1500 });
  });

  it("uses the same fallback when the bands do not overlap at all", () => {
    const adult = station({ top: 100, bottom: 700 });
    const child = station({ top: 1300, bottom: 1900 });
    expect(commonBand([adult, child])).toEqual({ top: 1300, bottom: 1700 });
  });

  it("never returns more than the low band itself", () => {
    const tall = station({ top: 0, bottom: 300 });
    const low = station({ top: 1700, bottom: 1920 });
    expect(commonBand([tall, low])).toEqual({ top: 1700, bottom: 1920 });
  });
});
