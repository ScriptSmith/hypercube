import { describe, expect, it } from "vitest";
import {
  createCutInbox,
  createCutSender,
  createShared,
  LINK,
  type Shared,
} from "../../../src/apps/fourd/link";
import { slowTurn } from "../../../src/apps/fourd/orient";
import {
  distance,
  identity,
  orthoError,
  planeTurn,
  mul,
  toPair,
} from "../../../src/apps/fourd/rot";
import { shapeOf } from "../../../src/apps/fourd/shapes";
import {
  decodeCut,
  decodeInput,
  decodeState,
  encodeCut,
  encodeInput,
  encodeQuat,
  encodeState,
  quantAngle,
  TOPIC,
  unquantAngle,
} from "../../../src/apps/fourd/wire";
import { createBus, peer } from "./helpers";

interface Clock {
  t: number;
}

const make = (n: number, screen: boolean) => {
  const bus = createBus();
  const time: Clock = { t: 1_000_000 };
  const now = () => time.t;
  const clock = () => time.t + 1.7e12;
  const frames: { id: string; shared: Shared }[] = [];
  if (screen) {
    const net = bus.channel(peer("scr", "screen", 0));
    frames.push({ id: "scr", shared: createShared({ net, pos: -1, dim: 4, clock, now }) });
  }
  for (let i = 0; i < n; i++) {
    const net = bus.channel(peer(`p${i}`, "panel", i));
    frames.push({ id: `p${i}`, shared: createShared({ net, pos: i, dim: 4, clock, now }) });
  }
  const step = (ms: number, every = 16) => {
    for (let k = 0; k < ms; k += every) {
      time.t += every;
      for (const f of frames) {
        f.shared.step();
        f.shared.orientation(identity());
      }
    }
  };
  return { bus, time, frames, step, clock };
};

const rotOf = (s: Shared) => s.orientation(identity());

describe("a bank's shared shape", () => {
  it("every frame shows the slow turn from the clock alone", () => {
    const { frames, step, clock } = make(3, true);
    step(500);
    const want = slowTurn(shapeOf("cube", 4), clock());
    for (const f of frames) {
      expect(f.shared.live).toBe(false);
      expect(distance(rotOf(f.shared), want)).toBeLessThan(1e-9);
    }
    expect(frames[0]!.shared.leading).toBe(true);
    expect(frames[1]!.shared.following).toBe(true);
  });

  it("a frame's dial turns the shape for everyone, at once on itself", () => {
    const { frames, step } = make(3, true);
    step(500);
    const p1 = frames[2]!.shared;
    const before = rotOf(p1);
    p1.turn(0, 0.5, true);
    // Shown at once on the frame that turned it.
    const now1 = rotOf(p1);
    const expectNow = mul(planeTurn(0, 3, 0.5), before);
    expect(distance(now1, expectNow)).toBeLessThan(0.02);
    step(400);
    const lead = rotOf(frames[0]!.shared);
    expect(frames[0]!.shared.live).toBe(true);
    for (const f of frames) {
      expect(f.shared.live).toBe(true);
      expect(distance(rotOf(f.shared), lead)).toBeLessThan(2e-3);
      expect(orthoError(rotOf(f.shared))).toBeLessThan(1e-9);
    }
    // Every input was applied and acknowledged.
    expect(p1.stats.pending).toBe(0);
    expect(frames[0]!.shared.stats.applied).toBeGreaterThan(0);
  });

  it("turns from two frames at once add up", () => {
    const { frames, step } = make(3, true);
    step(300);
    for (let i = 0; i < 20; i++) {
      frames[1]!.shared.turn(0, 0.02, true);
      frames[2]!.shared.turn(1, 0.03, true);
      step(32);
    }
    step(500);
    const lead = rotOf(frames[0]!.shared);
    for (const f of frames) expect(distance(rotOf(f.shared), lead)).toBeLessThan(2e-3);
  });

  it("a first button and a shape button go through the leader", () => {
    const { frames, step } = make(2, true);
    step(300);
    frames[1]!.shared.setFamily(2, true);
    // The frame shows its choice at once.
    expect(frames[1]!.shared.family).toBe(2);
    step(300);
    for (const f of frames) expect(f.shared.family).toBe(2);
    frames[2]!.shared.preset(0, true);
    step(LINK.stateGapMs * 40);
    const lead = rotOf(frames[0]!.shared);
    for (const f of frames) expect(distance(rotOf(f.shared), lead)).toBeLessThan(2e-3);
  });

  it("bots stand back for people", () => {
    const { frames, step } = make(2, true);
    step(300);
    frames[1]!.shared.turn(0, 0.3, true);
    step(300);
    const after = rotOf(frames[0]!.shared);
    frames[2]!.shared.turn(1, 0.8, false);
    step(300);
    expect(distance(rotOf(frames[0]!.shared), after)).toBeLessThan(1e-9);
    // Long after the person, a bot may turn it.
    step(LINK.botYieldMs + 100, 100);
    const later = rotOf(frames[0]!.shared);
    frames[2]!.shared.turn(1, 0.8, false);
    step(300);
    expect(distance(rotOf(frames[0]!.shared), later)).toBeGreaterThan(0.1);
  });

  it("goes back to the slow turn after a quiet spell", () => {
    const { frames, step, clock } = make(2, true);
    step(300);
    frames[1]!.shared.turn(0, 0.4, true);
    step(300);
    expect(frames[0]!.shared.live).toBe(true);
    step(LINK.liveIdleMs + LINK.rejoinMs + 500, 100);
    const want = slowTurn(shapeOf("cube", 4), clock());
    for (const f of frames) {
      expect(f.shared.live).toBe(false);
      expect(distance(rotOf(f.shared), want)).toBeLessThan(1e-6);
    }
  });

  it("when the screen goes, the leftmost frame carries on from where it was", () => {
    const { bus, frames, step } = make(3, true);
    step(300);
    frames[1]!.shared.turn(2, 0.7, true);
    step(400);
    const before = rotOf(frames[1]!.shared);
    bus.remove("scr");
    frames[0]!.shared.dispose();
    frames.shift();
    step(200);
    // The new leader starts from what it showed.
    expect(frames[0]!.shared.leading).toBe(true);
    expect(distance(rotOf(frames[0]!.shared), before)).toBeLessThan(2e-3);
    frames[1]!.shared.turn(0, 0.3, true);
    step(500);
    expect(distance(rotOf(frames[1]!.shared), rotOf(frames[0]!.shared))).toBeLessThan(2e-3);
  });

  it("a frame whose leader goes quiet carries on by itself", () => {
    const { bus, frames, step } = make(2, true);
    step(300);
    bus.online = false;
    step(LINK.quietMs + 200, 100);
    const p = frames[1]!.shared;
    expect(p.leading).toBe(true);
    const before = rotOf(p);
    p.turn(0, 0.5, true);
    expect(distance(rotOf(p), before)).toBeGreaterThan(0.1);
  });

  it("ignores state from anyone but the leader, and malformed messages", () => {
    const { bus, frames, step } = make(2, true);
    step(300);
    const p = frames[1]!.shared;
    const before = rotOf(p);
    const q = toPair(planeTurn(0, 3, 1));
    const bogus = encodeState({ m: 1, f: 3, r: encodeQuat(q.a, q.b), k: [] });
    bus.inject(TOPIC.state, bogus, "p1");
    bus.inject(TOPIC.state, { m: 1, f: 9, r: [], k: [] }, "scr");
    bus.inject(TOPIC.input, { s: -1, h: 1, d: 0, a: 100 }, "p0");
    bus.inject(TOPIC.input, { s: 1, h: 1, d: 0, a: 100, o: 1 }, "p0");
    expect(p.family).toBe(0);
    expect(distance(rotOf(p), before)).toBeLessThan(0.01);
    expect(frames[0]!.shared.stats.applied).toBe(0);
  });
});

describe("slices to the screen", () => {
  it("sends on change, at most 15 a second, with a heartbeat", () => {
    const bus = createBus();
    const scr = bus.channel(peer("scr", "screen", 0));
    const net = bus.channel(peer("p3", "panel", 3));
    let t = 0;
    const inbox = createCutInbox(scr, () => t);
    const send = createCutSender(net);
    send.tick({ p: 3, c: 100, f: 0 }, t);
    expect(inbox.get("p3")?.pos).toBe(3);
    expect(inbox.get("p3")?.t).toBeCloseTo(100 / 4096, 9);
    t += 10;
    send.tick({ p: 3, c: 200, f: 1 }, t);
    expect(send.sent).toBe(1);
    t += 70;
    send.tick({ p: 3, c: 200, f: 1 }, t);
    expect(send.sent).toBe(2);
    t += 100;
    send.tick({ p: 3, c: 200, f: 1 }, t);
    expect(send.sent).toBe(2);
    t += 2100;
    send.tick({ p: 3, c: 200, f: 1 }, t);
    expect(send.sent).toBe(3);
    // Stale after a while without word.
    t += 6000;
    expect(inbox.get("p3")).toBeUndefined();
    // Only from frames in the roster; never the message's own position.
    bus.inject(TOPIC.cut, { p: 9, c: 5, f: 0 }, "ghost");
    expect(inbox.get("ghost")).toBeUndefined();
  });
});

describe("wire", () => {
  it("round-trips every message and drops malformed ones", () => {
    const inputs = [
      { s: 5, h: 1, d: 2, a: -300 },
      { s: 6, h: 0, o: 3 },
      { s: 7, h: 1, f: 1 },
    ];
    for (const m of inputs) expect(decodeInput(encodeInput(m))).toEqual(m);
    for (const bad of [
      null,
      [],
      { s: 1, h: 1 },
      { s: 1, h: 2, o: 1 },
      { s: 1.5, h: 1, f: 1 },
      { s: 1, h: 1, d: 3, a: 0 },
      { s: 1, h: 1, d: 0, a: 1e9 },
      { s: 1, h: 1, o: 1, f: 1 },
    ]) {
      expect(decodeInput(bad)).toBeNull();
    }
    const q = toPair(planeTurn(1, 3, 0.7));
    const st = encodeState({ m: 1, f: 2, r: encodeQuat(q.a, q.b), k: [[3, 99]] });
    expect(decodeState(st)).toEqual(st);
    for (const bad of [
      { ...st, m: 2 },
      { ...st, r: st.r.slice(0, 7) },
      { ...st, r: [0, 0, 0, 0, 0, 0, 0, 0] },
      { ...st, k: [[64, 1]] },
      { ...st, k: Array.from({ length: 17 }, () => [1, 1]) },
      "state",
    ]) {
      expect(decodeState(bad)).toBeNull();
    }
    const cut = encodeCut({ p: 2, c: -4096, f: 5 });
    expect(decodeCut(cut)).toEqual(cut);
    expect(decodeCut({ p: 2, c: 5000, f: 0 })).toBeNull();
    expect(decodeCut({ p: -1, c: 0, f: 0 })).toBeNull();
    // Angles quantise within half a step and clamp to a turn.
    for (const a of [0.001, -1.2, 3])
      expect(Math.abs(unquantAngle(quantAngle(a)) - a)).toBeLessThan(Math.PI / 16384 + 1e-12);
    expect(unquantAngle(quantAngle(100))).toBeCloseTo(Math.PI * 2, 9);
  });
});
