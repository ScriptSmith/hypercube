/**
 * The screen above a bank, as a model with no DOM: what drops where and when, the fall out of
 * each column's drop tube (the same fall the frame below draws, so it carries straight on across
 * the bezel), full bins rising up from the frames into the plant, what they become and the park.
 *
 * Positions are "bank units": the touch frames' venue px, x across the whole bank and y up from
 * the frames' top edge (negative is up, on the screen). The screen maps them to its own pixels.
 */
import type { FrameKind, Rng } from "../../core/types";
import { ATTRACT_SCALE, FALL_TAU, GRAVITY_D, type Variant } from "./config";
import { BIN_KINDS, type BinKind } from "./items";
import { inletsFor, ITEM_D } from "./layout";
import { createPace, type Pace } from "./pace";
import { createPark, MAX_PARK, type Park, THING_KINDS, type ThingKind } from "./park";
import { type Fall, fallAt, fallTimeTo } from "./physics";
import { createPicker, type ItemClass } from "./picker";
import type { DropMsg, FullMsg, LoadMsg, SortedMsg } from "./wire";

/** The free fall starts this far above the frames' top edge (bank units). */
export const FALL_FROM = 1400;
/** Items leave the chute's lip this fast, downward. */
export const FALL_VY = 90;
/** Items travel the chutes this fast, item sizes a second. */
export const CHUTE_D = 4.5;
/** Seconds between drops into one inlet at calm pace. */
export const DROP_S = 3.1;
/** With no frames below for this long, the screen runs its own show. */
export const ALONE_MS = 6000;
/** A frame's load report is trusted this long. */
const LOAD_TTL_MS = 4000;
export const MAX_JOBS = 80;
export const MAX_RISING = 24;
export const MAX_FLIGHTS = 12;
/** A product flies from the plant to the park in this long. */
export const FLIGHT_S = 1.5;
/** A bin that reaches the plant is swallowed over this long. */
export const SWALLOW_S = 0.6;
const ALONE_BIN_S = 40;
const MAX_RECENT = 32;

export interface ColumnInfo {
  pos: number;
  kind: FrameKind;
  /** The frame showing this column, if one is in the roster. */
  frame: string | null;
}

export interface Inlet {
  column: number;
  index: number;
  /** Across the column, 0 to 1, and in bank units across the bank. */
  u: number;
  x: number;
  next: number;
  turn: number;
}

export interface Job {
  id: number;
  inlet: Inlet;
  kind: number;
  /** Seconds along the chute, then the fall (clock ms), once it leaves the lip. */
  t: number;
  fall: Fall | null;
  sent: boolean;
  a: number;
  w: number;
}

export interface Rising {
  id: number;
  kind: BinKind;
  product: ThingKind | null;
  /** Bank units: centre x, width, height; when the centre crosses the frames' top edge; speed. */
  x: number;
  w: number;
  h: number;
  t: number;
  v: number;
  /** Clock ms when it reached the plant, then swallowed. */
  arrived: number | null;
  human: boolean;
}

export interface Flight {
  id: number;
  kind: ThingKind;
  /** Bank units of the plant point it leaves from, and seconds flown. */
  x: number;
  age: number;
}

export interface PlantModel {
  readonly columns: readonly ColumnInfo[];
  readonly inlets: readonly Inlet[];
  readonly jobs: readonly Job[];
  readonly rising: readonly Rising[];
  readonly flights: readonly Flight[];
  readonly park: Park;
  readonly pace: Pace;
  /** Width of a column in bank units. */
  readonly fw: number;
  /** Item size in bank units. */
  readonly d: number;
  readonly counts: {
    drops: number;
    sent: number;
    right: number;
    wrong: number;
    full: number;
    madeThings: number;
  };
  readonly recent: readonly {
    id: number;
    column: number;
    inlet: number;
    x: number;
    t0: number;
    cross: number;
  }[];
  /** Bank-unit height of the plant's bottom (negative, above the frames). */
  plantY: number;
  setColumns(cols: ColumnInfo[]): boolean;
  /** Seconds of chute travel before the fall starts. */
  chuteTime(inlet: Inlet): number;
  step(dt: number, clockMs: number, send: (to: string, m: DropMsg) => void): void;
  load(column: number, m: LoadMsg, at: number): void;
  sorted(m: SortedMsg): void;
  full(column: number, m: FullMsg): void;
  /** Whether anyone (or a bot) is playing below, by the frames' reports. */
  busy(at: number): boolean;
  alone(at: number): boolean;
  clearPark(): void;
}

export interface PlantOptions {
  variant: Variant;
  rng: Rng;
  /** Chute length for an inlet, bank units, as the screen draws it. */
  chuteLength(inlet: Inlet): number;
  /** Local ms, for how long ago frames reported. Default performance.now. */
  now?: () => number;
}

const frameWidth = (kind: FrameKind) => (kind === "pair" ? 2160 : 1080);

export const createPlant = (o: PlantOptions): PlantModel => {
  const now = o.now ?? (() => performance.now());
  const d = ITEM_D.panel;
  const g = GRAVITY_D * d;
  const columns: ColumnInfo[] = [];
  const inlets: Inlet[] = [];
  const jobs: Job[] = [];
  const rising: Rising[] = [];
  const flights: Flight[] = [];
  const park = createPark(MAX_PARK);
  const pace = createPace();
  const picker = createPicker(o.rng.fork("picker"), o.variant);
  const loads = new Map<number, { m: LoadMsg; at: number }>();
  const counts = { drops: 0, sent: 0, right: 0, wrong: 0, full: 0, madeThings: 0 };
  const recent: {
    id: number;
    column: number;
    inlet: number;
    x: number;
    t0: number;
    cross: number;
  }[] = [];
  let fw = 1080;
  let nextId = 1;
  let nextRise = 1;
  let lastFrameSeen = Number.NEGATIVE_INFINITY;
  let aloneBin = ALONE_BIN_S * 0.5;
  const m = { x: 0, y: 0, vx: 0, vy: 0 };

  const model: PlantModel = {
    columns,
    inlets,
    jobs,
    rising,
    flights,
    park,
    pace,
    get fw() {
      return fw;
    },
    d,
    counts,
    recent,
    plantY: -9000,
    setColumns(cols) {
      const same =
        cols.length === columns.length &&
        cols.every((c, i) => c.kind === columns[i]!.kind && c.frame === columns[i]!.frame);
      if (same) return false;
      const layoutChanged =
        cols.length !== columns.length || cols.some((c, i) => c.kind !== columns[i]?.kind);
      columns.length = 0;
      columns.push(...cols);
      if (cols.some((c) => c.frame)) lastFrameSeen = Math.max(lastFrameSeen, now());
      if (!layoutChanged) return false;
      fw = frameWidth(cols.find((c) => c.frame)?.kind ?? cols[0]?.kind ?? "panel");
      const old = new Map(inlets.map((i) => [`${i.column}:${i.index}`, i]));
      inlets.length = 0;
      cols.forEach((c, ci) => {
        inletsFor(c.kind).forEach((u, i) => {
          const prev = old.get(`${ci}:${i}`);
          inlets.push({
            column: ci,
            index: i,
            u,
            x: (ci + u) * fw,
            next: prev?.next ?? 0.6 + ((ci * 0.37 + i * 0.9) % 2.4),
            turn: prev?.turn ?? ci + i,
          });
        });
      });
      // Items already in the chutes of an inlet that no longer exists simply finish falling.
      for (const j of jobs) {
        const now = inlets.find((i) => i.column === j.inlet.column && i.index === j.inlet.index);
        if (now) j.inlet = now;
      }
      return true;
    },
    chuteTime(inlet) {
      return o.chuteLength(inlet) / (CHUTE_D * d);
    },
    step(dt, clockMs, send) {
      const at = now();
      pace.step(dt);
      park.step(dt);
      const busy = model.busy(at);
      const alone = model.alone(at);
      const scale = busy ? 1 : ATTRACT_SCALE * 0.75;
      // New drops.
      for (const inlet of inlets) {
        inlet.next -= dt;
        if (inlet.next > 0) continue;
        inlet.next = (DROP_S / (1 + 0.8 * pace.value) / scale) * o.rng.range(0.85, 1.15);
        const col = columns[inlet.column];
        const load = loads.get(inlet.column);
        if (col?.frame && load && at - load.at < LOAD_TTL_MS) {
          // A frame that is full or has a queue in its funnel waits.
          if (load.m.n >= load.m.c - 2 || load.m.q >= 4) {
            inlet.next = 0.8;
            continue;
          }
        }
        if (jobs.length >= MAX_JOBS) continue;
        const inChute = jobs.filter((j) => j.inlet === inlet && j.fall === null).length;
        if (inChute >= 5) continue;
        const cls: ItemClass =
          o.variant === "simple" ? "any" : inlet.turn++ % 2 === 0 ? "obvious" : "tricky";
        jobs.push({
          id: nextId++,
          inlet,
          kind: picker.pick(cls),
          t: 0,
          fall: null,
          sent: false,
          a: o.rng.range(-3, 3),
          w: o.rng.range(-4, 4),
        });
        counts.drops++;
      }
      // Chutes, then the fall out of the tube.
      for (let i = jobs.length - 1; i >= 0; i--) {
        const j = jobs[i]!;
        if (j.fall === null) {
          j.t += dt;
          j.a += j.w * dt * 0.6;
          if (j.t < model.chuteTime(j.inlet)) continue;
          j.fall = {
            t0: clockMs,
            x0: j.inlet.x,
            y0: -FALL_FROM,
            vx0: 0,
            vy0: FALL_VY,
            g,
            tau: FALL_TAU,
          };
          const to = columns[j.inlet.column]?.frame;
          const cross = fallTimeTo(j.fall, 0) ?? 0;
          if (to) {
            send(to, {
              i: j.inlet.index,
              u: j.inlet.u * 1000,
              k: j.kind,
              id: j.id,
              t0: clockMs,
              y0: FALL_FROM,
              vy: FALL_VY,
              g,
              tau: FALL_TAU,
              a: Math.atan2(Math.sin(j.a), Math.cos(j.a)),
              w: j.w,
            });
            j.sent = true;
            counts.sent++;
          }
          recent.push({
            id: j.id,
            column: j.inlet.column,
            inlet: j.inlet.index,
            x: j.inlet.x,
            t0: clockMs,
            cross: clockMs + cross * 1000,
          });
          if (recent.length > MAX_RECENT) recent.shift();
        } else {
          j.a += j.w * dt;
          fallAt(j.fall, (clockMs - j.fall.t0) / 1000, m);
          // Gone once it is wholly below the screen.
          if (m.y > d) jobs.splice(i, 1);
        }
      }
      // Full bins rising to the plant.
      for (let i = rising.length - 1; i >= 0; i--) {
        const r = rising[i]!;
        const y = -((clockMs - r.t) / 1000) * r.v;
        if (r.arrived === null && y - r.h / 2 <= model.plantY) r.arrived = clockMs;
        if (r.arrived !== null && clockMs - r.arrived >= SWALLOW_S * 1000) {
          rising.splice(i, 1);
          if (r.product) {
            if (flights.length >= MAX_FLIGHTS) {
              const f = flights.shift();
              if (f) park.add(f.kind);
            }
            flights.push({ id: r.id, kind: r.product, x: r.x, age: 0 });
          }
        } else if (y < model.plantY - 20_000 || clockMs - r.t > 60_000) {
          rising.splice(i, 1);
        }
      }
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i]!;
        f.age += dt;
        if (f.age >= FLIGHT_S) {
          flights.splice(i, 1);
          park.add(f.kind);
          counts.madeThings++;
        }
      }
      // Alone, the screen sends up a full bin of its own now and then.
      if (alone && columns.length > 0) {
        aloneBin -= dt;
        if (aloneBin <= 0) {
          aloneBin = ALONE_BIN_S;
          const kinds: BinKind[] =
            o.variant === "simple"
              ? ["recycle", "rubbish"]
              : ["recycle", "compost", "dropoff", "recycle"];
          const kind = o.rng.pick(kinds);
          const product: ThingKind | null =
            kind === "compost"
              ? o.rng.pick(["tree", "flowers"] as const)
              : kind === "dropoff"
                ? "lamp"
                : kind === "recycle"
                  ? o.rng.pick(["bike", "bench", "jar", "book"] as const)
                  : null;
          const col = o.rng.int(columns.length);
          model.full(col, {
            b: BIN_KINDS.indexOf(kind),
            m: product ? THING_KINDS.indexOf(product) : -1,
            u: 500,
            w: 300,
            h: 430,
            t: clockMs + 400,
            v: 1050,
          });
        }
      }
    },
    load(column, msg, at) {
      loads.set(column, { m: msg, at });
      lastFrameSeen = at;
      if (loads.size > 64) {
        const first = loads.keys().next().value;
        if (first !== undefined) loads.delete(first);
      }
    },
    sorted(msg) {
      if (msg.r === 1) {
        pace.right();
        counts.right++;
      } else {
        pace.wrong();
        counts.wrong++;
      }
    },
    full(column, msg) {
      if (rising.length >= MAX_RISING) rising.shift();
      const kind = BIN_KINDS[msg.b] ?? "recycle";
      rising.push({
        id: nextRise++,
        kind,
        product: msg.m >= 0 ? (THING_KINDS[msg.m] ?? null) : null,
        x: (column + msg.u / 1000) * fw,
        w: (msg.w / 1000) * fw,
        h: msg.h,
        t: msg.t,
        v: msg.v,
        arrived: null,
        human: false,
      });
      counts.full++;
    },
    busy(at) {
      for (const [, l] of loads) if (at - l.at < LOAD_TTL_MS && l.m.a === 1) return true;
      return false;
    },
    alone(at) {
      return !columns.some((c) => c.frame) && at - lastFrameSeen > ALONE_MS;
    },
    clearPark() {
      park.clear();
      flights.length = 0;
    },
  };
  return model;
};
