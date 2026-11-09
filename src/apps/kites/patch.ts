/**
 * One patch of park: its spool kite and (in `duo`) its stunt kite, the controls that fly them,
 * and whether people or the autopilot have them. The spool is a button: held, it reels in and the
 * kite climbs; let go, the kite drifts down; a tap gives a short hop. Stunt handles follow
 * fingers downwards along their travel and spring back when let go. With no finger on them the
 * controls move as the autopilot flies, which shows visitors what to do.
 */
import {
  spoolAutopilot,
  type SpoolPilot,
  spoolPilot,
  stuntAutopilot,
  type StuntPilot,
  stuntPilot,
} from "./autopilot";
import { KITE_IDLE_MS } from "./config";
import {
  type Column,
  createSpool,
  createStunt,
  keepInColumn,
  resetSpool,
  resetStunt,
  SPOOL,
  type SpoolKite,
  stepSpool,
  stepStunt,
  type StuntKite,
  type WindFn,
} from "./kite";
import type { GripId, GripSpec, PatchSpec, SpoolSpec } from "./layout";
import { type SkyFrame, worldX } from "./sky";
import type { Shape } from "./wire";

export type Mode = "auto" | "people";

export interface Grip {
  readonly spec: GripSpec;
  /** Centre y now, venue px. */
  y: number;
  pointer: number | null;
  offset: number;
  target: number;
  human: boolean;
}

export interface SpoolButton {
  readonly spec: SpoolSpec;
  pointer: number | null;
  human: boolean;
  /** Seconds of a tap's hop left. */
  hop: number;
  /** Reeling in now: held, hopping, or held by the autopilot. */
  reeling: boolean;
  /** 0 to 1, eased: how far the button is pressed in, for drawing. */
  press: number;
  /** The reel's turn, radians, for drawing. */
  turn: number;
}

export interface Patch {
  spec: PatchSpec;
  /** Patch index across the whole bank (or frame), for colours and shapes. */
  global: number;
  color: number;
  shape: Shape;
  spool: SpoolKite;
  stunt: StuntKite | null;
  button: SpoolButton;
  grips: { left: Grip | null; right: Grip | null };
  modes: { spool: Mode; stunt: Mode };
  /** Local ms of the last touch (anyone) and the last person's touch, per kite. */
  touched: { spool: number; stunt: number };
  human: { spool: number; stunt: number };
  /** Autopilot phase, so neighbours don't fly in step. */
  phase: number;
  pilot: { spool: SpoolPilot; stunt: StuntPilot };
  /** How far each stunt handle is pulled now, 0 to 1. */
  handles: { left: number; right: number };
  haul: number;
  counts: { flown: number; rings: number; tangles: number };
}

/** A tap reels in for this long, a short hop. */
export const HOP_S = 0.35;
/** A let-go handle springs back this many travels a second. */
const SPRING = 3.2;
/** How fast the reel turns while reeling in and while the line goes back out, rad/s. */
const REEL_IN = 7;
const REEL_OUT = 2.2;

const grip = (spec: GripSpec): Grip => ({
  spec,
  y: spec.restY,
  pointer: null,
  offset: 0,
  target: spec.restY,
  human: false,
});

const button = (spec: SpoolSpec): SpoolButton => ({
  spec,
  pointer: null,
  human: false,
  hop: 0,
  reeling: false,
  press: 0,
  turn: 0,
});

const SPOOL_SHAPES: readonly Shape[] = ["diamond", "fish", "diamond", "bird", "dragon", "diamond"];

export const shapeFor = (global: number): Shape =>
  SPOOL_SHAPES[(global * 5 + 1) % SPOOL_SHAPES.length]!;

/** The column of sky above a patch that its spool kite keeps to, sky units. */
export const columnOf = (spec: PatchSpec, sky: SkyFrame): Column => {
  const half = sky.kite * 0.5;
  const lo = Math.max(sky.bounds.xmin, worldX(sky, spec.x0) + half);
  const hi = Math.min(sky.bounds.xmax, worldX(sky, spec.x1) - half);
  const mid = worldX(sky, spec.cx);
  return lo <= hi ? [lo, hi] : [mid, mid];
};

export const createPatch = (
  spec: PatchSpec,
  global: number,
  sky: SkyFrame,
  side: number,
  phase: number,
): Patch => {
  const ax = worldX(sky, spec.cx);
  return {
    spec,
    global,
    color: global % 8,
    shape: shapeFor(global),
    spool: createSpool(ax, side, columnOf(spec, sky)),
    stunt: spec.stunt ? createStunt(ax, sky.window, side) : null,
    button: button(spec.spool),
    grips: {
      left: spec.stunt ? grip(spec.stunt.left) : null,
      right: spec.stunt ? grip(spec.stunt.right) : null,
    },
    modes: { spool: "auto", stunt: "auto" },
    touched: { spool: Number.NEGATIVE_INFINITY, stunt: Number.NEGATIVE_INFINITY },
    human: { spool: Number.NEGATIVE_INFINITY, stunt: Number.NEGATIVE_INFINITY },
    phase,
    pilot: { spool: spoolPilot(phase), stunt: stuntPilot() },
    handles: { left: 0, right: 0 },
    haul: 0,
    counts: { flown: 0, rings: 0, tangles: 0 },
  };
};

export const gripOf = (p: Patch, id: "left" | "right"): Grip | null =>
  id === "left" ? p.grips.left : p.grips.right;

const kiteOf = (id: GripId): "spool" | "stunt" => (id === "spool" ? "spool" : "stunt");

/** A finger came down on control `id` at venue y. */
export const grab = (
  p: Patch,
  id: GripId,
  pointer: number,
  y: number,
  human: boolean,
  now: number,
) => {
  const which = kiteOf(id);
  if (id !== "spool" && !gripOf(p, id)) return;
  if (human && p.modes[which] === "auto") p.counts.flown++;
  p.modes[which] = "people";
  p.touched[which] = now;
  if (human) p.human[which] = now;
  if (id === "spool") {
    const b = p.button;
    b.pointer = pointer;
    b.human = human;
    b.hop = HOP_S;
    return;
  }
  const g = gripOf(p, id)!;
  g.pointer = pointer;
  g.human = human;
  // Taking a grip mid-travel keeps it where it is under the finger.
  g.offset = Math.max(-g.spec.h, Math.min(g.spec.h, y - g.y));
  g.target = g.y;
};

export const drag = (p: Patch, id: GripId, pointer: number, y: number, now: number) => {
  const which = kiteOf(id);
  if (id === "spool") {
    if (p.button.pointer !== pointer) return;
    p.touched.spool = now;
    if (p.button.human) p.human.spool = now;
    return;
  }
  const g = gripOf(p, id);
  if (!g || g.pointer !== pointer) return;
  g.target = y - g.offset;
  p.touched[which] = now;
  if (g.human) p.human[which] = now;
};

export const release = (p: Patch, id: GripId, pointer: number) => {
  if (id === "spool") {
    if (p.button.pointer === pointer) p.button.pointer = null;
    return;
  }
  const g = gripOf(p, id);
  if (!g || g.pointer !== pointer) return;
  g.pointer = null;
};

/** Let go of every control (a reset, or a resize). */
export const releaseAll = (p: Patch) => {
  p.button.pointer = null;
  for (const g of [p.grips.left, p.grips.right]) if (g) g.pointer = null;
};

const moveGrip = (g: Grip, dt: number, want: number | null) => {
  const s = g.spec;
  if (g.pointer !== null) {
    g.y = Math.min(s.restY + s.travel, Math.max(s.restY, g.target));
  } else if (want !== null) {
    g.y = Math.min(s.restY + s.travel, Math.max(s.restY, want));
  } else {
    g.y = Math.max(s.restY, g.y - SPRING * s.travel * dt);
  }
};

/** How far a grip is pulled, 0 to 1. */
export const pulled = (g: Grip): number => (g.y - g.spec.restY) / g.spec.travel;

/** Move the anchors to a new sky (the screen came or went), keeping each kite's place. */
export const rebase = (p: Patch, sky: SkyFrame) => {
  const ax = worldX(sky, p.spec.cx);
  const d = ax - p.spool.ax;
  const [lo, hi] = columnOf(p.spec, sky);
  p.spool.ax = ax;
  p.spool.colMin = lo;
  p.spool.colMax = hi;
  keepInColumn(p.spool);
  p.spool.px = p.spool.x;
  p.spool.py = p.spool.y;
  if (p.stunt) {
    p.stunt.ax = ax;
    p.stunt.x += d;
    p.stunt.px = p.stunt.x;
    p.stunt.py = p.stunt.y;
  }
};

/** Back to the start: kites reeled in to their resting line, the autopilot flying them. */
export const resetPatch = (p: Patch, sky: SkyFrame, side: number) => {
  releaseAll(p);
  resetSpool(p.spool, side);
  if (p.stunt) resetStunt(p.stunt, sky.window, side);
  p.modes.spool = "auto";
  p.modes.stunt = "auto";
  p.touched.spool = p.touched.stunt = Number.NEGATIVE_INFINITY;
  p.human.spool = p.human.stunt = Number.NEGATIVE_INFINITY;
  p.haul = 0;
  p.pilot.spool = spoolPilot(p.phase);
  p.pilot.stunt = stuntPilot();
  p.handles.left = p.handles.right = 0;
  p.button.hop = 0;
  p.button.reeling = false;
  for (const g of [p.grips.left, p.grips.right]) if (g) g.y = g.spec.restY;
};

/** Hold-to-reset: reel both kites in and relaunch them, still the visitors'. */
export const relaunch = (p: Patch, sky: SkyFrame, now: number) => {
  resetSpool(p.spool);
  if (p.stunt) resetStunt(p.stunt, sky.window);
  p.touched.spool = p.touched.stunt = now;
  p.modes.spool = p.modes.stunt = "people";
};

/** Who has a finger on a kite's control now: a person, a bot, or nobody. */
export const heldBy = (p: Patch, which: "spool" | "stunt"): "person" | "bot" | null => {
  const on =
    which === "spool"
      ? [p.button]
      : [p.grips.left, p.grips.right].filter((g): g is Grip => g !== null);
  let held: "person" | "bot" | null = null;
  for (const c of on) {
    if (c.pointer === null) continue;
    if (c.human) return "person";
    held = "bot";
  }
  return held;
};

/**
 * One step. `t` is the shared clock in seconds (for the autopilot's rhythm), `now` local ms (for
 * touch timeouts).
 */
export const stepPatch = (
  p: Patch,
  dt: number,
  t: number,
  now: number,
  wind: WindFn,
  sky: SkyFrame,
): void => {
  for (const which of ["spool", "stunt"] as const) {
    if (p.modes[which] !== "people") continue;
    const held = heldBy(p, which);
    // A finger held still is still flying it.
    if (held) p.touched[which] = now;
    if (held === "person") p.human[which] = now;
    if (!held && now - p.touched[which] > KITE_IDLE_MS) p.modes[which] = "auto";
  }

  // Spool.
  const b = p.button;
  if (b.hop > 0) b.hop = Math.max(0, b.hop - dt);
  if (p.modes.spool === "auto") {
    b.hop = 0;
    b.reeling = spoolAutopilot(p.spool, t, p.phase, sky.bounds.top, p.pilot.spool, dt);
  } else {
    b.reeling = b.pointer !== null || b.hop > 0;
  }
  b.press += ((b.reeling ? 1 : 0) - b.press) * Math.min(1, dt / 0.05);
  p.haul = b.reeling ? SPOOL.hold : 0;
  stepSpool(p.spool, p.haul, wind, sky.bounds, dt);
  const spin = b.reeling ? REEL_IN : p.spool.lengthRate < -0.01 ? -REEL_OUT : 0;
  b.turn = (b.turn + spin * dt) % (Math.PI * 2);

  // Stunt.
  const k = p.stunt;
  const gl = p.grips.left;
  const gr = p.grips.right;
  if (k && gl && gr) {
    let held: boolean;
    if (p.modes.stunt === "auto") {
      const s = stuntAutopilot(k, sky.window, t, p.phase, p.pilot.stunt, dt);
      moveGrip(gl, dt, gl.spec.restY + s.left * gl.spec.travel);
      moveGrip(gr, dt, gr.spec.restY + s.right * gr.spec.travel);
      held = true;
    } else {
      moveGrip(gl, dt, null);
      moveGrip(gr, dt, null);
      held = gl.pointer !== null || gr.pointer !== null;
      // The autopilot takes over from wherever the handles are.
      p.pilot.stunt.left = pulled(gl);
      p.pilot.stunt.right = pulled(gr);
    }
    p.handles.left = pulled(gl);
    p.handles.right = pulled(gr);
    stepStunt(
      k,
      { held, left: p.handles.left, right: p.handles.right },
      wind,
      sky.window,
      sky.bounds,
      dt,
    );
  }
};
