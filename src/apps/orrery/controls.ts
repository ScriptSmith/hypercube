/**
 * Fingers on the controls, turned into claims on the shared state's knobs. Pure apart from the
 * callbacks; venue px, ms and the shared clock throughout.
 *
 * - The wheel: turning it anticlockwise moves time on, a year a turn (seasons) or a month a turn
 *   (moon); a flick coasts and slows.
 * - The dial: turning it moves the clock, a day a turn, noon at the top and clockwise like a
 *   clock; a tap sets the hour tapped.
 * - The sliders: the knob goes where the finger is on the track. The tilt sticks at the Earth's
 *   23.4°, at 0° and at 90°; the place at Brisbane, the equator and the poles.
 * - The spin button turns the Earth through a day; Reset eases the tilt back.
 *
 * The latest finger on a control leads it; an earlier one waits until it lifts.
 */
import { EARTH_TILT, SYNODIC, YEAR } from "./astro";
import { BRISBANE, TIMING, type Variant } from "./config";
import type { KnobId } from "./keeper";
import { type Hit, hitAt, type Layout, sliderU } from "./layout";
import type { LocalClaim } from "./link";
import { addHours, type Sky } from "./sky";

export const TAU = Math.PI * 2;
/** A press shorter than this, moving less than TAP_MOVE, is a tap. */
export const TAP_MS = 350;
export const TAP_MOVE = 30;
/** Coasting: speed decays with this time constant (s), plus a little constant friction. */
export const COAST_TAU = 1.2;
export const COAST_FRICTION = 0.25;
/** A flick faster than this (rad/s) coasts; slower than STOP it stops. */
export const COAST_MIN = 1.2;
const COAST_STOP = 0.05;
const MAX_SPIN = 14;
const FLICK_MS = 90;

/** A finger's angle about a centre, anticlockwise from the right, in [0, 2π). */
export const angleAbout = (cx: number, cy: number, x: number, y: number): number => {
  const a = Math.atan2(cy - y, x - cx);
  return a < 0 ? a + TAU : a;
};

/** The signed change from a to b the short way round. */
export const shortest = (a: number, b: number): number => {
  const d = (((b - a) % TAU) + TAU) % TAU;
  return d > Math.PI ? d - TAU : d;
};

/** The dial's hour for a finger's angle: noon at the top, clockwise. */
export const dialHour = (cx: number, cy: number, x: number, y: number): number => {
  const a = Math.atan2(x - cx, cy - y);
  return (((12 + (a / TAU) * 24) % 24) + 24) % 24;
};

/** The dial hand's angle (radians, clockwise from the top) for an hour. */
export const dialAngle = (hour: number): number => ((hour - 12) / 24) * TAU;

/** Days per turn of the wheel. */
export const wheelDays = (variant: Variant): number => (variant === "moon" ? SYNODIC : YEAR);

const TILT_STICK = 1.5;
const PLACE_STICK = 2.5;

export const tiltOf = (u: number): number => {
  const t = 90 * u;
  for (const s of [0, EARTH_TILT, 90]) if (Math.abs(t - s) < TILT_STICK) return s;
  return Math.round(t * 10) / 10;
};

export const tiltU = (tilt: number): number => tilt / 90;

/** The place slider runs from the North Pole at the left to the South Pole at the right. */
export const latOf = (u: number, marks: readonly number[] = [BRISBANE.lat]): number => {
  const lat = 90 - 180 * u;
  for (const s of [90, 0, -90, ...marks]) if (Math.abs(lat - s) < PLACE_STICK) return s;
  return Math.round(lat);
};

export const latU = (lat: number): number => (90 - lat) / 180;

interface Touch {
  id: number;
  hit: Hit;
  person: boolean;
  downAt: number;
  since: number;
  x0: number;
  y0: number;
  /** Where it was last. */
  x: number;
  moved: number;
  last: number | null;
  samples: { t: number; a: number }[];
  total: number;
}

export interface ControlsDeps {
  layout(): Layout;
  variant: Variant;
  /** The state as this frame shows it. */
  sky(): Sky;
  clock(): number;
  /** The tilt Reset goes back to. */
  baseTilt: number;
  emit(c: LocalClaim): void;
  /** A finger moved a place slider. */
  onPlace(index: number, lat: number): void;
  /** Places' latitudes now, for their sliders' sticking points. */
  placeMarks(index: number): readonly number[];
  /** A finger took hold of something; `person` is false for bots. */
  onTouch?(person: boolean): void;
}

export interface Controls {
  /** Hit test and take hold; false if the finger isn't on a control. */
  down(id: number, x: number, y: number, t: number, person: boolean): boolean;
  move(id: number, x: number, y: number, t: number): void;
  up(id: number, t: number): void;
  cancel(id: number, t: number): void;
  /** Coasting, spinning and easing the tilt back. */
  step(t: number, dt: number): void;
  spin(t: number, person: boolean): void;
  resetTilt(t: number, person: boolean): void;
  /** Lift everything (idle, resize). */
  clear(t: number): void;
  /** Which knobs a finger, a coast or an animation holds now. */
  holding(knob: KnobId): boolean;
  /** The leading finger's control, by kind. */
  leads(kind: Hit["kind"]): boolean;
  readonly coasting: boolean;
  readonly spinning: boolean;
  readonly count: number;
  /** True while a person (not a bot) holds anything. */
  readonly personDown: boolean;
}

export const createControls = (d: ControlsDeps): Controls => {
  const touches = new Map<number, Touch>();
  /** The leading touch for each control key. */
  const leader = new Map<string, number>();
  let coast: { omega: number; person: boolean; since: number } | null = null;
  let spinning: {
    from: { day: number; hour: number };
    at: number;
    person: boolean;
    since: number;
  } | null = null;
  let tilting: { from: number; at: number; person: boolean; since: number } | null = null;
  const held = new Set<KnobId>();
  /**
   * The time as the controls hold it. Moves arrive faster than the shown state catches up, so
   * they add up here, from the shown time when something first takes hold of it.
   */
  let work: { day: number; hour: number } | null = null;

  const keyOf = (h: Hit) => (h.kind === "place" ? `place${h.index}` : h.kind);

  const claim = (
    knob: KnobId,
    a: number,
    b: number,
    isHeld: boolean,
    since: number,
    person: boolean,
  ) => {
    if (isHeld) held.add(knob);
    else held.delete(knob);
    d.emit({ knob, a, b, held: isHeld, since, bot: !person });
  };

  const timeWork = () => {
    if (!work) {
      const s = d.sky();
      work = { day: s.day, hour: s.hour };
    }
    return work;
  };

  const timeHeldElsewhere = () =>
    leader.has("wheel") || leader.has("dial") || coast !== null || spinning !== null;

  /** Something let go of the time: if nothing else holds it, say so. */
  const releaseTime = (since: number, person: boolean) => {
    if (timeHeldElsewhere()) return;
    const w = timeWork();
    claim("time", w.day, w.hour, false, since, person);
    work = null;
  };

  const timeBy = (days: number, since: number, person: boolean) => {
    const w = timeWork();
    w.day += days;
    claim("time", w.day, w.hour, true, since, person);
  };

  const hoursBy = (hours: number, since: number, person: boolean) => {
    const n = addHours(timeWork(), hours);
    work = n;
    claim("time", n.day, n.hour, true, since, person);
  };

  const fingerAngle = (tc: Touch, x: number, y: number): number | null => {
    const l = d.layout();
    const c = tc.hit.kind === "wheel" ? l.wheel : tc.hit.kind === "dial" ? l.dial : null;
    if (!c) return null;
    return Math.hypot(x - c.x, y - c.y) < c.r * 0.15 ? null : angleAbout(c.x, c.y, x, y);
  };

  const slide = (tc: Touch, x: number) => {
    const l = d.layout();
    if (tc.hit.kind === "tilt" && l.tilt) {
      claim("tilt", tiltOf(sliderU(l.tilt, x)), 0, true, tc.since, tc.person);
    } else if (tc.hit.kind === "place") {
      const sl = l.places[tc.hit.index];
      if (sl) d.onPlace(tc.hit.index, latOf(sliderU(sl, x), d.placeMarks(tc.hit.index)));
    }
  };

  const lead = (tc: Touch, x: number, y: number, t: number) => {
    leader.set(keyOf(tc.hit), tc.id);
    tc.last = fingerAngle(tc, x, y);
    tc.samples = [{ t, a: 0 }];
    tc.total = 0;
    if (tc.hit.kind === "wheel" || tc.hit.kind === "dial") {
      coast = null;
      spinning = null;
      timeBy(0, tc.since, tc.person);
    }
    if (tc.hit.kind === "tilt") tilting = null;
    slide(tc, x);
  };

  const apply = (tc: Touch, x: number, y: number, t: number) => {
    if (tc.hit.kind === "tilt" || tc.hit.kind === "place") {
      slide(tc, x);
      return;
    }
    const a = fingerAngle(tc, x, y);
    if (a === null) {
      tc.last = null;
      return;
    }
    if (tc.last !== null) {
      const da = shortest(tc.last, a);
      tc.total += da;
      if (tc.hit.kind === "wheel") {
        timeBy((da / TAU) * wheelDays(d.variant), tc.since, tc.person);
        tc.samples.push({ t, a: tc.total });
        while (tc.samples.length > 2 && t - tc.samples[0]!.t > FLICK_MS) tc.samples.shift();
      } else {
        // Clockwise moves the clock on: a whole turn is a day.
        hoursBy((-da / TAU) * 24, tc.since, tc.person);
      }
    }
    tc.last = a;
  };

  const flick = (tc: Touch, t: number): number => {
    const sm = tc.samples;
    if (sm.length < 2) return 0;
    const first = sm[0]!;
    const last = sm[sm.length - 1]!;
    // A finger that stopped before lifting has no flick.
    if (t - last.t > 60) return 0;
    const dt = (last.t - first.t) / 1000;
    return dt > 0.01 ? (last.a - first.a) / dt : 0;
  };

  const end = (id: number, t: number, cancelled: boolean) => {
    const tc = touches.get(id);
    if (!tc) return;
    touches.delete(id);
    const key = keyOf(tc.hit);
    if (leader.get(key) !== id) return;
    leader.delete(key);
    const tap = !cancelled && t - tc.downAt < TAP_MS && tc.moved < TAP_MOVE;
    if (tc.hit.kind === "dial" && tap) {
      const l = d.layout();
      if (l.dial) {
        const w = timeWork();
        let dh = (((dialHour(l.dial.x, l.dial.y, tc.x0, tc.y0) - w.hour) % 24) + 24) % 24;
        if (dh > 12) dh -= 24;
        work = addHours(w, dh);
      }
    }
    // An earlier finger on the same control leads again.
    let next: Touch | null = null;
    for (const o of touches.values()) {
      if (keyOf(o.hit) === key && (!next || o.downAt > next.downAt)) next = o;
    }
    if (next) {
      lead(next, next.x0, next.y0, t);
      return;
    }
    if (tc.hit.kind === "wheel") {
      const w = cancelled ? 0 : flick(tc, t);
      if (Math.abs(w) >= COAST_MIN) {
        coast = {
          omega: Math.max(-MAX_SPIN, Math.min(MAX_SPIN, w)),
          person: tc.person,
          since: tc.since,
        };
        return;
      }
      releaseTime(tc.since, tc.person);
    } else if (tc.hit.kind === "dial") {
      releaseTime(tc.since, tc.person);
    } else if (tc.hit.kind === "tilt") {
      const l = d.layout();
      const tilt = l.tilt ? tiltOf(sliderU(l.tilt, tc.x)) : d.sky().tilt;
      claim("tilt", tilt, 0, false, tc.since, tc.person);
    }
  };

  const stopCoast = () => {
    if (!coast) return;
    const c = coast;
    coast = null;
    releaseTime(c.since, c.person);
  };

  return {
    down(id, x, y, t, person) {
      const hit = hitAt(d.layout(), x, y, false);
      if (!hit || hit.kind === "space") return false;
      const tc: Touch = {
        id,
        hit,
        person,
        downAt: t,
        since: d.clock(),
        x0: x,
        y0: y,
        x,
        moved: 0,
        last: null,
        samples: [],
        total: 0,
      };
      touches.set(id, tc);
      lead(tc, x, y, t);
      d.onTouch?.(person);
      return true;
    },
    move(id, x, y, t) {
      const tc = touches.get(id);
      if (!tc) return;
      tc.moved = Math.max(tc.moved, Math.hypot(x - tc.x0, y - tc.y0));
      tc.x = x;
      if (leader.get(keyOf(tc.hit)) === id) apply(tc, x, y, t);
    },
    up(id, t) {
      end(id, t, false);
    },
    cancel(id, t) {
      end(id, t, true);
    },
    step(t, dt) {
      if (coast) {
        timeBy(((coast.omega * dt) / TAU) * wheelDays(d.variant), coast.since, coast.person);
        const sign = Math.sign(coast.omega);
        coast.omega = coast.omega * Math.exp(-dt / COAST_TAU) - sign * COAST_FRICTION * dt;
        if (Math.sign(coast.omega) !== sign || Math.abs(coast.omega) < COAST_STOP) stopCoast();
      }
      if (spinning) {
        const u = Math.min(1, (t - spinning.at) / TIMING.spin);
        const n = addHours(spinning.from, 24 * u * u * (3 - 2 * u));
        work = n;
        const sp = spinning;
        if (u < 1) claim("time", n.day, n.hour, true, sp.since, sp.person);
        else {
          spinning = null;
          releaseTime(sp.since, sp.person);
        }
      }
      if (tilting) {
        const u = Math.min(1, (t - tilting.at) / TIMING.resetTilt);
        const v = tilting.from + (d.baseTilt - tilting.from) * u * u * (3 - 2 * u);
        const tl = tilting;
        if (u >= 1) tilting = null;
        claim("tilt", u >= 1 ? d.baseTilt : v, 0, u < 1, tl.since, tl.person);
      }
    },
    spin(t, person) {
      // A finger on the wheel or dial keeps the time; otherwise the Earth turns once.
      if (leader.has("wheel") || leader.has("dial")) return;
      coast = null;
      const w = timeWork();
      spinning = { from: { day: w.day, hour: w.hour }, at: t, person, since: d.clock() };
      d.onTouch?.(person);
    },
    resetTilt(t, person) {
      if (leader.has("tilt")) return;
      tilting = { from: d.sky().tilt, at: t, person, since: d.clock() };
      d.onTouch?.(person);
    },
    clear(t) {
      for (const id of touches.keys()) end(id, t, true);
      touches.clear();
      leader.clear();
      const sp = spinning;
      spinning = null;
      stopCoast();
      if (sp) releaseTime(sp.since, sp.person);
      if (tilting) {
        claim("tilt", d.sky().tilt, 0, false, tilting.since, tilting.person);
        tilting = null;
      }
      held.clear();
      work = null;
    },
    holding: (knob) => held.has(knob),
    leads: (kind) => {
      for (const key of leader.keys()) if (key === kind || key.startsWith(kind)) return true;
      return false;
    },
    get coasting() {
      return coast !== null;
    },
    get spinning() {
      return spinning !== null;
    },
    get count() {
      return touches.size;
    },
    get personDown() {
      for (const tc of touches.values()) if (tc.person) return true;
      return false;
    },
  };
};
