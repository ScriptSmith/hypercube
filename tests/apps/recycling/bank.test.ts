import { describe, expect, it } from "vitest";
import { ITEMS } from "../../../src/apps/recycling/items";
import { inletsFor } from "../../../src/apps/recycling/layout";
import {
  BEACON_GRACE_MS,
  BEACON_MS,
  createDownlink,
  createUplink,
  RATE,
} from "../../../src/apps/recycling/link";
import { fallAt, fallTimeTo } from "../../../src/apps/recycling/physics";
import {
  ALONE_MS,
  type ColumnInfo,
  createPlant,
  FALL_FROM,
  MAX_FLIGHTS,
  MAX_JOBS,
  MAX_RISING,
  type PlantModel,
} from "../../../src/apps/recycling/plant";
import {
  decodeBeacon,
  decodeDrop,
  decodeFull,
  decodeLoad,
  decodeSorted,
  type DropMsg,
  encodeDrop,
  encodeFull,
  TOPIC,
} from "../../../src/apps/recycling/wire";
import { createRng } from "../../../src/core/rng";
import type { FrameKind } from "../../../src/core/types";
import { createBus, DT, run, worldOf } from "./helpers";

const drop = (o: Partial<DropMsg> = {}): DropMsg => ({
  i: 0,
  u: 278,
  k: 3,
  id: 17,
  t0: 1_000_000,
  y0: FALL_FROM,
  vy: 90,
  g: 2400,
  tau: 0.45,
  a: 0.5,
  w: 1.2,
  ...o,
});

describe("recycling messages", () => {
  it("round-trip, and anything out of range is dropped whole", () => {
    expect(decodeDrop(encodeDrop(drop()))).toEqual(drop());
    expect(decodeDrop({ ...drop(), k: ITEMS.length })).toBeNull();
    expect(decodeDrop({ ...drop(), i: 9 })).toBeNull();
    expect(decodeDrop({ ...drop(), t0: Number.NaN })).toBeNull();
    expect(decodeDrop({ ...drop(), y0: -5 })).toBeNull();
    expect(decodeDrop({ ...drop(), tau: 0 })).toBeNull();
    expect(decodeDrop({ ...drop(), i: 0.5 })).toBeNull();
    expect(decodeDrop("drop")).toBeNull();
    expect(decodeDrop([1, 2])).toBeNull();
    const full = { b: 2, m: -1, u: 400, w: 300, h: 435, t: 12345, v: 1050 };
    expect(decodeFull(encodeFull(full))).toEqual(full);
    expect(decodeFull({ ...full, m: 7 })).toBeNull();
    expect(decodeFull({ ...full, b: 4 })).toBeNull();
    expect(decodeSorted({ k: 1, b: 0, r: 1, h: 0 })).toEqual({ k: 1, b: 0, r: 1, h: 0 });
    expect(decodeSorted({ k: 1, b: 0, r: 2, h: 0 })).toBeNull();
    expect(decodeLoad({ p: 3, n: 4, c: 20, q: 1, a: 1 })).toEqual({
      p: 3,
      n: 4,
      c: 20,
      q: 1,
      a: 1,
    });
    expect(decodeLoad({ p: 3, n: 4, c: 0, q: 1, a: 1 })).toBeNull();
    expect(decodeBeacon({ s: 0, p: 500, n: 3, q: 0 })).toEqual({ s: 0, p: 500, n: 3, q: 0 });
    expect(decodeBeacon({ s: 2, p: 500, n: 3, q: 0 })).toBeNull();
  });
});

describe("recycling bank links", () => {
  it("a frame follows its screen's beacons, takes drops only from it, and notices when it goes", () => {
    const bus = createBus();
    let t = 0;
    const screen = bus.join({ frame: "s", role: "screen", kind: "screen" });
    const frame = bus.join({ frame: "p1", pos: 0 });
    const stranger = bus.join({ frame: "x", pos: 1 });
    const got: DropMsg[] = [];
    const up = createUplink(
      frame,
      0,
      () => t,
      (m) => got.push(m),
    );
    const down = createDownlink(
      screen,
      { side: 0, count: () => 10, now: () => t },
      {
        load() {},
        sorted() {},
        full() {},
      },
    );
    expect(up.screen()).toBeNull();
    down.tick({ p: 300, n: 2, q: 0 });
    expect(up.screen()).toBe("s");
    expect(up.beacon()?.p).toBe(300);
    // Beacons go no faster than their interval.
    const before = bus.log.length;
    down.tick({ p: 300, n: 2, q: 0 });
    expect(bus.log.length).toBe(before);
    t += BEACON_MS;
    down.tick({ p: 310, n: 2, q: 0 });
    expect(bus.log.length).toBe(before + 1);
    down.drop("p1", drop());
    stranger.send(TOPIC.drop, encodeDrop(drop({ id: 99 })), "p1");
    expect(got.map((m) => m.id)).toEqual([17]);
    // Sends go to the screen it follows.
    expect(up.sorted({ k: 1, b: 0, r: 1, h: 1 })).toBe(true);
    expect(bus.log[bus.log.length - 1]!.to).toBe("s");
    // Silence for longer than the grace: gone.
    t += BEACON_GRACE_MS + 1;
    expect(up.screen()).toBeNull();
    expect(up.load({ p: 0, n: 1, c: 20, q: 0, a: 0 })).toBe(false);
    up.dispose();
    down.dispose();
  });

  it("a screen that leaves the roster is gone at once; a hub change gives it a little longer", () => {
    const bus = createBus();
    let t = 0;
    const screen = bus.join({ frame: "s", role: "screen", kind: "screen" });
    const frame = bus.join({ frame: "p1", pos: 0 });
    const up = createUplink(
      frame,
      0,
      () => t,
      () => {},
    );
    const down = createDownlink(
      screen,
      { side: 0, count: () => 10, now: () => t },
      {
        load() {},
        sorted() {},
        full() {},
      },
    );
    down.tick({ p: 0, n: 0, q: 1 });
    bus.online = false;
    t += BEACON_GRACE_MS + 500;
    expect(up.screen()).toBe("s");
    bus.online = true;
    expect(up.screen()).toBeNull();
    t = 0;
    bus.online = true;
    t += BEACON_MS;
    down.tick({ p: 0, n: 0, q: 1 });
    expect(up.screen()).toBe("s");
    screen.leave();
    expect(up.screen()).toBeNull();
  });

  it("a screen takes reports only from touch frames on its side, at a bounded rate, by roster position", () => {
    const bus = createBus();
    const t = 0;
    const screen = bus.join({ frame: "s", role: "screen", kind: "screen" });
    const p3 = bus.join({ frame: "p3", pos: 3 });
    const other = bus.join({ frame: "b1", pos: 1, side: 1 });
    const fake = bus.join({ frame: "s2", role: "screen", kind: "screen" });
    const loads: number[] = [];
    const sorted: number[] = [];
    const fulls: number[] = [];
    const down = createDownlink(
      screen,
      { side: 0, count: () => 10, now: () => t },
      {
        load: (_m, c) => loads.push(c),
        sorted: (_m, c) => sorted.push(c),
        full: (_m, c) => fulls.push(c),
      },
    );
    for (let i = 0; i < 20; i++) p3.send(TOPIC.sorted, { k: 1, b: 0, r: 1, h: 0 }, "s");
    expect(sorted.length).toBe(RATE.sorted);
    expect(sorted.every((c) => c === 3)).toBe(true);
    // Its claimed position is ignored: the roster says 3.
    p3.send(TOPIC.load, { p: 7, n: 1, c: 20, q: 0, a: 1 }, "s");
    expect(loads).toEqual([3]);
    other.send(TOPIC.load, { p: 1, n: 1, c: 20, q: 0, a: 1 }, "s");
    fake.send(TOPIC.load, { p: 1, n: 1, c: 20, q: 0, a: 1 }, "s");
    p3.send(TOPIC.full, { b: 9 }, "s");
    expect(loads).toEqual([3]);
    expect(fulls).toEqual([]);
    expect(down.stations().map((p) => p.frame)).toEqual(["p3"]);
    down.dispose();
  });
});

const columnsOf = (kind: FrameKind, n: number, framed = true): ColumnInfo[] =>
  Array.from({ length: n }, (_, pos) => ({ pos, kind, frame: framed ? `f${pos}` : null }));

const plantOf = (variant: "sort" | "simple" = "sort", now?: () => number): PlantModel =>
  createPlant({ variant, rng: createRng(5), chuteLength: () => 2400, now });

describe("recycling screen plant", () => {
  it("has one inlet per line of the frames below, where the frames have them", () => {
    const p = plantOf();
    p.setColumns(columnsOf("panel", 6));
    expect(p.inlets.length).toBe(6);
    expect(p.fw).toBe(1080);
    p.inlets.forEach((inlet, i) =>
      expect(inlet.x).toBeCloseTo((i + inletsFor("panel")[0]!) * 1080, 6),
    );
    const q = plantOf();
    q.setColumns(columnsOf("pair", 3));
    expect(q.inlets.length).toBe(6);
    expect(q.fw).toBe(2160);
  });

  it("drops items into every frame, each starting its fall well before it crosses the bezel", () => {
    const p = plantOf();
    p.setColumns(columnsOf("panel", 6));
    for (let c = 0; c < 6; c++) p.load(c, { p: c, n: 2, c: 20, q: 0, a: 1 }, performance.now());
    const sent: { to: string; m: DropMsg; at: number }[] = [];
    let clock = 5_000_000;
    for (let i = 0; i < 60 * 40; i++) {
      clock += DT * 1000;
      p.step(DT, clock, (to, m) => sent.push({ to, m, at: clock }));
    }
    const frames = new Set(sent.map((s) => s.to));
    expect(frames.size).toBe(6);
    for (const s of sent) {
      expect(s.m.t0).toBe(s.at);
      const cross = fallTimeTo(
        { t0: s.m.t0, x0: 0, y0: -s.m.y0, vx0: 0, vy0: s.m.vy, g: s.m.g, tau: s.m.tau },
        0,
      )!;
      expect(cross * 1000).toBeGreaterThan(900);
      expect(decodeDrop(encodeDrop(s.m))).not.toBeNull();
    }
    expect(p.jobs.length).toBeLessThanOrEqual(MAX_JOBS);
    expect(p.recent.length).toBeGreaterThan(0);
  });

  it("the fall the screen draws and the one the frame draws are the same, early or late", () => {
    const p = plantOf();
    p.setColumns(columnsOf("panel", 6));
    let clock = 9_000_000;
    let msg: DropMsg | null = null;
    while (!msg) {
      clock += DT * 1000;
      p.step(DT, clock, (to, m) => {
        if (to === "f4") msg = m;
      });
    }
    const m = msg as DropMsg;
    const job = p.jobs.find((j) => j.id === m.id)!;
    for (const delay of [0, 100, 300, 2500]) {
      const w = worldOf("panel");
      const at = { t: m.t0 + delay };
      w.step(DT, at.t);
      const line = w.layout.lines[m.i]!;
      const it = w.arrive(
        m.i,
        m.k,
        { t0: m.t0, x0: line.inlet.x, y0: -m.y0, vx0: 0, vy0: m.vy, g: m.g, tau: m.tau },
        m.a,
        m.w,
      )!;
      // Bank x of the frame's item: its column's left edge plus its x.
      const bankX = 4 * 1080 + it.x;
      const onScreen = fallAt(job.fall!, (at.t - job.fall!.t0) / 1000);
      expect(bankX).toBeCloseTo(onScreen.x, 6);
      expect(it.y).toBeCloseTo(onScreen.y, 6);
      run(w, 0.25, at);
      if (it.state === "fall") {
        expect(it.y).toBeCloseTo(fallAt(job.fall!, (at.t - job.fall!.t0) / 1000).y, 6);
      }
    }
  });

  it("waits on a frame that is full or has a queue in its funnel", () => {
    const p = plantOf();
    p.setColumns(columnsOf("panel", 2));
    p.load(0, { p: 0, n: 19, c: 20, q: 0, a: 1 }, performance.now());
    p.load(1, { p: 1, n: 3, c: 20, q: 0, a: 1 }, performance.now());
    const to: string[] = [];
    let clock = 0;
    for (let i = 0; i < 60 * 30; i++) {
      clock += DT * 1000;
      p.step(DT, clock, (f) => to.push(f));
    }
    expect(to.filter((f) => f === "f0").length).toBe(0);
    expect(to.filter((f) => f === "f1").length).toBeGreaterThan(3);
  });

  it("drops slowly in attract and faster once someone plays below, faster still with a streak", () => {
    const count = (busy: boolean, streak: number) => {
      const p = plantOf();
      p.setColumns(columnsOf("panel", 4));
      for (let i = 0; i < streak; i++) p.sorted({ k: 0, b: 0, r: 1, h: 1 });
      let clock = 0;
      let n = 0;
      for (let i = 0; i < 60 * 120; i++) {
        if (i % 60 === 0) {
          for (let c = 0; c < 4; c++)
            p.load(c, { p: c, n: 1, c: 20, q: 0, a: busy ? 1 : 0 }, performance.now());
        }
        clock += DT * 1000;
        p.step(DT, clock, () => n++);
      }
      return n;
    };
    const calm = count(false, 0);
    const busy = count(true, 0);
    const fast = count(true, 40);
    expect(busy).toBeGreaterThan(calm * 1.4);
    expect(fast).toBeGreaterThan(busy * 1.15);
  });

  it("full bins rise into the plant and become things in the park, bounded throughout", () => {
    const p = plantOf();
    p.setColumns(columnsOf("panel", 6));
    p.plantY = -4500;
    let clock = 1_000_000;
    for (let i = 0; i < 60; i++) {
      p.full(i % 6, {
        b: i % 4,
        m: i % 4 === 2 ? -1 : i % 7,
        u: 500,
        w: 300,
        h: 435,
        t: clock + 300,
        v: 1050,
      });
      expect(p.rising.length).toBeLessThanOrEqual(MAX_RISING);
    }
    for (let i = 0; i < 60 * 30; i++) {
      clock += DT * 1000;
      p.step(DT, clock, () => {});
      expect(p.flights.length).toBeLessThanOrEqual(MAX_FLIGHTS);
    }
    expect(p.rising.length).toBe(0);
    expect(p.park.things.length).toBe(12);
    p.clearPark();
    expect(p.park.things.length).toBe(0);
  });

  it("alone, the screen keeps its plant going and sends up a full bin now and then", () => {
    let clock = 0;
    const p = plantOf("sort", () => clock);
    p.setColumns(columnsOf("panel", 10, false));
    let drops = 0;
    expect(p.alone(clock)).toBe(true);
    for (let i = 0; i < 60 * 90; i++) {
      clock += DT * 1000;
      p.step(DT, clock, () => drops++);
    }
    expect(drops).toBe(0);
    expect(p.counts.drops).toBeGreaterThan(20);
    expect(p.counts.full).toBeGreaterThanOrEqual(1);
    // A frame reporting in ends it.
    p.load(0, { p: 0, n: 1, c: 20, q: 0, a: 0 }, clock);
    expect(p.alone(clock + ALONE_MS / 2)).toBe(false);
  });
});
