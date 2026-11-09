import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDownlink,
  createUplink,
  delayFor,
  MAX_DELAY_MS,
} from "../../../src/apps/kaleido/link";
import {
  decodeInk,
  encodeInk,
  encodeSky,
  FORGET_MS,
  type InkMsg,
  SKY_TIMEOUT_MS,
  TOPIC,
  type WireFinger,
} from "../../../src/apps/kaleido/wire";
import { fakeNet, peer } from "./helpers";

const finger = (id: number, y = 0.5, over: Partial<WireFinger> = {}): WireFinger => ({
  id,
  x: 0.25,
  y,
  vx: 0,
  vy: 0,
  rgb: 0xffaa00,
  hot: false,
  human: true,
  ...over,
});

let now = 0;
beforeEach(() => {
  now = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

describe("touch frame uplink", () => {
  const setup = () => {
    const net = fakeNet();
    const screen = net.channel(peer("scr", "screen"));
    const panel = net.channel(peer("p2", "station", 2));
    net.channel(peer("b-scr", "screen", 0, 1));
    const up = createUplink(panel, 0);
    const got: InkMsg[] = [];
    screen.on(TOPIC.ink, (d) => got.push(decodeInk(d)!));
    const beacon = () => screen.send(TOPIC.sky, encodeSky({ side: 0, variant: "strata", k: null }));
    return { net, screen, panel, up, got, beacon };
  };

  it("sends nothing without its screen's beacon, then about 30 a second while touched", () => {
    const { up, got, beacon } = setup();
    let fingers = [finger(0)];
    const build = () => ({ pos: 2, count: 6, fingers });
    for (let i = 0; i < 60; i++) {
      now += 1000 / 60;
      up.tick(now, build);
    }
    expect(got).toHaveLength(0);
    beacon();
    for (let i = 0; i < 120; i++) {
      now += 1000 / 60;
      if (i % 30 === 0) beacon();
      up.tick(now, build);
    }
    expect(got.length).toBeGreaterThanOrEqual(56);
    expect(got.length).toBeLessThanOrEqual(61);
    expect(up.screen(now)).toBe("scr");
    // Lifting sends one empty message, then nothing.
    fingers = [];
    const before = got.length;
    for (let i = 0; i < 60; i++) {
      now += 1000 / 60;
      if (i % 30 === 0) beacon();
      up.tick(now, build);
    }
    expect(got.length).toBe(before + 1);
    expect(got[got.length - 1]!.fingers).toHaveLength(0);
  });

  it("ignores beacons from other sides and from frames that aren't screens", () => {
    const { net, up, panel } = setup();
    const other = net.channel(peer("p3", "station", 3));
    other.send(TOPIC.sky, encodeSky({ side: 0, variant: "strata", k: null }));
    const b = net.channel(peer("b2", "screen", 0, 1));
    b.send(TOPIC.sky, encodeSky({ side: 1, variant: "strata", k: null }));
    expect(up.screen(now)).toBeNull();
    expect(panel.self).toBe("p2");
  });

  it("gives up on the screen SKY_TIMEOUT_MS after its last beacon", () => {
    const { up, beacon } = setup();
    beacon();
    now += SKY_TIMEOUT_MS - 10;
    expect(up.screen(now)).toBe("scr");
    expect(up.sky(now)?.variant).toBe("strata");
    now += 20;
    expect(up.screen(now)).toBeNull();
    expect(up.sky(now)).toBeNull();
  });
});

describe("screen downlink", () => {
  const setup = () => {
    const net = fakeNet();
    const screen = net.channel(peer("scr", "screen"));
    const panel = net.channel(peer("p1", "station", 1));
    const down = createDownlink(screen, 0);
    const send = (fingers: WireFinger[]) =>
      panel.send(TOPIC.ink, encodeInk({ pos: 1, count: 6, fingers }), "scr");
    return { net, screen, panel, down, send };
  };

  it("pours each finger a little late, later the lower it is on its frame", () => {
    expect(delayFor(0)).toBeLessThan(delayFor(1));
    expect(delayFor(1)).toBe(MAX_DELAY_MS);
    const { down, send } = setup();
    const t0 = now;
    // A finger near the top and one at the bottom, held for a second.
    for (let i = 0; i < 30; i++) {
      send([finger(0, 0.05), finger(1, 1)]);
      now += 1000 / 30;
    }
    const seen = (at: number) => {
      now = at;
      return down
        .fingers(now)
        .map((f) => f.id)
        .sort();
    };
    expect(seen(t0 + delayFor(0.05) + 20)).toEqual([0]);
    expect(seen(t0 + delayFor(1) + 20)).toEqual([0, 1]);
  });

  it("ends a lifted finger after the same delay, and forgets a frame that went quiet", () => {
    const { down, send } = setup();
    for (let i = 0; i < 30; i++) {
      send([finger(0, 0.5)]);
      now += 1000 / 30;
    }
    const lift = now;
    send([]);
    now = lift + delayFor(0.5) - 50;
    expect(down.fingers(now)).toHaveLength(1);
    now = lift + delayFor(0.5) + 50;
    expect(down.fingers(now)).toHaveLength(0);

    // A frame that vanishes mid-pour stops pouring FORGET_MS after its last message.
    const t1 = now;
    for (let i = 0; i < 10; i++) {
      send([finger(3, 0)]);
      now += 1000 / 30;
    }
    const last = now - 1000 / 30;
    now = last + delayFor(0) + FORGET_MS - 20;
    expect(down.fingers(now).map((f) => f.id)).toEqual([3]);
    now = last + delayFor(0) + FORGET_MS + 40;
    expect(down.fingers(now)).toHaveLength(0);
    expect(down.frames(now)).toBe(1);
    expect(t1).toBeLessThan(now);
    now += 4000;
    expect(down.frames(now)).toBe(0);
  });

  it("tells people's fingers from bots' and remembers when each touched", () => {
    const { down, send } = setup();
    send([finger(0, 0, { human: false })]);
    now += 500;
    expect(down.human(now, 1000)).toBe(false);
    send([finger(0, 0, { human: false }), finger(1, 0)]);
    expect(down.human(now, 1000)).toBe(true);
    now += 400;
    const f = down.fingers(now);
    expect(f.find((x) => x.id === 0)!.since).toBeLessThan(f.find((x) => x.id === 1)!.since);
  });

  it("takes ink only from touch frames on its side, and only well-formed", () => {
    const { net, down } = setup();
    const otherSide = net.channel(peer("q1", "station", 1, 1));
    otherSide.send(TOPIC.ink, encodeInk({ pos: 1, count: 6, fingers: [finger(0, 0)] }), "scr");
    const otherScreen = net.channel(peer("s2", "screen"));
    otherScreen.send(TOPIC.ink, encodeInk({ pos: 1, count: 6, fingers: [finger(0, 0)] }), "scr");
    const p = net.channel(peer("p5", "station", 5));
    p.send(TOPIC.ink, { p: 5, n: 6, f: [1, 2, 3] }, "scr");
    now += 1000;
    expect(down.fingers(now)).toHaveLength(0);
    expect(down.received).toBe(0);
  });

  it("beacons twice a second", () => {
    const { net, screen, down } = setup();
    const panel = net.channel(peer("p5", "station", 5));
    let beacons = 0;
    panel.on(TOPIC.sky, () => beacons++);
    for (let i = 0; i < 300; i++) {
      now += 1000 / 60;
      down.beacon(now, () => ({ side: 0, variant: "strata", k: null }));
    }
    expect(beacons).toBeGreaterThanOrEqual(9);
    expect(beacons).toBeLessThanOrEqual(11);
    expect(screen.self).toBe("scr");
  });

  it("stays bounded with a history of about three seconds per frame", () => {
    const { down, send } = setup();
    for (let i = 0; i < 3000; i++) {
      send([finger(i % 64, 0.2)]);
      now += 1000 / 30;
      if (i % 50 === 0) down.fingers(now);
    }
    expect(down.fingers(now).length).toBeLessThanOrEqual(64);
  });
});
