import { afterEach, describe, expect, it } from "vitest";
import {
  BASE_DELAY_MS,
  HOST_LOST_MS,
  HOST_WAIT_MS,
  LOCAL_AFTER_MS,
  readConfig,
  SPACING,
} from "../../../src/apps/traffic/config";
import { startCount } from "../../../src/apps/traffic/driver";
import { type BankLink, createLink, PREDICT_AFTER_MS } from "../../../src/apps/traffic/link";
import type { WireCar } from "../../../src/apps/traffic/wire";
import { fakeNet, peer } from "./helpers";

const CLOCK = 1_792_000_000_000;
const cfg = readConfig({});

const bank = (panels = 4, screen = true) => {
  let T = 0;
  const net = fakeNet();
  const brakes: number[] = [];
  const make = (frame: string, isScreen: boolean, pos: number) =>
    createLink({
      net: net.channel(peer(frame, isScreen ? "screen" : "station", pos)),
      clock: () => CLOCK + T,
      local: () => T,
      isScreen,
      pos,
      config: cfg,
      seed: 7,
      ringLength: () => 40.5 * panels,
      baseCount: (L) => startCount(L, SPACING.many),
      defaults: (L) => ({ count: startCount(L, SPACING.many), limit: 1, smart: 0 }),
      onBrake: (car) => brakes.push(car),
    });
  const links = new Map<string, BankLink>();
  if (screen) links.set("scr", make("scr", true, 0));
  for (let i = 0; i < panels; i++) links.set(`p${i}`, make(`p${i}`, false, i));
  const run = (ms: number, each?: () => void) => {
    const end = T + ms;
    while (T < end) {
      T += 1000 / 60;
      net.setNow(T);
      for (const l of links.values()) l.tick();
      each?.();
    }
  };
  /** Each frame's cars as it would draw them now. */
  const drawn = (frame: string) => {
    const l = links.get(frame)!;
    const out: WireCar[] = [];
    l.feed.at(CLOCK + T - l.delay, out);
    return out.map((c) => ({ ...c }));
  };
  return {
    net,
    links,
    run,
    drawn,
    brakes,
    make,
    add(frame: string, isScreen: boolean, pos: number) {
      links.set(frame, make(frame, isScreen, pos));
    },
    get T() {
      return T;
    },
  };
};

const hosts = (links: Map<string, BankLink>) =>
  [...links].filter(([, l]) => l.hosting).map(([f]) => f);

/** The largest jump of any car between two looks, metres, round a ring of length L. */
const jump = (a: WireCar[], b: WireCar[], L: number) => {
  let worst = 0;
  for (const c of b) {
    const o = a.find((x) => x.id === c.id);
    if (!o) continue;
    let d = Math.abs(c.x - o.x);
    d = Math.min(d, L - d);
    worst = Math.max(worst, d);
  }
  return worst;
};

describe("bank link", () => {
  let disposeAll: (() => void) | null = null;
  afterEach(() => disposeAll?.());

  it("the screen hosts and every panel draws its cars", () => {
    const b = bank();
    disposeAll = () => b.links.forEach((l) => l.dispose());
    b.run(HOST_WAIT_MS + 1000);
    expect(hosts(b.links)).toEqual(["scr"]);
    for (const f of ["p0", "p1", "p2", "p3"]) {
      expect(b.links.get(f)!.host).toBe("scr");
      expect(b.drawn(f).length).toBe(startCount(162, SPACING.many));
    }
    // Everyone draws the same moment.
    const ref = b.drawn("p0");
    for (const f of ["scr", "p1", "p2", "p3"])
      expect(jump(ref, b.drawn(f), 162)).toBeLessThan(0.05);
  });

  it("when the screen leaves, the first panel carries on with the same cars, without a jump", () => {
    const b = bank();
    disposeAll = () => b.links.forEach((l) => l.dispose());
    b.run(5000);
    const ids = b
      .drawn("p2")
      .map((c) => c.id)
      .sort();
    let last = b.drawn("p2");
    let worst = 0;
    let leftAt = 0;
    b.net.remove("scr");
    b.links.get("scr")!.dispose();
    b.links.delete("scr");
    leftAt = b.T;
    let hostedAfter: number | null = null;
    b.run(4000, () => {
      const now = b.drawn("p2");
      // Cars move about 0.25 m a frame; anything much more is a jump.
      worst = Math.max(worst, jump(last, now, 162));
      last = now;
      if (hostedAfter === null && b.links.get("p0")!.hosting) hostedAfter = b.T - leftAt;
    });
    expect(hostedAfter).not.toBeNull();
    expect(hostedAfter!).toBeLessThan(HOST_LOST_MS + 200);
    expect(hosts(b.links)).toEqual(["p0"]);
    for (const f of ["p1", "p2", "p3"]) expect(b.links.get(f)!.host).toBe("p0");
    expect(
      b
        .drawn("p2")
        .map((c) => c.id)
        .sort(),
    ).toEqual(ids);
    expect(worst).toBeLessThan(0.6);
  });

  it("a screen that vanishes but stays listed is passed over just the same", () => {
    const b = bank();
    disposeAll = () => b.links.forEach((l) => l.dispose());
    b.run(5000);
    b.net.silence("scr");
    b.run(HOST_LOST_MS + 400);
    expect(hosts(b.links).filter((f) => f !== "scr")).toEqual(["p0"]);
    b.run(2000);
    for (const f of ["p1", "p2", "p3"]) expect(b.links.get(f)!.host).toBe("p0");
  });

  it("panels predict the cars themselves while nobody hosts", () => {
    const b = bank();
    disposeAll = () => b.links.forEach((l) => l.dispose());
    b.run(5000);
    b.net.silence("scr");
    b.run(PREDICT_AFTER_MS + 100);
    const p2 = b.links.get("p2")!;
    expect(p2.predicting).toBe(true);
    const before = b.drawn("p2");
    b.run(300);
    // Still moving.
    expect(jump(before, b.drawn("p2"), 162)).toBeGreaterThan(0.5);
  });

  it("a panel cut off from the rest predicts the cars, then knows it is on its own", () => {
    const b = bank();
    disposeAll = () => b.links.forEach((l) => l.dispose());
    b.run(5000);
    b.net.silence("p2");
    b.run(LOCAL_AFTER_MS + 500);
    const p2 = b.links.get("p2")!;
    // It isn't next in line (p0 and p1 are still listed), so the touch frame will play its own
    // ring rather than host; until then its prediction kept the cars going.
    expect(p2.hosting).toBe(false);
    expect(p2.nextInLine()).toBe(false);
    expect(p2.quiet(b.T)).toBeGreaterThan(LOCAL_AFTER_MS);
    expect(p2.predicting).toBe(true);
    // The rest of the bank carries on with the screen.
    expect(b.links.get("p1")!.host).toBe("scr");
  });

  it("a screen that arrives later takes over the panel's cars", () => {
    const b = bank(4, false);
    disposeAll = () => b.links.forEach((l) => l.dispose());
    b.run(6000);
    expect(hosts(b.links)).toEqual(["p0"]);
    const ids = b
      .drawn("p1")
      .map((c) => c.id)
      .sort();
    b.add("scr", true, 0);
    b.run(HOST_WAIT_MS + 1000);
    expect(hosts(b.links)).toEqual(["scr"]);
    expect(b.links.get("p1")!.host).toBe("scr");
    expect(
      b
        .drawn("p1")
        .map((c) => c.id)
        .sort(),
    ).toEqual(ids);
  });

  it("two hosts at once settle on the better one", () => {
    const b = bank(3, false);
    disposeAll = () => b.links.forEach((l) => l.dispose());
    b.run(6000);
    expect(hosts(b.links)).toEqual(["p0"]);
    // A frame that hosts at once (as a lone frame would) hears the better host and gives way.
    const late = createLink({
      net: b.net.channel(peer("p5", "station", 5)),
      clock: () => CLOCK + b.T,
      local: () => b.T,
      isScreen: false,
      pos: 5,
      config: cfg,
      seed: 7,
      ringLength: () => 999,
      baseCount: () => 20,
      defaults: () => ({ count: 20, limit: 1, smart: 0 }),
      eager: true,
    });
    b.links.set("p5", late);
    b.run(30);
    expect(late.hosting).toBe(true);
    b.run(500);
    expect(hosts(b.links)).toEqual(["p0"]);
    expect(late.host).toBe("p0");
  });

  it("brakes and controls from any panel reach the host", () => {
    const b = bank();
    disposeAll = () => b.links.forEach((l) => l.dispose());
    b.run(4000);
    const scr = b.links.get("scr")!;
    const car = scr.driver!.ring.cars[5]!.id;
    b.links.get("p3")!.brake(car, 1000, true);
    b.run(50);
    expect(scr.driver!.ring.cars.find((c) => c.id === car)!.mark).toBe(1);
    expect(b.brakes).toEqual([car]);
    b.links.get("p1")!.ctl(1, 2, true);
    b.links.get("p2")!.ctl(0, 1, true);
    b.run(200);
    for (const l of b.links.values()) {
      expect(l.settings()!.limit).toBe(2);
      expect(l.settings()!.count).toBeGreaterThan(startCount(162, SPACING.many));
    }
  });

  it("draws later when snapshots arrive late, all frames agreeing on how much", () => {
    const b = bank();
    disposeAll = () => b.links.forEach((l) => l.dispose());
    b.run(4000);
    expect(b.links.get("p0")!.delay).toBeCloseTo(BASE_DELAY_MS, 0);
    b.net.setLatency(300);
    b.run(6000);
    const delays = [...b.links.values()].map((l) => l.delay);
    for (const d of delays) {
      expect(d).toBeGreaterThan(350);
      expect(d).toBeLessThan(500);
      expect(Math.abs(d - delays[0]!)).toBeLessThan(1);
    }
    // And they draw the same cars in the same places.
    const ref = b.drawn("p0");
    for (const f of ["p1", "p2", "p3"]) expect(jump(ref, b.drawn(f), 162)).toBeLessThan(0.05);
  });
});
