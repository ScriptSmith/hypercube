/**
 * Numbers for the eye's look and motion, from published measurements. The motion and the shaders
 * read them from here, and the unit tests check the models against them.
 */

/** Sizes in millimetres for an adult eye. */
export const EYE_MM = {
  /** Half the eyeball's diameter; the corneal apex is on this sphere. */
  radius: 12,
  /** Half the visible iris (white-to-white) diameter. */
  limbus: 5.85,
  /** Front surface of the cornea. */
  corneaRadius: 7.8,
  /** Width of the grey limbal band outside the iris's edge. */
  limbusWidth: 1,
  pupilMin: 2,
  pupilMax: 8,
};

/** Half-angle of the iris disc seen from the eye's centre, painted so it looks right head on. */
export const IRIS_ANGLE = Math.asin(EYE_MM.limbus / EYE_MM.radius);

/**
 * The pupil sits about 0.37 mm nasal and 0.07 mm above the limbus's centre and
 * moves down as it widens. How far it moves isn't given, so it is taken as 0.15 mm from 3 to
 * 7 mm across (Uncertain). The eye's +x is taken as nasal.
 */
export const PUPIL_CENTRE = { nasal: 0.37, up: 0.07, downPerMm: 0.0375, fromMm: 3 };

/** Where the pupil's centre sits from the limbus's centre, mm (x nasal, y up), at a size. */
export const pupilOffset = (diameter: number): [number, number] => [
  PUPIL_CENTRE.nasal,
  PUPIL_CENTRE.up - PUPIL_CENTRE.downPerMm * (diameter - PUPIL_CENTRE.fromMm),
];

/** Width of the limbal band as an angle from the centre. */
export const LIMBUS_BAND = EYE_MM.limbusWidth / EYE_MM.radius;

/** The cornea's centre of curvature on the gaze axis, mm from the eye's centre. */
export const CORNEA_CENTRE = EYE_MM.radius - EYE_MM.corneaRadius;

export interface MainSequence {
  /** Duration = intercept + slope × amplitude, ms and ms per degree. */
  intercept: number;
  slope: number;
  /** Ceiling on peak speed, degrees a second. */
  vmax: number;
  /** Fraction of the duration spent speeding up: skewSmall up to skewFrom degrees, falling by skewSlope a degree to skewLarge. */
  skewSmall: number;
  skewFrom: number;
  skewSlope: number;
  skewLarge: number;
}

/** The midpoint of Carpenter's and Baloh's fits, capped at Collewijn's ceiling. */
export const MAIN_SEQUENCE: MainSequence = {
  intercept: 25,
  slope: 2.5,
  vmax: 500,
  skewSmall: 0.45,
  skewFrom: 10,
  skewSlope: 0.00625,
  skewLarge: 0.2,
};

/**
 * Large saccades fall short, by about a tenth when a corrective saccade follows
 * and 2% to 6% when none does; free viewing's best gain is 0.93 to 0.97.
 */
export const UNDERSHOOT = {
  /** Saccades smaller than this land on target. */
  from: 5,
  /** Mean and spread of the shortfall, as a fraction of the amplitude. */
  mean: 0.07,
  spread: 0.05,
  /** A shortfall smaller than this, degrees, is left to the fixation's microsaccades. */
  correctFrom: 0.8,
  /** Time from landing to the corrective saccade, seconds: 130 ms for big errors, 250 ms median. */
  latencyMin: 0.13,
  latencyMax: 0.26,
  /** Share of the remaining error the corrective saccade covers. */
  coverMin: 0.75,
  coverMax: 0.95,
};

/**
 * Amplitudes in free viewing, lognormal, with a share of relocations drawn from
 * the far half of a held head's comfortable range (degrees).
 */
export const AMPLITUDE = { median: 6, sigma: 0.7, relocate: 0.2, relocateMin: 20, relocateMax: 42 };

/** With no head to help, big shifts are made in steps no larger than this. */
export const SPLIT_ABOVE = 50;
export const STEP_MIN = 25;
export const STEP_MAX = 42;

/**
 * Fixation durations are gamma distributed, shape 4 and scale 70 ms, and two ordinary saccades
 * are rarely less than 150 ms apart.
 */
export const FIXATION = {
  shape: 4,
  /** Seconds. */
  scale: 0.07,
  min: 0.15,
  max: 1,
  /** Moods and pace stretch the longest fixation by at most this much. */
  stretch: 1.5,
};

/**
 * Looking at someone is a run of short visits to their eyes, mouth and the rest
 * of the face, and now and then their body, more so for someone far off. Where a look first
 * lands and how often the next visit goes to the body, for someone `near` and `far` metres away
 * (shares); where the next visit goes from the face; how much longer visits to a person are than
 * free viewing's fixations (dwells of 0.34 to 0.51 s per region); the chance a look takes in
 * another part or two; a long look's length (lognormal median and spread, and the most, seconds;
 * mutual gaze is preferred at 3.3 s and reads as a stare past about 5); and the chance a look
 * goes back to the one before.
 */
export const DWELL = {
  near: 3,
  far: 9,
  firstFaceNear: 0.85,
  firstFaceFar: 0.55,
  toBodyNear: 0.08,
  toBodyFar: 0.35,
  toOtherEye: 0.45,
  toMouth: 0.25,
  fixScale: 1.4,
  lookMore: 0.5,
  stareMedian: 2.6,
  stareSigma: 0.3,
  stareMax: 5,
  back: 0.1,
};

/**
 * Looking away from someone, mostly down or to the side, for 1 to 2 s.
 * The chance a look out across the room goes to a window, the size of a look away in degrees,
 * the chances it goes to someone else or down (the rest go sideways), and how long it lasts.
 */
export const AVERT = {
  window: 0.4,
  min: 8,
  max: 30,
  toPerson: 0.3,
  down: 0.35,
  hold: [1, 2] as [number, number],
};

/**
 * Smooth pursuit needs a moving target, so it follows only someone crossing the
 * view faster than `min` degrees a second (below about 2 a real eye keeps up by saccades, and a
 * slow glide with no visible target reads as drift). It starts after its latency, reaches speed
 * over `ramp` seconds, carries `gain` of the target's speed, closes gaps past `catchUp` degrees
 * with catch-up saccades, and a whole follow lasts `minTime` to `maxTime` seconds before a
 * saccade elsewhere. Anyone slower is kept up with by at most `catchUps` saccades once they are
 * `keepUp` degrees off.
 */
export const PURSUIT = {
  min: 4,
  latency: 0.12,
  ramp: 0.25,
  gain: 0.9,
  catchUp: 1.5,
  keepUp: 1,
  catchUps: 3,
  minTime: 0.7,
  maxTime: 2.2,
};

/** Fixational eye movements: microsaccades and drift. */
export const MICRO = {
  /** Per second, during fixations. */
  rate: 1,
  /** Median amplitude, degrees, the spread of its log, and the largest. */
  median: 0.3,
  sigma: 0.4,
  max: 0.75,
  /** Drift diffusion, square degrees a second: 2 to 4 arcmin over a 300 ms fixation. */
  drift: 0.002,
};

/** Twist about the line of sight beyond Listing's law, degrees. */
export const TORSION = { spread: 0.3, tau: 3 };

/** How the pupil moves: the light reflex, effort, the near response, sudden events and unrest. */
export const PUPIL = {
  /** Light reflex latency, seconds. */
  latency: 0.2,
  /** Time constants, seconds: narrowing is faster than widening, which takes 5 to 30 s. */
  constrict: 0.3,
  dilate: 4,
  /**
   * The reflex sums light over about half a second, and after a step up it narrows
   * past its new size by this share of the step, then eases back over `escape` seconds.
   */
  integrate: 0.25,
  overshoot: 0.25,
  escape: 1.5,
  /** Fastest change, mm a second. */
  constrictSpeed: 3.8,
  dilateSpeed: 1.1,
  /** Widening with effort or interest: latency and time constant, seconds (peak 1 to 2 s). */
  effortLatency: 0.4,
  effortTau: 0.5,
  /** Near response: latency, seconds, and the most it narrows for someone close, mm. */
  nearLatency: 0.6,
  nearMax: 0.45,
  /**
   * Widening while it holds a long look (up to 0.5 mm), and the brief peaks for
   * catching someone's eye and for something sudden (0.1 to 0.3 mm), mm.
   */
  staring: 0.4,
  contact: 0.2,
  orient: 0.25,
  /**
   * Unrest: a noisy wobble near 0.3 Hz, spread in mm (about 0.25 mm), largest with
   * the pupil near `hippusMid` mm and half that `hippusWidth` mm either side.
   */
  hippus: 0.16,
  hippusHz: 0.3,
  hippusMid: 4.5,
  hippusWidth: 2,
  /** A sudden event's widening: the Erlang kernel's shape n and the time of its peak, seconds. */
  pulseShape: 10.1,
  pulsePeak: 0.93,
  /** Slow swings of seconds to a minute when drowsy, spread in mm and time constant. */
  fatigue: 0.5,
  fatigueTau: 8,
};

/**
 * The imagined room's light: a dim venue, about 25 lux on the floor with the
 * lamps full and a few lux dimmed, and bright windows. Interior luminances are cd/m² with the
 * lamps full; daylight adds a share. Levels, ramps and holds are shares and seconds.
 */
export const ROOM = {
  floor: 1.5,
  wall: 3,
  ceiling: 4,
  /** How much of the interior's light comes from the lamps and from daylight at full. */
  interiorLamps: 1,
  interiorDay: 0.35,
  /** A window's luminance at full daylight, overcast sky through glass. */
  window: 2500,
  /** Half-angle of the field the pupil answers, and the spread of its weighting, radians. */
  field: 1.05,
  fieldSigma: 0.35,
  dimChance: 0.35,
  dimLevel: [0.1, 0.3] as [number, number],
  dimFor: [30, 100] as [number, number],
  lampsDown: [4, 10] as [number, number],
  lampsUp: [0.3, 1.5] as [number, number],
  lampsOnFor: [90, 300] as [number, number],
  dayLevel: [0.3, 1] as [number, number],
  cloudRamp: [6, 30] as [number, number],
  cloudHold: [15, 90] as [number, number],
};

/**
 * Pupil diameter in mm for adapting luminance `cd` (cd/m²) over a 60° field with both eyes, by
 * Stanley and Davies' formula with Watson and Yellott's age term, for a 30-year-old (Watson and
 * Yellott, Journal of Vision 2012, https://doi.org/10.1167/12.10.12).
 */
export const lightPupil = (cd: number, age = 30): number => {
  const field = Math.PI * 30 * 30;
  const f = Math.max(1e-4, cd) * field;
  const k = (f / 846) ** 0.41;
  const sd = 7.75 - (5.75 * k) / (k + 2);
  return sd + (age - 28.58) * (0.02132 - 0.009562 * sd);
};
