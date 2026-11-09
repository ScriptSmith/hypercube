import { describe, expect, it } from "vitest";
import {
  createUplink,
  createDownlink,
  GAP_MS,
  SCREEN_GRACE_MS,
  ST_MS,
} from "../../../src/apps/skyline/link";
import {
  geoFromCrane,
  geoKey,
  padFromCrane,
  padFromRemote,
  readoutFromState,
  stateFromCrane,
} from "../../../src/apps/skyline/model";
import { createPilot } from "../../../src/apps/skyline/pilot";
import {
  decodeBlk,
  decodeExit,
  decodeGeo,
  decodePad,
  decodeRel,
  decodeSt,
  encodeExit,
  encodePad,
  TOPIC,
} from "../../../src/apps/skyline/wire";
import { createRng } from "../../../src/core/rng";
import type { Channel, PeerInfo } from "../../../src/core/types";
import { DT, rig } from "./helpers";

/** Channels that deliver to each other at once, as JSON would, with a shared roster. */
const fakeNet = () => {
  const peers: PeerInfo[] = [];
  const handlers = new Map<string, Map<string, Set<(data: unknown, from: string) => void>>>();
  let online = true;
  const log: { from: string; to: string | undefined; topic: string }[] = [];
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
        log.push({ from: info.frame, to, topic });
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
    log,
    inject(from: string, topic: string, data: unknown) {
      for (const [frame, topics] of handlers) {
        if (frame === from) continue;
        for (const cb of topics.get(topic) ?? []) cb(data, from);
      }
    },
    remove(frame: string) {
      const i = peers.findIndex((p) => p.frame === frame);
      if (i >= 0) peers.splice(i, 1);
    },
    setOnline(v: boolean) {
      online = v;
    },
  };
};

const peer = (frame: string, role: PeerInfo["role"], pos = 0, side = 0): PeerInfo => ({
  frame,
  app: "skyline",
  group: "main",
  kind: role === "screen" ? "screen" : "panel",
  role,
  pos,
  side,
});

describe("skyline wire", () => {
  it("round-trips every message and clamps what it sends", () => {
    expect(decodePad(encodePad({ c: 1, x: 1200, y: -5, h: 1, b: 0 }))).toEqual({
      c: 1,
      x: 1000,
      y: 0,
      h: 1,
      b: 0,
    });
    expect(decodeRel({ c: 0, b: 1 })).toEqual({ c: 0, b: 1 });
    expect(decodeBlk({ c: 1, k: 3, h: 1 })).toEqual({ c: 1, k: 3, h: 1 });
    expect(decodeExit(encodeExit({ c: 0, u: 905.6, w: 1000 }))).toEqual({ c: 0, u: 906, w: 400 });
    const { crane } = rig("wire");
    crane.request(1);
    for (let i = 0; i < 300; i++) crane.step(DT);
    const st = { s: 0, cr: [stateFromCrane(crane, 0, 3, "person", true)] };
    expect(decodeSt(JSON.parse(JSON.stringify(st)))).toEqual(st);
    const geo = { s: 1, cr: [geoFromCrane(crane, 0, 3, { u: 0.06, w: 0.05 })] };
    expect(decodeGeo(JSON.parse(JSON.stringify(geo)))).toEqual(geo);
  });

  it("drops malformed messages whole", () => {
    const bad: unknown[] = [
      null,
      3,
      "x",
      [],
      { c: 2, x: 1, y: 1, h: 1, b: 0 },
      { c: 0, x: 1.5, y: 1, h: 1, b: 0 },
      { c: 0, x: 1, y: 1001, h: 1, b: 0 },
      { c: 0, x: 1, y: 1, h: 2, b: 0 },
    ];
    for (const d of bad) expect(decodePad(d), JSON.stringify(d)).toBeNull();
    for (const d of [null, { c: 0 }, { c: 0, b: "1" }]) expect(decodeRel(d)).toBeNull();
    for (const d of [
      { c: 0, k: 4, h: 0 },
      { c: 0, k: -1, h: 0 },
      { c: 0, k: 1 },
    ])
      expect(decodeBlk(d)).toBeNull();
    for (const d of [
      { c: 0, u: 1001, w: 10 },
      { c: 0, u: 10, w: 401 },
      { c: 0, u: 10 },
    ])
      expect(decodeExit(d)).toBeNull();
    const { crane } = rig("bad");
    const good = stateFromCrane(crane, 0, 1, "auto", true);
    const st = (over: Record<string, unknown>) => ({ s: 0, cr: [{ ...good, ...over }] });
    expect(decodeSt(st({}))).not.toBeNull();
    for (const over of [
      { k: 4 },
      { d: 3 },
      { f: "0x1" },
      { f: "0".repeat(65) },
      { yd: "012345678" },
      { hx: 1.5 },
      { hx: 99_999 },
      { sw: -1 },
      { g: "1" },
    ]) {
      expect(decodeSt(st(over)), JSON.stringify(over)).toBeNull();
    }
    expect(decodeSt({ s: 0, cr: [] })).toBeNull();
    expect(decodeSt({ s: 2, cr: [good] })).toBeNull();
    expect(decodeSt({ s: 0, cr: [good, good, good] })).toBeNull();
    const geo = geoFromCrane(crane, 0, 1, { u: 0.1, w: 0.05 });
    for (const over of [
      { sl: [1, 2, 3] },
      { tp: "1" },
      { rd: "2".repeat(geo.tp.length) },
      { yx: Array(9).fill(1) },
      { mw: 500 },
      { bw: 0 },
    ]) {
      expect(decodeGeo({ s: 0, cr: [{ ...geo, ...over }] }), JSON.stringify(over)).toBeNull();
    }
  });
});

describe("skyline pad model", () => {
  it("draws the same picture from the screen's messages as from the crane itself", () => {
    const { crane, pilot } = rig("model");
    for (let i = 0; i < 90 / DT; i++) {
      if (crane.canRequest()) crane.request(i % 3);
      pilot.update(DT, crane.readout());
      crane.step(DT);
    }
    expect(crane.counts.placed).toBeGreaterThan(2);
    const local = padFromCrane(crane, "bot", true);
    const st = JSON.parse(JSON.stringify(stateFromCrane(crane, 0, 7, "bot", true)));
    const geo = JSON.parse(JSON.stringify(geoFromCrane(crane, 0, 7, { u: 0.06, w: 0.05 })));
    const remote = padFromRemote(st, geo, local.room)!;
    expect(remote).not.toBeNull();
    expect(remote.slots.map((s) => s.kind)).toEqual(local.slots.map((s) => s.kind));
    remote.slots.forEach((s, i) => {
      expect(s.x).toBeCloseTo(local.slots[i]!.x, 2);
      expect(s.y).toBeCloseTo(local.slots[i]!.y, 2);
      expect(s.top).toBe(local.slots[i]!.top);
    });
    expect(remote.yard.map((y) => y.kind)).toEqual(local.yard.map((y) => y.kind));
    expect(remote.driver).toBe("bot");
    expect(remote.hook.x).toBeCloseTo(local.hook.x, 2);
    // A state of another generation than the shapes isn't drawn.
    expect(padFromRemote({ ...st, g: 8 }, geo, 0)).toBeNull();
    const r = readoutFromState(st);
    const real = crane.readout();
    expect(r.carrying).toBe(real.carrying);
    expect(r.carry).toBeCloseTo(real.carry, 2);
    expect(r.period).toBeCloseTo(real.period, 1);
    expect(r.pick === null).toBe(real.pick === null);
  });

  it("changes the shapes' key only when a lot or tower changes", () => {
    const { crane } = rig("key");
    const k0 = geoKey(crane);
    crane.request(0);
    for (let i = 0; i < 200; i++) crane.step(DT);
    expect(geoKey(crane)).toBe(k0);
    crane.clear();
    expect(geoKey(crane)).not.toBe(k0);
  });
});

describe("skyline bank link", () => {
  it("counts the screen only while it speaks, the roster lists it, and it is on this side", () => {
    let t = 0;
    const net = fakeNet();
    const screen = net.channel(peer("s", "screen"));
    const other = net.channel(peer("s2", "screen", 0, 1));
    const frame = net.channel(peer("p0", "station", 0));
    const up = createUplink(frame, 0, () => t);
    const { crane } = rig("link");
    const st = { s: 0, cr: [stateFromCrane(crane, 0, 1, "auto", true)] };
    expect(up.screen()).toBeNull();
    other.send(TOPIC.st, { ...st, s: 1 });
    expect(up.screen()).toBeNull();
    screen.send(TOPIC.st, st);
    expect(up.screen()).toBe("s");
    expect(up.state(0)?.g).toBe(1);
    t += SCREEN_GRACE_MS - 10;
    expect(up.screen()).toBe("s");
    t += 20;
    expect(up.screen()).toBeNull();
    screen.send(TOPIC.st, st);
    net.remove("s");
    expect(up.screen()).toBeNull();
    // A touch frame pretending to be the screen is ignored.
    const liar = net.channel(peer("p9", "station", 9));
    liar.send(TOPIC.st, st);
    expect(up.screen()).toBeNull();
    up.dispose();
  });

  it("takes messages only from frames below on its side, by their roster position, rate-limited", () => {
    let t = 1000;
    const net = fakeNet();
    const screenCh = net.channel(peer("s", "screen"));
    const got: string[] = [];
    const down = createDownlink(
      screenCh,
      { side: 0, now: () => t },
      {
        pad: (pos, m) => got.push(`pad ${pos} ${m.c} ${m.h}`),
        release: (pos) => got.push(`rel ${pos}`),
        block: (pos, m) => got.push(`blk ${pos} ${m.k}`),
        exit: (pos, m) => got.push(`exit ${pos} ${m.u}`),
      },
    );
    const p3 = net.channel(peer("p3", "station", 3));
    const up = createUplink(p3, 0, () => t);
    // Nothing goes up before the screen is heard.
    expect(up.block({ c: 0, k: 1, h: 1 })).toBe(false);
    screenCh.send(
      TOPIC.st,
      { s: 0, cr: [stateFromCrane(rig("x").crane, 0, 1, "auto", true)] },
      "p3",
    );
    expect(up.block({ c: 0, k: 1, h: 1 })).toBe(true);
    expect(got).toEqual(["blk 3 1"]);
    expect(net.log.at(-1)!.to).toBe("s");
    // Too soon after the last block: dropped. Later: taken.
    up.block({ c: 0, k: 2, h: 0 });
    t += GAP_MS.blk;
    up.block({ c: 0, k: 2, h: 0 });
    expect(got.filter((g) => g.startsWith("blk"))).toEqual(["blk 3 1", "blk 3 2"]);
    up.pad({ c: 1, x: 10, y: 20, h: 1, b: 0 });
    up.pad({ c: 1, x: 11, y: 20, h: 1, b: 0 });
    up.pad({ c: 1, x: 11, y: 20, h: 0, b: 0 });
    expect(got.filter((g) => g.startsWith("pad"))).toEqual(["pad 3 1 1", "pad 3 1 0"]);
    up.exit({ c: 0, u: 905, w: 120 });
    expect(got.at(-1)).toBe("exit 3 905");
    // The message's own claims don't matter; strangers and the other side are refused.
    net.inject("nobody", TOPIC.blk, { c: 0, k: 1, h: 1 });
    const b = net.channel(peer("b0", "station", 0, 1));
    b.send(TOPIC.blk, { c: 0, k: 1, h: 1 });
    const scr2 = net.channel(peer("s2", "screen", 0, 1));
    scr2.send(TOPIC.blk, { c: 0, k: 1, h: 1 });
    net.inject("p3", TOPIC.blk, { c: 0, k: 9, h: 1 });
    expect(got.filter((g) => g.startsWith("blk"))).toHaveLength(2);
    expect(down.stations().map((p) => p.frame)).toEqual(["p3"]);
    down.dispose();
  });

  it("lets a bot on a frame build on the screen's crane through the messages alone", () => {
    let t = 0;
    const net = fakeNet();
    const screenCh = net.channel(peer("s", "screen"));
    const frameCh = net.channel(peer("p0", "station", 0));
    const { crane } = rig("remote");
    const down = createDownlink(
      screenCh,
      { side: 0, now: () => t },
      {
        pad: (_pos, m) => crane.setTargetNorm(m.x / 1000, m.y / 1000),
        release: () => crane.release(),
        block: (_pos, m) => crane.arrive(m.k, -2),
        exit: () => {},
      },
    );
    const up = createUplink(frameCh, 0, () => t);
    const aim: { held: { x: number; y: number } | null } = { held: null };
    let sentAt = -1;
    const bot = createPilot({
      rng: createRng("remote-bot"),
      sloppy: true,
      hand: {
        aim: (x, y) => {
          aim.held = { x, y };
        },
        release: () => up.release(0, true),
        rest: () => {
          aim.held = null;
        },
      },
    });
    let stAt = -1;
    let blockAt = 0;
    for (let i = 0; i < 300 / DT; i++) {
      t += DT * 1000;
      // The screen: its crane, and its word every ST_MS.
      crane.step(DT);
      crane.events.length = 0;
      if (t - stAt >= ST_MS) {
        stAt = t;
        down.send("p0", { s: 0, cr: [stateFromCrane(crane, 0, 1, "bot", true)] });
      }
      // The frame: blocks up now and then, and the bot's aim at 15 Hz.
      const st = up.state(0);
      if (st && t - blockAt > 3000 && st.fr > 0) {
        blockAt = t;
        up.block({ c: 0, k: i % 3, h: 0 });
      }
      if (st) bot.update(DT, readoutFromState(st));
      const held = aim.held;
      if (held && t - sentAt >= 66) {
        sentAt = t;
        up.pad({ c: 0, x: held.x * 1000, y: held.y * 1000, h: 1, b: 1 });
      }
    }
    expect(crane.counts.arrived).toBeGreaterThan(20);
    expect(crane.counts.placed).toBeGreaterThanOrEqual(8);
    down.dispose();
    up.dispose();
  });
});
