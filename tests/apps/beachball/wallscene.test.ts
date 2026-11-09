import { describe, expect, it } from "vitest";
import { type BotBall, createWallBots } from "../../../src/apps/beachball/wallbots";
import { createFx, fadeOf, MAX_PARTICLES } from "../../../src/apps/beachball/wallfx";
import { ballShadow, wallLayout } from "../../../src/apps/beachball/walllayout";
import { makeNoise } from "../../../src/apps/beachball/wallscene";
import {
  BIG_GAP,
  createSea,
  FIRST_BIG,
  WOBBLE,
  WOBBLE_PERIOD,
} from "../../../src/apps/beachball/wallsea";
import { SUN } from "../../../src/apps/beachball/wallshade";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { createRng } from "../../../src/core/rng";

const WALL = VENUE_SIZE.wall;
const layout = wallLayout(WALL.width, WALL.height, DEFAULT_REACH.wall, 2);

describe("the wash up the sand", () => {
  it("runs up and back between the shore and the balls, with big waves past them now and then", () => {
    const sea = createSea(createRng("sea"), {
      shore: layout.shore,
      floor: layout.floor,
      big: true,
    });
    const dt = 1 / 10;
    let lowest = Infinity;
    const bigAt: number[] = [];
    let lastCount = 0;
    let outOfRange = 0;
    for (let t = 0; t < 3600; t += dt) {
      sea.step(dt);
      if (sea.edge > layout.shore + 1e-9 || sea.edge <= 0) outOfRange++;
      if (sea.wetTo > sea.edge - WOBBLE + 1e-9) outOfRange++;
      lowest = Math.min(lowest, sea.edge);
      if (sea.bigCount > lastCount) {
        bigAt.push(sea.time);
        lastCount = sea.bigCount;
      }
    }
    expect(outOfRange).toBe(0);
    // Big waves reach past the balls' line of sand.
    expect(lowest).toBeLessThan(layout.floor);
    expect(bigAt[0]!).toBeGreaterThanOrEqual(FIRST_BIG[0]);
    expect(bigAt[0]!).toBeLessThan(FIRST_BIG[1] + 14);
    for (let i = 1; i < bigAt.length; i++) {
      const gap = bigAt[i]! - bigAt[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(BIG_GAP[0]);
      expect(gap).toBeLessThan(BIG_GAP[1] + 14);
    }
    expect(bigAt.length).toBeGreaterThan(15);
  });

  it("keeps to ordinary waves without big ones, and dries back up the beach", () => {
    const sea = createSea(createRng("calm"), {
      shore: layout.shore,
      floor: layout.floor,
      big: false,
    });
    sea.surge();
    for (let t = 0; t < 600; t += 0.05) {
      sea.step(0.05);
      expect(sea.edge).toBeGreaterThan(layout.floor + 0.3);
    }
    expect(sea.bigCount).toBe(0);
    expect(sea.nextBig).toBe(Infinity);

    const big = createSea(createRng("big"), {
      shore: layout.shore,
      floor: layout.floor,
      big: true,
    });
    big.surge();
    for (let t = 0; t < 14; t += 0.05) big.step(0.05);
    const soaked = big.wetTo;
    expect(soaked).toBeLessThan(layout.floor);
    for (let t = 0; t < 60; t += 0.05) big.step(0.05);
    expect(big.wetTo).toBeGreaterThan(soaked + 0.2);
  });

  it("ripples along the beach the same way each period, so wrapped time is seamless", () => {
    const sea = createSea(createRng("wrap"), {
      shore: layout.shore,
      floor: layout.floor,
      big: false,
    });
    for (let t = 0; t < 5; t += 0.1) sea.step(0.1);
    const a = sea.edgeAt(3.3) - sea.edge;
    for (let t = 0; t < WOBBLE_PERIOD; t += 0.1) sea.step(0.1);
    expect(sea.edgeAt(3.3) - sea.edge).toBeCloseTo(a, 6);
    expect(Math.abs(a)).toBeLessThanOrEqual(WOBBLE + 1e-9);
  });
});

describe("shadows on the sand", () => {
  const r = layout.radius;
  const rest = layout.floor + r;

  it("lie under each ball and sharpen as it comes down", () => {
    let last = ballShadow(5, rest + 3.5, r, layout.floor, layout.horizon, SUN);
    for (let h = 3.4; h >= 0; h -= 0.1) {
      const s = ballShadow(5, rest + h, r, layout.floor, layout.horizon, SUN);
      // Under the ball: within a radius to the side, on the sand below the shore.
      expect(Math.abs(s.x - 5)).toBeLessThan(r + 0.25 * h);
      expect(s.y).toBeGreaterThanOrEqual(layout.floor);
      expect(s.y + s.hy).toBeLessThan(layout.shore);
      expect(s.hy).toBeLessThan(s.hx);
      expect(s.alpha).toBeGreaterThanOrEqual(last.alpha);
      expect(s.soft).toBeLessThanOrEqual(last.soft);
      last = s;
    }
    const down = ballShadow(5, rest, r, layout.floor, layout.horizon, SUN);
    expect(down.alpha).toBeCloseTo(0.5, 6);
    expect(Math.abs(down.x - 5)).toBeLessThan(0.2);
    expect(down.y - layout.floor).toBeLessThan(0.1);
  });
});

describe("effects", () => {
  it("stay within their pool and fade within about a second", () => {
    const fx = createFx(createRng("fx"));
    for (let i = 0; i < 400; i++) {
      fx.puff(i % 13, 0.15, 8);
      fx.splash(i % 7, 0.15, 6);
      fx.shed(3, 1, 0.45, 2, 3, 6);
      fx.ripple(2, 2, 1);
      expect(fx.list.length).toBeLessThanOrEqual(MAX_PARTICLES);
      fx.step(1 / 60);
    }
    for (const p of fx.list) expect(fadeOf(p)).toBeLessThanOrEqual(1);
    for (let i = 0; i < 90; i++) fx.step(1 / 60);
    expect(fx.list.length).toBe(0);
  });

  it("lets thrown sand fall back and stop on the sand", () => {
    const fx = createFx(createRng("land"));
    fx.puff(4, 0.15, 6);
    let lowest = Infinity;
    for (let i = 0; i < 40; i++) {
      fx.step(1 / 60);
      for (const p of fx.list) if (p.gravity > 0 || p.vy === 0) lowest = Math.min(lowest, p.y);
    }
    expect(lowest).toBeGreaterThan(0.15 - 0.07);
  });
});

describe("noise for the beach", () => {
  it("fills every channel and tiles smoothly across its edges", () => {
    const n = makeNoise(createRng("noise"), 64);
    const at = (x: number, y: number, c: number) => n[((y % 64) * 64 + (x % 64)) * 4 + c]!;
    for (const c of [0, 1, 2]) {
      let jump = 0;
      for (let y = 0; y < 64; y++) jump = Math.max(jump, Math.abs(at(63, y, c) - at(0, y, c)));
      let step = 0;
      for (let y = 0; y < 64; y++)
        for (let x = 1; x < 64; x++) step = Math.max(step, Math.abs(at(x, y, c) - at(x - 1, y, c)));
      expect(jump).toBeLessThanOrEqual(step + 1);
    }
    const values = new Set(Array.from({ length: 64 * 64 }, (_, i) => n[i * 4 + 3]));
    expect(values.size).toBeGreaterThan(200);
  });
});

describe("wall bots", () => {
  it("touch only within an adult's reach, and lift every finger on release", () => {
    const presses: { x: number; y: number }[] = [];
    const live = new Set<number>();
    let next = 1;
    const input = {
      inject: {
        down: (x: number, y: number) => {
          presses.push({ x, y });
          live.add(next);
          return next++;
        },
        move: (_id: number, x: number, y: number) => presses.push({ x, y }),
        up: (id: number) => {
          live.delete(id);
        },
      },
    };
    const W = 1280;
    const H = 480;
    const reachTop = H * 0.55;
    const balls: BotBall[] = [
      { x: 320, y: H - 40, r: 43, vx: 0, vy: 0, held: false },
      { x: 960, y: H - 40, r: 43, vx: 0, vy: 0, held: false },
      // Out of reach and rising: left alone.
      { x: 640, y: 60, r: 43, vx: 0, vy: -400, held: false },
    ];
    const bots = createWallBots(
      input,
      createRng("bots"),
      {
        balls: () => balls,
        width: () => W,
        height: () => H,
        reachTop: () => reachTop,
      },
      3,
    );
    for (let i = 0; i < 60 * 30; i++) bots.update(1 / 60, true);
    expect(presses.length).toBeGreaterThan(20);
    for (const p of presses) {
      expect(p.y).toBeGreaterThanOrEqual(reachTop);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(W);
    }
    const m = bots.moves;
    expect(m.tap + m.throw).toBeGreaterThan(5);
    bots.update(1 / 60, false);
    expect(live.size).toBe(0);
    bots.dispose();
  });
});
