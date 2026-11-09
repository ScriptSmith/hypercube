import { describe, expect, it } from "vitest";
import { EARTH_TILT } from "../../../src/apps/orrery/astro";
import { createKeeper, type Keeper } from "../../../src/apps/orrery/keeper";
import {
  createLink,
  LEADER_GRACE_MS,
  type Link,
  STATE_SLOW_MS,
} from "../../../src/apps/orrery/link";
import {
  decodeClaim,
  decodeState,
  encodeClaim,
  encodeState,
  MAX_SKEW_MS,
  TOPIC,
} from "../../../src/apps/orrery/wire";
import { createBus, peer } from "./helpers";

const CLOCK = Date.UTC(2026, 9, 26, 2, 0);

describe("messages", () => {
  it("round-trip claims and states", () => {
    const c = encodeClaim("time", 9850.123456, 13.25, true, CLOCK - 100, CLOCK, false);
    expect(decodeClaim(c, CLOCK)).toEqual({
      knob: "time",
      a: 9850.12346,
      b: 13.25,
      held: true,
      since: CLOCK - 100,
      bot: false,
    });
    expect(
      decodeClaim(encodeClaim("tilt", 23.444, 0, false, CLOCK, CLOCK, true), CLOCK),
    ).toMatchObject({
      knob: "tilt",
      a: 23.44,
      bot: true,
    });
    expect(decodeClaim(encodeClaim("flat", 1, 0, false, CLOCK, CLOCK, false), CLOCK)?.a).toBe(1);
    expect(decodeClaim(encodeClaim("speed", 2, 0, false, CLOCK, CLOCK, false), CLOCK)?.a).toBe(2);
    const st = encodeState(
      {
        mode: "manual",
        sky: { day: 9000.5, hour: 23.99999, tilt: 45, flat: true, speed: 2 },
        quiet: 1234,
      },
      CLOCK,
    );
    const back = decodeState(st, CLOCK)!;
    expect(back.mode).toBe("manual");
    // An hour that rounds up to 24 becomes midnight of the next day.
    expect(back.sky).toEqual({ day: 9001.5, hour: 0, tilt: 45, flat: true, speed: 2 });
    expect(back.quiet).toBe(1234);
  });

  it("drop anything malformed or out of range", () => {
    const good = encodeClaim("tilt", 30, 0, true, CLOCK, CLOCK, false);
    const bad: unknown[] = [
      null,
      "x",
      [1, 2],
      { ...good, k: 9 },
      { ...good, k: 1.5 },
      { ...good, a: 91 },
      { ...good, a: Number.NaN },
      { ...good, a: "30" },
      { ...good, b: 3 },
      { ...good, on: 1 },
      { ...good, bot: "no" },
      { ...good, s: CLOCK + 5000 },
      { ...good, t: CLOCK + MAX_SKEW_MS + 1, s: CLOCK },
      { ...encodeClaim("time", 1, 25, true, CLOCK, CLOCK, false), b: 25 },
      { ...encodeClaim("time", 1e9, 2, true, CLOCK, CLOCK, false), a: 1e9 },
      { ...encodeClaim("flat", 1, 0, true, CLOCK, CLOCK, false), a: 0.5 },
      { ...encodeClaim("speed", 1, 0, true, CLOCK, CLOCK, false), a: 3 },
    ];
    for (const d of bad) expect(decodeClaim(d, CLOCK), JSON.stringify(d)).toBeNull();
    const st = encodeState(
      { mode: "tour", sky: { day: 1, hour: 2, tilt: 3, flat: false, speed: 1 }, quiet: 0 },
      CLOCK,
    );
    const badStates: unknown[] = [
      { ...st, m: 3 },
      { ...st, d: Infinity },
      { ...st, h: -1 },
      { ...st, i: 100 },
      { ...st, f: true },
      { ...st, p: 7 },
      { ...st, q: -5 },
      { ...st, t: CLOCK - MAX_SKEW_MS - 1 },
      { ...st, d: undefined },
    ];
    for (const d of badStates) expect(decodeState(d, CLOCK), JSON.stringify(d)).toBeNull();
    expect(decodeState(st, CLOCK)).not.toBeNull();
  });
});

describe("a bank's link", () => {
  const setup = (withScreen = true) => {
    const bus = createBus();
    let now = 0;
    const clock = () => CLOCK + now;
    const frames: { id: string; keeper: Keeper; link: Link }[] = [];
    const add = (id: string, kind: "screen" | "panel", pos: number) => {
      const net = bus.channel(peer(id, kind, pos));
      const keeper = createKeeper({ variant: "seasons", tilt: EARTH_TILT, speed: 1 });
      const link = createLink(net, {
        now: () => now,
        clock,
        onState: (s) => keeper.adopt(s, now),
        onClaim: (c) => keeper.hear({ ...c, at: now }),
      });
      frames.push({ id, keeper, link });
    };
    if (withScreen) add("scr", "screen", 0);
    for (let i = 0; i < 3; i++) add(`p${i}`, "panel", i);
    const tick = (ms: number) => {
      const end = now + ms;
      while (now < end) {
        now += 1000 / 60;
        for (const f of frames) {
          f.keeper.step(now, clock(), 1 / 60);
          f.link.tick(now, clock(), f.keeper);
        }
      }
    };
    return { bus, frames, tick, at: () => now, clock };
  };

  it("sends a frame's claims to the screen, which decides and tells everyone", () => {
    const { bus, frames, tick, at, clock } = setup();
    tick(500);
    const [scr, p0, p1, p2] = frames;
    expect(scr!.link.deciding(at())).toBe(true);
    expect(p1!.link.deciding(at())).toBe(false);
    expect(p1!.link.leader()).toBe("scr");
    // In the tour the screen speaks once a second.
    const tourStates = bus.sent.filter((m) => m.topic === TOPIC.state).length;
    expect(tourStates).toBeLessThanOrEqual(2);
    p1!.link.claim({ knob: "tilt", a: 60, b: 0, held: true, since: clock(), bot: false });
    tick(200);
    expect(scr!.keeper.mode).toBe("manual");
    expect(scr!.keeper.sky(clock()).tilt).toBe(60);
    for (const f of [p0, p1, p2]) {
      expect(f!.keeper.mode).toBe("manual");
      expect(f!.keeper.sky(clock()).tilt).toBe(60);
    }
    // Claims went only to the leader.
    expect(bus.sent.filter((m) => m.topic === TOPIC.claim).every((m) => m.to === "scr")).toBe(true);
    // A held claim repeats while held, and the state comes fast while it changes.
    const before = bus.sent.length;
    for (let i = 0; i < 10; i++) {
      p1!.link.claim({
        knob: "tilt",
        a: 60 + i,
        b: 0,
        held: true,
        since: clock() - 200,
        bot: false,
      });
      tick(70);
    }
    const states = bus.sent.slice(before).filter((m) => m.topic === TOPIC.state).length;
    expect(states).toBeGreaterThanOrEqual(8);
    expect(p2!.keeper.sky(clock()).tilt).toBe(69);
    p1!.link.claim({ knob: "tilt", a: 69, b: 0, held: false, since: clock() - 900, bot: false });
    tick(500);
    const mark = bus.sent.length;
    tick(STATE_SLOW_MS * 3);
    const quiet = bus.sent.slice(mark).filter((m) => m.topic === TOPIC.state).length;
    expect(quiet).toBeLessThanOrEqual(4);
  });

  it("lets the frames carry on, each from the last state, when the screen goes", () => {
    const { bus, frames, tick, at, clock } = setup();
    tick(300);
    const [, p0, p1] = frames;
    p0!.link.claim({ knob: "tilt", a: 50, b: 0, held: false, since: clock(), bot: false });
    tick(300);
    expect(p1!.keeper.sky(clock()).tilt).toBe(50);
    // The screen vanishes without leaving the roster at once.
    frames.shift();
    tick(LEADER_GRACE_MS + 200);
    expect(p1!.link.deciding(at())).toBe(true);
    expect(p1!.keeper.sky(clock()).tilt).toBe(50);
    // When the roster drops it, the leftmost frame leads and the others follow it again.
    bus.remove("scr");
    tick(1500);
    expect(p0!.link.leader()).toBeNull();
    expect(p1!.link.leader()).toBe("p0");
    expect(p1!.link.deciding(at())).toBe(false);
    p1!.link.claim({ knob: "tilt", a: 10, b: 0, held: false, since: clock(), bot: false });
    tick(300);
    expect(p0!.keeper.sky(clock()).tilt).toBe(10);
    expect(frames[2]!.keeper.sky(clock()).tilt).toBe(10);
  });

  it("ignores states from anyone but the leader, and claims at anyone but the leader", () => {
    const { bus, frames, tick, clock } = setup();
    tick(300);
    const [, p0, p1] = frames;
    const fake = bus.channel(peer("evil", "panel", 7));
    fake.send(
      TOPIC.state,
      encodeState(
        { mode: "manual", sky: { day: 1, hour: 1, tilt: 89, flat: false, speed: 1 }, quiet: 0 },
        clock(),
      ),
    );
    expect(p1!.keeper.sky(clock()).tilt).not.toBe(89);
    // A claim sent to a follower is dropped.
    fake.send(TOPIC.claim, encodeClaim("tilt", 77, 0, false, clock(), clock(), false), "p0");
    tick(100);
    expect(p0!.keeper.sky(clock()).tilt).not.toBe(77);
    // A stranger's claim at the leader counts only while it is in the roster.
    bus.remove("evil");
    const ghost = bus.channel(peer("ghost", "panel", 8));
    bus.peers = bus.peers.filter((p) => p.frame !== "ghost");
    ghost.send(TOPIC.claim, encodeClaim("tilt", 66, 0, false, clock(), clock(), false), "scr");
    tick(100);
    expect(frames[0]!.keeper.sky(clock()).tilt).not.toBe(66);
  });
});
