/**
 * The shared state and who moves it. Pure, driven by explicit times: `now` is local ms (for how
 * long things last), `clock` the shared clock's ms (for the tour, so frames agree).
 *
 * - tour: nobody is touching; the state is the tour's at the clock.
 * - manual: someone moved a control. Controls make claims on four knobs (the time, the tilt, the
 *   flat orbit and the speed). For each knob the latest touch wins among the claims still held
 *   or just let go, and a person always beats a bot. In the Moon variant time passes at the
 *   chosen speed while nobody holds the time.
 * - ease: untouched for a while (or reset), it eases back onto the tour.
 *
 * Every frame keeps one. A solo frame's, and a bank leader's, decide; a bank follower's copies
 * what the leader says (`adopt`) and decides itself only while it hears no leader.
 */
import { SYNODIC, YEAR } from "./astro";
import { MOON_SPEEDS, TIMING, type Variant } from "./config";
import type { Sky } from "./sky";
import { createTour, type TourFrame } from "./tour";

export type KnobId = "time" | "tilt" | "flat" | "speed";
export const KNOBS: readonly KnobId[] = ["time", "tilt", "flat", "speed"];

/** A held claim not heard of for this long counts as let go (holds repeat every 0.5 s). */
export const CLAIM_TTL_MS = 1500;
/** A claim let go keeps its say this long, so an older hold elsewhere doesn't snap back. */
export const CLAIM_GRACE_MS = 2500;
const MAX_CLAIMS = 32;

export interface Claim {
  from: string;
  knob: KnobId;
  /** time: day and hour; tilt: degrees; flat: 0 or 1; speed: 0 to 2. `b` is 0 unless time. */
  a: number;
  b: number;
  held: boolean;
  /** Shared clock ms the touch began: the latest touch wins. */
  since: number;
  /** Local ms it was heard. */
  at: number;
  human: boolean;
}

export type Mode = "tour" | "manual" | "ease";

/** What a leader tells its frames. */
export interface Shared {
  mode: Mode;
  sky: Sky;
  /** Ms since the last claim. */
  quiet: number;
}

export interface Keeper {
  readonly mode: Mode;
  /** Local ms of the last claim from a person, or -Infinity. */
  readonly lastHuman: number;
  /** Local ms of the last claim from anyone. */
  readonly lastInput: number;
  hear(c: Claim): void;
  /** Drop a frame's claims at once (it left). */
  forget(from: string): void;
  /** The knob's winning claim now, if any. */
  winner(knob: KnobId, now: number): Claim | null;
  step(now: number, clock: number, dt: number): void;
  sky(clock: number): Sky;
  /** The tour's frame while touring (its caption and ghost hand), else null. */
  tour(clock: number): TourFrame | null;
  reset(now: number, clock: number): void;
  adopt(s: Shared, now: number): void;
  shared(now: number, clock: number): Shared;
}

const smooth = (u: number) => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};

/** The change from a to b, wrapped into (-p/2, p/2]. */
const wrapDiff = (a: number, b: number, p: number) => {
  const d = (((b - a) % p) + p) % p;
  return d > p / 2 ? d - p : d;
};

export const blendSky = (from: Sky, to: Sky, u: number, variant: Variant): Sky => {
  const k = smooth(u);
  // Seasons repeat every year, phases every month: blend the short way round.
  const period = variant === "seasons" ? YEAR : SYNODIC;
  const dDay = wrapDiff(from.day, to.day, period);
  const dHour = wrapDiff(from.hour, to.hour, 24);
  const hour = (((from.hour + dHour * k) % 24) + 24) % 24;
  return {
    day: from.day + dDay * k,
    hour,
    tilt: from.tilt + (to.tilt - from.tilt) * k,
    flat: k < 0.5 ? from.flat : to.flat,
    speed: from.speed,
  };
};

export const createKeeper = (o: {
  variant: Variant;
  /** The tilt the tour uses. */
  tilt: number;
  /** Speed setting after a reset. */
  speed: number;
}): Keeper => {
  const tourOf = createTour(o.variant, o.tilt);
  const claims = new Map<KnobId, Map<string, Claim>>(KNOBS.map((k) => [k, new Map()]));
  let mode: Mode = "tour";
  let man: Sky = { day: 0, hour: 12, tilt: o.tilt, flat: false, speed: o.speed };
  let easeFrom: Sky = man;
  let easeAt = 0;
  let lastInput = Number.NEGATIVE_INFINITY;
  let lastHuman = Number.NEGATIVE_INFINITY;
  let speed = o.speed;

  const fromTour = (clock: number): Sky => {
    const f = tourOf.at(clock);
    return { day: f.day, hour: f.hour, tilt: f.tilt, flat: false, speed };
  };

  const current = (now: number, clock: number): Sky => {
    if (mode === "manual") return { ...man, speed };
    if (mode === "ease") {
      const u = (now - easeAt) / TIMING.ease;
      return blendSky(easeFrom, fromTour(clock), u, o.variant);
    }
    return fromTour(clock);
  };

  // `sky()` has no `now`; the last step's is close enough for easing.
  let lastNow = 0;

  // A hold whose repeats stop counts as let go when it expires.
  const live = (c: Claim, now: number) =>
    now - (c.held ? c.at + CLAIM_TTL_MS : c.at) <= CLAIM_GRACE_MS;
  const better = (a: Claim, b: Claim) => {
    if (a.human !== b.human) return a.human;
    if (a.since !== b.since) return a.since > b.since;
    return a.at > b.at;
  };
  const winner = (knob: KnobId, now: number): Claim | null => {
    const map = claims.get(knob)!;
    let best: Claim | null = null;
    for (const [from, c] of map) {
      if (!live(c, now)) {
        map.delete(from);
        continue;
      }
      if (!best || better(c, best)) best = c;
    }
    return best;
  };

  const startEase = (now: number, clock: number) => {
    easeFrom = current(now, clock);
    easeAt = now;
    mode = "ease";
  };

  return {
    get mode() {
      return mode;
    },
    get lastHuman() {
      return lastHuman;
    },
    get lastInput() {
      return lastInput;
    },
    hear(c) {
      const map = claims.get(c.knob);
      if (!map) return;
      map.delete(c.from);
      map.set(c.from, { ...c });
      while (map.size > MAX_CLAIMS) {
        const first = map.keys().next().value;
        if (first === undefined) break;
        map.delete(first);
      }
    },
    forget(from) {
      for (const map of claims.values()) map.delete(from);
    },
    winner,
    step(now, clock, dt) {
      lastNow = now;
      let claimed = false;
      let timeHeld = false;
      for (const knob of KNOBS) {
        const w = winner(knob, now);
        if (!w) continue;
        if (mode !== "manual") {
          man = current(now, clock);
          mode = "manual";
        }
        claimed = true;
        if (w.at > lastInput) lastInput = w.at;
        if (w.human && w.at > lastHuman) lastHuman = w.at;
        if (knob === "time") {
          man.day = w.a;
          man.hour = w.b;
          if (w.held) timeHeld = true;
        } else if (knob === "tilt") man.tilt = w.a;
        else if (knob === "flat") man.flat = w.a >= 0.5;
        else speed = Math.round(w.a);
      }
      if (mode === "manual" && o.variant === "moon" && !timeHeld) {
        man.day += (MOON_SPEEDS[speed] ?? 0) * dt;
      }
      if (mode === "manual" && !claimed && now - lastInput > TIMING.hold) startEase(now, clock);
      if (mode === "ease" && now - easeAt >= TIMING.ease) mode = "tour";
    },
    sky(clock) {
      return current(lastNow, clock);
    },
    tour(clock) {
      return mode === "tour" ? tourOf.at(clock) : null;
    },
    reset(now, clock) {
      for (const map of claims.values()) map.clear();
      speed = o.speed;
      man.speed = speed;
      lastInput = Number.NEGATIVE_INFINITY;
      lastHuman = Number.NEGATIVE_INFINITY;
      if (mode !== "tour") startEase(now, clock);
    },
    adopt(s, now) {
      lastNow = now;
      speed = s.sky.speed;
      lastInput = now - Math.max(0, s.quiet);
      if (s.mode === "tour") {
        mode = "tour";
        return;
      }
      // A leader's ease is copied as manual values that ease from here if the leader goes.
      man = { ...s.sky };
      mode = "manual";
      if (s.mode === "ease") {
        easeFrom = { ...s.sky };
        easeAt = now;
        mode = "ease";
      }
    },
    shared(now, clock) {
      return {
        mode,
        sky: current(now, clock),
        quiet: Number.isFinite(lastInput) ? Math.max(0, Math.round(now - lastInput)) : 9_999_999,
      };
    },
  };
};
