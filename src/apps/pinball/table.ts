/**
 * One table's game: balls, ball save, scoring, the deck lane, bonus balls from the deck and game
 * over. No DOM; the frame feeds it controls and the clock, and draws it.
 *
 * Two clocks: `world.t` (simulated seconds) for everything on the table, and the shared clock
 * (ms) for the tubes that carry balls to and from the screen, so both frames agree on when a
 * ball crosses.
 *
 * Who plays: an attract bot (faded, restarts by itself), a bot kept for testing, or a person.
 * A table with a person stays in `play` until the last ball drains (classic), then `over` holds
 * the score, then the frame ends the station. `leaving` lets the balls drain after the player
 * has stopped touching.
 *
 * A person can also pick a ball up (`grab`), drag it and throw it (`drop`). A held ball scores
 * nothing and can't drain; one a player lets go of over the drain drains as usual.
 *
 * Gifts from the deck's bubbles come down the return tube like a ball and then last a while:
 * a shield (ball save), posts across the outlanes, or double scoring. An extra ball is simply a
 * bonus ball down the tube.
 *
 * A themed table adds its toys (toys.ts): they see every solver event after the rules here, and
 * may hold balls out of the solver. Held balls count as in play, so a drain while others are held
 * never ends the game; when no free ball is left, toys that keep balls waiting (locks) let go.
 */
import {
  BALL_R,
  CLIMB_MS,
  type Config,
  CROSS_V,
  type Gift,
  GIFT_S,
  GIFTS,
  GRAB_REACH,
  MAX_IN_PLAY,
  LEAVE_DRAIN_MS,
  MAX_MULTIPLIER,
  OVER_MS,
  POINTS,
  RETURN_MS,
  SAVE_MS,
  SUBSTEPS,
  TABLE_H,
  TABLE_W,
  THROW_SHARE,
  VMAX,
} from "./config";
import { pickBall } from "./grab";
import type { FlipperName, TableLayout } from "./layout";
import { type Motion, motionAt, type Pt, pointAlong, polyLength } from "./path";
import { type Ball, makeBall, makeWorld, stepWorld, type World } from "./physics";
import { NO_TOYS, type ToyHost, type Toys } from "./toys";

export type Ctrl = "attract" | "bot" | "human";
export type TableMode = "play" | "over" | "leaving";

export interface Tube {
  id: number;
  kind: "up" | "orbit" | "return" | "gift";
  /** What a gift tube carries. */
  gift: Gift | null;
  pts: Pt[];
  motion: Motion;
  /** Clock ms when it started along the tube. */
  start: number;
  color: number;
  bonus: boolean;
  x: number;
  y: number;
}

export interface ActiveGift {
  kind: Gift;
  /** Simulated seconds when it started and when it runs out. */
  at: number;
  until: number;
}

export interface UpShot {
  id: number;
  u: number;
  vx: number;
  vy: number;
  color: number;
  /** Clock ms when the ball left the playfield. */
  t: number;
}

export interface TableOptions {
  layout: TableLayout;
  cfg: Config;
  /** Colour index of this table's own balls. */
  color: number;
  /** Deterministic noise for nudging stuck balls. */
  random: () => number;
  /** True while deck shots go to the screen; false sends them round the orbit. */
  deck: () => boolean;
  /** A deck shot is leaving for the screen; false if it couldn't be sent (it orbits instead). */
  onUp(shot: UpShot): boolean;
  /** A theme's toys for this table (none on a classic table). */
  toys?(host: ToyHost): Toys;
}

/** Holding the plunger this long pulls it all the way. */
const PULL_S = 1.0;
/** A press shorter than this is a tap: medium strength. */
const TAP_S = 0.2;
const TAP_STRENGTH = 0.55;
/** Launch speed at no pull and the extra at full pull, at classic gravity. */
const LAUNCH_V0 = 2650;
const LAUNCH_DV = 1700;
const CLASSIC_G = 2300;
/** A ball that hasn't moved more than its radius for this long gets a nudge. */
const STUCK_S = 4;
/** Attract games start again this long after they end. */
const ATTRACT_RESTART_S = 2.5;
/** Bonus balls waiting for room, at most. */
const MAX_WAITING = 2;
/** Gifts on their way down, at most. */
const MAX_GIFTS_DUE = 4;
const GIFTS_INDEX = Object.fromEntries(GIFTS.map((g, i) => [g, i])) as Record<Gift, number>;
const WAIT_EXPIRE_MS = 10_000;
const ORBIT_MS = 820;
const ORBIT_V = 2500;

export interface Table {
  readonly world: World;
  readonly layout: TableLayout;
  readonly tubes: readonly Tube[];
  /** The theme's toys (nothing on a classic table). */
  readonly toys: Toys;
  /** The last shake the toys asked for: how strong (0 to 1) and when (world seconds). */
  readonly shake: { amount: number; at: number };
  ctrl: Ctrl;
  mode: TableMode;
  score: number;
  /** Balls left in the game, the one in play included. */
  left: number;
  multiplier: number;
  lanes: boolean[];
  targets: boolean[];
  /** Plunger pull, 0 to 1. */
  readonly pull: number;
  readonly spinner: { angle: number; speed: number };
  /** Simulated seconds when the game ended (`over`) or the player left (`leaving`). */
  readonly since: number;
  /** Deck shots and orbits this game, and per flipper (left, right, upLeft, upRight, other). */
  readonly stats: {
    deck: number;
    orbit: number;
    byFlipper: number[];
    drains: number;
    games: number;
  };
  /** Balls on the table, held by its toys, in tubes heading into it, and due from the deck. */
  inPlay(): number;
  /** A ball sits in the plunger lane. */
  waiting(): boolean;
  /** Seconds of ball save left. */
  saveLeft(): number;
  /** Simulated seconds since a part last flashed (Infinity if never). */
  flashAge(tag: string, index: number): number;
  start(ctrl: Ctrl): void;
  /** Stop playing and let the balls drain. */
  leave(): void;
  setFlipper(name: FlipperName, held: boolean): void;
  pressPlunger(): void;
  releasePlunger(): void;
  /** A ball from the deck reaches this table's top edge at clock ms `t`. False if there's no room. */
  addDown(d: { id: number; color: number; t: number }, now: number): boolean;
  /** Points this table's balls scored on the deck. */
  addPoints(n: number): void;
  /** A gift reaches this table's top edge at clock ms `t`. False if the table isn't playing. */
  gift(kind: Gift, t: number, now: number): boolean;
  /** Gifts running now, at most one of each kind. */
  readonly gifts: readonly ActiveGift[];
  /** A person's finger picks up the nearest free ball near (x, y), table px. False if none. */
  grab(finger: number, x: number, y: number): boolean;
  /** The finger holding a ball moved to (x, y), table px. */
  drag(finger: number, x: number, y: number): void;
  /** The finger let go: its ball flies on at (vx, vy) table px per second, capped. */
  drop(finger: number, vx: number, vy: number): void;
  /** Balls held by fingers. */
  held(): number;
  /** For tests: put a ball at (x, y) moving (vx, vy). */
  place(x: number, y: number, vx: number, vy: number): Ball;
  update(dt: number, now: number): void;
  /** True once the game is over and its hold has passed, or the leaving balls are gone. */
  finished(): boolean;
}

export const createTable = (o: TableOptions): Table => {
  const { layout, cfg } = o;
  const world = makeWorld({
    gravity: cfg.gravity,
    vmax: VMAX,
    bounds: { x0: -120, y0: -260, x1: TABLE_W + 120, y1: TABLE_H + BALL_R + 8 },
  });
  world.shapes = layout.shapes;
  world.flippers = layout.flippers;
  world.rollovers = layout.rollovers;
  world.gates = layout.gates;

  const tubes: Tube[] = [];
  const due: { id: number; color: number; t: number }[] = [];
  const giftsDue: { kind: Gift; t: number }[] = [];
  const gifts: ActiveGift[] = [];
  const waitingDowns: { id: number; color: number; at: number }[] = [];
  const flashes = new Map<string, number>();
  const spinner = { angle: 0, speed: 0 };
  const stats = { deck: 0, orbit: 0, byFlipper: [0, 0, 0, 0, 0], drains: 0, games: 0 };
  let nextId = 1;
  let pull = 0;
  let pressing = false;
  let pressedAt = 0;
  let saveUntil = -Infinity;
  let since = 0;
  let lastFlipper = new Map<number, number>();
  let clock = 0;
  const launchScale = Math.sqrt(cfg.gravity / CLASSIC_G);
  const throwMax = (LAUNCH_V0 + LAUNCH_DV) * launchScale * THROW_SHARE;
  /** Each finger's ball. Every held ball is a different one, so this stays as small as the balls. */
  const holds = new Map<number, Ball>();

  const flash = (tag: string, index: number) => {
    flashes.set(`${tag}:${index}`, world.t);
  };
  const shake = { amount: 0, at: -Infinity };
  /** Balls in the solver, on their way into the table and due: everything but what toys hold. */
  const free = () =>
    world.balls.length +
    tubes.filter((t) => t.kind === "orbit" || t.kind === "return").length +
    due.length;

  const table: Table = {
    world,
    layout,
    tubes,
    get toys() {
      return toys;
    },
    shake,
    ctrl: "attract",
    mode: "play",
    score: 0,
    left: cfg.balls,
    multiplier: 1,
    lanes: [false, false, false],
    targets: [false, false, false],
    get pull() {
      return pull;
    },
    spinner,
    get since() {
      return since;
    },
    stats,
    inPlay: () => free() + toys.held().length,
    waiting: () => waitingBall() !== null,
    saveLeft: () => Math.max(0, saveUntil - world.t),
    flashAge(tag, index) {
      const at = flashes.get(`${tag}:${index}`);
      return at === undefined ? Infinity : world.t - at;
    },
    start(ctrl) {
      table.ctrl = ctrl;
      table.mode = "play";
      clear();
      table.score = 0;
      table.left = cfg.balls;
      table.multiplier = 1;
      table.lanes = [false, false, false];
      table.targets = [false, false, false];
      stats.deck = 0;
      stats.orbit = 0;
      stats.byFlipper = [0, 0, 0, 0, 0];
      stats.drains = 0;
      stats.games++;
      serve();
    },
    leave() {
      if (table.mode !== "play") return;
      table.mode = "leaving";
      since = world.t;
      for (const [finger, b] of holds) table.drop(finger, b.vx, b.vy);
      for (const f of world.flippers) f.held = false;
      pressing = false;
      pull = 0;
      toys.flush();
    },
    setFlipper(name, held) {
      const f = world.flippers.find((x) => x.name === name);
      if (f) f.held = held && table.mode === "play";
    },
    pressPlunger() {
      if (table.mode !== "play" || pressing) return;
      pressing = true;
      pressedAt = world.t;
    },
    releasePlunger() {
      if (!pressing) return;
      pressing = false;
      const held = world.t - pressedAt;
      const strength = held < TAP_S ? TAP_STRENGTH : pull;
      pull = 0;
      setTip(0);
      fire(strength);
    },
    addDown(d, now) {
      if (table.inPlay() < MAX_IN_PLAY) {
        due.push(d);
        return true;
      }
      if (waitingDowns.length >= MAX_WAITING) return false;
      waitingDowns.push({ ...d, at: now });
      return true;
    },
    addPoints(n) {
      if (table.mode === "play" && Number.isFinite(n) && n > 0) table.score += Math.round(n);
    },
    gifts,
    gift(kind, t, now) {
      if (table.mode !== "play" || table.ctrl === "attract" || !Number.isFinite(t)) return false;
      // A gift too far off in either direction is a confused clock, not a gift.
      const at = Math.max(now, Math.min(now + 10_000, t));
      if (kind === "extra") return table.addDown({ id: 0, color: o.color, t: at }, now);
      if (giftsDue.length >= MAX_GIFTS_DUE) return false;
      giftsDue.push({ kind, t: at });
      return true;
    },
    grab(finger, x, y) {
      if (!cfg.grab || table.ctrl !== "human" || table.mode !== "play") return false;
      if (holds.has(finger) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      // A ball waiting on the plunger is left to the plunger pad over it.
      const b = pickBall(world.balls, x, y, GRAB_REACH, (c) => c.hold !== null || inLane(c));
      if (!b) return false;
      b.hold = { x: 0, y: 0 };
      holds.set(finger, b);
      table.drag(finger, x, y);
      return true;
    },
    drag(finger, x, y) {
      const hold = holds.get(finger)?.hold;
      if (!hold || !Number.isFinite(x) || !Number.isFinite(y)) return;
      hold.x = Math.max(0, Math.min(TABLE_W, x));
      hold.y = Math.max(0, Math.min(TABLE_H, y));
    },
    drop(finger, vx, vy) {
      const b = holds.get(finger);
      if (!b) return;
      holds.delete(finger);
      b.hold = null;
      const ok = Number.isFinite(vx) && Number.isFinite(vy);
      const v = ok ? Math.hypot(vx, vy) : 0;
      const k = v > throwMax ? throwMax / v : 1;
      b.vx = ok ? vx * k : 0;
      b.vy = ok ? vy * k : 0;
      b.qx = b.x;
      b.qy = b.y;
      b.qt = world.t;
    },
    held: () => holds.size,
    place(x, y, vx, vy) {
      const b = makeBall(nextId++, x, y, BALL_R, world.t);
      b.vx = vx;
      b.vy = vy;
      b.color = o.color;
      world.balls.push(b);
      return b;
    },
    update(dt, now) {
      clock = now;
      if (pressing) {
        pull = Math.min(1, pull + dt / PULL_S);
        setTip(pull);
      }
      for (const [finger, b] of holds) if (!world.balls.includes(b)) holds.delete(finger);
      world.events.length = 0;
      stepWorld(world, dt, SUBSTEPS);
      handleEvents();
      toys.update(dt);
      // Toys that keep balls waiting for others let them go once nothing else is in play.
      if (table.mode === "play" && free() === 0 && toys.held().length > 0) toys.flush();
      noteFlippers();
      advanceTubes(now);
      expireGifts();
      spin(dt);
      unstick();
      if (
        table.mode === "over" &&
        table.ctrl === "attract" &&
        world.t - since > ATTRACT_RESTART_S
      ) {
        table.start("attract");
      }
    },
    finished() {
      if (table.mode === "over") return world.t - since >= OVER_MS / 1000;
      if (table.mode === "leaving") {
        const n = table.inPlay();
        return n === 0 || (n === 1 && table.waiting()) || world.t - since >= LEAVE_DRAIN_MS / 1000;
      }
      return false;
    },
  };

  const clear = () => {
    for (const b of holds.values()) b.hold = null;
    holds.clear();
    world.balls.length = 0;
    tubes.length = 0;
    due.length = 0;
    giftsDue.length = 0;
    gifts.length = 0;
    for (const p of layout.posts) p.on = false;
    waitingDowns.length = 0;
    for (const r of world.rollovers) r.inside.clear();
    for (const f of world.flippers) {
      f.held = false;
      f.angle = f.rest;
      f.omega = 0;
    }
    pressing = false;
    pull = 0;
    setTip(0);
    saveUntil = -Infinity;
    lastFlipper = new Map();
    spinner.speed = 0;
    toys.reset();
    shake.amount = 0;
    shake.at = -Infinity;
  };

  const setTip = (p: number) => {
    const tip = layout.plunger.tip;
    const y = layout.plunger.tipY + p * layout.plunger.travel;
    tip.ay = y;
    tip.by = y;
    tip.y0 = y - tip.r;
    tip.y1 = y + tip.r;
  };

  const inLane = (b: Ball) => {
    const z = layout.plunger.zone;
    return b.x >= z.x0 && b.x <= z.x1 && b.y >= z.y0 && b.y <= z.y1;
  };

  const waitingBall = (): Ball | null => {
    for (const b of world.balls) if (!b.hold && inLane(b)) return b;
    return null;
  };

  const serve = () => {
    const p = layout.plunger.ball;
    const b = makeBall(nextId++, p.x, p.y, BALL_R, world.t);
    b.color = o.color;
    world.balls.push(b);
  };

  const fire = (strength: number) => {
    const b = waitingBall();
    if (!b) return;
    // The tip springs back up under the ball.
    b.y = Math.min(b.y, layout.plunger.ball.y);
    b.vx = 0;
    b.vy = -(LAUNCH_V0 + LAUNCH_DV * Math.max(0, Math.min(1, strength))) * launchScale;
    if (!b.bonus) saveUntil = world.t + SAVE_MS / 1000;
  };

  const add = (n: number) => {
    const double = gifts.some((g) => g.kind === "double");
    table.score += n * table.multiplier * (double ? 2 : 1);
  };

  const applyGift = (kind: Gift) => {
    const until = world.t + GIFT_S[kind];
    const g = gifts.find((x) => x.kind === kind);
    if (g) g.until = Math.max(g.until, until);
    else gifts.push({ kind, at: world.t, until });
    if (kind === "shield") {
      saveUntil = Math.max(saveUntil, until);
      flash("save", 0);
    } else if (kind === "posts") {
      for (const p of layout.posts) p.on = true;
    }
    flash("gift", GIFTS_INDEX[kind]);
  };

  const expireGifts = () => {
    for (let i = gifts.length - 1; i >= 0; i--) {
      if (world.t < gifts[i]!.until) continue;
      if (gifts[i]!.kind === "posts") for (const p of layout.posts) p.on = false;
      gifts.splice(i, 1);
    }
  };

  const noteFlippers = () => {
    // Remember the last flipper that swung into each ball, for stats and tests.
    for (const f of world.flippers) {
      if (Math.abs(f.omega) < 4) continue;
      for (const b of world.balls) {
        const d = Math.hypot(b.x - f.px, b.y - f.py);
        if (d < f.len + f.r0 + b.r + 6) lastFlipper.set(b.id, f.index);
      }
    }
    if (lastFlipper.size > 32) {
      const live = new Set(world.balls.map((b) => b.id));
      for (const id of lastFlipper.keys()) if (!live.has(id)) lastFlipper.delete(id);
    }
  };

  const lostLast = () => {
    if (table.mode === "leaving") return;
    if (table.mode !== "play") return;
    if (world.t < saveUntil) {
      flash("save", 0);
      serve();
      return;
    }
    table.left--;
    table.multiplier = 1;
    if (table.left > 0) {
      serve();
      return;
    }
    table.mode = "over";
    since = world.t;
    for (const f of world.flippers) f.held = false;
  };

  const capture = (b: Ball) => {
    const i = world.balls.indexOf(b);
    if (i < 0) return;
    world.balls.splice(i, 1);
    for (const r of world.rollovers) r.inside.delete(b.id);
    const by = lastFlipper.get(b.id);
    stats.byFlipper[by ?? 4]!++;
    lastFlipper.delete(b.id);
    const speed = Math.hypot(b.vx, b.vy);
    const shot = { id: b.id, u: layout.exitU, vx: b.vx, vy: b.vy, color: b.color, t: clock };
    if (o.deck() && o.onUp(shot)) {
      stats.deck++;
      add(POINTS.deck);
      flash("deck", 0);
      const pts = layout.exitTube;
      tubes.push({
        id: b.id,
        kind: "up",
        gift: null,
        pts,
        motion: {
          length: polyLength(pts),
          ms: CLIMB_MS,
          v0: Math.min(2200, Math.max(500, speed)),
          v1: CROSS_V,
        },
        start: clock,
        color: b.color,
        bonus: b.bonus,
        x: b.x,
        y: b.y,
      });
      if (table.inPlay() === 0 && table.mode === "play") serve();
    } else {
      stats.orbit++;
      add(POINTS.orbit);
      flash("deck", 0);
      const pts = layout.orbitTube;
      tubes.push({
        id: b.id,
        kind: "orbit",
        gift: null,
        pts,
        motion: {
          length: polyLength(pts),
          ms: ORBIT_MS,
          v0: Math.min(2400, Math.max(600, speed)),
          v1: ORBIT_V,
        },
        start: clock,
        color: b.color,
        bonus: b.bonus,
        x: b.x,
        y: b.y,
      });
    }
  };

  const handleEvents = () => {
    let drained = false;
    for (const e of world.events) {
      if (e.type === "hit") {
        if (e.tag === "bumper") {
          add(POINTS.bumper);
          flash("bumper", e.index);
        } else if (e.tag === "sling" && e.kicked) {
          add(POINTS.sling);
          flash("sling", e.index);
        } else if (e.tag === "target") {
          flash("target", e.index);
          if (!table.targets[e.index]) {
            table.targets[e.index] = true;
            add(POINTS.target);
            if (table.targets.every(Boolean)) {
              table.multiplier = Math.min(MAX_MULTIPLIER, table.multiplier + 1);
              table.targets = [false, false, false];
              flash("mult", table.multiplier - 2);
            }
          }
        }
      } else if (e.type === "roll") {
        if (e.tag === "lane") {
          flash("lane", e.index);
          if (!table.lanes[e.index]) {
            table.lanes[e.index] = true;
            add(POINTS.lane);
            if (table.lanes.every(Boolean)) {
              add(POINTS.lanes);
              table.lanes = [false, false, false];
            }
          }
        } else if (e.tag === "inlane") {
          add(POINTS.inlane);
          flash("inlane", e.index);
        } else if (e.tag === "outlane") {
          add(POINTS.outlane);
          flash("outlane", e.index);
        }
      } else if (e.type === "cross") {
        if (e.tag === "deck" && e.dir > 0) {
          capture(e.ball);
        } else if (e.tag === "spinner") {
          spinner.speed = Math.min(60, spinner.speed + e.speed / 70);
          flash("spinner", 0);
        }
      } else if (e.type === "out") {
        stats.drains++;
        drained = true;
        lastFlipper.delete(e.ball.id);
      }
      toys.event(e);
    }
    if (drained && table.inPlay() === 0) lostLast();
  };

  let spun = 0;
  const spin = (dt: number) => {
    spinner.angle += spinner.speed * dt;
    spinner.speed *= Math.exp(-dt * 1.6);
    if (spinner.speed < 0.5) spinner.speed = 0;
    const turns = Math.floor(spinner.angle / Math.PI);
    if (turns > spun) add(POINTS.spinner * Math.min(4, turns - spun));
    spun = turns;
    // Keep the angle small over days of play.
    if (spinner.angle > 1000 * Math.PI) {
      spinner.angle -= 1000 * Math.PI;
      spun -= 1000;
    }
  };

  const advanceTubes = (now: number) => {
    for (let i = tubes.length - 1; i >= 0; i--) {
      const t = tubes[i]!;
      const m = motionAt(t.motion, now - t.start);
      const p = pointAlong(t.pts, m.s);
      t.x = p.x;
      t.y = p.y;
      if (!m.done) continue;
      tubes.splice(i, 1);
      if (t.kind === "up") continue;
      if (t.kind === "gift") {
        if (t.gift && table.mode === "play") applyGift(t.gift);
        continue;
      }
      const rel = t.kind === "orbit" ? layout.orbitRelease : layout.returnRelease;
      const b = makeBall(t.id, rel.x, rel.y, BALL_R, world.t);
      b.vx = rel.vx;
      b.vy = rel.vy;
      b.color = t.color;
      b.bonus = t.bonus || t.kind === "return";
      world.balls.push(b);
    }
    for (let i = due.length - 1; i >= 0; i--) {
      const d = due[i]!;
      if (now < d.t) continue;
      due.splice(i, 1);
      const pts = layout.returnTube;
      tubes.push({
        id: nextId++,
        kind: "return",
        gift: null,
        pts,
        motion: {
          length: polyLength(pts),
          ms: RETURN_MS,
          v0: CROSS_V,
          v1: layout.returnRelease.vy,
        },
        start: d.t,
        color: d.color,
        bonus: true,
        x: pts[0]!.x,
        y: pts[0]!.y,
      });
    }
    for (let i = giftsDue.length - 1; i >= 0; i--) {
      const d = giftsDue[i]!;
      if (now < d.t) continue;
      giftsDue.splice(i, 1);
      const pts = layout.returnTube;
      tubes.push({
        id: nextId++,
        kind: "gift",
        gift: d.kind,
        pts,
        motion: { length: polyLength(pts), ms: RETURN_MS, v0: CROSS_V, v1: 200 },
        start: d.t,
        color: o.color,
        bonus: false,
        x: pts[0]!.x,
        y: pts[0]!.y,
      });
    }
    for (let i = waitingDowns.length - 1; i >= 0; i--) {
      const w = waitingDowns[i]!;
      if (now - w.at > WAIT_EXPIRE_MS) {
        waitingDowns.splice(i, 1);
      } else if (table.inPlay() < MAX_IN_PLAY) {
        waitingDowns.splice(i, 1);
        due.push({ id: w.id, color: w.color, t: now });
      }
    }
  };

  const unstick = () => {
    const anyHeld = world.flippers.some((f) => f.held);
    const z = layout.plunger.zone;
    for (const b of world.balls) {
      if (b.hold) continue;
      if (Math.hypot(b.x - b.qx, b.y - b.qy) > b.r) {
        b.qx = b.x;
        b.qy = b.y;
        b.qt = world.t;
        continue;
      }
      const inLane = b.x >= z.x0 && b.x <= z.x1 && b.y >= z.y0;
      if (inLane || anyHeld || world.t - b.qt < STUCK_S) continue;
      b.vx += (o.random() - 0.5) * 900;
      b.vy -= 300 + o.random() * 500;
      b.qt = world.t;
    }
  };

  const host: ToyHost = {
    world,
    layout,
    now: () => world.t,
    random: o.random,
    playing: () => table.mode === "play",
    add,
    flash,
    raiseMultiplier() {
      table.multiplier = Math.min(MAX_MULTIPLIER, table.multiplier + 1);
      flash("mult", table.multiplier - 2);
    },
    take(b) {
      if (table.mode !== "play" || b.hold) return false;
      const i = world.balls.indexOf(b);
      if (i < 0) return false;
      world.balls.splice(i, 1);
      for (const r of world.rollovers) r.inside.delete(b.id);
      return true;
    },
    free(b, x, y, vx, vy) {
      b.x = b.px = b.qx = x;
      b.y = b.py = b.qy = y;
      b.vx = vx;
      b.vy = vy;
      b.qt = world.t;
      b.sides = [];
      if (!world.balls.includes(b)) world.balls.push(b);
    },
    serveIfEmpty() {
      if (table.mode === "play" && free() === 0) serve();
    },
    addBall(x, y, vx, vy) {
      if (table.mode !== "play" || table.inPlay() >= MAX_IN_PLAY) return null;
      const b = makeBall(nextId++, x, y, BALL_R, world.t);
      b.vx = vx;
      b.vy = vy;
      b.color = o.color;
      world.balls.push(b);
      return b;
    },
    shake(amount) {
      shake.amount = Math.max(0, Math.min(1, amount));
      shake.at = world.t;
    },
  };
  const toys: Toys = o.toys ? o.toys(host) : NO_TOYS;
  if (o.toys) world.tick = (h) => toys.tick(h);

  // Attract games begin as soon as the table exists.
  table.start("attract");
  stats.games = 0;
  return table;
};
