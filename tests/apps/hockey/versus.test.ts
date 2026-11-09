import { describe, expect, it } from "vitest";
import { type GameConfig, MATCH_MS, type Side } from "../../../src/apps/hockey/config";
import { layoutFor } from "../../../src/apps/hockey/layout";
import { scoreOf } from "../../../src/apps/hockey/match";
import { CROSS_SPEED, glide } from "../../../src/apps/hockey/physics";
import {
  createTable,
  ENTRY_DEPTH,
  type Lane,
  type Table,
  type TableEvent,
} from "../../../src/apps/hockey/table";
import {
  arrivalFor,
  createVersusLink,
  handoffFor,
  parseHandoff,
  parseState,
  preferred,
  type VersusLink,
} from "../../../src/apps/hockey/versus";
import { createRng } from "../../../src/core/rng";
import type { Channel, Clock, PeerInfo } from "../../../src/core/types";
import { layoutInput, testConfig } from "./helpers";

const DT = 1 / 120;

/** Two app channels joined in memory, delivering after `latency` ms of the shared fake clock. */
const fakeNet = (latency: number) => {
  let now = 0;
  let cut = false;
  const queue: { at: number; to: number; topic: string; data: unknown; from: string }[] = [];
  const handlers = [new Map<string, Set<(d: unknown, f: string) => void>>(), new Map()];
  const info = (i: number): PeerInfo => ({
    frame: `f${i}`,
    app: "hockey",
    group: "g",
    kind: "wall",
    role: "station",
    pos: 0,
    side: i,
  });
  const channel = (i: number): Channel => ({
    online: true,
    self: `f${i}`,
    peers: () => (cut ? [info(i)] : [info(0), info(1)]),
    leader: () => "f0",
    send(topic, data) {
      if (cut) return;
      queue.push({
        at: now + latency,
        to: 1 - i,
        topic,
        data: structuredClone(data),
        from: `f${i}`,
      });
    },
    on(topic, cb) {
      const map = handlers[i]!;
      if (!map.has(topic)) map.set(topic, new Set());
      map.get(topic)!.add(cb);
      return () => map.get(topic)?.delete(cb);
    },
    onPeers: () => () => {},
  });
  const clock: Clock = { now: () => now, synced: true, onSync: () => () => {} };
  return {
    channels: [channel(0), channel(1)] as const,
    clock,
    setNow(t: number) {
      now = t;
      for (let i = 0; i < queue.length;) {
        const m = queue[i]!;
        if (m.at > now) {
          i++;
          continue;
        }
        queue.splice(i, 1);
        if (!cut) for (const cb of handlers[m.to]!.get(m.topic) ?? []) cb(m.data, m.from);
      }
    },
    cut() {
      cut = true;
      queue.length = 0;
    },
    /** Handoffs sent and not yet delivered. */
    inTransit: () => queue.filter((m) => m.topic === "hk:h").length,
  };
};

const config = (over: Partial<GameConfig> = {}): GameConfig => testConfig({ pucks: 3, ...over });

interface End {
  table: Table;
  link: VersusLink;
  ended: number;
}

/** A puck leaving one frame or coming in to the other, as the room sees it (venue px). */
interface Seen {
  side: Side;
  kind: "exit" | "enter";
  id: number;
  t: number;
  /** Lane coordinates, and how far the centre is inside the open end, px. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  depth: number;
  /** Venue velocity. */
  wx: number;
  wy: number;
}

const seen = (side: Side, e: TableEvent, t: number): Seen | null => {
  if (e.type !== "exit" && e.type !== "enter") return null;
  const { puck: p, lane } = e;
  const tv = lane.spec.toVenue;
  return {
    side,
    kind: e.type,
    id: p.id,
    t,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    depth: lane.spec.params.length - p.x,
    wx: tv.a * p.vx + tv.c * p.vy,
    wy: tv.b * p.vx + tv.d * p.vy,
  };
};

const pair = (latency: number, cfg = config(), kind: "wall" | "pair" = "wall") => {
  const net = fakeNet(latency);
  const log: Seen[] = [];
  let now = 0;
  const ends = ([0, 1] as const).map((side: Side): End => {
    const layout = layoutFor(layoutInput(kind, { versus: true, side, variant: cfg.variant }));
    const table = createTable(layout.tables[0]!, cfg, createRng(`t${side}`), { versus: { side } });
    const end: End = { table, link: null as unknown as VersusLink, ended: 0 };
    table.on((e) => {
      const s = seen(side, e, now);
      if (s) log.push(s);
    });
    end.link = createVersusLink({
      net: net.channels[side],
      table,
      side,
      clock: net.clock,
      rng: createRng(`l${side}`),
      keeps: () => true,
      onEnded: () => end.ended++,
      poke: () => {},
    });
    table.attract(0);
    return end;
  });
  const run = (ms: number, each?: () => void) => {
    const until = now + ms;
    for (; now < until; now += DT * 1000) {
      net.setNow(now);
      for (const e of ends) {
        // What the lobby does when a countdown ends.
        if (e.table.match.phase === "countdown" && now >= e.table.match.startAt) e.table.play(now);
        e.table.step(DT, now);
        e.link.tick(now);
      }
      each?.();
    }
  };
  const start = () => {
    const m = ends[0]!.link.newMatch(now, true);
    ends[0]!.table.countdown(now, m.id, m.startAt);
  };
  /** Pucks either frame holds: live, waiting to respawn, or flying in. */
  const held = () => ends.reduce((n, e) => n + e.table.owned().length, 0);
  return {
    net,
    ends,
    run,
    start,
    held,
    log,
    get now() {
      return now;
    },
  };
};

/** A versus table for one side, in play with nothing live, and its lane. */
const sideTable = (side: Side, cfg = config()) => {
  const layout = layoutFor(layoutInput("wall", { versus: true, side }));
  const table = createTable(layout.tables[0]!, cfg, createRng(`s${side}`), { versus: { side } });
  table.countdown(0, "m", 0);
  table.play(0);
  const lane = table.lanes[0]!;
  for (const p of lane.pucks) p.live = false;
  return { table, lane };
};

/** The receiving end of a handoff from a puck at (x, y) on side 0's lane, delivered at `now`. */
const handOver = (from: Lane, to: Lane, x: number, y: number, vx: number, vy: number) => {
  const p = from.pucks[0]!;
  Object.assign(p, { x, y, vx, vy, spin: 2, angle: 0.4 });
  return (sent: number, now: number) => arrivalFor(to, handoffFor(from, p, "m", sent), now);
};

describe("versus messages", () => {
  it("round-trips a handoff into an arrival at the same height, heading for the goal", () => {
    const { lane } = sideTable(0);
    const { lane: other } = sideTable(1);
    const { length: L, width: W, puckR: r, maxPuck } = lane.spec.params;
    const p = lane.pucks[0]!;
    Object.assign(p, { x: L - r, y: W * 0.25, vx: maxPuck * 0.5, vy: -100, spin: 3, angle: 0.5 });
    const h = parseHandoff(JSON.parse(JSON.stringify(handoffFor(lane, p, "m", 1000))), 3)!;
    expect(h).not.toBeNull();
    expect(h.d).toBeCloseTo(-1);
    const a = arrivalFor(other, h, 1050);
    expect(a.y).toBeCloseTo(p.y);
    expect(a.vx).toBeCloseTo(-p.vx);
    expect(a.vy).toBeCloseTo(p.vy);
    // Its leading edge is on the end at the send time, and it comes in now.
    expect(a.slide!.depth).toBeCloseTo(-r);
    expect(a.at).toBe(1000);
    // The lanes are mirror images, so it looks the same in the room: same notch, same turning.
    const lt = lane.spec.toVenue;
    const ot = other.spec.toVenue;
    const look = (t: typeof lt, angle: number) =>
      Math.atan2(
        t.b * Math.cos(angle) + t.d * Math.sin(angle),
        t.a * Math.cos(angle) + t.c * Math.sin(angle),
      );
    expect(look(ot, a.slide!.angle)).toBeCloseTo(look(lt, p.angle));
    expect(Math.sign(ot.a * ot.d) * a.spin).toBeCloseTo(Math.sign(lt.a * lt.d) * p.spin);
    // A sender's clock ahead of ours never holds the puck back.
    expect(arrivalFor(other, { ...h, t: 5000 }, 1050).at).toBe(1050);
  });

  it("rejects malformed messages", () => {
    const ok = { m: "m", id: 0, y: 0.5, d: -1, vx: 0.5, vy: 0, w: 0, a: 0, t: 0 };
    expect(parseHandoff(ok, 3)).not.toBeNull();
    expect(parseHandoff({ ...ok, id: 7 }, 3)).toBeNull();
    expect(parseHandoff({ ...ok, y: 2 }, 3)).toBeNull();
    expect(parseHandoff({ ...ok, d: 9 }, 3)).toBeNull();
    expect(parseHandoff({ ...ok, a: undefined }, 3)).toBeNull();
    expect(parseHandoff("nope", 3)).toBeNull();
    expect(
      parseState({ side: 2, keep: true, match: null, tally: [0, 0], owned: [], away: [] }, 3),
    ).toBeNull();
    expect(
      parseState({ side: 0, keep: true, match: null, tally: [0, 0], owned: [5], away: [] }, 3),
    ).toBeNull();
    expect(
      parseState({ side: 1, keep: false, match: null, tally: [1, 2], owned: [0], away: [] }, 3),
    ).toMatchObject({ side: 1, tally: [1, 2] });
  });

  it("prefers the earlier match, then the lower id", () => {
    const a = { id: "b", startAt: 10, endAt: 100 };
    const b = { id: "a", startAt: 20, endAt: 100 };
    expect(preferred(a, b)).toBe(a);
    expect(preferred({ ...a, startAt: 20 }, b)).toBe(b);
  });
});

describe("versus link", () => {
  it("plays a match across two frames: pucks are conserved and both show the same score", () => {
    const v = pair(120);
    v.run(2000);
    v.start();
    let most = 0;
    v.run(MATCH_MS + 10_000, () => {
      if (v.ends.every((e) => e.table.match.phase === "play")) most = Math.max(most, v.held());
    });
    const [a, b] = v.ends;
    expect(a!.table.match.id).toBe(b!.table.match.id);
    expect(a!.table.match.phase).toBe("over");
    expect(b!.table.match.phase).toBe("over");
    expect(scoreOf(a!.table.match)).toEqual(scoreOf(b!.table.match));
    const [s0, s1] = scoreOf(a!.table.match);
    expect(s0 + s1).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(3);
  });

  it("never loses or doubles a puck while linked", () => {
    const v = pair(80, config({ target: 99 }));
    v.run(2000);
    v.start();
    v.run(3000);
    const counts = new Set<number>();
    let exchanges = 0;
    v.run(90_000, () => {
      counts.add(v.held() + v.net.inTransit());
      exchanges += v.net.inTransit() > 0 ? 1 : 0;
    });
    expect([...counts]).toEqual([3]);
    expect(exchanges).toBeGreaterThan(0);
  });

  it("falls back to a phantom far end when the other frame vanishes, and recovers its pucks", () => {
    const v = pair(80);
    v.run(2000);
    v.start();
    v.run(10_000);
    v.net.cut();
    const [a] = v.ends;
    v.run(15_000);
    expect(a!.link.connected()).toBe(false);
    expect(a!.table.match.phase).toBe("play");
    // Pucks the vanished frame held come back, and the phantom keeps returning shots.
    expect(a!.table.owned()).toEqual([0, 1, 2]);
  });

  it("joins a match the other frame started", () => {
    const v = pair(50);
    v.run(1500);
    v.start();
    v.run(2500);
    const [a, b] = v.ends;
    expect(b!.table.match.id).toBe(a!.table.match.id);
    expect(b!.table.match.phase).toBe("play");
  });
});

/** Placements of pucks sliding in, as they were at that moment. */
const entries = (table: Table) => {
  const out: { x: number; y: number; depth: number }[] = [];
  table.on((e) => {
    if (e.type === "enter") out.push({ x: e.puck.x, y: e.puck.y, depth: e.depth });
  });
  return out;
};

describe("sliding in through the open end", () => {
  it("comes in where it has got to by now, at the same height and speed, with no drop", () => {
    const { lane: from } = sideTable(0);
    const { table, lane } = sideTable(1);
    const params = lane.spec.params;
    const { length: L, width: W, puckR: r, maxPuck } = params;
    const v = maxPuck * 0.5;
    const send = handOver(from, lane, L - r, W * 0.4, v, maxPuck * 0.1);
    const got = entries(table);
    table.arrive(lane, send(1000, 1030));
    table.step(DT, 1030);
    expect(got).toHaveLength(1);
    // 30 ms after its edge reached the end, it is that far across: partly on each frame.
    const depth = -r + v * 0.03;
    expect(got[0]!.depth).toBeCloseTo(depth / r, 6);
    expect(got[0]!.x).toBeCloseTo(L - depth, 6);
    expect(got[0]!.y).toBeCloseTo(glide(params, W * 0.4, maxPuck * 0.1, 0.03).y, 6);
    const p = lane.pucks[0]!;
    expect(p.live).toBe(true);
    expect(p.slidIn).toBe(true);
    expect(p.vx).toBeLessThan(-v * 0.99);
  });

  it("slides a late handoff in from just outside the end rather than dropping it in further", () => {
    const { lane: from } = sideTable(0);
    const { table, lane } = sideTable(1);
    const { length: L, width: W, puckR: r, maxPuck } = lane.spec.params;
    const send = handOver(from, lane, L - r, W * 0.6, maxPuck * 0.5, 0);
    const got = entries(table);
    table.arrive(lane, send(1000, 1300));
    table.step(DT, 1300);
    expect(got).toHaveLength(1);
    // 300 ms on it would be well across, but the sender stopped drawing it long ago.
    expect(got[0]!.depth).toBeCloseTo(-1, 6);
    expect(got[0]!.y).toBeCloseTo(W * 0.6, 6);
  });

  it("never lands on a mallet at the open end: it comes in touching it and is struck back", () => {
    const { lane: from } = sideTable(0);
    const { table, lane } = sideTable(1);
    const { length: L, width: W, puckR: r, malletR: R, maxPuck } = lane.spec.params;
    const keeper = [...lane.players].sort((a, b) => b.mallet.zone.x1 - a.mallet.zone.x1)[0]!;
    table.setHuman(keeper, true);
    const m = keeper.mallet;
    m.x = m.px = m.tx = m.zone.x1;
    m.y = m.py = m.ty = W * 0.5;
    const send = handOver(from, lane, L - r, W * 0.5 + r * 0.3, maxPuck * 0.5, 0);
    const got = entries(table);
    let exits = 0;
    table.on((e) => {
      if (e.type === "exit") exits++;
    });
    table.arrive(lane, send(1000, 1080));
    let now = 1080;
    table.step(DT, now);
    expect(got).toHaveLength(1);
    expect(Math.hypot(got[0]!.x - m.x, got[0]!.y - m.y)).toBeGreaterThanOrEqual(R + r - 1);
    for (let i = 0; i < 30 && exits === 0; i++) {
      now += DT * 1000;
      table.step(DT, now);
    }
    expect(exits).toBe(1);
  });

  it("waits for a puck in its way rather than landing on it", () => {
    const { lane: from } = sideTable(0);
    const { table, lane } = sideTable(1);
    const { length: L, width: W, puckR: r, maxPuck } = lane.spec.params;
    const q = lane.pucks[1]!;
    Object.assign(q, { x: L - r * 0.5, y: W / 2, px: L - r * 0.5, py: W / 2, live: true });
    q.vx = -maxPuck * 0.1;
    q.vy = 0;
    const send = handOver(from, lane, L - r, W / 2, maxPuck * 0.5, 0);
    const got = entries(table);
    let gap = Infinity;
    table.on((e) => {
      if (e.type === "enter") gap = Math.hypot(e.puck.x - q.x, e.puck.y - q.y);
    });
    table.arrive(lane, send(1000, 1020));
    for (let now = 1020; now < 1600 && got.length === 0; now += DT * 1000) table.step(DT, now);
    expect(got).toHaveLength(1);
    expect(gap).toBeGreaterThanOrEqual(2 * r - 1e-6);
  });
});

/** Each puck leaving one frame, with its next appearance, which is on the other frame. */
const crossings = (log: readonly Seen[]) =>
  log.flatMap((exit, i) => {
    if (exit.kind !== "exit") return [];
    const next = log.slice(i + 1).find((e) => e.id === exit.id);
    return next && next.kind === "enter" && next.side !== exit.side ? [{ exit, enter: next }] : [];
  });

describe("versus crossings", () => {
  const step = DT * 1000;

  for (const [kind, latency] of [
    ["wall", 0],
    ["wall", 100],
    ["wall", 300],
    ["pair", 0],
    ["pair", 300],
  ] as const) {
    it(`carries pucks straight across the join between ${kind}s with ${latency} ms of delay`, () => {
      const params = layoutFor(layoutInput(kind, { versus: true })).tables[0]!.lanes[0]!.params;
      const { puckR: r, maxPuck } = params;
      const v = pair(latency, config({ target: 99 }), kind);
      v.run(2000);
      v.start();
      v.run(60_000);
      const list = crossings(v.log);
      expect(list.length).toBeGreaterThan(10);
      let exact = 0;
      let prompt = 0;
      for (const { exit, enter } of list) {
        const speed = Math.max(Math.abs(exit.vx), CROSS_SPEED * maxPuck);
        // The same way at the same speed.
        expect(enter.wx).toBeCloseTo(Math.sign(exit.wx) * speed, 6);
        // On the path it was on, at the same height.
        const from = -exit.depth;
        const g = glide(params, exit.y, exit.vy, (enter.depth - from) / speed);
        expect(enter.y).toBeCloseTo(g.y, 6);
        expect(enter.vy).toBeCloseTo(g.vy, 6);
        // In straight away, no hang beyond the delay (unless another puck is in its way): where
        // it has got to while the sender still shows part of it, else from just outside the end.
        expect(enter.t - exit.t).toBeLessThanOrEqual(latency + 1000 + step);
        if (enter.t - exit.t <= latency + step + 1e-6) prompt++;
        const truth = from + (speed * (enter.t - exit.t)) / 1000;
        if (truth > ENTRY_DEPTH * r) expect(enter.depth).toBeCloseTo(-r, 6);
        else expect(enter.depth).toBeLessThanOrEqual(truth + 1e-6);
        expect(enter.depth).toBeGreaterThanOrEqual(-r - 1e-6);
        if (Math.abs(enter.depth - truth) < 1e-3) exact++;
      }
      expect(prompt / list.length).toBeGreaterThan(0.9);
      // Within a step's delay the receiver takes the puck exactly where the sender still draws
      // it sliding off; only a mallet or puck at the end holds one back.
      if (latency === 0) expect(exact / list.length).toBeGreaterThan(0.9);
    });
  }

  it("puts back a puck lost with a frame that vanished mid-handoff within a few seconds", () => {
    const v = pair(300, config({ target: 99 }));
    v.run(2000);
    v.start();
    v.run(3000);
    for (let i = 0; i < 20_000 && v.net.inTransit() === 0; i++) v.run(step);
    const exit = v.log.findLast((e) => e.kind === "exit")!;
    const sender = v.ends[exit.side]!;
    v.net.cut();
    const cutAt = v.now;
    let back = -1;
    v.run(8000, () => {
      if (back < 0 && sender.table.lanes[0]!.pucks[exit.id]!.live) back = v.now;
    });
    expect(back).toBeGreaterThan(cutAt);
    expect(back - cutAt).toBeLessThan(4600);
  });

  it("with the other frame gone, a puck that leaves slides back in after a pause", () => {
    const v = pair(80);
    const r = v.ends[0]!.table.lanes[0]!.spec.params.puckR;
    v.run(2000);
    v.start();
    v.run(5000);
    v.net.cut();
    v.run(6000);
    const from = v.log.length;
    v.run(40_000);
    const log = v.log.slice(from).filter((e) => e.side === 0);
    const back = log.flatMap((exit, i) => {
      if (exit.kind !== "exit") return [];
      const next = log.slice(i + 1).find((e) => e.id === exit.id);
      return next?.kind === "enter" ? [{ exit, enter: next }] : [];
    });
    expect(back.length).toBeGreaterThan(3);
    for (const { exit, enter } of back) {
      expect(enter.t - exit.t).toBeGreaterThanOrEqual(800);
      expect(enter.t - exit.t).toBeLessThanOrEqual(2000 + 1100 + step);
      // From just outside the end, moving in: it slides in, it isn't put down.
      expect(enter.depth).toBeLessThan(-r * 0.5);
      expect(enter.vx).toBeLessThan(0);
    }
    const p = v.ends[0]!.table.lanes[0]!.pucks[back.at(-1)!.enter.id]!;
    expect(p.slidIn).toBe(true);
  });
});
