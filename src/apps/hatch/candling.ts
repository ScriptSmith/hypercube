/**
 * What a candling lamp shows through the 21 days, as smooth functions of the day (1 at the
 * start of day 1): the yolk's shadow, the embryo's size, eye and heartbeat, the veins spreading,
 * the egg darkening as the chick fills it, the air cell growing at the blunt end and tipping
 * ("drawdown"), and the beak breaking into it (internal pip). The days follow Hamburger and
 * Hamilton 1951 and the extension guides the captions cite; the air cell follows Tabler 2019's
 * measured depths, and drawdown Alverson 2017. The ball is the whole egg, its long axis
 * upright, so the egg's length runs from pole to pole.
 */
import { DEG } from "../../core/sphere";

/** A table of (day, value) pairs, read with straight lines between them. */
export type Table = readonly (readonly [number, number])[];

export const read = (table: Table, x: number): number => {
  if (x <= table[0]![0]) return table[0]![1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]!;
    if (x <= x1) {
      const [x0, y0] = table[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1]![1];
};

/**
 * The embryo's shadow, as the size of its curled shape in radians round the ball. The sources
 * give no lengths before day 10, so the shadow grows from a dot on day 2 to about a third of
 * the egg's length (a third of π here) by day 9.
 */
export const EMBRYO_SIZE: Table = [
  [1.5, 0.03],
  [2, 0.05],
  [3, 0.12],
  [4, 0.2],
  [5, 0.3],
  [6, 0.42],
  [7, 0.6],
  [9, 1.05],
  [11, 1.3],
  [13, 1.5],
];

/** How dark the embryo's own shadow is: a faint spot on day 2, a clear shape by day 7. */
const EMBRYO_DARK: Table = [
  [1.6, 0],
  [2.2, 0.25],
  [3, 0.45],
  [5, 0.6],
  [8, 0.72],
  [12, 0.8],
];

/** The dark eye spot, from day 4 until the growing mass hides it. */
const EYE: Table = [
  [3.4, 0],
  [4.2, 0.8],
  [11, 0.85],
  [13, 0.4],
  [14.5, 0],
];

/** The heart: a small spot beating from day 2, lost in the growing body after day 5. */
const HEART: Table = [
  [1.8, 0],
  [2.2, 0.4],
  [4.5, 0.45],
  [5.5, 0],
];

/**
 * How far the veins have spread from the embryo, radians round the ball: a short way over the
 * yolk on day 3, much of its upper side by day 5, reaching the shell on day 6, the upper half
 * by day 9, the whole shell by day 12.
 */
export const VEIN_REACH: Table = [
  [2, 0],
  [2.6, 0.1],
  [3, 0.25],
  [4, 0.55],
  [5, 0.9],
  [6, 1.25],
  [9, 1.95],
  [12, 3.14],
];

/** How strongly the veins show: a faint tinge on day 2, clear, then lost as the egg darkens. */
const VEIN_SHOW: Table = [
  [2, 0.25],
  [3, 0.6],
  [5, 0.85],
  [11, 0.85],
  [13, 0.55],
  [16, 0.25],
  [18, 0.1],
];

/** The yolk's soft shadow and size (radians), drawn into the body on days 19 and 20. */
const YOLK: Table = [
  [1, 0.3],
  [6, 0.26],
  [12, 0.18],
  [17, 0.1],
  [19.5, 0],
];
const YOLK_R: Table = [
  [1, 1.0],
  [12, 0.85],
  [18, 0.7],
];

/**
 * The growing chick's dark mass round the embryo: a little dimmer from day 6, dark round the
 * middle by day 12, dark apart from the air cell by day 18.
 */
const DARK: Table = [
  [5.5, 0],
  [6, 0.08],
  [8, 0.3],
  [10, 0.5],
  [12, 0.62],
  [14, 0.78],
  [16, 0.88],
  [18, 0.94],
];
const DARK_REACH: Table = [
  [6, 0.5],
  [8, 0.9],
  [10, 1.4],
  [12, 1.9],
  [14, 2.4],
  [16, 2.9],
  [18, 3.4],
];
/** The small end stays light longest: how much of the darkness it is spared. */
const SMALL_END: Table = [
  [9, 0.75],
  [13, 0.6],
  [16, 0.3],
  [17.5, 0],
];

/** How far up the embryo sits, radians: it moves towards the blunt end over the days. */
const EMBRYO_LAT: Table = [
  [2, 0],
  [8, 8 * DEG],
  [14, 18 * DEG],
];

/**
 * The air cell's lower edge as a latitude, from measured depths in a 57 mm egg (Tabler 2019):
 * a shallow cap at about 60° on day 1, down to about 27° by day 18.
 */
export const AIR_LAT: Table = [
  [1, 60 * DEG],
  [2, 50 * DEG],
  [3, 44 * DEG],
  [4, 43 * DEG],
  [5, 42 * DEG],
  [6, 40 * DEG],
  [8, 38 * DEG],
  [9, 37 * DEG],
  [11, 35 * DEG],
  [12, 34 * DEG],
  [14, 32 * DEG],
  [16, 30 * DEG],
  [18, 27 * DEG],
];

/** Drawdown on day 19: the edge tips lower on one side, radians. */
export const DRAWDOWN: Table = [
  [18.6, 0],
  [19.4, 13 * DEG],
  [21, 15 * DEG],
];

/** Internal pip on day 20: the beak's shadow inside the air cell. */
export const PIP_IN: Table = [
  [19.9, 0],
  [20.5, 1],
];

/** How much the embryo twitches when it moves: from day 6, now and then, never thrashing. */
const MOVES: Table = [
  [5.6, 0],
  [6.5, 0.12],
  [10, 0.16],
  [14, 0.1],
  [18, 0.05],
];

export interface CandleState {
  yolk: number;
  yolkRadius: number;
  /** Size of the embryo's curled shape, radians. */
  size: number;
  embryo: number;
  /** How high the embryo sits, radians. */
  embryoLat: number;
  eye: number;
  heart: number;
  /** Turn of the embryo's curl, radians: it twitches now and then. */
  turn: number;
  dark: number;
  darkReach: number;
  smallEnd: number;
  vein: number;
  /** The air cell: points with `dot(dir, airN) > air` are in it. */
  air: number;
  /** How far the air cell's edge is tipped (drawdown), radians. */
  tilt: number;
  pipIn: number;
}

/** A number from 0 to 1 for each whole number, the same every time. */
const hash01 = (n: number): number => {
  let h = Math.imul(n | 0, 0x2c9277b5) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 0x6a5d39e9);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

/** Short twitches with still spells between, every few seconds: 0 when still, up to 1. */
export const twitch = (seconds: number, phase: number): number => {
  const window = 4.5;
  const k = Math.floor((seconds + phase) / window);
  const into = (seconds + phase) % window;
  const start = hash01(k) * 3;
  const length = 0.5 + hash01(k + 7919) * 0.6;
  const x = (into - start) / length;
  if (x < 0 || x > 1 || hash01(k + 104729) < 0.25) return 0;
  return Math.sin(Math.PI * x) * Math.sin(x * 9 + k);
};

/** The candling picture on `day` (1 to 22), `seconds` of show time for the movements. */
export const candleState = (day: number, seconds: number, phase: number): CandleState => {
  const beat = 0.5 + 0.5 * Math.sin(seconds * 2 * Math.PI * 2.2);
  return {
    yolk: read(YOLK, day),
    yolkRadius: read(YOLK_R, day),
    size: read(EMBRYO_SIZE, day),
    embryo: read(EMBRYO_DARK, day),
    embryoLat: read(EMBRYO_LAT, day),
    eye: read(EYE, day),
    heart: read(HEART, day) * beat * beat,
    turn: read(MOVES, day) * twitch(seconds, phase),
    dark: read(DARK, day),
    darkReach: read(DARK_REACH, day),
    smallEnd: read(SMALL_END, day),
    vein: read(VEIN_SHOW, day),
    air: Math.sin(read(AIR_LAT, day)),
    tilt: read(DRAWDOWN, day),
    pipIn: read(PIP_IN, day),
  };
};

/** The day a vein `rho` radians from the embryo first shows. */
export const veinDay = (rho: number): number => {
  for (let i = 1; i < VEIN_REACH.length; i++) {
    const [d1, r1] = VEIN_REACH[i]!;
    if (rho <= r1) {
      const [d0, r0] = VEIN_REACH[i - 1]!;
      return d0 + ((d1 - d0) * (rho - r0)) / Math.max(1e-6, r1 - r0);
    }
  }
  return VEIN_REACH[VEIN_REACH.length - 1]![0];
};
