/**
 * Won prizes on their way out and the heap they make on the floor under the ball.
 *
 * A prize drops down the chute out of sight, comes out of the door in the cabinet's base, falls
 * to the floor (the strip's bottom edge) and slides across it to the heap round the bottom pole.
 * Above the floor's edge it is placed by latitude and longitude; below it, on the floor, in a flat
 * plane round the pole in metres (the stereographic projection, which keeps shapes as the strip
 * does). In that plane x is to the right and y down for someone underneath looking up, and a point
 * at longitude `lon` and r metres out is (r sin lon, -r cos lon), so the strip's "down" carries on
 * towards the pole with a turn of `lon`.
 */
import type { Rng } from "../../core/types";
import type { DesignId } from "./designs";

/** Most prizes on the heap; the oldest fades away as new ones land. */
export const HEAP_MAX = 30;
/** Most prizes on their way at once; more land at once. */
const FLIGHTS_MAX = 8;
const CHUTE_S = 0.55;
const DOOR_S = 0.3;
/** How fast a prize falls on the ball, m/s². Slower than real so it reads from below. */
const FALL = 6;
const FADE_S = 3;
const LAND_S = 0.5;

export interface Door {
  /** Middle of the prize door, radians. */
  lat: number;
  lon: number;
}

export interface HeapItem {
  id: number;
  design: DesignId;
  colour: number;
  /** Floor plane, metres. */
  x: number;
  y: number;
  /** Turn in the floor plane, radians (clockwise as seen from underneath). */
  angle: number;
  /** Seconds when it landed, and when it began to fade (or null). */
  landed: number;
  fading: number | null;
}

export type FlightStage = "chute" | "door" | "fall" | "slide";

export interface Flight {
  id: number;
  design: DesignId;
  colour: number;
  cabinet: number;
  door: Door;
  started: number;
  /** Where it lands on the floor plane, metres. */
  to: { x: number; y: number };
  /** Turn when it lands, and its spin while it falls, radians and radians a second. */
  spin: number;
}

export interface FlightPose {
  stage: FlightStage;
  /** 0 to 1 through the stage. */
  k: number;
  /** On the ball (door and fall): latitude and longitude. */
  lat: number;
  lon: number;
  /** On the floor plane (fall and slide), metres. */
  x: number;
  y: number;
  /** Turn relative to the strip's down, radians. */
  turn: number;
  /** How far out of the door it has come, 0 to 1. */
  out: number;
}

export interface HeapOptions {
  radius: number;
  /** Latitude of the floor's edge (the strip's bottom), radians. */
  floor: number;
  /** Radius of the heap on the floor, metres. */
  heap: number;
  rng: Rng;
}

export interface Heap {
  readonly items: readonly HeapItem[];
  readonly flights: readonly Flight[];
  /** Bumped whenever the floor picture changes. */
  readonly version: number;
  /** Total prizes that reached the heap. */
  readonly landed: number;
  launch(f: { design: DesignId; colour: number; cabinet: number; door: Door }, now: number): void;
  pose(f: Flight, now: number): FlightPose;
  /** Seconds a flight takes from the chute to the heap. */
  duration(f: Flight): number;
  /** Prizes already there when the show starts. */
  prefill(items: readonly { design: DesignId; colour: number }[], now: number): void;
  step(now: number): void;
  /** Whether anything on the floor moves at `now`. */
  moving(now: number): boolean;
  setGeometry(o: { radius: number; floor: number; heap: number }): void;
}

/** Floor-plane metres for a point `theta` radians from the bottom pole at `lon`. */
export const floorPoint = (radius: number, theta: number, lon: number) => {
  const r = 2 * radius * Math.tan(theta / 2);
  return { x: r * Math.sin(lon), y: -r * Math.cos(lon) };
};

/** Radians from the bottom pole of a floor-plane point. */
export const floorTheta = (radius: number, x: number, y: number): number =>
  2 * Math.atan(Math.hypot(x, y) / (2 * radius));

export const createHeap = (o: HeapOptions): Heap => {
  const { rng } = o;
  let { radius, floor, heap: heapR } = o;
  const items: HeapItem[] = [];
  const flights: Flight[] = [];
  let version = 0;
  let nextId = 1;
  let landedCount = 0;

  const fallTime = (f: Flight) => Math.sqrt((2 * radius * Math.max(0, f.door.lat - floor)) / FALL);
  /** Speed on reaching the floor, with a bounce taken off. */
  const slideSpeed = (f: Flight) => 0.55 * FALL * fallTime(f);
  const edge = (f: Flight) => floorPoint(radius, floor + Math.PI / 2, f.door.lon);
  const slideTime = (f: Flight) => {
    const e = edge(f);
    const d = Math.hypot(f.to.x - e.x, f.to.y - e.y);
    return Math.max(0.6, (2 * d) / Math.max(0.3, slideSpeed(f)));
  };
  const duration = (f: Flight) => CHUTE_S + DOOR_S + fallTime(f) + slideTime(f);

  const land = (f: Flight, now: number) => {
    const turn = f.spin * (fallTime(f) + slideTime(f) * 0.5);
    items.push({
      id: f.id,
      design: f.design,
      colour: f.colour,
      x: f.to.x,
      y: f.to.y,
      angle: turn + f.door.lon,
      landed: now,
      fading: null,
    });
    landedCount++;
    // Nudge the prizes it lands on, a little, as a heap settles.
    for (const it of items) {
      if (it.id === f.id) continue;
      const dx = it.x - f.to.x;
      const dy = it.y - f.to.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.25 && d > 1e-6) {
        it.x += (dx / d) * 0.04;
        it.y += (dy / d) * 0.04;
      }
    }
    const alive = items.filter((it) => it.fading === null);
    if (alive.length > HEAP_MAX) alive[0]!.fading = now;
    version++;
  };

  const spot = (lon: number) => {
    // Somewhere on the heap, leaning to the side it came from.
    const a = lon + rng.range(-0.9, 0.9);
    const r = heapR * Math.sqrt(rng.next());
    return { x: r * Math.sin(a), y: -r * Math.cos(a) };
  };

  return {
    items,
    flights,
    get version() {
      return version;
    },
    get landed() {
      return landedCount;
    },
    launch(f, now) {
      if (flights.length >= FLIGHTS_MAX) {
        const first = flights.shift()!;
        land(first, now);
      }
      flights.push({
        id: nextId++,
        design: f.design,
        colour: f.colour,
        cabinet: f.cabinet,
        door: f.door,
        started: now,
        to: spot(f.door.lon),
        spin: rng.range(-2.5, 2.5),
      });
      version++;
    },
    pose(f, now) {
      const t = now - f.started;
      const fall = fallTime(f);
      const slide = slideTime(f);
      const base = { lat: f.door.lat, lon: f.door.lon, x: 0, y: 0, turn: 0, out: 0 };
      if (t < CHUTE_S) return { ...base, stage: "chute", k: t / CHUTE_S };
      if (t < CHUTE_S + DOOR_S) {
        const k = (t - CHUTE_S) / DOOR_S;
        return { ...base, stage: "door", k, out: k };
      }
      const tf = t - CHUTE_S - DOOR_S;
      if (tf < fall) {
        const lat = f.door.lat - (0.5 * FALL * tf * tf) / radius;
        const p = floorPoint(radius, lat + Math.PI / 2, f.door.lon);
        return {
          ...base,
          stage: "fall",
          k: tf / fall,
          lat,
          x: p.x,
          y: p.y,
          turn: f.spin * tf,
          out: 1,
        };
      }
      const ts = Math.min(slide, tf - fall);
      const k = ts / slide;
      // Slowing evenly to a stop on its spot.
      const ease = k * (2 - k);
      const e = edge(f);
      return {
        ...base,
        stage: "slide",
        k,
        lat: floor,
        x: e.x + (f.to.x - e.x) * ease,
        y: e.y + (f.to.y - e.y) * ease,
        turn: f.spin * (fall + slide * 0.5 * ease),
        out: 1,
      };
    },
    duration,
    prefill(list, now) {
      for (const p of list) {
        const a = rng.range(-Math.PI, Math.PI);
        const r = heapR * Math.sqrt(rng.next());
        items.push({
          id: nextId++,
          design: p.design,
          colour: p.colour,
          x: r * Math.sin(a),
          y: -r * Math.cos(a),
          angle: rng.range(-Math.PI, Math.PI),
          landed: now - LAND_S,
          fading: null,
        });
      }
      while (items.length > HEAP_MAX) items.shift();
      version++;
    },
    step(now) {
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i]!;
        if (now - f.started >= duration(f)) {
          flights.splice(i, 1);
          land(f, now);
        }
      }
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]!;
        if (it.fading !== null && now - it.fading >= FADE_S) {
          items.splice(i, 1);
          version++;
        }
      }
    },
    moving(now) {
      if (flights.some((f) => now - f.started >= CHUTE_S + DOOR_S)) return true;
      return items.some((it) => now - it.landed < LAND_S || it.fading !== null);
    },
    setGeometry(g) {
      radius = g.radius;
      floor = g.floor;
      heapR = g.heap;
      version++;
    },
  };
};

/** How a heap item looks at `now`: its scale (a bounce on landing) and opacity. */
export const itemLook = (it: HeapItem, now: number): { scale: number; alpha: number } => {
  const age = now - it.landed;
  const scale = age < LAND_S ? 1 + 0.12 * Math.sin((age / LAND_S) * Math.PI) : 1;
  const alpha = it.fading === null ? 1 : Math.max(0, 1 - (now - it.fading) / FADE_S);
  return { scale, alpha };
};
