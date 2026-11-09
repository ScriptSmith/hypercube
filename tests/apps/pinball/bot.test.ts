import { describe, expect, it } from "vitest";
import { botGame, rig } from "./helpers";

/** A long bot session that never ends, so deck lane shots can be counted. */
const session = (upper: boolean, minutes: number) => {
  const r = rig({ config: { balls: 1_000_000 } });
  r.table.start("bot");
  botGame(r, 11, minutes * 60, upper);
  return r.table.stats;
};

describe("pinball bot", () => {
  it("reaches the deck lane, mostly with the upper left flipper", () => {
    const withUpper = session(true, 8);
    const mainOnly = session(false, 8);
    const lane = (s: { orbit: number }) => s.orbit;
    expect(lane(withUpper)).toBeGreaterThan(5);
    // Without the upper flippers the deck lane is much harder to reach.
    expect(lane(mainOnly) * 5).toBeLessThan(lane(withUpper));
    // The upper left flipper is the one aimed at it.
    expect(withUpper.byFlipper[2]).toBeGreaterThan(0);
  });
});
