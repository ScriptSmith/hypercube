/**
 * One glider's flight along the course, in course px and seconds. A flap sets the vertical
 * velocity rather than adding to it, so mashing can't launch the glider. Collisions are a
 * circle against the rectangles above and below the next gate's gap, slightly forgiving.
 */
import {
  BOOST,
  BOOST_MAX,
  type Body,
  CEIL_Y,
  type CrashRule,
  FLOOR_Y,
  GRACE_S,
  OUT_RAMP,
  RADIUS,
  START_Y,
  TUMBLE_S,
} from "./config";
import { type Course, type Gate, nextGateIndex } from "./course";

export const MODES = ["waiting", "flying", "tumbling", "finished", "out"] as const;
export type Mode = (typeof MODES)[number];

/** Obstacles are this much smaller than they look, so a graze isn't a crash. */
const INSET = 8;
/** Downward speed the soft ceiling gives a glider that touches it. */
const CEIL_PUSH = 240;

export interface Flight {
  x: number;
  y: number;
  vy: number;
  /** Position before the last step, for interpolated drawing. */
  px: number;
  py: number;
  speed: number;
  mode: Mode;
  /** Clean gates in a row: the tumble rule's speed boost. */
  clean: number;
  /** Gates passed this race. */
  gates: number;
  /** Index of the next gate ahead. */
  next: number;
  /** Index of the gate the last crash happened at, which then isn't clean. */
  hit: number;
  /** Seconds of tumble left. */
  tumble: number;
  /** Seconds left in which the glider can't crash. */
  grace: number;
  /** Race ms when the glider crossed the finish line. */
  fin: number | null;
  /** Seconds since the last flap, for the wing beat. */
  flapAge: number;
  /** Tumble rotation, radians. */
  spin: number;
  crashes: number;
  /** A flap happened since the frame last reported this flight. */
  flapped: boolean;
  /** Seconds in the current mode. */
  age: number;
  /** Height it waits at on the start line. */
  home: number;
}

export interface Rules {
  crash: CrashRule;
  /** Base scroll speed, course px per second. */
  base: number;
  /** Race length in seconds, for the out rule's ramp. */
  race: number;
}

export type FlightEvent =
  | { type: "flap" }
  | { type: "gate"; gate: Gate }
  | { type: "crash"; floor: boolean }
  | { type: "finish"; t: number }
  | { type: "recover" };

export const createFlight = (): Flight => ({
  x: 0,
  y: START_Y,
  vy: 0,
  px: 0,
  py: START_Y,
  speed: 0,
  mode: "waiting",
  clean: 0,
  gates: 0,
  next: 0,
  hit: -1,
  tumble: 0,
  grace: 0,
  fin: null,
  flapAge: 1,
  spin: 0,
  crashes: 0,
  flapped: false,
  age: 0,
  home: START_Y,
});

/** Back to the start line, waiting for the race to begin. */
export const resetFlight = (f: Flight): void => {
  const home = f.home;
  Object.assign(f, createFlight());
  f.home = home;
  f.y = f.py = home;
};

/** The speed a flying glider has now. `t` is seconds since the race began. */
export const flyingSpeed = (f: Flight, body: Body, rules: Rules, t: number): number => {
  if (rules.crash === "out") {
    const ramp = Math.min(1, Math.max(0, t) / Math.max(1, (rules.race * 2) / 3));
    return rules.base * body.speed * (1 + OUT_RAMP * ramp);
  }
  return rules.base * body.speed * (1 + Math.min(BOOST_MAX, BOOST * f.clean));
};

/** Leave the start line (or join mid-race from it) with a small hop. */
export const launch = (f: Flight, body: Body, rules: Rules, t: number): void => {
  resetFlight(f);
  f.y = f.py = f.home;
  f.mode = "flying";
  f.vy = -body.flap * 0.45;
  f.speed = flyingSpeed(f, body, rules, t);
  f.flapAge = 0;
};

/** Returns true when the flap took. */
export const flap = (f: Flight, body: Body): boolean => {
  if (f.mode !== "flying") return false;
  f.vy = -body.flap;
  f.flapAge = 0;
  f.flapped = true;
  return true;
};

const circleHitsRect = (
  cx: number,
  cy: number,
  r: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) => {
  const nx = Math.min(x1, Math.max(x0, cx));
  const ny = Math.min(y1, Math.max(y0, cy));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
};

/** Whether a glider at (x, y) touches gate `g`'s obstacles. */
export const hitsGate = (g: Gate, x: number, y: number, r = RADIUS): boolean => {
  const x0 = g.x + INSET;
  const x1 = g.x + g.w - INSET;
  if (x + r <= x0 || x - r >= x1) return false;
  const top = g.c - g.h / 2 - INSET;
  const bottom = g.c + g.h / 2 + INSET;
  return (
    circleHitsRect(x, y, r, x0, -10_000, x1, top) || circleHitsRect(x, y, r, x0, bottom, x1, 10_000)
  );
};

const crash = (f: Flight, rules: Rules, floor: boolean, emit?: (e: FlightEvent) => void) => {
  f.crashes++;
  f.clean = 0;
  f.hit = f.next;
  f.age = 0;
  f.spin = 0;
  f.vy = floor ? -520 : -320;
  if (rules.crash === "out") {
    f.mode = "out";
  } else {
    f.mode = "tumbling";
    f.tumble = TUMBLE_S;
  }
  emit?.({ type: "crash", floor });
};

/**
 * Advance one fixed step. `t` is seconds since the race began, at the end of the step. A finish
 * is timed to the moment the glider crossed the line, in race ms.
 */
export const stepFlight = (
  f: Flight,
  dt: number,
  course: Course,
  body: Body,
  rules: Rules,
  t: number,
  emit?: (e: FlightEvent) => void,
): void => {
  f.px = f.x;
  f.py = f.y;
  f.age += dt;
  f.flapAge += dt;
  const gates = course.gates;

  switch (f.mode) {
    case "waiting": {
      // Hover on the start line with the wings going.
      f.y = f.home + Math.sin(f.age * 2.2) * 28;
      f.vy = 0;
      if (f.flapAge > 0.42) f.flapAge = 0;
      return;
    }
    case "flying": {
      f.speed = flyingSpeed(f, body, rules, t);
      f.vy = Math.min(body.maxFall, f.vy + body.gravity * dt);
      f.y += f.vy * dt;
      f.x += f.speed * dt;
      if (f.grace > 0) f.grace = Math.max(0, f.grace - dt);
      if (f.y - RADIUS < CEIL_Y) {
        f.y = CEIL_Y + RADIUS;
        f.vy = Math.max(f.vy, CEIL_PUSH);
      }
      while (f.next < gates.length && f.x - RADIUS > gates[f.next]!.x + gates[f.next]!.w) {
        const g = gates[f.next]!;
        f.gates++;
        if (f.hit !== g.i) {
          f.clean++;
          emit?.({ type: "gate", gate: g });
        }
        f.next++;
      }
      if (f.x >= course.length && f.fin === null) {
        const frac = f.x > f.px ? (course.length - f.px) / (f.x - f.px) : 1;
        f.fin = Math.round((t - dt + dt * Math.min(1, Math.max(0, frac))) * 1000);
        f.mode = "finished";
        f.age = 0;
        emit?.({ type: "finish", t: f.fin });
        return;
      }
      if (f.grace > 0) {
        if (f.y + RADIUS > FLOOR_Y) {
          f.y = FLOOR_Y - RADIUS;
          f.vy = -body.flap * 0.6;
        }
        return;
      }
      if (f.y + RADIUS >= FLOOR_Y) {
        f.y = FLOOR_Y - RADIUS;
        crash(f, rules, true, emit);
        return;
      }
      const g = gates[f.next];
      if (g && hitsGate(g, f.x, f.y)) crash(f, rules, false, emit);
      return;
    }
    case "tumbling": {
      f.speed = rules.base * body.speed * 0.3;
      f.x += f.speed * dt;
      f.vy = Math.min(body.maxFall, f.vy + body.gravity * 0.6 * dt);
      f.y = Math.min(FLOOR_Y - RADIUS, f.y + f.vy * dt);
      if (f.y >= FLOOR_Y - RADIUS) f.vy = Math.min(0, f.vy);
      f.spin += dt * 11;
      f.next = nextGateIndex(course, f.x, f.next);
      if (f.x >= course.length && f.fin === null) {
        f.fin = Math.round(t * 1000);
        f.mode = "finished";
        f.age = 0;
        emit?.({ type: "finish", t: f.fin });
        return;
      }
      f.tumble -= dt;
      if (f.tumble > 0) return;
      // Back in the air at the height of the next gap, with a moment's grace.
      const g = gates[f.next];
      f.y = g ? g.c : START_Y;
      f.py = f.y;
      f.vy = -body.flap * 0.35;
      f.mode = "flying";
      f.grace = GRACE_S;
      f.age = 0;
      f.spin = 0;
      f.flapAge = 0;
      emit?.({ type: "recover" });
      return;
    }
    case "finished": {
      // Glide on past the line, easing to a steady height.
      f.speed += (rules.base * 0.55 - f.speed) * Math.min(1, dt * 1.5);
      f.x += f.speed * dt;
      const target = START_Y + Math.sin(f.age * 1.3) * 120;
      f.vy += ((target - f.y) * 6 - f.vy) * Math.min(1, dt * 4);
      f.y += f.vy * dt;
      if (f.flapAge > 0.5) f.flapAge = 0;
      return;
    }
    case "out": {
      f.speed *= Math.exp(-dt * 3);
      f.x += f.speed * dt;
      if (f.y < FLOOR_Y - RADIUS) {
        f.vy = Math.min(body.maxFall, f.vy + body.gravity * dt);
        f.y = Math.min(FLOOR_Y - RADIUS, f.y + f.vy * dt);
        f.spin += dt * 9;
      } else {
        f.vy = 0;
        // Settle the tumble to lying on its side.
        f.spin += (Math.round(f.spin / Math.PI) * Math.PI + 0.35 - f.spin) * Math.min(1, dt * 6);
      }
      return;
    }
  }
};

/** Distance used for ranking: how far along the course the glider got. */
export const distanceOf = (f: Flight): number => Math.max(0, f.x);
