/**
 * A touch frame's races without the drawing: its lanes and who flies them, the plan it follows
 * (plan.ts), its reports to the leader (board.ts) and, when it leads, the bank's heat (heats.ts).
 *
 * - A lane is joined while its station plays, by a person or by a test bot (`bots=`).
 * - On a frame racing alone (`lone`) and in a bank's attract, idle lanes fly faded bots. A frame
 *   with no peers adds rivals, and the solo panel races the ghost of its best recent run too.
 * - In a bank race only the lanes joined when it starts are racers. Idle lanes fly nothing. A
 *   lane that joins mid-race flies an unranked practice run at once, which isn't reported, and
 *   races from the next countdown. Players stay in from race to race until they leave: no touch
 *   through a whole race, QUIET_S of flight without a tap, or AWAY_MS without any touch.
 */
import type { Channel, Rng } from "../../core/types";
import { createBoard } from "./board";
import {
  ADULT,
  type Body,
  COUNTDOWN_MS,
  FLAP_DEBOUNCE_MS,
  type FlapConfig,
  FLOOR_Y,
  RADIUS,
  STANDARD,
  START_Y,
} from "./config";
import { buildCourse, type Course } from "./course";
import {
  createFlight,
  distanceOf,
  flap,
  type Flight,
  type FlightEvent,
  launch,
  resetFlight,
  type Rules,
  stepFlight,
} from "./flight";
import { createGhosts, type Run } from "./ghost";
import { createHeats, type Heats } from "./heats";
import { LOBBY_MAX_MS } from "./lobby";
import { createPilot, laneBias, type Pilot, SKILLS } from "./pilot";
import { type Entry, placings } from "./placing";
import { type LocalPhase, type Play, type Plan, planFor } from "./plan";
import { raceAt } from "./race";
import { type Ctrl, type LaneReport, laneId } from "./wire";

const REPORT_MS = 100;
/** Reports with no glider in the race: just which lanes have joined, for the lobby. */
const IDLE_REPORT_MS = 500;
/** A person who stops tapping while their glider flies for this long gives the lane back. */
export const QUIET_S = 15;
/** Rivals in a frame racing on its own, so there are always at least this many gliders. */
const FIELD = 3;
/** A practice glider that crashed or finished takes off again on a tap after this long. */
const RELAUNCH_S = 0.8;
/** Results loop radius, course px. */
export const LOOP_R = 150;

/** Longer than any wait for a race: the time limit, the longest lobby and the countdown. */
export const awayMs = (cfg: Pick<FlapConfig, "race">): number =>
  cfg.race * 1000 + LOBBY_MAX_MS + COUNTDOWN_MS + 30_000;

export interface LaneSlot {
  slot: number;
  adult: boolean;
}

export interface GameLane {
  readonly slot: number;
  readonly id: number;
  adult: boolean;
  body: Body;
  flight: Flight;
  pilot: Pilot;
  /** Who flies it: a person, a test bot, or a faded attract bot while nobody has joined. */
  ctrl: Ctrl;
  joined: boolean;
  /** In the bank race now. */
  racer: boolean;
  /** Flying an unranked practice run until the next race. */
  practice: boolean;
  /** The race this lane last raced in, whose result it shows. */
  raced: number;
  /** Seconds into the race its flight began (a practice run's own clock). */
  t0: number;
  /** Touched since its flight began. */
  touched: boolean;
  /** Local ms of the last touch and the last flap. */
  lastTouch: number;
  lastFlap: number;
  /** Seconds flying without a tap from the person. */
  quiet: number;
  /** Where the results loop is centred. */
  loop: { x: number; y: number } | null;
  /** The flight being recorded for the ghost. */
  recording: boolean;
  emit: (e: FlightEvent) => void;
}

export interface Rival {
  id: number;
  /** Order after the frame's lanes, for its colour. */
  index: number;
  flight: Flight;
  pilot: Pilot;
  body: Body;
  loop: { x: number; y: number } | null;
  emit: (e: FlightEvent) => void;
}

export interface GameDeps {
  net: Channel;
  /** Clock ms. */
  now(): number;
  /** Local monotonic ms. */
  local(): number;
  cfg: FlapConfig;
  /** The solo setup: always races on its own. */
  solo: boolean;
  pos: number;
  count: number;
  rng(label?: string): Rng;
  /** The solo panel races its ghost. */
  useGhost(): boolean;
  /** The lane's person has gone: end its station (which calls `leave`). */
  endStation(slot: number): void;
  /** A glider's flight events, for effects. */
  onEvent?(who: GameLane | Rival, lane: GameLane | null, e: FlightEvent): void;
  /** A lane's glider is back on the start line or taking off: reset its camera. */
  onRestart?(lane: GameLane): void;
}

export interface Game {
  readonly lanes: readonly GameLane[];
  readonly rivals: readonly Rival[];
  readonly plan: Plan;
  readonly phase: LocalPhase | null;
  readonly course: Course | null;
  readonly ghost: Run | null;
  readonly board: ReturnType<typeof createBoard>;
  readonly heats: Heats | null;
  /** Race ms now (negative before the start). */
  raceT(): number;
  /** Replace the lanes (the frame changed shape), keeping each slot's flight. */
  setLanes(slots: readonly LaneSlot[]): void;
  join(slot: number, bot: boolean): void;
  leave(slot: number): void;
  /** A touch in a lane: flaps a person's glider. */
  tap(slot: number): void;
  /** Whether a lane shows a glider now. */
  shows(l: GameLane): boolean;
  /** A lane's place now, or null. */
  placeOf(l: GameLane): number | null;
  update(dt: number): void;
  dispose(): void;
}

const flying = (f: Flight) => f.mode === "flying" || f.mode === "tumbling";

export const createGame = (deps: GameDeps): Game => {
  const { cfg, net, pos, solo } = deps;
  const rules: Rules = { crash: cfg.crash, base: cfg.base, race: cfg.race };
  const seedRng = deps.rng();
  const ghosts = createGhosts();
  const away = awayMs(cfg);
  let lanes: GameLane[] = [];
  let rivals: Rival[] = [];
  let course: Course | null = null;
  let ghost: Run | null = null;
  let k = -1;
  let label = "";
  let phase: LocalPhase | null = null;
  let play: Play | null = null;
  let lastReport = -Infinity;
  let lastMask = -1;

  const board = createBoard({
    net,
    local: deps.local,
    onFly: (fly) => {
      if (fly.heat) heats?.offer(fly.heat);
    },
  });

  const heats: Heats | null = solo
    ? null
    : createHeats({
        net,
        now: deps.now,
        local: deps.local,
        raceMs: cfg.race * 1000,
        joined: () => board.joined(),
        done: (ids) => board.done(ids),
        attractK: () => raceAt(deps.now(), cfg).k,
        racing: (rk) =>
          board.k === rk
            ? [...board.lanes.values()].filter((l) => l.ctrl !== "attract").map((l) => l.id)
            : [],
        onEnd: (h) => board.decide(h.lanes),
      });

  const hasPeers = () => net.peers().some((p) => p.frame !== net.self);

  let plan: Plan = planFor({
    now: deps.now(),
    cfg,
    solo,
    lone: true,
    heat: null,
    joined: false,
    current: null,
  });

  const raceT = () => deps.now() - plan.start;

  // ---- Lanes ---------------------------------------------------------------------------------

  const makeLane = (s: LaneSlot, prev: GameLane | undefined): GameLane => {
    const lane: GameLane = {
      slot: s.slot,
      id: laneId(pos, s.slot),
      adult: s.adult,
      body: s.adult ? ADULT : STANDARD,
      flight: prev?.flight ?? createFlight(),
      pilot:
        prev?.pilot ??
        createPilot(
          deps.rng(`treetop:pilot:${pos}:${s.slot}`),
          SKILLS.attract,
          laneBias(pos * 4 + s.slot),
        ),
      ctrl: "attract",
      joined: false,
      racer: false,
      practice: false,
      raced: -1,
      t0: 0,
      touched: false,
      lastTouch: -Infinity,
      lastFlap: -Infinity,
      quiet: 0,
      loop: prev?.loop ?? null,
      recording: false,
      emit: () => {},
    };
    lane.emit = eventsOf(lane, lane);
    return lane;
  };

  const eventsOf = (who: GameLane | Rival, lane: GameLane | null) => (e: FlightEvent) => {
    if (e.type === "finish" && lane) {
      // A practice run's finish is its own business.
      if (play !== "bank" || lane.racer) board.finished(lane.id, e.t);
      if (lane.recording) {
        ghosts.finish(e.t, distanceOf(who.flight));
        lane.recording = false;
      }
    }
    deps.onEvent?.(who, lane, e);
  };

  const byslot = (slot: number) => lanes.find((l) => l.slot === slot);

  const restart = (l: GameLane) => {
    l.loop = null;
    deps.onRestart?.(l);
  };

  // ---- Races ---------------------------------------------------------------------------------

  const rivalCount = () => (play === "lone" ? Math.max(0, FIELD - lanes.length) : 0);

  const makeRivals = () => {
    const want = rivalCount();
    if (rivals.length === want) return;
    rivals = Array.from({ length: want }, (_, i) => {
      const flight = createFlight();
      // Spread out on the start line so the field is easy to tell apart.
      flight.home = START_Y + (i % 2 === 0 ? -170 : 170) * (1 + Math.floor(i / 2));
      const rival: Rival = {
        id: 1000 + i,
        index: lanes.length + i,
        flight,
        pilot: createPilot(
          deps.rng(`treetop:rival:${pos}:${i}`),
          SKILLS.rival,
          i % 2 === 0 ? -0.22 : 0.22,
        ),
        body: STANDARD,
        loop: null,
        emit: () => {},
      };
      rival.emit = eventsOf(rival, null);
      return rival;
    });
  };

  const newRace = (p: Plan) => {
    k = p.k;
    label = p.label;
    course = buildCourse(seedRng, p.label, cfg);
    board.race(k);
    makeRivals();
    for (const l of lanes) {
      if (l.recording) ghosts.abandon();
      l.recording = false;
      resetFlight(l.flight);
      l.pilot.reset();
      l.racer = false;
      l.practice = false;
      restart(l);
    }
    for (const rv of rivals) {
      resetFlight(rv.flight);
      rv.pilot.reset();
      rv.loop = null;
    }
    ghost = deps.useGhost() && course ? ghosts.best(course.label) : null;
    phase = p.phase === "lobby" ? "lobby" : "countdown";
  };

  const switchPlay = (p: Plan) => {
    const was = play;
    play = p.play;
    makeRivals();
    if (play === "bank" && was !== "bank") {
      // The bots leave, and anyone who has just joined waits for the leader's race.
      // A race already under way is a practice run for them.
      const t = Math.max(0, (deps.now() - p.start) / 1000);
      for (const l of lanes) {
        resetFlight(l.flight);
        l.pilot.reset();
        l.racer = false;
        l.practice = l.joined && p.phase === "racing";
        if (l.practice) {
          launch(l.flight, l.body, rules, 0);
          l.t0 = t;
        }
        restart(l);
      }
      phase = p.phase;
    } else if (was === "bank") {
      // Back to the cadence: start its race afresh, so the bots join it where it is.
      k = -1;
    }
  };

  const startRacing = (p: Plan) => {
    const t = Math.max(0, (deps.now() - p.start) / 1000);
    for (const l of lanes) {
      if (play === "bank" && !l.joined) continue;
      launch(l.flight, l.body, rules, t);
      l.t0 = 0;
      l.touched = false;
      l.racer = l.joined;
      l.practice = false;
      if (l.joined) l.raced = k;
    }
    for (const rv of rivals) launch(rv.flight, rv.body, rules, t);
    const lead = lanes[0];
    if (lead && deps.useGhost() && course) {
      ghosts.start(course.label, cfg.race * 1000);
      lead.recording = true;
    }
  };

  /** The leader's racers decide who is in, whatever this frame guessed at the start. */
  const reconcile = (racers: ReadonlySet<number>) => {
    for (const l of lanes) {
      if (!l.joined) continue;
      const counted = racers.has(l.id);
      if (counted && !l.racer) {
        l.racer = true;
        l.practice = false;
        l.raced = k;
        l.t0 = 0;
      } else if (!counted && l.racer) {
        l.racer = false;
        l.practice = true;
      }
    }
  };

  const loopCentre = (f: Flight) =>
    f.mode === "out" || f.mode === "waiting"
      ? null
      : { x: f.x, y: Math.min(FLOOR_Y - LOOP_R - RADIUS * 2, Math.max(LOOP_R + 120, f.y)) };

  const endRacing = () => {
    const gone: GameLane[] = [];
    for (const l of lanes) {
      if (l.recording) ghosts.finish(l.flight.fin, distanceOf(l.flight));
      l.recording = false;
      if (play === "bank" && l.practice) {
        // Back to the start line: the next race is theirs.
        resetFlight(l.flight);
        l.practice = false;
        restart(l);
        continue;
      }
      if (play === "bank" && !l.racer) continue;
      l.loop = loopCentre(l.flight);
      // Someone who didn't touch at all through a race has gone.
      if (l.ctrl === "human" && l.flight.mode !== "waiting" && !l.touched) gone.push(l);
    }
    for (const rv of rivals) rv.loop = loopCentre(rv.flight);
    for (const l of gone) deps.endStation(l.slot);
  };

  const stepAll = (dt: number) => {
    if (!course) return;
    const t = raceT() / 1000;
    const local = deps.local();
    for (const l of lanes) {
      const f = l.flight;
      if (play === "bank" && !l.racer && !l.practice) {
        if (l.joined && f.mode === "waiting") stepFlight(f, dt, course, l.body, rules, 0);
        continue;
      }
      if (l.ctrl !== "human" && l.pilot.step(f, course, l.body, dt)) flap(f, l.body);
      stepFlight(f, dt, course, l.body, rules, t - l.t0, l.emit);
      if (l.recording) ghosts.sample(raceT(), f.x, f.y);
      if (l.ctrl === "human" && flying(f)) {
        l.quiet += dt;
        if (l.quiet > QUIET_S) deps.endStation(l.slot);
      } else if (l.ctrl === "human" && local - l.lastTouch > away) deps.endStation(l.slot);
    }
    for (const rv of rivals) {
      if (rv.pilot.step(rv.flight, course, rv.body, dt)) flap(rv.flight, rv.body);
      stepFlight(rv.flight, dt, course, rv.body, rules, t, rv.emit);
    }
  };

  /** Outside racing: gliders on the start line hover, crashed ones settle. */
  const stepIdle = (dt: number) => {
    if (!course) return;
    const local = deps.local();
    for (const l of lanes) {
      if (play === "bank" && !l.joined) continue;
      const f = l.flight;
      if (f.mode === "waiting" || f.mode === "out") stepFlight(f, dt, course, l.body, rules, 0);
      if (l.ctrl === "human" && local - l.lastTouch > away) deps.endStation(l.slot);
    }
    if (phase === "countdown")
      for (const rv of rivals) stepFlight(rv.flight, dt, course, rv.body, rules, 0);
  };

  /** Lanes whose gliders are in the race this frame reports. */
  const reported = (l: GameLane) => {
    if (play !== "bank") return true;
    if (phase === "racing" || phase === "results") return l.racer;
    return l.joined;
  };

  const report = (now: number, mask: number, rows: GameLane[]) => {
    const out: LaneReport[] = rows.map((l) => {
      const f = l.flight;
      const r: LaneReport = {
        slot: l.slot,
        d: distanceOf(f),
        h: f.y,
        mode: f.mode,
        flap: f.flapped,
        ctrl: l.ctrl,
        adult: l.adult,
        gates: f.gates,
        fin: f.fin,
      };
      f.flapped = false;
      return r;
    });
    const heat = play === "lone" ? null : heats?.heat;
    board.own({
      k,
      pos,
      count: Math.max(1, deps.count),
      n: Math.max(1, lanes.length),
      t: now,
      lanes: out,
      joined: mask,
      ...(heat ? { heat } : {}),
    });
  };

  const placeOf = (l: GameLane): number | null => {
    if (play !== "lone" || rivals.length === 0) return board.place(l.id);
    const entries: Entry[] = [
      ...lanes.map((x) => ({ lane: x.id, d: distanceOf(x.flight), fin: x.flight.fin })),
      ...rivals.map((x) => ({ lane: x.id, d: distanceOf(x.flight), fin: x.flight.fin })),
    ];
    return placings(entries).get(l.id) ?? null;
  };

  // ---- The step ------------------------------------------------------------------------------

  const update = (dt: number) => {
    const now = deps.now();
    const local = deps.local();
    const alone = !hasPeers();
    // A bank race in flight is finished even if every peer goes; then the frame races alone.
    const lone = solo || (alone && !(play === "bank" && phase === "racing"));
    if (!lone) heats?.tick();
    const p = planFor({
      now,
      cfg,
      solo,
      lone,
      heat: heats?.heat ?? null,
      joined: lanes.some((l) => l.joined),
      current: k >= 0 ? { k, label } : null,
    });
    plan = p;
    if (p.play !== play) switchPlay(p);
    if (p.k !== k) newRace(p);
    if (p.phase === "racing" && phase === "countdown") startRacing(p);
    if (p.play === "bank" && p.racers && phase === "racing") reconcile(p.racers);
    const rivalsFlying = rivals.some((rv) => flying(rv.flight));
    const early = p.play !== "bank" && p.phase === "racing" && board.ended && !rivalsFlying;
    const over = p.phase === "results" || p.phase === "lobby" || early;
    if (over && phase === "racing") endRacing();
    phase = over ? (p.phase === "lobby" ? "lobby" : "results") : p.phase;
    if (phase === "racing") stepAll(dt);
    else stepIdle(dt);

    let mask = 0;
    const rows: GameLane[] = [];
    for (const l of lanes) {
      if (l.joined) mask |= 1 << l.slot;
      if (reported(l)) rows.push(l);
    }
    const every = rows.length > 0 ? REPORT_MS : IDLE_REPORT_MS;
    if (local - lastReport >= every || mask !== lastMask) {
      lastReport = local;
      lastMask = mask;
      report(now, mask, rows);
    }
    board.tick(phase, p.play !== "bank");
  };

  return {
    get lanes() {
      return lanes;
    },
    get rivals() {
      return rivals;
    },
    get plan() {
      return plan;
    },
    get phase() {
      return phase;
    },
    get course() {
      return course;
    },
    get ghost() {
      return ghost;
    },
    board,
    heats,
    raceT,
    setLanes(slots) {
      const old = lanes;
      lanes = slots.map((s) =>
        makeLane(
          s,
          old.find((o) => o.slot === s.slot),
        ),
      );
      if (rivals.length !== rivalCount()) makeRivals();
    },
    join(slot, bot) {
      const l = byslot(slot);
      if (!l) return;
      const local = deps.local();
      l.joined = true;
      l.ctrl = bot ? "bot" : "human";
      l.quiet = 0;
      l.lastFlap = -Infinity;
      l.lastTouch = local;
      l.touched = true;
      l.pilot.reset();
      if (l.recording) {
        ghosts.abandon();
        l.recording = false;
      }
      const t = Math.max(0, raceT() / 1000);
      if (phase === "racing") {
        // Bank: an unranked practice run. Alone: ranked by distance like everyone else.
        launch(l.flight, l.body, rules, play === "bank" ? 0 : t);
        l.practice = play === "bank";
        l.racer = play !== "bank";
        l.t0 = play === "bank" ? t : 0;
      } else {
        resetFlight(l.flight);
      }
      restart(l);
    },
    leave(slot) {
      const l = byslot(slot);
      if (!l) return;
      l.joined = false;
      l.ctrl = "attract";
      l.racer = false;
      l.practice = false;
      l.pilot.reset();
      if (play === "bank") {
        // Nothing flies in an idle lane of a bank race.
        resetFlight(l.flight);
        restart(l);
      }
    },
    tap(slot) {
      const l = byslot(slot);
      if (!l || !l.joined || l.ctrl !== "human") return;
      const local = deps.local();
      l.lastTouch = local;
      l.touched = true;
      if (local - l.lastFlap < FLAP_DEBOUNCE_MS) return;
      l.lastFlap = local;
      l.quiet = 0;
      const f = l.flight;
      if (
        play === "bank" &&
        phase === "racing" &&
        l.practice &&
        (f.mode === "out" || f.mode === "finished") &&
        f.age > RELAUNCH_S
      ) {
        launch(f, l.body, rules, 0);
        l.t0 = Math.max(0, raceT() / 1000);
        restart(l);
        return;
      }
      flap(f, l.body);
    },
    shows(l) {
      return play !== "bank" || l.joined;
    },
    placeOf,
    update,
    dispose() {
      heats?.dispose();
      board.dispose();
      lanes = [];
      rivals = [];
    },
  };
};
