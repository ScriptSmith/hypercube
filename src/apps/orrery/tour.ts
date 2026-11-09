/**
 * The attract tour: what the state is at any moment on the shared clock, so every frame of a
 * bank shows the same thing without messages. Pure.
 *
 * Seasons: from today the year passes in about 90 s, the axis held steady. It stops at each
 * solstice while the Earth turns through a day ("Summer in Brisbane", "Winter in Brisbane"), and
 * once a year the tilt goes to 0 from an equinox to the next solstice ("No tilt, no seasons")
 * and comes back. A year later it is today again, so the tour loops without a jump.
 *
 * Moon: one eclipse season after another, from the start of this year: about three weeks round
 * the new or full Moon nearest the season's middle (an eclipse), a month of phases, then the
 * months to the next season pass quickly. Throughout, the clock follows the Moon so it is always
 * at its highest in the ground view, and Brisbane faces it in the space view.
 */
import {
  dateOf,
  elongation,
  isEclipse,
  moonLatitude,
  nearestSyzygy,
  nextSeason,
  nextSunAt,
  NODE_RATE,
  SYNODIC,
  timeOf,
  timeOfMs,
  YEAR,
} from "./astro";
import type { Variant } from "./config";
import type { Sky } from "./sky";

export type Hand = "wheel" | "tilt" | "dial" | null;

export interface TourFrame {
  day: number;
  hour: number;
  tilt: number;
  caption: string | null;
  /** The control a ghost hand works now. */
  hand: Hand;
}

const smooth = (u: number) => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};

// ---- Seasons ---------------------------------------------------------------------------------

/** Seconds for the year's motion, for a stop at a solstice and for a change of tilt. */
export const YEAR_S = 90;
export const HOLD_S = 12;
export const TILT_S = 4;

type SegKind = "move" | "hold" | "tilt";

interface Seg {
  kind: SegKind;
  /** Seconds into the loop. */
  start: number;
  dur: number;
  /** The moments (model time) it runs between. */
  day0: number;
  day1: number;
  tilt0: number;
  tilt1: number;
  /** For holds: summer or winter in Brisbane. */
  which?: "dec" | "jun";
  flat: boolean;
}

export interface SeasonsPlan {
  segs: Seg[];
  length: number;
  /** Today, noon, where the loop starts and ends. */
  start: number;
  /** The tilt the tour uses and the one it shows briefly. */
  base: number;
  other: number;
}

/** The loop for a given day (today), worked out once a day. */
export const seasonsPlan = (today: number, base: number): SeasonsPlan => {
  const d0 = Math.floor(today) + 0.5;
  const end = d0 + YEAR;
  const other = base < 1 ? 23.44 : 0;
  const dec = nextSunAt(d0, 270);
  const jun = nextSunAt(d0, 90);
  // The no-tilt stretch: the first equinox-to-solstice quarter wholly inside the year.
  const mar = nextSunAt(d0, 0);
  const sep = nextSunAt(d0, 180);
  const pairs: [number, number][] = [
    [mar, mar < jun ? jun : nextSunAt(mar, 90)],
    [sep, sep < dec ? dec : nextSunAt(sep, 270)],
  ];
  const inside = pairs.filter(([, s]) => s < end).sort((a, b) => a[0] - b[0]);
  const [flatFrom, flatTo] = inside[0] ?? pairs[0]!;
  const events = [
    { at: dec, kind: "dec" as const },
    { at: jun, kind: "jun" as const },
    { at: flatFrom, kind: "down" as const },
  ].sort((a, b) => a.at - b.at);
  const v = YEAR / YEAR_S;
  const segs: Seg[] = [];
  let t = 0;
  let day = d0;
  let tilt = base;
  const push = (s: Omit<Seg, "start">) => {
    segs.push({ ...s, start: t });
    t += s.dur;
  };
  for (const e of events) {
    if (e.at > day) {
      push({
        kind: "move",
        dur: (e.at - day) / v,
        day0: day,
        day1: e.at,
        tilt0: tilt,
        tilt1: tilt,
        flat: tilt === other,
      });
      day = e.at;
    }
    if (e.kind === "down") {
      push({
        kind: "tilt",
        dur: TILT_S,
        day0: day,
        day1: day,
        tilt0: base,
        tilt1: other,
        flat: true,
      });
      tilt = other;
      continue;
    }
    if (Math.abs(e.at - flatTo) < 1e-6 && tilt === other) {
      push({
        kind: "tilt",
        dur: TILT_S,
        day0: day,
        day1: day,
        tilt0: other,
        tilt1: base,
        flat: true,
      });
      tilt = base;
    }
    // The Earth turns through a day: the clock goes round from noon to noon.
    push({
      kind: "hold",
      dur: HOLD_S,
      day0: day,
      day1: day + 1,
      tilt0: tilt,
      tilt1: tilt,
      which: e.kind,
      flat: false,
    });
    day += 1;
  }
  push({
    kind: "move",
    dur: Math.max(0, (end - day) / v),
    day0: day,
    day1: end,
    tilt0: tilt,
    tilt1: tilt,
    flat: false,
  });
  return { segs, length: t, start: d0, base, other };
};

/** Early January, when the Earth is nearest the Sun. */
const nearPerihelion = (day: number): boolean => {
  const d = dateOf(day);
  return (d.month === 11 && d.day >= 26) || (d.month === 0 && d.day <= 16);
};

export const seasonsAt = (plan: SeasonsPlan, s: number): TourFrame => {
  const w = ((s % plan.length) + plan.length) % plan.length;
  const seg = plan.segs.find((x) => w < x.start + x.dur) ?? plan.segs[plan.segs.length - 1]!;
  const u = seg.dur > 0 ? (w - seg.start) / seg.dur : 1;
  // Normally the tour's tilt is the Earth's and the short stretch shows none; tilted to 0 by
  // the operator, it is the other way round.
  const tilted = plan.base >= 1;
  if (seg.kind === "hold") {
    // Noon to noon: on through the evening, midnight (the date turns) and the morning.
    const h = 12 + 24 * smooth(u);
    const hour = h % 24;
    const summer = seg.which === "dec";
    return {
      day: seg.day0 + (h - 12) / 24 - hour / 24,
      hour,
      tilt: seg.tilt0,
      caption: !tilted
        ? "No tilt, no seasons"
        : summer
          ? "Summer in Brisbane: long days, Sun high"
          : "Winter in Brisbane: short days, Sun low",
      hand: "dial",
    };
  }
  if (seg.kind === "tilt") {
    return {
      day: seg.day0 - 0.5,
      hour: 12,
      tilt: seg.tilt0 + (seg.tilt1 - seg.tilt0) * smooth(u),
      caption: tilted ? "No tilt, no seasons" : "Tilted like the Earth: seasons",
      hand: "tilt",
    };
  }
  const t = seg.day0 + (seg.day1 - seg.day0) * u;
  let caption = "The axis always points the same way";
  if (seg.flat) caption = tilted ? "No tilt, no seasons" : "Tilted like the Earth: seasons";
  else if (nearPerihelion(t) && tilted) caption = "Nearest the Sun in January: Brisbane's summer";
  return { day: t - 0.5, hour: 12, tilt: seg.tilt0, caption, hand: "wheel" };
};

// ---- Moon ------------------------------------------------------------------------------------

export const WINDOW_S = 19;
export const WINDOW_DAYS = 19;
export const MONTH_S = 40;
export const FAST_S = 6;
export const MOON_LOOP_S = WINDOW_S + MONTH_S + FAST_S;
/** Seasons visited before the tour starts again from this year's first. */
export const MOON_SEASONS = 24;
const HALF_ECLIPSE_YEAR = 180 / (360 / YEAR + NODE_RATE);

/** The new or full Moon nearest the middle of an eclipse season. */
const seasonSyzygy = (centre: number): number => {
  const n = nearestSyzygy(centre, "new");
  const f = nearestSyzygy(centre, "full");
  return Math.abs(n - centre) <= Math.abs(f - centre) ? n : f;
};

export interface MoonPlan {
  /** The first season's middle, from the start of the year. */
  first: number;
  base: number;
}

export const moonPlan = (today: number, base: number): MoonPlan => ({
  first: nextSeason(timeOf(dateOf(today).year, 0, 1)),
  base,
});

const centreOf = (plan: MoonPlan, k: number) => {
  const guess = plan.first + k * HALF_ECLIPSE_YEAR;
  return nextSeason(guess - 20);
};

/** The moment (model time) the tour is at, `s` seconds into loop k. */
const moonMoment = (plan: MoonPlan, k: number, s: number): number => {
  const sz = seasonSyzygy(centreOf(plan, k));
  const a = sz - 4;
  if (s < WINDOW_S) return a + (s / WINDOW_S) * WINDOW_DAYS;
  const b = a + WINDOW_DAYS;
  if (s < WINDOW_S + MONTH_S) return b + ((s - WINDOW_S) / MONTH_S) * SYNODIC;
  const c = b + SYNODIC;
  const next = seasonSyzygy(centreOf(plan, k + 1)) - 4;
  return c + (next - c) * smooth((s - WINDOW_S - MONTH_S) / FAST_S);
};

const syzygyCaption = (t: number): string | null => {
  for (const kind of ["new", "full"] as const) {
    const s = nearestSyzygy(t, kind);
    if (Math.abs(s - t) > 1.6) continue;
    const solar = kind === "new";
    if (isEclipse(s, solar ? "solar" : "lunar")) {
      return solar
        ? "Sun, Moon and Earth in line: an eclipse of the Sun"
        : "Sun, Earth and Moon in line: an eclipse of the Moon";
    }
    const above = moonLatitude(s) > 0;
    return solar
      ? `The Moon's shadow passes ${above ? "above" : "below"} the Earth`
      : `The Moon passes ${above ? "above" : "below"} the Earth's shadow`;
  }
  return null;
};

export const moonAt = (plan: MoonPlan, loop: number, s: number): TourFrame => {
  const k = ((loop % MOON_SEASONS) + MOON_SEASONS) % MOON_SEASONS;
  const t = moonMoment(plan, k, s);
  // The clock keeps the Moon on the meridian: it crosses about 12 h after the Sun, plus
  // 24 h for every turn it makes away from the Sun.
  const hour = (((12 + elongation(t) / 15) % 24) + 24) % 24;
  const day = t - hour / 24;
  let caption: string | null;
  const fast = s >= WINDOW_S + MONTH_S;
  if (fast) caption = "Months pass";
  else {
    caption = syzygyCaption(t);
    if (!caption) {
      const e = elongation(t);
      if (s < WINDOW_S) caption = "Twice a year the Moon's orbit lines up with the Sun";
      else if (e < 60) caption = "Half the Moon is always lit by the Sun";
      else if (e < 150) caption = "From Brisbane a growing Moon is lit on the left";
      else if (e < 210) caption = "Full Moon: we see all of the lit half";
      else if (e < 300) caption = "Shrinking, it is lit on the right";
      else caption = "Most months there is no eclipse";
    }
  }
  return { day, hour, tilt: plan.base, caption, hand: fast ? null : "wheel" };
};

// ---- Either ----------------------------------------------------------------------------------

export interface Tour {
  at(clockMs: number): TourFrame;
}

/**
 * The tour for a variant. Plans are made from the day on the shared clock in Brisbane, so frames
 * agree; they change once a day.
 */
export const createTour = (variant: Variant, base: number): Tour => {
  let planDay = Number.NaN;
  let seasons: SeasonsPlan | null = null;
  let moon: MoonPlan | null = null;
  const plan = (clockMs: number) => {
    const today = Math.floor(timeOfMs(clockMs));
    if (today !== planDay) {
      planDay = today;
      if (variant === "seasons") seasons = seasonsPlan(today, base);
      else moon = moonPlan(today, base);
    }
  };
  return {
    at(clockMs) {
      plan(clockMs);
      const s = clockMs / 1000;
      if (variant === "seasons" && seasons) return seasonsAt(seasons, s);
      const loop = Math.floor(s / MOON_LOOP_S);
      return moonAt(moon!, loop, s - loop * MOON_LOOP_S);
    },
  };
};

export const tourSky = (f: TourFrame, flat = false, speed = 0): Sky => ({
  day: f.day,
  hour: f.hour,
  tilt: f.tilt,
  flat,
  speed,
});
