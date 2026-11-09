import { describe, expect, it } from "vitest";
import { type Board, createBoard } from "../../../src/apps/tiltmaze/board";
import { HANDLING, HZ, type Speed } from "../../../src/apps/tiltmaze/config";
import type { Orient } from "../../../src/apps/tiltmaze/maze";
import { createPilot, fullAccel, type Pilot } from "../../../src/apps/tiltmaze/pilot";
import { createRng } from "../../../src/core/rng";

const DT = 1 / HZ;

const rig = (o: {
  seed: string;
  level: number;
  orient?: Orient;
  holes?: boolean;
  speed?: Speed;
  mistakes?: boolean;
  pace?: number;
}) => {
  const handling = HANDLING[o.speed ?? "gentle"];
  const board = createBoard({
    index: 0,
    orient: o.orient ?? "portrait",
    holes: o.holes ?? false,
    handling,
    rng: createRng(o.seed),
    human: () => false,
  });
  board.mode = "bot";
  board.setLevel(o.level);
  const pilot = createPilot({
    rng: createRng(`${o.seed}:pilot`),
    speed: (o.pace ?? 1) * (o.speed === "lively" ? 0.36 : 0.26),
    aMax: fullAccel(handling.maxTilt),
    damping: handling.damping,
    mistakes: o.mistakes ?? false,
  });
  return { board, pilot };
};

/** Seconds until the board finishes its maze, or null after `limit`. */
const timeToFinish = (board: Board, pilot: Pilot, limit: number) => {
  for (let i = 0; i < limit * HZ; i++) {
    const c = pilot.update(DT, board);
    board.steer(c.x, c.y);
    board.step(DT);
    if (board.events.some((e) => e.type === "finished")) return i * DT;
  }
  return null;
};

describe("tiltmaze autopilot", () => {
  it("finishes level 1 quickly at both speeds", () => {
    for (const speed of ["gentle", "lively"] as const) {
      for (let seed = 0; seed < 12; seed++) {
        const { board, pilot } = rig({ seed: `l1:${seed}`, level: 1, speed });
        const t = timeToFinish(board, pilot, 40);
        expect(t, `${speed} seed ${seed}`).not.toBeNull();
        expect(t!).toBeLessThan(30);
      }
    }
  });

  it("finishes every level, both board shapes", () => {
    const times: number[] = [];
    for (const orient of ["portrait", "landscape"] as const) {
      for (let level = 1; level <= 8; level++) {
        for (let seed = 0; seed < 3; seed++) {
          const { board, pilot } = rig({ seed: `${orient}:${level}:${seed}`, level, orient });
          const t = timeToFinish(board, pilot, 180);
          expect(t, `${orient} level ${level} seed ${seed}`).not.toBeNull();
          times.push(t!);
        }
      }
    }
    expect(Math.max(...times)).toBeLessThan(150);
  });

  it("passes holes on their clear lanes", () => {
    let falls = 0;
    let runs = 0;
    for (let level = 2; level <= 8; level += 2) {
      for (let seed = 0; seed < 4; seed++) {
        const { board, pilot } = rig({ seed: `h:${level}:${seed}`, level, holes: true });
        const t = timeToFinish(board, pilot, 240);
        expect(t, `level ${level} seed ${seed}`).not.toBeNull();
        falls += board.counts.falls;
        runs++;
      }
    }
    // Careful driving falls in rarely.
    expect(falls / runs).toBeLessThan(0.5);
  });

  it("makes mistakes now and then and still gets there", () => {
    let mistakes = 0;
    for (let seed = 0; seed < 6; seed++) {
      const { board, pilot } = rig({ seed: `m:${seed}`, level: 4, mistakes: true, holes: true });
      const t = timeToFinish(board, pilot, 300);
      expect(t, `seed ${seed}`).not.toBeNull();
      mistakes += pilot.stats.mistakes;
    }
    expect(mistakes).toBeGreaterThan(0);
  });

  it("levels the board while the ball isn't rolling", () => {
    const { board, pilot } = rig({ seed: "lv", level: 2 });
    expect(board.phase).toBe("change");
    expect(pilot.update(DT, board)).toEqual({ x: 0, y: 0 });
  });
});
