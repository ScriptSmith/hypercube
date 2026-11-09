import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDownlink, createUplink, SKY_GRACE_MS } from "../../../src/apps/gravity/link";
import {
  decodeAim,
  decodeCtl,
  decodeGo,
  decodeSky,
  encodeAim,
  encodeCtl,
  encodeGo,
  encodeSky,
  type GoMsg,
  type SkyMsg,
  TOPIC,
} from "../../../src/apps/gravity/wire";
import { fakeNet, peer } from "./helpers";

const sky = (k = 10): SkyMsg =>
  encodeSky({
    w: 6 * 1080,
    h: 5832,
    k,
    b: [[2700.03, -2916.11, 9.2e9, 400.5]],
    f: 2,
    sc: 0,
    vs: 100,
    z: 0,
  });

const go = (over: Partial<GoMsg> = {}): GoMsg => ({
  k: 0,
  p: 0,
  c: 3,
  b: 1,
  x: 4860.5,
  y: 1570,
  vx: 300.25,
  vy: -1500.0625,
  s: 1000,
  sn: 900,
  h: 1,
  ...over,
});

describe("messages", () => {
  it("round-trip through JSON exactly", () => {
    const s = sky();
    expect(decodeSky(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const g = encodeGo(go());
    expect(decodeGo(JSON.parse(JSON.stringify(g)))).toEqual(g);
    const a = encodeAim({ p: 1, c: 2, b: 3, x: 10, y: 20, vx: 1, vy: -2, sn: 5, off: 0 });
    expect(decodeAim(JSON.parse(JSON.stringify(a)))).toEqual(a);
    const c = encodeCtl({ t: -1, sc: 0, z: 0, h: 1 });
    expect(decodeCtl(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it("drop anything malformed or out of range, whole", () => {
    expect(decodeSky({ ...sky(), b: [[1, 2, 3]] })).toBeNull();
    expect(decodeSky({ ...sky(), b: Array.from({ length: 17 }, () => [0, 0, 5, 5]) })).toBeNull();
    expect(decodeSky({ ...sky(), f: 7 })).toBeNull();
    expect(decodeSky({ ...sky(), w: Number.NaN })).toBeNull();
    expect(decodeSky("sky")).toBeNull();
    expect(decodeGo({ ...go(), p: 9 })).toBeNull();
    expect(decodeGo({ ...go(), b: 4 })).toBeNull();
    expect(decodeGo({ ...go(), y: -5 })).toBeNull();
    expect(decodeGo({ ...go(), vx: 1e9 })).toBeNull();
    expect(decodeGo({ ...go(), sn: 1.5 })).toBeNull();
    expect(decodeAim({ p: 0, c: 0, b: 0, x: 0, y: 0, vx: 0, vy: 0, sn: 0 })).toBeNull();
    expect(decodeCtl({ t: 2, sc: 0, z: 0, h: 0 })).toBeNull();
    expect(decodeCtl([1, 0])).toBeNull();
  });

  it("quantise positions to sixteenths and keep at most 16 bodies in a snapshot", () => {
    const s = encodeSky({
      w: 1000.01,
      h: 900,
      k: 5,
      b: Array.from(
        { length: 20 },
        (_, i) => [i + 0.031, -i, 1000 + i, 3] as [number, number, number, number],
      ),
      f: 9,
      sc: -1,
      vs: 1000,
      z: 1,
    });
    expect(s.b).toHaveLength(16);
    expect(s.b[0]![0]! * 16).toBe(Math.round(s.b[0]![0]! * 16));
    expect([s.f, s.sc, s.vs]).toEqual([4, 0, 300]);
  });
});

describe("the link between a bank's frames and its screen", () => {
  let now = 0;
  beforeEach(() => {
    now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  const setup = () => {
    const net = fakeNet();
    const screen = net.channel(peer("scr", "screen"));
    const frame = net.channel(peer("p2", "station", 2));
    const stranger = net.channel(peer("odd", "screen", 0, 1));
    const up = createUplink(frame, 0, () => now);
    const got: { topic: string; from: string }[] = [];
    const down = createDownlink(
      screen,
      { side: 0, count: () => 10, step: () => 1000, now: () => now },
      {
        go: (_m, from) => got.push({ topic: "go", from: from.frame }),
        aim: (_m, from) => got.push({ topic: "aim", from: from.frame }),
        ctl: (_m, from) => got.push({ topic: "ctl", from: from.frame }),
      },
    );
    return { net, screen, frame, stranger, up, down, got };
  };

  it("finds its screen from the sky, ignores the other side's, and notices when it goes", () => {
    const { up, down, stranger } = setup();
    expect(up.screen()).toBeNull();
    stranger.send(TOPIC.sky, sky());
    expect(up.screen()).toBeNull();
    down.tick(() => sky());
    expect(up.screen()).toBe("scr");
    expect(up.sky()?.b).toHaveLength(1);
    now += SKY_GRACE_MS + 10;
    expect(up.screen()).toBeNull();
  });

  it("sends go, aim and ctl to its screen, which takes them only from its own frames", () => {
    const { up, down, got, stranger } = setup();
    down.tick(() => sky());
    expect(up.go(go())).toBe(true);
    expect(up.aim({ p: 0, c: 0, b: 0, x: 4860, y: 1570, vx: 0, vy: -100, sn: 10, off: 0 })).toBe(
      true,
    );
    expect(up.ctl({ t: 1, sc: 0, z: 0, h: 1 })).toBe(true);
    stranger.send(TOPIC.go, encodeGo(go()));
    expect(got).toEqual([
      { topic: "go", from: "p2" },
      { topic: "aim", from: "p2" },
      { topic: "ctl", from: "p2" },
    ]);
  });

  it("refuses floods and launches whose step is far from the screen's", () => {
    const { up, down, got } = setup();
    down.tick(() => sky());
    for (let i = 0; i < 5; i++) up.go(go());
    expect(got.filter((g) => g.topic === "go")).toHaveLength(1);
    now += 500;
    up.go(go({ s: 1000 + 10_000 }));
    expect(got.filter((g) => g.topic === "go")).toHaveLength(1);
    up.go(go({ s: 1001 }));
    expect(got.filter((g) => g.topic === "go")).toHaveLength(2);
    for (let i = 0; i < 5; i++) up.ctl({ t: -1, sc: 0, z: 0, h: 1 });
    expect(got.filter((g) => g.topic === "ctl")).toHaveLength(1);
  });
});
