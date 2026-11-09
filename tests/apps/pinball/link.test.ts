import { describe, expect, it } from "vitest";
import {
  BEACON_MS,
  createDownlink,
  createUplink,
  SCREEN_GRACE_MS,
} from "../../../src/apps/pinball/link";
import { TOPIC, type UpMsg } from "../../../src/apps/pinball/wire";
import { createBus } from "./helpers";

const upMsg = (t: number, i = 1): UpMsg => ({
  i,
  p: 0,
  h: 0,
  n: 1,
  u: 0.3,
  vx: 0,
  vy: -2000,
  c: 0,
  t,
});

const setup = () => {
  let t = 10_000;
  const bus = createBus();
  const screenCh = bus.join({ frame: "s", kind: "screen", role: "screen" });
  const tableCh = bus.join({ frame: "p0", kind: "panel", role: "station", pos: 0 });
  const got: { ups: UpMsg[]; downs: number[]; pts: number[]; gifts: number[] } = {
    ups: [],
    downs: [],
    pts: [],
    gifts: [],
  };
  const down = createDownlink(
    screenCh,
    { now: () => t, clock: () => t },
    { up: (m) => got.ups.push(m), score: () => {} },
  );
  const up = createUplink(tableCh, () => t, {
    down: (m) => got.downs.push(m.i),
    pts: (m) => got.pts.push(m.p[0]?.[1] ?? 0),
    gift: (m) => got.gifts.push(m.k),
  });
  return {
    bus,
    down,
    up,
    got,
    screenCh,
    advance(ms: number) {
      t += ms;
    },
    get t() {
      return t;
    },
  };
};

describe("pinball links", () => {
  it("finds the screen by its beacon and loses it when the beacons stop", () => {
    const w = setup();
    expect(w.up.screen()).toBeNull();
    expect(w.up.up(upMsg(w.t))).toBe(false);
    w.down.tick();
    expect(w.up.screen()).toBe("s");
    expect(w.up.up(upMsg(w.t))).toBe(true);
    expect(w.got.ups).toHaveLength(1);
    // Beacons every BEACON_MS keep it.
    for (let i = 0; i < 10; i++) {
      w.advance(BEACON_MS);
      w.down.tick();
    }
    expect(w.up.screen()).toBe("s");
    w.advance(SCREEN_GRACE_MS + 1);
    expect(w.up.screen()).toBeNull();
  });

  it("drops the screen at once when the room goes offline", () => {
    const w = setup();
    w.down.tick();
    expect(w.up.screen()).toBe("s");
    w.bus.online = false;
    expect(w.up.screen()).toBeNull();
  });

  it("takes balls and points only from the screen", () => {
    const w = setup();
    w.down.tick();
    const other = w.bus.join({ frame: "x", role: "station", pos: 1 });
    other.send(TOPIC.down, { i: 1, h: 0, c: 0, t: w.t }, "p0");
    other.send(TOPIC.pts, { p: [[0, 50]] }, "p0");
    // A beacon from a frame that isn't a screen doesn't count either.
    other.send(TOPIC.hi, {});
    expect(w.got.downs).toEqual([]);
    expect(w.got.pts).toEqual([]);
    w.down.down("p0", { i: 2, h: 0, c: 0, t: w.t });
    w.down.pts("p0", { p: [[0, 75]] });
    expect(w.got.downs).toEqual([2]);
    expect(w.got.pts).toEqual([75]);
  });

  it("refuses up messages far from the clock, and floods", () => {
    const w = setup();
    w.down.tick();
    w.up.up(upMsg(w.t - 7000));
    expect(w.got.ups).toHaveLength(0);
    for (let i = 0; i < 30; i++) w.up.up(upMsg(w.t, i));
    expect(w.got.ups.length).toBeLessThanOrEqual(10);
    w.advance(1000);
    w.up.up(upMsg(w.t, 99));
    expect(w.got.ups.at(-1)?.i).toBe(99);
  });

  it("holds up messages back when told to, for latency tests", async () => {
    const w = setup();
    w.down.tick();
    w.up.lag = 30;
    expect(w.up.up(upMsg(w.t))).toBe(true);
    expect(w.got.ups).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 60));
    expect(w.got.ups).toHaveLength(1);
    w.up.dispose();
  });
});
