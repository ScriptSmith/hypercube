import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLUME_HZ } from "../../../src/apps/airflow/config";
import { createDownlink, createUplink } from "../../../src/apps/airflow/link";
import { encodeValues, TOPIC_PLUME } from "../../../src/apps/airflow/wire";
import { fakeNet, peer } from "./helpers";

const msg = (pos: number, t: number, auto = false) =>
  encodeValues(pos, [1, 1], [0, 0], [0, 0, 0, 0, 0, 0], t, auto);

describe("bank link", () => {
  let now = 0;
  beforeEach(() => {
    now = 10_000;
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends plumes only to the screen on its side, at most PLUME_HZ a second", () => {
    const net = fakeNet();
    const panel = net.channel(peer("p1", "station", 1));
    const up = createUplink(panel, 0);
    expect(up.due(now)).toBe(false);
    expect(up.screen()).toBeNull();
    const other = net.channel(peer("b-scr", "screen", 0, 1));
    const screen = net.channel(peer("scr", "screen"));
    const got: string[] = [];
    screen.on(TOPIC_PLUME, (_, from) => got.push(from));
    const wrong: string[] = [];
    other.on(TOPIC_PLUME, (_, from) => wrong.push(from));
    expect(up.screen()).toBe("scr");
    let sent = 0;
    for (let t = 0; t < 1000; t += 10) {
      if (up.due(now + t)) {
        up.send(msg(1, now + t));
        sent++;
      }
    }
    expect(sent).toBeGreaterThanOrEqual(PLUME_HZ - 1);
    expect(sent).toBeLessThanOrEqual(PLUME_HZ + 1);
    expect(got).toHaveLength(sent);
    expect(wrong).toHaveLength(0);
    net.setOnline(false);
    expect(up.due(now + 5000)).toBe(false);
  });

  it("keeps plumes from touch frames on its side, by position, and notes people", () => {
    const net = fakeNet();
    const screen = net.channel(peer("scr", "screen"));
    const a = net.channel(peer("p0", "station", 0));
    const b = net.channel(peer("p3", "station", 3));
    const far = net.channel(peer("q0", "station", 0, 1));
    const otherScreen = net.channel(peer("scr2", "screen", 0, 0));
    const down = createDownlink(screen, { side: 0, count: 4, now: () => now, clock: () => now });
    a.send(TOPIC_PLUME, msg(0, now, true), "scr");
    b.send(TOPIC_PLUME, msg(3, now), "scr");
    far.send(TOPIC_PLUME, msg(1, now), "scr");
    otherScreen.send(TOPIC_PLUME, msg(2, now), "scr");
    // A stale clock and junk are refused.
    a.send(TOPIC_PLUME, msg(0, now - 60_000), "scr");
    a.send(TOPIC_PLUME, { nonsense: true }, "scr");
    expect(down.heard).toBe(2);
    expect(down.slots.update(now, 0)).toEqual([0, 3]);
    expect(down.lastHuman).toBe(now);
    down.dispose();
    b.send(TOPIC_PLUME, msg(3, now), "scr");
    expect(down.heard).toBe(2);
  });
});
