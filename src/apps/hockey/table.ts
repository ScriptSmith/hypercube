/**
 * One table: its lanes, pucks, players and match. Pure game logic with no DOM or network, driven
 * by `step()` with the shared clock's time, so a whole match can run in a unit test.
 *
 * Every mallet always has a driver: a person (`human`) or the player's bot. Stations decide
 * which (see `seats.ts`); the table just asks the bot when no person is steering.
 *
 * Rules:
 * - `match`: two sides score in each other's goals (hockey, paddles, versus).
 * - `defence`: a team guards slots along the bottom edge; pucks that strike targets light
 *   them, and lighting a whole wave at once clears it. Splitters add pucks. A slot nobody
 *   holds is sealed.
 * - `deck`: the screen above a bank in defence. No players: pucks fly up from the frames
 *   below, strike targets and splitters, and leave through the bottom edge again.
 */
import type { Rng } from "../../core/types";
import { type Bot, createBot, driveBot, SKILLS, setSkill } from "./bot";
import { type GameConfig, RESPAWN_MS, type Side } from "./config";
import type { LaneSpec, PlayerSpec, TableSpec } from "./layout";
import {
  createMatch,
  judge,
  type MatchState,
  recordGoal,
  scoreOf,
  toAttract,
  toCountdown,
  toOver,
  toPlay,
} from "./match";
import {
  createMallet,
  createPuck,
  glide,
  type LaneEvent,
  type LaneParams,
  type Mallet,
  malletZone,
  type Obstacle,
  placePuck,
  type Puck,
  stepLane,
} from "./physics";
import { createWaves, hitTarget, rescaleWaves, resetWaves, stepWaves, type Waves } from "./waves";

/** Attract rallies run at this fraction of full speed. */
export const ATTRACT_TEMPO = 0.55;
/** Most pucks waiting to come in at once (versus, the deck). */
const MAX_ARRIVALS = 8;
/**
 * A puck handed over less than this far across the end, in radii (wholly across), comes in
 * exactly where it is, while the sender still draws the rest of it sliding off. One that is
 * further across by the time the handoff lands has already gone from the sender, so it slides
 * in from just outside the end instead, as if it had crossed a gap between the frames, rather
 * than jumping into the table.
 */
export const ENTRY_DEPTH = 1;
/** A puck due to slide in waits this long at most for another puck to clear its way. */
const ENTRY_WAIT_MS = 1000;
/** Versus play that began this long ago is joined without serving. */
const LATE_JOIN_MS = 1500;
/** Defence: pucks a splitter can add beyond the configured number. */
export const EXTRA_PUCKS = 3;
/** A splitter rests this long after splitting. */
const SPLIT_REST_MS = 700;
/** Defence: a puck sent up to the deck counts as this frame's for this long. */
const UP_GRACE_MS = 6000;
/** A serve starts at most this far (venue px) outside its receiver's reach. */
const SERVE_GAP = 320;
/** A serve gets to its receiver's mallet within about this long, seconds. */
const SERVE_REACH_S = 0.9;
/** Splitters have ids from here; targets count up from 0. */
export const SPLITTER_ID = 100;

export type Rules = "match" | "defence" | "deck";

export interface Player {
  spec: PlayerSpec;
  lane: Lane;
  mallet: Mallet;
  bot: Bot;
  /** A person steers this mallet; otherwise its bot does. */
  human: boolean;
  /** Someone (a person or a bot) holds this player's station. Defence seals unheld slots. */
  manned: boolean;
}

/** A puck on its way in through an open end. Lane coordinates. */
export interface Arrival {
  /** The puck's id, or -1 for any free puck (defence, the deck). */
  id: number;
  /** The end it comes in through; 1 unless stated (the deck takes pucks in at end 0). */
  end?: 0 | 1;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  /**
   * Versus: the puck slides in, carrying on from where it was at `at` (its centre `depth`
   * venue px inside the end, negative while still outside, and turned to `angle`), rather than
   * dropping in just outside the end.
   */
  slide?: { depth: number; angle: number };
  /** Clock ms when it was sent and when it comes in. */
  sent: number;
  at: number;
}

export interface Lane {
  spec: LaneSpec;
  pucks: Puck[];
  players: Player[];
  mallets: Mallet[];
  /** Clock ms when each scored puck comes back, by puck index, or Infinity. */
  respawnAt: number[];
  respawnSide: Side[];
  arrivals: Arrival[];
  /** Clock ms of the last goal at each end, for the flash. */
  flash: [number, number];
  /** Defence: clock ms of the last puck into each slot. */
  slotFlash: number[];
  /** Splitters and the current wave's targets. */
  obstacles: Obstacle[];
}

export type TableEvent =
  | { type: "goal"; lane: Lane; end: 0 | 1; scorer: Side; x: number; y: number; speed: number }
  | { type: "lost"; lane: Lane; slot: number; x: number; y: number }
  | { type: "hit"; lane: Lane; x: number; y: number; speed: number; side: Side; hue: number }
  | { type: "bounce"; lane: Lane; x: number; y: number; speed: number }
  | { type: "bump"; lane: Lane; x: number; y: number; target: boolean }
  | { type: "split"; lane: Lane; x: number; y: number }
  | { type: "wave"; cleared: number }
  /** `at` is the clock ms of the step it left in. */
  | { type: "exit"; lane: Lane; puck: Puck; slot: number; at: number }
  /** A puck slid in through an open end, its centre `depth` puck radii inside the end. */
  | { type: "enter"; lane: Lane; puck: Puck; depth: number; at: number }
  | { type: "over"; winner: Side | -1 };

export interface TableOptions {
  /** Versus: this frame's side. Its lanes own only some pucks, and their far end is open. */
  versus?: { side: Side };
  /** Defaults to `defence` when the spec has targets, else `match`. */
  rules?: Rules;
}

export interface Table {
  /** The current layout of this table; replaced by `refit`. */
  readonly spec: TableSpec;
  readonly rules: Rules;
  readonly lanes: readonly Lane[];
  readonly players: readonly Player[];
  readonly match: MatchState;
  /** Defence and the deck: the targets and waves. */
  readonly waves: Waves | null;
  /** Seconds of simulation so far. */
  readonly time: number;
  step(dt: number, now: number): void;
  on(cb: (e: TableEvent) => void): () => void;
  /** Back to the attract rally. */
  attract(now: number): void;
  countdown(now: number, id: string, startAt: number): void;
  /** Start play and serve. Versus serves only the pucks this side owns at the start. */
  play(now: number): void;
  finish(now: number, winner: Side | -1): void;
  setHuman(p: Player, human: boolean): void;
  setManned(p: Player, manned: boolean): void;
  /** Point a mallet, in lane coordinates. */
  aim(p: Player, x: number, y: number): void;
  /** Queue a puck to come in. False when there is no room for it (the deck is full). */
  arrive(lane: Lane, a: Arrival): boolean;
  /** Puck ids live on, or due back to, this frame's lanes. */
  owned(): number[];
  /** Put a puck back in play on this frame, e.g. one lost with a vanished peer. */
  restore(id: number, now: number): void;
  /** Move the table to a new layout of the same shape (a band fitted at match start). */
  refit(next: TableSpec): void;
  /** The deck: which slots along the bottom lead to a frame that is playing. */
  setOpen(slots: ReadonlySet<number>): void;
}

/** Whether a puck centred at (x, y) would overlap a mallet or paddle. */
const onMallet = (params: LaneParams, m: Mallet, x: number, y: number) => {
  if (params.variant === "paddles") {
    const dy = Math.max(0, Math.abs(y - m.y) - params.paddleHalf);
    return Math.hypot(x - m.x, dy) < params.paddleR + params.puckR;
  }
  // A hair of slack: a puck just outside the end exactly touches a mallet at the edge of its zone.
  return Math.hypot(x - m.x, y - m.y) < params.malletR + params.puckR - 0.5;
};

/** Which side serves a puck at the start of a versus match. */
export const versusOwner = (matchId: string, id: number): Side => {
  let h = 0;
  for (let i = 0; i < matchId.length; i++) h = (h * 31 + matchId.charCodeAt(i)) | 0;
  return ((id + (h & 1)) % 2) as Side;
};

export const createTable = (
  initial: TableSpec,
  cfg: GameConfig,
  rng: Rng,
  opts: TableOptions = {},
): Table => {
  let spec = initial;
  const rules: Rules = opts.rules ?? (spec.defence ? "defence" : "match");
  const team = rules !== "match";
  const match = createMatch();
  const listeners = new Set<(e: TableEvent) => void>();
  const laneEvents: LaneEvent[] = [];
  const serveRng = rng.fork("serve");
  const waveRng = rng.fork("waves");
  const waves = team ? createWaves() : null;
  /** Clock ms each splitter last split, by obstacle id. */
  const splitAt = new Map<number, number>();
  /** Clock ms of pucks recently sent up to the deck. */
  const upAt: number[] = [];
  let time = 0;
  let deckOpen: ReadonlySet<number> = new Set();

  const poolSize = (ls: LaneSpec) =>
    rules === "deck"
      ? 16
      : team
        ? Math.max(cfg.pucks, 3) + EXTRA_PUCKS + 1
        : ls.child
          ? 1
          : cfg.pucks;

  const lanes: Lane[] = spec.lanes.map((ls) => {
    const count = poolSize(ls);
    const lane: Lane = {
      spec: ls,
      pucks: Array.from({ length: count }, (_, i) => createPuck(i)),
      players: [],
      mallets: [],
      respawnAt: Array.from({ length: count }, () => Infinity),
      respawnSide: Array.from({ length: count }, () => 0 as Side),
      arrivals: [],
      flash: [-Infinity, -Infinity],
      slotFlash: ls.params.mouths[0].map(() => -Infinity),
      obstacles: [],
    };
    lane.players = ls.players.map((ps) => {
      const zone = malletZone(ls.params, ps.area, ps.goalEnd);
      const mallet = createMallet(ps.side, ps.goalEnd, zone, ls.params.maxMallet);
      const bot = createBot(rng.fork(`bot:${ps.id}`), SKILLS.attract);
      setSkill(bot, SKILLS.attract, mallet, ls.params);
      return { spec: ps, lane, mallet, bot, human: false, manned: false };
    });
    lane.mallets = lane.players.map((p) => p.mallet);
    return lane;
  });
  const players = lanes.flatMap((l) => l.players);

  const emit = (e: TableEvent) => {
    for (const cb of listeners) cb(e);
  };

  const tempo = () => (match.phase === "attract" ? ATTRACT_TEMPO : 1);

  /** More than one player a side shares the lane (versus, a long wall table). */
  const crowded = () => lanes.some((l) => l.players.filter((p) => p.spec.side === 0).length > 1);

  const botSkill = () =>
    match.phase === "attract"
      ? SKILLS.attract
      : opts.versus || (crowded() && rules === "match")
        ? SKILLS.zone
        : SKILLS.match;

  const refreshDrivers = () => {
    for (const p of players) {
      if (p.human) p.mallet.cap = p.lane.spec.params.maxMallet;
      else setSkill(p.bot, botSkill(), p.mallet, p.lane.spec.params);
    }
  };

  /** Defence: a slot is open while someone holds it, and always in attract. */
  const sealed = (p: Player) => rules === "defence" && match.phase !== "attract" && !p.manned;

  const applySeals = () => {
    if (rules !== "defence") return;
    for (const lane of lanes) {
      const mouths = lane.spec.params.mouths[0];
      lane.players.forEach((p, i) => {
        const m = mouths[i];
        if (m) m.open = !sealed(p);
      });
    }
  };

  const refreshObstacles = () => {
    if (!waves) return;
    const lane = lanes[0];
    if (!lane) return;
    lane.obstacles = [...(spec.defence?.splitters ?? []), ...waves.targets];
  };

  /** Take every puck off. Arrivals stay when play starts: they belong to the new match. */
  const clearPucks = (keepArrivals = false) => {
    for (const lane of lanes) {
      for (const p of lane.pucks) p.live = false;
      lane.respawnAt.fill(Infinity);
      if (!keepArrivals) lane.arrivals.length = 0;
    }
    upAt.length = 0;
  };

  /** A spot on the lane at least a mallet's reach from every mallet and live puck. */
  const clearSpot = (lane: Lane, x: number) => {
    const { width: W, malletR, puckR } = lane.spec.params;
    for (const y of [W / 2, W * 0.28, W * 0.72, W * 0.15, W * 0.85]) {
      const free =
        lane.players.every((p) => Math.hypot(p.mallet.x - x, p.mallet.y - y) > malletR + puckR) &&
        lane.pucks.every((p) => !p.live || Math.hypot(p.x - x, p.y - y) > puckR * 2.2);
      if (free) return y;
    }
    return W / 2;
  };

  /** Launch a puck from x, roughly towards `end` (0 or 1), at `speed`. */
  const launch = (lane: Lane, puck: Puck, x: number, y: number, end: 0 | 1, speed: number) => {
    const angle = serveRng.range(-0.45, 0.45);
    const dir = end === 0 ? -1 : 1;
    placePuck(puck, x, y, dir * Math.cos(angle) * speed, Math.sin(angle) * speed);
  };

  const serveSpeed = (lane: Lane) => {
    const p = lane.spec.params;
    return p.variant === "paddles" ? p.baseBall * tempo() : p.maxPuck * 0.22 * tempo();
  };

  const isVersus = () => opts.versus !== undefined;

  /**
   * Serve towards the player nearest the middle on the `end` side: from the centre line when
   * they can reach it, otherwise from just short of their reach (the open middle of a long
   * table), and always fast enough to get to their mallet within about a second.
   */
  const faceOff = (lane: Lane, puck: Puck, y: number, end: 0 | 1) => {
    const params = lane.spec.params;
    const { length: L, malletR: R, puckR: r } = params;
    const speed = serveSpeed(lane);
    const receivers = lane.players.filter((p) => p.spec.goalEnd === end);
    const receiver =
      end === 0
        ? receivers.reduce<Player | null>(
            (a, p) => (!a || p.mallet.zone.x1 > a.mallet.zone.x1 ? p : a),
            null,
          )
        : receivers.reduce<Player | null>(
            (a, p) => (!a || p.mallet.zone.x0 < a.mallet.zone.x0 ? p : a),
            null,
          );
    if (params.variant === "paddles" || !receiver) {
      launch(lane, puck, L / 2, y, end, speed);
      return;
    }
    const z = receiver.mallet.zone;
    // The receiver's reach edge nearest the middle, in lane x.
    const edge = end === 0 ? z.x1 + R + r : z.x0 - R - r;
    const gap = end === 0 ? L / 2 - edge : edge - L / 2;
    const x =
      gap <= 0
        ? L / 2
        : end === 0
          ? edge + Math.min(gap, SERVE_GAP)
          : edge - Math.min(gap, SERVE_GAP);
    const reachIn = Math.abs(x - receiver.mallet.x) / SERVE_REACH_S;
    launch(lane, puck, x, y, end, Math.min(params.maxPuck * 0.5, Math.max(speed, reachIn)));
  };

  /** Defence: drop a puck in from high on the rink, heading down towards the slots. */
  const dropIn = (lane: Lane, puck: Puck) => {
    const { length: L, width: W, maxPuck } = lane.spec.params;
    const x = L * (lane.spec.params.ends[1].kind === "open" ? 0.9 : 0.78);
    launch(lane, puck, x, serveRng.range(W * 0.2, W * 0.8), 0, maxPuck * 0.28 * tempo());
  };

  /** Serve the opening pucks. In attract a lane gets one, calmly. */
  const serve = () => {
    if (rules === "deck") return;
    for (const lane of lanes) {
      const { length: L, width: W } = lane.spec.params;
      const count = match.phase === "attract" ? 1 : team ? cfg.pucks : lane.pucks.length;
      for (let i = 0; i < count; i++) {
        const puck = lane.pucks[i]!;
        if (team) {
          dropIn(lane, puck);
        } else if (isVersus()) {
          if (match.phase !== "attract" && versusOwner(match.id, i) !== opts.versus!.side) continue;
          launch(lane, puck, L * 0.3, W * (0.3 + 0.4 * serveRng.next()), 1, serveSpeed(lane));
        } else {
          const y = W * ((i + 1) / (count + 1));
          faceOff(lane, puck, y, ((i + serveRng.int(2)) % 2) as 0 | 1);
        }
      }
    }
  };

  /** A scored puck comes back on the side that let it in. */
  const respawn = (lane: Lane, puck: Puck, conceded: Side) => {
    if (team) {
      dropIn(lane, puck);
      return;
    }
    const params = lane.spec.params;
    const { length: L } = params;
    const goalEnd = lane.spec.params.ends[0].side === conceded ? 0 : 1;
    if (params.variant === "paddles") {
      const x = isVersus() ? L * 0.3 : L / 2;
      const towards = isVersus() ? 1 : goalEnd;
      launch(lane, puck, x, clearSpot(lane, x), towards, serveSpeed(lane));
      return;
    }
    const keeper = lane.players
      .filter((p) => p.spec.side === conceded)
      .sort((a, b) =>
        goalEnd === 0 ? a.spec.area.x0 - b.spec.area.x0 : b.spec.area.x1 - a.spec.area.x1,
      )[0];
    const area = keeper?.spec.area;
    const x = area ? (area.x0 + area.x1) / 2 : goalEnd === 0 ? L / 4 : (3 * L) / 4;
    placePuck(puck, x, clearSpot(lane, x));
  };

  const freePuck = (lane: Lane) =>
    lane.pucks.findIndex(
      (p, i) => !p.live && lane.respawnAt[i] === Infinity && !lane.arrivals.some((a) => a.id === i),
    );

  /** Defence: the configured pucks, and one more for every two players beyond the first two. */
  const basePucks = () => {
    const held = players.filter((p) => p.manned).length;
    return Math.min(cfg.pucks + EXTRA_PUCKS, Math.max(cfg.pucks, Math.ceil(held / 2)));
  };
  /** Defence: splitters may add a puck per slot, up to EXTRA_PUCKS. */
  const extraPucks = () => Math.min(EXTRA_PUCKS, lanes[0]?.spec.params.mouths[0].length ?? 1);

  /** Defence: keep the configured number of pucks in play (one in attract). */
  const keepPucks = (now: number) => {
    if (rules !== "defence" || (match.phase !== "play" && match.phase !== "attract")) return;
    while (upAt.length > 0 && now - upAt[0]! > UP_GRACE_MS) upAt.shift();
    const want = match.phase === "attract" ? 1 : basePucks();
    for (const lane of lanes) {
      let have = upAt.length + lane.arrivals.length;
      lane.pucks.forEach((p, i) => {
        if (p.live || lane.respawnAt[i]! < Infinity) have++;
      });
      while (have < want) {
        const i = freePuck(lane);
        if (i < 0) break;
        lane.respawnAt[i] = now + RESPAWN_MS;
        have++;
      }
    }
  };

  /** A splitter sends the puck on one way and a new puck the other. */
  const split = (lane: Lane, p: Puck, o: Obstacle, now: number) => {
    if (now - (splitAt.get(o.id) ?? -Infinity) < SPLIT_REST_MS) return;
    const live = lane.pucks.filter((q) => q.live).length;
    if (rules === "defence" && live >= basePucks() + extraPucks()) return;
    const i = freePuck(lane);
    if (i < 0) return;
    splitAt.set(o.id, now);
    const speed = Math.max(Math.hypot(p.vx, p.vy), lane.spec.params.maxPuck * 0.35);
    const base = Math.atan2(p.vy, p.vx);
    const reach = o.r + lane.spec.params.puckR + 2;
    const turn = 0.6;
    const twin = lane.pucks[i]!;
    for (const [puck, a] of [
      [p, base + turn],
      [twin, base - turn],
    ] as const) {
      const vx = Math.cos(a) * speed;
      const vy = Math.sin(a) * speed;
      const nx = o.x + (vx / speed) * reach;
      const ny = o.y + (vy / speed) * reach;
      if (puck === twin) placePuck(twin, nx, ny, vx, vy, -p.spin);
      else {
        p.x = nx;
        p.y = ny;
        p.vx = vx;
        p.vy = vy;
      }
    }
    emit({ type: "split", lane, x: o.x, y: o.y });
  };

  const onLaneEvent = (lane: Lane, e: LaneEvent, now: number) => {
    const p = e.puck;
    switch (e.type) {
      case "goal": {
        if (rules === "deck") {
          emit({ type: "exit", lane, puck: p, slot: e.slot, at: now });
          break;
        }
        if (rules === "defence") {
          if (match.phase === "play") match.mine[1]++;
          lane.slotFlash[e.slot] = now;
          emit({ type: "lost", lane, slot: e.slot, x: p.x, y: p.y });
          break;
        }
        const conceded = lane.spec.params.ends[e.end].side;
        const scorer: Side = conceded === 0 ? 1 : 0;
        recordGoal(match, scorer);
        lane.flash[e.end] = now;
        if (match.phase === "play" || match.phase === "attract") {
          lane.respawnAt[p.id] = now + RESPAWN_MS;
          lane.respawnSide[p.id] = conceded;
        }
        emit({ type: "goal", lane, end: e.end, scorer, x: p.x, y: p.y, speed: e.speed });
        break;
      }
      case "exit":
        if (rules === "defence") upAt.push(now);
        emit({ type: "exit", lane, puck: p, slot: 0, at: now });
        break;
      case "hit":
        emit({
          type: "hit",
          lane,
          x: p.x,
          y: p.y,
          speed: e.speed,
          side: e.mallet.side,
          hue: lane.players.find((pl) => pl.mallet === e.mallet)?.spec.hue ?? e.mallet.side,
        });
        break;
      case "bounce":
        emit({ type: "bounce", lane, x: p.x, y: p.y, speed: e.speed });
        break;
      case "bump": {
        const o = e.obstacle;
        if (o.id >= SPLITTER_ID) {
          split(lane, p, o, now);
          break;
        }
        emit({ type: "bump", lane, x: o.x, y: o.y, target: true });
        if (waves && spec.defence && hitTarget(waves, spec.defence, o.id, now)) {
          if (rules === "defence" && match.phase === "play") match.mine[0]++;
          refreshObstacles();
          emit({ type: "wave", cleared: waves.cleared });
        }
        break;
      }
    }
  };

  /**
   * Slide a puck in through an open end, carrying on from where the arrival says it was: as far
   * as it has got by now (or from just outside the end if that is past ENTRY_DEPTH), but short
   * of the first mallet or puck along its path, so it never lands on one. With its leading edge
   * on the end it is clear of every mallet, which can't reach past the end. False when another
   * puck is in the way even there, unless `force`.
   */
  const slideIn = (
    lane: Lane,
    puck: Puck,
    a: Arrival,
    slide: NonNullable<Arrival["slide"]>,
    now: number,
    force: boolean,
  ) => {
    const params = lane.spec.params;
    const { length: L, puckR: r } = params;
    const end = a.end ?? 1;
    const speed = Math.max(Math.abs(a.vx), 1e-3);
    const ahead = slide.depth + (speed * Math.max(0, now - a.at)) / 1000;
    const goal = ahead <= ENTRY_DEPTH * r ? ahead : -r;
    const from = Math.min(-r, goal);
    const along = (depth: number) => {
      const t = (depth - slide.depth) / speed;
      const g = glide(params, a.y, a.vy, t);
      return { x: end === 0 ? depth : L - depth, y: g.y, vy: g.vy, t, depth };
    };
    const clear = (x: number, y: number) =>
      lane.mallets.every((m) => !onMallet(params, m, x, y)) &&
      lane.pucks.every((q) => !q.live || Math.hypot(q.x - x, q.y - y) >= 2 * r);
    const steps = Math.max(1, Math.ceil((goal - from) / (r * 0.25)));
    let spot: ReturnType<typeof along> | null = null;
    for (let i = 0; i <= steps; i++) {
      const p = along(from + ((goal - from) * i) / steps);
      if (!clear(p.x, p.y)) break;
      spot = p;
    }
    if (!spot) {
      if (!force) return false;
      spot = along(from);
    }
    placePuck(puck, spot.x, spot.y, a.vx, spot.vy, a.spin);
    puck.angle = slide.angle + a.spin * spot.t;
    puck.slidIn = true;
    emit({ type: "enter", lane, puck, depth: spot.depth / r, at: now });
    return true;
  };

  const bringIn = (lane: Lane, now: number) => {
    const params = lane.spec.params;
    for (let i = 0; i < lane.pucks.length; i++) {
      if (lane.respawnAt[i]! > now) continue;
      lane.respawnAt[i] = Infinity;
      const puck = lane.pucks[i]!;
      if (!puck.live) respawn(lane, puck, lane.respawnSide[i]!);
    }
    for (let i = lane.arrivals.length - 1; i >= 0; i--) {
      const a = lane.arrivals[i]!;
      if (a.at > now) continue;
      const id = a.id >= 0 ? a.id : freePuck(lane);
      const puck = lane.pucks[id];
      if (puck && !puck.live) {
        if (a.slide) {
          if (!slideIn(lane, puck, a, a.slide, now, now - a.at > ENTRY_WAIT_MS)) continue;
        } else {
          // Just outside the end, but short of where a puck counts as having left through it.
          const end = a.end ?? 1;
          const out = params.puckR * (params.ends[end].kind === "open" ? 0.9 : 0.2);
          const x = end === 0 ? -out : params.length + out;
          placePuck(puck, x, a.y, a.vx, a.vy, a.spin);
        }
      }
      lane.arrivals.splice(i, 1);
    }
  };

  /** Defence bots aim at the targets still to light. */
  const aims = (now: number) =>
    waves && waves.targets.length > 0 ? waves.targets.filter((t) => t.litUntil <= now) : undefined;

  /** Defence: a sealed slot's mallet waits at home. */
  const park = (p: Player) => {
    const z = p.mallet.zone;
    p.mallet.tx = z.x0;
    p.mallet.ty = (z.y0 + z.y1) / 2;
  };

  const table: Table = {
    get spec() {
      return spec;
    },
    rules,
    lanes,
    players,
    match,
    waves,
    get time() {
      return time;
    },
    step(dt, now) {
      time += dt;
      const live = match.phase === "attract" || match.phase === "play";
      applySeals();
      if (waves && spec.defence?.local && live && stepWaves(waves, spec.defence, now, waveRng)) {
        refreshObstacles();
      }
      keepPucks(now);
      for (const lane of lanes) {
        if (live) bringIn(lane, now);
        for (const p of lane.players) {
          if (p.human) continue;
          if (sealed(p)) park(p);
          else driveBot(p.bot, lane.spec.params, p.mallet, lane.pucks, time, aims(now));
        }
        laneEvents.length = 0;
        stepLane(
          lane.spec.params,
          lane.pucks,
          lane.mallets,
          dt,
          laneEvents,
          tempo(),
          lane.obstacles,
        );
        for (const e of laneEvents) onLaneEvent(lane, e, now);
      }
      if (rules === "match") {
        const winner = judge(match, now, cfg.target);
        if (winner !== null) table.finish(now, winner);
      } else if (rules === "defence" && match.phase === "play") {
        if (scoreOf(match)[0] >= cfg.target) table.finish(now, 0);
        else if (now >= match.endAt) table.finish(now, -1);
      }
    },
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    attract(now) {
      toAttract(match, now);
      clearPucks();
      if (waves) resetWaves(waves, now);
      refreshObstacles();
      refreshDrivers();
      serve();
    },
    countdown(now, id, startAt) {
      toCountdown(match, now, id, startAt, cfg.matchMs);
      clearPucks();
      if (waves) resetWaves(waves, startAt);
      refreshObstacles();
      refreshDrivers();
    },
    play(now) {
      if (match.phase !== "countdown") return;
      toPlay(match, now);
      clearPucks(true);
      refreshDrivers();
      // A frame joining a versus match already under way finds its pucks with the other frame.
      if (!isVersus() || now - match.startAt < LATE_JOIN_MS) serve();
    },
    finish(now, winner) {
      if (match.phase === "over") return;
      toOver(match, now, winner);
      clearPucks();
      refreshDrivers();
      emit({ type: "over", winner });
    },
    setHuman(p, human) {
      if (p.human === human) return;
      p.human = human;
      p.mallet.tx = p.mallet.x;
      p.mallet.ty = p.mallet.y;
      refreshDrivers();
    },
    setManned(p, manned) {
      p.manned = manned;
    },
    aim(p, x, y) {
      p.mallet.tx = x;
      p.mallet.ty = y;
    },
    arrive(lane, a) {
      if (a.id >= 0 && lane.arrivals.some((b) => b.id === a.id)) return true;
      if (a.id < 0) {
        const free = lane.pucks.filter((p) => !p.live).length - lane.arrivals.length;
        if (free <= 0) return false;
      }
      if (lane.arrivals.length >= MAX_ARRIVALS) lane.arrivals.shift();
      lane.arrivals.push(a);
      return true;
    },
    owned() {
      const ids = new Set<number>();
      for (const lane of lanes) {
        lane.pucks.forEach((p, i) => {
          if (p.live || lane.respawnAt[i]! < Infinity) ids.add(i);
        });
        for (const a of lane.arrivals) if (a.id >= 0) ids.add(a.id);
      }
      return [...ids].sort((a, b) => a - b);
    },
    restore(id, now) {
      const lane = lanes[0];
      if (!lane || !lane.pucks[id] || lane.pucks[id].live) return;
      lane.respawnAt[id] = now;
      lane.respawnSide[id] = opts.versus?.side ?? 0;
    },
    refit(next) {
      next.lanes.forEach((ls, i) => {
        const lane = lanes[i];
        if (!lane || ls.players.length !== lane.players.length) return;
        const old = lane.spec.params;
        const fresh = ls.params;
        const sx = fresh.length / old.length;
        const sy = fresh.width / old.width;
        for (const p of lane.pucks) {
          p.x *= sx;
          p.px *= sx;
          p.vx *= sx;
          p.y *= sy;
          p.py *= sy;
          p.vy *= sy;
        }
        for (const a of lane.arrivals) {
          a.y *= sy;
          a.vx *= sx;
          a.vy *= sy;
          if (a.slide) a.slide.depth *= sx;
        }
        // Keep which slots were open; the next step sets them from the players anyway.
        fresh.mouths[0].forEach((m, j) => {
          m.open = old.mouths[0][j]?.open ?? m.open;
        });
        lane.spec = ls;
        lane.players.forEach((pl, j) => {
          pl.spec = ls.players[j]!;
          const m = pl.mallet;
          m.zone = malletZone(fresh, pl.spec.area, pl.spec.goalEnd);
          const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
          m.x = clampTo(m.x * sx, m.zone.x0, m.zone.x1);
          m.y = clampTo(m.y * sy, m.zone.y0, m.zone.y1);
          m.px = m.x;
          m.py = m.y;
          m.tx = clampTo(m.tx * sx, m.zone.x0, m.zone.x1);
          m.ty = clampTo(m.ty * sy, m.zone.y0, m.zone.y1);
        });
        if (i === 0 && waves) rescaleWaves(waves, sx, sy);
      });
      // Targets that now live elsewhere (the deck) leave this rink.
      if (waves && next.defence && !next.defence.local) waves.targets = [];
      spec = next;
      refreshObstacles();
      refreshDrivers();
    },
    setOpen(slots) {
      deckOpen = slots;
      for (const lane of lanes) {
        for (const m of lane.spec.params.mouths[0]) m.open = deckOpen.has(m.slot);
      }
    },
  };
  return table;
};
