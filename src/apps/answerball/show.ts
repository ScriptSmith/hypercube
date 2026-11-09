/**
 * The show's plan: one answer after another, each a cycle of stages. The ball turns its window
 * to the next audience, "Ask a question" shows in the liquid, the ball rocks, the die rises to
 * the glass, holds the answer and sinks again.
 *
 * With one window, about one answer in three faces straight down for the people underneath; the
 * rest face the side, from level (people far off, or on a gallery) to about 35°
 * below, at bearings at least 90° from the last side answer and chosen so every side of the room
 * gets one often. With three or six windows the ball turns slowly about the upright instead. Three
 * windows each run their own cycles, a third of a cycle apart. Six sit in two rows, alternately above
 * and below the middle of the ball: the windows of a row rise and hold their answers together, and
 * the two rows take turns, half a cycle apart, so the ball rocks twice a cycle rather than six times.
 * A seventh window straight underneath, for the people below, answers with the high row.
 *
 * Everything follows from the random stream and the time, so the show runs the same for days.
 * Cycles are planned a few ahead and forgotten once past.
 */
import { DEG, wrapLon } from "../../core/sphere";
import type { Rng } from "../../core/types";
import { ANSWERS } from "./answers";

export type StageId = "turn" | "prompt" | "shake" | "rise" | "hold" | "sink";
export const STAGE_IDS: readonly StageId[] = ["turn", "prompt", "shake", "rise", "hold", "sink"];

export type Pace = "calm" | "lively";
export type Windows = 1 | 3 | 6;

/** Angular radius of a window, radians. */
export const WINDOW_RADIUS = 20 * DEG;
/** How far below the equator the three windows sit, radians. */
export const THREE_LAT = -24 * DEG;
/**
 * The six windows' two rows: high ones face people far off and any gallery, low ones the
 * people standing round. Both are pulled inside the band people see.
 */
const SIX_HIGH = 15 * DEG;
const SIX_LOW = -25 * DEG;
/** Keep a window this far inside the band people see. */
const VIEW_MARGIN = 4 * DEG;
/** Bearings within this of an answer see it well, radians. */
export const SEEN_WITHIN = 60 * DEG;
/**
 * Side answers step round by about the golden angle, either way, so a few in a row face every
 * side and the bearings never settle into a pattern.
 */
const STEP = 137.5 * DEG;
const STEP_JITTER = 5 * DEG;
/** When choosing the way round, an answer counts as facing the bearings this close to it. */
const AIM_WITHIN = 40 * DEG;
/** A down answer waits while some side has gone this long without one, s (calm pace). */
const SIDE_WAIT = 120;
const BINS = 72;

export interface Pose {
  /** Latitude of the window's centre, radians; -π/2 straight down. */
  pitch: number;
  /** Bearing it faces, radians, unwrapped so turns are continuous. */
  yaw: number;
}

export interface Stage {
  id: StageId;
  /** Seconds from the cycle's start. */
  start: number;
  end: number;
}

export interface Cycle {
  lane: number;
  index: number;
  /** Show time the cycle starts, s (the first may start before 0, already under way). */
  start: number;
  duration: number;
  stages: Stage[];
  answer: number;
  /** A long shake: more rocks, and the die takes longer to settle. */
  long: boolean;
  down: boolean;
  /** Where the window turns from and to (one window only). */
  from: Pose;
  to: Pose;
  /** Overshoot at the end of the turn, radians of the window's travel. */
  overshoot: number;
  /** The rocks: how many, how far (radians), and the axis's mix of nodding and turning. */
  rocks: number;
  amplitude: number;
  axisMix: number;
  /** The die's tumble while shaken: axis (unit) and peak speed, rad/s. */
  tumbleAxis: [number, number, number];
  tumbleSpeed: number;
  /** The text's angle in the window at the rise's start, and how fast it turns, rad/s. */
  spinStart: number;
  spinRate: number;
  /** Slow drift of the die while it sinks and waits: axis (unit) and rate, rad/s. */
  driftAxis: [number, number, number];
  driftRate: number;
  /** How much the die wobbles as it comes to rest, radians, and about which in-window axis. */
  wobble: number;
  wobbleAngle: number;
}

export interface ShowOptions {
  windows: Windows;
  /** With six windows, one more straight underneath. */
  under?: boolean;
  pace: Pace;
  prompt: boolean;
  /** The band people see well, latitudes in radians. */
  view: { top: number; bottom: number };
}

interface Timing {
  turn: [number, number];
  prompt: [number, number];
  beat: [number, number];
  shake: [number, number];
  longShake: [number, number];
  rise: [number, number];
  longRise: [number, number];
  hold: [number, number];
  sink: [number, number];
  /** Seconds between long shakes. */
  longEvery: [number, number];
}

export const TIMING: Record<Pace, Timing> = {
  calm: {
    turn: [2.5, 4],
    prompt: [2, 2.4],
    beat: [0.5, 0.8],
    shake: [1, 1.5],
    longShake: [2.2, 2.8],
    rise: [2, 3],
    longRise: [4, 5],
    hold: [6, 8],
    sink: [1.4, 1.7],
    longEvery: [180, 360],
  },
  lively: {
    turn: [1.6, 2.4],
    prompt: [1.2, 1.4],
    beat: [0.3, 0.5],
    shake: [0.7, 1],
    longShake: [1.6, 2],
    rise: [1.4, 1.9],
    longRise: [2.8, 3.4],
    hold: [3.5, 4.5],
    sink: [0.9, 1.1],
    longEvery: [120, 240],
  },
};

const direction = (p: Pose): [number, number, number] => {
  const c = Math.cos(p.pitch);
  return [c * Math.sin(p.yaw), Math.sin(p.pitch), c * Math.cos(p.yaw)];
};

/** Angle the window's centre travels between two poses, radians. */
export const travel = (a: Pose, b: Pose): number => {
  const da = direction(a);
  const db = direction(b);
  const d = da[0] * db[0] + da[1] * db[1] + da[2] * db[2];
  return Math.acos(Math.max(-1, Math.min(1, d)));
};

/** The latitudes a side window's centre may take, and whether straight down is seen. */
export const aimBand = (view: { top: number; bottom: number }) => {
  const top = Math.min(0, view.top - WINDOW_RADIUS - VIEW_MARGIN);
  const bottom = Math.max(-35 * DEG, view.bottom + WINDOW_RADIUS + VIEW_MARGIN);
  const mid = (view.top + view.bottom) / 2;
  return {
    top: bottom <= top ? top : mid,
    bottom: bottom <= top ? bottom : mid,
    down: view.bottom <= -90 * DEG + VIEW_MARGIN,
  };
};

export interface Seat {
  /** The window's centre on the ball: latitude and bearing in the ball's own frame, radians. */
  pitch: number;
  yaw: number;
  /** Windows in one row run one plan; the first window of each row rocks the ball. */
  row: number;
}

/** Where each window sits on the ball. */
export const seats = (
  windows: Windows,
  view: { top: number; bottom: number },
  under = false,
): Seat[] => {
  if (windows === 1) return [{ pitch: 0, yaw: 0, row: 0 }];
  if (windows === 3) {
    return [0, 1, 2].map((i) => ({ pitch: THREE_LAT, yaw: (i * 2 * Math.PI) / 3, row: i }));
  }
  let high = Math.min(SIX_HIGH, view.top - WINDOW_RADIUS - VIEW_MARGIN);
  let low = Math.max(SIX_LOW, view.bottom + WINDOW_RADIUS + VIEW_MARGIN);
  if (high < low) high = low = (view.top + view.bottom) / 2;
  // The first window is a low one, so it faces people round the ball squarely at the start.
  const round = [0, 1, 2, 3, 4, 5].map((i) => ({
    pitch: i % 2 === 0 ? low : high,
    yaw: (i * Math.PI) / 3,
    row: i % 2,
  }));
  // The one underneath answers with the high row, between the low row's answers.
  if (under && aimBand(view).down) round.push({ pitch: -Math.PI / 2, yaw: 0, row: 1 });
  return round;
};

const unitVector = (rng: Rng): [number, number, number] => {
  const z = rng.range(-1, 1);
  const a = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
};

/** A shuffled order of the answers, never starting with `last`. */
export const deck = (rng: Rng, last: number): number[] => {
  const d = ANSWERS.map((_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  if (d[0] === last) [d[0], d[1]] = [d[1]!, d[0]!];
  return d;
};

interface Lane {
  /**
   * This window's own stream (the die's movements), and the one its plan's times and answers come
   * from, shared by every lane in the same plan.
   */
  rng: Rng;
  timing: Rng;
  /** Added to this lane's start times, s: the high row of six runs half a cycle earlier. */
  shift: number;
  /**
   * Answers are dealt `group` at a time, this lane keeping card `seat`, none among the last `apart`
   * dealt, so windows on show together never agree.
   */
  queue: number[];
  recent: number[];
  group: number;
  seat: number;
  apart: number;
  cycles: Cycle[];
  nextLong: number;
  sidesInRow: number;
  lastSideLon: number;
  /** When each bearing last had a side answer facing it squarely, and at all, s. */
  squarely: number[];
  seen: number[];
  /** The next cycle stays where it is and skips the turn and prompt (an answer on demand). */
  stay: boolean;
}

export interface Show {
  readonly options: ShowOptions;
  /** Where each window sits on the ball, for the band people saw when the show began. */
  readonly seats: readonly Seat[];
  /** The cycle of `lane` running at show time `t`. */
  cycle(lane: number, t: number): Cycle;
  /** The cycle before `c` in its lane, if still remembered. */
  previous(c: Cycle): Cycle | null;
  /** The stage of `c` at `at` seconds into it. */
  stageAt(c: Cycle, at: number): Stage;
  /** An answer now: the die sinks if it is up, then the ball shakes again where it faces. */
  shakeNow(lane: number, t: number): void;
  /** Follow a changed sphere (new band people see). */
  setView(view: { top: number; bottom: number }): void;
}

const LOOKAHEAD = 2;
const KEEP_BEHIND = 2;

export const createShow = (rng: Rng, options: ShowOptions): Show => {
  const opts = { ...options, view: { ...options.view } };
  const timing = TIMING[opts.pace];
  const lanes: Lane[] = [];
  const count = opts.windows;
  const layout = seats(count, opts.view, opts.under);
  // Six windows run one plan: each lane works it out from the same stream, the high row half a
  // cycle ahead of the low one.
  const shared = count === 6;
  for (let i = 0; i < layout.length; i++) {
    const r = rng.fork(`lane-${i}`);
    const tr = shared ? rng.fork("rows") : r;
    lanes.push({
      rng: r,
      timing: tr,
      shift: shared ? (-layout[i]!.row * meanCycle(opts.pace, opts.prompt)) / 2 : 0,
      queue: [],
      recent: [],
      group: shared ? layout.length : 1,
      seat: shared ? i : 0,
      apart: shared ? 2 * layout.length - 1 : 1,
      cycles: [],
      nextLong: tr.range(...timing.longEvery),
      sidesInRow: 0,
      lastSideLon: 0,
      squarely: Array.from({ length: BINS }, () => 0),
      seen: Array.from({ length: BINS }, () => 0),
      stay: false,
    });
  }

  const deal = (lane: Lane): number => {
    let mine = 0;
    for (let k = 0; k < lane.group; k++) {
      if (lane.queue.length === 0) {
        lane.queue = deck(lane.timing, lane.recent[lane.recent.length - 1] ?? -1);
      }
      // The queue always holds one that wasn't dealt lately: `apart` is under the deck's size.
      const i = Math.max(
        0,
        lane.queue.findIndex((a) => !lane.recent.includes(a)),
      );
      const a = lane.queue.splice(i, 1)[0]!;
      lane.recent.push(a);
      if (lane.recent.length > lane.apart) lane.recent.shift();
      if (k === lane.seat) mine = a;
    }
    return mine;
  };

  const sideLat = (r: Rng) => {
    const band = aimBand(opts.view);
    const level = r.next() < 0.3;
    const lat = level ? r.range(-6 * DEG, 0) : r.range(-35 * DEG, -12 * DEG);
    return Math.max(band.bottom, Math.min(band.top, lat));
  };

  const binLon = (b: number) => -Math.PI + ((b + 0.5) / BINS) * 2 * Math.PI;

  /** How long the bearings an answer at `lon` would face squarely have waited. */
  const staleness = (lane: Lane, lon: number, now: number) => {
    let sum = 0;
    for (let b = 0; b < BINS; b++) {
      const d = Math.abs(wrapLon(binLon(b) - lon)) / AIM_WITHIN;
      if (d >= 1) continue;
      const w = Math.max(0, now - lane.squarely[b]!);
      sum += w * w * (1 - d * d);
    }
    return sum;
  };

  const markSeen = (lane: Lane, lon: number, at: number) => {
    for (let b = 0; b < BINS; b++) {
      const d = Math.abs(wrapLon(binLon(b) - lon));
      if (d < AIM_WITHIN) lane.squarely[b] = at;
      if (d <= SEEN_WITHIN) lane.seen[b] = at;
    }
  };

  const chooseAim = (
    lane: Lane,
    prev: Cycle | null,
    now: number,
  ): { down: boolean; lon: number; lat: number } => {
    const r = lane.rng;
    const band = aimBand(opts.view);
    if (!prev) {
      return { down: false, lon: 0, lat: Math.max(band.bottom, Math.min(band.top, -20 * DEG)) };
    }
    // Mostly two side answers then one down, now and then one or three, and never two down.
    const n = lane.sidesInRow;
    const due = n >= 3 || (n >= 2 && r.next() < 0.8) || (n >= 1 && r.next() < 0.1);
    const waiting = Math.max(...lane.seen.map((s) => now - s));
    const limit = SIDE_WAIT * (opts.pace === "calm" ? 1 : 0.61);
    if (band.down && !prev.down && due && waiting < limit) {
      return { down: true, lon: lane.lastSideLon, lat: -90 * DEG };
    }
    let best = 0;
    let bestScore = -1;
    for (const way of [-1, 1]) {
      const lon = wrapLon(lane.lastSideLon + way * (STEP + r.range(-STEP_JITTER, STEP_JITTER)));
      const score = staleness(lane, lon, now);
      if (score > bestScore) {
        bestScore = score;
        best = lon;
      }
    }
    return { down: false, lon: best, lat: sideLat(r) };
  };

  const plan = (laneIndex: number): Cycle => {
    const lane = lanes[laneIndex]!;
    const r = lane.rng;
    const tr = lane.timing;
    const prev = lane.cycles[lane.cycles.length - 1] ?? null;
    const index = prev ? prev.index + 1 : 0;
    const stay = lane.stay && prev !== null;
    lane.stay = false;

    const long = !stay && prev !== null && prev.start + prev.duration - lane.shift >= lane.nextLong;
    const answer = deal(lane);

    let from: Pose;
    let to: Pose;
    let down = false;
    let turn: number;
    if (count === 1) {
      const fromPose: Pose = prev ? { ...prev.to } : { pitch: 0, yaw: 0 };
      // Bring the bearing back into one turn, so it never grows over days.
      const base = wrapLon(fromPose.yaw);
      from = { pitch: fromPose.pitch, yaw: base };
      if (stay && prev) {
        to = { ...from };
        down = prev.down;
      } else {
        const now = prev ? prev.start + prev.duration : 0;
        const aim = chooseAim(lane, prev, now);
        down = aim.down;
        to = down
          ? { pitch: -Math.PI / 2, yaw: base }
          : { pitch: aim.lat, yaw: base + wrapLon(aim.lon - base) };
        if (!prev) from = { ...to };
        if (!down) {
          lane.lastSideLon = aim.lon;
          lane.sidesInRow++;
          markSeen(lane, aim.lon, now);
        } else lane.sidesInRow = 0;
      }
      // Leaving a down answer, the ball also spins round to the new bearing.
      const spin = from.pitch < -89 * DEG ? Math.abs(to.yaw - from.yaw) * 0.5 : 0;
      const angle = travel(from, to) + spin;
      const [t0, t1] = timing.turn;
      turn =
        angle < 1e-6
          ? stay
            ? 0
            : tr.range(t0, t1) * 0.6
          : Math.min(t1, t0 + (t1 - t0) * (angle / Math.PI)) * tr.range(0.92, 1.08);
    } else {
      const seat = layout[laneIndex]!;
      from = { pitch: seat.pitch, yaw: seat.yaw };
      to = { ...from };
      down = seat.pitch < -89 * DEG;
      // Drawn even when skipped, so lanes sharing a plan stay in step.
      const wait = tr.range(...timing.turn);
      turn = stay ? 0 : wait;
    }
    const angle = travel(from, to);
    const overshoot = angle > 1e-6 ? Math.min(4 * DEG, 0.05 * angle) * r.range(0.7, 1.2) : 0;

    const beat = opts.prompt ? tr.range(...timing.prompt) : tr.range(...timing.beat);
    const prompt = stay ? 0 : beat;
    const shake = tr.range(...(long ? timing.longShake : timing.shake));
    const rise = tr.range(...(long ? timing.longRise : timing.rise));
    const hold = tr.range(...timing.hold);
    const sink = tr.range(...timing.sink);
    const lengths: [StageId, number][] = [
      ["turn", turn],
      ["prompt", prompt],
      ["shake", shake],
      ["rise", rise],
      ["hold", hold],
      ["sink", sink],
    ];
    const stages: Stage[] = [];
    let at = 0;
    for (const [id, len] of lengths) {
      stages.push({ id, start: at, end: at + len });
      at += len;
    }

    let start: number;
    if (prev) start = prev.start + prev.duration;
    else if (count === 1) start = -turn;
    // Three windows start a third of a cycle apart, each already under way.
    else if (count === 3) start = -turn - (laneIndex * meanCycle(opts.pace, opts.prompt)) / 3;
    // Six windows start as the low row's answers arrive, so something shows at once.
    else start = -stages[4]!.start + lane.shift;
    if (long) lane.nextLong = start - lane.shift + tr.range(...timing.longEvery);

    const cycle: Cycle = {
      lane: laneIndex,
      index,
      start,
      duration: at,
      stages,
      answer,
      long,
      down,
      from,
      to,
      overshoot,
      rocks: long ? 5 + r.int(2) : 2 + r.int(3),
      amplitude: (long ? r.range(5, 7) : r.range(3, 6)) * DEG * (count > 1 ? 0.5 : 1),
      axisMix: r.range(-0.9, 0.9),
      tumbleAxis: unitVector(r),
      tumbleSpeed: long ? r.range(7, 10) : r.range(4, 7),
      spinStart: down ? r.range(0, Math.PI * 2) : 0,
      spinRate: down ? ((r.next() < 0.5 ? -1 : 1) * 2 * Math.PI) / r.range(26, 34) : 0,
      driftAxis: unitVector(r),
      driftRate: r.range(0.08, 0.2),
      wobble: (long ? r.range(5, 7) : r.range(2, 3.5)) * DEG,
      wobbleAngle: r.range(0, Math.PI * 2),
    };
    lane.cycles.push(cycle);
    return cycle;
  };

  const ensure = (laneIndex: number, t: number) => {
    const lane = lanes[laneIndex]!;
    if (lane.cycles.length === 0) plan(laneIndex);
    for (;;) {
      const last = lane.cycles[lane.cycles.length - 1]!;
      if (last.start + last.duration > t) break;
      plan(laneIndex);
      // Forget what is well past; nothing grows over days.
      while (lane.cycles.length > KEEP_BEHIND + LOOKAHEAD + 2) lane.cycles.shift();
    }
  };

  const find = (laneIndex: number, t: number): Cycle => {
    ensure(laneIndex, t);
    const cycles = lanes[laneIndex]!.cycles;
    for (let i = cycles.length - 1; i >= 0; i--) {
      const c = cycles[i]!;
      if (t >= c.start) return c;
    }
    return cycles[0]!;
  };

  const stageAt = (c: Cycle, at: number): Stage => {
    for (const s of c.stages) if (at < s.end) return s;
    return c.stages[c.stages.length - 1]!;
  };

  return {
    options: opts,
    seats: layout,
    cycle: find,
    previous(c) {
      const cycles = lanes[c.lane]!.cycles;
      const i = cycles.indexOf(c);
      return i > 0 ? cycles[i - 1]! : null;
    },
    stageAt,
    shakeNow(laneIndex, t) {
      const lane = lanes[laneIndex]!;
      const c = find(laneIndex, t);
      const at = t - c.start;
      const s = stageAt(c, at);
      const i = lane.cycles.indexOf(c);
      lane.cycles.length = i + 1;
      const set = (id: StageId, start: number, end: number) => {
        const st = c.stages.find((x) => x.id === id)!;
        st.start = start;
        st.end = end;
      };
      const shift = (from: StageId, by: number) => {
        let on = false;
        for (const st of c.stages) {
          if (st.id === from) on = true;
          if (on) {
            st.start += by;
            st.end += by;
          }
        }
      };
      if (s.id === "turn" || s.id === "prompt") {
        // Let a turn finish, then shake straight away.
        const p = c.stages[1]!;
        const startPrompt = s.id === "turn" ? p.start : at;
        shift("shake", startPrompt - p.end);
        set("prompt", p.start, startPrompt);
      } else if (s.id === "rise" || s.id === "hold") {
        // Sink from here, quickly, and shake again where the ball faces.
        const sinkLen = 0.8;
        const hold = c.stages[4]!;
        const rise = c.stages[3]!;
        if (s.id === "rise") {
          rise.end = at;
          hold.start = at;
        }
        hold.end = Math.max(hold.start, at);
        set("sink", hold.end, hold.end + sinkLen);
        lane.stay = true;
      } else if (s.id === "sink") {
        lane.stay = true;
      }
      c.duration = c.stages[c.stages.length - 1]!.end;
    },
    setView(view) {
      opts.view = { ...view };
    },
  };
};

/** Seconds a cycle lasts on average, for tests and notes. */
export const meanCycle = (pace: Pace, prompt: boolean): number => {
  const t = TIMING[pace];
  const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
  return (
    mid(t.turn) +
    (prompt ? mid(t.prompt) : mid(t.beat)) +
    mid(t.shake) +
    mid(t.rise) +
    mid(t.hold) +
    mid(t.sink)
  );
};
