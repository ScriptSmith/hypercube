/**
 * One board: its level and maze, the ball, the servo that tips the board towards the pad's
 * command at a bounded rate, and the little story around each ball (it drops in at the start,
 * rolls, sinks into a hole and comes back at the start, or sinks into the goal, after which the
 * walls sink, the next maze rises and a new ball drops in).
 */
import type { Rng } from "../../core/types";
import { DEMO_MAX_LEVEL, type Handling, MAX_LEVEL } from "./config";
import { cellCentre, generateMaze, type Maze, type Orient } from "./maze";
import { type Ball, createBall, placeBall, stepBall } from "./physics";

export type Phase = "enter" | "roll" | "sink" | "gone" | "goal" | "change";
export type Mode = "demo" | "people" | "bot";

export type BoardEvent =
  | { type: "finished"; color: number; level: number; human: boolean }
  | { type: "fell" }
  | { type: "maze" };

/** Seconds for each part of a ball's story. */
export const ENTER_S = 0.5;
export const SINK_S = 0.35;
export const GONE_S = 0.55;
export const GOAL_S = 0.45;
export const CHANGE_S = 0.9;
/** Ball colours, cycled ball by ball. */
export const COLOR_COUNT = 8;
const MAX_EVENTS = 16;

export interface Board {
  readonly index: number;
  readonly orient: Orient;
  level: number;
  maze: Maze;
  /** The maze whose walls are sinking during a change, until the new one rises. */
  oldMaze: Maze | null;
  readonly ball: Ball;
  phase: Phase;
  /** Seconds into the phase. */
  phaseT: number;
  /** Where the ball sinks during `sink` and `goal`. */
  sinkAt: { x: number; z: number };
  readonly tilt: { x: number; z: number };
  readonly prevTilt: { x: number; z: number };
  readonly target: { x: number; z: number };
  /** The pad's command, as last given (unit disc). */
  readonly command: { x: number; y: number };
  color: number;
  mode: Mode;
  /** performance.now() of the last person's touch on this board's controls. */
  lastHuman: number;
  readonly counts: { finished: number; falls: number; mazes: number };
  readonly events: BoardEvent[];
  /** 0 to 1: how far the walls have risen (they sink and rise during a change). */
  walls(): number;
  steer(ux: number, uy: number): void;
  step(dt: number): void;
  /** Start a new maze at `level` with the change animation. */
  setLevel(level: number): void;
  reset(): void;
}

export interface BoardOptions {
  index: number;
  orient: Orient;
  holes: boolean;
  handling: Handling;
  rng: Rng;
  /** True while the ball counts as a person's, for the finished event. */
  human: () => boolean;
}

export const createBoard = (o: BoardOptions): Board => {
  let mazeCount = 0;
  const makeMaze = (level: number) =>
    generateMaze({
      level,
      orient: o.orient,
      holes: o.holes,
      rng: o.rng.fork(`maze:${mazeCount++}`),
    });
  const first = makeMaze(1);
  const start = cellCentre(first, first.start);
  const events: BoardEvent[] = [];
  const push = (e: BoardEvent) => {
    if (events.length >= MAX_EVENTS) events.shift();
    events.push(e);
  };

  const board: Board = {
    index: o.index,
    orient: o.orient,
    level: 1,
    maze: first,
    oldMaze: null,
    ball: createBall(start.x, start.z),
    phase: "enter",
    phaseT: 0,
    sinkAt: { x: 0, z: 0 },
    tilt: { x: 0, z: 0 },
    prevTilt: { x: 0, z: 0 },
    target: { x: 0, z: 0 },
    command: { x: 0, y: 0 },
    color: (o.index * 3) % COLOR_COUNT,
    mode: "demo",
    lastHuman: Number.NEGATIVE_INFINITY,
    counts: { finished: 0, falls: 0, mazes: 1 },
    events,
    walls() {
      if (board.phase !== "change") return 1;
      const f = board.phaseT / CHANGE_S;
      return f < 0.5 ? 1 - f * 2 : (f - 0.5) * 2;
    },
    steer(ux, uy) {
      const l = Math.hypot(ux, uy);
      const k = l > 1 ? 1 / l : 1;
      board.command.x = ux * k;
      board.command.y = uy * k;
      board.target.x = ux * k * o.handling.maxTilt;
      board.target.z = uy * k * o.handling.maxTilt;
    },
    step(dt) {
      board.prevTilt.x = board.tilt.x;
      board.prevTilt.z = board.tilt.z;
      const lim = o.handling.rate * dt;
      const ease = Math.min(1, dt * 14);
      for (const a of ["x", "z"] as const) {
        const d = (board.target[a] - board.tilt[a]) * ease;
        board.tilt[a] += d > lim ? lim : d < -lim ? -lim : d;
      }
      board.phaseT += dt;
      const b = board.ball;
      switch (board.phase) {
        case "enter":
          b.px = b.x;
          b.pz = b.z;
          if (board.phaseT >= ENTER_S) to("roll");
          break;
        case "roll": {
          const e = stepBall(b, board.maze, board.tilt.x, board.tilt.z, o.handling, dt);
          if (e?.type === "goal") {
            board.sinkAt = cellCentre(board.maze, board.maze.goal);
            to("goal");
          } else if (e?.type === "hole") {
            const h = board.maze.holes[e.hole];
            board.sinkAt = h ? { x: h.x, z: h.z } : { x: b.x, z: b.z };
            board.counts.falls++;
            push({ type: "fell" });
            to("sink");
          }
          break;
        }
        case "sink":
        case "goal": {
          b.px = b.x;
          b.pz = b.z;
          const k = Math.min(1, dt * 10);
          b.x += (board.sinkAt.x - b.x) * k;
          b.z += (board.sinkAt.z - b.z) * k;
          if (board.phase === "sink" && board.phaseT >= SINK_S) to("gone");
          if (board.phase === "goal" && board.phaseT >= GOAL_S) finish();
          break;
        }
        case "gone":
          if (board.phaseT >= GONE_S) restart();
          break;
        case "change":
          if (board.oldMaze && board.phaseT >= CHANGE_S / 2) board.oldMaze = null;
          if (board.phaseT >= CHANGE_S) restart();
          break;
      }
    },
    setLevel(level) {
      board.level = Math.min(MAX_LEVEL, Math.max(1, Math.round(level)));
      change();
    },
    reset() {
      board.setLevel(1);
    },
  };

  function to(p: Phase) {
    board.phase = p;
    board.phaseT = 0;
  }

  /** Put the ball at the start, above the board, to drop in. */
  function restart() {
    const s = cellCentre(board.maze, board.maze.start);
    placeBall(board.ball, s.x, s.z);
    to("enter");
  }

  function change() {
    board.oldMaze = board.phase === "change" ? board.oldMaze : board.maze;
    board.maze = makeMaze(board.level);
    board.counts.mazes++;
    push({ type: "maze" });
    to("change");
  }

  function finish() {
    board.counts.finished++;
    push({ type: "finished", color: board.color, level: board.level, human: o.human() });
    board.color = (board.color + 1) % COLOR_COUNT;
    if (board.mode === "demo") {
      board.level = board.level >= DEMO_MAX_LEVEL ? 1 : board.level + 1;
    } else {
      board.level = Math.min(MAX_LEVEL, board.level + 1);
    }
    change();
  }

  return board;
};
