/**
 * The attract show: with nobody there, each sting plays short acts that each show something
 * (a wing tilting until it stalls, a disc shedding a street of eddies, a plate turning across the
 * stream), and the wind changes now and then. Acts are keyframes of the handle's place (as
 * fractions of its travel) and the shape's turn from its resting angle, eased between, and of
 * the shape's size, which steps as the buttons do and holds until the next key that sets it.
 */
import { WINDS } from "./config";
import type { ShapeId } from "./shapes";

export interface Key {
  /** Seconds into the act. */
  t: number;
  /** Handle place across and down its travel, 0 to 1. */
  u: number;
  v: number;
  /** Degrees from the shape's resting angle, anticlockwise as drawn. */
  turn: number;
  /** The shape's size from here on, as a multiple of its usual size (snapped to the kind's steps). */
  size?: number;
}

export interface Act {
  shape: ShapeId;
  keys: readonly Key[];
}

const k = (t: number, u: number, v: number, turn = 0, size?: number): Key =>
  size === undefined ? { t, u, v, turn } : { t, u, v, turn, size };

/**
 * The acts, in order. Each sting starts at a different one. Turns are written for the wall
 * (stream to the right), where a clockwise turn (negative) lifts a wing's nose.
 */
export const ACTS: readonly Act[] = [
  // A wing tilts up slowly until the flow breaks away from its back, then eases back.
  {
    shape: "wing",
    keys: [
      k(0, 0.3, 0.45),
      k(6, 0.3, 0.45),
      k(16, 0.35, 0.45, -18),
      k(24, 0.35, 0.45, -18),
      k(30, 0.3, 0.45),
    ],
  },
  // A small disc sheds a narrow street of eddies; it grows to as large as its lane allows
  // (sizes snap to the sting's steps), and the street widens and slows; then it rides up and
  // down.
  {
    shape: "disc",
    keys: [
      k(0, 0.35, 0.5, 0, 0.6),
      k(7, 0.35, 0.5, 0, 1),
      k(14, 0.35, 0.5, 0, 2),
      k(21, 0.35, 0.5, 0, 3),
      k(29, 0.35, 0.5),
      k(34, 0.4, 0.2),
      k(39, 0.4, 0.8),
      k(43, 0.35, 0.5, 0, 1),
      k(47, 0.35, 0.5),
    ],
  },
  // A flat plate turns from edge-on to broadside: a thin wake grows into a wide one.
  {
    shape: "plate",
    keys: [
      k(0, 0.4, 0.5, -60),
      k(5, 0.4, 0.5, -60),
      k(17, 0.4, 0.5, 30),
      k(24, 0.4, 0.5, 30),
      k(28, 0.4, 0.5, 0),
    ],
  },
  // A car drives up and down through the smoke.
  {
    shape: "car",
    keys: [k(0, 0.3, 0.6), k(8, 0.3, 0.6), k(14, 0.55, 0.3), k(22, 0.55, 0.3), k(28, 0.3, 0.6)],
  },
  // A bird tilts one way and the other.
  {
    shape: "bird",
    keys: [
      k(0, 0.4, 0.3),
      k(6, 0.4, 0.3, 14),
      k(13, 0.4, 0.3, -14),
      k(19, 0.4, 0.3, 0),
      k(24, 0.4, 0.3),
    ],
  },
  // A block turns from face-on to a diamond.
  {
    shape: "block",
    keys: [
      k(0, 0.35, 0.55),
      k(8, 0.35, 0.55),
      k(14, 0.35, 0.55, 45),
      k(24, 0.35, 0.55, 45),
      k(28, 0.35, 0.55),
    ],
  },
  // A building stands in the wind.
  { shape: "building", keys: [k(0, 0.4, 0.7), k(14, 0.4, 0.7), k(20, 0.5, 0.5), k(26, 0.4, 0.7)] },
];

/** The wind the show plays, in turn, each held for WIND_HOLD_S. */
export const SHOW_WINDS: readonly number[] = [
  WINDS.steady,
  WINDS.strong,
  WINDS.steady,
  WINDS.gentle,
  WINDS.strong,
];
export const WIND_HOLD_S = 32;

const ease = (x: number) => x * x * (3 - 2 * x);

/** The size an act asks for `t` seconds in: the last key's at or before then that sets one. */
export const sizeAt = (act: Act, t: number): number => {
  let size = 1;
  for (const key of act.keys) {
    if (key.t > t && key !== act.keys[0]) break;
    if (key.size !== undefined) size = key.size;
  }
  return size;
};

/** Where an act puts its sting `t` seconds in. */
export const actAt = (
  act: Act,
  t: number,
): { u: number; v: number; turn: number; size: number } => {
  const keys = act.keys;
  const first = keys[0]!;
  const size = sizeAt(act, t);
  if (t <= first.t) return { u: first.u, v: first.v, turn: first.turn, size };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!;
    const b = keys[i]!;
    if (t <= b.t) {
      const x = ease((t - a.t) / Math.max(1e-6, b.t - a.t));
      return {
        u: a.u + (b.u - a.u) * x,
        v: a.v + (b.v - a.v) * x,
        turn: a.turn + (b.turn - a.turn) * x,
        size,
      };
    }
  }
  const last = keys[keys.length - 1]!;
  return { u: last.u, v: last.v, turn: last.turn, size };
};

export const actLength = (act: Act): number => act.keys[act.keys.length - 1]?.t ?? 0;

export interface DirectorState {
  act: number;
  t: number;
}

export interface Director {
  /** Advance and return each sting's pose and shape. */
  update(dt: number): { shape: ShapeId; u: number; v: number; turn: number; size: number }[];
  /** The wind the show asks for. */
  wind(): number;
  restart(): void;
  readonly states: readonly DirectorState[];
}

/**
 * `base` is the operator's starting wind: the show plays it where it would play the steady
 * wind, and goes gentle and strong in between.
 */
/** The act sting `i` starts with, for a director made with `offset`. */
export const firstAct = (offset: number, i: number): Act => ACTS[(offset + i * 2) % ACTS.length]!;

export const createDirector = (
  stings: number,
  offset: number,
  base: number = WINDS.steady,
): Director => {
  const start = () =>
    Array.from({ length: stings }, (_, i) => ({ act: ACTS.indexOf(firstAct(offset, i)), t: 0 }));
  let states: DirectorState[] = start();
  let windT = 0;
  return {
    update(dt) {
      windT += dt;
      return states.map((s) => {
        s.t += dt;
        let act = ACTS[s.act]!;
        if (s.t > actLength(act)) {
          s.act = (s.act + 1) % ACTS.length;
          s.t = 0;
          act = ACTS[s.act]!;
        }
        return { shape: act.shape, ...actAt(act, s.t) };
      });
    },
    wind() {
      const i = Math.floor(windT / WIND_HOLD_S) % SHOW_WINDS.length;
      const w = SHOW_WINDS[i] ?? WINDS.steady;
      return w === WINDS.steady ? base : w;
    },
    restart() {
      states = start();
      windT = 0;
    },
    get states() {
      return states;
    },
  };
};
