import { describe, expect, it } from "vitest";
import {
  BEACON_GRACE_MS,
  BEACON_MS,
  createDownlink,
  createUplink,
  padsOn,
  SCREEN_PAD_GAP_MS,
  touchFrameWidth,
} from "../../../src/apps/fireworks/link";
import { SHAPE } from "../../../src/apps/fireworks/recipe";
import { encodeLaunch, type LaunchMsg, TOPIC } from "../../../src/apps/fireworks/wire";
import { createBus } from "./helpers";

const msg = (t: number, p = 0): LaunchMsg => ({
  p,
  n: 1,
  pos: 2,
  fw: 1080,
  fh: 1920,
  u: 0.5,
  d: 1530,
  a: 0,
  v: 3400,
  g: 420,
  c: 1,
  s: SHAPE.peony,
  z: 0.5,
  k: 9,
  t,
});

const world = () => {
  let t = 1000;
  const bus = createBus();
  const now = () => t;
  const screenA = bus.join({ frame: "sa", kind: "screen", role: "screen", side: 0 });
  const launches: string[] = [];
  const down = createDownlink(
    screenA,
    { side: 0, corner: true, count: () => 10, clock: now, now },
    {
      launch: (m, from) => launches.push(`${from}:${m.p}@${m.t}`),
      cross: () => {},
      spill: () => {},
      volley: () => {},
    },
  );
  const booms: number[] = [];
  const panelA = bus.join({ frame: "pa", side: 0, pos: 2 });
  const up = createUplink(panelA, 0, now, (m) => booms.push(m.p));
  return {
    bus,
    down,
    up,
    launches,
    booms,
    panelA,
    screenA,
    advance(ms: number) {
      t += ms;
    },
    /** Time passing while the frame keeps looking every update, as the app does. */
    wait(ms: number) {
      for (let left = ms; left > 0; left -= 33) {
        t += Math.min(33, left);
        up.screen();
      }
    },
    get t() {
      return t;
    },
  };
};

describe("fireworks links between frames", () => {
  it("finds the screen above by its beacons, and loses it when they stop", () => {
    const w = world();
    expect(w.up.screen()).toBeNull();
    w.down.tick();
    expect(w.up.screen()).toBe("sa");
    // A beacon is due only every BEACON_MS.
    w.wait(BEACON_MS / 2);
    w.down.tick();
    // Overdue, and gone a few looks later.
    w.wait(BEACON_GRACE_MS - BEACON_MS / 2 + 50);
    expect(w.up.screen()).toBe("sa");
    w.wait(400);
    expect(w.up.screen()).toBeNull();
    w.down.tick();
    expect(w.up.screen()).toBe("sa");
  });

  it("doesn't hold its own stalled event loop against the screen", () => {
    const w = world();
    w.down.tick();
    w.wait(300);
    // Nothing ran on this frame for three seconds, beacons included.
    w.advance(3000);
    expect(w.up.screen()).toBe("sa");
    w.wait(BEACON_GRACE_MS);
    expect(w.up.screen()).toBeNull();
  });

  it("forgets a screen the roster no longer lists, at once", () => {
    const w = world();
    w.down.tick();
    expect(w.up.screen()).toBe("sa");
    // The screen leaves the room cleanly: its beacons are recent, but it isn't listed.
    w.screenA.leave();
    expect(w.up.screen()).toBeNull();
  });

  it("holds on through a short hub change, but not a long one", () => {
    const w = world();
    w.down.tick();
    w.bus.online = false;
    // The frame looks every update, as the app does.
    let gone = -1;
    for (let ms = 0; ms <= BEACON_GRACE_MS + 2000; ms += 33) {
      if (gone < 0 && w.up.screen() === null) gone = ms;
      w.advance(33);
    }
    expect(gone).toBeGreaterThan(BEACON_GRACE_MS + 400);
    expect(gone).toBeLessThanOrEqual(BEACON_GRACE_MS + 900);
  });

  it("delivers launches from frames on its own side, one per pad per second", () => {
    const w = world();
    w.down.tick();
    expect(w.up.send(msg(w.t))).toBe(true);
    expect(w.launches).toEqual([`pa:0@${w.t}`]);
    // The same pad again too soon is dropped; another pad is fine.
    w.up.send(msg(w.t + SCREEN_PAD_GAP_MS / 2));
    w.panelA.send(TOPIC.launch, encodeLaunch({ ...msg(w.t + 100), p: 0, n: 2 }), "sa");
    expect(w.launches).toHaveLength(1);
    w.panelA.send(TOPIC.launch, encodeLaunch({ ...msg(w.t + 100), p: 1, n: 2 }), "sa");
    expect(w.launches).toHaveLength(2);
    // Stale launch times are refused.
    w.panelA.send(TOPIC.launch, encodeLaunch(msg(w.t - 60_000)), "sa");
    expect(w.launches).toHaveLength(2);
    // A frame on the other side of the corner can't launch into this screen.
    const other = w.bus.join({ frame: "pb", side: 1 });
    other.send(TOPIC.launch, encodeLaunch(msg(w.t)), "sa");
    expect(w.launches).toHaveLength(2);
  });

  it("echoes bursts only from the frame's own screen", () => {
    const w = world();
    w.down.tick();
    w.down.boom("pa", { p: 0, c: 2, u: 0.5 });
    expect(w.booms).toEqual([0]);
    const impostor = w.bus.join({ frame: "x", kind: "screen", role: "screen", side: 1 });
    impostor.send(TOPIC.boom, { p: 0, c: 2, u: 0.5 }, "pa");
    expect(w.booms).toEqual([0]);
  });

  it("knows the other corner screen by its beacons", () => {
    const w = world();
    expect(w.down.partner()).toBeNull();
    const sb = w.bus.join({ frame: "sb", kind: "screen", role: "screen", side: 1 });
    const now = () => w.t;
    const downB = createDownlink(
      sb,
      { side: 1, corner: true, count: () => 10, clock: now, now },
      { launch: () => {}, cross: () => {}, spill: () => {}, volley: () => {} },
    );
    downB.tick();
    expect(w.down.partner()).toBe("sb");
    // A screen on the same side is never the partner, and never the frame's screen either.
    expect(w.up.screen()).toBeNull();
  });

  it("counts two pads on a merged pair", () => {
    expect(padsOn([], 10)).toBe(10);
    expect(
      padsOn(
        [
          { frame: "a", app: "fireworks", group: "g", kind: "pair", role: "station", pos: 0 },
          { frame: "b", app: "fireworks", group: "g", kind: "pair", role: "station", pos: 1 },
        ],
        2,
      ),
    ).toBe(4);
    expect(
      padsOn(
        [
          {
            frame: "a",
            app: "fireworks",
            group: "g",
            kind: "pair",
            role: "station",
            pos: 0,
            span: 3,
          },
        ],
        1,
      ),
    ).toBe(3);
    expect(
      touchFrameWidth([
        {
          frame: "a",
          app: "fireworks",
          group: "g",
          kind: "pair",
          role: "station",
          pos: 0,
          span: 3,
        },
      ]),
    ).toBe(3 * 1080);
  });
});
