import { describe, expect, it } from "vitest";
import { createConductor } from "../../../src/apps/loom/conductor";
import {
  BEACON_GRACE_MS,
  createFollow,
  createInbox,
  harmonicsOf,
  sendBeacon,
  sendState,
  STATE_GAP_MS,
} from "../../../src/apps/loom/link";
import { beaconFrom } from "../../../src/apps/loom/mirror";
import { TOPIC } from "../../../src/apps/loom/wire";
import { createRng } from "../../../src/core/rng";
import { createBus, peer } from "./helpers";

const beacon = (screen: boolean, side = 0) =>
  beaconFrom(createConductor({ n: 10, variant: "match", rng: createRng("l") }), side, screen);

describe("loom link", () => {
  it("follows the screen over any frame, and a frame further left over one further right", () => {
    const bus = createBus();
    let t = 0;
    const scr = bus.channel(peer("scr", "screen", 0));
    const p0 = bus.channel(peer("p0", "panel", 0));
    const p1 = bus.channel(peer("p1", "panel", 1));
    const p2 = bus.channel(peer("p2", "panel", 2));
    const f2 = createFollow(p2, { side: 0, pos: 2 }, () => t);
    expect(f2.followed()).toBeNull();
    sendBeacon(p1, beacon(false));
    expect(f2.followed()?.from).toBe("p1");
    sendBeacon(p0, beacon(false));
    expect(f2.followed()?.from).toBe("p0");
    sendBeacon(scr, beacon(true));
    expect(f2.followed()?.from).toBe("scr");
    expect(f2.followed()?.screen).toBe(true);
    // A frame further right is never followed.
    const f0 = createFollow(p0, { side: 0, pos: 0 }, () => t);
    sendBeacon(p1, beacon(false));
    expect(f0.followed()).toBeNull();
    // The screen falls silent: the frames are followed again, then nothing.
    t += BEACON_GRACE_MS + 1;
    sendBeacon(p0, beacon(false));
    expect(f2.followed()?.from).toBe("p0");
    t += BEACON_GRACE_MS + 1;
    expect(f2.followed()).toBeNull();
    expect(t - f2.lastBetter).toBeGreaterThanOrEqual(BEACON_GRACE_MS);
  });

  it("ignores beacons from frames not in the roster, from the other side, or claiming to be a screen", () => {
    const bus = createBus();
    const t = 0;
    const p2 = bus.channel(peer("p2", "panel", 2));
    const stranger = bus.channel(peer("x", "panel", 0));
    const other = bus.channel(peer("o", "screen", 0, { side: 1 }));
    const liar = bus.channel(peer("l", "panel", 1));
    const f = createFollow(p2, { side: 0, pos: 2 }, () => t);
    bus.peers = bus.peers.filter((p) => p.frame !== "x");
    sendBeacon(stranger, beacon(false));
    sendBeacon(other, beacon(true, 1));
    sendBeacon(other, beacon(true, 0));
    sendBeacon(liar, beacon(true));
    expect(f.followed()).toBeNull();
    // Garbage is dropped.
    liar.send(TOPIC.beacon, { s: 0, c: 0, v: "nope" });
    expect(f.followed()).toBeNull();
  });

  it("drops a followed frame that leaves the roster at once", () => {
    const bus = createBus();
    const scr = bus.channel(peer("scr", "screen", 0));
    const p1 = bus.channel(peer("p1", "panel", 1));
    const f = createFollow(p1, { side: 0, pos: 1 }, () => 0);
    sendBeacon(scr, beacon(true));
    expect(f.followed()?.from).toBe("scr");
    bus.remove("scr");
    expect(f.followed()).toBeNull();
  });

  it("numbers each frame's harmonics from its place in the bank", () => {
    expect(harmonicsOf(peer("a", "panel", 0))).toEqual({ first: 1, count: 1 });
    expect(harmonicsOf(peer("a", "panel", 9))).toEqual({ first: 10, count: 1 });
    expect(harmonicsOf(peer("a", "pair", 0))).toEqual({ first: 1, count: 2 });
    expect(harmonicsOf(peer("a", "pair", 4))).toEqual({ first: 9, count: 2 });
  });

  it("takes a frame's states only for its own harmonics, from the roster's position, rate limited", () => {
    const bus = createBus();
    let t = 0;
    const scr = bus.channel(peer("scr", "screen", 0));
    const p3 = bus.channel(peer("p3", "pair", 1));
    const got: [number, number][] = [];
    const inbox = createInbox(
      scr,
      { side: 0, frame: "scr" },
      () => t,
      (i, e) => got.push([i, e.a]),
    );
    // The pair at position 1 holds harmonics 3 and 4; it claims position 0 and harmonic 1 too.
    sendState(p3, "scr", {
      p: 0,
      h: [
        { k: 1, a: 10, ph: 0, f: 1 },
        { k: 3, a: 30, ph: 0, f: 1 },
        { k: 4, a: 40, ph: 0, f: 1 },
      ],
    });
    expect(got).toEqual([
      [2, 30],
      [3, 40],
    ]);
    expect(inbox.heardAt(2)).toBe(0);
    expect(inbox.heardAt(0)).toBe(Number.NEGATIVE_INFINITY);
    // Too soon after the last one: dropped.
    t += STATE_GAP_MS / 2;
    sendState(p3, "scr", { p: 1, h: [{ k: 3, a: 31, ph: 0, f: 1 }] });
    expect(got).toHaveLength(2);
    t += STATE_GAP_MS;
    sendState(p3, "scr", { p: 1, h: [{ k: 3, a: 32, ph: 0, f: 1 }] });
    expect(got.at(-1)).toEqual([2, 32]);
    // A screen's own or another side's frames can't set harmonics.
    const side1 = bus.channel(peer("q", "panel", 0, { side: 1 }));
    t += 100;
    sendState(side1, "scr", { p: 0, h: [{ k: 1, a: 99, ph: 0, f: 1 }] });
    expect(got.at(-1)).toEqual([2, 32]);
    inbox.dispose();
  });

  it("sends nothing while offline", () => {
    const bus = createBus();
    const a = bus.channel(peer("a", "panel", 0));
    bus.channel(peer("b", "screen", 0));
    bus.online = false;
    expect(sendState(a, "b", { p: 0, h: [{ k: 1, a: 0, ph: 0, f: 0 }] })).toBe(false);
    expect(sendBeacon(a, beacon(false))).toBe(false);
    expect(bus.sent).toHaveLength(0);
  });
});
