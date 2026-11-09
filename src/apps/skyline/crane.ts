/**
 * One tower crane and its site: the trolley and hoist, the swinging load, the yard where blocks
 * arrive, the lots it builds on (or, in `tall`, its one tower) and the loose blocks falling or
 * sliding back to the yard. Pure: no DOM, fixed steps, so tests can run it for minutes.
 *
 * World units are block widths, y up from the ground. The hook's target comes from a person's
 * pad, a bot's injected touches or the autopilot, all through `setTarget` and `release`.
 */
import type { Rng } from "../../core/types";
import { accepts, type Blueprint, pickBlueprint, type Shape } from "./blueprints";
import {
  ATTACH,
  AUTO,
  BH,
  CATCH_S,
  CELEBRATE_S,
  CLEAR_STEP_S,
  COLLIDE_HALF,
  DAMP,
  G,
  HOIST,
  HOLD_ONE_LOT_S,
  HOLD_S,
  KIND,
  LIFT_MAX,
  LIFT_S,
  MAX_LOOSE,
  MAX_SWING,
  MIN_CABLE,
  SETTLE_S,
  SHEAVE,
  SLING,
  SNAP,
  TALL_OFFSET,
  TALL_SNAP_DX,
  TROLLEY,
  type Variant,
  WOBBLE_S,
} from "./config";
import {
  type Servo,
  stepServo,
  stepSwing,
  type Swing,
  swingAmplitude,
  swingPeriod,
} from "./mechanics";

export interface World {
  /** The lane this crane owns, in world x. */
  left: number;
  right: number;
  /** Sky above the ground. */
  height: number;
  mastX: number;
  jibY: number;
  /** The jib runs from `jibFrom` (the counter-jib's end) to `jibTo` (its tip). */
  jibFrom: number;
  jibTo: number;
  /** The trolley's travel. */
  tMin: number;
  tMax: number;
  /** Lot centres and how many blocks wide each may build. */
  lots: { x: number; cols: number }[];
  maxRows: number;
  /** Yard slot centres, on the ground. */
  yard: number[];
  /** Where the lift brings blocks up, and where spare blocks slide away to the store. */
  liftX: number;
  storeX: number;
}

export interface YardBlock {
  id: number;
  kind: number;
}

export interface Lot {
  x: number;
  cols: number;
  bp: Blueprint;
  /** Left edge of the blueprint. */
  left: number;
  filled: (number | null)[];
  phase: "build" | "done" | "clear";
  doneAt: number;
  order: number;
  clearAt: number;
}

export interface TowerBlock {
  id: number;
  x: number;
  kind: number;
}

export interface Tower {
  x: number;
  blocks: TowerBlock[];
  maxFloors: number;
  phase: "build" | "wobble" | "capped" | "clear";
  /** Wobbling: the level that gives way, and when. */
  breakAt: number;
  until: number;
  clearAt: number;
}

export interface Loose {
  id: number;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  vspin: number;
  state: "rise" | "wait" | "fall" | "tip" | "slide" | "fade";
  /** 1 opaque; a block whose way back is blocked fades out and reappears where it goes. */
  alpha: number;
  /** Where a tip or slide is heading. */
  to: number;
  /** Reserved yard slot, or -1 for the store. */
  yard: number;
  age: number;
}

export interface Settle {
  id: number;
  kind: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  /** Lot and slot, or lot -1 for the tower. */
  lot: number;
  slot: number;
}

export interface Rider {
  id: number;
  kind: number;
  t: number;
  yard: number;
}

export type CraneEvent =
  | { type: "caught"; kind: number }
  | { type: "placed"; kind: number; x: number; y: number }
  | { type: "dropped"; kind: number }
  | { type: "landed"; x: number; hard: boolean }
  | { type: "finished"; lot: number }
  | { type: "clearing"; lot: number }
  | { type: "cleared"; lot: number }
  | { type: "tumble"; level: number }
  | { type: "capped"; floors: number }
  | { type: "yarded"; kind: number }
  | { type: "stored"; kind: number }
  | { type: "refused" };

export interface Point {
  x: number;
  y: number;
}

/** What a pad, a bot or the autopilot needs to know, in the pad's 0..1 box (y up). */
export interface Readout {
  hook: Point;
  target: Point;
  /** The trolley, on the hook's y. */
  trolley: number;
  /** Carried kind, or -1. */
  carrying: number;
  load: Point | null;
  /** Hook targets: catch the next yard block, set the carried one in its slot, or put it back. */
  pick: Point | null;
  drop: Point | null;
  park: Point | null;
  /** A hook height that clears everything in reach. */
  carry: number;
  sway: number;
  /** How far the load swings to each side, in world units. */
  drift: number;
  period: number;
  /** Trolley top speed and acceleration, hoist top speed, in box units per second. */
  vx: number;
  ax: number;
  vy: number;
  /** The carried block is where the hook would let go by itself. */
  inZone: boolean;
  /** How far off centre a tall tower's next block may go, in box x. */
  jitter: number;
  /** One block's height, in box y. */
  unit: number;
}

export interface CraneCounts {
  placed: number;
  finished: number;
  dropped: number;
  tumbles: number;
  arrived: number;
  stored: number;
  cleared: number;
}

export interface CraneOptions {
  world: World;
  variant: Variant;
  assist: boolean;
  wind: boolean;
  rng: Rng;
  /**
   * Start with a skyline: every lot but one standing and lit, the last one a few floors up (a
   * short tower in `tall`). Default true; tests start from empty lots.
   */
  prebuilt?: boolean;
}

export interface Crane {
  readonly world: World;
  readonly variant: Variant;
  readonly trolley: Servo;
  /** Cable length from the sheave to the hook point. */
  readonly hoist: Servo;
  readonly swing: Swing;
  readonly target: Point;
  readonly carrying: YardBlock | null;
  /** 0 to 1 while a caught block swings up onto its sling. */
  readonly catching: number;
  readonly catchFrom: Point;
  readonly yard: (YardBlock | null)[];
  readonly lots: Lot[];
  readonly tower: Tower | null;
  readonly loose: Loose[];
  readonly settles: Settle[];
  readonly riders: Rider[];
  readonly events: CraneEvent[];
  readonly counts: CraneCounts;
  /** Tallest tower today, in floors. */
  best: number;
  readonly time: number;
  /** Highest hook target, the top of the pad's box. */
  readonly workTop: number;
  readonly wind: number;
  hook(): Point;
  load(): Point | null;
  setTarget(x: number, y: number): void;
  setTargetNorm(nx: number, ny: number): void;
  /** Let go: snaps into a nearby slot, or drops. Returns what happened. */
  release(): "placed" | "dropped" | "empty";
  /** A child's block sent up the lift (solo frames). False when the lift or yard is full. */
  request(kind: number): boolean;
  /**
   * A block arriving from below (a bank's screen), rising from `fromY` (world units, below the
   * ground). False when there is no room.
   */
  arrive(kind: number, fromY?: number): boolean;
  /** Yard slots free and not promised to a block on its way. */
  freeSlots(): number;
  /** Blocks that may still arrive from below: free yard slots and room to wait by the lift. */
  room(): number;
  /** Room for one more block from the lift. */
  canRequest(): boolean;
  readout(): Readout;
  /**
   * Where the carried block would snap if let go now (its centre), and the slot the autopilot
   * fills next with it (a lot and slot, lot -1 for the tower).
   */
  hint(): { snap: Point | null; next: { lot: number; slot: number } | null };
  toNorm(p: Point): Point;
  fromNorm(p: Point): Point;
  /** Every top surface, for drawing shadows and tests. */
  surfaceAt(x0: number, x1: number): number;
  step(dt: number): void;
  /** Admin: take everything down. */
  clear(): void;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Seconds a capped tower stands before it comes down. */
const CAPPED_S = 6;
/** Seconds a block may wait at the lift top for room in the yard. */
const WAIT_S = 30;
const MAX_WAITING = 2;
/** Seconds to fade out (and again to fade back in) on the way back to the yard. */
const FADE_S = 0.35;
const JAM_CHECK_S = 1.5;
/** The hook catches a yard block only while the trolley moves slower than this. */
const CATCH_SPEED = 1.2;

export const sheaveY = (w: World) => w.jibY - SHEAVE;

/** Highest a tall tower may go under this crane's jib. */
export const towerCap = (w: World): number =>
  Math.max(4, Math.floor((sheaveY(w) - MIN_CABLE - SLING - BH - 0.35) / BH));

export const createCrane = (o: CraneOptions): Crane => {
  const w = o.world;
  const rng = o.rng;
  const sY = sheaveY(w);
  const hoistSpeed = HOIST.speed + HOIST.perUnit * w.jibY;
  let nextId = 1;
  let time = 0;
  let doneOrder = 0;
  let best = 0;

  const trolley: Servo = { x: (w.tMin + w.tMax) / 2, v: 0 };
  const hoist: Servo = { x: Math.max(MIN_CABLE, sY - 3 * BH), v: 0 };
  const swing: Swing = { theta: 0, omega: 0 };
  const target: Point = { x: trolley.x, y: sY - hoist.x };
  let carrying: YardBlock | null = null;
  let catching = 1;
  const catchFrom: Point = { x: 0, y: 0 };
  let autoHold = 0;
  let cooldown = 0;
  /** Where the load (or empty hook) was last step, to tell a side bump from a landing. */
  const prevPoint: Point = { x: trolley.x, y: sY - hoist.x };
  let jamAt = 0;
  let windNow = 0;
  const windPhase = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];

  const yard: (YardBlock | null)[] = w.yard.map(() => null);
  const reserved: boolean[] = w.yard.map(() => false);
  const loose: Loose[] = [];
  const settles: Settle[] = [];
  const riders: Rider[] = [];
  const events: CraneEvent[] = [];
  const counts: CraneCounts = {
    placed: 0,
    finished: 0,
    dropped: 0,
    tumbles: 0,
    arrived: 0,
    stored: 0,
    cleared: 0,
  };

  const newLot = (i: number, avoid: Shape[]): Lot => {
    const spec = w.lots[i]!;
    const bp = pickBlueprint(rng, w.maxRows, spec.cols, avoid);
    return {
      x: spec.x,
      cols: spec.cols,
      bp,
      left: spec.x - bp.cols / 2,
      filled: bp.slots.map(() => null),
      phase: "build",
      doneAt: 0,
      order: 0,
      clearAt: 0,
    };
  };
  const lots: Lot[] = [];
  const tower: Tower | null =
    o.variant === "tall"
      ? {
          x: w.lots[0]?.x ?? (w.tMin + w.tMax) / 2,
          blocks: [],
          maxFloors: towerCap(w),
          phase: "build",
          breakAt: -1,
          until: 0,
          clearAt: 0,
        }
      : null;
  if (!tower) {
    for (let i = 0; i < w.lots.length; i++) {
      lots.push(
        newLot(
          i,
          lots.map((l) => l.bp.shape),
        ),
      );
    }
  }
  if (o.prebuilt !== false) {
    /** Fill a share of a lot's slots, lowest rows first, a roof on most top slots. */
    const fill = (lot: Lot, share: number) => {
      const n = Math.round(share * lot.bp.slots.length);
      for (let i = 0; i < n; i++) {
        const slot = lot.bp.slots[i]!;
        lot.filled[i] = slot.top && rng.next() < 0.7 ? KIND.roof : rng.int(3);
      }
    };
    if (tower) {
      for (let i = 0; i < 2; i++) tower.blocks.push({ id: nextId++, x: tower.x, kind: rng.int(3) });
    } else if (lots.length > 0) {
      const building = rng.int(lots.length);
      lots.forEach((lot, i) => {
        if (i === building) {
          fill(lot, lots.length === 1 ? 0.45 : 0.25);
          return;
        }
        fill(lot, 1);
        lot.phase = "done";
        lot.doneAt = -60;
        lot.order = ++doneOrder;
      });
    }
  }

  const buildTop = () =>
    lots.reduce((m, l) => Math.max(m, l.bp.rows * BH), w.maxRows * BH * 0.6) + SLING + BH + 0.7;
  const tallTop = () => Math.max(4 * BH, ((tower?.blocks.length ?? 0) + 2) * BH) + SLING + BH + 0.5;
  const topLimit = sY - MIN_CABLE;
  let workTop = Math.min(topLimit, tower ? tallTop() : buildTop());

  // ---- Geometry ----------------------------------------------------------------------------

  const slotCentre = (lot: Lot, i: number): Point => {
    const s = lot.bp.slots[i]!;
    return { x: lot.left + s.x + 0.5, y: s.r * BH + BH / 2 };
  };

  /** Highest top of anything solid overlapping [x0, x1]. */
  const surfaceAt = (x0: number, x1: number): number => {
    let top = 0;
    const over = (l: number, r: number) => r > x0 && l < x1;
    for (const lot of lots) {
      lot.bp.slots.forEach((s, i) => {
        if (lot.filled[i] === null) return;
        const l = lot.left + s.x;
        if (over(l, l + 1)) top = Math.max(top, (s.r + 1) * BH);
      });
    }
    for (const st of settles) {
      if (over(st.x1 - 0.5, st.x1 + 0.5)) top = Math.max(top, st.y1 + BH / 2);
    }
    yard.forEach((b, i) => {
      const x = w.yard[i]!;
      if (b && over(x - 0.5, x + 0.5)) top = Math.max(top, BH);
    });
    if (tower) {
      tower.blocks.forEach((b, i) => {
        if (over(b.x - 0.5, b.x + 0.5)) top = Math.max(top, (i + 1) * BH);
      });
    }
    return top;
  };

  const hookAt = (): Point => {
    const s = Math.sin(swing.theta);
    const c = Math.cos(swing.theta);
    return { x: trolley.x + hoist.x * s, y: sY - hoist.x * c };
  };
  const loadReach = () => hoist.x + SLING + BH / 2;
  const loadAt = (): Point | null => {
    if (!carrying) return null;
    const L = loadReach();
    return { x: trolley.x + L * Math.sin(swing.theta), y: sY - L * Math.cos(swing.theta) };
  };
  const loadVelocity = (): Point => {
    const L = loadReach();
    const s = Math.sin(swing.theta);
    const c = Math.cos(swing.theta);
    return {
      x: trolley.v + hoist.v * s + L * c * swing.omega,
      y: -hoist.v * c + L * s * swing.omega,
    };
  };

  // ---- Yard --------------------------------------------------------------------------------

  const freeSlots = () => {
    let n = 0;
    for (let i = 0; i < yard.length; i++) if (!yard[i] && !reserved[i]) n++;
    return n;
  };
  /** Reserve the free yard slot nearest `x`, or -1. */
  const reserve = (x: number): number => {
    let best = -1;
    for (let i = 0; i < yard.length; i++) {
      if (yard[i] || reserved[i]) continue;
      if (best < 0 || Math.abs(w.yard[i]! - x) < Math.abs(w.yard[best]! - x)) best = i;
    }
    if (best >= 0) reserved[best] = true;
    return best;
  };

  const addLoose = (
    l: Omit<Loose, "id" | "age" | "spin" | "vspin" | "alpha"> & { id?: number },
  ) => {
    if (loose.length >= MAX_LOOSE) {
      // The oldest goes straight where it was heading.
      const old = loose.shift()!;
      if (old.yard >= 0) {
        yard[old.yard] = { id: old.id, kind: old.kind };
        reserved[old.yard] = false;
      }
    }
    loose.push({ ...l, id: l.id ?? nextId++, age: 0, spin: 0, vspin: 0, alpha: 1 });
  };

  const fits = (kind: number): boolean => {
    if (tower) return tower.phase === "build";
    for (const lot of lots) {
      if (lot.phase !== "build") continue;
      for (let i = 0; i < lot.bp.slots.length; i++) {
        if (accepts(lot.bp, lot.filled, i, kind) && !settling(lot, i)) return true;
      }
    }
    return false;
  };
  const settling = (lot: Lot, i: number) =>
    settles.some((s) => s.lot === lots.indexOf(lot) && s.slot === i);

  // ---- Slots -------------------------------------------------------------------------------

  interface Snap {
    lot: number;
    slot: number;
    x: number;
    y: number;
  }

  const findSnap = (
    at: Point,
    kind: number,
    zone: { dx: number; below: number; above: number },
  ): Snap | null => {
    if (tower) {
      if (tower.phase !== "build") return null;
      const n = tower.blocks.length;
      const topX = n > 0 ? tower.blocks[n - 1]!.x : tower.x;
      const cy = n * BH + BH / 2;
      const dx = at.x - topX;
      const dy = at.y - cy;
      if (Math.abs(dx) > Math.min(zone.dx, TALL_SNAP_DX) || dy < -zone.below || dy > zone.above) {
        return null;
      }
      return { lot: -1, slot: n, x: clamp(at.x, topX - TALL_OFFSET, topX + TALL_OFFSET), y: cy };
    }
    let best: Snap | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    lots.forEach((lot, li) => {
      if (lot.phase !== "build") return;
      for (let i = 0; i < lot.bp.slots.length; i++) {
        if (!accepts(lot.bp, lot.filled, i, kind) || settling(lot, i)) continue;
        const c = slotCentre(lot, i);
        const dx = at.x - c.x;
        const dy = at.y - c.y;
        if (Math.abs(dx) > zone.dx || dy < -zone.below || dy > zone.above) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { lot: li, slot: i, x: c.x, y: c.y };
        }
      }
    });
    return best;
  };

  /** The slot the autopilot would fill next with this kind: lowest row first, in started lots. */
  const nextSlot = (kind: number): Snap | null => {
    if (tower) {
      if (tower.phase !== "build" && tower.phase !== "wobble") return null;
      // While it wobbles, aim for where the top will be once it settles.
      const n = tower.phase === "wobble" ? tower.breakAt + 1 : tower.blocks.length;
      return {
        lot: -1,
        slot: n,
        x: n > 0 ? tower.blocks[n - 1]!.x : tower.x,
        y: n * BH + BH / 2,
      };
    }
    const order = lots
      .map((lot, i) => ({ lot, i, n: lot.filled.filter((f) => f !== null).length }))
      .filter((e) => e.lot.phase === "build")
      .sort((a, b) => b.n - a.n || a.i - b.i);
    for (const { lot, i: li } of order) {
      let pick = -1;
      for (let i = 0; i < lot.bp.slots.length; i++) {
        if (!accepts(lot.bp, lot.filled, i, kind) || settling(lot, i)) continue;
        if (pick < 0 || lot.bp.slots[i]!.r < lot.bp.slots[pick]!.r) pick = i;
      }
      if (pick >= 0) {
        const c = slotCentre(lot, pick);
        return { lot: li, slot: pick, x: c.x, y: c.y };
      }
    }
    return null;
  };

  const startSettle = (snap: Snap, from: Point, block: YardBlock) => {
    settles.push({
      id: block.id,
      kind: block.kind,
      x0: from.x,
      y0: from.y,
      x1: snap.x,
      y1: snap.y,
      t: 0,
      lot: snap.lot,
      slot: snap.slot,
    });
  };

  const place = (s: Settle) => {
    counts.placed++;
    events.push({ type: "placed", kind: s.kind, x: s.x1, y: s.y1 });
    if (tower) {
      tower.blocks.push({ id: s.id, x: s.x1, kind: s.kind });
      const n = tower.blocks.length;
      if (n > best) best = n;
      // The lowest joint whose load sits past its edge gives way.
      let sum = 0;
      let breakAt = -1;
      for (let i = n - 1; i >= 1; i--) {
        sum += tower.blocks[i]!.x;
        const com = sum / (n - i);
        if (Math.abs(com - tower.blocks[i - 1]!.x) > 0.5) breakAt = i - 1;
      }
      if (breakAt >= 0) {
        tower.phase = "wobble";
        tower.breakAt = breakAt;
        tower.until = time + WOBBLE_S;
      } else if (n >= tower.maxFloors) {
        tower.phase = "capped";
        tower.until = time + CAPPED_S;
        counts.finished++;
        events.push({ type: "capped", floors: n });
      }
      return;
    }
    const lot = lots[s.lot];
    if (!lot || lot.phase !== "build") {
      // Its lot went (admin clear) while it settled: it falls back to the yard.
      fall({ id: s.id, kind: s.kind }, { x: s.x1, y: s.y1 }, { x: 0, y: 0 });
      return;
    }
    lot.filled[s.slot] = s.kind;
    if (lot.filled.every((f) => f !== null)) {
      lot.phase = "done";
      lot.doneAt = time;
      lot.order = ++doneOrder;
      counts.finished++;
      events.push({ type: "finished", lot: s.lot });
    }
  };

  const fall = (b: YardBlock, at: Point, v: Point) => {
    addLoose({
      id: b.id,
      kind: b.kind,
      x: at.x,
      y: at.y,
      vx: clamp(v.x, -3, 3),
      vy: clamp(v.y, -4, 4),
      state: "fall",
      to: 0,
      yard: -1,
    });
    const l = loose[loose.length - 1]!;
    l.vspin = clamp(v.x * 0.8, -2.5, 2.5);
  };

  // ---- Controls ----------------------------------------------------------------------------

  const setTarget = (x: number, y: number) => {
    target.x = clamp(x, w.tMin, w.tMax);
    target.y = clamp(y, 0, workTop);
  };

  const release = (): "placed" | "dropped" | "empty" => {
    if (!carrying) {
      events.push({ type: "refused" });
      return "empty";
    }
    const at = loadAt()!;
    const block = carrying;
    carrying = null;
    cooldown = 0.6;
    autoHold = 0;
    const snap = findSnap(at, block.kind, SNAP);
    if (snap) {
      startSettle(snap, at, block);
      return "placed";
    }
    fall(block, at, loadVelocity());
    counts.dropped++;
    events.push({ type: "dropped", kind: block.kind });
    return "dropped";
  };

  const canRequest = () => riders.length < LIFT_MAX && freeSlots() > 0;
  const waitingCount = () =>
    loose.filter((l) => (l.state === "rise" || l.state === "wait") && l.yard < 0).length;
  const room = () => freeSlots() + Math.max(0, MAX_WAITING - waitingCount());

  const request = (kind: number): boolean => {
    if (!canRequest()) return false;
    const slot = reserve(w.liftX);
    if (slot < 0) return false;
    riders.push({ id: nextId++, kind: clamp(Math.round(kind), 0, 3), t: 0, yard: slot });
    return true;
  };

  const arrive = (kind: number, fromY = -BH): boolean => {
    const k = clamp(Math.round(kind), 0, 3);
    const slot = reserve(w.liftX);
    if (slot < 0 && waitingCount() >= MAX_WAITING) return false;
    counts.arrived++;
    addLoose({
      kind: k,
      x: w.liftX,
      y: fromY,
      vx: 0,
      vy: 0,
      state: "rise",
      to: w.liftX,
      yard: slot,
    });
    return true;
  };

  // ---- Step --------------------------------------------------------------------------------

  const stepWind = () => {
    if (!o.wind) {
      windNow = 0;
      return;
    }
    const t = time;
    const envelope = Math.max(0, Math.sin(0.09 * t + windPhase[2]!)) ** 2;
    windNow =
      1.5 *
      envelope *
      (0.65 * Math.sin(0.37 * t + windPhase[0]!) + 0.35 * Math.sin(1.1 * t + windPhase[1]!));
  };

  const stepCrane = (dt: number) => {
    const ax = stepServo(trolley, target.x, TROLLEY.speed, TROLLEY.accel, dt);
    const want = clamp(sY - target.y, MIN_CABLE, sY - 0.05);
    stepServo(hoist, want, hoistSpeed, HOIST.accel, dt);
    // Nothing goes into a building or the ground: the hoist can pay out only so far here.
    const c = Math.max(0.2, Math.cos(swing.theta));
    let maxL: number;
    if (carrying) {
      const L = loadReach();
      const lx = trolley.x + L * Math.sin(swing.theta);
      const surf = surfaceAt(lx - COLLIDE_HALF, lx + COLLIDE_HALF);
      maxL = (sY - surf - BH / 2) / c - SLING - BH / 2;
    } else {
      const hx = trolley.x + hoist.x * Math.sin(swing.theta);
      const surf = surfaceAt(hx - COLLIDE_HALF / 2, hx + COLLIDE_HALF / 2);
      maxL = (sY - surf - 0.12) / c;
    }
    maxL = Math.max(MIN_CABLE, maxL);
    if (hoist.x > maxL) {
      // Pulled up quickly but not in one jump.
      hoist.x = Math.max(maxL, hoist.x - 5 * dt);
      if (hoist.v > 0) hoist.v = 0;
    }
    const length = carrying ? loadReach() : hoist.x + 0.12;
    stepSwing(
      swing,
      {
        length,
        lengthRate: hoist.v,
        accel: ax,
        push: windNow,
        damping: o.assist ? DAMP.assist : DAMP.free,
        gravity: G,
        maxAngle: MAX_SWING,
      },
      dt,
    );
    // A load (or the empty hook) swung or dragged into a building's side stops against it.
    const reach = carrying ? loadReach() : hoist.x;
    const half = carrying ? COLLIDE_HALF : COLLIDE_HALF / 2;
    const under = carrying ? BH / 2 : 0.12;
    const px = trolley.x + reach * Math.sin(swing.theta);
    const py = sY - reach * Math.cos(swing.theta);
    if (py - under < surfaceAt(px - half, px + half) - 0.02) {
      const before = surfaceAt(prevPoint.x - half, prevPoint.x + half);
      if (prevPoint.y - under >= before - 0.02 && Math.abs(px - prevPoint.x) > 1e-9) {
        const lim = Math.sin(MAX_SWING);
        swing.theta = Math.asin(clamp((prevPoint.x - trolley.x) / reach, -lim, lim));
        swing.omega = 0;
      }
    }
    prevPoint.x = trolley.x + reach * Math.sin(swing.theta);
    prevPoint.y = sY - reach * Math.cos(swing.theta);
  };

  const stepCatch = (dt: number) => {
    if (catching < 1) catching = Math.min(1, catching + dt / CATCH_S);
    // A hook swinging past at speed doesn't snap on: it has to be lowered onto a block.
    if (carrying || cooldown > 0 || Math.abs(trolley.v) > CATCH_SPEED) return;
    const h = hookAt();
    for (let i = 0; i < yard.length; i++) {
      const b = yard[i];
      if (!b) continue;
      const dx = h.x - w.yard[i]!;
      const dy = h.y - BH;
      if (Math.abs(dx) > ATTACH.dx || dy < ATTACH.below - 0.03 || dy > ATTACH.above) continue;
      carrying = b;
      yard[i] = null;
      const l = loadAt()!;
      catchFrom.x = w.yard[i]! - l.x;
      catchFrom.y = BH / 2 - l.y;
      catching = 0;
      autoHold = 0;
      events.push({ type: "caught", kind: b.kind });
      return;
    }
  };

  const stepAuto = (dt: number) => {
    if (!carrying || catching < 1) {
      autoHold = 0;
      return;
    }
    const at = loadAt()!;
    const v = loadVelocity();
    const snap = findSnap(at, carrying.kind, AUTO);
    if (snap && Math.hypot(v.x, v.y) < AUTO.speed) {
      autoHold += dt;
      if (autoHold >= AUTO.hold) {
        const block = carrying;
        carrying = null;
        cooldown = 0.6;
        autoHold = 0;
        startSettle(snap, at, block);
      }
    } else {
      autoHold = 0;
    }
  };

  const stepSettles = (dt: number) => {
    for (let i = settles.length - 1; i >= 0; i--) {
      const s = settles[i]!;
      s.t += dt / SETTLE_S;
      if (s.t < 1) continue;
      settles.splice(i, 1);
      place(s);
    }
  };

  /** Where a block resting at height `surf` above `x` tips off: the nearer edge, a little past. */
  const tipTarget = (x: number, surf: number): number => {
    const step = 0.05;
    for (let d = step; d < 8; d += step) {
      for (const dir of [1, -1]) {
        const px = x + dir * d;
        if (surfaceAt(px - 0.04, px + 0.04) < surf - 0.01) return px + dir * 0.12;
      }
    }
    return x + 1;
  };

  const settleLoose = (l: Loose) => {
    if (l.yard < 0) l.yard = reserve(l.x);
    l.to = l.yard >= 0 ? w.yard[l.yard]! : w.storeX;
    l.vy = 0;
    // Slide along the ground if the way is clear; otherwise fade out and back in over there.
    const lo = Math.min(l.x, l.to) + 0.5;
    const hi = Math.max(l.x, l.to) - 0.5;
    const blocked = hi > lo && surfaceAt(lo, hi) > 0.01;
    l.state = blocked ? "fade" : "slide";
    l.age = 0;
  };

  const stepLoose = (dt: number) => {
    for (let i = loose.length - 1; i >= 0; i--) {
      const l = loose[i]!;
      l.age += dt;
      switch (l.state) {
        case "rise": {
          l.y = Math.min(BH / 2, l.y + 2.6 * dt);
          if (l.y >= BH / 2) {
            if (l.yard >= 0) settleLoose(l);
            else l.state = "wait";
          }
          break;
        }
        case "wait": {
          // Blocks waiting for room stand stacked on the lift's platform.
          const below = loose.filter((o) => o.state === "wait" && o.id < l.id).length;
          l.y += (BH / 2 + below * BH - l.y) * Math.min(1, 10 * dt);
          const slot = reserve(l.x);
          if (slot >= 0) {
            l.yard = slot;
            settleLoose(l);
          } else if (l.age > WAIT_S) {
            l.state = "slide";
            l.to = w.storeX;
          }
          break;
        }
        case "fall": {
          l.vy -= G * dt;
          l.vx *= 1 - 0.4 * dt;
          l.x = clamp(l.x + l.vx * dt, w.left + 0.5, w.right - 0.5);
          l.y += l.vy * dt;
          l.spin += l.vspin * dt;
          const surf = surfaceAt(l.x - 0.22, l.x + 0.22);
          if (l.y - BH / 2 <= surf && l.vy <= 0) {
            l.y = surf + BH / 2;
            const hard = l.vy < -2.4;
            events.push({ type: "landed", x: l.x, hard });
            if (hard && surf < 0.01) {
              l.vy = -l.vy * 0.22;
              l.vx *= 0.5;
              l.vspin *= -0.5;
              break;
            }
            l.spin = 0;
            l.vspin = 0;
            if (surf < 0.01) {
              settleLoose(l);
            } else {
              l.state = "tip";
              l.to = tipTarget(l.x, surf);
              l.vx = 0;
              l.vy = 0;
            }
          }
          break;
        }
        case "tip": {
          const d = l.to - l.x;
          l.x += Math.sign(d) * Math.min(Math.abs(d), 1.8 * dt);
          if (Math.abs(d) < 0.01) {
            l.state = "fall";
            l.vx = Math.sign(d || 1) * 0.6;
            l.vy = 0;
            l.vspin = Math.sign(d || 1) * 2;
          }
          break;
        }
        case "fade":
        case "slide": {
          l.y = BH / 2;
          if (l.state === "fade") {
            l.alpha = Math.abs(1 - l.age / FADE_S);
            if (l.age >= FADE_S && l.x !== l.to) l.x = l.to;
            if (l.age < 2 * FADE_S) break;
            l.alpha = 1;
          }
          const d = l.to - l.x;
          l.x += Math.sign(d) * Math.min(Math.abs(d), 2.6 * dt);
          if (Math.abs(d) > 0.005) break;
          loose.splice(i, 1);
          if (l.yard >= 0) {
            yard[l.yard] = { id: l.id, kind: l.kind };
            reserved[l.yard] = false;
            events.push({ type: "yarded", kind: l.kind });
          } else {
            counts.stored++;
            events.push({ type: "stored", kind: l.kind });
          }
          break;
        }
      }
    }
  };

  const stepRiders = (dt: number) => {
    for (let i = riders.length - 1; i >= 0; i--) {
      const r = riders[i]!;
      r.t += dt / LIFT_S;
      if (r.t < 1) continue;
      riders.splice(i, 1);
      counts.arrived++;
      addLoose({
        id: r.id,
        kind: r.kind,
        x: w.liftX,
        y: BH / 2,
        vx: 0,
        vy: 0,
        state: "slide",
        to: w.yard[r.yard] ?? w.storeX,
        yard: r.yard,
      });
    }
  };

  /** Push the top block of a building or tower off, towards the open side. */
  const popOff = (at: Point, kind: number, id: number, away: number) => {
    addLoose({
      id,
      kind,
      x: at.x,
      y: at.y,
      vx: away * 1.1,
      vy: 1.2,
      state: "fall",
      to: 0,
      yard: -1,
    });
    loose[loose.length - 1]!.vspin = away * 1.5;
  };

  const stepLots = () => {
    if (tower) {
      if (tower.phase === "wobble" && time >= tower.until) {
        const k = tower.breakAt;
        const lean = Math.sign(
          tower.blocks.slice(k + 1).reduce((s, b) => s + b.x, 0) /
            Math.max(1, tower.blocks.length - k - 1) -
            tower.blocks[k]!.x,
        );
        const gone = tower.blocks.splice(k + 1);
        gone.forEach((b, j) => {
          addLoose({
            id: b.id,
            kind: b.kind,
            x: b.x,
            y: (k + 1 + j) * BH + BH / 2,
            vx: (lean || 1) * (0.9 + 0.25 * j),
            vy: 0.4,
            state: "fall",
            to: 0,
            yard: -1,
          });
          loose[loose.length - 1]!.vspin = (lean || 1) * (1.5 + j * 0.3);
        });
        counts.tumbles++;
        events.push({ type: "tumble", level: k });
        tower.phase = "build";
        tower.breakAt = -1;
      } else if (tower.phase === "capped" && time >= tower.until) {
        tower.phase = "clear";
        tower.clearAt = time;
        events.push({ type: "clearing", lot: 0 });
      } else if (tower.phase === "clear" && time >= tower.clearAt) {
        const b = tower.blocks.pop();
        if (b) {
          const n = tower.blocks.length;
          popOff({ x: b.x, y: n * BH + BH / 2 }, b.kind, b.id, b.x < w.liftX ? 1 : -1);
          tower.clearAt = time + CLEAR_STEP_S;
        } else {
          tower.phase = "build";
          counts.cleared++;
          events.push({ type: "cleared", lot: 0 });
        }
      }
      return;
    }
    const clearing = lots.find((l) => l.phase === "clear");
    if (clearing) {
      if (time < clearing.clearAt) return;
      let i = clearing.filled.length - 1;
      while (i >= 0 && clearing.filled[i] === null) i--;
      const li = lots.indexOf(clearing);
      if (i >= 0) {
        const kind = clearing.filled[i]!;
        clearing.filled[i] = null;
        const c = slotCentre(clearing, i);
        popOff(c, kind, nextId++, clearing.x < w.liftX ? 1 : -1);
        clearing.clearAt = time + CLEAR_STEP_S;
      } else {
        lots[li] = newLot(
          li,
          lots.filter((_, j) => j !== li).map((l) => l.bp.shape),
        );
        counts.cleared++;
        events.push({ type: "cleared", lot: li });
      }
      return;
    }
    if (lots.length === 0 || !lots.every((l) => l.phase === "done")) return;
    const latest = Math.max(...lots.map((l) => l.doneAt));
    const hold = lots.length === 1 ? HOLD_ONE_LOT_S : HOLD_S;
    if (time - latest < Math.max(hold, CELEBRATE_S)) return;
    let oldest = lots[0]!;
    for (const l of lots) if (l.order < oldest.order) oldest = l;
    oldest.phase = "clear";
    oldest.clearAt = time;
    events.push({ type: "clearing", lot: lots.indexOf(oldest) });
  };

  /** A yard full of blocks that fit nowhere would stall the crane: send the oldest away. */
  const stepJam = () => {
    if (time < jamAt) return;
    jamAt = time + JAM_CHECK_S;
    if (tower || freeSlots() > 0 || !lots.some((l) => l.phase === "build")) return;
    if (carrying && fits(carrying.kind)) return;
    if (yard.some((b) => b && fits(b.kind))) return;
    let oldest = -1;
    yard.forEach((b, i) => {
      if (b && (oldest < 0 || b.id < yard[oldest]!.id)) oldest = i;
    });
    if (oldest < 0) return;
    const b = yard[oldest]!;
    yard[oldest] = null;
    addLoose({
      id: b.id,
      kind: b.kind,
      x: w.yard[oldest]!,
      y: BH / 2,
      vx: 0,
      vy: 0,
      state: "slide",
      to: w.storeX,
      yard: -1,
    });
  };

  const step = (dt: number) => {
    time += dt;
    if (cooldown > 0) cooldown -= dt;
    stepWind();
    const goal = Math.min(topLimit, tower ? tallTop() : buildTop());
    workTop += clamp(goal - workTop, -1.5 * dt, 1.5 * dt);
    target.y = Math.min(target.y, workTop);
    stepCrane(dt);
    stepCatch(dt);
    stepAuto(dt);
    stepSettles(dt);
    stepLoose(dt);
    stepRiders(dt);
    stepLots();
    stepJam();
    if (events.length > 256) events.splice(0, events.length - 256);
  };

  // ---- Readout -----------------------------------------------------------------------------

  const toNorm = (p: Point): Point => ({
    x: (p.x - w.tMin) / Math.max(1e-6, w.tMax - w.tMin),
    y: p.y / Math.max(1e-6, workTop),
  });
  const fromNorm = (p: Point): Point => ({
    x: w.tMin + p.x * (w.tMax - w.tMin),
    y: p.y * workTop,
  });

  const readout = (): Readout => {
    const span = Math.max(1e-6, w.tMax - w.tMin);
    const hook = hookAt();
    const load = loadAt();
    let pick: Point | null = null;
    let drop: Point | null = null;
    let park: Point | null = null;
    if (!carrying) {
      let pi = -1;
      yard.forEach((b, i) => {
        if (b && fits(b.kind) && (pi < 0 || b.id < yard[pi]!.id)) pi = i;
      });
      if (pi >= 0) pick = toNorm({ x: w.yard[pi]!, y: BH + 0.05 });
    } else {
      const s = nextSlot(carrying.kind);
      if (s) drop = toNorm({ x: s.x, y: s.y + BH / 2 + SLING - 0.05 });
      else {
        // Put it back in a free yard slot, or by the lift, to go back to the store.
        const free = w.yard.findIndex((_, i) => !yard[i] && !reserved[i]);
        const x = free >= 0 ? w.yard[free]! : w.liftX;
        park = toNorm({ x: clamp(x, w.tMin, w.tMax), y: BH * 2.2 + SLING + 0.3 });
      }
    }
    const reach = surfaceAt(w.tMin - 0.6, w.tMax + 0.6);
    const carry = Math.min(workTop, reach + (carrying ? SLING + BH + 0.45 : 0.5));
    const length = carrying ? loadReach() : hoist.x + 0.12;
    return {
      hook: toNorm(hook),
      target: toNorm(target),
      trolley: (trolley.x - w.tMin) / span,
      carrying: carrying ? carrying.kind : -1,
      load: load ? toNorm(load) : null,
      pick,
      drop,
      park,
      carry: carry / workTop,
      sway: swingAmplitude(swing, length, G),
      drift: swingAmplitude(swing, length, G) * length,
      period: swingPeriod(length, G),
      vx: TROLLEY.speed / span,
      ax: TROLLEY.accel / span,
      vy: hoistSpeed / workTop,
      inZone: !!(carrying && load && findSnap(load, carrying.kind, AUTO)),
      jitter: tower ? 0.14 / span : 0,
      unit: BH / workTop,
    };
  };

  const hint = () => {
    if (!carrying) return { snap: null, next: null };
    const at = loadAt()!;
    const snap = findSnap(at, carrying.kind, SNAP);
    const next = nextSlot(carrying.kind);
    return {
      snap: snap ? { x: snap.x, y: snap.y } : null,
      next: next ? { lot: next.lot, slot: next.slot } : null,
    };
  };

  const clearAll = () => {
    for (const st of settles.splice(0)) {
      fall({ id: st.id, kind: st.kind }, { x: st.x1, y: st.y1 }, { x: 0, y: 0 });
    }
    if (tower) {
      if (tower.blocks.length > 0) {
        tower.phase = "clear";
        tower.clearAt = time;
      }
      return;
    }
    // Every standing building comes down at once, one block at a time each.
    lots.forEach((lot, li) => {
      lot.filled.forEach((k, i) => {
        if (k === null) return;
        const c = slotCentre(lot, i);
        addLoose({
          kind: k,
          x: c.x,
          y: c.y,
          vx: (i % 2 ? 1 : -1) * 0.5,
          vy: 0.3,
          state: "fall",
          to: 0,
          yard: -1,
        });
      });
      lots[li] = newLot(
        li,
        lots.filter((_, j) => j !== li).map((l) => l.bp.shape),
      );
    });
  };

  return {
    world: w,
    variant: o.variant,
    trolley,
    hoist,
    swing,
    target,
    get carrying() {
      return carrying;
    },
    get catching() {
      return catching;
    },
    catchFrom,
    yard,
    lots,
    tower,
    loose,
    settles,
    riders,
    events,
    counts,
    get best() {
      return best;
    },
    set best(n: number) {
      best = n;
    },
    get time() {
      return time;
    },
    get workTop() {
      return workTop;
    },
    get wind() {
      return windNow;
    },
    hook: hookAt,
    load: loadAt,
    setTarget,
    setTargetNorm(nx, ny) {
      const p = fromNorm({ x: nx, y: ny });
      setTarget(p.x, p.y);
    },
    release,
    request,
    arrive,
    freeSlots,
    room,
    canRequest,
    readout,
    hint,
    toNorm,
    fromNorm,
    surfaceAt,
    step,
    clear: clearAll,
  };
};

/** Block kinds as named in config, for tests and drawing. */
export const ROOF = KIND.roof;
