/**
 * Where the eye looks, step by step: fixations with drift and microsaccades, saccades on the
 * main sequence with their undershoot and corrective saccades, big shifts made in steps, and
 * behaviours on top (a look at someone, a glance aside and back, a quick scan, a long look at
 * someone and a look away). Looking at a person is a run of fixations on their eyes, mouth and
 * body with small saccades between, so even a long look keeps moving. The eye never glides
 * slowly: it follows someone walking briskly by pursuit with catch-up saccades for a moment, and
 * otherwise keeps up with them by small saccades or looks elsewhere. Numbers are from
 * `physiology.ts`. Moods drift over minutes and set how often each behaviour happens and how long
 * fixations last, so the show never settles into a loop. Everything is deterministic from the
 * random stream and the steps it is given.
 */
import { DEG, type Vec3 } from "../../core/sphere";
import type { Rng, SphereInfo } from "../../core/types";
import { type Crowd, createCrowd, type Part, type Person } from "./crowd";
import { angle, bearing, carry, elevation, fromAngles, norm, nudge, slerp, towards } from "./geom";
import { createRoomLight, fieldLuminance, type RoomLight, WINDOWS } from "./light";
import {
  AMPLITUDE,
  AVERT,
  DWELL,
  FIXATION,
  MICRO,
  PUPIL,
  PURSUIT,
  SPLIT_ABOVE,
  STEP_MAX,
  STEP_MIN,
  TORSION,
  UNDERSHOOT,
} from "./physiology";
import { createPupil, type PupilInput } from "./pupil";
import { type Profile, saccadeProfile } from "./saccade";

export const MOODS = ["watchful", "nervous", "curious", "drowsy"] as const;
export type MoodName = (typeof MOODS)[number];
export type Pace = "furtive" | "calm";

interface MoodParams {
  /** Fixation length, times free viewing's (below 1 is like searching). */
  fix: number;
  /** Weights of the behaviours. */
  look: number;
  glance: number;
  scan: number;
  stare: number;
  /** A long look's length, times the usual. */
  dwell: number;
  /** Chances that a new look goes to the gallery, out across the room, up, or straight down. */
  level: number;
  far: number;
  up: number;
  down: number;
  /** Microsaccade rate and drift, times the usual. */
  micro: number;
  drift: number;
  /** Saccade speed, times the main sequence. */
  speed: number;
  /** Pupil widening, mm. */
  effort: number;
  /** Chance of following someone who walks off while the eye is on them. */
  follow: number;
  /** Chance of a glance back at someone just looked away from. */
  check: number;
  /** Chance of a glance at someone who has just come in. */
  notice: number;
}

const MOOD_PARAMS: Record<MoodName, MoodParams> = {
  watchful: {
    fix: 1.15,
    look: 1,
    glance: 0.35,
    scan: 0.35,
    stare: 0.18,
    dwell: 1,
    level: 0.12,
    far: 0.12,
    up: 0.02,
    down: 0.08,
    micro: 1,
    drift: 1,
    speed: 1,
    effort: 0.1,
    follow: 0.5,
    check: 0.2,
    notice: 0.25,
  },
  nervous: {
    fix: 0.83,
    look: 1,
    glance: 0.9,
    scan: 0.6,
    stare: 0.08,
    dwell: 0.7,
    level: 0.1,
    far: 0.2,
    up: 0.04,
    down: 0.05,
    micro: 1.3,
    drift: 1,
    speed: 1,
    effort: 0.3,
    follow: 0.3,
    check: 0.4,
    notice: 0.5,
  },
  curious: {
    fix: 1.3,
    look: 1,
    glance: 0.2,
    scan: 0.25,
    stare: 0.5,
    dwell: 1.4,
    level: 0.14,
    far: 0.08,
    up: 0.02,
    down: 0.12,
    micro: 0.9,
    drift: 1,
    speed: 1,
    effort: 0.2,
    follow: 0.7,
    check: 0.25,
    notice: 0.3,
  },
  drowsy: {
    fix: 1.7,
    look: 1,
    glance: 0.05,
    scan: 0.05,
    stare: 0.35,
    dwell: 1.2,
    level: 0.06,
    far: 0.1,
    up: 0.01,
    down: 0.2,
    micro: 0.6,
    drift: 2.5,
    speed: 0.88,
    effort: -0.4,
    follow: 0.25,
    check: 0.05,
    notice: 0.1,
  },
};

const PACE: Record<Pace, { fix: number; busy: number; chance: Record<MoodName, number> }> = {
  furtive: { fix: 1, busy: 1, chance: { watchful: 1, nervous: 1.2, curious: 0.8, drowsy: 0.35 } },
  calm: {
    fix: 1.6,
    busy: 0.45,
    chance: { watchful: 1, nervous: 0.15, curious: 1.2, drowsy: 0.7 },
  },
};

/** How long each mood lasts, seconds, and how long one takes to blend into the next. */
const MOOD_LENGTH: Record<MoodName, [number, number]> = {
  watchful: [120, 360],
  nervous: [60, 180],
  curious: [100, 300],
  drowsy: [90, 240],
};
const MOOD_BLEND = 30;

/** Elevations the eye keeps within: anything below, rarely up towards the ceiling. */
export const LOOK_LIMITS = { low: -90 * DEG, high: 38 * DEG };

/**
 * People on the gallery, level with the ball: how readily one catches the eye (someone a
 * metre or so out on the floor weighs about 0.8, someone right under the ball 1.6), and how much
 * likelier than a new look a long look is to go to one of them, times the mood's `level`.
 */
export const UPPER_LOOK = { weight: 0.35, stare: 1.5 };

const FACE: Part[] = ["eyes", "leftEye", "rightEye", "mouth"];

type Aim = { person: number; part: Part; last: Vec3 } | { dir: Vec3 };

interface FixStep {
  kind: "fix";
  aim: Aim;
  dur: number;
  stare?: boolean;
  /** Follow the person by pursuit if they walk. */
  follow?: boolean;
  /** Part of a run of fixations on one person. */
  dwell?: boolean;
  /** Catch-up saccades made so far on this aim. */
  caught?: number;
  /** Held on request: nothing interrupts it. */
  held?: boolean;
  /** Pursuit already under way: no latency or ramp after a catch-up saccade. */
  primed?: boolean;
}

type Step =
  | {
      kind: "saccade";
      aim: Aim;
      /** Land on the aim (no undershoot), or this share of the way when given. */
      exact?: boolean;
      cover?: number;
      corrective?: boolean;
      /** A small saccade from one part of a person to another. */
      refix?: boolean;
    }
  | FixStep
  | {
      kind: "dwell";
      person: number;
      dur: number;
      first: Part;
      stare: boolean;
      /** Keep to the face. */
      face?: boolean;
    };

export type Behaviour = "look" | "glance" | "scan" | "stare";

export type MotionEvent =
  | {
      kind: "saccade";
      amp: number;
      duration: number;
      peak: number;
      corrective: boolean;
      part: boolean;
      micro: boolean;
      refix: boolean;
    }
  | { kind: "fixation"; dur: number; stare: boolean }
  | { kind: "behaviour"; behaviour: Behaviour };

export interface MotionStats {
  saccades: number;
  micro: number;
  corrective: number;
  splits: number;
  refixations: number;
  catchUps: number;
  pursuits: number;
  notices: number;
  checks: number;
  returns: number;
  glances: number;
  scans: number;
  stares: number;
  looks: number;
  /** Turns to someone who touched, and to someone touching when choosing what to look at. */
  attends: number;
  focuses: number;
}

export interface Motion {
  /** Where the eye points now, a unit vector from the centre. */
  readonly gaze: Vec3;
  /** Twist about the line of sight, radians. */
  readonly torsion: number;
  /** Pupil diameter, mm. */
  readonly pupil: number;
  readonly mood: MoodName;
  readonly moods: Readonly<Record<MoodName, number>>;
  readonly activity: "saccade" | "micro" | "pursuit" | "fixation";
  readonly staring: boolean;
  /** Who it is looking at, or null when it looks at a place. */
  readonly target: number | null;
  readonly time: number;
  readonly stats: Readonly<MotionStats>;
  readonly crowd: Crowd;
  readonly light: RoomLight;
  /** The luminance the pupil answers now, cd/m². */
  readonly roomLight: number;
  step(dt: number): void;
  /** Look straight at `dir` and hold it for `seconds`, then carry on. */
  hold(dir: Vec3, seconds: number): void;
  setPace(p: Pace): void;
  /** People on the gallery, or nobody there. */
  setUpper(on: boolean): void;
  setSphere(s: SphereInfo): void;
  /**
   * Someone just touched: turn to them after `delay` seconds and take them in for a while. With
   * `flinch`, it first darts up and away (a touch on the eye itself).
   */
  attend(person: number, opts?: { delay?: number; flinch?: boolean }): void;
}

/**
 * Where an eye that isn't the sphere looks (the wall's): what it can turn to, its people, and
 * anyone who wants its attention now. Without one, the eye is the sphere's.
 */
export interface LookSpace {
  /** A direction kept within what the eye can turn to; unchanged when it already is. */
  limit(d: Vec3): Vec3;
  crowd(rng: Rng, sphere: SphereInfo, upper: boolean): Crowd;
  /** Someone touching for the eye to turn to, or null; `current` is who it is on. */
  focus?(current: number | null): Person | null;
}

/**
 * Looks at someone touching: the chance that a new look goes to them when someone is, how long
 * it lasts (lognormal median and spread, and the most, seconds), and how readily a visit to
 * them goes to their hands on the wall rather than their face.
 */
export const FOCUS = { chance: 0.75, median: 1.8, sigma: 0.35, most: 4, hands: 0.22 };

export interface MotionOptions {
  rng: Rng;
  sphere: SphereInfo;
  pace?: Pace;
  /** People on the gallery as well as the floor (on by default). */
  upper?: boolean;
  /**
   * Someone it first looks at, standing at `x`, `z` (metres from under the ball's centre) with
   * their eyes `eye` metres up, for `seconds`; otherwise it starts on someone in the crowd.
   */
  start?: { x: number; z: number; eye: number; seconds: number };
  onEvent?: (e: MotionEvent) => void;
  space?: LookSpace;
}

/**
 * A fixation's length in seconds: gamma distributed as in free viewing, stretched by `k` for
 * moods and pace, and never longer than a held fixation gets. The shape is a
 * whole number, so it is a sum of exponentials.
 */
export const fixationLength = (rng: Rng, k = 1): number => {
  let sum = 0;
  for (let i = 0; i < FIXATION.shape; i++) sum -= Math.log(Math.max(1e-12, rng.next()));
  const most = FIXATION.max * Math.min(k, FIXATION.stretch);
  return Math.max(FIXATION.min, Math.min(most, sum * FIXATION.scale * k));
};

export const createMotion = (opts: MotionOptions): Motion => {
  const rng = opts.rng;
  const crowdRng = rng.fork("crowd");
  const pupilRng = rng.fork("pupil");
  const light = createRoomLight(rng.fork("light"));
  let sphere = opts.sphere;
  let pace: Pace = opts.pace ?? "furtive";
  const space = opts.space;
  const crowd = space
    ? space.crowd(crowdRng, sphere, opts.upper ?? true)
    : createCrowd(crowdRng, sphere, opts.upper ?? true);
  const emit = opts.onEvent;

  const gauss = () => {
    const u = Math.max(1e-12, rng.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
  };
  const lognormal = (median: number, sigma: number) => median * Math.exp(sigma * gauss());

  // Moods: one at a time, each lasting minutes, blending into the next over half a minute.
  const moods: Record<MoodName, number> = { watchful: 0, nervous: 0, curious: 0, drowsy: 0 };
  const pickMood = (not: MoodName | null): MoodName => {
    const weights = MOODS.map((m) => (m === not ? 0 : PACE[pace].chance[m]));
    let r = rng.next() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < MOODS.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return MOODS[i]!;
    }
    return "watchful";
  };
  let mood: MoodName = pickMood(null);
  let nextMood: MoodName = mood;
  let moodLeft = rng.range(...MOOD_LENGTH[mood]);
  let moodBlend = 1;
  const updateMoods = (dt: number) => {
    if (moodBlend < 1) {
      moodBlend = Math.min(1, moodBlend + dt / MOOD_BLEND);
      if (moodBlend >= 1) mood = nextMood;
    } else {
      moodLeft -= dt;
      if (moodLeft <= 0) {
        nextMood = pickMood(mood);
        moodLeft = rng.range(...MOOD_LENGTH[nextMood]);
        moodBlend = 0;
      }
    }
    for (const m of MOODS) moods[m] = 0;
    const b = moodBlend < 1 ? moodBlend * moodBlend * (3 - 2 * moodBlend) : 1;
    moods[mood] += moodBlend < 1 ? 1 - b : 0;
    moods[nextMood] += moodBlend < 1 ? b : 1;
  };
  updateMoods(0);
  const blend = (key: keyof MoodParams): number => {
    let v = 0;
    for (const m of MOODS) v += moods[m] * MOOD_PARAMS[m][key];
    return v;
  };

  const stats: MotionStats = {
    saccades: 0,
    micro: 0,
    corrective: 0,
    splits: 0,
    refixations: 0,
    catchUps: 0,
    pursuits: 0,
    notices: 0,
    checks: 0,
    returns: 0,
    glances: 0,
    scans: 0,
    stares: 0,
    looks: 0,
    attends: 0,
    focuses: 0,
  };

  const limit = (d: Vec3): Vec3 => {
    if (space) return space.limit(d);
    const e = elevation(d);
    if (e <= LOOK_LIMITS.high && e >= LOOK_LIMITS.low) return d;
    return fromAngles(Math.max(LOOK_LIMITS.low, Math.min(LOOK_LIMITS.high, e)), bearing(d));
  };

  const resolve = (aim: Aim): Vec3 => {
    if ("dir" in aim) return aim.dir;
    const p = crowd.find(aim.person);
    if (p) aim.last = limit(crowd.direction(p, aim.part));
    return aim.last;
  };

  const personAim = (p: Person, part: Part = "eyes"): Aim => ({
    person: p.id,
    part,
    last: limit(crowd.direction(p, part)),
  });

  /** How fast someone crosses the eye's view, radians a second. */
  const sweep = (p: Person) => Math.hypot(p.vx, p.vz) / Math.max(0.5, crowd.distance(p));
  const brisk = (p: Person) => sweep(p) > PURSUIT.min * DEG;

  let t = 0;
  let base: Vec3 = (() => {
    const p = crowd.people[0];
    return p ? limit(crowd.direction(p)) : fromAngles(-50 * DEG, 0);
  })();
  let current: Aim = { dir: base };
  let previous: Aim = current;
  /** Make `aim` the one the eye is on, remembering the one before if it is someone else. */
  const setCurrent = (aim: Aim) => {
    const same =
      "person" in aim && "person" in current
        ? aim.person === current.person
        : "dir" in aim && "dir" in current && aim.dir === current.dir;
    if (!same) previous = current;
    current = aim;
  };
  const looked = new Map<number, number>();

  let move: {
    from: Vec3;
    to: Vec3;
    profile: Profile;
    t: number;
    micro: boolean;
  } | null = null;
  let fix: (FixStep & { t: number; lastTarget: Vec3; pursuing: boolean }) | null = null;
  /** A run of fixations on one person: who, until when, and where on them the eye is. */
  let dwell: { person: number; end: number; part: Part; stare: boolean; face: boolean } | null =
    null;
  const queue: Step[] = [];
  const MAX_QUEUE = 12;
  const push = (...steps: Step[]) => {
    for (const s of steps) if (queue.length < MAX_QUEUE) queue.push(s);
  };
  const pushFront = (...steps: Step[]) => {
    queue.unshift(...steps);
    if (queue.length > MAX_QUEUE) queue.length = MAX_QUEUE;
  };

  let torsion = 0;
  let staring = false;
  let arrivals = crowd.arrivals;
  let noticing: Person | null = null;
  /** Someone who touched, to turn to once `at` comes. */
  let summon: { person: number; at: number; flinch: boolean } | null = null;

  const fixDuration = () => fixationLength(rng, blend("fix") * PACE[pace].fix);

  /**
   * Someone to look at: nearer, under the ball, level with it and not looked at lately are
   * likelier. `near` keeps to people close to the ball or level with it and to `from` (where the
   * eye looks, by default), within `within` radians; `around` prefers people about that angle
   * away; `still` prefers people standing or sitting; `upper` keeps to the gallery. With
   * `around`, `within` or `upper`, it gives up (null) if nobody fits.
   */
  const pickPerson = (
    opts: {
      near?: boolean;
      still?: boolean;
      upper?: boolean;
      from?: Vec3;
      within?: number;
      around?: number;
      awayFrom?: Vec3;
      minAngle?: number;
    } = {},
  ) => {
    const now = t;
    let total = 0;
    const weights: number[] = [];
    const people = crowd.people;
    for (const p of people) {
      const d = Math.hypot(p.x, p.z);
      // Someone on the gallery weighs about as much as someone 7 m out on the floor; the
      // mood's `level` chance sends looks there on top of that.
      let w = p.upper ? UPPER_LOOK.weight : 1 / (1 + d / 4);
      if (!p.upper && d < sphere.radius) w *= 1.6;
      if (opts.upper && !p.upper) w = 0;
      if (p.child) w *= 1.2;
      const walking = p.vx !== 0 || p.vz !== 0;
      if (walking) w *= opts.still ? 0.25 : 1.1;
      const last = looked.get(p.id);
      if (last !== undefined) w *= 1 - Math.exp(-(now - last) / 5);
      const off = angle(opts.from ?? base, crowd.direction(p));
      if (opts.within !== undefined && off > opts.within) w = 0;
      if (opts.near) {
        if (!p.upper && d > sphere.radius * 2.5) w *= 0.05;
        w *= Math.exp(-off / (15 * DEG)) + 0.01;
      }
      if (opts.around !== undefined) {
        const z = (off - opts.around) / (0.25 * opts.around + 2 * DEG);
        w *= Math.exp(-z * z);
      }
      if (opts.awayFrom && opts.minAngle !== undefined) {
        if (angle(opts.awayFrom, crowd.direction(p)) < opts.minAngle) w *= 0.02;
      }
      if ("person" in current && current.person === p.id) w *= 0.05;
      if (p.pull !== undefined) w *= p.pull;
      weights.push(w);
      total += w;
    }
    const choosy = opts.around !== undefined || opts.within !== undefined || !!opts.upper;
    if (total <= (choosy ? 0.02 : 0)) return null;
    let r = rng.next() * total;
    for (let i = 0; i < people.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return people[i]!;
    }
    return people[people.length - 1] ?? null;
  };

  /** A bearing, usually within a quarter turn or so of where the eye looks now. */
  const nearbyBearing = () => bearing(base) + gauss() * 40 * DEG;
  const farAim = (): Aim => {
    // People look out of windows: aim at one if it's within reach, now and then.
    const b = bearing(base);
    if (rng.next() < AVERT.window) {
      for (const w of WINDOWS) {
        const db = Math.atan2(Math.sin(w - b), Math.cos(w - b));
        if (Math.abs(db) < 70 * DEG) {
          return { dir: limit(fromAngles(rng.range(4, 22) * DEG, w + rng.range(-9, 9) * DEG)) };
        }
      }
    }
    return { dir: limit(fromAngles(rng.range(-12, 4) * DEG, nearbyBearing())) };
  };
  const upAim = (): Aim => ({ dir: limit(fromAngles(rng.range(8, 30) * DEG, nearbyBearing())) });
  const downAim = (): Aim => ({
    dir: limit(fromAngles(rng.range(-90, -78) * DEG, nearbyBearing())),
  });

  /** How far between near and far someone is, 0 to 1: far people's bodies get more looks. */
  const farness = (p: Person) =>
    Math.max(0, Math.min(1, (crowd.distance(p) - DWELL.near) / (DWELL.far - DWELL.near)));

  /** Where on someone a look first lands: mostly the face, less so far off. */
  const firstPart = (p: Person): Part => {
    const f = farness(p);
    const face = DWELL.firstFaceNear + (DWELL.firstFaceFar - DWELL.firstFaceNear) * f;
    const r = rng.next();
    if (r < face) return rng.pick(FACE);
    if (r < face + (1 - face) * 0.7) return "chest";
    if (r < face + (1 - face) * 0.95) return rng.next() < 0.5 ? "leftHand" : "rightHand";
    return "feet";
  };

  /** The next place on someone, from the last: the eyes and mouth most, now and then the body. */
  const nextPart = (from: Part, face: boolean, p: Person): Part => {
    const r = rng.next();
    const onFace = FACE.includes(from);
    if (onFace) {
      const f = farness(p);
      let body = face ? 0 : DWELL.toBodyNear + (DWELL.toBodyFar - DWELL.toBodyNear) * f;
      // Someone touching draws looks to their hands on the wall.
      const touching = p.pull !== undefined && !face;
      if (touching) body = Math.max(body, FOCUS.hands);
      if (r < body) {
        const b = rng.next();
        if (touching) return b < 0.75 ? (b < 0.375 ? "leftHand" : "rightHand") : "chest";
        return b < 0.55 ? "chest" : b < 0.9 ? (b < 0.725 ? "leftHand" : "rightHand") : "feet";
      }
      const q = (r - body) / (1 - body);
      if (from === "mouth") return q < 0.8 ? (rng.next() < 0.5 ? "leftEye" : "rightEye") : "eyes";
      if (q < DWELL.toOtherEye) {
        if (from === "leftEye") return "rightEye";
        if (from === "rightEye") return "leftEye";
        return rng.next() < 0.5 ? "leftEye" : "rightEye";
      }
      if (q < DWELL.toOtherEye + DWELL.toMouth) return "mouth";
      return from === "eyes" ? (rng.next() < 0.5 ? "leftEye" : "rightEye") : "eyes";
    }
    // From the body, back up to the face mostly.
    if (r < 0.8) return rng.pick(FACE);
    return from === "chest" ? (rng.next() < 0.5 ? "leftHand" : "rightHand") : "chest";
  };

  /**
   * A new place to look. Now and then someone on the gallery, out across the room, up or
   * straight down. Otherwise usually a saccade of a few degrees, lognormal in size as in free
   * viewing, to someone about that far away or to whatever is there (mostly sideways, then up or
   * down, few oblique); and sometimes a long relocation to anyone.
   */
  const newAim = (awayFrom?: Vec3, minAngle = 0): Aim => {
    if (rng.next() < blend("level")) {
      const p = pickPerson({ upper: true, awayFrom, minAngle });
      if (p) return personAim(p, firstPart(p));
    }
    const r = rng.next();
    const far = blend("far");
    const up = blend("up");
    const down = blend("down");
    if (r < far) return farAim();
    if (r < far + up) return upAim();
    if (r < far + up + down) return downAim();
    if (minAngle > 0) {
      const p = pickPerson({ awayFrom, minAngle });
      return p ? personAim(p, firstPart(p)) : farAim();
    }
    if (rng.next() < AMPLITUDE.relocate) {
      return aimAround(rng.range(AMPLITUDE.relocateMin, AMPLITUDE.relocateMax) * DEG);
    }
    return aimAround(Math.min(40, lognormal(AMPLITUDE.median, AMPLITUDE.sigma)) * DEG);
  };

  /** Someone about `amp` radians from where the eye looks, or else whatever is there. */
  const aimAround = (amp: number): Aim => {
    const p = pickPerson({ around: amp });
    if (p) return personAim(p, firstPart(p));
    const kind = rng.next();
    const sign = rng.next() < 0.5 ? -1 : 1;
    const a = kind < 0.55 ? 0 : kind < 0.85 ? Math.PI / 2 : rng.range(0, 2 * Math.PI);
    return { dir: limit(nudge(base, sign * Math.cos(a) * amp, sign * Math.sin(a) * amp)) };
  };

  /**
   * A look away from someone for a second or two: to someone else, or down or to the side by
   * some degrees, with a small move partway through.
   */
  const avertSteps = (from: Vec3): Step[] => {
    const r = rng.next();
    const amp = rng.range(AVERT.min, AVERT.max) * DEG;
    const hold = rng.range(...AVERT.hold);
    if (r < AVERT.toPerson) {
      const p = pickPerson({ from, around: amp, still: true });
      if (p) return lookSteps(personAim(p, firstPart(p)), hold);
    }
    const side = rng.next() < 0.5 ? -1 : 1;
    const down = r < AVERT.toPerson + AVERT.down;
    const away: Aim = {
      dir: limit(
        down
          ? nudge(from, side * amp * 0.4, -amp * 0.9)
          : nudge(from, side * amp, rng.range(-0.25, 0.1) * amp),
      ),
    };
    const first = Math.min(hold - FIXATION.min, rng.range(0.4, 0.9));
    const on: Aim = {
      dir: limit(nudge(away.dir, rng.range(-4, 4) * DEG, rng.range(-3, 2) * DEG)),
    };
    return [
      { kind: "saccade", aim: away },
      { kind: "fix", aim: away, dur: first },
      { kind: "saccade", aim: on },
      { kind: "fix", aim: on, dur: Math.max(FIXATION.min, hold - first) },
    ];
  };

  const remember = (aim: Aim) => {
    if ("person" in aim) looked.set(aim.person, t);
    if (looked.size > 64) {
      for (const id of looked.keys()) if (!crowd.find(id)) looked.delete(id);
    }
  };

  /** Steps to look at `aim`: a run of fixations on someone, or one fixation on a place. */
  const lookSteps = (aim: Aim, dwellFor?: number): Step[] => {
    if ("person" in aim) {
      // Most looks are one fixation; some take in another part or two of the person.
      const n = rng.next() < DWELL.lookMore ? 1 + rng.int(2) : 0;
      let dur = 0;
      for (let i = 0; i <= n; i++) dur += fixDuration();
      return [
        { kind: "dwell", person: aim.person, dur: dwellFor ?? dur, first: aim.part, stare: false },
      ];
    }
    return [
      { kind: "saccade", aim },
      { kind: "fix", aim, dur: fixDuration() },
    ];
  };

  const plan = () => {
    // Someone touching the wall: mostly look at them, the latest most.
    const wants = space?.focus?.("person" in current ? current.person : null);
    if (wants && rng.next() < FOCUS.chance) {
      stats.focuses++;
      const len = Math.min(FOCUS.most, lognormal(FOCUS.median, FOCUS.sigma));
      push({
        kind: "dwell",
        person: wants.id,
        dur: Math.max(0.6, len),
        first: rng.next() < 0.85 ? rng.pick(FACE) : "chest",
        stare: false,
      });
      return;
    }
    const weights: [Behaviour, number][] = [
      ["look", blend("look")],
      ["glance", blend("glance") * PACE[pace].busy],
      ["scan", blend("scan") * PACE[pace].busy],
      ["stare", blend("stare")],
    ];
    let total = 0;
    for (const [, w] of weights) total += w;
    let r = rng.next() * total;
    let choice: Behaviour = "look";
    for (const [b, w] of weights) {
      r -= w;
      if (r <= 0) {
        choice = b;
        break;
      }
    }
    emit?.({ kind: "behaviour", behaviour: choice });
    if (choice === "glance") {
      stats.glances++;
      const here = current;
      // Aside by a good way, but within a glance.
      const aside = aimAround(rng.range(10, 30) * DEG);
      push(
        { kind: "saccade", aim: aside },
        { kind: "fix", aim: aside, dur: rng.range(FIXATION.min, 0.35) },
        ...("person" in here
          ? lookSteps(here)
          : [
              { kind: "saccade", aim: here } as Step,
              { kind: "fix", aim: here, dur: fixDuration() } as Step,
            ]),
      );
    } else if (choice === "scan") {
      stats.scans++;
      // A few quick looks from one person to the next nearby.
      const n = 2 + rng.int(3);
      let from = base;
      for (let i = 0; i < n; i++) {
        const p = pickPerson({ near: true, from, within: 40 * DEG });
        if (!p) break;
        const aim = personAim(p, rng.next() < 0.75 ? "eyes" : firstPart(p));
        const last = i === n - 1;
        push(
          { kind: "saccade", aim },
          { kind: "fix", aim, dur: last ? fixDuration() : rng.range(0.15, 0.32) },
        );
        from = resolve(aim);
      }
      if (from === base) push(...lookSteps(newAim()));
    } else if (choice === "stare") {
      stats.stares++;
      // Often someone level with the eye: the nearest thing to catching someone's eye.
      const across = rng.next() < blend("level") * UPPER_LOOK.stare;
      const p =
        (across ? pickPerson({ upper: true, still: true }) : null) ??
        pickPerson({ near: true, still: true });
      if (!p) {
        push(...lookSteps(downAim()));
        return;
      }
      const len = Math.min(
        DWELL.stareMax,
        lognormal(DWELL.stareMedian, DWELL.stareSigma) * blend("dwell") * PACE[pace].fix,
      );
      push({
        kind: "dwell",
        person: p.id,
        dur: Math.max(1, len),
        first: rng.next() < 0.8 ? rng.pick(["leftEye", "rightEye", "eyes"] as Part[]) : "mouth",
        stare: true,
      });
      // Then a look away, and now and then a quick check back before looking off again.
      const where = crowd.direction(p);
      push(...avertSteps(where));
      if (rng.next() < blend("check") * PACE[pace].busy) {
        stats.checks++;
        const back = personAim(p, "eyes");
        push(
          { kind: "saccade", aim: back },
          { kind: "fix", aim: back, dur: rng.range(0.15, 0.4) },
          ...avertSteps(where),
        );
      }
    } else {
      stats.looks++;
      // Now and then back to whoever it looked at before.
      const back = "person" in previous ? crowd.find(previous.person) : undefined;
      if (back && rng.next() < DWELL.back) {
        stats.returns++;
        push(...lookSteps(personAim(back, firstPart(back))));
      } else push(...lookSteps(newAim()));
    }
  };

  const startMove = (
    to: Vec3,
    micro: boolean,
    info: { corrective?: boolean; part?: boolean; refix?: boolean },
  ) => {
    const amp = angle(base, to) / DEG;
    const speed = blend("speed");
    const profile = saccadeProfile(amp, speed);
    move = { from: base, to, profile, t: 0, micro };
    stats.saccades++;
    if (micro) stats.micro++;
    if (info.corrective) stats.corrective++;
    if (info.part) stats.splits++;
    if (info.refix) stats.refixations++;
    emit?.({
      kind: "saccade",
      amp,
      duration: profile.duration,
      peak: profile.peak,
      corrective: !!info.corrective,
      part: !!info.part,
      micro,
      refix: !!info.refix,
    });
  };

  const startSaccade = (step: Extract<Step, { kind: "saccade" }>) => {
    const goal = resolve(step.aim);
    const total = angle(base, goal) / DEG;
    if (total < 0.2) {
      setCurrent(step.aim);
      return false;
    }
    if (total > SPLIT_ABOVE) {
      // No head to turn: make the shift in steps, with a short pause between. A step keeps no
      // higher than its ends, where the great circle would arc up over the top.
      let part = slerp(base, goal, rng.range(STEP_MIN, STEP_MAX) / total);
      const top = Math.max(elevation(base), elevation(goal));
      if (elevation(part) > top) part = fromAngles(top, bearing(part));
      pushFront(
        { kind: "fix", aim: { dir: part }, dur: rng.range(0.08, 0.18) },
        { kind: "saccade", aim: step.aim },
      );
      startMove(part, false, { part: true });
      return true;
    }
    let to = step.cover === undefined ? goal : slerp(base, goal, step.cover);
    if (!step.exact && total > UNDERSHOOT.from) {
      const short = Math.max(0, Math.min(0.25, UNDERSHOOT.mean + UNDERSHOOT.spread * gauss()));
      to = slerp(base, goal, 1 - short);
      if (angle(to, goal) / DEG > UNDERSHOOT.correctFrom) {
        // A corrective saccade after a short pause, which itself leaves a little for the
        // fixation's microsaccades.
        pushFront(
          {
            kind: "fix",
            aim: { dir: to },
            dur: rng.range(UNDERSHOOT.latencyMin, UNDERSHOOT.latencyMax),
          },
          {
            kind: "saccade",
            aim: step.aim,
            exact: true,
            cover: rng.range(UNDERSHOOT.coverMin, UNDERSHOOT.coverMax),
            corrective: true,
          },
        );
      }
    }
    setCurrent(step.aim);
    remember(step.aim);
    startMove(to, false, step);
    return true;
  };

  /** The next fixation of a run on one person, or the end of the run. */
  const continueDwell = () => {
    if (!dwell) return;
    const p = crowd.find(dwell.person);
    const left = dwell.end - t;
    if (!p || left < FIXATION.min) {
      dwell = null;
      return;
    }
    if (brisk(p)) {
      // They're walking off: follow them a moment, or let them go.
      const run = dwell;
      dwell = null;
      if (rng.next() < blend("follow")) {
        const aim = personAim(p, run.part === "feet" ? "chest" : "eyes");
        pushFront(
          { kind: "saccade", aim, exact: true },
          {
            kind: "fix",
            aim,
            dur: Math.min(left, rng.range(PURSUIT.minTime, PURSUIT.maxTime)),
            stare: run.stare,
            follow: true,
          },
        );
      }
      return;
    }
    const part = nextPart(dwell.part, dwell.face, p);
    let dur = fixationLength(rng, blend("fix") * PACE[pace].fix * DWELL.fixScale);
    if (left - dur < FIXATION.min) dur = left;
    dwell.part = part;
    const aim = personAim(p, part);
    pushFront(
      { kind: "saccade", aim, refix: true },
      { kind: "fix", aim, dur, stare: dwell.stare, dwell: true, follow: rng.next() < 0.5 },
    );
  };

  const next = () => {
    for (let guard = 0; guard < 8; guard++) {
      if (queue.length === 0) {
        if (dwell) continueDwell();
        if (queue.length === 0) plan();
      }
      const step = queue.shift();
      if (!step) return;
      if (step.kind === "dwell") {
        const p = crowd.find(step.person);
        if (!p) continue;
        dwell = {
          person: p.id,
          end: t + step.dur,
          part: step.first,
          stare: step.stare,
          face: !!step.face,
        };
        if (step.stare) pupil.pulse(PUPIL.contact * rng.range(0.6, 1.2));
        const aim = personAim(p, step.first);
        const first = Math.min(
          step.dur,
          fixationLength(rng, blend("fix") * PACE[pace].fix * DWELL.fixScale),
        );
        pushFront(
          { kind: "saccade", aim },
          { kind: "fix", aim, dur: first, stare: step.stare, dwell: true, follow: true },
        );
        continue;
      }
      if (step.kind === "saccade") {
        if (startSaccade(step)) return;
      } else {
        const target = resolve(step.aim);
        fix = { ...step, t: 0, lastTarget: target, pursuing: false };
        staring = !!step.stare;
        emit?.({ kind: "fixation", dur: step.dur, stare: staring });
        return;
      }
    }
  };

  /** End the fixation now and go on with whatever comes next. */
  const endFixation = () => {
    const was = fix;
    fix = null;
    staring = false;
    if (was?.dwell && dwell) continueDwell();
    next();
  };

  const stepFixation = (dt: number) => {
    if (!fix) return;
    const target = resolve(fix.aim);
    const from = fix.lastTarget;
    fix.lastTarget = target;
    const err = angle(base, target);
    const person = "person" in fix.aim ? crowd.find(fix.aim.person) : undefined;
    const fast = person ? brisk(person) : false;
    // Smooth pursuit only of someone walking briskly, a little slower than they go, after its
    // latency. Slower movement is kept up with by saccades.
    const pursue = !!fix.follow && fast && (!!fix.primed || fix.t > PURSUIT.latency);
    if (pursue && !fix.pursuing) {
      fix.pursuing = true;
      stats.pursuits++;
    }
    if (!pursue) fix.pursuing = false;
    if (move) return;
    if (pursue) {
      const ramp = fix.primed ? 1 : Math.min(1, (fix.t - PURSUIT.latency) / PURSUIT.ramp);
      base = carry(base, from, target, PURSUIT.gain * ramp);
    }
    // Drift: a random walk.
    const sigma = Math.sqrt(2 * MICRO.drift * blend("drift") * dt) * DEG;
    base = nudge(base, sigma * gauss(), sigma * gauss());
    if (space) base = limit(base);
    // Not in the pause before a corrective saccade, which would then correct the wrong error.
    const correcting = queue[0]?.kind === "saccade" && !!queue[0].corrective;
    if (noticing && fix.t > 0.1 && !fix.held && !dwell?.face && !correcting) {
      // Someone new came in: a quick look at them, then carry on.
      const p = noticing;
      noticing = null;
      if (crowd.find(p.id)) {
        stats.notices++;
        dwell = null;
        pupil.pulse(PUPIL.orient * rng.range(0.6, 1.2));
        const aim = personAim(p, rng.next() < 0.7 ? "eyes" : "chest");
        pushFront({ kind: "saccade", aim }, { kind: "fix", aim, dur: rng.range(0.2, 0.5) });
        fix = null;
        staring = false;
        next();
        return;
      }
    }
    const limitErr = (pursue ? PURSUIT.catchUp : PURSUIT.keepUp) * DEG;
    // Pursuit catches up as often as it needs; otherwise only someone moving slowly is kept up
    // with by saccades, a few times, and someone walking briskly is let go.
    const canCatch = pursue || (!fast && (fix.caught ?? 0) < PURSUIT.catchUps);
    if (err > limitErr && fix.t < fix.dur && canCatch) {
      // Fallen behind, or they moved: a catch-up saccade, then on as before.
      stats.catchUps++;
      pushFront(
        { kind: "saccade", aim: fix.aim, exact: true },
        {
          ...fix,
          dur: Math.max(FIXATION.min, fix.dur - fix.t),
          caught: (fix.caught ?? 0) + 1,
          primed: pursue,
        },
      );
      fix = null;
      staring = false;
      next();
      return;
    }
    if (err > limitErr && fix.t < fix.dur && "person" in fix.aim) {
      // They've walked on and the eye lets them go.
      dwell = null;
      endFixation();
      return;
    }
    if (rng.next() < MICRO.rate * blend("micro") * dt) {
      const amp = Math.min(MICRO.max, lognormal(MICRO.median, MICRO.sigma)) * DEG;
      let to: Vec3;
      if (err > Math.max(0.2 * DEG, amp * 0.5) && rng.next() < 0.8) {
        to = towards(base, target, Math.min(MICRO.max * DEG, err * rng.range(0.8, 1.05)));
      } else {
        const a = rng.range(0, 2 * Math.PI);
        to = nudge(base, amp * Math.cos(a), amp * Math.sin(a));
      }
      startMove(limit(to), true, {});
    }
    if (fix && fix.t >= fix.dur) endFixation();
  };

  const stepMove = (dt: number) => {
    if (!move) return;
    move.t += dt;
    const p = move.profile;
    base = limit(slerp(move.from, move.to, p.at(move.t)));
    if (move.t >= p.duration) {
      base = move.to;
      move = null;
      if (!fix) next();
    }
  };

  let luminance = fieldLuminance(base, light.lamps, light.day);
  // The pupil sums light over half a second, so the field is sampled at 15 Hz.
  let lightClock = 0;

  const pupilInput = (): PupilInput => {
    let near = 0;
    if (fix && "person" in fix.aim) {
      const p = crowd.find(fix.aim.person);
      if (p) near = PUPIL.nearMax * smooth(4, 1, crowd.distance(p) - sphere.radius);
    }
    return {
      luminance,
      effort: blend("effort") + (staring ? PUPIL.staring : 0),
      near,
      drowsy: moods.drowsy,
    };
  };

  const pupil = createPupil(pupilRng, pupilInput());

  /** Turn to whoever touched: drop what it was doing and take them in, face first. */
  const startSummon = () => {
    const s = summon;
    summon = null;
    const p = s ? crowd.find(s.person) : undefined;
    if (!s || !p) return;
    queue.length = 0;
    fix = null;
    dwell = null;
    noticing = null;
    staring = false;
    stats.attends++;
    pupil.pulse(PUPIL.orient * rng.range(0.8, 1.3));
    if (s.flinch) {
      // Startled: a dart up and aside, then round to them.
      const away: Aim = {
        dir: limit(nudge(base, rng.range(-8, 8) * DEG, rng.range(14, 24) * DEG)),
      };
      push(
        { kind: "saccade", aim: away, exact: true },
        { kind: "fix", aim: away, dur: rng.range(0.18, 0.3) },
      );
    }
    const len = Math.min(FOCUS.most, lognormal(FOCUS.median * 1.2, FOCUS.sigma));
    push({
      kind: "dwell",
      person: p.id,
      dur: Math.max(1, len),
      first: rng.next() < 0.8 ? "eyes" : rng.pick(FACE),
      stare: true,
      face: true,
    });
    next();
  };

  if (opts.start) {
    const s = opts.start;
    const p = crowd.place(s.x, s.z, s.eye, s.seconds + 4);
    base = limit(crowd.direction(p));
    current = personAim(p);
    push({ kind: "dwell", person: p.id, dur: s.seconds, first: "eyes", stare: true, face: true });
  }
  next();

  return {
    get gaze() {
      return base;
    },
    get torsion() {
      return torsion;
    },
    get pupil() {
      return pupil.size;
    },
    get mood() {
      return moodBlend < 0.5 ? mood : nextMood;
    },
    moods,
    get activity() {
      if (move) return move.micro ? "micro" : "saccade";
      return fix?.pursuing ? "pursuit" : "fixation";
    },
    get staring() {
      return staring;
    },
    get target() {
      return "person" in current ? current.person : null;
    },
    get time() {
      return t;
    },
    stats,
    crowd,
    light,
    get roomLight() {
      return luminance;
    },
    step(dt) {
      t += dt;
      updateMoods(dt);
      crowd.step(dt);
      light.step(dt);
      if (crowd.arrivals !== arrivals) {
        arrivals = crowd.arrivals;
        const newest = crowd.people[crowd.people.length - 1];
        if (newest && !noticing && rng.next() < blend("notice") * PACE[pace].busy) {
          noticing = newest;
        }
      }
      const a = Math.exp(-dt / TORSION.tau);
      torsion = torsion * a + TORSION.spread * DEG * Math.sqrt(1 - a * a) * gauss();
      // A fixation's clock runs through its microsaccades too.
      if (fix) fix.t += dt;
      if (summon && t >= summon.at && !move) startSummon();
      if (move) stepMove(dt);
      else if (fix) stepFixation(dt);
      else next();
      lightClock += dt;
      if (lightClock >= 1 / 15) {
        lightClock = 0;
        luminance = fieldLuminance(base, light.lamps, light.day);
      }
      pupil.step(dt, pupilInput());
    },
    hold(dir, seconds) {
      queue.length = 0;
      fix = null;
      dwell = null;
      noticing = null;
      staring = false;
      const aim: Aim = { dir: limit(norm(dir)) };
      push(
        { kind: "saccade", aim, exact: true },
        { kind: "fix", aim, dur: Math.max(0.1, seconds), stare: true, held: true },
      );
      if (!move) next();
    },
    setPace(p) {
      pace = p;
    },
    setUpper(on) {
      crowd.setUpper(on);
    },
    setSphere(s) {
      sphere = s;
      crowd.setSphere(s);
    },
    attend(person, o = {}) {
      summon = { person, at: t + Math.max(0, o.delay ?? 0.2), flinch: !!o.flinch };
    },
  };
};

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
