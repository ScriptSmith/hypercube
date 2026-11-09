/**
 * The people in front of the wall, for the eye to look at: an imagined crowd that walks past,
 * stops to look and moves on, and the real people touching the wall. The eye looks at a touch
 * wherever it is on the wall, high or low, as at a point a fixed way out in front of the touch, so
 * it turns in proportion to where the touch is across the whole wall; a touch's other places to
 * look (the "face" and "hands" of whoever touched) stay close round it. When the finger lifts the
 * place stays a moment, then the person walks off.
 *
 * Positions are venue metres: x along the wall (0 at its middle), z out from it into the room.
 * Directions are from the eye's centre, squeezed towards straight out from the wall (see `squeeze`)
 * so someone at the far end of the wall still has the iris turned to them and in view.
 */
import type { Vec3 } from "../../core/sphere";
import type { Rng, SphereInfo } from "../../core/types";
import { type Crowd, MAX_PEOPLE, PARTS, type Person } from "./crowd";
import { norm } from "./geom";

export interface WallRoom {
  /** The eye's centre, venue metres. */
  centre: Vec3;
  radius: number;
  /** The wall's ends along x, metres. */
  left: number;
  right: number;
  /** How far the room runs out from the wall, metres. */
  depth: number;
}

/**
 * How a touch is placed: the eye looks at it as at a point this far out from the wall at the
 * touch's height, metres, so touches anywhere on the wall turn it in proportion (closer, and
 * everything off to the side would look nearly the same).
 */
export const TOUCHER = {
  out: 2.6,
  /** Touches this close on the wall, metres, are one person's hands. */
  sameWithin: 0.7,
  /** Seconds they stay after letting go, and the pull on the eye then, falling to 1. */
  linger: [2.5, 5] as [number, number],
  lingerPull: 4,
  /** Pull on the eye of whoever touched last, and of anyone else touching. */
  latestPull: 30,
  otherPull: 12,
  /** At most this many people touching at once; the oldest are let go beyond it. */
  most: 12,
};

/**
 * Directions further than this from straight out are squeezed towards it, never past `SQUEEZE`
 * radians: a real eye turns about 50 degrees, and further round the iris would leave the wall's
 * view.
 */
export const SQUEEZE = (52 * Math.PI) / 180;

/** `d` (unit) with its angle from +z squeezed by tanh towards `SQUEEZE`. */
export const squeeze = (d: Vec3): Vec3 => {
  const a = Math.acos(Math.max(-1, Math.min(1, d[2])));
  const s = Math.sin(a);
  if (s < 1e-6) return d[2] > 0 ? d : [0, 0, 1];
  const b = SQUEEZE * Math.tanh(a / SQUEEZE);
  const k = Math.sin(b) / s;
  return [d[0] * k, d[1] * k, Math.cos(b)];
};

export interface Toucher {
  readonly person: Person;
  /** Touches now down, venue metres on the wall, by pointer id. */
  readonly touches: ReadonlyMap<number, { x: number; y: number }>;
  /** When their latest touch began, crowd seconds. */
  readonly since: number;
  readonly order: number;
}

export interface WallCrowd extends Crowd {
  /** A finger down at wall point (x, y), metres; returns who touched and whether they are new. */
  touchDown(pointer: number, x: number, y: number): { person: Person; fresh: boolean };
  touchMove(pointer: number, x: number, y: number): void;
  touchUp(pointer: number): void;
  /** Let everyone touching go at once (a reset). */
  release(): void;
  /** People touching now, the latest first. */
  readonly touchers: readonly Toucher[];
  /** Someone touching for the eye to turn to: the latest mostly, now and then another. */
  focus(current: number | null): Person | null;
  setRoom(r: WallRoom): void;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

interface Hands {
  touches: Map<number, { x: number; y: number }>;
  since: number;
  /** Which touch began last, for ties in `since`. */
  order: number;
  /** Seconds left lingering after the last touch lifts, or null while touching. */
  linger: number | null;
  lingerFor: number;
}

export const createWallCrowd = (rng: Rng, start: WallRoom): WallCrowd => {
  let room = start;
  const people: Person[] = [];
  const hands = new Map<number, Hands>();
  const byPointer = new Map<number, number>();
  let nextId = 1;
  let order = 0;
  let arrivals = 0;
  let t = 0;
  let busy = rng.range(0.2, 0.8);
  let busyTarget = rng.range(0, 1);
  let busyTimer = rng.range(60, 240);

  const edge = (side: number) => (side < 0 ? room.left - 1.5 : room.right + 1.5);
  const mid = () => (room.left + room.right) / 2;
  const half = () => (room.right - room.left) / 2;

  /** Somewhere to go: past the wall, or to a spot in front of the eye to stop and look. */
  const goal = (p: Person) => {
    const r = rng.next();
    if (r < 0.5) {
      // Stop and look at the eye: mostly in front of it, children nearer.
      const spread = half() * 0.6;
      p.goalX = clamp(room.centre[0] + rng.range(-spread, spread), room.left, room.right);
      p.goalZ = p.child ? rng.range(1, 3.5) : rng.range(1.6, Math.min(room.depth * 0.7, 6.5));
      p.wait = 0;
    } else if (r < 0.8) {
      // Somewhere else along the wall.
      p.goalX = rng.range(room.left, room.right);
      p.goalZ = rng.range(1.2, room.depth * 0.8);
      p.wait = 0;
    } else {
      goOut(p);
    }
  };

  const goOut = (p: Person) => {
    p.leaving = true;
    p.wait = 0;
    const side = p.vx > 0.05 ? 1 : p.vx < -0.05 ? -1 : p.x < mid() ? -1 : 1;
    p.goalX = edge(side);
    p.goalZ = clamp(p.z + rng.range(-1, 1), 1, room.depth - 0.5);
  };

  const make = (x: number, z: number, child: boolean, tall: number): Person => ({
    id: nextId++,
    x,
    z,
    eye: tall,
    tall,
    child,
    upper: false,
    seated: false,
    goalX: x,
    goalZ: z,
    pace: child ? rng.range(0.6, 1.5) : rng.range(0.6, 1.3),
    wait: 0,
    leaving: false,
    vx: 0,
    vz: 0,
  });

  const evict = () => {
    // Make room: the oldest imagined person, or failing that the oldest toucher.
    const i = people.findIndex((p) => !hands.has(p.id));
    const out = people.splice(i >= 0 ? i : 0, 1)[0];
    if (out) dropHands(out.id);
  };

  const dropHands = (id: number) => {
    const h = hands.get(id);
    if (!h) return;
    for (const pointer of h.touches.keys()) byPointer.delete(pointer);
    hands.delete(id);
  };

  const arrive = (anywhere: boolean) => {
    if (people.length >= MAX_PEOPLE) return;
    const child = rng.next() < 0.3;
    const tall = child ? rng.range(0.95, 1.25) : rng.range(1.45, 1.75);
    const side = rng.next() < 0.5 ? -1 : 1;
    const p = make(edge(side), rng.range(1.2, room.depth - 1), child, tall);
    if (anywhere) {
      p.x = rng.range(room.left, room.right);
      p.z = rng.range(1.2, room.depth - 1);
    }
    goal(p);
    if (anywhere && rng.next() < 0.5) {
      p.x = p.goalX;
      p.z = p.goalZ;
      p.wait = rng.range(1, 15);
    }
    people.push(p);
    if (!anywhere) arrivals++;
  };

  const wanted = () => Math.round(1 + busy * 11);
  for (let i = 0; i < wanted(); i++) arrive(true);

  const pullOf = (p: Person) => {
    const h = hands.get(p.id);
    if (!h) return undefined;
    if (h.linger !== null) {
      return 1 + (TOUCHER.lingerPull - 1) * clamp(h.linger / h.lingerFor, 0, 1);
    }
    const latest = touchersList()[0];
    return latest && latest.person === p ? TOUCHER.latestPull : TOUCHER.otherPull;
  };

  const touchersList = (): Toucher[] => {
    const out: Toucher[] = [];
    for (const p of people) {
      const h = hands.get(p.id);
      if (h && h.linger === null) {
        out.push({ person: p, touches: h.touches, since: h.since, order: h.order });
      }
    }
    return out.sort((a, b) => b.since - a.since || b.order - a.order);
  };

  /** Where the eye looks for someone touching: the middle of their touches. */
  const standAt = (p: Person, h: Hands) => {
    let sx = 0;
    let sy = 0;
    for (const v of h.touches.values()) {
      sx += v.x;
      sy += v.y;
    }
    const n = Math.max(1, h.touches.size);
    p.goalX = sx / n;
    p.goalZ = TOUCHER.out;
    p.tall = sy / n;
    p.child = false;
  };

  const step = (dt: number) => {
    t += dt;
    busyTimer -= dt;
    if (busyTimer <= 0) {
      busyTarget = rng.next() ** 0.8;
      busyTimer = rng.range(60, 300);
    }
    busy += (busyTarget - busy) * Math.min(1, dt / 90);
    let walking = 0;
    for (const p of people) if (!p.leaving && !hands.has(p.id)) walking++;
    const want = wanted();
    if (walking < want && rng.next() < dt / 3) arrive(false);
    else if (walking > want && rng.next() < dt / 5) {
      const staying = people.filter((p) => !p.leaving && !hands.has(p.id));
      if (staying.length > 0) goOut(rng.pick(staying));
    }

    for (let i = people.length - 1; i >= 0; i--) {
      const p = people[i]!;
      const h = hands.get(p.id);
      if (h) {
        if (h.linger !== null) {
          h.linger -= dt;
          if (h.linger <= 0) {
            dropHands(p.id);
            p.wait = 0;
            p.tall = rng.range(1.45, 1.75);
            goOut(p);
          }
        }
        // Someone touching moves with their hands, at once, so a moving finger is followed.
        if (hands.has(p.id)) {
          const nx = p.goalX;
          const nz = p.goalZ;
          const a = Math.min(1, dt / 0.08);
          const vx = (nx - p.x) / Math.max(dt, 1e-3);
          // A finger also moves up and down; its speed that way stands in for vz, which only
          // says how fast they cross the eye's view.
          const vy = (p.tall - p.eye) / Math.max(dt, 1e-3);
          p.vx += (vx - p.vx) * a;
          p.vz += (vy - p.vz) * a;
          p.x = nx;
          p.z = nz;
          p.eye = p.tall;
          if (Math.abs(p.vx) < 0.02) p.vx = 0;
          if (Math.abs(p.vz) < 0.02) p.vz = 0;
          continue;
        }
      }
      if (p.wait > 0) {
        p.wait -= dt;
        p.vx = 0;
        p.vz = 0;
        if (p.wait <= 0) {
          if (rng.next() < 0.3) goOut(p);
          else goal(p);
        }
        continue;
      }
      const dx = p.goalX - p.x;
      const dz = p.goalZ - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) {
        p.vx = 0;
        p.vz = 0;
        if (p.leaving) {
          people.splice(i, 1);
          continue;
        }
        p.wait = p.child ? rng.range(1, 10) : rng.range(2, 25);
        continue;
      }
      const v = Math.min(p.pace, d / dt);
      p.vx = (dx / d) * v;
      p.vz = (dz / d) * v;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.eye += clamp(p.tall - p.eye, -1.5 * dt, 1.5 * dt);
    }
    for (const p of people) {
      const pull = pullOf(p);
      if (pull === undefined) delete p.pull;
      else p.pull = pull;
    }
  };

  const eyePoint = (p: Person): Vec3 => [
    p.x,
    hands.has(p.id) ? p.eye : clamp(p.eye, 0.5, 2.2),
    p.z,
  ];

  const crowd: WallCrowd = {
    people,
    get room() {
      return Math.max(room.depth, half());
    },
    upperFloor: 0,
    get arrivals() {
      return arrivals;
    },
    step,
    direction(p, part) {
      const c = room.centre;
      const at = eyePoint(p);
      let target: Vec3 = at;
      if (part && part !== "eyes") {
        const h = hands.get(p.id);
        const hand = part === "leftHand" || part === "rightHand";
        if (hand && h && h.linger === null && h.touches.size > 0) {
          // Their hands are the touches themselves, leftmost for the left hand.
          let pick: { x: number; y: number } | null = null;
          for (const v of h.touches.values()) {
            if (!pick || (part === "leftHand" ? v.x < pick.x : v.x > pick.x)) pick = v;
          }
          target = [pick!.x, pick!.y, TOUCHER.out];
        } else {
          const def = PARTS[part];
          // Round a touch, every place stays close by.
          const scale = h ? 1 : def.body ? clamp(p.tall, 0.5, 2.2) / 1.6 : 1;
          const feet = part === "feet" && !h;
          const up = feet ? 0.05 - at[1] : part === "feet" ? PARTS.chest.up : def.up * scale;
          const r = Math.hypot(p.x - c[0], p.z - c[2]);
          const sx = r > 0.05 ? (p.z - c[2]) / r : 1;
          const sz = r > 0.05 ? -(p.x - c[0]) / r : 0;
          const across = def.across * scale;
          target = [at[0] + sx * across, at[1] + up, at[2] + sz * across];
        }
      }
      return squeeze(norm([target[0] - c[0], target[1] - c[1], target[2] - c[2]]));
    },
    distance(p) {
      const c = room.centre;
      const at = eyePoint(p);
      return Math.hypot(at[0] - c[0], at[1] - c[1], at[2] - c[2]);
    },
    find(id) {
      return people.find((p) => p.id === id);
    },
    place(x, z, eye, wait) {
      if (people.length >= MAX_PEOPLE) evict();
      const p = make(x, z, eye < 1.3, eye);
      p.wait = wait;
      people.push(p);
      return p;
    },
    setSphere(_s: SphereInfo) {},
    setUpper(_on: boolean) {},
    touchDown(pointer, x, y) {
      // Another finger of someone already touching, or someone new.
      let near: Person | null = null;
      let best = TOUCHER.sameWithin;
      for (const p of people) {
        const h = hands.get(p.id);
        if (!h) continue;
        for (const v of h.touches.values()) {
          const d = Math.hypot(v.x - x, v.y - y);
          if (d < best) {
            best = d;
            near = p;
          }
        }
        const there = Math.hypot(p.x - x, p.eye - y);
        if (h.linger !== null && there < best) {
          best = there;
          near = p;
        }
      }
      let fresh = false;
      let p = near;
      const joining = !p || hands.get(p.id)?.linger !== null;
      if (joining) {
        // Too many touching: let the one who has touched longest go.
        let active = 0;
        for (const h of hands.values()) if (h.linger === null) active++;
        if (active >= TOUCHER.most) {
          const oldest = touchersList().at(-1);
          if (oldest) for (const pointer of oldest.touches.keys()) crowd.touchUp(pointer);
        }
      }
      if (!p) {
        if (people.length >= MAX_PEOPLE) evict();
        p = make(x, TOUCHER.out, false, y);
        people.push(p);
        fresh = true;
      }
      let h = hands.get(p.id);
      if (!h) {
        h = { touches: new Map(), since: t, order: 0, linger: null, lingerFor: 1 };
        hands.set(p.id, h);
      }
      h.order = ++order;
      if (h.linger !== null) fresh = true;
      h.linger = null;
      h.since = t;
      h.touches.set(pointer, { x, y });
      byPointer.set(pointer, p.id);
      p.leaving = false;
      p.wait = 0;
      standAt(p, h);
      if (fresh) {
        p.x = p.goalX;
        p.z = p.goalZ;
        p.vx = 0;
        p.vz = 0;
      }
      p.pull = pullOf(p);
      return { person: p, fresh };
    },
    touchMove(pointer, x, y) {
      const id = byPointer.get(pointer);
      if (id === undefined) return;
      const h = hands.get(id);
      const p = crowd.find(id);
      if (!h || !p) return;
      h.touches.set(pointer, { x, y });
      standAt(p, h);
    },
    touchUp(pointer) {
      const id = byPointer.get(pointer);
      byPointer.delete(pointer);
      if (id === undefined) return;
      const h = hands.get(id);
      if (!h) return;
      h.touches.delete(pointer);
      if (h.touches.size === 0) {
        h.lingerFor = rng.range(...TOUCHER.linger);
        h.linger = h.lingerFor;
      }
    },
    release() {
      for (const id of hands.keys()) {
        const h = hands.get(id)!;
        for (const pointer of h.touches.keys()) byPointer.delete(pointer);
        h.touches.clear();
        h.lingerFor = 0.5;
        h.linger = 0.5;
      }
    },
    get touchers() {
      return touchersList();
    },
    focus(current) {
      const list = touchersList();
      if (list.length === 0) return null;
      if (list.length === 1) return list[0]!.person;
      // The latest mostly; someone else touching now and then, rarely the one it is on.
      let total = 0;
      const w = list.map((x, i) => {
        const v = (i === 0 ? 3 : 1) * (x.person.id === current ? 0.35 : 1);
        total += v;
        return v;
      });
      let r = rng.next() * total;
      for (let i = 0; i < list.length; i++) {
        r -= w[i]!;
        if (r <= 0) return list[i]!.person;
      }
      return list[0]!.person;
    },
    setRoom(r) {
      room = r;
    },
  };
  return crowd;
};
