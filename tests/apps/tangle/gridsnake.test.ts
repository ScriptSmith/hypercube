import { describe, expect, it } from "vitest";
import { type Arena, type Line, laneFor } from "../../../src/apps/tangle/arena";
import { createBrain, runway, think, thinkGrid } from "../../../src/apps/tangle/bot";
import { FOOD_SIZE, GRID, HEAD_SIZE, HZ } from "../../../src/apps/tangle/config";
import { wrapDelta } from "../../../src/apps/tangle/wrap";
import { createRng } from "../../../src/core/rng";
import { down, right, run, up, wallArena } from "./helpers";

const RIGHT = 0;
const DOWN = 1;
const LEFT = 2;
const UP = 3;

const gridArena = (edges: "wrap" | "solid" = "solid", seed = "grid") =>
  wallArena({ variant: "grid", edges, rng: createRng(seed) });

/** Whether (x, y) is a lane cell centre. */
const onCentre = (a: Arena, x: number, y: number) => {
  const fi = x / a.lane.w - 0.5;
  const fj = y / a.lane.h - 0.5;
  return Math.abs(fi - Math.round(fi)) < 1e-6 && Math.abs(fj - Math.round(fj)) < 1e-6;
};

/** How far `v` is from the nearest lane centre along an axis of cells `size` long. */
const offCentre = (v: number, size: number) => {
  const f = v / size - 0.5;
  return (f - Math.round(f)) * size;
};

/** Step until the line's direction changes; returns where it was after that step. */
const untilTurn = (a: Arena, l: Line, max = HZ) => {
  const was = l.aim;
  run(a, max, () => l.aim !== was);
  return { x: l.x, y: l.y, aim: l.aim };
};

describe("grid snake", () => {
  it("fits lane cells to the arena", () => {
    expect(laneFor(6400, 1800, 16, false)).toEqual({ cols: 400, rows: 112, w: 16, h: 1800 / 112 });
    const wrap = laneFor(6400, 1800, 16, true);
    expect(wrap.rows).toBe(113);
    expect(wrap.h * wrap.rows).toBeCloseTo(1800);
    // A wall's grid snakes run on lanes of about 48, about 7 cells a second.
    const lane = gridArena("wrap").lane;
    expect([lane.cols, lane.rows]).toEqual([133, 38]);
    expect(320 / lane.w).toBeCloseTo(6.65, 1);
  });

  it("starts on a cell centre and runs straight along its column", () => {
    const a = gridArena();
    a.start([up(1003, 1700)], 1);
    const l = a.lines[0]!;
    expect(onCentre(a, l.x, l.y)).toBe(true);
    expect(l.aim).toBe(UP);
    const x = l.x;
    const y = l.y;
    run(a, HZ);
    expect(l.alive).toBe(true);
    expect(l.x).toBe(x);
    expect(y - l.y).toBeCloseTo(320, 0);
    expect(l.heading).toBeCloseTo(-Math.PI / 2 + Math.PI * 2);
  });

  it("turns only at a cell centre", () => {
    const a = gridArena();
    a.start([up(1000, 1700)], 1);
    const l = a.lines[0]!;
    run(a, 2);
    expect(onCentre(a, l.x, l.y)).toBe(false);
    a.press(l, RIGHT);
    a.step();
    expect(l.aim).toBe(UP);
    const at = untilTurn(a, l);
    expect(at.aim).toBe(RIGHT);
    // It turned on a centre and has gone on less than a step to the right.
    expect(offCentre(at.y, a.lane.h)).toBeCloseTo(0, 6);
    const past = offCentre(at.x, a.lane.w);
    expect(past).toBeGreaterThanOrEqual(0);
    expect(past).toBeLessThan(320 / HZ);
    const y = l.y;
    run(a, 30);
    expect(l.y).toBe(y);
    expect(l.alive).toBe(true);
  });

  it("ignores a press straight back, and one the way it is already going", () => {
    const a = gridArena();
    a.start([up(1000, 1700)], 1);
    const l = a.lines[0]!;
    a.press(l, DOWN);
    a.press(l, UP);
    expect(l.next).toBe(-1);
    run(a, HZ);
    expect(l.aim).toBe(UP);
    expect(l.alive).toBe(true);
  });

  it("keeps one press waiting behind the next, so two quick taps make two turns", () => {
    const a = gridArena();
    a.start([right(1000, 900)], 1);
    const l = a.lines[0]!;
    run(a, 2);
    const y0 = l.y;
    // Up then left, both before the next centre: a tight U-turn one row up.
    a.press(l, UP);
    a.press(l, LEFT);
    expect([l.next, l.queued]).toEqual([UP, LEFT]);
    const first = untilTurn(a, l);
    expect(first.aim).toBe(UP);
    const second = untilTurn(a, l);
    expect(second.aim).toBe(LEFT);
    expect(Math.abs(second.x - first.x)).toBeLessThan(320 / HZ);
    expect(y0 - second.y).toBeCloseTo(a.lane.h);
    run(a, HZ);
    expect(l.alive).toBe(true);
    expect(l.x).toBeLessThan(first.x - 200);
  });

  it("lets a newer press take the waiting place, and drops one that became a reversal", () => {
    const a = gridArena();
    a.start([right(1000, 900)], 1);
    const l = a.lines[0]!;
    run(a, 2);
    a.press(l, UP);
    a.press(l, LEFT);
    a.press(l, RIGHT);
    expect([l.next, l.queued]).toEqual([UP, RIGHT]);
    // Down would reverse the waiting turn up.
    a.press(l, DOWN);
    expect(l.queued).toBe(RIGHT);
    expect(untilTurn(a, l).aim).toBe(UP);
    expect(untilTurn(a, l).aim).toBe(RIGHT);
  });

  it("runs alongside a snake in the next row, but not into one head on", () => {
    const a = gridArena();
    const h = a.lane.h;
    a.start([right(1000, 900), right(1000, 900 + h)], 1);
    expect(Math.abs(a.lines[0]!.y - a.lines[1]!.y)).toBeCloseTo(h);
    run(a, 2 * HZ);
    expect(a.alive()).toBe(2);
    const b = gridArena();
    b.start([right(1000, 900), { x: 1400, y: 900, heading: Math.PI }], 1);
    run(b, 2 * HZ, () => b.alive() < 2);
    expect(b.alive()).toBe(0);
  });

  it("grows when it eats, with its body on cell centres, up to the cap", () => {
    const a = gridArena();
    a.start([right(500, 900)], 1);
    // Only the food the test puts down.
    for (const f of a.food) f.born = Number.MAX_SAFE_INTEGER;
    const l = a.lines[0]!;
    const f = a.food[0]!;
    f.x = l.x + a.lane.w * 4;
    f.y = l.y;
    f.live = true;
    run(a, HZ);
    expect(l.eaten).toBe(1);
    expect(l.len).toBe(GRID.start + GRID.grow);
    for (let k = 0; k < l.bodyCount; k++) {
      const p = a.bodyPoint(l, k);
      expect(onCentre(a, p.x, p.y)).toBe(true);
    }
    // Food in the next row is close enough to take in passing; two rows over is not.
    const eaten: number[] = [];
    a.hooks.eat = (_, x, y) => eaten.push(Math.round((y - l.y) / a.lane.h));
    const g = a.food[1]!;
    g.x = l.x + a.lane.w * 4;
    g.y = l.y - a.lane.h;
    g.live = true;
    const h = a.food[2]!;
    h.x = l.x + a.lane.w * 3;
    h.y = l.y + a.lane.h * 2;
    h.live = true;
    run(a, HZ);
    expect(eaten).toEqual([-1]);
    expect(l.eaten).toBe(2);
    l.len = GRID.max + 50;
    run(a, HZ);
    expect(l.bodyCount).toBeLessThanOrEqual(GRID.max + 50);
  });

  it("respawns at its start on a centre, heading up, at the starting length", () => {
    const a = gridArena();
    a.start([up(1000, 400)], 1);
    const l = a.lines[0]!;
    const start = { x: l.x, y: l.y };
    l.len = 100;
    run(a, 2 * HZ, () => !l.alive);
    expect(l.alive).toBe(false);
    a.press(l, RIGHT);
    expect(l.next).toBe(-1);
    run(a, 3 * HZ, () => l.alive);
    expect(l.alive).toBe(true);
    expect({ x: l.x, y: l.y }).toEqual(start);
    expect(l.aim).toBe(UP);
    expect(l.len).toBe(GRID.start);
    expect(l.deaths).toBe(1);
  });

  it("passes through the edges when they wrap, staying on centres", () => {
    const a = gridArena("wrap");
    a.start([up(1000, 100), right(6300, 600)], 1);
    const [v, h] = a.lines as [Line, Line];
    run(a, HZ);
    expect(a.alive()).toBe(2);
    expect(v.y).toBeGreaterThan(1500);
    expect(h.x).toBeLessThan(300);
    // A turn on the far side of the edge lands on a centre as usual.
    a.press(v, LEFT);
    const at = untilTurn(a, v);
    expect(offCentre(at.y, a.lane.h)).toBeCloseTo(0, 6);
    expect(Math.abs(offCentre(at.x, a.lane.w))).toBeLessThan(320 / HZ);
  });

  it("eats a dot it brushes past turning at the cell diagonal to it", () => {
    const a = gridArena();
    a.start([right(500, 900)], 1);
    for (const f of a.food) f.born = Number.MAX_SAFE_INTEGER;
    const l = a.lines[0]!;
    const f = a.food[0]!;
    f.x = l.x + a.lane.w * 3;
    f.y = l.y - a.lane.h;
    f.live = true;
    run(a, Math.round((a.lane.w * 1.5 * HZ) / 320));
    a.press(l, DOWN);
    expect(untilTurn(a, l).aim).toBe(DOWN);
    expect(l.eaten).toBe(1);
  });
});

describe("food as drawn", () => {
  // The outside of a dot's ring at its largest throb, a head's white disc and a body's core.
  const play = (variant: "grid" | "snake", edges: "wrap" | "solid") => {
    const a = wallArena({ variant, edges, rng: createRng(`drawn-${variant}-${edges}`) });
    const T = a.params.trail;
    const ring = T * FOOD_SIZE * 0.47 * 1.12;
    const headR = T * HEAD_SIZE * 0.29;
    const bodyR = (T / 2) * 1.4;
    const dist = (x: number, y: number, f: { x: number; y: number }) =>
      Math.hypot(
        edges === "wrap" ? wrapDelta(x - f.x, a.width) : x - f.x,
        edges === "wrap" ? wrapDelta(y - f.y, a.height) : y - f.y,
      );
    a.start(
      Array.from({ length: 8 }, (_, i) => up(((i + 0.5) / 8) * a.width, a.height - 90)),
      1,
    );
    const rng = createRng("drawn:bots");
    const brains = a.lines.map(() => createBrain());
    /** Food (slot and birth) a live head is touching as drawn. */
    const touching = new Set<string>();
    let touchedAndLeft = 0;
    let underBody = 0;
    for (let t = 0; t < 40 * HZ; t++) {
      a.lines.forEach((l, i) => {
        if (!l.alive) return;
        if (variant === "snake") l.dir = think(a, l, brains[i]!, rng);
        else {
          const d = thinkGrid(a, l, brains[i]!, rng);
          if (d >= 0) a.press(l, d);
        }
      });
      a.step();
      a.food.forEach((f, k) => {
        for (const l of a.lines) {
          const key = `${k}:${f.born}:${l.id}`;
          const near = f.live && l.alive && dist(l.x, l.y, f) < ring + headR;
          if (near) touching.add(key);
          else if (touching.delete(key) && f.live && l.alive) touchedAndLeft++;
          if (!f.live || !l.alive || t % 10 !== 0) continue;
          for (let b = 0; b < l.bodyCount - 1; b++) {
            const p = a.bodyPoint(l, b);
            if (dist(p.x, p.y, f) < ring + bodyR) underBody++;
          }
        }
      });
    }
    return { eaten: a.lines.reduce((n, l) => n + l.eaten, 0), touchedAndLeft, underBody };
  };

  it("is eaten by any head that touches it, and never sits under a body", () => {
    for (const variant of ["grid", "snake"] as const) {
      for (const edges of ["wrap", "solid"] as const) {
        const r = play(variant, edges);
        expect(r.eaten, `${variant} ${edges}`).toBeGreaterThan(30);
        expect({ variant, edges, left: r.touchedAndLeft, under: r.underBody }).toEqual({
          variant,
          edges,
          left: 0,
          under: 0,
        });
      }
    }
  }, 60_000);
});

describe("grid bots", () => {
  const play = (seed: string, lines: number, edges: "wrap" | "solid", seconds: number) => {
    const a = gridArena(edges, seed);
    const rng = createRng(`${seed}:bots`);
    a.start(
      Array.from({ length: lines }, (_, i) => up(((i + 0.5) / lines) * 6400, 1710)),
      1,
    );
    const brains = a.lines.map(() => createBrain());
    let reversals = 0;
    for (let t = 0; t < seconds * HZ; t++) {
      a.lines.forEach((l, i) => {
        if (!l.alive) return;
        const d = thinkGrid(a, l, brains[i]!, rng);
        if (d < 0) return;
        if (d === ((l.next >= 0 ? l.next : l.aim) + 2) % 4) reversals++;
        a.press(l, d);
      });
      a.step();
    }
    return { a, reversals };
  };

  it("look ahead along the lanes, across a wrapping edge", () => {
    const solid = gridArena();
    solid.start([right(6300, 900)], 1);
    const l = solid.lines[0]!;
    expect(runway(solid, l, l.x, l.y, RIGHT, 10)).toBeLessThan(3);
    expect(runway(solid, l, l.x, l.y, UP, 10)).toBe(10);
    const wrap = gridArena("wrap");
    wrap.start([down(40, 780), right(6000, 900)], 1);
    const [b, m] = wrap.lines as [Line, Line];
    m.alive = false;
    run(wrap, Math.round(0.75 * HZ));
    b.alive = false;
    m.alive = true;
    // About 400 to the edge and 24 past it to the trail, in cells of 48.
    const reach = runway(wrap, m, m.x, m.y, RIGHT, 20);
    expect(reach).toBeGreaterThan(5);
    expect(reach).toBeLessThan(10);
  });

  it("last a while, eat, and never press straight back", () => {
    for (const edges of ["solid", "wrap"] as const) {
      const { a, reversals } = play(`bots-${edges}`, 4, edges, 40);
      expect(reversals).toBe(0);
      expect(a.lines.reduce((n, l) => n + l.eaten, 0)).toBeGreaterThan(6);
      // Snakes come back, so count crashes: a few in 40 s, not one every few seconds.
      const deaths = a.lines.reduce((n, l) => n + l.deaths, 0);
      expect(deaths).toBeLessThan(4 * 6);
    }
  });
});
