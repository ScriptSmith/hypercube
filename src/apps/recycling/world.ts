/**
 * One frame's sorting lines: items, belts and bins, with no DOM so it can be tested directly.
 *
 * An item's life: it falls into a line's inlet (from the frame's own plant, or across the
 * bezel from the screen above), waits in the funnel, rides a tube to the start of its belt
 * (tricky items to the fast belt, obvious ones to the slow belt), and rides the belt. Off the
 * belt's end it drops into the hopper and the bucket lift carries it back to the inlet to come
 * round again. A finger picks it up off a belt (or out of the air); letting go throws it. An item
 * crossing a bin's mouth going down goes in: the right bin keeps it, a wrong one flicks it back
 * out onto the belt above and the right bin's lid glows. Something that misses every bin lands
 * on the floor and is swept back round. Bins fill, rise away and are replaced.
 *
 * Belts are one-dimensional queues (items keep their spacing and never pile up), and thrown
 * items fly in front of the machinery, touching only bin rims, the frame's sides and the floor.
 */
import {
  ASSIST,
  FALL_TAU,
  FLY_TAU,
  GAP_D,
  GRAVITY_D,
  HINT_S,
  LIFT_D,
  MAX_QUEUE,
  MAX_THROW_D,
  SINK_S,
  TUBE_D,
  WRONG_HOLD_S,
} from "./config";
import { type BinKind, ITEMS } from "./items";
import type { Belt, BinSlot, Layout } from "./layout";
import { type Materials, productOf, type ThingKind } from "./park";
import { type Path, pointAt } from "./paths";
import { arcAt, arcTo, assistThrow, type Fall, fallAt, flyStep, type Motion } from "./physics";

export type Holder = "person" | "bot" | "ghost";

export type ItemState =
  | "fall"
  | "chute"
  | "queue"
  | "tube"
  | "belt"
  | "held"
  | "fly"
  | "sink"
  | "eject"
  | "lift"
  | "poof";

export interface Item {
  id: number;
  kind: number;
  line: number;
  state: ItemState;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  a: number;
  pa: number;
  /** Spin, radians a second. */
  w: number;
  path: Path | null;
  ps: number;
  /** The belt it is heading for or riding, and how far along it. */
  belt: number;
  s: number;
  fall: Fall | null;
  /** Seconds in the current state (sink, eject, poof). */
  t: number;
  bin: number;
  right: boolean;
  arc: { x0: number; y0: number; vx: number; vy: number; time: number; s: number } | null;
  finger: number | null;
  fx: number;
  fy: number;
  ox: number;
  oy: number;
  by: Holder | null;
  /** Where it entered its bin, for the sinking ease. */
  ex: number;
  ey: number;
}

export interface BinState {
  slot: BinSlot;
  fill: number;
  materials: Materials;
  /** Lid opening: 1 is standing open (rest), 0 shut. */
  lid: number;
  lidV: number;
  /** Seconds since the last right item, the hint glow left, the wrong-bin shake left. */
  since: number;
  glow: number;
  shake: number;
  phase: "ready" | "lifting" | "arriving";
  phaseT: number;
  turn: number;
}

export interface RisingBin {
  id: number;
  kind: BinKind;
  line: number;
  x: number;
  w: number;
  h: number;
  /** Centre height and speed (up, venue px a second). */
  y: number;
  v: number;
  product: ThingKind | null;
  done: boolean;
}

export type WorldEvent =
  | {
      type: "sorted";
      kind: number;
      bin: BinKind;
      line: number;
      right: boolean;
      by: Holder | null;
      x: number;
      y: number;
    }
  | { type: "missed"; kind: number; line: number; x: number; y: number }
  | { type: "floor"; kind: number; x: number; y: number }
  | { type: "ejected"; kind: number; x: number; y: number }
  | { type: "full"; rise: RisingBin }
  | { type: "delivered"; rise: RisingBin };

export interface Counts {
  right: number;
  wrong: number;
  missed: number;
  people: number;
  full: number;
  arrived: number;
  spawned: number;
  refused: number;
}

export interface WorldOptions {
  layout: Layout;
  hints: boolean;
  /** Speed of a belt now, venue px a second. */
  beltSpeed(b: Belt): number;
  /** Full bins rise to this height (the plant), or out of the top edge on a bank. */
  liftGoal(): number;
  maxItems: number;
}

export interface World {
  readonly layout: Layout;
  readonly items: readonly Item[];
  readonly bins: readonly BinState[];
  readonly rising: readonly RisingBin[];
  readonly events: WorldEvent[];
  readonly counts: Counts;
  step(dt: number, clockMs: number): void;
  spawn(line: number, kind: number, clockMs: number): Item | null;
  arrive(line: number, kind: number, fall: Fall, angle: number, spin: number): Item | null;
  grab(finger: number, x: number, y: number, by: Holder): Item | null;
  move(finger: number, x: number, y: number): void;
  release(finger: number, vx: number, vy: number): void;
  /** The item a finger holds. */
  held(finger: number): Item | null;
  /** Items in play on a line (or all). */
  load(line?: number): number;
  /** Let every finger go, items dropping where they are. */
  dropHolds(): void;
  /** Empty everything: items, bins, rising bins. */
  clear(): void;
  beltCapacity(belt: number): number;
}

const MAX_RISING = 16;
const MAX_EVENTS = 128;
const POOF_S = 2.4;
const BELT_REST_SPIN = 6;
/** A bin swap: the full one rises, then a fresh one comes up from below. */
const SWAP_DELAY_S = 0.35;
const ARRIVE_S = 0.7;

const blank = (id: number, kind: number, line: number, state: ItemState): Item => ({
  id,
  kind,
  line,
  state,
  x: 0,
  y: 0,
  px: 0,
  py: 0,
  vx: 0,
  vy: 0,
  a: 0,
  pa: 0,
  w: 0,
  path: null,
  ps: 0,
  belt: -1,
  s: 0,
  fall: null,
  t: 0,
  bin: -1,
  right: false,
  arc: null,
  finger: null,
  fx: 0,
  fy: 0,
  ox: 0,
  oy: 0,
  by: null,
  ex: 0,
  ey: 0,
});

const wrapAngle = (a: number) => {
  const t = Math.PI * 2;
  return ((((a + Math.PI) % t) + t) % t) - Math.PI;
};

export const createWorld = (opts: WorldOptions): World => {
  const layout = opts.layout;
  const { d, r } = layout;
  const g = GRAVITY_D * d;
  const items: Item[] = [];
  const rising: RisingBin[] = [];
  const events: WorldEvent[] = [];
  const counts: Counts = {
    right: 0,
    wrong: 0,
    missed: 0,
    people: 0,
    full: 0,
    arrived: 0,
    spawned: 0,
    refused: 0,
  };
  const bins: BinState[] = layout.bins.map((slot) => ({
    slot,
    fill: 0,
    materials: {},
    lid: 1,
    lidV: 0,
    since: 99,
    glow: 0,
    shake: 0,
    phase: "ready",
    phaseT: 0,
    turn: 0,
  }));
  let nextId = 1;
  let nextRise = 1;
  let clock = 0;
  const gap = GAP_D * d;
  const scratch: Motion = { x: 0, y: 0, vx: 0, vy: 0 };
  const pt = { x: 0, y: 0, angle: 0 };

  const emit = (e: WorldEvent) => {
    events.push(e);
    if (events.length > MAX_EVENTS) events.shift();
  };

  const beltOf = (i: number): Belt | undefined => layout.belts[i];
  const capacityOf = (b: Belt) => Math.max(1, Math.floor(b.length / gap) + 1);
  const beltX = (b: Belt, s: number) => b.start + b.dir * s;
  const restY = (b: Belt) => b.y - r;

  const remove = (it: Item) => {
    const i = items.indexOf(it);
    if (i >= 0) items.splice(i, 1);
  };

  const add = (kind: number, line: number, state: ItemState): Item | null => {
    if (items.length >= opts.maxItems) {
      counts.refused++;
      return null;
    }
    const it = blank(nextId++, kind, line, state);
    items.push(it);
    return it;
  };

  // ---- Inlet and tubes ----------------------------------------------------------------------

  const enterQueue = (it: Item) => {
    const line = layout.lines[it.line];
    if (!line) {
      remove(it);
      return;
    }
    it.state = "queue";
    it.t = 0;
    it.fall = null;
    it.path = null;
    it.vx = 0;
    it.vy = 0;
    it.x = line.inlet.x;
    it.y = line.inlet.bottom - d * 0.35;
    const queued = items.filter((q) => q.state === "queue" && q.line === it.line);
    if (queued.length > MAX_QUEUE) {
      // The funnel is overfull: the oldest waiting item is swept away inside the plant.
      const old = queued[0]!;
      remove(old);
      counts.refused++;
    }
  };

  /** Items riding or heading for a belt. */
  const beltLoad = (b: Belt) =>
    items.reduce(
      (n, it) => n + ((it.state === "belt" || it.state === "tube") && it.belt === b.id ? 1 : 0),
      0,
    );

  const chooseBelt = (it: Item): Belt | null => {
    const line = layout.lines[it.line];
    if (!line) return null;
    const def = ITEMS[it.kind];
    const want = def?.tricky ? "tricky" : "obvious";
    const candidates = line.belts
      .map((i) => layout.belts[i]!)
      .filter((b) => b.takes === "any" || b.takes === want);
    const list = candidates.length > 0 ? candidates : line.belts.map((i) => layout.belts[i]!);
    let best: Belt | null = null;
    let bestLoad = Infinity;
    for (const b of list) {
      const load = beltLoad(b) / capacityOf(b);
      if (load < bestLoad) {
        best = b;
        bestLoad = load;
      }
    }
    return best;
  };

  const tubeClear = (b: Belt) =>
    !items.some((q) => q.state === "tube" && q.belt === b.id && q.ps < gap);

  const dispatchQueues = () => {
    for (const line of layout.lines) {
      const head = items.find((q) => q.state === "queue" && q.line === line.index);
      if (!head) continue;
      const b = chooseBelt(head);
      if (!b) continue;
      if (beltLoad(b) >= capacityOf(b) || !tubeClear(b)) continue;
      head.state = "tube";
      head.belt = b.id;
      head.path = b.tube;
      head.ps = 0;
    }
  };

  const startClear = (b: Belt) =>
    !items.some((q) => q.state === "belt" && q.belt === b.id && q.s < gap);

  // ---- Bins ---------------------------------------------------------------------------------

  /** The bin whose mouth an item just crossed going down, the one it is most over. */
  const binAt = (x: number, py: number, y: number, tol: number): BinState | null => {
    let best: BinState | null = null;
    let bestMiss = Infinity;
    for (const bin of bins) {
      if (bin.phase !== "ready") continue;
      const m = bin.slot.mouth;
      if (!(py < m.y && y >= m.y)) continue;
      const miss = x < m.x0 ? m.x0 - x : x > m.x1 ? x - m.x1 : 0;
      if (miss <= tol && miss < bestMiss) {
        best = bin;
        bestMiss = miss;
      }
    }
    return best;
  };

  const inBody = (x: number, y: number): BinState | null => {
    for (const bin of bins) {
      if (bin.phase !== "ready") continue;
      const m = bin.slot.mouth;
      if (x >= m.x0 && x <= m.x1 && y >= m.y && y <= bin.slot.bottom) return bin;
    }
    return null;
  };

  const rightBinFor = (it: Item): BinState | null => {
    const kind = ITEMS[it.kind]?.bin;
    const same = bins.find((b) => b.slot.line === it.line && b.slot.kind === kind);
    if (same) return same;
    let best: BinState | null = null;
    let dist = Infinity;
    for (const b of bins) {
      if (b.slot.kind !== kind) continue;
      const dd = Math.abs(b.slot.x - it.x);
      if (dd < dist) {
        best = b;
        dist = dd;
      }
    }
    return best;
  };

  const capture = (it: Item, bin: BinState) => {
    const def = ITEMS[it.kind];
    it.state = "sink";
    it.t = 0;
    it.bin = bins.indexOf(bin);
    it.right = def?.bin === bin.slot.kind;
    it.finger = null;
    it.ex = it.x;
    it.ey = Math.max(it.y, bin.slot.top - r * 0.2);
    it.vx = 0;
    it.vy = 0;
    if (it.right) {
      counts.right++;
      if (it.by === "person") counts.people++;
      bin.since = 0;
      bin.lidV -= 3.2;
    } else {
      counts.wrong++;
      bin.shake = 0.5;
    }
    emit({
      type: "sorted",
      kind: it.kind,
      bin: bin.slot.kind,
      line: bin.slot.line,
      right: it.right,
      by: it.by,
      x: bin.slot.x,
      y: bin.slot.top,
    });
  };

  const startLift = (bin: BinState) => {
    const s = bin.slot;
    const h = s.bottom - s.top;
    const rise: RisingBin = {
      id: nextRise++,
      kind: s.kind,
      line: s.line,
      x: s.x,
      w: s.w,
      h,
      y: s.top + h / 2,
      v: Math.max(6 * d, layout.height * 0.55),
      product: productOf(s.kind, bin.materials, bin.turn),
      done: false,
    };
    bin.turn++;
    bin.fill = 0;
    bin.materials = {};
    bin.phase = "lifting";
    bin.phaseT = 0;
    bin.glow = 0;
    counts.full++;
    if (rising.length >= MAX_RISING) rising.shift();
    rising.push(rise);
    emit({ type: "full", rise });
  };

  const fillBin = (bin: BinState, it: Item) => {
    const m = ITEMS[it.kind]?.material;
    if (m) bin.materials[m] = (bin.materials[m] ?? 0) + 1;
    bin.fill++;
    if (bin.fill >= bin.slot.cap && bin.phase === "ready") startLift(bin);
  };

  /** A free stretch on a belt near `x`, accounting for the belt moving while the item flies. */
  const landingOn = (b: Belt, x: number, flight: number): number => {
    const v = opts.beltSpeed(b);
    const want = Math.min(b.length * 0.85, Math.max(gap * 0.5, (x - b.start) * b.dir));
    const taken = items
      .filter((q) => q.state === "belt" && q.belt === b.id)
      .map((q) => q.s + v * flight)
      .sort((p, q) => p - q);
    const clearOf = (s: number) => taken.every((t) => Math.abs(t - s) >= gap);
    for (let k = 0; k < 12; k++) {
      for (const sign of [1, -1]) {
        const s = want + sign * k * gap * 0.5;
        if (s >= gap * 0.3 && s <= b.length * 0.9 && clearOf(s)) return s - v * flight;
      }
    }
    return want - v * flight;
  };

  const eject = (it: Item, bin: BinState) => {
    const b = beltOf(bin.slot.belt);
    if (!b) {
      it.state = "poof";
      it.t = 0;
      return;
    }
    const x0 = bin.slot.x;
    const y0 = bin.slot.top - r * 0.3;
    // Aim for the belt just above, a little upstream so the item has time to be taken again.
    const guess = arcTo(x0, y0, x0, restY(b), g, d * 1.1).time;
    const sNow = landingOn(b, x0 - b.dir * d * 0.6, guess);
    const v = opts.beltSpeed(b);
    const sLand = sNow + v * guess;
    const x1 = beltX(b, sLand);
    const arc = arcTo(x0, y0, x1, restY(b), g, d * 1.1);
    it.state = "eject";
    it.t = 0;
    it.belt = b.id;
    it.arc = { x0, y0, vx: arc.vx, vy: arc.vy, time: arc.time, s: sNow + v * arc.time };
    it.x = x0;
    it.y = y0;
    it.w = (arc.vx / d) * 2.5 + 3;
    bin.lid = 0;
    bin.lidV = 5;
    if (opts.hints) {
      const right = rightBinFor(it);
      if (right && right !== bin) right.glow = HINT_S;
    }
    emit({ type: "ejected", kind: it.kind, x: x0, y: y0 });
  };

  // ---- Stepping -----------------------------------------------------------------------------

  const stepBins = (dt: number) => {
    for (const bin of bins) {
      bin.since += dt;
      bin.glow = Math.max(0, bin.glow - dt);
      bin.shake = Math.max(0, bin.shake - dt);
      // The lid springs back to standing open, a little higher while it glows.
      const target = bin.glow > 0 ? 1.18 : 1;
      bin.lidV += ((target - bin.lid) * 120 - bin.lidV * 11) * dt;
      bin.lid = Math.min(1.3, Math.max(0, bin.lid + bin.lidV * dt));
      if (bin.phase !== "ready") {
        bin.phaseT += dt;
        if (bin.phase === "lifting" && bin.phaseT >= SWAP_DELAY_S) {
          bin.phase = "arriving";
          bin.phaseT = 0;
        } else if (bin.phase === "arriving" && bin.phaseT >= ARRIVE_S) {
          bin.phase = "ready";
          bin.phaseT = 0;
          bin.lid = 0.2;
          bin.lidV = 4;
          // Items that went in during the swap may have filled the new bin already.
          if (bin.fill >= bin.slot.cap) startLift(bin);
        }
      }
    }
    const goal = opts.liftGoal();
    for (let i = rising.length - 1; i >= 0; i--) {
      const rb = rising[i]!;
      rb.y -= rb.v * dt;
      if (!rb.done && rb.y + rb.h / 2 <= goal) {
        rb.done = true;
        emit({ type: "delivered", rise: rb });
      }
      if (rb.y + rb.h / 2 < goal - rb.h * 0.2 || rb.y < -layout.height) rising.splice(i, 1);
    }
  };

  const stepBelts = (dt: number) => {
    for (const b of layout.belts) {
      const v = opts.beltSpeed(b);
      const on = items.filter((it) => it.state === "belt" && it.belt === b.id);
      on.sort((p, q) => q.s - p.s);
      let ahead = Infinity;
      for (const it of on) {
        it.s = Math.min(it.s + v * dt, ahead - gap);
        ahead = it.s;
        if (it.s >= b.length) {
          it.state = "lift";
          it.path = b.lift;
          it.ps = 0;
          counts.missed++;
          emit({ type: "missed", kind: it.kind, line: it.line, x: it.x, y: it.y });
          continue;
        }
        it.x = beltX(b, it.s);
        it.y = restY(b);
        // Settle upright: the nearest flat way up.
        const a = wrapAngle(it.a);
        it.a = a - a * Math.min(1, dt * BELT_REST_SPIN);
      }
    }
  };

  const stepPath = (it: Item, speed: number, dt: number) => {
    const path = it.path;
    if (!path) return true;
    it.ps = Math.min(path.length, it.ps + speed * dt);
    pointAt(path, it.ps, pt);
    it.x = pt.x;
    it.y = pt.y;
    return it.ps >= path.length;
  };

  const rims = (bin: BinState): [number, number][] => {
    const m = bin.slot.mouth;
    const rim = (bin.slot.w - (m.x1 - m.x0)) / 2;
    return [
      [m.x0 - rim / 2, m.y],
      [m.x1 + rim / 2, m.y],
    ];
  };

  const stepFly = (it: Item, dt: number) => {
    scratch.x = it.x;
    scratch.y = it.y;
    scratch.vx = it.vx;
    scratch.vy = it.vy;
    flyStep(scratch, g, FLY_TAU, dt);
    it.x = scratch.x;
    it.y = scratch.y;
    it.vx = scratch.vx;
    it.vy = scratch.vy;
    it.a += it.w * dt;
    // The frame's sides and top.
    if (it.x < r) {
      it.x = r;
      it.vx = Math.abs(it.vx) * 0.55;
    } else if (it.x > layout.width - r) {
      it.x = layout.width - r;
      it.vx = -Math.abs(it.vx) * 0.55;
    }
    if (it.y < r) {
      it.y = r;
      it.vy = Math.abs(it.vy) * 0.4;
    }
    for (const bin of bins) {
      if (bin.phase !== "ready") continue;
      for (const [rx, ry] of rims(bin)) {
        const dx = it.x - rx;
        const dy = it.y - ry;
        const dist = Math.hypot(dx, dy);
        const reach = r * 0.55;
        if (dist >= reach || dist < 1e-6) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const vn = it.vx * nx + it.vy * ny;
        if (vn < 0) {
          it.vx -= 1.5 * vn * nx;
          it.vy -= 1.5 * vn * ny;
        }
        it.x = rx + nx * reach;
        it.y = ry + ny * reach;
      }
    }
    const into = binAt(it.x, it.py, it.y, d * 0.12);
    if (into) {
      capture(it, into);
      return;
    }
    if (it.y > layout.floor) {
      it.state = "poof";
      it.t = 0;
      counts.missed++;
      emit({ type: "floor", kind: it.kind, x: it.x, y: layout.floor });
    }
  };

  const stepHeld = (it: Item, dt: number) => {
    // A soft spring: the item swings after the finger rather than sticking to it.
    const decay = Math.exp(-dt / 0.12);
    it.ox *= decay;
    it.oy *= decay;
    const tx = it.fx + it.ox;
    const ty = it.fy + it.oy;
    const k = 360;
    const c = 30;
    it.vx += ((tx - it.x) * k - it.vx * c) * dt;
    it.vy += ((ty - it.y) * k - it.vy * c) * dt;
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    const tilt = Math.max(-0.6, Math.min(0.6, (it.vx / d) * 0.05));
    it.a += (tilt - wrapAngle(it.a)) * Math.min(1, dt * 8);
    const into = binAt(it.x, it.py, it.y, d * 0.12);
    if (into) capture(it, into);
  };

  const stepSink = (it: Item, dt: number) => {
    it.t += dt;
    const bin = bins[it.bin];
    if (!bin) {
      remove(it);
      return;
    }
    const f = Math.min(1, it.t / SINK_S);
    const e = f * f * (3 - 2 * f);
    const tx = bin.slot.x;
    const ty = bin.slot.top + d * 0.75;
    it.x = it.ex + (tx - it.ex) * e;
    it.y = it.ey + (ty - it.ey) * e;
    if (it.right) {
      if (it.t >= SINK_S) {
        remove(it);
        fillBin(bin, it);
      }
    } else if (it.t >= WRONG_HOLD_S) {
      eject(it, bin);
    }
  };

  const stepEject = (it: Item, dt: number) => {
    const arc = it.arc;
    const b = beltOf(it.belt);
    if (!arc || !b) {
      it.state = "poof";
      it.t = 0;
      return;
    }
    it.t += dt;
    const p = arcAt(arc.x0, arc.y0, arc.vx, arc.vy, g, Math.min(it.t, arc.time));
    it.x = p.x;
    it.y = p.y;
    it.vx = p.vx;
    it.vy = p.vy;
    it.a += it.w * dt;
    if (it.t >= arc.time) {
      it.state = "belt";
      it.s = Math.max(0, Math.min(b.length - 1, arc.s));
      it.arc = null;
      it.x = beltX(b, it.s);
      it.y = restY(b);
    }
  };

  const stepFall = (it: Item) => {
    const f = it.fall;
    const line = layout.lines[it.line];
    if (!f || !line) {
      remove(it);
      return;
    }
    fallAt(f, (clock - f.t0) / 1000, scratch);
    it.x = scratch.x;
    it.y = scratch.y;
    it.vx = scratch.vx;
    it.vy = scratch.vy;
    if (it.y >= line.inlet.y + d * 0.15) enterQueue(it);
    else if (it.y > layout.floor) remove(it);
  };

  const step = (dt: number, clockMs: number) => {
    clock = clockMs;
    for (const it of items) {
      it.px = it.x;
      it.py = it.y;
      it.pa = it.a;
    }
    stepBins(dt);
    dispatchQueues();
    stepBelts(dt);
    const tube = TUBE_D * d;
    const lift = LIFT_D * d;
    // A copy: items leave the list as they go into bins.
    for (const it of items.slice()) {
      switch (it.state) {
        case "fall":
          it.a += it.w * dt;
          stepFall(it);
          break;
        case "chute": {
          it.a += it.w * dt;
          if (stepPath(it, tube * 0.7, dt)) {
            const at = it.path ? pointAt(it.path, it.path.length) : null;
            it.state = "fall";
            it.path = null;
            it.fall = {
              t0: clockMs,
              x0: at?.x ?? it.x,
              y0: at?.y ?? it.y,
              vx0: 0,
              vy0: d * 1.5,
              g,
              tau: FALL_TAU,
            };
          }
          break;
        }
        case "tube": {
          const b = beltOf(it.belt);
          if (!b) {
            remove(it);
            break;
          }
          // Keep spacing behind the item ahead in the same tube.
          let limit = Infinity;
          for (const q of items) {
            if (q !== it && q.state === "tube" && q.belt === it.belt && q.ps > it.ps) {
              limit = Math.min(limit, q.ps - gap);
            }
          }
          const was = it.ps;
          stepPath(it, tube, dt);
          if (it.ps > limit) {
            it.ps = Math.max(was, limit);
            if (it.path) pointAt(it.path, it.ps, pt);
            it.x = pt.x;
            it.y = pt.y;
          }
          it.a += 4 * dt;
          const done = it.path !== null && it.ps >= it.path.length;
          if (done && startClear(b)) {
            it.state = "belt";
            it.s = 0;
            it.path = null;
            it.x = beltX(b, 0);
            it.y = restY(b);
          }
          break;
        }
        case "held":
          stepHeld(it, dt);
          break;
        case "fly":
          stepFly(it, dt);
          break;
        case "sink":
          stepSink(it, dt);
          break;
        case "eject":
          stepEject(it, dt);
          break;
        case "lift":
          it.a += 1.5 * dt;
          if (stepPath(it, lift, dt)) enterQueue(it);
          break;
        case "poof":
          it.t += dt;
          if (it.t >= POOF_S) enterQueue(it);
          break;
        default:
          break;
      }
    }
  };

  const grabbable = (it: Item) => it.state === "belt" || it.state === "fly" || it.state === "eject";

  return {
    layout,
    items,
    bins,
    rising,
    events,
    counts,
    step,
    spawn(line, kind, clockMs) {
      const l = layout.lines[line];
      if (!l || !ITEMS[kind]) return null;
      const it = add(kind, line, l.cascade ? "chute" : "fall");
      if (!it) return null;
      counts.spawned++;
      it.a = (it.id * 1.7) % (Math.PI * 2);
      it.w = ((it.id % 5) - 2) * 1.6;
      if (l.cascade) {
        it.path = l.cascade;
        it.ps = 0;
        pointAt(l.cascade, 0, pt);
        it.x = pt.x;
        it.y = pt.y;
      } else {
        it.fall = {
          t0: clockMs,
          x0: l.spout.x,
          y0: l.spout.y,
          vx0: 0,
          vy0: d * 1.2,
          g,
          tau: FALL_TAU,
        };
        it.x = l.spout.x;
        it.y = l.spout.y;
      }
      it.px = it.x;
      it.py = it.y;
      return it;
    },
    arrive(line, kind, fall, angle, spin) {
      if (!layout.lines[line] || !ITEMS[kind]) return null;
      const it = add(kind, line, "fall");
      if (!it) return null;
      counts.arrived++;
      it.fall = fall;
      it.a = angle;
      it.w = spin;
      fallAt(fall, (clock - fall.t0) / 1000, scratch);
      it.x = scratch.x;
      it.y = scratch.y;
      it.px = it.x;
      it.py = it.y;
      return it;
    },
    grab(finger, x, y, by) {
      if (items.some((it) => it.finger === finger)) return null;
      let best: Item | null = null;
      let dist = r + d * 0.5;
      for (const it of items) {
        if (!grabbable(it)) continue;
        const dd = Math.hypot(it.x - x, it.y - y);
        if (dd < dist) {
          best = it;
          dist = dd;
        }
      }
      if (!best) return null;
      best.state = "held";
      best.finger = finger;
      best.by = by;
      best.fx = x;
      best.fy = y;
      best.ox = best.x - x;
      best.oy = best.y - y;
      best.arc = null;
      if (best.belt >= 0) {
        // Off the belt now; it keeps the belt's speed for a moment.
        const b = beltOf(best.belt);
        if (b && Math.abs(best.vx) < 1) best.vx = b.dir * opts.beltSpeed(b);
      }
      return best;
    },
    move(finger, x, y) {
      const it = items.find((q) => q.finger === finger && q.state === "held");
      if (!it) return;
      it.fx = x;
      it.fy = y;
    },
    release(finger, vx, vy) {
      const it = items.find((q) => q.finger === finger && q.state === "held");
      if (!it) return;
      it.finger = null;
      const inside = inBody(it.x, it.y);
      if (inside) {
        capture(it, inside);
        return;
      }
      // The finger's speed is the throw; a finger that stopped lets the item drop gently.
      const max = MAX_THROW_D * d;
      let tx = vx;
      let ty = vy;
      const speed = Math.hypot(tx, ty);
      if (speed > max) {
        tx *= max / speed;
        ty *= max / speed;
      }
      if (speed < d * 0.8) {
        tx = it.vx * 0.3;
        ty = it.vy * 0.3;
      }
      const share = it.y >= layout.childTop ? ASSIST.child : ASSIST.adult;
      const mouths = bins.filter((b) => b.phase === "ready").map((b) => b.slot.mouth);
      const aimed = assistThrow(
        { x: it.x, y: it.y, vx: tx, vy: ty },
        mouths,
        g,
        FLY_TAU,
        d * 0.7,
        share,
      );
      it.state = "fly";
      it.vx = aimed.vx;
      it.vy = aimed.vy;
      it.w = Math.max(-9, Math.min(9, (aimed.vx / d) * 0.9));
    },
    held(finger) {
      return items.find((q) => q.finger === finger && q.state === "held") ?? null;
    },
    load(line) {
      return items.reduce((n, it) => n + (line === undefined || it.line === line ? 1 : 0), 0);
    },
    dropHolds() {
      for (const it of items) {
        if (it.state !== "held") continue;
        it.finger = null;
        it.state = "fly";
        it.vx *= 0.2;
        it.vy *= 0.2;
      }
    },
    clear() {
      items.length = 0;
      rising.length = 0;
      events.length = 0;
      for (const b of bins) {
        b.fill = 0;
        b.materials = {};
        b.phase = "ready";
        b.glow = 0;
        b.shake = 0;
        b.lid = 1;
        b.lidV = 0;
      }
    },
    beltCapacity(belt) {
      const b = beltOf(belt);
      return b ? capacityOf(b) : 0;
    },
  };
};
