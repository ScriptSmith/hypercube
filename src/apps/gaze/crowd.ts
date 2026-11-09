/**
 * Imagined people in the room, for the eye to look at. There is no camera, so these are a
 * plausible crowd: people wander in, stop under the ball to look up, walk round and leave, and
 * the room fills and empties over minutes. Where the venue has a gallery round the room level
 * with the ball (`gallery` in its profile), people sit there for minutes at a time, so the eye
 * has faces straight across from it as well as below. Positions are metres on the floor from the spot under the ball's centre.
 */
import type { Rng, SphereInfo } from "../../core/types";
import type { Vec3 } from "../../core/sphere";
import { norm } from "./geom";

export interface Person {
  readonly id: number;
  x: number;
  z: number;
  /** Eye height above the floor they are on, metres. */
  eye: number;
  /** Eye height standing, metres. */
  tall: number;
  child: boolean;
  /** On the gallery rather than the floor under the ball. */
  upper: boolean;
  /** Sits down when they reach their goal (on the gallery). */
  seated: boolean;
  /** Where they are walking to, and how fast (metres a second). */
  goalX: number;
  goalZ: number;
  pace: number;
  /** Seconds left standing at the goal; walking while 0. */
  wait: number;
  /** Walking out of the room. */
  leaving: boolean;
  /** Metres a second, for following them. */
  vx: number;
  vz: number;
  /** How much more than usual they draw the eye (someone touching the wall); absent is 1. */
  pull?: number;
}

/**
 * Places on a person the eye can look at, metres across (to their side, seen from the ball) and
 * up from a point between their eyes. Body places scale with height; `feet` is the floor.
 */
export const PARTS = {
  eyes: { across: 0, up: 0, body: false },
  leftEye: { across: -0.032, up: 0, body: false },
  rightEye: { across: 0.032, up: 0, body: false },
  mouth: { across: 0, up: -0.075, body: false },
  chest: { across: 0, up: -0.3, body: true },
  leftHand: { across: -0.2, up: -0.68, body: true },
  rightHand: { across: 0.2, up: -0.68, body: true },
  feet: { across: 0, up: -1, body: true },
} as const;
export type Part = keyof typeof PARTS;

/**
 * The gallery round the room. Its floor is far enough below the ball's centre that
 * people sitting there have their eyes about level with it (seated eye height is about three
 * quarters of standing), but never lower than a storey. People sit near the rail, from a few
 * metres clear of the ball to most of the way to the walls, and come in by a few entrances.
 */
export const UPPER = {
  belowCentre: 1.3,
  minFloor: 3,
  /** Seated eye height as a share of standing. */
  seated: 0.75,
  /** The gallery's inner edge: at least this far clear of the ball, metres, and a share of the room. */
  clear: 3,
  inner: 0.5,
  outer: 0.85,
  entrances: 3,
  /** How many people it holds, from a quiet room to a busy one. */
  fewest: 1,
  most: 8,
  /**
   * Chances that someone sits rather than stands at the rail, that a newcomer joins someone
   * already there, and that someone leaves rather than moves on.
   */
  sit: 0.75,
  together: 0.6,
  leave: 0.35,
  /** Seconds sitting (adults, children) and standing at the rail. */
  sitFor: [40, 240] as [number, number],
  childSitFor: [20, 90] as [number, number],
  standFor: [5, 40] as [number, number],
  /** Metres a second someone's eyes rise or fall as they stand up or sit down. */
  rise: 0.8,
};

export interface Crowd {
  readonly people: readonly Person[];
  /** Radius of the floor people use, metres. */
  readonly room: number;
  /** The gallery's floor height, metres. */
  readonly upperFloor: number;
  /** People who have come in so far, for noticing newcomers. */
  readonly arrivals: number;
  step(dt: number): void;
  /** The direction from the ball's centre to someone's eyes, or to `part` of them. */
  direction(p: Person, part?: Part): Vec3;
  /** Distance from the ball's centre to someone's eyes, metres. */
  distance(p: Person): number;
  find(id: number): Person | undefined;
  /** Someone standing at `x`, `z` with their eyes at `eye` metres for `wait` seconds. */
  place(x: number, z: number, eye: number, wait: number): Person;
  setSphere(s: SphereInfo): void;
  /** People on the gallery, or nobody there (those there leave). */
  setUpper(on: boolean): void;
}

export const MAX_PEOPLE = 30;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export const createCrowd = (rng: Rng, sphere: SphereInfo, upperOn = true): Crowd => {
  let s = sphere;
  let upper = upperOn;
  const roomOf = (sp: SphereInfo) => Math.max(8, Math.min(16, sp.radius * 5));
  let room = roomOf(s);
  const upperFloor = () => Math.max(UPPER.minFloor, s.centreY - UPPER.belowCentre);
  const inner = () => Math.max(s.radius + UPPER.clear, room * UPPER.inner);
  const outer = () => Math.max(inner() + 1, room * UPPER.outer);
  const people: Person[] = [];
  let nextId = 1;
  let arrivals = 0;
  // How busy the room is, drifting over minutes.
  let busy = rng.range(0.2, 0.8);
  let busyTarget = rng.range(0, 1);
  let busyTimer = rng.range(60, 240);
  const first = rng.range(-Math.PI, Math.PI);
  const entrances = Array.from(
    { length: UPPER.entrances },
    (_, i) => first + (i * 2 * Math.PI) / UPPER.entrances + rng.range(-0.4, 0.4),
  );

  const goal = (p: Person) => {
    const r = rng.next();
    let d: number;
    // Most stop near or under the ball to look up at it.
    if (r < 0.55) d = rng.range(0, s.radius * 1.6);
    else if (r < 0.85) d = rng.range(s.radius, room * 0.6);
    else d = rng.range(room * 0.5, room * 0.95);
    const a = rng.range(-Math.PI, Math.PI);
    p.goalX = d * Math.sin(a);
    p.goalZ = d * Math.cos(a);
    p.wait = 0;
  };

  /**
   * A place on the gallery: a seat near the rail, or a spot at it. Near `from` if given, and
   * otherwise often beside someone already there, so people sit in groups.
   */
  const upperGoal = (p: Person, from?: number) => {
    let a = from === undefined ? rng.range(-Math.PI, Math.PI) : from + rng.range(-0.9, 0.9);
    if (from === undefined && rng.next() < UPPER.together) {
      const there = people.filter((q) => q.upper && !q.leaving && q !== p);
      if (there.length > 0) {
        const q = rng.pick(there);
        const side = rng.next() < 0.5 ? -1 : 1;
        a = Math.atan2(q.goalX, q.goalZ) + (side * rng.range(0.6, 1.2)) / inner();
      }
    }
    const lo = inner();
    p.seated = rng.next() < UPPER.sit;
    const d = p.seated ? rng.range(lo, lo + 0.35 * (outer() - lo)) : lo + rng.range(0, 0.3);
    p.goalX = d * Math.sin(a);
    p.goalZ = d * Math.cos(a);
    p.wait = 0;
  };

  const waitFor = (p: Person) => {
    if (!p.upper) return p.child ? rng.range(1, 10) : rng.range(2, 30);
    if (!p.seated) return rng.range(...UPPER.standFor);
    return rng.range(...(p.child ? UPPER.childSitFor : UPPER.sitFor));
  };

  const arrive = (anywhere: boolean, high = false) => {
    if (people.length >= MAX_PEOPLE) return;
    const child = rng.next() < (high ? 0.2 : 0.3);
    const tall = child ? rng.range(0.95, 1.25) : rng.range(1.45, 1.75);
    const p: Person = {
      id: nextId++,
      x: 0,
      z: 0,
      eye: tall,
      tall,
      child,
      upper: high,
      seated: false,
      goalX: 0,
      goalZ: 0,
      pace: child ? rng.range(0.6, 1.5) : rng.range(0.5, 1.2),
      wait: 0,
      leaving: false,
      vx: 0,
      vz: 0,
    };
    if (high) {
      upperGoal(p);
      const a = rng.pick(entrances);
      p.x = outer() * Math.sin(a);
      p.z = outer() * Math.cos(a);
      if (anywhere) {
        p.x = p.goalX;
        p.z = p.goalZ;
        p.wait = waitFor(p) * rng.next();
        if (p.seated) p.eye = tall * UPPER.seated;
      }
    } else {
      const a = rng.range(-Math.PI, Math.PI);
      const d = anywhere ? Math.sqrt(rng.next()) * room * 0.9 : room;
      p.x = d * Math.sin(a);
      p.z = d * Math.cos(a);
      goal(p);
      if (anywhere && rng.next() < 0.5) {
        p.x = p.goalX;
        p.z = p.goalZ;
        p.wait = rng.range(1, 20);
      }
    }
    people.push(p);
    if (!anywhere) arrivals++;
  };

  const wanted = () => Math.round(2 + busy * 16);
  const wantedUpper = () =>
    upper ? Math.round(UPPER.fewest + busy * (UPPER.most - UPPER.fewest)) : 0;
  for (let i = 0; i < wanted(); i++) arrive(true);
  for (let i = 0; i < wantedUpper(); i++) arrive(true, true);

  const goOut = (p: Person) => {
    p.leaving = true;
    p.wait = 0;
    if (p.upper) {
      // Back round the gallery to the nearest entrance.
      const at = Math.atan2(p.x, p.z);
      let best = entrances[0]!;
      for (const e of entrances) if (Math.abs(wrap(e - at)) < Math.abs(wrap(best - at))) best = e;
      p.goalX = outer() * Math.sin(best);
      p.goalZ = outer() * Math.cos(best);
      return;
    }
    const a = Math.atan2(p.x, p.z) + rng.range(-0.8, 0.8);
    p.goalX = (room + 1) * Math.sin(a);
    p.goalZ = (room + 1) * Math.cos(a);
  };

  const leave = (high: boolean) => {
    const staying = people.filter((p) => !p.leaving && p.upper === high);
    if (staying.length === 0) return;
    goOut(rng.pick(staying));
  };

  /** One step towards the goal: straight across the floor, or round the gallery's ring. */
  const walk = (p: Person, dt: number): boolean => {
    if (!p.upper) {
      const dx = p.goalX - p.x;
      const dz = p.goalZ - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) return true;
      const v = Math.min(p.pace, d / dt);
      p.vx = (dx / d) * v;
      p.vz = (dz / d) * v;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      if (!p.leaving) {
        const r = Math.hypot(p.x, p.z);
        if (r > room) {
          p.x *= room / r;
          p.z *= room / r;
        }
      }
      return false;
    }
    const r = Math.max(0.5, Math.hypot(p.x, p.z));
    const a = Math.atan2(p.x, p.z);
    const da = wrap(Math.atan2(p.goalX, p.goalZ) - a);
    const dr = Math.hypot(p.goalX, p.goalZ) - r;
    const d = Math.hypot(da * r, dr);
    if (d < 0.05) return true;
    const k = Math.min(p.pace * dt, d) / d;
    const nr = r + dr * k;
    const na = a + da * k;
    const x = nr * Math.sin(na);
    const z = nr * Math.cos(na);
    p.vx = (x - p.x) / dt;
    p.vz = (z - p.z) / dt;
    p.x = x;
    p.z = z;
    return false;
  };

  return {
    people,
    get room() {
      return room;
    },
    get upperFloor() {
      return upperFloor();
    },
    get arrivals() {
      return arrivals;
    },
    step(dt) {
      busyTimer -= dt;
      if (busyTimer <= 0) {
        busyTarget = rng.next() ** 0.8;
        busyTimer = rng.range(60, 300);
      }
      busy += (busyTarget - busy) * Math.min(1, dt / 90);
      let below = 0;
      let above = 0;
      for (const p of people) {
        if (p.leaving) continue;
        if (p.upper) above++;
        else below++;
      }
      // About one arrival or departure every few seconds while the count is off.
      const want = wanted();
      if (below < want && rng.next() < dt / 2.5) arrive(false);
      else if (below > want && rng.next() < dt / 4) leave(false);
      const wantAbove = wantedUpper();
      if (above < wantAbove && rng.next() < dt / 6) arrive(false, true);
      else if (above > wantAbove && rng.next() < dt / (upper ? 8 : 1)) leave(true);

      for (let i = people.length - 1; i >= 0; i--) {
        const p = people[i]!;
        // Eyes rise and fall as they stand up and sit down.
        const eyeTo = p.upper && p.seated && p.wait > 0 ? p.tall * UPPER.seated : p.tall;
        p.eye += clamp(eyeTo - p.eye, -UPPER.rise * dt, UPPER.rise * dt);
        if (p.wait > 0) {
          p.wait -= dt;
          p.vx = 0;
          p.vz = 0;
          if (p.wait <= 0) {
            if (p.upper) {
              if (rng.next() < UPPER.leave) goOut(p);
              else upperGoal(p, Math.atan2(p.x, p.z));
            } else {
              if (rng.next() < 0.12) leave(false);
              goal(p);
            }
          }
          continue;
        }
        if (!walk(p, dt)) continue;
        if (p.leaving) {
          people.splice(i, 1);
          continue;
        }
        p.vx = 0;
        p.vz = 0;
        p.wait = waitFor(p);
      }
    },
    direction(p, part) {
      const eye = clamp(p.eye, 0.5, 2.2);
      const y = (p.upper ? upperFloor() : 0) + eye - s.centreY;
      if (!part || part === "eyes") return norm([p.x, y, p.z]);
      const at = PARTS[part];
      const scale = at.body ? clamp(p.tall, 0.5, 2.2) / 1.6 : 1;
      let up = at.up * scale;
      if (part === "feet") up = 0.05 - eye;
      // Sitting, their hands are in their lap.
      else if (at.body && part !== "chest" && eye < p.tall - 0.1) up = -0.55 * scale;
      // Across is sideways to the line from the ball's axis to them.
      const r = Math.hypot(p.x, p.z);
      const sx = r > 0.05 ? p.z / r : 1;
      const sz = r > 0.05 ? -p.x / r : 0;
      const across = at.across * scale;
      return norm([p.x + sx * across, y + up, p.z + sz * across]);
    },
    distance(p) {
      const y = (p.upper ? upperFloor() : 0) + clamp(p.eye, 0.5, 2.2) - s.centreY;
      return Math.hypot(p.x, y, p.z);
    },
    find(id) {
      return people.find((p) => p.id === id);
    },
    place(x, z, eye, wait) {
      if (people.length >= MAX_PEOPLE) people.shift();
      const p: Person = {
        id: nextId++,
        x,
        z,
        eye,
        tall: eye,
        child: eye < 1.3,
        upper: false,
        seated: false,
        goalX: x,
        goalZ: z,
        pace: 0.8,
        wait,
        leaving: false,
        vx: 0,
        vz: 0,
      };
      people.push(p);
      return p;
    },
    setSphere(sp) {
      s = sp;
      room = roomOf(sp);
    },
    setUpper(on) {
      upper = on;
    },
  };
};
