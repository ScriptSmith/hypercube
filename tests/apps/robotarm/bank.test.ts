import { describe, expect, it } from "vitest";
import { BLOCK, benchFor, LIFT } from "../../../src/apps/robotarm/bench";
import {
  ARC_S,
  createBuild,
  DONE_S,
  ENTER_S,
  LEAVE_S,
  MAX_FLIGHTS,
  MAX_HOPPER,
  RISE_S,
} from "../../../src/apps/robotarm/build";
import {
  createDownlink,
  createUplink,
  NEED_GRACE_MS,
  NEED_MS,
} from "../../../src/apps/robotarm/link";
import { quatFromMat, rotY, v3 } from "../../../src/apps/robotarm/math";
import { PICTURE_DEFS, PICTURES } from "../../../src/apps/robotarm/pictures";
import { BENCH_ID, createTable, LIFT_ID } from "../../../src/apps/robotarm/pieces";
import { decodeNeed, decodeUp, encodeNeed, encodeUp, TOPIC } from "../../../src/apps/robotarm/wire";
import { createRng } from "../../../src/core/rng";
import type { Channel, PeerInfo } from "../../../src/core/types";
import { DT, rig } from "./helpers";

/** Run a build until `until` holds or `seconds` pass. */
const runBuild = (b: ReturnType<typeof createBuild>, seconds: number, until?: () => boolean) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    b.step(DT);
    if (until?.()) return true;
  }
  return false;
};

/** Fill every square of the current picture, a batch at a time as the air allows. */
const fillAll = (b: ReturnType<typeof createBuild>) => {
  for (let round = 0; round < 10 && b.phase === "build"; round++) {
    const needs = b.needs();
    needs.forEach((n, c) => {
      for (let i = 0; i < n && b.flights.length < MAX_FLIGHTS; i++) b.arrive(c, 0, 0, 0.5, false);
    });
    runBuild(b, RISE_S + ARC_S + 0.2, () => b.flights.length === 0 || b.phase !== "build");
  }
};

describe("robotarm pictures", () => {
  it("are rectangular pixel art in the three piece colours, big but not too big", () => {
    expect(PICTURES.length).toBeGreaterThanOrEqual(4);
    for (const def of PICTURE_DEFS) {
      const w = def.rows[0]!.length;
      for (const r of def.rows) {
        expect(r.length, def.name).toBe(w);
        expect(r).toMatch(/^[BYP.]+$/);
      }
    }
    for (const p of PICTURES) {
      expect(p.cells.length, p.name).toBeGreaterThanOrEqual(40);
      expect(p.cells.length, p.name).toBeLessThanOrEqual(90);
      expect(new Set(p.cells.map((c) => c.color)).size, p.name).toBe(3);
      // Build order runs from the bottom row up.
      for (let i = 1; i < p.cells.length; i++) {
        expect(p.cells[i]!.y).toBeLessThanOrEqual(p.cells[i - 1]!.y);
      }
    }
  });
});

describe("robotarm build", () => {
  it("fills the next empty square of each piece's colour, bottom up", () => {
    const b = createBuild(0);
    const pic = b.picture;
    const firstBlue = pic.cells.findIndex((c) => c.color === 0);
    const f = b.arrive(0, 0, 3, 0.5, true)!;
    expect(f.cell).toBe(firstBlue);
    const before = b.needs();
    expect(before[0]).toBe(pic.cells.filter((c) => c.color === 0).length - 1);
    runBuild(b, RISE_S + ARC_S + 0.1);
    expect(b.filled[firstBlue]).toBe(true);
    expect(b.counts.placed).toBe(1);
    expect(b.events.some((e) => e.type === "placed" && e.cell === firstBlue && e.human)).toBe(true);
    // The next blue goes to the next blue square.
    const g = b.arrive(0, 1, 0, 0.5, false)!;
    const secondBlue = pic.cells.findIndex((c, i) => c.color === 0 && i > firstBlue);
    expect(g.cell).toBe(secondBlue);
  });

  it("fizzles a piece whose colour the picture no longer wants", () => {
    const b = createBuild(0);
    const n = b.needs()[1];
    for (let i = 0; i < n; i++) b.arrive(1, 0, 0, 0.5, false);
    expect(b.needs()[1]).toBe(0);
    const spare = b.arrive(1, 0, 2, 0.5, false)!;
    expect(spare.cell).toBeNull();
    runBuild(b, RISE_S + 0.1);
    expect(b.counts.fizzled).toBe(1);
    expect(b.flights.some((f) => f.id === spare.id)).toBe(false);
  });

  it("completes, celebrates, leaves and starts the next picture", () => {
    const b = createBuild(2);
    const first = b.index;
    fillAll(b);
    expect(b.progress()).toBe(1);
    expect(b.phase).toBe("done");
    expect(b.counts.pictures).toBe(1);
    // Pieces arriving now wait for the next picture.
    const waiting = b.arrive(2, 0, 1, 0.5, true)!;
    expect(waiting.waiting).toBe(true);
    runBuild(b, DONE_S + LEAVE_S + 0.1);
    expect(b.phase).toBe("enter");
    expect(b.index).toBe((first + 1) % PICTURES.length);
    expect(b.progress()).toBe(0);
    runBuild(b, ENTER_S + 0.05);
    expect(b.phase).toBe("build");
    expect(waiting.waiting).toBe(false);
    expect(waiting.cell).not.toBeNull();
    runBuild(b, ARC_S + 0.3);
    expect(b.counts.placed).toBe(PICTURES[first]!.cells.length + 1);
  });

  it("bounds the flights in the air and the hopper", () => {
    const b = createBuild(0);
    for (let i = 0; i < MAX_FLIGHTS + 10; i++) b.arrive(i % 3, 0, 0, 0.5, false);
    expect(b.flights.length).toBe(MAX_FLIGHTS);
    expect(b.counts.dropped).toBe(10);
    const c = createBuild(1);
    fillAll(c);
    expect(c.phase).toBe("done");
    for (let i = 0; i < MAX_HOPPER + 5; i++) c.arrive(0, 0, 0, 0.5, false);
    expect(c.flights.filter((f) => f.waiting).length).toBe(MAX_HOPPER);
    runBuild(c, RISE_S + 0.1);
    // The ones with no room in the hopper fizzled.
    expect(c.counts.fizzled).toBe(5);
  });

  it("starts over, or moves on, when told", () => {
    const b = createBuild(0);
    b.arrive(0, 0, 0, 0.5, false);
    runBuild(b, RISE_S + ARC_S + 0.1);
    expect(b.progress()).toBeGreaterThan(0);
    b.arrive(1, 0, 0, 0.5, false);
    b.restart();
    expect(b.progress()).toBe(0);
    expect(b.flights.length).toBe(0);
    expect(b.phase).toBe("build");
    b.skip();
    expect(b.index).toBe(1);
    expect(b.phase).toBe("enter");
  });

  it("counts what the next picture wants while between pictures", () => {
    const b = createBuild(0);
    fillAll(b);
    expect(b.phase).toBe("done");
    const next = PICTURES[1]!;
    const want = [0, 1, 2].map((c) => next.cells.filter((x) => x.color === c).length);
    expect(b.needs()).toEqual(want);
    b.arrive(0, 0, 0, 0.5, false);
    expect(b.needs()[0]).toBe(want[0]! - 1);
  });
});

describe("robotarm wire", () => {
  it("round-trips and clamps messages", () => {
    const up = encodeUp({ c: 2, k: 1, p: 7, u: 512.4, h: 1 });
    expect(decodeUp(JSON.parse(JSON.stringify(up)))).toEqual({ c: 2, k: 1, p: 7, u: 512, h: 1 });
    expect(encodeUp({ c: 0, k: 0, p: 99, u: 2000, h: 0 })).toEqual({
      c: 0,
      k: 0,
      p: 63,
      u: 1000,
      h: 0,
    });
    const need = encodeNeed({ s: 0, n: [3, 0, 12.2], pic: 4, f: 41.6 });
    expect(decodeNeed(JSON.parse(JSON.stringify(need)))).toEqual({
      s: 0,
      n: [3, 0, 12],
      pic: 4,
      f: 42,
    });
  });

  it("drops anything malformed whole", () => {
    const bad: unknown[] = [
      null,
      7,
      "up",
      [],
      { c: 3, k: 0, p: 0, u: 0, h: 0 },
      { c: 0, k: 2, p: 0, u: 0, h: 0 },
      { c: 0, k: 0, p: -1, u: 0, h: 0 },
      { c: 0, k: 0, p: 0, u: 1001, h: 0 },
      { c: 0, k: 0, p: 0, u: 0.5, h: 0 },
      { c: 0, k: 0, p: 0, u: 0, h: true },
      { c: 0, k: 0, p: 0, u: 0 },
    ];
    for (const d of bad) expect(decodeUp(d), JSON.stringify(d)).toBeNull();
    const badNeed: unknown[] = [
      { s: 0, n: [1, 2], pic: 0, f: 0 },
      { s: 2, n: [1, 2, 3], pic: 0, f: 0 },
      { s: 0, n: [1, 2, -3], pic: 0, f: 0 },
      { s: 0, n: [1, 2, 3], pic: 64, f: 0 },
      { s: 0, n: [1, 2, 3], pic: 0, f: 101 },
      { s: 0, n: "123", pic: 0, f: 0 },
    ];
    for (const d of badNeed) expect(decodeNeed(d), JSON.stringify(d)).toBeNull();
  });
});

/** Channels that deliver to each other at once, as JSON would, with a shared roster. */
const fakeNet = () => {
  const peers: PeerInfo[] = [];
  const handlers = new Map<string, Map<string, Set<(data: unknown, from: string) => void>>>();
  let online = true;
  const channel = (info: PeerInfo): Channel => {
    peers.push(info);
    handlers.set(info.frame, new Map());
    return {
      get online() {
        return online;
      },
      self: info.frame,
      peers: () => peers,
      leader: () => null,
      send(topic, data, to) {
        if (!online) return;
        for (const [frame, topics] of handlers) {
          if (frame === info.frame || (to !== undefined && to !== frame)) continue;
          for (const cb of topics.get(topic) ?? [])
            cb(JSON.parse(JSON.stringify(data)), info.frame);
        }
      },
      on(topic, cb) {
        const topics = handlers.get(info.frame)!;
        let set = topics.get(topic);
        if (!set) topics.set(topic, (set = new Set()));
        set.add(cb);
        return () => set.delete(cb);
      },
      onPeers: () => () => {},
    };
  };
  return {
    channel,
    peers,
    /** Raw send as any frame, for hostile messages. */
    inject(from: string, topic: string, data: unknown) {
      for (const [frame, topics] of handlers) {
        if (frame === from) continue;
        for (const cb of topics.get(topic) ?? []) cb(data, from);
      }
    },
    remove(frame: string) {
      const i = peers.findIndex((p) => p.frame === frame);
      if (i >= 0) peers.splice(i, 1);
      handlers.delete(frame);
    },
    setOnline(v: boolean) {
      online = v;
    },
  };
};

const peer = (frame: string, role: PeerInfo["role"], pos = 0): PeerInfo => ({
  frame,
  app: "robotarm",
  group: "main",
  kind: role === "screen" ? "screen" : "panel",
  role,
  pos,
  side: 0,
});

describe("robotarm bank link", () => {
  const setup = () => {
    const net = fakeNet();
    let now = 0;
    const clock = () => now;
    const screenCh = net.channel(peer("s", "screen"));
    const arrived: { c: number; column: number; columns: number; h: number }[] = [];
    const down = createDownlink(
      screenCh,
      { side: 0, count: () => 4, now: clock },
      (m, column, columns) => arrived.push({ c: m.c, column, columns, h: m.h }),
    );
    const frames = [0, 1, 2, 3].map((pos) => {
      const ch = net.channel(peer(`p${pos}`, "station", pos));
      return createUplink(ch, 0, clock);
    });
    return {
      net,
      down,
      frames,
      arrived,
      tick(ms: number, needs: [number, number, number] = [2, 3, 4]) {
        now += ms;
        down.tick({ n: needs, pic: 1, f: 10 });
      },
    };
  };

  it("shows the lift only while the screen's word keeps coming, and passes pieces up", () => {
    const b = setup();
    expect(b.frames[2]!.screen()).toBeNull();
    expect(b.frames[2]!.needs()).toBeNull();
    b.tick(NEED_MS);
    expect(b.frames[2]!.screen()).toBe("s");
    expect(b.frames[2]!.needs()).toEqual([2, 3, 4]);
    expect(b.frames[2]!.send({ c: 1, k: 0, p: 99, u: 400, h: 1 })).toBe(true);
    // The roster's position wins over the message's.
    expect(b.arrived).toEqual([{ c: 1, column: 2, columns: 4, h: 1 }]);
    // The screen goes quiet: the lift falls back after the grace period.
    b.net.remove("s");
    expect(b.frames[2]!.screen()).toBeNull();
    expect(b.frames[2]!.send({ c: 1, k: 0, p: 2, u: 400, h: 0 })).toBe(false);
  });

  it("forgets a screen that stops sending, but rides out a short gap between hubs", () => {
    const b = setup();
    b.tick(NEED_MS);
    const up = b.frames[0]!;
    expect(up.screen()).toBe("s");
    b.net.setOnline(false);
    // Offline: the screen's word stands a little longer than usual.
    b.tick(NEED_GRACE_MS + 500);
    expect(up.screen()).toBe("s");
    b.net.setOnline(true);
    expect(up.screen()).toBeNull();
    b.tick(NEED_MS);
    expect(up.screen()).toBe("s");
  });

  it("refuses pieces too close together from one frame, from screens and from strangers", () => {
    const b = setup();
    b.tick(NEED_MS);
    b.frames[1]!.send({ c: 0, k: 0, p: 1, u: 500, h: 0 });
    b.frames[1]!.send({ c: 0, k: 0, p: 1, u: 500, h: 0 });
    expect(b.arrived.length).toBe(1);
    b.tick(1000);
    b.frames[1]!.send({ c: 0, k: 0, p: 1, u: 500, h: 0 });
    expect(b.arrived.length).toBe(2);
    b.net.inject("stranger", TOPIC.up, { c: 0, k: 0, p: 0, u: 0, h: 0 });
    b.net.inject("p3", TOPIC.up, { c: 9, k: 0, p: 3, u: 0, h: 0 });
    b.net.inject("p3", TOPIC.up, "nonsense");
    expect(b.arrived.length).toBe(2);
    // A frame's need beacon is ignored: only screens are listened to.
    b.net.inject("p0", TOPIC.need, { s: 0, n: [9, 9, 9], pic: 0, f: 0 });
    expect(b.frames[2]!.needs()).toEqual([2, 3, 4]);
  });
});

describe("robotarm beam reports", () => {
  it("reach the screen from the frames below it only, a little apart at most", () => {
    const net = fakeNet();
    let now = 0;
    const clock = () => now;
    const screenCh = net.channel(peer("s", "screen"));
    const exits: { column: number; u: number; w: number }[] = [];
    const down = createDownlink(
      screenCh,
      { side: 0, count: () => 4, now: clock },
      () => {},
      (column, u, w) => exits.push({ column, u, w }),
    );
    const up = createUplink(net.channel(peer("p2", "station", 2)), 0, clock);
    expect(up.sendExit({ p: 2, u: 600, w: 100 })).toBe(false);
    now += NEED_MS;
    down.tick({ n: [1, 1, 1], pic: 0, f: 0 });
    expect(up.sendExit({ p: 9, u: 600, w: 100 })).toBe(true);
    expect(exits).toEqual([{ column: 2, u: 0.6, w: 0.1 }]);
    // Too soon after the last one: dropped. A little later: taken.
    up.sendExit({ p: 2, u: 610, w: 100 });
    expect(exits.length).toBe(1);
    now += 200;
    up.sendExit({ p: 2, u: 620, w: 100 });
    expect(exits.at(-1)).toEqual({ column: 2, u: 0.62, w: 0.1 });
    net.inject("stranger", TOPIC.exit, { p: 0, u: 500, w: 100 });
    net.inject("s", TOPIC.exit, { p: 0, u: 500, w: 100 });
    net.inject("p2", TOPIC.exit, { p: 2, u: 500, w: 9999 });
    expect(exits.length).toBe(2);
  });
});

describe("robotarm lift", () => {
  const liftTable = () => createTable(benchFor("tidy", true), createRng("lift"));

  it("is only on a bank's benches, clear of the bins and the base", () => {
    expect(benchFor("tidy").lift).toBeNull();
    const bench = benchFor("tidy", true);
    expect(bench.lift).toEqual({ ...LIFT });
    for (const s of bench.slots)
      expect(Math.hypot(s.x - LIFT.x, s.z - LIFT.z)).toBeGreaterThan(LIFT.r + 0.3);
    expect(Math.hypot(LIFT.x, LIFT.z)).toBeGreaterThan(LIFT.r + 0.6);
  });

  it("sends up a piece put on it while the screen is there, and a new piece arrives", () => {
    const t = liftTable();
    t.setLift(true, [1, 1, 1]);
    const p = t.pieces.find((x) => x.kind === "block")!;
    t.take(p.id);
    p.pos = v3(LIFT.x, 0.6, LIFT.z);
    p.quat = quatFromMat(rotY(0.2));
    t.release(p.id);
    let lifted = false;
    for (let i = 0; i < 120 && !lifted; i++) {
      t.step(DT);
      lifted = t.events.some((e) => e.type === "lifted" && e.piece === p.id);
    }
    expect(lifted).toBe(true);
    expect(t.counts.sent).toBe(1);
    expect(p.state).toBe("up");
    for (let i = 0; i < 60; i++) t.step(DT);
    expect(p.pos.y).toBeGreaterThan(3);
    for (let i = 0; i < 180; i++) t.step(DT);
    expect(p.state).toBe("rest");
    expect(Math.hypot(p.pos.x - LIFT.x, p.pos.z - LIFT.z)).toBeGreaterThan(1);
  });

  it("is plain bench while the screen is away, and lets pieces on it settle when it stops", () => {
    const t = liftTable();
    const p = t.pieces.find((x) => x.kind === "ball")!;
    t.take(p.id);
    p.pos = v3(LIFT.x, 0.8, LIFT.z);
    t.release(p.id);
    for (let i = 0; i < 180; i++) t.step(DT);
    expect(p.state).toBe("rest");
    expect(p.support).toBe(BENCH_ID);
    expect(t.counts.sent).toBe(0);
    // Back on, a piece lands on it; the screen leaves before it goes up: it settles.
    t.setLift(true, [1, 1, 1]);
    const q = t.pieces.find((x) => x.kind === "block")!;
    t.take(q.id);
    q.pos = v3(LIFT.x, 0.5, LIFT.z);
    t.release(q.id);
    for (let i = 0; i < 20; i++) t.step(DT);
    expect(q.support).toBe(LIFT_ID);
    t.setLift(false, [0, 0, 0]);
    for (let i = 0; i < 120; i++) t.step(DT);
    expect(q.state).toBe("rest");
    expect(q.support).not.toBe(LIFT_ID);
    expect(q.pos.y).toBeLessThan(BLOCK);
    expect(t.counts.sent).toBe(0);
  });
});

describe("robotarm autopilot on a bank", () => {
  it("sends wanted colours up the lift, and nothing while the screen is away", () => {
    const r = rig("tidy", "bank", { lift: true });
    r.cell.table.setLift(true, [9, 9, 9]);
    r.run(60);
    expect(r.cell.counts.sent).toBeGreaterThanOrEqual(3);
    const off = rig("tidy", "bank2", { lift: true });
    off.run(40);
    expect(off.cell.counts.sent).toBe(0);
    expect(off.cell.counts.sorted).toBeGreaterThanOrEqual(2);
  });

  it("puts colours the screen doesn't want in their bins", () => {
    const r = rig("tidy", "bank3", { lift: true });
    r.cell.table.setLift(true, [0, 0, 0]);
    r.run(40);
    expect(r.cell.counts.sent).toBe(0);
    expect(r.cell.counts.sorted).toBeGreaterThanOrEqual(2);
  });

  it("sends one piece in three up when demonstrating", () => {
    const r = rig("tidy", "bank4", { lift: true, liftEvery: 3 });
    r.cell.table.setLift(true, [9, 9, 9]);
    r.run(150);
    const total = r.cell.counts.sent + r.cell.counts.sorted;
    expect(r.cell.counts.sent).toBeGreaterThanOrEqual(2);
    expect(r.cell.counts.sent).toBeLessThanOrEqual(Math.ceil(total / 3) + 1);
  });
});
