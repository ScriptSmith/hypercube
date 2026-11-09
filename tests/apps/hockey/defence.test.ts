import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { createBankLink } from "../../../src/apps/hockey/bank";
import { homeSpot } from "../../../src/apps/hockey/home";
import { deckLayout, type DefenceSpec, layoutFor } from "../../../src/apps/hockey/layout";
import { type Table, type TableEvent, createTable } from "../../../src/apps/hockey/table";
import {
  decodeHandoff,
  decodeView,
  encodeHandoff,
  encodeView,
  TOPIC_DOWN,
  TOPIC_UP,
  TOPIC_VIEW,
} from "../../../src/apps/hockey/view";
import {
  createWaves,
  FAST_WAVE_MS,
  hitTarget,
  placeTargets,
  stepWaves,
} from "../../../src/apps/hockey/waves";
import { createRng } from "../../../src/core/rng";
import type { Channel, Clock, PeerInfo } from "../../../src/core/types";
import { layoutInput, testConfig } from "./helpers";

const DT = 1 / 120;

const spec = (): DefenceSpec => ({
  targets: { x0: 1000, x1: 1800, y0: 50, y1: 1950 },
  targetR: 60,
  splitters: [{ id: 100, x: 800, y: 1000, r: 70 }],
  keepOut: [{ x0: 1500, x1: 1800, y0: 800, y1: 1200 }],
  local: true,
});

const run = (t: Table, ms: number, from = 0) => {
  let now = from;
  for (; now < from + ms; now += DT * 1000) t.step(DT, now);
  return now;
};

describe("defence waves", () => {
  it("places targets apart, inside the zone, clear of splitters and the counter", () => {
    const s = spec();
    for (let seed = 0; seed < 20; seed++) {
      const ts = placeTargets(s, 6, createRng(`p${seed}`));
      expect(ts.length).toBeGreaterThanOrEqual(3);
      for (const t of ts) {
        expect(t.x).toBeGreaterThanOrEqual(s.targets.x0);
        expect(t.x).toBeLessThanOrEqual(s.targets.x1);
        const k = s.keepOut[0]!;
        expect(t.x < k.x0 - t.r || t.x > k.x1 + t.r || t.y < k.y0 - t.r || t.y > k.y1 + t.r).toBe(
          true,
        );
        expect(Math.hypot(t.x - 800, t.y - 1000)).toBeGreaterThan(70 + t.r);
        for (const u of ts)
          if (u !== t) expect(Math.hypot(t.x - u.x, t.y - u.y)).toBeGreaterThan(t.r * 2);
      }
    }
  });

  it("clears a wave only when every target is lit at once, and quickens after a fast one", () => {
    const s = spec();
    const w = createWaves();
    stepWaves(w, s, 0, createRng("w"));
    const ids = w.targets.map((t) => t.id);
    expect(ids.length).toBe(3);
    expect(hitTarget(w, s, ids[0]!, 100)).toBe(false);
    expect(hitTarget(w, s, ids[1]!, 200)).toBe(false);
    // The first target goes dark again before the last is struck: no clear.
    expect(hitTarget(w, s, ids[2]!, 60_000)).toBe(false);
    expect(hitTarget(w, s, ids[0]!, 60_100)).toBe(false);
    expect(hitTarget(w, s, ids[1]!, 60_200)).toBe(true);
    expect(w.cleared).toBe(1);
    expect(w.targets).toEqual([]);
    // That took a minute: the next wave's lights last longer.
    expect(w.pace).toBeGreaterThan(1);
    stepWaves(w, s, 70_000, createRng("w2"));
    const quick = w.targets.map((t) => t.id);
    for (const id of quick) hitTarget(w, s, id, 70_000 + FAST_WAVE_MS / 2);
    expect(w.cleared).toBe(2);
    expect(w.pace).toBeLessThan(1.25);
  });
});

describe("defence rules", () => {
  const rink = (kind: "pair" | "wall" = "pair") => {
    const layout = layoutFor(layoutInput(kind, { variant: "defence" }));
    const t = createTable(layout.tables[0]!, testConfig({ variant: "defence" }), createRng("d"));
    const events: TableEvent[] = [];
    t.on((e) => events.push(e));
    return { t, events };
  };

  it("seals the slot of a player nobody holds, and opens every slot in attract", () => {
    const { t } = rink();
    t.attract(0);
    run(t, 100);
    expect(t.lanes[0]!.spec.params.mouths[0].every((m) => m.open)).toBe(true);
    t.countdown(100, "m", 100);
    t.setManned(t.players[0]!, true);
    t.play(100);
    run(t, 100, 100);
    expect(t.lanes[0]!.spec.params.mouths[0].map((m) => m.open)).toEqual([true, false]);
  });

  it("counts a puck into a slot as lost and drops a new one in from the top", () => {
    const { t, events } = rink();
    t.countdown(0, "m", 0);
    for (const p of t.players) t.setManned(p, true);
    t.play(0);
    const lane = t.lanes[0]!;
    for (const p of lane.pucks) p.live = false;
    const m = lane.spec.params.mouths[0][0]!;
    const puck = lane.pucks[0]!;
    puck.live = true;
    puck.x = 20;
    puck.px = 20;
    puck.y = (m.y0 + m.y1) / 2;
    puck.vx = -2000;
    puck.vy = 0;
    // Keep the mallets out of the way.
    for (const pl of t.players) pl.mallet.tx = pl.mallet.zone.x1;
    const now = run(t, 200);
    expect(events.some((e) => e.type === "lost" && e.slot === 0)).toBe(true);
    expect(t.match.mine[1]).toBe(1);
    run(t, 2000, now);
    const live = lane.pucks.filter((p) => p.live);
    expect(live.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...live.map((p) => p.x))).toBeGreaterThan(lane.spec.params.length * 0.3);
  });

  it("splits a puck that strikes a splitter", () => {
    const { t, events } = rink();
    t.countdown(0, "m", 0);
    for (const p of t.players) t.setManned(p, true);
    t.play(0);
    const lane = t.lanes[0]!;
    const sp = t.spec.defence!.splitters[0]!;
    for (const p of lane.pucks) p.live = false;
    const puck = lane.pucks[0]!;
    puck.live = true;
    puck.x = sp.x - sp.r - 200;
    puck.px = puck.x;
    puck.y = sp.y;
    puck.vx = 1500;
    puck.vy = 0;
    run(t, 300);
    expect(events.some((e) => e.type === "split")).toBe(true);
    expect(lane.pucks.filter((p) => p.live).length).toBeGreaterThanOrEqual(2);
  });

  it("wins the round on reaching the target waves", () => {
    const { t, events } = rink();
    t.countdown(0, "m", 0);
    t.play(0);
    t.match.theirs[0] = 7;
    run(t, 50);
    expect(t.match.phase).toBe("over");
    expect(events.at(-1)).toEqual({ type: "over", winner: 0 });
  });

  it("refits to a smaller rink and keeps every puck and mallet inside it", () => {
    const { t } = rink();
    t.countdown(0, "m", 0);
    for (const p of t.players) t.setManned(p, true);
    t.play(0);
    run(t, 2000);
    const smaller = layoutFor(
      layoutInput("pair", { variant: "defence", bands: { d: { top: 900, bottom: 1700 } } }),
    ).tables[0]!;
    t.refit(smaller);
    const p = t.lanes[0]!.spec.params;
    expect(p.length).toBeLessThan(1860);
    for (const q of t.lanes[0]!.pucks) {
      if (!q.live) continue;
      expect(q.x).toBeLessThanOrEqual(p.length + p.puckR);
      expect(q.y).toBeGreaterThanOrEqual(0);
      expect(q.y).toBeLessThanOrEqual(p.width);
    }
    for (const pl of t.players) {
      expect(pl.mallet.x).toBeGreaterThanOrEqual(pl.mallet.zone.x0);
      expect(pl.mallet.x).toBeLessThanOrEqual(pl.mallet.zone.x1);
    }
    run(t, 2000, 2000);
  });
});

describe("the deck", () => {
  it("takes pucks in from below and lets them out only over playing frames", () => {
    const { width, height } = VENUE_SIZE.screen;
    const layout = deckLayout({ width, height, count: 3, speed: 1 });
    const t = createTable(layout.tables[0]!, testConfig({ variant: "defence" }), createRng("k"), {
      rules: "deck",
    });
    const exits: number[] = [];
    t.on((e) => {
      if (e.type === "exit") exits.push(e.slot);
    });
    t.countdown(0, "deck", 0);
    t.play(0);
    t.setOpen(new Set([1]));
    const lane = t.lanes[0]!;
    const p = lane.spec.params;
    const mouth = p.mouths[0][1]!;
    // Up from frame 1, slowly, so it drifts back down through the same opening.
    expect(
      t.arrive(lane, {
        id: -1,
        end: 0,
        y: (mouth.y0 + mouth.y1) / 2,
        vx: p.maxPuck * 0.15,
        vy: 0,
        spin: 0,
        sent: 0,
        at: 50,
      }),
    ).toBe(true);
    run(t, 200);
    expect(lane.pucks.filter((q) => q.live)).toHaveLength(1);
    run(t, 30_000, 200);
    expect(exits).toContain(1);
    expect(exits.every((s) => s === 1)).toBe(true);
  });
});

describe("bank messages", () => {
  it("round-trips a view of a table and refuses bad ones", () => {
    const layout = layoutFor(layoutInput("pair"));
    const t = createTable(layout.tables[0]!, testConfig(), createRng("v"));
    t.attract(0);
    run(t, 500);
    const wire = JSON.parse(
      JSON.stringify(encodeView(t, { width: 2160, height: 1920, kind: "pair" }, 2, 3, 4, 500)),
    );
    const v = decodeView(wire)!;
    expect(v).toMatchObject({ pos: 2, count: 3, kind: "pair", phase: "attract", rally: 4 });
    expect(v.lanes[0]!.mallets).toHaveLength(2);
    expect(v.lanes[0]!.goals).toHaveLength(2);
    for (const [x, y] of v.lanes[0]!.pucks) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    expect(decodeView({ ...wire, p: 7 })).toBeNull();
    expect(decodeView({ ...wire, k: "laptop" })).toBeNull();
    expect(decodeView({ ...wire, l: [{ ...wire.l[0], q: [5000, 1] }] })).toBeNull();
    expect(decodeHandoff(encodeHandoff({ pos: 3, u: 0.25, vx: -0.5, vy: 0.1 }))).toEqual({
      pos: 3,
      u: 0.25,
      vx: 0.5,
      vy: 0.1,
    });
    expect(decodeHandoff({ p: 1, u: 2000, vx: 1, vy: 0 })).toBeNull();
  });

  it("a frame hands pucks up to the screen and takes them back at the top", () => {
    const layout = layoutFor(layoutInput("panel", { variant: "defence", deck: true }));
    const t = createTable(layout.tables[0]!, testConfig({ variant: "defence" }), createRng("b"));
    const sent: { topic: string; data: unknown; to?: string }[] = [];
    const handlers = new Map<string, (d: unknown, from: string) => void>();
    const peers: PeerInfo[] = [
      { frame: "s", app: "hockey", group: "g", kind: "screen", role: "screen", pos: 0 },
      { frame: "f", app: "hockey", group: "g", kind: "panel", role: "station", pos: 2 },
    ];
    const net: Channel = {
      online: true,
      self: "f",
      peers: () => peers,
      leader: () => "s",
      send: (topic, data, to) => sent.push({ topic, data, to }),
      on: (topic, cb) => {
        handlers.set(topic, cb);
        return () => handlers.delete(topic);
      },
      onPeers: () => () => {},
    };
    let now = 0;
    const clock: Clock = { now: () => now, synced: true, onSync: () => () => {} };
    const link = createBankLink({
      net,
      clock,
      table: t,
      frame: () => ({ width: 1080, height: 1920, kind: "panel" }),
      pos: 2,
      count: 6,
    });
    t.countdown(0, "m", 0);
    t.setManned(t.players[0]!, true);
    t.play(0);
    const lane = t.lanes[0]!;
    const p = lane.spec.params;
    const puck = lane.pucks.find((q) => q.live)!;
    puck.x = p.length - 10;
    puck.px = puck.x;
    puck.y = p.width / 2;
    puck.vx = p.maxPuck * 0.6;
    puck.vy = 0;
    for (; now < 300; now += DT * 1000) {
      t.step(DT, now);
      link.tick(now, now);
    }
    expect(sent.some((m) => m.topic === TOPIC_VIEW && m.to === "s")).toBe(true);
    const up = sent.find((m) => m.topic === TOPIC_UP);
    expect(up?.to).toBe("s");
    expect(decodeHandoff(up!.data)).toMatchObject({ pos: 2, u: expect.closeTo(0.5, 1) });
    handlers.get(TOPIC_DOWN)!(encodeHandoff({ pos: 2, u: 0.3, vx: 0.4, vy: 0 }), "s");
    expect(lane.arrivals.some((a) => a.end === 1 && a.vx < 0)).toBe(true);
    link.dispose();
  });
});

describe("home spot", () => {
  const size = 120;
  it("keeps the Home control off stations and seams on a pair and a kiosk", () => {
    for (const kind of ["pair", "kiosk"] as const) {
      const input = layoutInput(kind);
      const l = layoutFor(input);
      const at = homeSpot(l, input.reachTop.adult, input.seams, size);
      for (const st of l.tables[0]!.lanes[0]!.players.map((p) => p.station!)) {
        const apart = at.x + size <= st.x || at.x >= st.x + st.width;
        expect(apart, kind).toBe(true);
      }
      for (const s of input.seams) expect(at.x + size <= s || at.x >= s).toBe(true);
    }
  });

  it("finds a gap between stations in reach on a wall", () => {
    const input = layoutInput("wall");
    const l = layoutFor(input);
    const at = homeSpot(l, input.reachTop.adult, input.seams, 160);
    expect(at.y).toBeGreaterThanOrEqual(input.reachTop.adult);
    const players = l.tables.flatMap((t) => t.lanes.flatMap((ln) => ln.players));
    const covered = players.reduce((n, p) => {
      const st = p.station!;
      const w = Math.max(0, Math.min(at.x + 160, st.x + st.width) - Math.max(at.x, st.x));
      return n + w;
    }, 0);
    expect(covered).toBeLessThanOrEqual(40);
  });
});
