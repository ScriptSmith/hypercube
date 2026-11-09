import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BEACON_MS, SCREEN_GRACE_MS } from "../../../src/apps/kites/config";
import { createExitHistory, createUplink, TANGLE_HOLD_MS } from "../../../src/apps/kites/link";
import {
  decodeKites,
  encodeSky,
  encodeTangle,
  type KiteMsg,
  TOPIC,
} from "../../../src/apps/kites/wire";
import { fakeNet, peer } from "./helpers";

const msg = (): KiteMsg => ({
  t: 1000,
  pos: 1,
  count: 4,
  kites: [
    { slot: 0, u: 0.5, u2: 0.5, x: 0.3, y: 0.4, spin: 0, tension: 1, flags: 0, color: 1, shape: 0 },
  ],
});

describe("uplink", () => {
  let now = 0;
  beforeEach(() => {
    now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  const setup = () => {
    const net = fakeNet();
    const screen = net.channel(peer("scr", "screen"));
    const panel = net.channel(peer("p2", "station", 1));
    const other = net.channel(peer("b-scr", "screen", 0, 1));
    const up = createUplink(panel, 0);
    const got: KiteMsg[] = [];
    screen.on(TOPIC.kite, (d) => got.push(decodeKites(d)!));
    const beacon = (delay = 200) => screen.send(TOPIC.sky, encodeSky({ side: 0, delay }));
    return { net, screen, panel, other, up, got, beacon };
  };

  it("sends nothing until its screen's beacon arrives, then about 15 a second", () => {
    const { up, got, beacon } = setup();
    for (let i = 0; i < 30; i++) {
      now += 1000 / 60;
      up.tick(now, msg);
    }
    expect(got).toHaveLength(0);
    expect(up.screen(now)).toBeNull();
    beacon();
    for (let i = 0; i < 120; i++) {
      now += 1000 / 60;
      if (i % 30 === 0) beacon();
      up.tick(now, msg);
    }
    expect(got.length).toBeGreaterThanOrEqual(28);
    expect(got.length).toBeLessThanOrEqual(31);
    expect(up.screen(now)).toBe("scr");
  });

  it("ignores beacons from the other side's screen", () => {
    const { up, other } = setup();
    other.send(TOPIC.sky, encodeSky({ side: 1, delay: 100 }));
    expect(up.screen(now)).toBeNull();
  });

  it("decides the screen has gone soon after its beacons stop", () => {
    const { up, beacon } = setup();
    beacon();
    let gone = 0;
    for (let i = 0; i < 400; i++) {
      now += 1000 / 60;
      if (!up.screen(now)) {
        gone = i * (1000 / 60);
        break;
      }
    }
    expect(gone).toBeGreaterThan(SCREEN_GRACE_MS - 50);
    expect(gone).toBeLessThan(3000);
  });

  it("follows the screen's drawing delay smoothly", () => {
    const { up, beacon } = setup();
    beacon(500);
    const seen: number[] = [];
    for (let i = 0; i < 120; i++) {
      now += 1000 / 60;
      if (i % 30 === 0) beacon(500);
      up.tick(now, msg);
      seen.push(up.delay);
    }
    expect(up.delay).toBeCloseTo(500, 0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]! - seen[i - 1]!).toBeLessThan(11);
  });

  it("takes the screen's word on tangles, and forgets ones it stops repeating", () => {
    const { up, screen } = setup();
    screen.send(TOPIC.tangle, encodeTangle({ slot: 1, on: true, x: 0.3, y: 0.5 }), "p2");
    expect(up.tangles(now).has(1)).toBe(true);
    screen.send(TOPIC.tangle, encodeTangle({ slot: 1, on: false, x: 0.3, y: 0.5 }), "p2");
    expect(up.tangles(now).has(1)).toBe(false);
    screen.send(TOPIC.tangle, encodeTangle({ slot: 0, on: true, x: 0.3, y: 0.5 }), "p2");
    now += TANGLE_HOLD_MS + 10;
    expect(up.tangles(now).has(0)).toBe(false);
  });

  it("beacons are sent often enough for the grace period", () => {
    expect(BEACON_MS * 3).toBeLessThan(SCREEN_GRACE_MS);
  });
});

describe("exit history", () => {
  it("reads back exits at an earlier moment", () => {
    const h = createExitHistory(16);
    for (let i = 0; i < 10; i++) h.record(1000 + i * 33, [i * 10, 500 - i]);
    const out: number[] = [];
    expect(h.at(1000 + 33 * 4.5, out)).toBe(true);
    expect(out[0]).toBeCloseTo(45);
    expect(out[1]).toBeCloseTo(495.5);
    h.at(0, out);
    expect(out[0]).toBe(0);
    h.at(99_999, out);
    expect(out[0]).toBe(90);
    h.clear();
    expect(h.at(1000, out)).toBe(false);
  });

  it("keeps only the latest entries", () => {
    const h = createExitHistory(8);
    for (let i = 0; i < 100; i++) h.record(i, [i]);
    const out: number[] = [];
    h.at(10, out);
    expect(out[0]).toBe(92);
  });
});
