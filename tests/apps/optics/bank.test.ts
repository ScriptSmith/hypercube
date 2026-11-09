import { describe, expect, it } from "vitest";
import {
  BANK_ALONE_MS,
  BANK_CHEER_MS,
  BANK_IDLE_ROUND_MS,
  BEAM_BEAT_MS,
  BEAM_EXPIRE_MS,
  LEADER_SETTLE_MS,
} from "../../../src/apps/optics/config";
import { createEdgeLink } from "../../../src/apps/optics/link";
import { type OwnState, type Round, createRounds } from "../../../src/apps/optics/rounds";
import { TOPIC } from "../../../src/apps/optics/wire";
import { createBus } from "./helpers";

const beam = { y: 0.5, a: 0, bits: 127, level: 1, hops: 0 };

describe("edge link", () => {
  it("sends light to the neighbour on that side, on change and every second", () => {
    const bus = createBus();
    const a = bus.join("a", { pos: 0 });
    const b = bus.join("b", { pos: 1 });
    bus.join("c", { pos: 2 });
    const la = createEdgeLink(a, { pos: 0, side: 0, now: bus.now });
    const lb = createEdgeLink(b, { pos: 1, side: 0, now: bus.now });
    let sent = 0;
    b.on(TOPIC.beam, () => sent++);
    expect(la.neighbours()).toEqual({ left: null, right: "b", screen: null });
    expect(lb.neighbours()).toEqual({ left: "a", right: "c", screen: null });
    la.setOut([], [beam], []);
    la.tick();
    expect(sent).toBe(1);
    expect(lb.incoming().left.length).toBe(1);
    // Nothing new: nothing sent until the heartbeat.
    bus.advance(200);
    la.tick();
    expect(sent).toBe(1);
    bus.advance(BEAM_BEAT_MS);
    la.tick();
    expect(sent).toBe(2);
    // A change goes out quickly, but not faster than 20 times a second.
    la.setOut([], [{ ...beam, y: 0.6 }], []);
    bus.advance(10);
    la.tick();
    expect(sent).toBe(2);
    bus.advance(50);
    la.tick();
    expect(sent).toBe(3);
    expect(lb.incoming().left[0]!.y).toBeCloseTo(0.6, 4);
  });

  it("forgets light two seconds after the neighbour stops sending", () => {
    const bus = createBus();
    const a = bus.join("a", { pos: 0 });
    const b = bus.join("b", { pos: 1 });
    const la = createEdgeLink(a, { pos: 0, side: 0, now: bus.now });
    const lb = createEdgeLink(b, { pos: 1, side: 0, now: bus.now });
    let changes = 0;
    lb.onChange(() => changes++);
    la.setOut([], [beam], []);
    la.tick();
    expect(lb.incoming().left.length).toBe(1);
    bus.leave("a");
    bus.advance(BEAM_EXPIRE_MS + 10);
    lb.tick();
    expect(lb.incoming().left.length).toBe(0);
    expect(changes).toBeGreaterThanOrEqual(2);
  });

  it("ignores light from frames that aren't its neighbours", () => {
    const bus = createBus();
    const a = bus.join("a", { pos: 0 });
    const c = bus.join("c", { pos: 2 });
    const la = createEdgeLink(a, { pos: 0, side: 0, now: bus.now });
    c.send(TOPIC.beam, { b: [[0.5, 0, 127, 1, 0]] }, "a");
    expect(la.incoming()).toEqual({ left: [], right: [] });
  });

  it("sends light leaving the top edge to the screen", () => {
    const bus = createBus();
    const a = bus.join("a", { pos: 0 });
    const s = bus.join("s", { role: "screen", kind: "screen" });
    let got: unknown = null;
    s.on(TOPIC.sky, (d) => (got = d));
    const la = createEdgeLink(a, { pos: 0, side: 0, now: bus.now });
    la.setOut([], [], [{ x: 0.4, a: -1.5, bits: 127, level: 0.5, guide: false }]);
    la.tick();
    expect(got).toEqual({ p: 0, s: 0, b: [[0.4, -1.5, 127, 0.5, 0]] });
  });
});

describe("rounds", () => {
  const setup = (n: number, opts: { screen?: boolean } = {}) => {
    const bus = createBus();
    const own: OwnState[] = Array.from({ length: n }, () => ({
      solved: false,
      real: false,
      idle: false,
    }));
    const seen: Round[][] = Array.from({ length: n }, () => []);
    const cheers: number[] = Array.from({ length: n }, () => 0);
    const frames = own.map((_, pos) => {
      const net = bus.join(`p${pos}`, { pos });
      return createRounds({
        net,
        now: bus.now,
        side: 0,
        count: n,
        rampLength: 5,
        start: 0,
        pos,
        own: () => own[pos]!,
        onRound: (r) => seen[pos]!.push(r),
        onCheer: () => cheers[pos]!++,
      });
    });
    let screenCheers = 0;
    const screen = opts.screen
      ? createRounds({
          net: bus.join("screen", { role: "screen", kind: "screen", pos: 0 }),
          now: bus.now,
          side: 0,
          count: n,
          rampLength: 5,
          start: 0,
          pos: -1,
          own: () => null,
          onRound: () => {},
          onCheer: () => screenCheers++,
        })
      : null;
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += 100) {
        bus.advance(100);
        screen?.tick();
        for (const f of frames) f.tick();
      }
    };
    return { bus, own, seen, cheers, frames, screen, run, screenCheers: () => screenCheers };
  };

  it("moves the whole bank on when real light reaches the last frame", () => {
    const b = setup(3, { screen: true });
    b.run(LEADER_SETTLE_MS + 1500);
    expect(b.screen!.leading).toBe(true);
    for (const f of b.frames) expect(f.leading).toBe(false);
    for (const o of b.own) o.solved = true;
    b.own[2]!.real = true;
    b.run(1500);
    expect(b.cheers).toEqual([1, 1, 1]);
    b.run(BANK_CHEER_MS + 1500);
    for (const f of b.frames) expect(f.round).toEqual({ serial: 1, level: 1 });
  });

  it("doesn't count a new round as through while the last round's light is still about", () => {
    const b = setup(2, { screen: true });
    b.run(LEADER_SETTLE_MS + 1500);
    b.screen!.skip();
    // Every frame still glows from the last round's light, for a moment.
    for (const o of b.own) Object.assign(o, { solved: true, real: true });
    b.run(1500);
    expect(b.cheers).toEqual([0, 0]);
    for (const o of b.own) Object.assign(o, { solved: false, real: false });
    b.run(5000);
    expect(b.frames[0]!.round.serial).toBe(1);
  });

  it("doesn't count stray light while a frame is still unsolved", () => {
    const b = setup(3, { screen: true });
    b.run(LEADER_SETTLE_MS + 1500);
    b.own[2]!.solved = true;
    b.own[2]!.real = true;
    b.run(5000);
    expect(b.cheers).toEqual([0, 0, 0]);
    expect(b.frames[0]!.round.serial).toBe(0);
  });

  it("moves on when every frame left is solved but one is missing", () => {
    const b = setup(3);
    b.run(LEADER_SETTLE_MS + 1500);
    b.bus.leave("p2");
    b.own[0]!.solved = true;
    b.own[1]!.solved = true;
    b.run(BANK_ALONE_MS + 2500);
    expect(b.cheers[0]).toBe(1);
    b.run(BANK_CHEER_MS + 1000);
    expect(b.frames[0]!.round.serial).toBe(1);
    expect(b.frames[1]!.round.serial).toBe(1);
  });

  it("goes back to the start of the ramp when every frame is idle", () => {
    const b = setup(2);
    b.run(LEADER_SETTLE_MS + 1500);
    b.frames[0]!.skip();
    b.frames[0]!.skip();
    b.run(1500);
    expect(b.frames[1]!.round).toEqual({ serial: 2, level: 2 });
    for (const o of b.own) o.idle = true;
    b.run(2500);
    expect(b.frames[1]!.round).toEqual({ serial: 3, level: 0 });
    // Once only, until someone plays again.
    b.run(5000);
    expect(b.frames[1]!.round.serial).toBe(3);
  });

  it("goes back to the start only once when the screen leads an idle bank", () => {
    const b = setup(3, { screen: true });
    b.run(LEADER_SETTLE_MS + 1500);
    b.screen!.skip();
    b.run(1500);
    for (const o of b.own) o.idle = true;
    b.run(20_000);
    expect(b.screen!.round).toEqual({ serial: 2, level: 0 });
    for (const f of b.frames) expect(f.round.serial).toBe(2);
    // Someone plays and leaves again: one more return to the start.
    b.own[1]!.idle = false;
    b.run(2000);
    b.own[1]!.idle = true;
    b.run(5000);
    expect(b.screen!.round.serial).toBe(3);
  });

  it("moves an idle bank on when its light doesn't get through", () => {
    const b = setup(3, { screen: true });
    b.run(LEADER_SETTLE_MS + 1500);
    for (const o of b.own) o.idle = true;
    b.run(2000);
    // The return to the start, then a new puzzle every few minutes.
    expect(b.screen!.round).toEqual({ serial: 1, level: 0 });
    b.own[0]!.solved = true;
    b.run(BANK_IDLE_ROUND_MS + 2000);
    expect(b.screen!.round).toEqual({ serial: 2, level: 1 });
    expect(b.cheers).toEqual([0, 0, 0]);
  });

  it("lets a new leader take up the round the bank is on", () => {
    const b = setup(3);
    b.run(LEADER_SETTLE_MS + 1500);
    b.frames[0]!.skip();
    b.frames[0]!.skip();
    b.frames[0]!.skip();
    b.run(1500);
    expect(b.frames[2]!.round.serial).toBe(3);
    // The leader goes; a fresh frame at position 0 would start over, but listens first.
    b.bus.leave("p0");
    b.frames[0]!.dispose();
    const fresh: Round[] = [];
    const again = createRounds({
      net: b.bus.join("p0b", { pos: 0 }),
      now: b.bus.now,
      side: 0,
      count: 3,
      rampLength: 5,
      start: 0,
      pos: 0,
      own: () => ({ solved: false, real: false, idle: false }),
      onRound: (r) => fresh.push(r),
      onCheer: () => {},
    });
    for (let t = 0; t < LEADER_SETTLE_MS + 3000; t += 100) {
      b.bus.advance(100);
      again.tick();
      b.frames[1]!.tick();
      b.frames[2]!.tick();
    }
    expect(again.round.serial).toBe(3);
    expect(b.frames[2]!.round.serial).toBe(3);
  });
});
