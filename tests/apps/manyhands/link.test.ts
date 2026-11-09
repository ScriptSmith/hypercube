import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILD_EVERY_MS, SCREEN_GRACE_MS } from "../../../src/apps/manyhands/config";
import { createDownlink, createUplink } from "../../../src/apps/manyhands/link";
import { type BuildMsg, type PartMsg, TOPIC } from "../../../src/apps/manyhands/wire";
import { createBus } from "./helpers";

const build: BuildMsg = {
  id: 1,
  theme: "rocket",
  total: 12,
  made: 0,
  start: 0,
  end: 150_000,
  phase: "building",
  orders: [0, 1, 2, 3],
  trophies: 0,
};
const part = (i: number, p = 0): PartMsg => ({
  i,
  p,
  w: 0,
  l: 0,
  k: 0,
  b: 1,
  c: 0,
  u: 0.5,
  t: 1000,
});

describe("bank links", () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const bus = createBus();
    const screenNet = bus.join({ frame: "s", kind: "screen", role: "screen" });
    const panelNet = bus.join({ frame: "p1", pos: 1 });
    const other = bus.join({ frame: "s2", kind: "screen", role: "screen", side: 1 });
    const parts: PartMsg[] = [];
    const down = createDownlink(screenNet, 0, () => now, {
      part: (m) => parts.push(m),
      beat: () => {},
    });
    const up = createUplink(panelNet, 0, () => now);
    return { bus, screenNet, panelNet, other, parts, down, up };
  };

  it("a panel hears its own side's screen through its builds", () => {
    const { down, up, other } = setup();
    expect(up.screen()).toBeNull();
    // A screen on the other side of a corner doesn't count.
    other.send(TOPIC.build, { bad: true });
    down.tick(() => build);
    expect(up.screen()).toBe("s");
    expect(up.build?.orders).toEqual([0, 1, 2, 3]);
  });

  it("sends the build about once a second and soon after a change", () => {
    const { bus, down } = setup();
    const count = () => bus.log.filter((m) => m.topic === TOPIC.build).length;
    down.tick(() => build);
    expect(count()).toBe(1);
    now = 100;
    down.tick(() => build);
    expect(count()).toBe(1);
    down.changed();
    now = 160;
    down.tick(() => build);
    expect(count()).toBe(2);
    now = 160 + BUILD_EVERY_MS;
    down.tick(() => build);
    expect(count()).toBe(3);
  });

  it("a panel gives up on a silent screen after the grace period", () => {
    const { down, up } = setup();
    down.tick(() => build);
    expect(up.screen()).toBe("s");
    // Keep looking (as the loop does) while the screen says nothing.
    let gone = -1;
    for (now = 0; now < 6000; now += 16) {
      if (up.screen() === null) {
        gone = now;
        break;
      }
    }
    expect(gone).toBeGreaterThan(SCREEN_GRACE_MS);
    expect(gone).toBeLessThan(3000);
  });

  it("a screen that leaves the roster is gone at once", () => {
    const { down, up, screenNet } = setup();
    down.tick(() => build);
    (screenNet as unknown as { leave(): void }).leave();
    expect(up.screen()).toBeNull();
  });

  it("parts go to the screen, only from frames below it, and at a bounded rate", () => {
    const { up, down, parts, other } = setup();
    expect(up.sendPart(part(1))).toBe(false);
    down.tick(() => build);
    expect(up.sendPart(part(2))).toBe(true);
    expect(parts.map((p) => p.i)).toEqual([2]);
    other.send(TOPIC.part, part(3), "s");
    expect(parts).toHaveLength(1);
    for (let i = 0; i < 40; i++) up.sendPart(part(10 + i));
    expect(parts.length).toBeLessThanOrEqual(13);
    expect(down.dropped).toBeGreaterThan(0);
    now += 2000;
    up.sendPart(part(100));
    expect(parts.at(-1)?.i).toBe(100);
  });

  it("holds parts back when asked to lag, without losing them", () => {
    const { up, down, parts } = setup();
    down.tick(() => build);
    up.lag = 300;
    up.sendPart(part(7));
    expect(parts).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(parts.map((p) => p.i)).toEqual([7]);
  });

  it("heartbeats reach the screen once a second", () => {
    const { bus, down, up } = setup();
    down.tick(() => build);
    const beats = () => bus.log.filter((m) => m.topic === TOPIC.beat).length;
    up.tick(() => ({ p: 1, s: 1, a: 2, g: 1 }));
    up.tick(() => ({ p: 1, s: 1, a: 2, g: 1 }));
    expect(beats()).toBe(1);
    now = 1000;
    down.tick(() => build);
    up.tick(() => ({ p: 1, s: 1, a: 2, g: 1 }));
    expect(beats()).toBe(2);
  });
});
