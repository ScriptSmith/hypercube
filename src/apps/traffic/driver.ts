/**
 * Runs a ring in step with the shared clock: ring time runs TIME_SCALE times real time, and
 * step k of the ring belongs to clock ms `base + k * STEP_MS`. Whoever holds a driver (a solo
 * frame, a bank's host, each wall in versus) advances it to the clock every frame, applies
 * brakes and settings, and can describe it as a snapshot. A new host builds its driver from the
 * last snapshot it heard, so the same cars carry on.
 */
import { clampSettings, countRange, type Settings, TIME_SCALE } from "./config";
import {
  BRAKE,
  brakeCar,
  type Car,
  createRing,
  DT,
  LIMITS,
  MAX_CARS,
  type Ring,
  setCount,
  setSmartEvery,
  SMART_EVERY,
  stepRing,
} from "./model";
import { type DelayPlan, FLAG, type SnapMsg, type WireCar } from "./wire";

/** Clock ms per ring step. */
export const STEP_MS = (DT * 1000) / TIME_SCALE;
/** The most steps one frame may take to catch up; further behind, the ring skips ahead. */
const MAX_CATCHUP = Math.round(1000 / STEP_MS);
const MAX_FORWARD_MS = 120_000;

export interface Driver {
  readonly ring: Ring;
  readonly settings: Settings;
  /** The starting count, which the cars buttons range around. */
  readonly baseCount: number;
  /** Clock ms of the ring's current state. */
  readonly t: number;
  /** Step the ring up to clock ms `now`, at most a second's steps a call. Returns steps taken. */
  advance(now: number): number;
  /** Step all the way to clock ms `now` (at most MAX_FORWARD_MS of it), however far that is. */
  fastForward(now: number): void;
  /**
   * Brake car `id` for `ms` real ms from now: "started" if it wasn't braking already, "held" if
   * it was, null if there is no such car.
   */
  brake(id: number, ms: number, mark?: 1 | 2, decel?: number): "started" | "held" | null;
  set(next: Partial<Settings>): void;
  /** Cars past the counting line in the last minute of clock time (less if younger). */
  flow(): number;
  /** Change the ring's length, keeping each car at the same fraction round it. */
  resize(length: number): void;
  snapshot(delay: DelayPlan, attract: boolean, out?: WireCar[]): SnapMsg;
}

export interface DriverSpec {
  length: number;
  baseCount: number;
  settings: Settings;
  noise: boolean;
  seed: number;
  /** Clock ms of step 0. */
  start: number;
  /** Where the counting line is, metres. */
  line?: number;
}

const flagsOf = (c: Car): number =>
  (c.mark !== 0 || c.a < -2.2 ? FLAG.brake : 0) |
  (c.smart ? FLAG.smart : 0) |
  (c.mark === 2 ? FLAG.ghost : 0) |
  (c.mark === 1 ? FLAG.touched : 0);

const FLOW_SAMPLES = 61;

const wrap = (ring: Ring, settings: Settings, baseCount: number, start: number): Driver => {
  let base = start;
  let current = settings;
  // Once a second of clock time: how many cars had passed the line, for the last minute's flow.
  const passed = new Float64Array(FLOW_SAMPLES).fill(-1);
  let sampleAt = Number.NEGATIVE_INFINITY;
  let head = 0;
  const sample = () => {
    const t = base + ring.step * STEP_MS;
    if (t - sampleAt < 1000) return;
    sampleAt = t;
    head = (head + 1) % FLOW_SAMPLES;
    passed[head] = ring.passed;
  };

  return {
    get ring() {
      return ring;
    },
    get settings() {
      return current;
    },
    baseCount,
    get t() {
      return base + ring.step * STEP_MS;
    },
    advance(now) {
      const target = Math.floor((now - base) / STEP_MS);
      const behind = target - ring.step;
      // The clock jumped (first sync, or a page held up): skip rather than race to catch up.
      if (behind > MAX_CATCHUP * 3 || behind < -MAX_CATCHUP) {
        base = now - ring.step * STEP_MS;
        return 0;
      }
      const n = Math.min(MAX_CATCHUP, Math.max(0, behind));
      for (let i = 0; i < n; i++) stepRing(ring);
      sample();
      return n;
    },
    flow() {
      let oldest = ring.passed;
      for (let k = 1; k < FLOW_SAMPLES; k++) {
        const v = passed[(head + k) % FLOW_SAMPLES]!;
        if (v >= 0) {
          oldest = v;
          break;
        }
      }
      return ring.passed - oldest;
    },
    fastForward(now) {
      const target = Math.min(
        Math.floor((now - base) / STEP_MS),
        ring.step + Math.round(MAX_FORWARD_MS / STEP_MS),
      );
      while (ring.step < target) stepRing(ring);
      if (Math.floor((now - base) / STEP_MS) > ring.step) base = now - ring.step * STEP_MS;
    },
    brake(id, ms, mark = 1, decel = BRAKE) {
      const car = ring.cars.find((c) => c.id === id);
      if (!car) return null;
      const was = car.mark !== 0 && car.brakeUntil > ring.t;
      brakeCar(ring, id, ring.t + (Math.max(0, ms) / 1000) * TIME_SCALE, mark, decel);
      return was ? "held" : "started";
    },
    set(next) {
      const merged = clampSettings({ ...current, ...next }, baseCount);
      if (merged.count !== ring.cars.length) setCount(ring, merged.count);
      merged.count = ring.cars.length;
      if (merged.limit !== current.limit) ring.limit = LIMITS[merged.limit]!;
      if (merged.smart !== current.smart) setSmartEvery(ring, SMART_EVERY[merged.smart]!);
      current = merged;
    },
    resize(length) {
      if (length <= 0 || Math.abs(length - ring.length) < 1e-6) return;
      const k = length / ring.length;
      for (const c of ring.cars) c.x = Math.min(length - 1e-6, c.x * k);
      ring.line *= k;
      ring.length = length;
    },
    snapshot(delay, attract, out = []) {
      out.length = 0;
      for (const c of ring.cars) out.push({ id: c.id, x: c.x, v: c.v, flags: flagsOf(c) });
      return {
        t: base + ring.step * STEP_MS,
        length: ring.length,
        delay,
        count: current.count,
        limit: current.limit,
        smart: current.smart,
        attract,
        cars: out,
      };
    },
  };
};

export const createDriver = (spec: DriverSpec): Driver => {
  const settings = clampSettings(spec.settings, spec.baseCount);
  const ring = createRing({
    length: spec.length,
    count: settings.count,
    seed: spec.seed,
    noise: spec.noise,
    limit: LIMITS[settings.limit],
    smartEvery: SMART_EVERY[settings.smart],
    ...(spec.line === undefined ? {} : { line: spec.line }),
  });
  return wrap(ring, { ...settings, count: ring.cars.length }, spec.baseCount, spec.start);
};

/**
 * A driver that carries on from a snapshot: the same cars at the same places and speeds, the
 * same settings, at the snapshot's clock time.
 */
export const adoptDriver = (
  snap: SnapMsg,
  opts: { baseCount: number; noise: boolean; seed: number; line?: number },
): Driver => {
  const cars: Car[] = snap.cars.slice(0, MAX_CARS).map((w) => ({
    id: w.id,
    x: Math.max(0, Math.min(snap.length - 1e-6, w.x)),
    v: w.v,
    a: 0,
    smart: (w.flags & FLAG.smart) !== 0,
    noise: 0,
    u: w.v,
    brakeUntil: -1,
    mark: 0,
  }));
  cars.sort((p, q) => p.x - q.x);
  const settings = clampSettings(
    { count: cars.length, limit: snap.limit, smart: snap.smart },
    opts.baseCount,
  );
  const ring: Ring = {
    length: snap.length,
    cars,
    t: 0,
    step: 0,
    seed: opts.seed | 0,
    noise: opts.noise,
    limit: LIMITS[settings.limit]!,
    smartEvery: SMART_EVERY[settings.smart]!,
    nextId: cars.reduce((m, c) => Math.max(m, c.id + 1), 0) % 256,
    line: opts.line ?? 0,
    passed: 0,
  };
  // Keep the smart flags the old host had; the share is the same, so assignments agree.
  return wrap(ring, { ...settings, count: cars.length }, opts.baseCount, snap.t);
};

/** Cars for a ring of `length` metres at `spacing` metres each, within the controls' range. */
export const startCount = (length: number, spacing: number): number => {
  const n = Math.max(3, Math.min(MAX_CARS, Math.round(length / spacing)));
  return Math.min(n, countRange(n).hi);
};

/** Apply an adult control: `key` 0 cars (`value` -1 or +1 steps), 1 speed limit, 2 smart cars. */
export const applyCtl = (d: Driver, key: 0 | 1 | 2, value: number): void => {
  const s = d.settings;
  if (key === 0) d.set({ count: s.count + value * countRange(d.baseCount).step });
  else if (key === 1) d.set({ limit: value });
  else d.set({ smart: value });
};
