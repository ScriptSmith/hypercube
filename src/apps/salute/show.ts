/**
 * The show: where the face points, what its hand does and its expression, as time is stepped.
 *
 * The face goes from stop to stop. At each it turns to a bearing, settles, snaps its hand up to
 * its brow, holds the salute, snaps the hand down, relaxes with a smile and a blink, and turns
 * on. Most stops face people on the floor round the ball, tilted down towards them. Now and
 * then it bows right down to the people underneath, looks straight across where there is a
 * gallery, or keeps the salute up through one slow full turn. Bearings come from the sides of
 * a few random ones, whichever has waited longest, and a side that has waited too long is
 * faced next, so every side is faced within about a minute and the order never repeats.
 *
 * Everything follows from the random stream and the time stepped, so the same seed gives the
 * same show.
 */
import { DEG, defaultViewers, wrapLon } from "../../core/sphere";
import type { Rng, SphereInfo } from "../../core/types";

export type Stage = "turn" | "settle" | "raise" | "hold" | "lower" | "relax";
/**
 * Who a stop is for: people on the floor, people level with the ball, people underneath, every
 * side in one slow turn, or (the `hold` option) every side for good.
 */
export type StopKind = "floor" | "across" | "under" | "sweep" | "parade";
export type Pace = "formal" | "relaxed";
/** The kinds of stop that can be asked for. */
export type Cue = Exclude<StopKind, "parade">;

type Range = readonly [number, number];

export interface PaceSpec {
  settle: Range;
  /** Seconds the hand takes to snap up, and down. */
  raise: number;
  lower: number;
  hold: Range;
  relax: Range;
  /** Seconds a turn takes: the first for any turn, plus the second for each half turn. */
  turn: Range;
  /** Seconds to bow right down, or to come back up. */
  bow: number;
  /** Seconds for the full turn with the salute held. */
  sweep: number;
  /** Seconds per turn while the salute is held for good. */
  parade: number;
  /** A side that has waited this long is faced next, s. */
  wait: number;
}

export const PACES: Record<Pace, PaceSpec> = {
  formal: {
    settle: [0.45, 0.7],
    raise: 0.24,
    lower: 0.3,
    hold: [2.6, 3.8],
    relax: [1.2, 1.8],
    turn: [1.3, 1.4],
    bow: 2.2,
    sweep: 15,
    parade: 40,
    wait: 34,
  },
  relaxed: {
    settle: [0.7, 1.1],
    raise: 0.4,
    lower: 0.5,
    hold: [3.2, 5],
    relax: [1.9, 2.8],
    turn: [1.9, 2],
    bow: 3,
    sweep: 22,
    parade: 60,
    wait: 50,
  },
};

/** The room is split into this many sides, to keep track of who has been saluted. */
export const SIDES = 12;
/** A salute is for everyone within this angle of where the face points. */
export const REACH = 50 * DEG;
/** Bearings tried for each stop; the one whose sides have waited longest wins. */
const CANDIDATES = 3;
/** The least a turn to the next stop may be, so that it reads as a turn. */
const LEAST_TURN = 40 * DEG;
/** Stops between bows to the people underneath, and between full turns. */
export const BOW_EVERY: Range = [4, 7];
export const SWEEP_EVERY: Range = [11, 18];
/** How long the first salute is held, so a preview opens on it, s. */
export const OPENING_HOLD = 7;
/** The chin's lift in a salute, radians. */
export const CHIN_LIFT = 4.5 * DEG;
/** How far the hand's snap carries past the brow before it settles, as a share of its path. */
export const OVERSHOOT = 0.06;

const TAU = Math.PI * 2;
const STRAIGHT_DOWN = -Math.PI / 2;
/** The steepest and shallowest the face tilts towards people on the floor. */
const FLOOR_TILT: Range = [-38 * DEG, -8 * DEG];
/**
 * The point of the face plane that is turned to the people a stop is for. Round the room it is
 * a little towards the hand, a three-quarter view that shows the salute. In a bow it is also a
 * little towards the brow, because someone underneath sees only the bottom of the ball and the
 * salute is above the middle of the face.
 */
export const AIM_ROUND: readonly [number, number] = [-0.16, 0];
export const AIM_UNDER: readonly [number, number] = [-0.16, 0.06];
/** How far the pupils turn for each unit the face is aimed aside, to keep looking at people. */
const AIM_GLANCE = 3;
/** The mouth at rest: small and composed, the hint of a smile. */
const COMPOSED = 0.4;
const NEUTRAL_BROW = 0.2;
const BLINK_GAP: Range = [2.2, 5.5];
const BLINK_S = 0.24;
const WINK_S = 0.55;
const WINK_CHANCE = 0.16;
const GLANCE_CHANCE = 0.7;
const TILT_CHANCE = 0.5;
const ACROSS_CHANCE = 0.3;
/** A hold longer than this makes the eyes glisten, s. */
const GLISTEN_AFTER = 2.2;

export interface Pose {
  /** Round the vertical, radians in [-π, π), 0 towards +z. */
  bearing: number;
  /** Elevation the face points at, radians; negative is down. */
  pitch: number;
  roll: number;
  /** The hand: 0 out of sight, 1 at the brow. */
  raise: number;
  /** 0 low, 1 fully lifted. */
  brow: number;
  /** 0 a firm straight mouth, 1 a full smile. */
  smile: number;
  /** Each eye from 0 open to 1 shut: the face's own right eye (beside the hand) and its left. */
  blinkRight: number;
  blinkLeft: number;
  /** The point of the face plane that points along the bearing and pitch. */
  aimX: number;
  aimY: number;
  /** Where the pupils look, -1 to 1 across and up the face plane. */
  glanceX: number;
  glanceY: number;
  /** 0 to 1. */
  glisten: number;
}

export interface Stats {
  stops: number;
  salutes: number;
  bows: number;
  sweeps: number;
  across: number;
  blinks: number;
  winks: number;
  glances: number;
}

export interface ShowOptions {
  pace: Pace;
  /** Hold the salute for good, turning slowly. */
  hold: boolean;
  sphere: SphereInfo;
  /** People also watch from about level with the ball. */
  gallery: boolean;
}

export interface Show {
  readonly time: number;
  readonly stage: Stage;
  readonly kind: StopKind;
  readonly pose: Readonly<Pose>;
  readonly stats: Readonly<Stats>;
  /** Seconds since each side of the room was last saluted. */
  waits(): number[];
  step(dt: number): void;
  setPace(pace: Pace): void;
  setHold(on: boolean): void;
  setSphere(sphere: SphereInfo, gallery: boolean): void;
  /** Make the next stop one of this kind, at this bearing (radians) if one is given. */
  cue(kind: Cue, bearing?: number): void;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const smooth = (u: number): number => {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};

/** An eased 0 to 1 with no speed or acceleration at either end, for turns of the head. */
export const easeTurn = (u: number): number => {
  const t = clamp(u, 0, 1);
  return t * t * t * (t * (6 * t - 15) + 10);
};

/**
 * The hand's snap up: fast away, a little past 1 and back to rest on it. With 1 - (1 - u)^2
 * (1 - a u) the peak is 4 (a - 1)^3 / (27 a^2) over 1, and `SNAP_A` sets that to `OVERSHOOT`.
 */
const SNAP_A = 2.28;
export const snapUp = (u: number): number => {
  const t = clamp(u, 0, 1);
  return 1 - (1 - t) * (1 - t) * (1 - SNAP_A * t);
};

/** The hand's drop: it gathers speed all the way, so it is gone at its fastest. */
export const snapDown = (u: number): number => 1 - clamp(u, 0, 1) ** 1.7;

/** A full turn that eases in and out over a tenth of its time each end and is steady between. */
export const sweepTurn = (u: number): number => {
  const t = clamp(u, 0, 1);
  const e = 0.1;
  const speed = 1 / (1 - e);
  if (t < e) return (speed * t * t) / (2 * e);
  if (t > 1 - e) return 1 - (speed * (1 - t) * (1 - t)) / (2 * e);
  return speed * (t - e / 2);
};

/** Which side of the room a bearing is in, 0 to `SIDES` - 1. */
export const sideOf = (bearing: number): number =>
  Math.min(SIDES - 1, Math.floor(((wrapLon(bearing) + Math.PI) / TAU) * SIDES));

const sideCentre = (side: number): number => -Math.PI + ((side + 0.5) * TAU) / SIDES;

/**
 * The tilt that points the face at someone on the floor `distance` metres from the spot under
 * the ball, kept short of the unseen cap.
 */
export const floorTilt = (sphere: SphereInfo, distance: number): number => {
  const eye = defaultViewers(sphere.radius).eyes[0] ?? 1.6;
  const tilt = -Math.atan2(sphere.centreY - eye, Math.max(distance, 0.1));
  return clamp(tilt, FLOOR_TILT[0], FLOOR_TILT[1]);
};

interface Stop {
  kind: StopKind;
  bearing: number;
  pitch: number;
  hold: number;
}

const aimOf = (kind: StopKind): readonly [number, number] =>
  kind === "under" ? AIM_UNDER : AIM_ROUND;

interface Blink {
  start: number;
  /** 0 both eyes, 1 the right eye alone, 2 the left. */
  eye: 0 | 1 | 2;
  length: number;
}

const lidAt = (t: number, length: number): number => {
  if (t <= 0 || t >= length) return 0;
  const shut = length * 0.3;
  const stay = length > BLINK_S ? length * 0.3 : 0;
  if (t < shut) return smooth(t / shut);
  if (t < shut + stay) return 1;
  return 1 - smooth((t - shut - stay) / (length - shut - stay));
};

export const createShow = (rng: Rng, options: ShowOptions): Show => {
  let pace = options.pace;
  let forGood = options.hold;
  let sphere = options.sphere;
  let gallery = options.gallery;

  let time = 0;
  let stage: Stage = "settle";
  let stageTime = 0;
  let stageLength = 0.6;

  const tiltFor = (ratio: number): number => floorTilt(sphere, ratio * sphere.radius);
  const randomTilt = (): number => {
    const far = defaultViewers(sphere.radius).far;
    return floorTilt(sphere, rng.range(2.5 * sphere.radius, 0.9 * far));
  };

  // It opens facing a preview's camera, which stands a little way off at bearing 0.
  let stop: Stop = {
    kind: forGood ? "parade" : "floor",
    bearing: 0,
    pitch: tiltFor(3.6),
    hold: OPENING_HOLD,
  };
  let next: Stop | null = null;
  let cued: { kind: Cue; bearing?: number } | null = null;

  let bearing = 0;
  let basePitch = stop.pitch;
  let fromBearing = 0;
  let turnBy = 0;
  let fromPitch = basePitch;
  let aimX = AIM_ROUND[0];
  let aimY = AIM_ROUND[1];
  let fromAimX = aimX;
  let fromAimY = aimY;
  let raise = 0;
  let raiseFrom = 0;
  let sweepFrom = 0;
  let sweepDir = 1;
  let spin = 0;
  let paradeTime = 0;

  let chin = 0;
  let roll = 0;
  let rollTarget = 0;
  let brow = NEUTRAL_BROW;
  let smile = COMPOSED;
  let glanceX = 0;
  let glanceY = 0;
  let glisten = 0;
  let glancing = false;
  let relaxWink = false;
  let relaxBlinked = false;

  let blink: Blink | null = null;
  let nextBlink = rng.range(BLINK_GAP[0], BLINK_GAP[1]);

  const faced: number[] = Array.from({ length: SIDES }, () => 0);
  let sinceBow = 0;
  let sinceSweep = 0;
  let bowAfter = rng.int(BOW_EVERY[1] - BOW_EVERY[0] + 1) + BOW_EVERY[0];
  let sweepAfter = rng.int(SWEEP_EVERY[1] - SWEEP_EVERY[0] + 1) + SWEEP_EVERY[0];

  const stats: Stats = {
    stops: 0,
    salutes: 0,
    bows: 0,
    sweeps: 0,
    across: 0,
    blinks: 0,
    winks: 0,
    glances: 0,
  };

  const pose: Pose = {
    bearing: 0,
    pitch: basePitch,
    roll: 0,
    raise: 0,
    brow,
    smile,
    blinkRight: 0,
    blinkLeft: 0,
    aimX,
    aimY,
    glanceX: 0,
    glanceY: 0,
    glisten: 0,
  };

  const spec = (): PaceSpec => PACES[pace];

  const enter = (s: Stage, length: number) => {
    stage = s;
    stageTime = 0;
    stageLength = length;
  };

  const wait = (side: number): number => time - (faced[side] ?? 0);
  const reaches = (side: number, at: number): boolean =>
    Math.abs(wrapLon(sideCentre(side) - at)) <= REACH;

  /** Count everyone a salute at `at` is for as saluted now. */
  const markFaced = (at: number) => {
    for (let side = 0; side < SIDES; side++) if (reaches(side, at)) faced[side] = time;
  };

  const chooseBearing = (): number => {
    let oldest = 0;
    for (let side = 1; side < SIDES; side++) if (wait(side) > wait(oldest)) oldest = side;
    const overdue = wrapLon(sideCentre(oldest) + rng.range(-10, 10) * DEG);
    let best = overdue;
    let most = -1;
    for (let i = 0; i < CANDIDATES; i++) {
      const at = rng.range(-Math.PI, Math.PI);
      if (Math.abs(wrapLon(at - bearing)) < LEAST_TURN) continue;
      let waited = 0;
      for (let side = 0; side < SIDES; side++) if (reaches(side, at)) waited += wait(side);
      if (waited > most) {
        most = waited;
        best = at;
      }
    }
    return wait(oldest) > spec().wait ? overdue : best;
  };

  const chooseStop = (): Stop => {
    const hold = rng.range(spec().hold[0], spec().hold[1]);
    let kind: StopKind;
    const asked = cued?.bearing;
    if (cued) {
      kind = cued.kind;
      cued = null;
    } else if (sinceBow >= bowAfter && stop.kind !== "under") kind = "under";
    else if (sinceSweep >= sweepAfter) kind = "sweep";
    else kind = gallery && rng.next() < ACROSS_CHANCE ? "across" : "floor";
    if (kind === "under") return { kind, bearing, pitch: STRAIGHT_DOWN, hold };
    const pitch = kind === "across" ? rng.range(-3 * DEG, 2 * DEG) : randomTilt();
    return { kind, bearing: asked === undefined ? chooseBearing() : wrapLon(asked), pitch, hold };
  };

  const startTurn = (to: Stop) => {
    stop = to;
    next = null;
    fromBearing = bearing;
    turnBy = wrapLon(to.bearing - bearing);
    fromPitch = basePitch;
    fromAimX = aimX;
    fromAimY = aimY;
    const s = spec();
    const round = s.turn[0] + (s.turn[1] * Math.abs(turnBy)) / Math.PI;
    const dip = (s.bow * Math.abs(to.pitch - basePitch)) / (Math.PI / 2);
    enter("turn", Math.max(round, 0.9 + dip));
  };

  const startHold = () => {
    stats.stops++;
    stats.salutes++;
    sinceBow++;
    sinceSweep++;
    if (forGood && stop.kind !== "sweep") stop.kind = "parade";
    switch (stop.kind) {
      case "under":
        stats.bows++;
        sinceBow = 0;
        bowAfter = rng.int(BOW_EVERY[1] - BOW_EVERY[0] + 1) + BOW_EVERY[0];
        break;
      case "sweep":
        stats.sweeps++;
        sinceSweep = 0;
        sweepAfter = rng.int(SWEEP_EVERY[1] - SWEEP_EVERY[0] + 1) + SWEEP_EVERY[0];
        sweepFrom = bearing;
        sweepDir = rng.next() < 0.5 ? -1 : 1;
        break;
      case "parade":
        sweepDir = rng.next() < 0.5 ? -1 : 1;
        paradeTime = 0;
        break;
      case "across":
        stats.across++;
        markFaced(bearing);
        break;
      default:
        markFaced(bearing);
    }
    enter("hold", stop.kind === "sweep" ? spec().sweep : stop.hold);
  };

  const startRelax = () => {
    next = forGood ? null : chooseStop();
    glancing = next !== null && rng.next() < GLANCE_CHANCE;
    relaxWink = rng.next() < WINK_CHANCE;
    relaxBlinked = false;
    rollTarget = rng.next() < TILT_CHANCE ? (rng.next() < 0.5 ? -1 : 1) * 3.5 * DEG : 0;
    enter("relax", rng.range(spec().relax[0], spec().relax[1]));
  };

  const startBlink = (eye: 0 | 1 | 2) => {
    blink = { start: time, eye, length: eye === 0 ? BLINK_S : WINK_S };
    if (eye === 0) stats.blinks++;
    else stats.winks++;
    nextBlink = time + rng.range(BLINK_GAP[0], BLINK_GAP[1]);
  };

  const towards = (v: number, target: number, rate: number, dt: number): number =>
    v + (target - v) * (1 - Math.exp(-rate * dt));

  const step = (dt: number) => {
    time += dt;
    stageTime += dt;
    const u = stageLength > 0 ? stageTime / stageLength : 1;
    const saluting = stage === "raise" || stage === "hold";
    let browTo = NEUTRAL_BROW;
    let smileTo = COMPOSED;
    let chinTo = 0;
    let rollTo = 0;
    // The pupils stay on the people the face is aimed at, unless they glance away.
    let glanceXTo = clamp(aimX * AIM_GLANCE, -1, 1);
    let glanceYTo = clamp(aimY * AIM_GLANCE, -1, 1);
    let glistenTo = 0;

    switch (stage) {
      case "turn": {
        const e = easeTurn(u);
        bearing = fromBearing + turnBy * e;
        basePitch = fromPitch + (stop.pitch - fromPitch) * e;
        const aim = aimOf(stop.kind);
        aimX = fromAimX + (aim[0] - fromAimX) * e;
        aimY = fromAimY + (aim[1] - fromAimY) * e;
        if (glancing && u < 0.45) {
          glanceXTo = Math.sign(turnBy);
          glanceYTo = stop.kind === "under" ? -1 : 0;
        }
        if (u >= 1) {
          bearing = wrapLon(stop.bearing);
          basePitch = stop.pitch;
          enter("settle", rng.range(spec().settle[0], spec().settle[1]));
        }
        break;
      }
      case "settle":
        if (u >= 1) {
          raiseFrom = raise;
          enter("raise", spec().raise);
        }
        break;
      case "raise":
        raise = raiseFrom + (1 - raiseFrom) * snapUp(u);
        if (u >= 1) {
          raise = 1;
          startHold();
        }
        break;
      case "hold": {
        raise = 1;
        if (forGood && stop.kind !== "sweep") stop.kind = "parade";
        if (stop.kind === "sweep") {
          bearing = sweepFrom + sweepDir * TAU * sweepTurn(u);
        } else if (stop.kind === "parade") {
          paradeTime += dt;
          const rate = forGood ? (sweepDir * TAU) / spec().parade : 0;
          spin = towards(spin, rate, 1.2, dt);
          bearing = wrapLon(bearing + spin * dt);
          // The tilt drifts between people near the ball and people far from it.
          const near = tiltFor(2.5);
          const far = tiltFor(4.5);
          const drift = (near + far) / 2 + ((far - near) / 2) * Math.sin((TAU * paradeTime) / 53);
          basePitch = towards(basePitch, drift, 0.5, dt);
          // A bow that became the held salute comes back up to the room.
          aimX = towards(aimX, AIM_ROUND[0], 0.5, dt);
          aimY = towards(aimY, AIM_ROUND[1], 0.5, dt);
        }
        if (stageTime > GLISTEN_AFTER) glistenTo = 1;
        const done =
          stop.kind === "parade" ? !forGood && Math.abs(spin) < 1 * DEG : u >= 1 && !forGood;
        if (stop.kind === "sweep" && u >= 1) {
          bearing = wrapLon(sweepFrom);
          faced.fill(time);
          if (forGood) {
            stop.kind = "parade";
            paradeTime = 0;
          }
        }
        if (done) {
          spin = 0;
          raiseFrom = raise;
          enter("lower", spec().lower);
        }
        break;
      }
      case "lower":
        raise = raiseFrom * snapDown(u);
        if (u >= 1) {
          raise = 0;
          startRelax();
        }
        break;
      case "relax": {
        smileTo = 1;
        browTo = 0.5;
        rollTo = rollTarget;
        if (!relaxBlinked && stageTime > 0.3 && blink === null) {
          relaxBlinked = true;
          startBlink(relaxWink ? 2 : 0);
        }
        if (glancing && next && stageLength - stageTime < 0.5) {
          glanceXTo = next.kind === "under" ? 0 : Math.sign(wrapLon(next.bearing - bearing));
          glanceYTo = next.kind === "under" ? -1 : 0;
        }
        if (u >= 1) {
          if (glancing) stats.glances++;
          if (forGood || !next) {
            stop = { kind: "parade", bearing, pitch: basePitch, hold: 0 };
            raiseFrom = raise;
            enter("raise", spec().raise);
          } else startTurn(next);
        }
        break;
      }
    }

    if (saluting) {
      browTo = 1;
      // A firm mouth for the salute; held for good, it softens into the hint of a smile.
      smileTo = stop.kind === "parade" && stageTime > 4 ? 0.3 : 0;
      chinTo = stop.kind === "under" ? CHIN_LIFT / 3 : CHIN_LIFT;
    }

    brow = towards(brow, browTo, 14, dt);
    smile = towards(smile, smileTo, 9, dt);
    chin = towards(chin, chinTo, 12, dt);
    roll = towards(roll, rollTo, 5, dt);
    glanceX = towards(glanceX, glanceXTo, 10, dt);
    glanceY = towards(glanceY, glanceYTo, 10, dt);
    glisten = towards(glisten, glistenTo, 1.2, dt);

    // Blinks keep out of the hand's snaps and the first moment of a salute, when the eyes are
    // alert: none starts then, or too late to be over before a snap.
    const left = stageLength - stageTime;
    const alert =
      stage === "raise" ||
      stage === "lower" ||
      (stage === "settle" && left < BLINK_S + 0.05) ||
      (stage === "hold" && (stageTime < 0.9 || (stop.kind !== "parade" && left < BLINK_S + 0.05)));
    if (blink && time - blink.start >= blink.length) blink = null;
    if (!blink && time >= nextBlink) {
      if (alert) nextBlink = time + rng.range(0.3, 1.2);
      else startBlink(0);
    }
    const lid = blink ? lidAt(time - blink.start, blink.length) : 0;

    pose.bearing = wrapLon(bearing);
    pose.pitch = basePitch + chin;
    pose.roll = roll;
    pose.raise = raise;
    pose.brow = brow;
    pose.smile = smile;
    pose.blinkRight = blink && blink.eye !== 2 ? lid : 0;
    pose.blinkLeft = blink && blink.eye !== 1 ? lid : 0;
    pose.aimX = aimX;
    pose.aimY = aimY;
    pose.glanceX = glanceX;
    pose.glanceY = glanceY;
    pose.glisten = glisten;
  };

  return {
    get time() {
      return time;
    },
    get stage() {
      return stage;
    },
    get kind() {
      return stop.kind;
    },
    pose,
    stats,
    waits: () => faced.map((at) => time - at),
    step,
    setPace(p) {
      pace = p;
    },
    setHold(on) {
      forGood = on;
    },
    setSphere(s, g) {
      sphere = s;
      gallery = g;
    },
    cue(kind, at) {
      cued = at === undefined ? { kind } : { kind, bearing: at };
    },
  };
};
