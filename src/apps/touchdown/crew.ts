/**
 * One crew's game: its terrain, its craft and the runs it flies, with the autopilot for attract,
 * the lone visitor's helper, fuel, ghosts and what happens after a landing or a bump. Time comes
 * in from outside (`dt` seconds per step, `now` in ms for touches), so it runs the same in tests.
 *
 * Runs: the craft enters at the terrain's start point and descends. A landing shows its stars;
 * anything else is a bump: the craft bounces and tips over in a puff of dust. The next run starts
 * a few seconds later. After a bump the terrain stays and the ghost replays the best landing on
 * it, or else the last run. After a landing the terrain stays once, so the crew can chase their
 * ghost onto a better pad; a three-star landing or a second landing brings new terrain.
 */
import type { Rng } from "../../core/types";
import {
  type Config,
  CREW_IDLE_MS,
  ENGINE_CAP_S,
  GHOST_FADE_MS,
  NEXT_RUN_MS,
  TANK_S,
} from "./config";
import {
  type Bump,
  type Craft,
  contactOf,
  NO_THRUST,
  type Physics,
  physicsFor,
  standY,
  stepCraft,
  type Thrust,
} from "./craft";
import { clearTrack, copyTrack, createTrack, FLAG, type GhostTrack, record } from "./ghost";
import { createHelper, HELPED_S, type Helper, resetHelper, updateHelper } from "./helper";
import type { CrewSpec, Layout, PadRole } from "./layout";
import { choosePlan, type Command, nearestPad, type Plan, pulse, steer } from "./pilot";
import {
  generateTerrain,
  type LandingPad,
  peakBetween,
  type Terrain,
  terrainInputOf,
} from "./terrain";
import { CALM, type WindFn, windFor } from "./wind";

export type Mode = "auto" | "people";
export type Phase = "flying" | "landed" | "bumped";

export type CrewEvent =
  | { kind: "start"; crew: number }
  | { kind: "land"; crew: number; x: number; y: number; stars: number }
  | { kind: "bump"; crew: number; x: number; y: number; why: Bump }
  | { kind: "tipped"; crew: number; x: number; y: number }
  | { kind: "terrain"; crew: number };

export interface Outcome {
  kind: "land" | "bump";
  stars: number;
  why: Bump | null;
  pad: LandingPad | null;
  /** Pose at the moment of contact. */
  x: number;
  y: number;
  a: number;
  vx: number;
  impact: number;
  /** Bump: which way the craft tips. */
  tip: number;
}

export interface CrewDeps {
  spec: CrewSpec;
  layout: Layout;
  config: Config;
  rng: Rng;
  /** Events for the renderer; the crew keeps at most a few queued. */
  events: CrewEvent[];
}

/** Carelessness of the attract autopilot: how often it comes in too fast and bumps. */
const ATTRACT_CARELESS = 0.18;
const MAX_EVENTS = 24;

export interface Crew {
  readonly spec: CrewSpec;
  readonly physics: Physics;
  readonly terrain: Terrain;
  readonly craft: Craft;
  /** The pose before the last step, for interpolated drawing. */
  readonly prev: Craft;
  readonly mode: Mode;
  readonly phase: Phase;
  /** Seconds since this run started, and since the phase began. */
  readonly runT: number;
  readonly phaseT: number;
  readonly run: number;
  readonly fuel: number;
  readonly thrust: Thrust;
  /** The helper's pad (0 left, 1 right) while it is flying, else null. */
  readonly helping: 0 | 1 | null;
  readonly sputtering: boolean;
  /** Out of fuel, or past the engine time limit: engines only sputter. */
  readonly spent: boolean;
  readonly outcome: Outcome | null;
  /** The track replayed as this run's ghost, and how visible it is (0 to 1). */
  readonly ghost: GhostTrack | null;
  readonly ghostAlpha: number;
  /** Changes whenever the terrain does, so the renderer knows to redraw it. */
  readonly terrainVersion: number;
  /** The label the terrain's random stream was forked with (`terrain:<key>`), for screens. */
  readonly terrainKey: number;
  readonly plan: Plan | null;
  readonly wind: number;
  readonly lastHuman: number;
  readonly lastPlay: number;
  readonly counts: { runs: number; landings: number; bumps: number; stars: number };
  /** Hold state of this crew's pads (any finger, person or bot). */
  setHeld(role: PadRole, held: boolean): void;
  /** A touch went down on one of this crew's pads. */
  touched(human: boolean, now: number): void;
  step(dt: number, now: number): void;
  /** What the autopilot would do now: for bots. Null when not flying. */
  advice(): Command | null;
  /** Hold-to-reset: a fresh run on the same terrain. */
  restart(now: number): void;
  newTerrain(): void;
  /** Back to the autopilot, with new terrain and no ghosts. */
  reset(): void;
}

const copyCraft = (from: Craft, to: Craft) => {
  to.x = from.x;
  to.y = from.y;
  to.vx = from.vx;
  to.vy = from.vy;
  to.a = from.a;
  to.w = from.w;
};

const ease = (f: number) => (f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f));

export const createCrew = (d: CrewDeps): Crew => {
  const { spec, layout, config } = d;
  const physics = physicsFor(layout, spec.lane, config.assist);
  const S = layout.craft;
  const q = physics.q;
  const duo = config.variant === "duo";
  const held: Record<PadRole, boolean> = {
    left: false,
    right: false,
    main: false,
    turnLeft: false,
    turnRight: false,
  };
  const craft: Craft = { x: 0, y: 0, vx: 0, vy: 0, a: 0, w: 0 };
  const prev: Craft = { ...craft };
  const thrust: Thrust = { ...NO_THRUST };
  const helper: Helper = createHelper();
  const rec = createTrack();
  const last = createTrack();
  const best = createTrack();
  const counts = { runs: 0, landings: 0, bumps: 0, stars: 0 };

  let terrain: Terrain = {
    xs: new Float32Array(0),
    ys: new Float32Array(0),
    pads: [],
    spawn: { x: 0, vx: 0 },
  };
  let terrainVersion = 0;
  let terrainKey = 0;
  let landingsHere = 0;
  let mode: Mode = "auto";
  let phase: Phase = "flying";
  let runT = 0;
  let phaseT = 0;
  let run = 0;
  let fuel = 1;
  let sputtering = false;
  let outcome: Outcome | null = null;
  let ghost: GhostTrack | null = null;
  let ghostAlpha = 0;
  let plan: Plan | null = null;
  let windFn: WindFn = CALM;
  let wind = 0;
  let lastHuman = Number.NEGATIVE_INFINITY;
  let lastPlay = Number.NEGATIVE_INFINITY;

  const emit = (e: CrewEvent) => {
    d.events.push(e);
    if (d.events.length > MAX_EVENTS) d.events.splice(0, d.events.length - MAX_EVENTS);
  };

  const makeTerrain = () => {
    terrainKey = run;
    terrain = generateTerrain(d.rng.fork(`terrain:${run}`), terrainInputOf(layout, spec, q));
    terrainVersion++;
    landingsHere = 0;
    clearTrack(last);
    clearTrack(best);
    ghost = null;
    emit({ kind: "terrain", crew: spec.index });
  };

  const startRun = (next: Mode) => {
    run++;
    counts.runs++;
    mode = next;
    phase = "flying";
    runT = 0;
    phaseT = 0;
    fuel = 1;
    sputtering = false;
    outcome = null;
    craft.x = terrain.spawn.x;
    craft.y = layout.spawnY;
    craft.vx = terrain.spawn.vx;
    craft.vy = 14 * q;
    craft.a = 0;
    craft.w = 0;
    copyCraft(craft, prev);
    Object.assign(thrust, NO_THRUST);
    resetHelper(helper);
    clearTrack(rec);
    record(rec, 0, craft.x, craft.y, craft.a, 0);
    windFn = windFor(config.wind, d.rng.fork(`wind:${run}`), q);
    const careless = next === "auto" ? ATTRACT_CARELESS : 0;
    plan = choosePlan(terrain, d.rng.fork(`plan:${run}`), S, careless);
    ghost = best.n > 0 ? best : last.n > 0 ? last : null;
    ghostAlpha = ghost ? 1 : 0;
    emit({ kind: "start", crew: spec.index });
  };

  const clearGhosts = () => {
    clearTrack(last);
    clearTrack(best);
    ghost = null;
  };

  const flagsOf = (th: Thrust): number =>
    (th.left ? FLAG.left : 0) |
    (th.right ? FLAG.right : 0) |
    (th.main ? FLAG.main : 0) |
    (th.turnLeft ? FLAG.turnLeft : 0) |
    (th.turnRight ? FLAG.turnRight : 0);

  const advice = (): Command | null => {
    if (phase !== "flying" || !plan) return null;
    const left = config.fuel ? fuel : 1 - runT / ENGINE_CAP_S;
    // Running low with the pad still far off: settle for the nearest one.
    if (left < 0.35 && Math.max(plan.pad.x0 - craft.x, craft.x - plan.pad.x1) > S) {
      const near = nearestPad(terrain, craft.x);
      if (near) plan.pad = near;
    }
    return steer(craft, terrain, physics, plan, wind, left);
  };

  const engines = (dt: number, now: number) => {
    if (mode === "auto") {
      const cmd = advice();
      thrust.left = !!cmd && pulse(cmd.left, runT);
      thrust.right = !!cmd && pulse(cmd.right, runT);
      thrust.main = !!cmd && pulse(cmd.main, runT);
      thrust.turnRight = !!cmd && cmd.turn > 0 && pulse(cmd.turn, runT);
      thrust.turnLeft = !!cmd && cmd.turn < 0 && pulse(-cmd.turn, runT);
    } else {
      thrust.left = held.left;
      thrust.right = held.right;
      thrust.main = held.main;
      thrust.turnLeft = held.turnLeft;
      thrust.turnRight = held.turnRight;
      if (duo) {
        updateHelper(helper, [held.left, held.right], now, craft, runT);
        if (helper.side === 0) thrust.left = helper.firing;
        if (helper.side === 1) thrust.right = helper.firing;
      }
    }
    const out = (config.fuel && fuel <= 0) || runT > ENGINE_CAP_S;
    const any = thrust.left || thrust.right || thrust.main || thrust.turnLeft || thrust.turnRight;
    sputtering = out && any;
    thrust.power = out ? 0 : 1;
    if (config.fuel && !out) {
      const use = duo
        ? (thrust.left ? 1 : 0) + (thrust.right ? 1 : 0)
        : (thrust.main ? 2 : 0) + (thrust.turnLeft ? 0.3 : 0) + (thrust.turnRight ? 0.3 : 0);
      fuel = Math.max(0, fuel - (use * dt) / TANK_S);
    }
  };

  const resolve = (pad: LandingPad | null, why: Bump | null) => {
    const base = {
      x: craft.x,
      y: craft.y,
      a: craft.a,
      vx: craft.vx,
      impact: Math.max(0, craft.vy),
    };
    Object.assign(thrust, NO_THRUST);
    phaseT = 0;
    if (pad) {
      let stars = pad.stars;
      if (runT - helper.flewAt < HELPED_S) stars = Math.min(stars, 2);
      outcome = { kind: "land", stars, why: null, pad, tip: 0, ...base };
      phase = "landed";
      counts.landings++;
      counts.stars += stars;
      rec.stars = stars;
      emit({ kind: "land", crew: spec.index, x: craft.x, y: pad.y, stars });
    } else {
      const tip = Math.sign(craft.a) || Math.sign(craft.vx) || (run % 2 ? 1 : -1);
      outcome = { kind: "bump", stars: 0, why, pad: null, tip, ...base };
      phase = "bumped";
      counts.bumps++;
      rec.stars = 0;
      emit({
        kind: "bump",
        crew: spec.index,
        x: craft.x,
        y: craft.y + 0.4 * S,
        why: why ?? "hull",
      });
    }
  };

  /** After contact: settle onto the pad, or bounce and tip over. */
  const animate = (dt: number) => {
    const o = outcome;
    if (!o) return;
    craft.w = 0;
    if (o.kind === "land" && o.pad) {
      const f = ease(phaseT / 0.35);
      craft.x = Math.min(o.pad.x1, Math.max(o.pad.x0, o.x));
      craft.y = o.y + (standY(o.pad.y, S) - o.y) * f;
      craft.a = o.a * (1 - f);
      craft.vx = 0;
      craft.vy = 0;
      return;
    }
    const T1 = 0.5;
    const T2 = 1.15;
    const t = phaseT;
    const drift = Math.max(-30 * q, Math.min(30 * q, o.vx * 0.5));
    const x = Math.min(physics.x1, Math.max(physics.x0, o.x + drift * Math.min(t, T2)));
    const lift = 0.3 * S * Math.max(0.6, Math.min(1.5, o.impact / Math.max(1, physics.landVy)));
    const tipped = o.tip * 1.48;
    // On its side the craft is about as tall as it was wide; rest it on the highest ground.
    const rest = peakBetween(terrain, x - 0.45 * S, x + 0.45 * S) - 0.47 * S;
    const prevPhaseT = t - dt;
    craft.x = x;
    if (t < T1) {
      const f = t / T1;
      craft.y = o.y - lift * 4 * f * (1 - f);
      craft.a = o.a + (tipped * 0.45 - o.a) * f;
    } else {
      const f = ease((t - T1) / (T2 - T1));
      craft.y = o.y + (rest - o.y) * f;
      craft.a = tipped * (0.45 + 0.55 * f);
      if (prevPhaseT < T2 && t >= T2)
        emit({ kind: "tipped", crew: spec.index, x, y: rest + 0.47 * S });
    }
    craft.vx = 0;
    craft.vy = 0;
  };

  const nextRun = (now: number) => {
    const o = outcome;
    const people = mode === "people";
    const stay = people && now - lastPlay <= CREW_IDLE_MS;
    let fresh = people && !stay;
    if (o?.kind === "land") {
      landingsHere++;
      if (o.stars > best.stars || best.n === 0) copyTrack(rec, best);
      copyTrack(rec, last);
      if (!people || o.stars >= 3 || landingsHere >= 2) fresh = true;
    } else {
      copyTrack(rec, last);
    }
    if (fresh) makeTerrain();
    startRun(stay || !people ? mode : "auto");
  };

  const crew: Crew = {
    spec,
    physics,
    get terrain() {
      return terrain;
    },
    craft,
    prev,
    get mode() {
      return mode;
    },
    get phase() {
      return phase;
    },
    get runT() {
      return runT;
    },
    get phaseT() {
      return phaseT;
    },
    get run() {
      return run;
    },
    get fuel() {
      return fuel;
    },
    thrust,
    get helping() {
      return mode === "people" && phase === "flying" ? helper.side : null;
    },
    get sputtering() {
      return sputtering;
    },
    get spent() {
      return (config.fuel && fuel <= 0) || runT > ENGINE_CAP_S;
    },
    get outcome() {
      return outcome;
    },
    get ghost() {
      return ghost;
    },
    get ghostAlpha() {
      return ghostAlpha;
    },
    get terrainVersion() {
      return terrainVersion;
    },
    get terrainKey() {
      return terrainKey;
    },
    get plan() {
      return plan;
    },
    get wind() {
      return wind;
    },
    get lastHuman() {
      return lastHuman;
    },
    get lastPlay() {
      return lastPlay;
    },
    counts,
    setHeld(role, on) {
      held[role] = on;
    },
    touched(human, now) {
      lastPlay = now;
      if (human) lastHuman = now;
      if (mode === "auto") {
        // The first touch ends the autopilot's run and starts the crew's.
        clearGhosts();
        landingsHere = 0;
        startRun("people");
      }
    },
    step(dt, now) {
      copyCraft(craft, prev);
      runT += dt;
      phaseT += dt;
      wind = windFn(runT);
      if (phase === "flying") {
        engines(dt, now);
        stepCraft(craft, thrust, physics, wind, dt);
        const c = contactOf(craft, terrain, physics);
        if (c) resolve(c.kind === "land" ? c.pad : null, c.kind === "bump" ? c.why : null);
      } else {
        animate(dt);
        if (phaseT * 1000 >= NEXT_RUN_MS) nextRun(now);
      }
      record(rec, runT, craft.x, craft.y, craft.a, phase === "flying" ? flagsOf(thrust) : 0);
      if (ghost) {
        const fading = mode === "people" && now - lastPlay > GHOST_FADE_MS;
        if (fading) {
          ghostAlpha = Math.max(0, ghostAlpha - dt / 2);
          if (ghostAlpha === 0) clearGhosts();
        }
      }
    },
    advice,
    restart(now) {
      lastPlay = now;
      lastHuman = now;
      if (mode === "auto") {
        clearGhosts();
        landingsHere = 0;
      } else if (phase !== "flying" || runT > 1) {
        copyTrack(rec, last);
      }
      startRun("people");
    },
    newTerrain() {
      makeTerrain();
      startRun(mode);
    },
    reset() {
      lastHuman = Number.NEGATIVE_INFINITY;
      lastPlay = Number.NEGATIVE_INFINITY;
      makeTerrain();
      startRun("auto");
    },
  };

  makeTerrain();
  startRun("auto");
  return crew;
};
