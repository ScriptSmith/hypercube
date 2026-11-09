import { describe, expect, it } from "vitest";
import { DEG, HANDLING, HZ } from "../../../src/apps/tiltmaze/config";
import { cellAt, cellCentre, generateMaze, type Maze } from "../../../src/apps/tiltmaze/maze";
import { createBall, placeBall, stepBall, V_CAP } from "../../../src/apps/tiltmaze/physics";
import { createRng } from "../../../src/core/rng";

const DT = 1 / HZ;
const gentle = HANDLING.gentle;

/** An open box: the rim only, no inner walls. */
const emptyBoard = (level = 8): Maze => {
  const m = generateMaze({ level, orient: "portrait", holes: false, rng: createRng("e") });
  return {
    ...m,
    open: new Uint8Array(m.cols * m.rows).fill(15),
    boxes: m.boxes.filter((b) => b.rim),
    cellBoxes: m.cellBoxes.map(() => [0, 1, 2, 3]),
    holes: [],
    cellHoles: m.cellHoles.map(() => []),
    goal: -100,
  };
};

const insideAnyBox = (m: Maze, x: number, z: number) =>
  m.boxes.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);

describe("tiltmaze physics", () => {
  it("rolls downhill at 5/7 g sin(tilt) from rest", () => {
    const m = emptyBoard();
    const b = createBall(0, 0);
    const tilt = 6 * DEG;
    stepBall(b, m, tilt, 0, { damping: 0 }, 0.05);
    const expected = (5 / 7) * 9.81 * Math.sin(tilt) * 0.05;
    // Rolling resistance (about 1 % of g) takes a little off.
    expect(b.vx).toBeGreaterThan(expected - 0.012 * 9.81 * 0.05);
    expect(b.vx).toBeLessThan(expected - 0.01 * 9.81 * 0.05);
    expect(b.vz).toBeCloseTo(0, 9);
  });

  it("stops on a level board and stays still", () => {
    const m = emptyBoard();
    const b = createBall(0, 0);
    b.vx = 0.2;
    b.vz = -0.1;
    for (let i = 0; i < HZ * 4; i++) stepBall(b, m, 0, 0, gentle, DT);
    expect(Math.hypot(b.vx, b.vz)).toBe(0);
    const x = b.x;
    for (let i = 0; i < HZ; i++) stepBall(b, m, 0, 0, gentle, DT);
    expect(b.x).toBe(x);
  });

  it("settles in a corner of a tilted board", () => {
    for (const level of [1, 8]) {
      const m = generateMaze({ level, orient: "portrait", holes: false, rng: createRng(level) });
      const c = cellCentre(m, 0);
      const b = createBall(c.x + m.sx * 0.2, c.z + m.sz * 0.2);
      for (let i = 0; i < HZ * 4; i++) stepBall(b, m, -10 * DEG, -10 * DEG, gentle, DT);
      expect(Math.hypot(b.vx, b.vz)).toBeLessThan(0.002);
      // In the far left corner of its cell, against both walls.
      expect(b.x).toBeCloseTo(-m.w / 2 + m.wall / 2 + m.r, 3);
      expect(cellAt(m, b.x, b.z)).toBe(0);
    }
  });

  it("never passes through a wall or a corner at top speed", () => {
    for (let seed = 0; seed < 3; seed++) {
      const m = generateMaze({ level: 8, orient: "portrait", holes: false, rng: createRng(seed) });
      for (let cell = seed; cell < m.cols * m.rows; cell += 4) {
        for (let a = 0; a < 12; a++) {
          const angle = (a / 12) * Math.PI * 2 + 0.1;
          const c = cellCentre(m, cell);
          const b = createBall(c.x, c.z);
          b.vx = Math.cos(angle) * V_CAP;
          b.vz = Math.sin(angle) * V_CAP;
          const start = cell;
          // Tilted hard the same way, so it keeps pressing into whatever it meets.
          for (let i = 0; i < 40; i++) {
            stepBall(
              b,
              m,
              Math.cos(angle) * 12 * DEG,
              Math.sin(angle) * 12 * DEG,
              { damping: 0 },
              DT,
            );
            expect(insideAnyBox(m, b.x, b.z)).toBe(false);
            expect(Math.abs(b.x)).toBeLessThan(m.w / 2);
            expect(Math.abs(b.z)).toBeLessThan(m.d / 2);
          }
          // Wherever it went, it went through open sides only.
          const end = cellAt(m, b.x, b.z);
          if (end !== start) {
            const reachable = new Set([start]);
            const queue = [start];
            for (let q = 0; q < queue.length; q++) {
              const x = queue[q]!;
              for (const [bit, step] of [
                [1, -m.cols],
                [2, 1],
                [4, m.cols],
                [8, -1],
              ] as const) {
                if (m.open[x]! & bit && !reachable.has(x + step)) {
                  reachable.add(x + step);
                  queue.push(x + step);
                }
              }
            }
            expect(reachable.has(end)).toBe(true);
          }
        }
      }
    }
  }, 30_000);

  it("bounces off a wall with a little restitution", () => {
    const m = emptyBoard();
    const b = createBall(m.w / 2 - 0.05, 0);
    b.vx = 0.5;
    for (let i = 0; i < 30 && b.vx > 0; i++) stepBall(b, m, 0, 0, { damping: 0 }, DT);
    expect(b.vx).toBeLessThan(0);
    expect(-b.vx).toBeGreaterThan(0.5 * 0.2);
    expect(-b.vx).toBeLessThan(0.5 * 0.4);
  });

  it("catches the ball in the goal exactly once, and in a hole exactly once", () => {
    const m = generateMaze({ level: 3, orient: "portrait", holes: true, rng: createRng("g") });
    const g = cellCentre(m, m.goal);
    const b = createBall(g.x + m.sx * 0.3, g.z);
    let goals = 0;
    for (let i = 0; i < HZ * 2; i++) {
      // Rolled gently towards the middle of the goal.
      const e = stepBall(b, m, -2 * DEG * Math.sign(b.x - g.x), 0, gentle, DT);
      if (e?.type === "goal") {
        goals++;
        break;
      }
    }
    expect(goals).toBe(1);
    const h = m.holes[0]!;
    placeBall(b, h.x, h.z);
    const events = [];
    for (let i = 0; i < 20; i++) {
      const e = stepBall(b, m, 0, 0, gentle, DT);
      if (e) {
        events.push(e);
        break;
      }
    }
    expect(events).toEqual([{ type: "hole", hole: 0 }]);
  });

  it("lets a slow ball drop into a hole and a very fast one skip across", () => {
    const m = emptyBoard();
    const r = m.r;
    const hole = { x: 0, z: 0, r: 1.25 * r, cell: cellAt(m, 0, 0), onPath: true };
    const withHole: Maze = { ...m, holes: [hole], cellHoles: m.cellHoles.map(() => [0]) };
    const cross = (v: number) => {
      const b = createBall(-0.05, 0);
      b.vx = v;
      for (let i = 0; i < HZ; i++) {
        const e = stepBall(b, withHole, 0, 0, { damping: 0 }, DT);
        if (e) return e.type;
      }
      return "skipped";
    };
    expect(cross(0.15)).toBe("hole");
    expect(cross(V_CAP)).toBe("skipped");
  });

  it("spins the ball as it rolls", () => {
    const m = emptyBoard();
    const b = createBall(0, 0);
    b.vx = 0.2;
    stepBall(b, m, 0, 0, { damping: 0 }, 0.02);
    // Rolling right turns it about -z.
    expect(b.q[2]).toBeLessThan(0);
    expect(Math.hypot(...b.q)).toBeCloseTo(1, 9);
  });
});
