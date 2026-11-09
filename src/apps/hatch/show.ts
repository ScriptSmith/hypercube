/**
 * The show: one egg after another, each a fixed list of stages with its own timings, shell,
 * crack places and chick, all drawn from a seeded stream so a page shows the same eggs for the
 * same seed. Times are seconds. Nothing here draws, so tests can check it.
 */
import { DEG } from "../../core/sphere";
import type { Rng } from "../../core/types";

export type Variant = "hatch" | "candling";
export type Pace = "normal" | "quick";
export type StageId =
  | "candle"
  | "egg"
  | "stir"
  | "pip"
  | "rest"
  | "zip"
  | "hatch"
  | "dry"
  | "chick"
  | "fade";

export const HATCH_STAGES: readonly StageId[] = [
  "egg",
  "stir",
  "pip",
  "rest",
  "zip",
  "hatch",
  "dry",
  "chick",
  "fade",
];
export const CANDLING_STAGES: readonly StageId[] = [
  "candle",
  "stir",
  "pip",
  "rest",
  "zip",
  "hatch",
  "dry",
  "chick",
  "fade",
];

export const DAYS = 21;
export const SECONDS_PER_DAY: Record<Pace, number> = { normal: 8, quick: 4 };

/** Stage lengths at the normal pace, before each egg's own variation. */
export const BASE_SECONDS: Record<Exclude<StageId, "candle">, number> = {
  egg: 20,
  stir: 35,
  pip: 30,
  rest: 40,
  zip: 70,
  hatch: 16,
  dry: 60,
  chick: 75,
  fade: 8,
};
/** The quick pace halves everything, but the hatch and the fade need a few seconds still. */
const QUICK_FLOOR: Partial<Record<StageId, number>> = { hatch: 11, fade: 6 };
/** Each egg's stages run this much longer or shorter, at random. */
export const JITTER = 0.12;
/**
 * The first egg after the page loads starts nearly at its pip and opens the hole quickly, so
 * whoever opens the page (a preview, a gallery thumbnail) sees something happen within
 * seconds. Every later egg takes its time.
 */
const OPENING: Partial<Record<StageId, number>> = { egg: 1.5, stir: 4, pip: 14 };

export type ShellKind = "white" | "cream" | "brown" | "speckled" | "dark" | "blue" | "olive";
export type ShellOption = "mixed" | "brown" | "white" | "speckled" | "blue";
export const SHELL_KINDS: readonly ShellKind[] = [
  "white",
  "cream",
  "brown",
  "speckled",
  "dark",
  "blue",
  "olive",
];
const SHELL_GROUPS: Record<ShellOption, readonly ShellKind[]> = {
  mixed: SHELL_KINDS,
  brown: ["brown", "dark"],
  white: ["white", "cream"],
  speckled: ["speckled", "dark"],
  blue: ["blue", "olive"],
};

export interface Stage {
  id: StageId;
  /** Seconds from the egg's start. */
  start: number;
  end: number;
}

/** One rock or jolt of the egg: a damped swing about a level axis. */
export interface Rock {
  at: number;
  /** Radians. */
  amp: number;
  /** Direction of the level axis it swings about, radians round from +x. */
  axis: number;
  /** Swings a second. */
  freq: number;
  /** Per second. */
  decay: number;
}

/** What the chick does, all in seconds from the egg's start. */
export interface ChickPlan {
  /** Index into the down colours. */
  down: number;
  /** Where it looks from each time on: yaw and pitch offsets, radians. */
  glances: { at: number; yaw: number; pitch: number }[];
  blinks: number[];
  /** Each cheep opens the beak for a moment. */
  cheeps: number[];
  /** A doze: eyes closing and head nodding. */
  doze: { at: number; length: number } | null;
  /** Shakes that fluff the down up. */
  shakes: number[];
  /** The slow shuffle round, radians a second. */
  turn: number;
}

export interface EggPlan {
  index: number;
  variant: Variant;
  pace: Pace;
  kind: ShellKind;
  /** Offsets the shell's noise so no two eggs look alike. */
  seed: number;
  /** Show seconds at which this egg starts. */
  start: number;
  stages: Stage[];
  duration: number;
  secondsPerDay: number;
  /** Where the chick first breaks through, in the egg's own frame. */
  pip: { lat: number; lon: number };
  /** The way the chick turns as it zips, in the egg's longitude: +1 or -1. */
  zipDir: 1 | -1;
  /** How far round it chips before pushing the top off, radians. */
  zipSpan: number;
  taps: number[];
  /** The tap that first opens a hole. */
  holeTap: number;
  pecks: number[];
  rocks: Rock[];
  /** The egg's turn about its upright axis: angle at the egg's start and rate, radians. */
  yaw0: number;
  spin: number;
  chick: ChickPlan;
}

export interface ShowOptions {
  variant: Variant;
  pace: Pace;
  shell: ShellOption;
  /** Top of the band people see well, radians: the pip must stay below it. */
  viewTop: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const stageSeconds = (id: StageId, pace: Pace): number => {
  if (id === "candle") return DAYS * SECONDS_PER_DAY[pace];
  const base = BASE_SECONDS[id];
  return pace === "quick" ? Math.max(QUICK_FLOOR[id] ?? 0, base / 2) : base;
};

/**
 * Latitude of the pip: high on the side, at or just above the air cell's edge (about 25° to 35°
 * for a real egg), a little lower here so the ring of cracks reads from beside the ball, and
 * always below the top of the band people see.
 */
export const pipLatitude = (viewTop: number, r: number): number => {
  const hi = clamp(viewTop - 8 * DEG, 10 * DEG, 40 * DEG);
  return clamp((22 + 8 * r) * DEG, 8 * DEG, hi);
};

/** Times spread over `[a, b]` in `n` bursts of a few, with longer pauses between bursts. */
const bursts = (rng: Rng, a: number, b: number, n: number, gap: number): number[] => {
  const out: number[] = [];
  let t = a + rng.range(0.2, 1);
  while (out.length < n && t < b) {
    const k = 2 + rng.int(3);
    for (let i = 0; i < k && out.length < n && t < b; i++) {
      out.push(t);
      t += gap * rng.range(0.7, 1.3);
    }
    t += gap * rng.range(2.5, 5);
  }
  return out;
};

const planChick = (rng: Rng, dry: Stage, chick: Stage, spin: number): ChickPlan => {
  const glances: ChickPlan["glances"] = [{ at: dry.start, yaw: 0, pitch: -16 * DEG }];
  // Wet and tired at first: the head comes up a third of the way through drying.
  const lift = dry.start + (dry.end - dry.start) * rng.range(0.25, 0.4);
  glances.push({ at: lift, yaw: rng.range(-0.15, 0.15), pitch: -4 * DEG });
  let t = lift + rng.range(4, 8);
  while (t < chick.end - 2) {
    const wide = rng.next() < 0.3;
    glances.push({
      at: t,
      yaw: rng.range(-1, 1) * (wide ? 50 : 25) * DEG,
      pitch: rng.range(-12, 8) * DEG,
    });
    t += rng.range(1.4, 4.5);
  }
  const blinks: number[] = [];
  for (let b = dry.start + rng.range(3, 6); b < chick.end; b += rng.range(2, 6.5)) blinks.push(b);
  const cheeps: number[] = [];
  let c = lift + rng.range(2, 6);
  while (c < chick.end - 1) {
    const k = 1 + rng.int(4);
    for (let i = 0; i < k; i++) cheeps.push(c + i * rng.range(0.35, 0.55));
    c += rng.range(5, 14);
  }
  const span = chick.end - chick.start;
  const doze =
    span > 30
      ? { at: chick.start + span * rng.range(0.45, 0.6), length: Math.min(14, span * 0.2) }
      : null;
  const shakes = [dry.end - rng.range(3, 6), chick.start + span * rng.range(0.15, 0.3)];
  return {
    down: rng.int(4),
    glances,
    blinks,
    cheeps,
    doze,
    shakes,
    turn: Math.sign(spin || 1) * ((2 * Math.PI) / rng.range(45, 60)),
  };
};

const planRocks = (rng: Rng, at: Record<StageId, Stage | undefined>, plan: EggPlan): Rock[] => {
  const rocks: Rock[] = [];
  const add = (t: number, amp: number, freq: number, decay: number) =>
    rocks.push({ at: t, amp, axis: rng.range(0, 2 * Math.PI), freq, decay });
  const stir = at.stir!;
  const span = stir.end - stir.start;
  // Rocks come more often and a little harder as the stirring goes on.
  let t = stir.start + rng.range(0.5, 2);
  while (t < stir.end - 0.5) {
    const f = (t - stir.start) / span;
    add(t, (1 + 2 * f) * DEG * rng.range(0.8, 1.15), rng.range(0.7, 1.0), rng.range(1.2, 2));
    t += rng.range(5.5, 8) * (1 - 0.6 * f);
  }
  for (const tap of plan.taps) add(tap, 0.35 * DEG, 3.5, 7);
  const rest = at.rest!;
  for (let k = 0, n = 3 + rng.int(3); k < n; k++) {
    add(rest.start + (rest.end - rest.start) * rng.range(0.1, 0.95), 0.9 * DEG, 1.6, 4);
  }
  for (const p of plan.pecks) add(p, 0.4 * DEG, 3, 6);
  const zip = at.zip!;
  for (let k = 0, n = 2 + rng.int(3); k < n; k++) {
    add(zip.start + (zip.end - zip.start) * rng.range(0.1, 0.9), 1.6 * DEG, 0.9, 1.8);
  }
  const hatch = at.hatch!;
  add(hatch.start + 0.2, 3.2 * DEG, 0.8, 1.4);
  add(hatch.start + 1.4, 2.2 * DEG, 0.9, 1.6);
  return rocks.sort((a, b) => a.at - b.at);
};

/** Plan egg `index`, starting at show time `start`, after `prev` (null for the first). */
export const planEgg = (
  rng: Rng,
  opts: ShowOptions,
  index: number,
  start: number,
  prev: EggPlan | null,
): EggPlan => {
  const ids = opts.variant === "candling" ? CANDLING_STAGES : HATCH_STAGES;
  const stages: Stage[] = [];
  let t = 0;
  for (const id of ids) {
    let len = stageSeconds(id, opts.pace);
    if (id !== "candle") len *= 1 + rng.range(-JITTER, JITTER);
    if (index === 0 && opts.variant === "hatch" && OPENING[id] !== undefined) len = OPENING[id]!;
    stages.push({ id, start: t, end: t + len });
    t += len;
  }
  const at = Object.fromEntries(stages.map((s) => [s.id, s])) as Record<StageId, Stage | undefined>;
  const kinds = SHELL_GROUPS[opts.shell] ?? SHELL_KINDS;
  const choices = kinds.length > 1 ? kinds.filter((k) => k !== prev?.kind) : kinds;
  const kind = rng.pick(choices);
  // Seen from above the blunt end the chick turns anticlockwise, which is eastwards here.
  const zipDir: 1 | -1 = 1;
  const spin = (2 * Math.PI) / rng.range(65, 85);
  const yaw0 = prev ? rng.range(0, 2 * Math.PI) : 0;
  const pipStage = at.pip!;
  const taps = bursts(rng, pipStage.start, pipStage.end - 1.5, 12 + rng.int(5), 0.45);
  const holeTap = Math.max(2, Math.floor(taps.length * rng.range(0.55, 0.7)));
  const zip = at.zip!;
  // Pecks come in short bursts with longer pauses, as the chick works round.
  const raw: number[] = [];
  let p = 0;
  const nPecks = 22 + rng.int(8);
  while (raw.length < nPecks) {
    for (let k = 0, n = 2 + rng.int(3); k < n && raw.length < nPecks; k++) {
      raw.push(p);
      p += rng.range(0.35, 0.6);
    }
    p += rng.range(4, 7);
  }
  const first = zip.start + rng.range(0.8, 2);
  const scale = (zip.end - 1 - first) / Math.max(1e-6, raw[raw.length - 1]!);
  const pecks = raw.map((r) => first + r * scale);
  const plan: EggPlan = {
    index,
    variant: opts.variant,
    pace: opts.pace,
    kind,
    seed: rng.range(0, 100),
    start,
    stages,
    duration: t,
    secondsPerDay: SECONDS_PER_DAY[opts.pace],
    pip: { lat: pipLatitude(opts.viewTop, rng.next()), lon: 0 },
    zipDir,
    zipSpan: rng.range(0.68, 0.8) * 2 * Math.PI,
    taps,
    holeTap,
    pecks,
    rocks: [],
    yaw0,
    spin,
    chick: planChick(rng, at.dry!, at.chick!, spin),
  };
  // The pip faces longitude 0 when it opens on the first egg, the side the preview looks from.
  const opened = taps[holeTap] ?? pipStage.start;
  plan.pip.lon = prev ? rng.range(-Math.PI, Math.PI) : -(yaw0 + spin * opened);
  plan.rocks = planRocks(rng, at, plan);
  return plan;
};

export const stageAt = (plan: EggPlan, t: number): Stage => {
  for (const s of plan.stages) if (t < s.end) return s;
  return plan.stages[plan.stages.length - 1]!;
};

export const findStage = (plan: EggPlan, id: StageId): Stage | undefined =>
  plan.stages.find((s) => s.id === id);

/** Eggs one after another from show time 0, keeping only the one playing and the next. */
export interface Show {
  readonly opts: ShowOptions;
  /** The egg playing at show time `t`. Time only moves forward between eggs. */
  egg(t: number): EggPlan;
  /** The egg after the current one, planned ahead so its pictures can be made early. */
  next(): EggPlan;
}

export const createShow = (rng: Rng, opts: ShowOptions): Show => {
  let current = planEgg(rng.fork("egg-0"), opts, 0, 0, null);
  let upcoming: EggPlan | null = null;
  const after = (e: EggPlan) =>
    planEgg(rng.fork(`egg-${e.index + 1}`), opts, e.index + 1, e.start + e.duration, e);
  return {
    opts,
    egg(t) {
      while (t >= current.start + current.duration) {
        current = upcoming ?? after(current);
        upcoming = null;
      }
      return current;
    },
    next() {
      upcoming ??= after(current);
      return upcoming;
    },
  };
};
