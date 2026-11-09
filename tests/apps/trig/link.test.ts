import { describe, expect, it } from "vitest";
import { DEG, TAU } from "../../../src/apps/trig/config";
import {
  ANGLE_GAP_MS,
  BEACON_GRACE_MS,
  createInbox,
  createWatch,
  sendAngle,
  sendBeacon,
  STALE_MS,
} from "../../../src/apps/trig/link";
import {
  decodeAngle,
  decodeBeacon,
  encodeAngle,
  FLAG,
  Q,
  quantAngle,
  TOPIC,
  unquantAngle,
} from "../../../src/apps/trig/wire";
import { createBus, peer } from "./helpers";

describe("trig messages", () => {
  it("round-trip an angle to within a tenth of a degree, a full turn included", () => {
    for (const d of [0, 0.04, 30, 89.97, 90, 179.5, 270, 359.96]) {
      const back = unquantAngle(quantAngle(d * DEG));
      expect(Math.abs(back - d * DEG) / DEG, `${d}°`).toBeLessThan(0.1);
    }
    expect(quantAngle(TAU)).toBe(Q);
    expect(quantAngle(-90 * DEG)).toBe(Q * 0.75);
    expect(quantAngle(Number.NaN)).toBe(0);
    const m = { p: 3, a: quantAngle(1), f: FLAG.own | FLAG.held, n: 10 };
    expect(decodeAngle(JSON.parse(JSON.stringify(encodeAngle(m))))).toEqual(m);
  });

  it("clamp what they send", () => {
    expect(encodeAngle({ p: 99, a: 99_999, f: 12, n: 0 })).toEqual({ p: 63, a: Q, f: 7, n: 1 });
  });

  it("drop anything malformed whole", () => {
    const good = { p: 1, a: 100, f: 1, n: 10 };
    expect(decodeAngle(good)).toEqual(good);
    for (const bad of [
      null,
      7,
      "x",
      [],
      { ...good, p: -1 },
      { ...good, p: 64 },
      { ...good, p: 1.5 },
      { ...good, a: Q + 1 },
      { ...good, a: "100" },
      { ...good, f: 8 },
      { ...good, n: 0 },
      { ...good, n: 65 },
      { p: 1, a: 100, f: 1 },
    ]) {
      expect(decodeAngle(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(decodeBeacon({ s: 1 })).toEqual({ s: 1 });
    for (const bad of [null, {}, { s: 2 }, { s: "0" }, [0]]) expect(decodeBeacon(bad)).toBeNull();
  });
});

describe("trig link", () => {
  it("lets a frame hear its screen's beacon, and forget it when it stops", () => {
    const bus = createBus();
    let t = 0;
    const scr = bus.channel(peer("scr", "screen", 0));
    const p2 = bus.channel(peer("p2", "panel", 2));
    const w = createWatch(p2, 0, () => t);
    expect(w.screen()).toBeNull();
    sendBeacon(scr, 0);
    expect(w.screen()).toBe("scr");
    t += BEACON_GRACE_MS + 1;
    expect(w.screen()).toBeNull();
    sendBeacon(scr, 0);
    expect(w.screen()).toBe("scr");
    // Gone from the roster: gone.
    bus.remove("scr");
    expect(w.screen()).toBeNull();
  });

  it("ignores beacons from the other side, from strangers, and from frames posing as screens", () => {
    const bus = createBus();
    const t = 0;
    const other = bus.channel(peer("o", "screen", 0, { side: 1 }));
    const liar = bus.channel(peer("l", "panel", 1));
    const stranger = bus.channel(peer("x", "screen", 0));
    const p2 = bus.channel(peer("p2", "panel", 2));
    bus.peers = bus.peers.filter((p) => p.frame !== "x");
    const w = createWatch(p2, 0, () => t);
    sendBeacon(other, 1);
    sendBeacon(other, 0);
    sendBeacon(liar, 0);
    sendBeacon(stranger, 0);
    expect(w.screen()).toBeNull();
  });

  it("gives the screen each frame's angle with its roster position, rate-limited", () => {
    const bus = createBus();
    let t = 1000;
    const scr = bus.channel(peer("scr", "screen", 0));
    const p4 = bus.channel(peer("p4", "panel", 4));
    const inbox = createInbox(scr, { side: 0, frame: "scr" }, () => t);
    // The message claims position 9; the roster says 4.
    expect(sendAngle(p4, "scr", { p: 9, a: quantAngle(1), f: FLAG.own | FLAG.held, n: 10 })).toBe(
      true,
    );
    const h = inbox.get("p4")!;
    expect(h.pos).toBe(4);
    expect(h.theta).toBeCloseTo(1, 2);
    expect(h.heldStart).toBe(1000);
    // Too soon after: dropped.
    t += ANGLE_GAP_MS - 1;
    sendAngle(p4, "scr", { p: 4, a: quantAngle(2), f: FLAG.own, n: 10 });
    expect(inbox.get("p4")!.theta).toBeCloseTo(1, 2);
    t += 2;
    sendAngle(p4, "scr", { p: 4, a: quantAngle(2), f: FLAG.own, n: 10 });
    expect(inbox.get("p4")!.theta).toBeCloseTo(2, 2);
    expect(inbox.get("p4")!.heldLast).toBe(1000);
    // A new press starts a new hold.
    t += 100;
    sendAngle(p4, "scr", { p: 4, a: quantAngle(2), f: FLAG.own | FLAG.held | FLAG.person, n: 10 });
    expect(inbox.get("p4")!.heldStart).toBe(t);
    expect(inbox.get("p4")!.personAt).toBe(t);
    expect(inbox.fresh().map((f) => f.frame)).toEqual(["p4"]);
    t += STALE_MS + 1;
    expect(inbox.fresh()).toEqual([]);
  });

  it("takes angles only from touch frames on its side that are in the roster", () => {
    const bus = createBus();
    const t = 0;
    const scr = bus.channel(peer("scr", "screen", 0));
    const otherSide = bus.channel(peer("b", "panel", 1, { side: 1 }));
    const screen2 = bus.channel(peer("s2", "screen", 0));
    const stranger = bus.channel(peer("x", "panel", 0));
    bus.peers = bus.peers.filter((p) => p.frame !== "x");
    const inbox = createInbox(scr, { side: 0, frame: "scr" }, () => t);
    const m = { p: 0, a: 10, f: 1, n: 10 };
    sendAngle(otherSide, "scr", m);
    sendAngle(screen2, "scr", m);
    sendAngle(stranger, "scr", m);
    screen2.send(TOPIC.angle, { p: 0, a: "bad" }, "scr");
    expect(inbox.fresh()).toEqual([]);
  });

  it("sends nothing while offline", () => {
    const bus = createBus();
    const a = bus.channel(peer("a", "panel", 0));
    bus.online = false;
    expect(sendAngle(a, "scr", { p: 0, a: 0, f: 0, n: 1 })).toBe(false);
    expect(sendBeacon(a, 0)).toBe(false);
    expect(bus.sent).toEqual([]);
  });
});
