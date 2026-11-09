import { describe, expect, it } from "vitest";
import { specKey } from "../../../src/apps/bluebottle/board";
import { ALONE_MS, CLEAR_GAP_MS } from "../../../src/apps/bluebottle/config";
import { stateHash, visibleOf } from "../../../src/apps/bluebottle/patch";
import { createShore, type Shore } from "../../../src/apps/bluebottle/shore";
import { createSolver } from "../../../src/apps/bluebottle/solver";
import type { Role } from "../../../src/core/types";
import { type Bus, config, createBus, rngOf } from "./helpers";

const GEOM = { w: 8, r: 11, k: 6 };

interface Rig {
  bus: Bus;
  time: { t: number };
  shores: Map<string, Shore>;
  add(frame: string, role: Role, pos: number, skew?: number): Shore;
  remove(frame: string): void;
  run(ms: number, each?: () => void): void;
}

const rig = (count: number, opts: { solo?: boolean } = {}): Rig => {
  const bus = createBus();
  const time = { t: 1_000_000 };
  const shores = new Map<string, Shore>();
  const r: Rig = {
    bus,
    time,
    shores,
    add(frame, role, pos, skew = 0) {
      const net = bus.join(frame, role, pos);
      const s = createShore({
        net,
        now: () => time.t + skew,
        local: () => time.t,
        bank: !opts.solo,
        screen: role === "screen",
        pos,
        count,
        geom: GEOM,
        cfg: config(),
        rng: rngOf(`shore:${frame}`),
      });
      shores.set(frame, s);
      return s;
    },
    remove(frame) {
      shores.get(frame)?.dispose();
      shores.delete(frame);
      bus.leave(frame);
    },
    run(ms, each) {
      const end = time.t + ms;
      while (time.t < end) {
        time.t += 50;
        for (const s of shores.values()) s.tick();
        bus.flush();
        each?.();
      }
    },
  };
  return r;
};

const key = (s: Shore) => (s.cur ? specKey(s.cur.spec) : "none");
const hash = (s: Shore) => (s.cur ? stateHash(s.cur.patch) : -1);

/** A visitor at a touch frame who digs a deducible cell of its own columns every so often. */
const digger = (s: Shore, every: number) => {
  let last = 0;
  return (t: number) => {
    if (t - last < every || !s.playing() || !s.cur) return;
    last = t;
    const { c0, c1 } = s.columns();
    const p = s.cur.patch;
    const ded = createSolver(p.board.cols, p.board.rows).deduce(visibleOf(p)).safe;
    const ours = ded.filter((i) => i % p.board.cols >= c0 && i % p.board.cols < c1);
    if (ours.length > 0) s.dig(ours[0]!, true);
  };
};

describe("bank controller", () => {
  it("brings every frame onto one shared patch", () => {
    const r = rig(2);
    const screen = r.add("s", "screen", 0);
    const a = r.add("p0", "station", 0);
    const b = r.add("p1", "station", 1);
    r.run(4000);
    for (const s of [screen, a, b]) expect(s.mode).toBe("shared");
    expect(key(a)).toBe(key(screen));
    expect(key(b)).toBe(key(screen));
    expect(a.cur?.spec.cols).toBe(16);
    expect(a.columns()).toEqual({ c0: 0, c1: 8 });
    expect(b.columns()).toEqual({ c0: 8, c1: 16 });
    expect(screen.leads()).toBe(true);
    expect(a.leads()).toBe(false);
  });

  it("agrees on the board when two frames dig at once beside their shared edge", () => {
    for (let trial = 0; trial < 20; trial++) {
      const r = rig(2);
      r.bus.shuffle = rngOf(`edge${trial}`);
      r.add("s", "screen", 0);
      const a = r.add("p0", "station", 0, 7);
      const b = r.add("p1", "station", 1, -5);
      r.run(4000);
      const p = a.cur!.patch;
      const cols = p.board.cols;
      const rng = rngOf(`edge-digs${trial}`);
      for (let k = 0; k < 12; k++) {
        // Columns 6 and 7 belong to p0, 8 and 9 to p1; bluebottles there sting across the edge.
        const row = rng.int(11);
        const ca = row * cols + 6 + rng.int(2);
        const cb = row * cols + 8 + rng.int(2);
        a.dig(ca, true);
        b.dig(cb, true);
        if (rng.next() < 0.3) a.flag(cb - 2, true, true);
        r.run(rng.next() < 0.5 ? 50 : 200);
      }
      r.run(3000);
      const shores = [...r.shores.values()];
      for (const s of shores) expect(key(s)).toBe(key(a));
      for (const s of shores) expect(hash(s), `trial ${trial}`).toBe(hash(a));
    }
  });

  it("brings a frame that joins mid-patch up to date from the log", () => {
    const r = rig(2);
    r.add("s", "screen", 0);
    const a = r.add("p0", "station", 0);
    r.add("p1", "station", 1);
    r.run(4000);
    const dig = digger(a, 300);
    r.run(6000, () => dig(r.time.t));
    expect(a.cur!.patch.events.length).toBeGreaterThan(5);
    r.remove("p1");
    r.run(1000, () => dig(r.time.t));
    const b = r.add("p1", "station", 1);
    r.run(3000);
    expect(b.mode).toBe("shared");
    expect(key(b)).toBe(key(a));
    expect(hash(b)).toBe(hash(a));
  });

  it("recovers events lost between two frames from each other's logs", () => {
    const r = rig(2);
    r.add("s", "screen", 0);
    const a = r.add("p0", "station", 0);
    const b = r.add("p1", "station", 1);
    r.run(4000);
    // The screen relays nothing here: a and b only hear each other's events via sync.
    r.bus.cut("p0", "p1");
    r.bus.cut("s", "p0");
    const da = digger(a, 250);
    const db = digger(b, 250);
    r.run(2000, () => {
      da(r.time.t);
      db(r.time.t);
    });
    expect(hash(a)).not.toBe(hash(b));
    r.bus.heal("p0", "p1");
    r.bus.heal("s", "p0");
    r.run(5000);
    for (const s of r.shores.values()) expect(hash(s)).toBe(hash(a));
  });

  it("doesn't ask for logs while events are merely in flight", () => {
    const r = rig(3);
    r.bus.shuffle = rngOf("busy");
    r.add("s", "screen", 0);
    const frames = [
      r.add("p0", "station", 0),
      r.add("p1", "station", 1),
      r.add("p2", "station", 2),
    ];
    r.run(4000);
    const diggers = frames.map((f) => digger(f, 150));
    const before = r.bus.sent.filter((m) => m.topic === "bb:log").length;
    r.run(20_000, () => {
      for (const d of diggers) d(r.time.t);
    });
    const logs = r.bus.sent.filter((m) => m.topic === "bb:log").length - before;
    expect(frames[0]!.cur!.patch.events.length).toBeGreaterThan(30);
    expect(logs).toBeLessThan(6);
  });

  it("carries on without the screen", () => {
    const r = rig(2);
    r.add("s", "screen", 0);
    const a = r.add("p0", "station", 0);
    const b = r.add("p1", "station", 1);
    r.run(4000);
    const before = key(a);
    r.remove("s");
    r.run(5000);
    expect(key(a)).toBe(before);
    expect(key(b)).toBe(before);
    expect(a.mode).toBe("shared");
    expect(a.leads()).toBe(true);
    expect(b.leads()).toBe(false);
    a.dig(a.cur!.patch.board.openings[0]!, true);
    r.run(500);
    expect(hash(b)).toBe(hash(a));
  });

  it("plays a beach of its own columns when alone, and rejoins later", () => {
    const r = rig(2);
    const a = r.add("p0", "station", 0);
    r.run(ALONE_MS + 1500);
    expect(a.mode).toBe("local");
    expect(a.cur?.spec.cols).toBe(8);
    expect(a.cur?.shared).toBe(false);
    const b = r.add("p1", "station", 1);
    r.run(25_000);
    expect(b.mode).toBe("shared");
    expect(a.mode).toBe("shared");
    expect(key(a)).toBe(key(b));
    expect(a.cur?.spec.cols).toBe(16);
  });

  it("stays on its own beach while someone is playing it", () => {
    const r = rig(2);
    const a = r.add("p0", "station", 0);
    r.run(ALONE_MS + 1500);
    expect(a.mode).toBe("local");
    r.add("p1", "station", 1);
    const local = key(a);
    r.run(10_000, () => a.touched());
    expect(a.mode).toBe("local");
    expect(key(a)).toBe(local);
  });

  it("digs a missing frame's sand with crabs, so the patch still clears", () => {
    const r = rig(3);
    const screen = r.add("s", "screen", 0);
    const a = r.add("p0", "station", 0);
    r.add("p1", "station", 1);
    r.run(4000);
    r.remove("p1");
    // Position 2 never came; p1 has gone. A visitor digs at p0.
    const dig = digger(a, 400);
    const first = a.cur!.spec.n;
    let cleared = false;
    for (let i = 0; i < 400 && !cleared; i++) {
      r.run(500, () => dig(r.time.t));
      cleared = (a.cur?.spec.n ?? 0) > first;
    }
    expect(cleared).toBe(true);
    expect(key(screen)).toBe(key(a));
    expect(a.cur!.patch.hints).toBe(0);
  });

  it("starts the next patch on every frame at the same time after a clear", () => {
    const r = rig(2);
    r.add("s", "screen", 0);
    const a = r.add("p0", "station", 0);
    const b = r.add("p1", "station", 1);
    r.run(4000);
    const first = a.cur!.spec.n;
    // Nobody digs: crabs find the quiet regions every 20 s, so give it a while.
    const da = digger(a, 250);
    const db = digger(b, 250);
    let ended = 0;
    for (let i = 0; i < 600 && !ended; i++) {
      r.run(100, () => {
        da(r.time.t);
        db(r.time.t);
      });
      if (a.cur?.patch.end) ended = a.cur.patch.end.t;
    }
    expect(ended).toBeGreaterThan(0);
    r.run(200);
    expect(b.cur?.patch.end?.t).toBe(ended);
    expect(a.upcoming?.start).toBe(ended + CLEAR_GAP_MS);
    expect(b.upcoming?.start).toBe(ended + CLEAR_GAP_MS);
    r.run(CLEAR_GAP_MS + 500);
    expect(a.cur!.spec.n).toBe(first + 1);
    expect(key(b)).toBe(key(a));
  });

  it("settles two patches started apart on the better one", () => {
    const r = rig(2);
    const a = r.add("p0", "station", 0);
    const b = r.add("p1", "station", 1);
    r.bus.cut("p0", "p1");
    r.run(ALONE_MS + 2000);
    // Cut off from each other they each count as present, but neither hears a patch.
    r.bus.heal("p0", "p1");
    r.run(30_000);
    expect(a.mode).toBe("shared");
    expect(b.mode).toBe("shared");
    expect(key(a)).toBe(key(b));
  });

  it("refuses one frame's wash while another frame's visitors dig", () => {
    const r = rig(2);
    r.add("s", "screen", 0);
    const a = r.add("p0", "station", 0);
    const b = r.add("p1", "station", 1);
    r.run(4000);
    const db = digger(b, 300);
    r.run(3000, () => db(r.time.t));
    expect(a.wash(true)).toBe(true);
    r.run(500);
    expect(a.cur!.patch.end).toBeNull();
    r.run(16_000);
    expect(a.wash(true)).toBe(true);
    r.run(500);
    expect(a.cur!.patch.end?.why).toBe("wash");
    expect(b.cur!.patch.end?.why).toBe("wash");
  });

  it("only washes on idle when people played the patch", () => {
    const r = rig(1, { solo: true });
    const a = r.add("p0", "solo", 0);
    r.run(2500);
    expect(a.wash(false)).toBe(false);
    a.dig(a.cur!.patch.board.openings[0]!, true);
    expect(a.wash(false)).toBe(true);
    expect(a.cur!.patch.end?.why).toBe("wash");
  });
});

describe("solo controller", () => {
  it("plays patch after patch on its own", () => {
    const r = rig(1, { solo: true });
    const a = r.add("w", "solo", 0);
    expect(a.mode).toBe("solo");
    r.run(2500);
    expect(a.playing()).toBe(true);
    const first = a.cur!.spec.n;
    const dig = digger(a, 200);
    for (let i = 0; i < 200 && a.cur!.spec.n === first; i++) r.run(500, () => dig(r.time.t));
    expect(a.cur!.spec.n).toBe(first + 1);
    expect(r.bus.sent.length).toBe(0);
  });
});
