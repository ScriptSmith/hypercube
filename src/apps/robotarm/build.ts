/**
 * The screen's shared build, pure. Pieces sent up from the bank arrive as flights: each rises
 * out of its own column and, if the picture still needs its colour, arcs into the next empty
 * square of that colour in build order (bottom row first). The screen picks every square, so
 * visitors only choose colours. A piece whose colour is complete fizzles out. When every square
 * is filled the picture is done: a celebration, then it leaves, and the next picture comes in.
 * Pieces arriving meanwhile wait in a hopper and go into the next picture.
 *
 * Everything is bounded: flights in the air, the hopper and the event list.
 */
import { type Picture, PICTURES } from "./pictures";

export type BuildPhase = "build" | "done" | "leave" | "enter";

export interface Flight {
  id: number;
  color: number;
  /** 0 block, 1 ball. */
  kind: number;
  /** Bank column and fraction across that frame where it left. */
  pos: number;
  u: number;
  /** Sent by a person (not a bot or a demonstration). */
  human: boolean;
  /** Seconds since it arrived. */
  t: number;
  /** Target square (index into the picture's cells), or null if it isn't needed. */
  cell: number | null;
  /** Waiting in the hopper for the next picture. */
  waiting: boolean;
  /** When its arc to the square began (seconds of `t`), or null before that. */
  arcAt: number | null;
}

export type BuildEvent =
  | { type: "placed"; cell: number; color: number; human: boolean }
  | { type: "fizzle"; flight: number; color: number; pos: number; u: number }
  | { type: "done"; picture: number }
  | { type: "next"; picture: number };

export interface Build {
  readonly picture: Picture;
  readonly index: number;
  readonly filled: readonly boolean[];
  readonly phase: BuildPhase;
  /** Seconds in the phase. */
  readonly phaseT: number;
  readonly flights: readonly Flight[];
  readonly events: BuildEvent[];
  readonly counts: {
    arrived: number;
    placed: number;
    pictures: number;
    fizzled: number;
    dropped: number;
  };
  /** A piece arrives from the bank. Returns null when too many are already in the air. */
  arrive(color: number, kind: number, pos: number, u: number, human: boolean): Flight | null;
  step(dt: number): void;
  /** Squares per colour still wanting a piece (empty, not already promised to a flight). */
  needs(): [number, number, number];
  /** Share of the picture filled, 0 to 1. */
  progress(): number;
  /** Start the current picture again, empty. */
  restart(): void;
  /** Move straight on to the next picture. */
  skip(): void;
}

/** Seconds: rising out of the column, then the arc into the square. */
export const RISE_S = 0.9;
export const ARC_S = 1.5;
export const DONE_S = 2.6;
export const LEAVE_S = 2.4;
export const ENTER_S = 1;
export const MAX_FLIGHTS = 48;
export const MAX_HOPPER = 16;
const MAX_EVENTS = 64;

export const createBuild = (start = 0, pictures: readonly Picture[] = PICTURES): Build => {
  let index = ((start % pictures.length) + pictures.length) % pictures.length;
  let picture = pictures[index]!;
  let filled: boolean[] = picture.cells.map(() => false);
  let reserved: boolean[] = picture.cells.map(() => false);
  let phase: BuildPhase = "build";
  let phaseT = 0;
  let nextId = 1;
  const flights: Flight[] = [];
  const events: BuildEvent[] = [];
  const counts = { arrived: 0, placed: 0, pictures: 0, fizzled: 0, dropped: 0 };

  const push = (e: BuildEvent) => {
    if (events.length >= MAX_EVENTS) events.shift();
    events.push(e);
  };

  /** The next free square of a colour in build order, or null. */
  const freeCell = (color: number): number | null => {
    for (let i = 0; i < picture.cells.length; i++) {
      if (picture.cells[i]!.color === color && !filled[i] && !reserved[i]) return i;
    }
    return null;
  };

  const assign = (f: Flight) => {
    const cell = freeCell(f.color);
    f.cell = cell;
    f.waiting = false;
    if (cell !== null) reserved[cell] = true;
  };

  const nextPicture = () => {
    index = (index + 1) % pictures.length;
    picture = pictures[index]!;
    filled = picture.cells.map(() => false);
    reserved = picture.cells.map(() => false);
    push({ type: "next", picture: index });
  };

  const remove = (i: number) => {
    flights.splice(i, 1);
  };

  const fizzle = (i: number) => {
    const f = flights[i]!;
    counts.fizzled++;
    push({ type: "fizzle", flight: f.id, color: f.color, pos: f.pos, u: f.u });
    remove(i);
  };

  const setPhase = (p: BuildPhase) => {
    phase = p;
    phaseT = 0;
  };

  const needsOf = (): [number, number, number] => {
    const n: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < picture.cells.length; i++) {
      const c = picture.cells[i]!.color;
      if (!filled[i] && !reserved[i] && c >= 0 && c < 3) n[c] = (n[c] ?? 0) + 1;
    }
    return n;
  };

  return {
    get picture() {
      return picture;
    },
    get index() {
      return index;
    },
    get filled() {
      return filled;
    },
    get phase() {
      return phase;
    },
    get phaseT() {
      return phaseT;
    },
    flights,
    events,
    counts,
    arrive(color, kind, pos, u, human) {
      if (flights.length >= MAX_FLIGHTS) {
        counts.dropped++;
        return null;
      }
      counts.arrived++;
      const f: Flight = {
        id: nextId++,
        color,
        kind,
        pos,
        u,
        human,
        t: 0,
        cell: null,
        waiting: false,
        arcAt: null,
      };
      if (phase === "build") assign(f);
      else {
        // Between pictures: wait for the next one, if the hopper has room.
        const waiting = flights.filter((x) => x.waiting).length;
        f.waiting = waiting < MAX_HOPPER;
      }
      flights.push(f);
      return f;
    },
    step(dt) {
      phaseT += dt;
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i]!;
        f.t += dt;
        if (f.t < RISE_S) continue;
        if (f.waiting) continue;
        if (f.cell === null) {
          fizzle(i);
          continue;
        }
        f.arcAt ??= Math.max(RISE_S, f.t - dt);
        if (f.t - f.arcAt >= ARC_S) {
          filled[f.cell] = true;
          reserved[f.cell] = false;
          counts.placed++;
          push({ type: "placed", cell: f.cell, color: f.color, human: f.human });
          remove(i);
        }
      }
      if (phase === "build") {
        if (filled.length > 0 && filled.every(Boolean)) {
          counts.pictures++;
          push({ type: "done", picture: index });
          setPhase("done");
        }
      } else if (phase === "done" && phaseT >= DONE_S) {
        setPhase("leave");
      } else if (phase === "leave" && phaseT >= LEAVE_S) {
        nextPicture();
        setPhase("enter");
      } else if (phase === "enter" && phaseT >= ENTER_S) {
        setPhase("build");
        // The hopper empties into the new picture, oldest first.
        for (const f of flights) if (f.waiting) assign(f);
      }
    },
    needs() {
      if (phase === "build") return needsOf();
      // Between pictures, count what the next picture will want, less the hopper.
      const next = phase === "enter" ? picture : pictures[(index + 1) % pictures.length]!;
      const n: [number, number, number] = [0, 0, 0];
      for (const c of next.cells)
        if (c.color >= 0 && c.color < 3) n[c.color] = (n[c.color] ?? 0) + 1;
      for (const f of flights) {
        if (f.waiting && f.color >= 0 && f.color < 3)
          n[f.color] = Math.max(0, (n[f.color] ?? 0) - 1);
      }
      return n;
    },
    progress() {
      const n = filled.length;
      return n ? filled.filter(Boolean).length / n : 0;
    },
    restart() {
      filled = picture.cells.map(() => false);
      reserved = picture.cells.map(() => false);
      flights.length = 0;
      setPhase("build");
    },
    skip() {
      flights.length = 0;
      nextPicture();
      setPhase("enter");
    },
  };
};
