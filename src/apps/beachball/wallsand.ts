/**
 * The sand packed in the bucket. Turned over onto the sand, the bucket leaves a castle in its
 * own shape standing under it, which shows once the bucket is lifted or knocked away. Lying on
 * its side, its sand slumps out of the mouth into a heap. Held or flying with its mouth down for
 * a moment, lumps fall out and land in a heap. Empty, it is light and lively (`EMPTY_BUCKET`).
 *
 * Swept through a heap or a castle, the bucket scoops it up and is full again. An empty bucket
 * that has stood upright for a while is shovelled full by an unseen spade, a spadeful at a time,
 * from a heap nearby or the sand beside it, so the wall gets its bucket back with nobody there.
 *
 * The spade goes in the bucket: lowered blade first into its mouth, it stands there leaning,
 * rides along with the bucket, falls out when the bucket tips over, and a finger on its handle
 * pulls it out again. Its blade picks up a spadeful of sand when it is dragged through the sand
 * or a heap; held over the bucket's mouth it pours the sand in, and turned over or flicked it
 * throws it, into the bucket if the throw falls through its mouth, or onto the sand in a heap.
 *
 * Castles stand a while and then crumble into heaps; heaps settle flat and fade into the beach.
 * A ball, a toy or a finger knocks a castle down at once and scatters a heap. There are never
 * more than two castles and six mounds in all, kept in a fixed pool, and at most eight throws
 * of sand in the air.
 */
import type { Rng } from "../../core/types";
import type { Prop, World } from "./wallphysics";
import {
  BUCKET_MOUTH,
  BUCKET_SAND,
  EMPTY_BUCKET,
  extentAt,
  PROP_SCALE,
  PROP_SPECS,
} from "./wallprops";

export const MAX_CASTLES = 2;
export const MAX_MOUNDS = 6;
/** A castle is the bucket's sand turned out: wide at its foot, its height the sand's. */
export const CASTLE = {
  radius: BUCKET_SAND.mouth,
  top: BUCKET_SAND.bottom,
  height: BUCKET_SAND.height,
} as const;
/** A heap of the same sand fallen loose. */
export const HEAP = { radius: 0.3, height: 0.13 } as const;

/** Held or flying with its mouth this far down (its axis's height) this long, s, it spills. */
const FLING_UP = -0.3;
export const FLING_AFTER = 0.45;
/** Landing on the sand turned over this far it leaves a castle; on its side, a heap. */
const CASTLE_UP = -0.6;
const SLUMP_UP = 0.6;
const SLUMP_AFTER = 0.35;
/** Seconds a castle stands once uncovered, and how long it takes to crumble, or when knocked. */
export const STAND = [15, 25] as const;
const CRUMBLE = 2.2;
const KNOCKED = 0.7;
/** After a knock a mound takes no other for this long, s, so one bump is one knock. */
const KNOCK_GAP = 0.5;
/** Seconds a heap holds, then settles flat, then fades out. */
const HOLD = [6, 10] as const;
const SETTLE = 10;
const FADE = 1.5;
/** How flat a settled heap gets before it fades, as a share of its height. */
const FLAT = 0.12;
/** An empty bucket standing upright this long, s, is shovelled full. */
export const SHOVEL_WAIT = 8;
const SPADEFUL = 0.25;
const SPADE_GAP = 0.6;
const SPADE_FLIGHT = 0.5;
/** Upright enough to be shovelled into, radians from standing. */
const UPRIGHT = 0.4;
const GRAVITY = 9.8;
/** Sand thrown at the bucket goes in if it falls within this of the middle of its mouth. */
const MOUTH_IN = BUCKET_SAND.mouth * 0.85;
const MAX_THROWS = 8;
/** How much of the bucket a spadeful of sand fills. */
export const SPADE_LOAD = 0.34;
/** The spade's blade tip, the middle of its blade and its blade's end, up its length, metres. */
const BLADE_TIP = 0.02 * PROP_SCALE;
const BLADE_MID = 0.13 * PROP_SCALE;
const BLADE_END = 0.25 * PROP_SCALE;
/** The spade standing in the bucket: its tip in the bucket's model frame, and its lean. */
const STOW_TIP = { x: -0.05 * PROP_SCALE, y: 0.05 * PROP_SCALE };
const STOW_LEAN = -0.2;
/** The bucket tipped this far drops the spade, radians. */
const STOW_TIP_OVER = 1;

export type MoundPhase = "stand" | "crumble" | "heap" | "settle" | "fade";

export interface Mound {
  readonly index: number;
  active: boolean;
  /** Formed as a castle; it stays one until it has crumbled. */
  castle: boolean;
  x: number;
  /** 1 a crisp castle, 0 a rounded heap. */
  shape: number;
  /** Height as a share of a full castle's or heap's, and width as a share of its own. */
  level: number;
  size: number;
  /** How far a heap has grown in as its sand lands, 0 to 1, and its opacity as it fades. */
  grow: number;
  opacity: number;
  /** Still under the bucket that moulded it. */
  hidden: boolean;
  phase: MoundPhase;
  /** Seconds left in this phase, and how long the phase lasts. */
  left: number;
  span: number;
  age: number;
  /** A turn about its own upright axis, so no two look alike. */
  turn: number;
  /** Height a settling heap started from. */
  from: number;
  shed: number;
  /** Seconds before it can be knocked again. */
  cool: number;
}

export interface SandFx {
  lumps(
    x: number,
    y: number,
    vx: number,
    vy: number,
    lumps: number,
    grains: number,
    spread: number,
    land: number,
  ): void;
  puff(x: number, y: number, speed: number): void;
}

export interface SandStats {
  castles: number;
  slumps: number;
  flings: number;
  scoops: number;
  shovels: number;
  refills: number;
  knocks: number;
  /** The spade put in the bucket, its blade filled, poured into the bucket and thrown. */
  stows: number;
  digs: number;
  pours: number;
  throws: number;
}

export interface Sand {
  readonly mounds: readonly Mound[];
  /** How full the bucket is, 0 to 1. */
  readonly fill: number;
  readonly shovelling: boolean;
  /** A castle is still hidden under the bucket that moulded it. */
  readonly covered: boolean;
  /** The spade stands in the bucket, and how much sand its blade holds, 0 or 1. */
  readonly stowed: boolean;
  readonly load: number;
  readonly stats: Readonly<SandStats>;
  step(dt: number, world: World, bucket: Prop | null, spade: Prop | null, fx: SandFx): void;
  /** How far (x, y) is from the handle of the spade standing in the bucket, or Infinity. */
  handleDistance(spade: Prop | null, x: number, y: number): number;
  /** Take the spade out of the bucket, where it is, to be held. */
  pullSpade(world: World, spade: Prop | null): void;
  /** A finger landing at (x, y) knocks down a castle or scatters a heap it lands on. */
  touch(x: number, y: number, fx: SandFx): boolean;
  /** Something low on the sand at `x`, `r` wide either side, knocks into any mound there. */
  knockAt(x: number, r: number, fx: SandFx): boolean;
  /** How high a mound stands over the sand at x, metres, for the crab's way. */
  heightAt(x: number): number;
  setFloor(floor: number): void;
  /** Fill the bucket, empty the spade and clear the sand, as everything is put back. */
  reset(world: World, bucket: Prop | null, spade: Prop | null): void;
  /** Empty the bucket at once, as if it had been turned out (for tests and admin). */
  spill(world: World, bucket: Prop | null, fx: SandFx): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The bucket's shape and feel for how full it is. */
export const bucketSpec = (fill: number) => (fill >= 0.5 ? PROP_SPECS.bucket : EMPTY_BUCKET);

/** Where the middle of the bucket's mouth is, and how fast it moves. */
export const mouthOf = (p: Prop) => {
  const bx = p.spec.origin.x;
  const by = p.spec.origin.y + BUCKET_MOUTH;
  const rx = p.cs * bx - p.sn * by;
  const ry = p.sn * bx + p.cs * by;
  return { x: p.x + rx, y: p.y + ry, vx: p.vx - p.w * ry, vy: p.vy + p.w * rx };
};

export const createSand = (rng: Rng, initialFloor: number): Sand => {
  let floor = initialFloor;
  let fill = 1;
  let downT = 0;
  let sideT = 0;
  let uprightT = 0;
  let spadeWait = 0;
  let spadesLeft = 0;
  let time = 0;
  let stowed = false;
  let load = 0;
  /** Sand in the air: when it lands, how much, and whether in the bucket or on the sand. */
  const throws: { at: number; amount: number; into: boolean; x: number; bx: number }[] = [];
  const pending: { at: number; x: number; level: number; size: number }[] = [];
  const stats: SandStats = {
    castles: 0,
    slumps: 0,
    flings: 0,
    scoops: 0,
    shovels: 0,
    refills: 0,
    knocks: 0,
    stows: 0,
    digs: 0,
    pours: 0,
    throws: 0,
  };
  const mounds: Mound[] = Array.from({ length: MAX_MOUNDS }, (_, index) => ({
    index,
    active: false,
    castle: false,
    x: 0,
    shape: 0,
    level: 0,
    size: 1,
    grow: 1,
    opacity: 1,
    hidden: false,
    phase: "fade",
    left: 0,
    span: 1,
    age: 0,
    turn: 0,
    from: 1,
    shed: 0,
    cool: 0,
  }));

  /** Its height over the sand now, metres. */
  const heightOf = (m: Mound) =>
    (m.shape * CASTLE.height + (1 - m.shape) * HEAP.height) * m.level * m.grow;
  const radiusOf = (m: Mound) =>
    (m.shape * CASTLE.radius + (1 - m.shape) * HEAP.radius * 1.05) * m.size;

  const enter = (m: Mound, phase: MoundPhase, span: number) => {
    m.phase = phase;
    m.left = span;
    m.span = span;
    if (phase === "settle") m.from = m.level;
  };

  /** A free slot, or the oldest heap's (or failing that the oldest castle's). */
  const slot = (): Mound => {
    const free = mounds.find((m) => !m.active);
    if (free) return free;
    let oldest: Mound | null = null;
    for (const m of mounds) {
      if (m.phase === "stand") continue;
      if (!oldest || m.age > oldest.age) oldest = m;
    }
    if (oldest) return oldest;
    return mounds.reduce((a, b) => (b.age > a.age ? b : a));
  };

  const knock = (m: Mound, fx: SandFx) => {
    if (m.cool > 0) return false;
    const h = heightOf(m);
    if (m.phase === "stand" || (m.phase === "crumble" && m.left > KNOCKED)) {
      enter(m, "crumble", KNOCKED);
      m.left = KNOCKED * m.shape;
      fx.lumps(m.x, floor + h * 0.6, 0, 0.9, 3, 6, 1.1, floor);
      fx.puff(m.x, floor, 2.5);
    } else if (m.phase === "heap" || m.phase === "settle") {
      m.level *= 0.55;
      if (m.phase === "settle") m.from = Math.max(m.level, FLAT);
      if (m.level < 0.2) enter(m, "fade", FADE);
      fx.lumps(m.x, floor + h * 0.5, 0, 0.6, 0, 6, 0.9, floor);
      fx.puff(m.x, floor, 1.6);
    } else {
      return false;
    }
    m.cool = KNOCK_GAP;
    stats.knocks++;
    return true;
  };

  const formCastle = (x: number, level: number, fx: SandFx) => {
    // Never more than two castles: the oldest crumbles to make room.
    const standing = mounds.filter((m) => m.active && m.castle && m.phase === "stand");
    if (standing.length >= MAX_CASTLES) {
      const oldest = standing.reduce((a, b) => (b.age > a.age ? b : a));
      knock(oldest, fx);
    }
    for (const m of mounds) {
      if (m.active && Math.abs(m.x - x) < radiusOf(m) + CASTLE.radius && !m.hidden) knock(m, fx);
    }
    const m = slot();
    m.active = true;
    m.castle = true;
    m.x = x;
    m.shape = 1;
    m.level = clamp(level, 0.3, 1);
    m.size = 1;
    m.grow = 1;
    m.opacity = 1;
    m.hidden = true;
    m.age = 0;
    m.turn = rng.range(-Math.PI, Math.PI);
    m.shed = 0;
    m.cool = 0;
    enter(m, "stand", rng.range(STAND[0], STAND[1]));
    stats.castles++;
  };

  const formHeap = (x: number, level: number, size: number) => {
    // Sand landing on a heap piles onto it.
    for (const m of mounds) {
      if (!m.active || m.hidden || m.shape > 0.5 || m.phase === "fade") continue;
      if (Math.abs(m.x - x) < radiusOf(m) * 0.8) {
        m.level = Math.min(1.3, m.level + level * 0.6);
        m.size = Math.min(1.25, m.size + 0.1);
        enter(m, "heap", rng.range(HOLD[0], HOLD[1]));
        return;
      }
    }
    const m = slot();
    m.active = true;
    m.castle = false;
    m.x = x;
    m.shape = 0;
    m.level = clamp(level, 0.3, 1.2);
    m.size = size;
    m.grow = 0;
    m.opacity = 1;
    m.hidden = false;
    m.age = 0;
    m.turn = rng.range(-Math.PI, Math.PI);
    m.shed = 0;
    m.cool = KNOCK_GAP;
    enter(m, "heap", rng.range(HOLD[0], HOLD[1]));
  };

  const empty = () => {
    fill = 0;
    downT = 0;
    sideT = 0;
    uprightT = 0;
    spadesLeft = 0;
  };

  const addFill = (amount: number) => {
    const was = fill;
    fill = Math.min(1, fill + amount);
    if (was < 0.999 && fill >= 0.999) stats.refills++;
  };

  /**
   * Sand thrown from (x, y) at (vx, vy): it follows its arc into the bucket's mouth if it falls
   * through it, or onto the sand, where it lands in a heap.
   */
  const throwSand = (
    b: Prop | null,
    x: number,
    y: number,
    vx: number,
    vy: number,
    amount: number,
    fx: SandFx,
  ) => {
    const m = b && Math.abs(b.a) < UPRIGHT + 0.2 ? mouthOf(b) : null;
    const h = 1 / 120;
    let px = x;
    let py = y;
    let pvy = vy;
    let t = 0;
    let into = false;
    for (let i = 0; i < 480; i++) {
      const was = py;
      pvy -= GRAVITY * h;
      px += vx * h;
      py += pvy * h;
      t += h;
      if (m && pvy < 0 && was > m.y && py <= m.y && Math.abs(px - m.x) < MOUTH_IN) {
        into = true;
        break;
      }
      if (py <= floor) break;
    }
    fx.lumps(x, y, vx, vy, 2, 6, 0.1, into && m ? m.y - 0.1 : floor);
    if (throws.length < MAX_THROWS) {
      throws.push({ at: time + t, amount, into, x: px, bx: b?.x ?? 0 });
    }
  };

  const turnOut = (b: Prop, fx: SandFx) => {
    const m = mouthOf(b);
    formCastle(m.x, fill, fx);
    fx.puff(m.x, floor, 1.4);
    empty();
  };

  const slump = (b: Prop, world: World, fx: SandFx) => {
    const m = mouthOf(b);
    const ux = -b.sn;
    const x = clamp(m.x + ux * 0.2, HEAP.radius, world.bounds.width - HEAP.radius);
    formHeap(x, fill, 0.85 + 0.25 * fill);
    fx.lumps(m.x, Math.max(floor + 0.05, m.y), ux * 0.9, 0.4, 3, 8, 0.45, floor);
    stats.slumps++;
    empty();
  };

  const fling = (b: Prop, world: World, fx: SandFx) => {
    const m = mouthOf(b);
    // The packed sand drops out of the mouth more than it is flung: it keeps most of the
    // bucket's own speed, not the spin's, so it lands under where it fell from.
    const vx = b.vx * 0.85 - b.sn * 0.7;
    const vy = b.vy * 0.85 + b.cs * 0.7;
    fx.lumps(m.x, m.y, vx, vy, 7, 10, 0.45, floor);
    // Where most of it comes down, a heap forms as it lands.
    const h = Math.max(0, m.y - floor);
    const t = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * h)) / GRAVITY;
    if (pending.length < 2) {
      pending.push({
        at: time + t,
        x: clamp(m.x + vx * t, HEAP.radius, world.bounds.width - HEAP.radius),
        level: 0.6 + 0.3 * fill,
        size: 0.75 + 0.2 * fill,
      });
    }
    stats.flings++;
    empty();
  };

  const applySpec = (world: World, b: Prop | null) => {
    if (b && b.spec !== bucketSpec(fill)) world.setPropSpec(b.index, bucketSpec(fill));
  };

  /** The unseen spade digs a spadeful from a heap nearby, or the sand beside the bucket. */
  const spadeful = (b: Prop, world: World, fx: SandFx) => {
    const m = mouthOf(b);
    let dig = -1;
    let best = 2.5;
    for (const q of mounds) {
      if (!q.active || q.hidden || q.phase === "fade") continue;
      const d = Math.abs(q.x - b.x);
      if (d < best) {
        best = d;
        dig = q.index;
      }
    }
    let x: number;
    const q = dig >= 0 ? mounds[dig]! : null;
    if (q) {
      x = q.x;
      if (q.phase === "stand") knock(q, fx);
      q.level = Math.max(0, q.level - 0.35);
      if (q.level < FLAT && q.phase !== "crumble") enter(q, "fade", FADE * q.opacity);
    } else {
      const w = world.bounds.width;
      const side = b.x < 1.2 ? 1 : b.x > w - 1.2 ? -1 : rng.next() < 0.5 ? -1 : 1;
      x = b.x + side * rng.range(0.5, 0.8);
    }
    const y = floor + 0.03;
    // Aimed to come down through the middle of the mouth.
    const ty = m.y - 0.02;
    const vx = (m.x - x) / SPADE_FLIGHT;
    const vy = (ty - y + 0.5 * GRAVITY * SPADE_FLIGHT * SPADE_FLIGHT) / SPADE_FLIGHT;
    throwSand(b, x, y, vx, vy, SPADEFUL, fx);
    fx.puff(x, floor, 1.1);
  };

  /** A point up the spade's length from its tip, and how fast it moves. */
  const spadeAt = (p: Prop, along: number) => {
    const bx = p.spec.origin.x;
    const by = p.spec.origin.y + along;
    const rx = p.cs * bx - p.sn * by;
    const ry = p.sn * bx + p.cs * by;
    return { x: p.x + rx, y: p.y + ry, vx: p.vx - p.w * ry, vy: p.vy + p.w * rx };
  };

  /** Pose the spade standing in the bucket, leaning against its rim. */
  const stand = (world: World, b: Prop, s: Prop) => {
    const qx = b.spec.origin.x + STOW_TIP.x;
    const qy = b.spec.origin.y + STOW_TIP.y;
    const tx = b.x + b.cs * qx - b.sn * qy;
    const ty = b.y + b.sn * qx + b.cs * qy;
    const a = b.a + STOW_LEAN;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const ox = s.spec.origin.x;
    const oy = s.spec.origin.y;
    const x = tx - (c * ox - sn * oy);
    const y = ty - (sn * ox + c * oy);
    world.poseProp(s.index, x, y, a, b.vx - b.w * (y - b.y), b.vy + b.w * (x - b.x), b.w);
    s.yaw = b.yaw;
  };

  const unstow = (world: World, s: Prop | null, push = 0, b: Prop | null = null) => {
    if (!stowed || !s) return;
    stowed = false;
    world.setPropOff(s.index, false);
    if (b && push) world.kickProp(s.index, s.vx - b.sn * push, s.vy + b.cs * push, s.w);
  };

  const stepSpade = (world: World, b: Prop | null, s: Prop, fx: SandFx) => {
    if (stowed) {
      if (!b || Math.abs(b.a) > STOW_TIP_OVER) unstow(world, s, 0.8, b);
      else stand(world, b, s);
      return;
    }
    const tip = spadeAt(s, BLADE_TIP);
    const m = b ? mouthOf(b) : null;
    const bucketUp = b !== null && b.holder === null && Math.abs(b.a) < 0.5;
    // Lowered blade first into the bucket's mouth, it goes in and stands there.
    if (
      b &&
      m &&
      bucketUp &&
      Math.abs(s.a) < 0.8 &&
      Math.abs(tip.x - m.x) < BUCKET_SAND.mouth &&
      tip.y > m.y - 0.15 &&
      tip.y < m.y + 0.4 &&
      (s.holder !== null || tip.vy < 0.3)
    ) {
      if (load > 0) {
        addFill(load * SPADE_LOAD);
        load = 0;
        stats.pours++;
      }
      world.setPropOff(s.index, true);
      stowed = true;
      stats.stows++;
      stand(world, b, s);
      fx.puff(m.x, m.y, 0.8);
      return;
    }
    if (load < 1) {
      // Dragged by a hand through the sand or a heap, the blade picks up a spadeful.
      let low = Infinity;
      for (const d of s.spec.discs) {
        if (d.y - s.spec.origin.y > BLADE_END) continue;
        low = Math.min(low, s.y + s.sn * d.x + s.cs * d.y - d.r);
      }
      const moving = Math.hypot(tip.vx, tip.vy);
      let dig = s.holder !== null && low < floor + 0.03 && moving > 0.5;
      for (const q of mounds) {
        if (dig || s.holder === null || !q.active || q.hidden) continue;
        if (q.phase === "fade" || q.phase === "crumble") continue;
        if (Math.abs(tip.x - q.x) > radiusOf(q) * 0.9 || tip.y > floor + heightOf(q)) continue;
        dig = true;
        if (q.phase === "stand") knock(q, fx);
        else {
          q.level -= 0.3;
          if (q.level < 0.2) enter(q, "fade", FADE);
        }
      }
      if (dig) {
        load = 1;
        stats.digs++;
        fx.lumps(tip.x, floor + 0.04, -tip.vx * 0.2, 0.8, 1, 5, 0.5, floor);
        fx.puff(tip.x, floor, 1.2);
      }
      return;
    }
    const blade = spadeAt(s, BLADE_MID);
    if (
      b &&
      m &&
      Math.abs(b.a) < UPRIGHT + 0.2 &&
      Math.abs(blade.x - m.x) < MOUTH_IN &&
      blade.y > m.y - 0.05 &&
      blade.y < m.y + 0.45
    ) {
      // Held over the bucket, the blade's sand pours in.
      addFill(load * SPADE_LOAD);
      fx.lumps(blade.x, blade.y, 0, -0.5, 2, 5, 0.15, m.y - 0.1);
      load = 0;
      stats.pours++;
      return;
    }
    if (s.cs < -0.2 || Math.hypot(blade.vx, blade.vy) > 4.5 || Math.abs(s.w) > 10) {
      // Turned over or flicked, it throws its sand.
      throwSand(b, blade.x, blade.y, blade.vx, blade.vy, load * SPADE_LOAD, fx);
      load = 0;
      stats.throws++;
    }
  };

  return {
    mounds,
    get fill() {
      return fill;
    },
    get shovelling() {
      return spadesLeft > 0;
    },
    get covered() {
      return mounds.some((m) => m.active && m.hidden);
    },
    get stowed() {
      return stowed;
    },
    get load() {
      return load;
    },
    stats,
    step(dt, world, b, spade, fx) {
      time += dt;
      if (b) {
        const held = b.holder !== null;
        const upY = b.cs;
        const speed = Math.hypot(b.vx, b.vy);
        if (fill > 0.02) {
          downT = !b.grounded && upY < FLING_UP ? downT + dt : 0;
          const side = b.grounded && !held && upY < SLUMP_UP && speed < 0.6;
          sideT = side ? sideT + dt : 0;
          if (b.grounded && !held && upY < CASTLE_UP) turnOut(b, fx);
          else if (downT > FLING_AFTER) fling(b, world, fx);
          else if (sideT > SLUMP_AFTER) slump(b, world, fx);
        }
        if (fill < 0.999) {
          // Swept through a heap or a castle, mouth first, it scoops it up.
          const m = mouthOf(b);
          if (upY > -0.2 && (held || speed > 0.25)) {
            for (const q of mounds) {
              if (!q.active || q.hidden || q.phase === "fade") continue;
              // A low heap is scooped from round about it; a standing castle only at its body.
              const castle = q.phase === "stand";
              const reach = castle ? radiusOf(q) * 0.9 : radiusOf(q) + BUCKET_SAND.mouth * 0.5;
              if (Math.abs(m.x - q.x) > reach) continue;
              if (m.y > floor + heightOf(q) + (castle ? 0.06 : 0.3)) continue;
              addFill(1);
              stats.scoops++;
              spadesLeft = 0;
              fx.lumps(q.x, floor + heightOf(q) * 0.5, 0, 0.8, 2, 8, 0.8, floor);
              fx.puff(q.x, floor, 1.8);
              enter(q, "fade", 0.25);
              break;
            }
          }
        }
        const upright =
          Math.abs(b.a) < UPRIGHT && !held && (b.asleep || (b.grounded && speed < 0.05));
        uprightT = upright && fill < 0.999 ? uprightT + dt : 0;
        if (!upright) spadesLeft = 0;
        const inAir = throws.some((t) => t.into);
        if (uprightT >= SHOVEL_WAIT && spadesLeft === 0 && !inAir && fill < 0.999) {
          spadesLeft = Math.ceil((1 - fill) / SPADEFUL - 1e-6);
          spadeWait = 0;
          stats.shovels++;
        }
        if (spadesLeft > 0) {
          spadeWait -= dt;
          if (spadeWait <= 0) {
            spadeful(b, world, fx);
            spadesLeft--;
            spadeWait = SPADE_GAP;
          }
        }
      }
      if (spade) stepSpade(world, b, spade, fx);
      for (let i = throws.length - 1; i >= 0; i--) {
        const s = throws[i]!;
        if (time < s.at) continue;
        throws.splice(i, 1);
        // Thrown sand lands in the bucket only if it still stands where it was aimed at.
        if (s.into && b && Math.abs(b.a) < UPRIGHT + 0.2 && Math.abs(b.x - s.bx) < 0.15) {
          addFill(s.amount);
        } else {
          const x = clamp(s.into && b ? b.x : s.x, HEAP.radius, world.bounds.width - HEAP.radius);
          formHeap(x, 0.35 + 0.6 * s.amount, 0.5 + 0.4 * s.amount);
          fx.puff(x, floor, 1.4);
        }
      }
      applySpec(world, b);

      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i]!;
        if (time < p.at) continue;
        pending.splice(i, 1);
        formHeap(p.x, p.level, p.size);
        fx.puff(p.x, floor, 2.2);
      }

      for (const m of mounds) {
        if (!m.active) continue;
        m.age += dt;
        m.cool = Math.max(0, m.cool - dt);
        m.grow = Math.min(1, m.grow + dt / 0.5);
        if (m.hidden) {
          // Uncovered once the bucket that moulded it is off it.
          if (!b) m.hidden = false;
          else {
            const e = extentAt(b.spec, b.a);
            const r = radiusOf(m);
            m.hidden = !(
              b.x + e.left > m.x + r ||
              b.x + e.right < m.x - r ||
              b.y + e.bottom > floor + heightOf(m) * 0.9
            );
          }
          if (m.hidden) continue;
        }
        m.left -= dt;
        if (m.phase === "stand") {
          if (m.left <= 0) enter(m, "crumble", CRUMBLE);
        } else if (m.phase === "crumble") {
          m.shape = clamp(m.left / m.span, 0, 1);
          m.shed -= dt;
          if (m.shed <= 0) {
            m.shed = 0.12;
            const side = rng.next() < 0.5 ? -1 : 1;
            const r = radiusOf(m);
            fx.lumps(
              m.x + side * r * 0.8,
              floor + heightOf(m) * 0.6,
              side * 0.3,
              0.2,
              0,
              2,
              0.3,
              floor,
            );
          }
          if (m.left <= 0) {
            m.shape = 0;
            m.level = Math.max(m.level, 0.9);
            m.size = Math.max(m.size, 1.1);
            enter(m, "heap", rng.range(HOLD[0], HOLD[1]));
          }
        } else if (m.phase === "heap") {
          if (m.left <= 0) enter(m, "settle", SETTLE);
        } else if (m.phase === "settle") {
          const u = 1 - clamp(m.left / m.span, 0, 1);
          m.level = m.from + (FLAT - m.from) * u;
          m.size = Math.min(1.35, m.size + dt * 0.02);
          // It blends into the beach as it settles.
          m.opacity = 1 - 0.5 * u;
          if (m.left <= 0) enter(m, "fade", FADE);
        } else {
          m.opacity = Math.min(m.opacity, clamp(m.left / m.span, 0, 1) * (m.castle ? 1 : 0.5));
          if (m.left <= 0) {
            m.active = false;
            m.opacity = 0;
          }
        }
      }

      // Balls and toys running into a mound knock it down.
      for (const m of mounds) {
        if (!m.active || m.hidden || m.phase === "fade" || m.phase === "crumble") continue;
        const r = radiusOf(m);
        const h = heightOf(m);
        let hit = false;
        for (const ball of world.balls) {
          if (Math.abs(ball.x - m.x) > r + ball.r * 0.5) continue;
          if (ball.y - ball.r > floor + h * 0.9) continue;
          if (Math.hypot(ball.vx, ball.vy) > 0.4 || ball.holder !== null) hit = true;
        }
        for (const p of world.props) {
          if (p.off || p.asleep || Math.hypot(p.vx, p.vy) < 0.4) continue;
          if (Math.abs(p.x - m.x) > r + p.spec.reach) continue;
          for (const d of p.spec.discs) {
            const dx = p.x + p.cs * d.x - p.sn * d.y;
            const dy = p.y + p.sn * d.x + p.cs * d.y;
            if (Math.abs(dx - m.x) < r + d.r * 0.5 && dy - d.r < floor + h * 0.9) hit = true;
          }
        }
        if (hit) knock(m, fx);
      }
    },
    touch(x, y, fx) {
      for (const m of mounds) {
        if (!m.active || m.hidden || m.phase === "fade") continue;
        if (Math.abs(x - m.x) > radiusOf(m) + 0.1 || y > floor + heightOf(m) + 0.12) continue;
        return knock(m, fx);
      }
      return false;
    },
    knockAt(x, r, fx) {
      let any = false;
      for (const m of mounds) {
        if (!m.active || m.hidden || m.phase === "fade" || m.phase === "crumble") continue;
        if (Math.abs(x - m.x) > radiusOf(m) + r) continue;
        any = knock(m, fx) || any;
      }
      return any;
    },
    heightAt(x) {
      let h = 0;
      for (const m of mounds) {
        if (!m.active || m.phase === "fade") continue;
        if (Math.abs(x - m.x) < radiusOf(m) * 0.85) h = Math.max(h, heightOf(m));
      }
      return h;
    },
    setFloor(f) {
      floor = f;
    },
    handleDistance(s, x, y) {
      if (!stowed || !s) return Infinity;
      let best = Infinity;
      // Only the part standing up out of the bucket.
      for (const d of s.spec.discs) {
        const cx = s.x + s.cs * d.x - s.sn * d.y;
        const cy = s.y + s.sn * d.x + s.cs * d.y;
        if (d.y < s.spec.origin.y + 0.4 * PROP_SCALE) continue;
        best = Math.min(best, Math.hypot(x - cx, y - cy) - d.r);
      }
      return best;
    },
    pullSpade(world, s) {
      unstow(world, s);
    },
    reset(world, b, s) {
      unstow(world, s);
      load = 0;
      fill = 1;
      downT = 0;
      sideT = 0;
      uprightT = 0;
      spadesLeft = 0;
      throws.length = 0;
      pending.length = 0;
      for (const m of mounds) m.active = false;
      applySpec(world, b);
    },
    spill(world, b, fx) {
      if (!b || fill <= 0.02) return;
      slump(b, world, fx);
      applySpec(world, b);
    },
  };
};
