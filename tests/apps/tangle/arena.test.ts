import { describe, expect, it } from "vitest";
import { arenaParams, placings, speedUp } from "../../../src/apps/tangle/arena";
import { FADE_S, GAP_WIDTHS, HZ, SNAKE } from "../../../src/apps/tangle/config";
import { cellAt, createGrid, someCell } from "../../../src/apps/tangle/grid";
import { createRng } from "../../../src/core/rng";
import { down, left, right, run, up, wallArena } from "./helpers";

describe("grid", () => {
  it("visits the cells whose centres are within the radius", () => {
    const g = createGrid(80, 80, 8);
    const seen: number[] = [];
    someCell(g, 40, 40, 8, (i) => {
      seen.push(i);
      return false;
    });
    // A point on a cell corner has the four cells around it within one cell's width.
    expect(seen.sort((a, b) => a - b)).toEqual(
      [4 * 10 + 4, 4 * 10 + 5, 5 * 10 + 4, 5 * 10 + 5].sort((a, b) => a - b),
    );
    expect(cellAt(g, 41, 39)).toBe(4 * 10 + 5);
    expect(cellAt(g, -1, 5)).toBe(-1);
    expect(cellAt(g, 5, 80)).toBe(-1);
  });

  it("stops at the first cell that answers true", () => {
    const g = createGrid(80, 80, 8);
    let calls = 0;
    expect(
      someCell(g, 44, 44, 12, () => {
        calls++;
        return true;
      }),
    ).toBe(true);
    expect(calls).toBe(1);
  });
});

describe("arena", () => {
  it("sizes lines for the arena", () => {
    expect(arenaParams(6400, 1800)).toEqual({ trail: 16, speed: 320, radius: 100, lane: 16 });
    // Grid snakes are thicker, on lanes twice their width, at the same speed.
    expect(arenaParams(6400, 1800, "grid")).toEqual({
      trail: 24,
      speed: 320,
      radius: 100,
      lane: 48,
    });
    const small = arenaParams(1050, 1100);
    expect(small.radius).toBeLessThan(70);
    expect(small.trail).toBeGreaterThanOrEqual(12);
  });

  it("moves at constant speed and never trips on its own fresh trail", () => {
    const a = wallArena();
    a.start([up(1000, 1700)], 1);
    run(a, HZ);
    const l = a.lines[0]!;
    expect(l.alive).toBe(true);
    expect(1700 - l.y).toBeCloseTo(320, 0);
  });

  it("turns at most on a circle of the turning radius", () => {
    const a = wallArena();
    a.start([up(3000, 1000)], 1);
    a.lines[0]!.dir = 1;
    // A quarter turn takes (pi / 2) * radius of travel.
    run(a, Math.round(((Math.PI / 2) * 100 * HZ) / 320));
    const l = a.lines[0]!;
    expect(l.heading).toBeCloseTo(0, 1);
    expect(l.x - 3000).toBeCloseTo(100, -1);
    expect(1000 - l.y).toBeCloseTo(100, -1);
  });

  it("stops a line at the edge", () => {
    const a = wallArena();
    a.start([up(1000, 200)], 1);
    const ticks = run(a, 2 * HZ, () => !a.lines[0]!.alive);
    expect(a.lines[0]!.alive).toBe(false);
    // 200 up from the start, less half a trail.
    expect(ticks).toBeGreaterThan(Math.floor(((200 - 16) * HZ) / 320));
    expect(ticks).toBeLessThanOrEqual(Math.ceil((200 * HZ) / 320) + 1);
  });

  it("stops a line that runs into another line's trail", () => {
    const a = wallArena();
    a.start([right(1000, 900), up(1600, 1700)], 1);
    // The first lays a trail across the second's path before the second gets there.
    const ticks = run(a, 4 * HZ, () => !a.lines[1]!.alive);
    expect(a.lines[1]!.alive).toBe(false);
    expect(a.lines[0]!.alive).toBe(true);
    expect(a.lines[1]!.y).toBeGreaterThan(900);
    expect(a.lines[1]!.y).toBeLessThan(930);
    // 800 up, less a trail width.
    expect(ticks).toBeCloseTo(((800 - 16) * HZ) / 320, -1);
  });

  it("stops a line that comes round onto its own trail", () => {
    const a = wallArena();
    a.start([up(3000, 1200)], 1);
    a.lines[0]!.dir = -1;
    const ticks = run(a, 5 * HZ, () => !a.lines[0]!.alive);
    expect(a.lines[0]!.alive).toBe(false);
    // Nearly a full circle: 2 pi r of travel.
    const travel = (ticks * 320) / HZ;
    expect(travel).toBeGreaterThan(2 * Math.PI * 100 * 0.85);
    expect(travel).toBeLessThan(2 * Math.PI * 100 * 1.05);
  });

  it("stops both lines when their heads meet", () => {
    const a = wallArena();
    a.start([right(2000, 900), left(2600, 900)], 1);
    run(a, 2 * HZ, () => !a.lines[0]!.alive || !a.lines[1]!.alive);
    expect(a.lines[0]!.alive).toBe(false);
    expect(a.lines[1]!.alive).toBe(false);
    expect(a.lines[0]!.outTick).toBe(a.lines[1]!.outTick);
    expect(a.finished()).toBe(true);
  });

  it("does not care which line is stepped first", () => {
    for (const order of [0, 1]) {
      const a = wallArena();
      const pair = [right(2000, 900), left(2600, 900)];
      a.start(order ? pair.reverse() : pair, 1);
      run(a, 2 * HZ, () => a.alive() < 2);
      expect(a.alive()).toBe(0);
    }
  });

  it("leaves gaps another line can slip through", () => {
    const a = wallArena({ gaps: true });
    a.start([right(1000, 900), down(1600, 700)], 1);
    const [h, v] = a.lines as [(typeof a.lines)[0], (typeof a.lines)[0]];
    h.nextGap = 1e9;
    v.nextGap = 1e9;
    // The second line waits off the board while the first lays a trail with a gap at x = 1600.
    v.alive = false;
    const gap = GAP_WIDTHS * 16;
    run(a, HZ * 2, () => h.x >= 1600 - gap / 2);
    h.gapLeft = gap;
    run(a, Math.round((gap * HZ) / 320) + 2);
    expect(h.alive).toBe(true);
    expect(a.blocks(cellAt(a.grid, 1600, 900), -1)).toBe(false);
    expect(a.blocks(cellAt(a.grid, 1450, 900), -1)).toBe(true);
    // Through the gap it goes.
    v.alive = true;
    v.y = 780;
    run(a, Math.round((240 * HZ) / 320));
    expect(v.alive).toBe(true);
    expect(v.y).toBeGreaterThan(1000);
    // Without the gap it would have stopped.
    const b = wallArena();
    b.start([right(1000, 900), down(1600, 700)], 1);
    const [h2, v2] = b.lines as [(typeof b.lines)[0], (typeof b.lines)[0]];
    v2.alive = false;
    run(b, HZ * 2, () => h2.x >= 1700);
    v2.alive = true;
    v2.y = 780;
    run(b, Math.round((240 * HZ) / 320));
    expect(v2.alive).toBe(false);
  });

  it("speeds up by 2 % a second after 30 seconds of trails", () => {
    expect(speedUp("trails", 10)).toBe(1);
    expect(speedUp("trails", 30)).toBe(1);
    expect(speedUp("trails", 40)).toBeCloseTo(1.2);
    expect(speedUp("trails", 80)).toBeCloseTo(2);
    expect(speedUp("snake", 80)).toBe(1);
    const a = wallArena();
    a.start([up(3000, 1790)], 1);
    // Steer in a slow circle out of everyone's way, for 40 seconds.
    a.lines[0]!.alive = false;
    run(a, 40 * HZ);
    expect(a.speed()).toBeCloseTo(320 * 1.2, 0);
  });

  it("lets fading trails stop blocking after FADE_S", () => {
    const a = wallArena({ trail: "fade" });
    a.start([right(1000, 900)], 1);
    run(a, HZ);
    const cell = cellAt(a.grid, 1100, 900);
    expect(a.blocks(cell, -1)).toBe(true);
    a.lines[0]!.alive = false;
    run(a, (FADE_S - 2) * HZ);
    expect(a.blocks(cell, -1)).toBe(true);
    run(a, 2 * HZ);
    expect(a.blocks(cell, -1)).toBe(false);
  });

  it("keeps round-long trails blocking", () => {
    const a = wallArena();
    a.start([right(1000, 900)], 1);
    run(a, HZ);
    a.lines[0]!.alive = false;
    run(a, (FADE_S + 5) * HZ);
    expect(a.blocks(cellAt(a.grid, 1100, 900), -1)).toBe(true);
  });

  it("ranks lines by when they went out, sharing ties", () => {
    const a = wallArena();
    a.start([up(500, 900), up(1500, 900), up(2500, 900), up(3500, 900)], 1);
    const [l0, l1, l2, l3] = a.lines as never as { alive: boolean; outTick: number }[];
    l0!.alive = false;
    l0!.outTick = 10;
    l1!.alive = false;
    l1!.outTick = 30;
    l2!.alive = false;
    l2!.outTick = 30;
    l3!.alive = true;
    expect(placings(a.lines, "trails")).toEqual([4, 2, 2, 1]);
  });
});

describe("snake", () => {
  const snakeArena = () => wallArena({ variant: "snake" });

  it("frees the cells behind its tail", () => {
    const a = snakeArena();
    a.start([right(500, 900)], 1);
    // Starting length is 24 segments of a trail width.
    run(a, Math.round(((24 * 16 + 200) * HZ) / 320));
    const l = a.lines[0]!;
    expect(l.bodyCount).toBe(SNAKE.start);
    expect(a.blocks(cellAt(a.grid, 520, 900), -1)).toBe(false);
    expect(a.blocks(cellAt(a.grid, l.x - 100, 900), -1)).toBe(true);
  });

  it("grows when it eats, up to the cap", () => {
    const a = snakeArena();
    a.start([right(500, 900)], 1);
    const l = a.lines[0]!;
    for (let i = 0; i < 60; i++) {
      const f = a.food[0]!;
      f.x = l.x + 30;
      f.y = l.y;
      f.live = true;
      run(a, 12);
    }
    expect(l.eaten).toBeGreaterThan(38);
    expect(l.len).toBe(SNAKE.max);
    // The body never holds more than the cap.
    run(a, Math.round(((SNAKE.max + 50) * 16 * HZ) / 320 / 3));
    expect(l.bodyCount).toBeLessThanOrEqual(SNAKE.max);
  });

  it("respawns at its start after a crash, at the starting length, and its body stops blocking", () => {
    const a = snakeArena();
    a.start([up(1000, 400)], 1);
    const l = a.lines[0]!;
    l.len = 100;
    run(a, 2 * HZ, () => !l.alive);
    expect(l.alive).toBe(false);
    const crashed = a.tick;
    expect(a.blocks(cellAt(a.grid, 1000, 350), -1)).toBe(false);
    run(a, Math.round((SNAKE.respawnMs / 1000) * HZ) - 2);
    expect(l.alive).toBe(false);
    run(a, 3);
    expect(l.alive).toBe(true);
    expect(a.tick - crashed).toBeCloseTo((SNAKE.respawnMs / 1000) * HZ, -1);
    expect(l.len).toBe(SNAKE.start);
    expect(l.deaths).toBe(1);
    expect(l.y).toBeGreaterThan(390);
  });

  it("puts food out and never finishes on its own", () => {
    const a = snakeArena();
    a.start([up(1000, 1700), up(3000, 1700)], 1);
    run(a, HZ);
    expect(a.food.filter((f) => f.live).length).toBeGreaterThan(3);
    a.lines[0]!.alive = false;
    a.lines[1]!.alive = false;
    expect(a.finished()).toBe(false);
  });

  it("ranks snakes by length", () => {
    const a = snakeArena();
    a.start([up(500, 900), up(1500, 900), up(2500, 900)], 1);
    a.lines[0]!.len = 40;
    a.lines[1]!.len = 90;
    a.lines[2]!.len = 40;
    expect(placings(a.lines, "snake")).toEqual([2, 1, 2]);
  });
});

describe("wrapping edges", () => {
  const W = 6400;
  const H = 1800;
  const wrapArena = (over: Parameters<typeof wallArena>[0] = {}) =>
    wallArena({ edges: "wrap", ...over });

  it("brings a line back in at the opposite edge, where a solid edge stops it", () => {
    // 300 units in 112.5 ticks.
    const ticks = 112;
    const d = (ticks * 320) / HZ;
    const cases = [
      { start: up(1000, 200), x: 1000, y: 200 - d + H },
      { start: down(1000, 1600), x: 1000, y: 1600 + d - H },
      { start: right(6200, 900), x: 6200 + d - W, y: 900 },
      { start: left(200, 900), x: 200 - d + W, y: 900 },
    ];
    for (const c of cases) {
      const a = wrapArena();
      a.start([c.start], 1);
      run(a, ticks);
      const l = a.lines[0]!;
      expect(l.alive).toBe(true);
      expect(l.x).toBeCloseTo(c.x, 0);
      expect(l.y).toBeCloseTo(c.y, 0);
      const b = wallArena();
      b.start([c.start], 1);
      run(b, ticks);
      expect(b.lines[0]!.alive).toBe(false);
    }
  });

  it("stops a line on a trail just past every edge it crosses", () => {
    const cases = [
      // Out through the right edge onto a trail near the left one.
      { block: down(40, 780), mover: right(6250, 900), past: (l: { x: number }) => l.x < 40 },
      { block: down(W - 40, 780), mover: left(150, 900), past: (l: { x: number }) => l.x > W - 40 },
      // Out through the top onto a trail near the bottom, and the other way.
      { block: right(880, H - 40), mover: up(1000, 150), past: (l: { y: number }) => l.y > H - 40 },
      { block: right(880, 40), mover: down(1000, 1650), past: (l: { y: number }) => l.y < 40 },
    ];
    for (const c of cases) {
      const a = wrapArena();
      a.start([c.block, c.mover], 1);
      const [b, m] = a.lines as [(typeof a.lines)[0], (typeof a.lines)[0]];
      m.alive = false;
      run(a, Math.round(0.75 * HZ));
      b.alive = false;
      m.alive = true;
      run(a, 2 * HZ, () => !m.alive);
      expect(m.alive).toBe(false);
      expect(c.past(m)).toBe(true);
    }
  });

  it("blocks from both sides a trail that straddles an edge", () => {
    const a = wrapArena();
    a.start([down(3, 780), right(6200, 900)], 1);
    const [b, m] = a.lines as [(typeof a.lines)[0], (typeof a.lines)[0]];
    m.alive = false;
    run(a, Math.round(0.75 * HZ));
    b.alive = false;
    m.alive = true;
    run(a, 2 * HZ, () => !m.alive);
    expect(m.alive).toBe(false);
    // The trail's far half is past the right edge, so the line stops before it gets there.
    expect(m.x).toBeGreaterThan(W - 40);
  });

  it("stops two heads that meet across an edge", () => {
    const a = wrapArena();
    a.start([right(W - 100, 900), left(100, 900)], 1);
    run(a, 2 * HZ, () => a.alive() < 2);
    expect(a.alive()).toBe(0);
    expect(a.lines[0]!.outTick).toBe(a.lines[1]!.outTick);
  });

  it("lays a trail that crosses an edge as pieces either side, never across the arena", () => {
    const a = wrapArena();
    a.start([right(W - 10, 900)], 1);
    run(a, 12);
    const st = a.stamps;
    const segs = Array.from({ length: st.count }, (_, e) => {
      const k = ((st.start + e) % st.cap) * 6;
      return Array.from(st.data.slice(k, k + 4));
    });
    const step = 320 / HZ;
    for (const s of segs) expect(Math.abs(s[2]! - s[0]!)).toBeLessThanOrEqual(step + 1e-3);
    expect(segs.some((s) => Math.abs(s[2]! - W) < 1e-3)).toBe(true);
    expect(segs.some((s) => Math.abs(s[0]!) < 1e-3)).toBe(true);
    // And the trail blocks on both sides of the edge.
    expect(a.blocks(cellAt(a.grid, W - 4, 900), -1)).toBe(true);
    expect(a.blocks(cellAt(a.grid, 10, 900), -1)).toBe(true);
  });

  it("lets a snake eat food across an edge", () => {
    const a = wrapArena({ variant: "snake" });
    a.start([right(W - 5, 900)], 1);
    const f = a.food[0]!;
    f.x = 5;
    f.y = 900;
    f.live = true;
    a.step();
    expect(a.lines[0]!.eaten).toBe(1);
  });

  it("puts food anywhere on the floor, clear of the lines the short way round", () => {
    const a = wrapArena({ variant: "snake", rng: createRng("food") });
    a.start([up(10, 1700), up(W - 10, 1700)], 1);
    run(a, 2 * HZ);
    for (const f of a.food.filter((g) => g.live)) {
      for (const l of a.lines) {
        const dx = Math.abs(f.x - l.x);
        expect(Math.min(dx, W - dx)).toBeGreaterThan(0);
      }
    }
    expect(a.food.filter((g) => g.live).length).toBeGreaterThan(3);
  });
});
