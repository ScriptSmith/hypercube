/**
 * The upper deck on the screen above a bank: its game. No DOM; screen.ts wires it to the network
 * and deckview.ts draws it. The layout is in deckgeo.ts and the devices in deckparts.ts.
 *
 * A ball from a table climbs its chute (scripted, so a late message is simply further along),
 * flies up into the deck and works its way down through the bumpers and devices: magnets and
 * saucers catch it and throw it on, ramps and orbits carry it round, the lock gathers three for a
 * multiball, the nest gathers balls from many tables and tips them out to the players, and gift
 * bubbles it pops send a gift down to its table. In the end it falls into a hole in the floor, or
 * is guided down after DECK_GUIDE_MS free or DECK_LIFE_MS on the deck, and runs along the rail
 * under the floor to the table it is going to, dropping out of the bottom edge just as that
 * table's return tube shows it coming in.
 *
 * Everything that can hold a ball lets it go by itself; a free ball that stops moving is nudged,
 * then guided down; and the deck never holds more than DECK_MAX balls.
 */
import { bankFraction } from "../../core/layout";
import {
  BALL_R,
  CLIMB_MS,
  CROSS_V,
  DECK_GUIDE_MS,
  DECK_LIFE_MS,
  DECK_MAX,
  DECK_POINTS,
  FALL_MS,
  type Gift,
  GIFTS,
  MAX_IN_PLAY,
  RAIN_STEP,
} from "./config";
import { BAND_CHUTE, buildBandPlayfield } from "./bandgeo";
import {
  buildPlayfield,
  buildSlots,
  DECK_SUBSTEPS,
  type DeckGeometry,
  type Playfield,
  type Slot,
  type SlotInfo,
  slotInfos,
  slotKey,
} from "./deckgeo";
import {
  type Bubbles,
  createBubbles,
  createLock,
  createMagnet,
  createNest,
  createSaucer,
  createUpKicker,
  type DeckBall,
  type Device,
  type Lock,
  type Magnet,
  type Nest,
  type Release,
  type Saucer,
  type UpKicker,
} from "./deckparts";
import {
  endSpeeds,
  motionAt,
  type Motion,
  type Pt,
  pointAlong,
  polyLength,
  smoothPath,
} from "./path";
import { type Ball, makeBall, makeWorld, moveCircle, stepWorld, type World } from "./physics";
import type { DownMsg, GiftMsg, ScoreMsg, UpMsg } from "./wire";

export { slotInfos, slotKey };
export type { DeckBall, DeckGeometry, Slot, SlotInfo };

export interface DeckOptions {
  W: number;
  H: number;
  count: number;
  /**
   * The screen height whose deck this one moves and is sized like, deck px; H when absent. A
   * wall's deck is a band much wider than it is tall, laid out by `buildBandPlayfield`, with
   * balls as big and as quick as on a screen's.
   */
  band?: { scale: number };
  /** Where the tables are at first; a bank's are found as its frames report in. */
  slots?: SlotInfo[];
  rain: boolean;
  random: () => number;
  /** A ball is on its way down to a table. */
  onDown(slot: Slot, m: DownMsg): void;
  /** Points for a table's balls, batched. */
  onPoints(frame: string, list: [number, number][]): void;
  /** A gift is on its way down to a table. */
  onGift?(slot: Slot, m: GiftMsg): void;
}

/** A popped gift on its way down to its table. */
export interface GiftToken {
  kind: Gift;
  slot: number;
  pts: Pt[];
  motion: Motion;
  start: number;
  x: number;
  y: number;
}

export interface DeckParts {
  saucers: Saucer[];
  magnets: Magnet[];
  vuk: UpKicker;
  lock: Lock;
  nest: Nest;
  bubbles: Bubbles;
  captive: Ball;
  tokens: readonly GiftToken[];
  /** Hits on the big bumper since it last burst, and its level (0 to 2). */
  big: { hits: number; level: number };
  /** Each star rollover's last ball: its colour and when (world seconds). */
  stars: { color: number; at: number }[];
}

export interface Deck {
  readonly geo: DeckGeometry;
  readonly balls: readonly DeckBall[];
  readonly world: World;
  readonly parts: DeckParts;
  /** Clock ms of the last update. */
  readonly clock: number;
  total: number;
  /** Lit deck targets, by slot. */
  lit: boolean[];
  readonly spinners: { angle: number; speed: number }[];
  /** How often each device has been visited, for status and tests. */
  readonly stats: Record<string, number>;
  /** For tests: when recent `up` balls arrived, against when they were due at the bottom edge. */
  readonly arrivals: { from: string; ref: number; late: number; at: number; x: number }[];
  /** For tests: recent `down` messages sent. */
  readonly sent: {
    to: string;
    h: number;
    id: number;
    from: string;
    ref: number;
    t: number;
    at: number;
    slot: number;
  }[];
  /** For tests: recent gifts sent. */
  readonly gifts: { to: string; h: number; kind: Gift; t: number; at: number }[];
  setSlots(infos: SlotInfo[], present: ReadonlySet<string>): void;
  up(m: UpMsg, from: string, now: number, local: number): void;
  score(m: ScoreMsg, from: string, local: number): void;
  /** One bonus ball for every playing table. */
  rain(now: number): void;
  /** Send a gift to a table as if one of its balls had popped a bubble at (x, y). */
  giveGift(slot: Slot, kind: Gift, x: number, y: number, now: number): boolean;
  /** Someone is playing at one of the tables below. */
  playing(): boolean;
  update(dt: number, now: number, local: number): void;
  flashAge(tag: string, index: number): number;
  reset(): void;
}

const CHUTE_MS = 300;
/** Balls in flight the deck tops itself up to while nobody plays, and while play is quiet. */
const AMBIENT_ATTRACT = 6;
const AMBIENT_QUIET = 3;
const AMBIENT_EVERY_MS = 1100;
/** With nothing coming up from the tables for this long, the deck drops balls in itself. */
const QUIET_MS = 10_000;
/** A table that hasn't reported its score for this long counts as not playing. */
const STALE_MS = 8000;
/** Down messages kept to re-send if their frame goes. */
const RESEND_KEEP_MS = 1500;
const MAX_TOTAL_BALLS = DECK_MAX + 8;
/**
 * A free ball that stays within STUCK_R radii of one spot for this long is nudged; twice, then
 * guided down. Counting from where it settled, not from its last move, so a ball that a nudge
 * shakes loose but that falls back into the same pocket is still guided down in the end.
 */
const STUCK_MS = 2500;
const STUCK_R = 3;
const MAX_NUDGES = 2;
/** No device or ramp holds a ball longer than this. */
const HOLD_LIMIT_MS = 60_000;
const MAX_TOKENS = 8;
const MAX_EXTRAS = 8;
const BIG_STEP = 6;
const BIG_LEVELS = 3;

export const createDeck = (o: DeckOptions): Deck => {
  /** Speeds scale with this; lengths that belong to the deck's own shape scale with o.H. */
  const S = o.band?.scale ?? o.H;
  const pf: Playfield = o.band ? buildBandPlayfield(o.W, o.H, S) : buildPlayfield(o.W, o.H);
  const unit = o.band ? pf.U : undefined;
  const chute = o.band ? BAND_CHUTE : undefined;
  const world = makeWorld({
    gravity: pf.gravity,
    vmax: pf.vmax,
    damping: pf.damping,
    bounds: { x0: -o.W, y0: -o.H, x1: o.W * 2, y1: o.H * 2 },
  });
  let sg = buildSlots(o.W, o.H, o.count, o.slots ?? slotInfos(o.count, []), unit, chute);
  let geo: DeckGeometry = { ...pf, ...sg };
  const balls: DeckBall[] = [];
  const flashes = new Map<string, number>();
  const pending = new Map<string, number>();
  const arrivals: Deck["arrivals"] = [];
  const sent: Deck["sent"] = [];
  const giftLog: Deck["gifts"] = [];
  const resend: { m: DownMsg; slot: Slot; until: number; color: number }[] = [];
  const spinners = pf.spinners.map(() => ({ angle: 0, speed: 0 }));
  const stats: Record<string, number> = {};
  const tokens: GiftToken[] = [];
  const lastGift = new Map<string, number>();
  let present: ReadonlySet<string> = new Set();
  let nextId = 1;
  let flushAt = 0;
  let lastUp = -Infinity;
  let ambientAt = 0;
  let bubbleAt = 0;
  let nextRain = RAIN_STEP;
  let clock = 0;
  let moveT = 0;

  const count = (k: string) => {
    stats[k] = (stats[k] ?? 0) + 1;
  };

  // Devices.
  const saucers = pf.saucers.map((s, i) => createSaucer(s, `saucer${i}`));
  const magnets = pf.magnets.map((m, i) => createMagnet(m, `magnet${i}`));
  const vuk = createUpKicker(pf.vuk);
  const lock = createLock(pf.lock);
  const nest = createNest(pf.nest, pf.U);
  const bubbles = createBubbles(pf.bubbles, o.H);
  const devices: Device[] = [nest, lock, ...saucers, vuk, ...magnets];
  const big = { hits: 0, level: 0 };
  const stars = pf.stars.map(() => ({ color: 0, at: -Infinity }));
  const bigKick = pf.big.kick;

  // The captive ball lives in the solver with the rest, but only ever in its chamber.
  const captive = makeBall(-1, pf.captive.rest.x, pf.captive.rest.y, pf.captive.r);
  let lastTouch = { owner: "", at: -Infinity };

  const parts: DeckParts = {
    saucers,
    magnets,
    vuk,
    lock,
    nest,
    bubbles,
    captive,
    tokens,
    big,
    stars,
  };

  // Moving bumpers move every sub-step, a fraction of a pixel at a time.
  world.tick = (h) => {
    moveT += h;
    const c = pf.cluster;
    c.bumpers.forEach((b, i) => {
      const a = moveT * c.omega + (i * Math.PI * 2) / 3;
      moveCircle(b, c.x + Math.cos(a) * c.radius, c.y + Math.sin(a) * c.radius, h);
    });
    const s = pf.shuttle;
    const k = 0.5 - 0.5 * Math.cos((moveT * Math.PI * 2) / s.period);
    moveCircle(s.bumper, s.x0 + (s.x1 - s.x0) * k, s.y, h);
  };

  const apply = () => {
    world.shapes = [...pf.shapes, ...sg.slotShapes];
    world.gates = pf.gates;
    world.rollovers = pf.stars;
    if (!world.balls.includes(captive)) world.balls.push(captive);
  };
  apply();

  const flash = (tag: string, index: number) => flashes.set(`${tag}:${index}`, world.t);

  const live = () => balls.filter((b) => b.phase !== "guided" && b.phase !== "fall").length;

  const ball = (x: number, y: number, r: number, color: number): DeckBall => {
    const b = makeBall(nextId++, x, y, r, world.t) as DeckBall;
    b.color = color;
    b.phase = "free";
    b.pts = [];
    b.motion = { length: 0, ms: 0, v0: 0, v1: 0 };
    b.start = 0;
    b.r0 = r;
    b.r1 = r;
    b.freeAt = clock;
    b.life = clock;
    b.hole = -1;
    b.target = -1;
    b.vx0 = 0;
    b.from = "";
    b.ref = 0;
    b.rain = false;
    b.dev = "";
    b.rail = -1;
    b.nudges = 0;
    return b;
  };

  const nearestHole = (x: number) => {
    let best = 0;
    let d = Infinity;
    sg.slots.forEach((s, i) => {
      const e = Math.abs(s.holeX - x);
      if (e < d) {
        d = e;
        best = i;
      }
    });
    return best;
  };

  const slotByKey = (key: string) => sg.slots.find((s) => s.key === key) ?? null;
  const isPresent = (s: Slot) => s.frame !== null && present.has(s.frame);
  /** The table takes another ball from the deck, a person's game or an attract bot's. */
  const takes = (s: Slot) => isPresent(s) && s.open && s.inPlay < MAX_IN_PLAY;
  const hasRoom = (s: Slot) => s.playing && takes(s);
  const playingSlots = () => sg.slots.filter((s) => isPresent(s) && s.playing);

  /** The table nearest to slot `i` (itself first) that passes `ok`. */
  const nearest = (i: number, ok: (s: Slot) => boolean): Slot | null => {
    const from = sg.slots[i];
    if (!from) return null;
    let best: Slot | null = null;
    let d = Infinity;
    for (const s of sg.slots) {
      if (!ok(s)) continue;
      const e = Math.abs(s.holeX - from.holeX);
      if (e < d) {
        d = e;
        best = s;
      }
    }
    return best;
  };
  const nearestPlaying = (i: number) => nearest(i, hasRoom);

  /**
   * Where a ball that fell into hole `i` goes. Every ball comes down to some table while one is
   * there: usually the one under its hole, attract tables included, so balls from all over land on
   * everyone's tables.
   */
  const route = (i: number, b: DeckBall): Slot | null => {
    // A bonus ball the deck drops for a playing table goes to one whatever `rain` says.
    if (b.rain) return nearestPlaying(i) ?? nearest(i, takes);
    const owner = b.owner ? slotByKey(b.owner) : null;
    const home = owner && isPresent(owner) && owner.open ? owner : null;
    if (!o.rain && home) return home;
    // A person's ball stays with people, so a deck shot keeps a game going.
    if (o.rain && owner?.playing) {
      const p = nearestPlaying(i);
      if (p) return p;
    }
    // With every table full, the one under the hole lets the ball in when it has room. Only when
    // no table has a game on (between games, or none there) does a ball drain.
    return nearest(i, takes) ?? nearest(i, (s) => isPresent(s) && s.open);
  };

  const unworld = (b: DeckBall) => {
    const wi = world.balls.indexOf(b);
    if (wi >= 0) world.balls.splice(wi, 1);
    // A ball taken off a star mid-roll mustn't stay on its list.
    for (const r of pf.stars) r.inside.delete(b.id);
  };

  /** Steer a ball down into hole `i` along a scripted path. */
  const guideTo = (b: DeckBall, i: number, now: number, ms: number, arc = false) => {
    const s = sg.slots[i]!;
    unworld(b);
    b.phase = "guided";
    b.dev = "";
    b.rail = -1;
    b.hole = i;
    const end = [
      { x: s.holeX, y: sg.holeY - sg.R * 2 },
      { x: s.holeX, y: sg.holeY + sg.R * 0.6 },
    ];
    b.pts = arc
      ? smoothPath(
          [{ x: b.x, y: b.y }, { x: (b.x + s.holeX) / 2, y: b.y + o.H * 0.12 }, ...end],
          pf.U,
        )
      : [{ x: b.x, y: b.y }, ...end];
    b.motion = {
      length: polyLength(b.pts),
      ms,
      v0: Math.min(Math.hypot(b.vx, b.vy), S),
      v1: S * 0.25,
    };
    b.start = now;
    b.r0 = b.r;
    b.r1 = b.r;
  };

  const guide = (b: DeckBall, now: number, quick = false) => {
    const owner = !o.rain && b.owner ? slotByKey(b.owner) : null;
    const i = owner ? owner.index : nearestHole(b.x);
    const s = sg.slots[i]!;
    const length = Math.hypot(s.holeX - b.x, sg.holeY - b.y);
    const ms = (length / (S * 0.55)) * 1000;
    guideTo(b, i, now, Math.max(quick ? 350 : 600, Math.min(quick ? 700 : 1800, ms)));
  };

  const fall = (b: DeckBall, i: number, now: number) => {
    const target = route(i, b);
    const s = sg.slots[i]!;
    const to = target ?? s;
    unworld(b);
    b.phase = "fall";
    b.hole = i;
    b.target = target ? target.index : -1;
    b.pts = [
      { x: b.x, y: b.y },
      { x: s.holeX, y: sg.railY },
      { x: to.holeX, y: sg.railY },
      { x: to.holeX, y: o.H + to.k * BALL_R + 4 },
    ];
    const length = polyLength(b.pts);
    const across = Math.abs(to.holeX - s.holeX);
    b.motion = {
      length,
      ms: FALL_MS + (across / (S * 1.6)) * 1000,
      v0: Math.min(Math.hypot(b.vx, b.vy), S * 0.6),
      v1: CROSS_V * to.k,
    };
    b.motion.v1 = endSpeeds(b.motion).v1;
    b.start = now;
    b.r0 = b.r;
    b.r1 = to.k * BALL_R;
    if (!target || !target.frame) return;
    const m: DownMsg = { i: b.id, h: target.h, c: b.color, t: now + b.motion.ms };
    o.onDown(target, m);
    target.inPlay++;
    sent.push({
      to: target.frame,
      h: target.h,
      id: b.id,
      from: b.from,
      ref: b.ref,
      t: m.t,
      at: now,
      slot: target.index,
    });
    if (sent.length > 24) sent.shift();
    resend.push({ m, slot: target, until: now + RESEND_KEEP_MS, color: b.color });
    if (resend.length > 32) resend.shift();
  };

  const remove = (b: DeckBall) => {
    const i = balls.indexOf(b);
    if (i >= 0) balls.splice(i, 1);
    unworld(b);
  };

  /** Take a ball out of whatever device holds it. */
  const release = (b: DeckBall, now: number) => {
    if (b.phase !== "held") return;
    for (const d of devices) if (d.drop(b, now)) break;
  };

  /** Keep at most DECK_MAX balls on the deck: the oldest free one, else held one, goes down. */
  const makeRoom = (now: number) => {
    while (live() >= DECK_MAX) {
      const pick = (phase: DeckBall["phase"]) =>
        balls.filter((b) => b.phase === phase).sort((a, b) => a.freeAt - b.freeAt)[0];
      const b = pick("free") ?? pick("rail") ?? pick("held") ?? pick("chute");
      if (!b) break;
      release(b, now);
      guide(b, now, true);
    }
    while (balls.length >= MAX_TOTAL_BALLS) {
      const gone = balls.find((b) => b.phase === "guided" || b.phase === "fall") ?? balls[0]!;
      release(gone, now);
      remove(gone);
    }
  };

  const free = (b: DeckBall, vx: number, vy: number, now: number) => {
    b.phase = "free";
    b.dev = "";
    b.rail = -1;
    b.vx = vx;
    b.vy = vy;
    b.px = b.x;
    b.py = b.y;
    b.r = sg.R;
    b.freeAt = now;
    b.sides = [];
    b.qx = b.x;
    b.qy = b.y;
    b.qt = now;
    b.nudges = 0;
    if (!world.balls.includes(b)) world.balls.push(b);
  };

  /** Points go to the table whose ball scored them; the deck's own balls are for show. */
  const score = (b: { owner: string }, pts: number) => {
    if (!b.owner) return;
    deck.total += pts;
    pending.set(b.owner, (pending.get(b.owner) ?? 0) + pts);
  };

  const ride = (b: DeckBall, ri: number, now: number, entry: number) => {
    const r = pf.rails[ri];
    if (!r) return;
    unworld(b);
    b.phase = "rail";
    b.rail = ri;
    b.dev = "";
    b.pts = [{ x: b.x, y: b.y }, ...r.pts];
    const length = polyLength(b.pts);
    b.motion = {
      length,
      ms: (length / r.speed) * 1000,
      v0: Math.max(r.speed * 0.6, Math.min(r.speed * 1.4, entry)),
      v1: r.exitSpeed,
    };
    b.start = now;
    b.r0 = b.r;
    b.r1 = b.r;
    // Nobody holds the ride for ever: it is scripted and timed, and counted from here.
    b.qt = now;
    if (r.name === "orbitL" || r.name === "orbitR") {
      count("orbit");
      score(b, DECK_POINTS.orbit);
    } else if (r.name === "loop") {
      count("loop");
      score(b, DECK_POINTS.loop);
    } else {
      count("ramp");
    }
    flash("rail", ri);
  };

  const hitBig = (b: Ball) => {
    score(b, DECK_POINTS.big);
    flash("big", 0);
    big.hits++;
    count("big");
    const level = Math.min(BIG_LEVELS - 1, Math.floor(big.hits / BIG_STEP));
    if (big.hits >= BIG_STEP * BIG_LEVELS) {
      // It bursts: a big score and a big kick, then it starts small again.
      score(b, DECK_POINTS.bigBurst);
      flash("burst", 0);
      count("burst");
      big.hits = 0;
      big.level = 0;
    } else if (level !== big.level) {
      big.level = level;
      score(b, DECK_POINTS.bigLevel);
      flash("bigLevel", level);
    }
    pf.big.r = pf.bigR + big.level * pf.U * 0.25;
    pf.big.kick = bigKick * (1 + big.level * 0.15);
    moveCircle(pf.big, pf.big.x, pf.big.y, 0);
  };

  const handleEvents = (now: number) => {
    for (const e of world.events) {
      if (e.type === "hit") {
        if (e.ball === captive) {
          if (e.tag === "captive" && now - lastTouch.at < 3000) {
            flash("captive", 0);
            count("captive");
            score(lastTouch, DECK_POINTS.captive);
          }
          continue;
        }
        if (e.tag === "bumper") {
          flash("bumper", e.index);
          count("pop");
          score(e.ball, DECK_POINTS.bumper);
        } else if (e.tag === "cluster") {
          flash("cluster", e.index);
          count("cluster");
          score(e.ball, DECK_POINTS.cluster);
        } else if (e.tag === "shuttle") {
          flash("shuttle", 0);
          count("shuttle");
          score(e.ball, DECK_POINTS.shuttle);
        } else if (e.tag === "big") {
          hitBig(e.ball);
        } else if (e.tag === "mushroom") {
          flash("mushroom", e.index);
          count("mushroom");
          score(e.ball, DECK_POINTS.mushroom);
        } else if (e.tag === "sling" && e.kicked) {
          flash("sling", e.index);
          count("sling");
          score(e.ball, DECK_POINTS.sling);
        } else if (e.tag === "target") {
          flash("target", e.index);
          if (!deck.lit[e.index]) {
            deck.lit[e.index] = true;
            score(e.ball, DECK_POINTS.target);
            if (deck.lit.length > 0 && deck.lit.every(Boolean)) {
              score(e.ball, DECK_POINTS.targets);
              deck.lit = deck.lit.map(() => false);
              flash("targets", 0);
            }
          }
        }
      } else if (e.type === "cross") {
        const b = e.ball as DeckBall;
        if (e.tag === "spinner") {
          const s = spinners[e.index];
          if (s) {
            s.speed = Math.min(50, s.speed + e.speed / (S * 0.03));
            flash("spinner", e.index);
            score(b, DECK_POINTS.spinner);
          }
        } else if (e.tag === "rail" && e.dir > 0 && b !== captive && b.phase === "free") {
          const r = pf.rails[e.index];
          if (r && e.speed >= r.minSpeed) ride(b, e.index, now, Math.hypot(b.vx, b.vy));
        }
      } else if (e.type === "roll" && e.tag === "star") {
        const st = stars[e.index];
        if (st && e.ball !== captive) {
          st.color = e.ball.color;
          st.at = world.t;
          count("star");
          score(e.ball, DECK_POINTS.star);
        }
      } else if (e.type === "out") {
        if (e.ball === captive) continue;
        remove(e.ball as DeckBall);
      }
    }
  };

  /** Keep the captive ball in its chamber, and remember which table's ball touched it last. */
  const tendCaptive = (now: number) => {
    const c = pf.captive;
    const m = pf.U * 0.5;
    const out =
      captive.x < c.box.x0 - m ||
      captive.x > c.box.x1 + m ||
      captive.y < c.box.y0 - m ||
      captive.y > c.box.y1 + m;
    if (out || !world.balls.includes(captive)) {
      captive.x = c.rest.x;
      captive.y = c.rest.y;
      captive.vx = 0;
      captive.vy = 0;
      if (!world.balls.includes(captive)) world.balls.push(captive);
    }
    for (const b of balls) {
      if (b.phase !== "free") continue;
      // Loosely: by the end of an update the two have already bounced apart.
      if (Math.hypot(b.x - captive.x, b.y - captive.y) < b.r + captive.r + pf.U * 0.6) {
        lastTouch = { owner: b.owner, at: now };
      }
    }
  };

  /** A gift token from (x, y) down to its table's hole and off the bottom edge. */
  const sendGift = (s: Slot, kind: Gift, x: number, y: number, now: number): boolean => {
    if (!s.frame || !isPresent(s) || !s.playing) return false;
    const pts = smoothPath(
      [
        { x, y },
        { x: (x + s.holeX) / 2, y: Math.min(sg.holeY - sg.R * 4, y + o.H * 0.2) },
        { x: s.holeX, y: sg.holeY - sg.R * 2 },
        { x: s.holeX, y: sg.railY },
        { x: s.holeX, y: o.H + s.k * BALL_R + 4 },
      ],
      pf.U,
    );
    const length = polyLength(pts);
    const motion: Motion = {
      length,
      ms: Math.max(900, (length / (S * 0.8)) * 1000),
      v0: 0,
      v1: 0,
    };
    motion.v0 = motion.v1 = length / (motion.ms / 1000);
    if (tokens.length >= MAX_TOKENS) tokens.shift();
    tokens.push({ kind, slot: s.index, pts, motion, start: now, x, y });
    const m: GiftMsg = { h: s.h, k: GIFTS.indexOf(kind), t: now + motion.ms };
    o.onGift?.(s, m);
    giftLog.push({ to: s.frame, h: s.h, kind, t: m.t, at: now });
    if (giftLog.length > 16) giftLog.shift();
    lastGift.set(s.key, now);
    if (lastGift.size > 128) lastGift.delete(lastGift.keys().next().value!);
    count("gift");
    return true;
  };

  /** Bubbles rise above playing tables, the ones without a gift for longest first. */
  const tendBubbles = (now: number, dt: number) => {
    bubbles.update(now, dt);
    const playing = playingSlots();
    const want = playing.length === 0 ? 1 : Math.max(1, Math.min(3, Math.ceil(playing.length / 3)));
    if (now < bubbleAt || bubbles.live() >= want || sg.slots.length === 0) return;
    bubbleAt = now + 4000 + o.random() * 4000;
    let s: Slot;
    if (playing.length > 0) {
      s = [...playing].sort(
        (a, b) => (lastGift.get(a.key) ?? -Infinity) - (lastGift.get(b.key) ?? -Infinity),
      )[0]!;
    } else {
      s = sg.slots[Math.floor(o.random() * sg.slots.length)]!;
    }
    const kind = GIFTS[Math.floor(o.random() * GIFTS.length)] ?? "double";
    const w = s.x1 - s.x0;
    const x = Math.max(
      o.W * 0.1,
      Math.min(o.W * 0.9, (s.x0 + s.x1) / 2 + (o.random() - 0.5) * w * 0.4),
    );
    bubbles.spawn(x, kind, s.index, now);
  };

  const pour = (list: DeckBall[], now: number) => {
    const playing = playingSlots().filter(hasRoom);
    count("pour");
    for (const b of list) score(b, DECK_POINTS.nest);
    if (playing.length === 0) {
      // Nobody to pour for: they just drop out and play on.
      for (const b of list) free(b, (o.random() - 0.5) * S * 0.2, S * 0.05, now);
      return;
    }
    list.forEach((b, i) => {
      const s = playing[i % playing.length]!;
      // A ball whose table has gone still goes to someone playing.
      const owner = b.owner ? slotByKey(b.owner) : null;
      if (b.owner && !(owner && isPresent(owner))) b.rain = true;
      guideTo(b, s.index, now, 1300 + i * 120, true);
    });
    // One more for every playing table, from the nest.
    playing.slice(0, MAX_EXTRAS).forEach((s, i) => {
      makeRoom(now);
      const b = ball(nest.x, pf.nest.y, sg.R, s.color);
      b.rain = true;
      balls.push(b);
      guideTo(b, s.index, now, 1300 + (list.length + i) * 120, true);
    });
  };

  const handleRelease = (rel: Release[], now: number) => {
    const poured: DeckBall[] = [];
    for (const r of rel) {
      const b = r.ball;
      if ("pour" in r) {
        poured.push(b);
      } else if ("rail" in r) {
        ride(b, r.rail, now, pf.rails[r.rail]?.speed ?? 2000);
      } else {
        free(b, r.vx, r.vy, now);
        if (r.why === "multiball") {
          count("multiball");
          score(b, DECK_POINTS.multiball);
          flash("multiball", 0);
        }
      }
    }
    if (poured.length > 0) pour(poured, now);
  };

  /** A device takes the ball if one wants it. */
  const offer = (b: DeckBall, now: number): boolean => {
    for (const d of devices) {
      if (!d.wants(b, now)) continue;
      unworld(b);
      d.take(b, now);
      b.qt = now;
      flash(d.name, 0);
      const kind = d.name.replace(/\d+$/, "");
      count(kind);
      if (kind === "saucer") score(b, DECK_POINTS.saucer);
      else if (kind === "magnet") score(b, DECK_POINTS.magnet);
      else if (kind === "vuk") score(b, DECK_POINTS.vuk);
      else if (kind === "lock") score(b, DECK_POINTS.lock);
      return true;
    }
    return false;
  };

  /** A free ball that has stopped is nudged, and guided down if that doesn't free it. */
  const unstick = (b: DeckBall, now: number) => {
    if (Math.hypot(b.x - b.qx, b.y - b.qy) > b.r * STUCK_R) {
      b.qx = b.x;
      b.qy = b.y;
      b.qt = now;
      b.nudges = 0;
      return;
    }
    if (now - b.qt < STUCK_MS * (b.nudges + 1)) return;
    if (b.nudges < MAX_NUDGES) {
      b.nudges++;
      b.vx += (o.random() - 0.5) * S * 0.3;
      b.vy -= S * 0.25;
      count("nudge");
      return;
    }
    count("eject");
    guide(b, now, true);
  };

  /** Where the nest should hang: over the middle of the playing tables. */
  const aimNest = () => {
    const playing = playingSlots();
    if (playing.length === 0) {
      nest.aimAt(o.W / 2, 3);
      return;
    }
    const x0 = Math.min(...playing.map((s) => s.x0));
    const x1 = Math.max(...playing.map((s) => s.x1));
    nest.aimAt((x0 + x1) / 2, playing.length + 1);
  };

  const flush = (local: number) => {
    if (local < flushAt) return;
    flushAt = local + 500;
    const byFrame = new Map<string, [number, number][]>();
    for (const [key, pts] of pending) {
      const s = slotByKey(key);
      if (!s?.frame || pts <= 0) continue;
      const list = byFrame.get(s.frame) ?? [];
      list.push([s.h, Math.round(pts)]);
      byFrame.set(s.frame, list);
    }
    pending.clear();
    for (const [frame, list] of byFrame) o.onPoints(frame, list);
  };

  /**
   * The deck drops balls in by itself: a few at a time while nobody is playing below, so the
   * screen stays lively, and now and then while nothing comes up from the tables.
   */
  const ambient = (now: number, local: number) => {
    const playing = sg.slots.some((s) => isPresent(s) && s.playing);
    const quiet = local - lastUp > QUIET_MS;
    const want = playing ? (quiet ? AMBIENT_QUIET : 0) : AMBIENT_ATTRACT;
    const flying = balls.filter((b) => b.phase === "free" || b.phase === "chute").length;
    if (local < ambientAt || flying >= want || live() >= DECK_MAX) return;
    ambientAt = local + AMBIENT_EVERY_MS * (0.7 + o.random() * 0.6);
    const b = ball(
      o.W * (0.05 + o.random() * 0.9),
      pf.ceiling + sg.R * 3,
      sg.R,
      Math.floor(o.random() * 8),
    );
    balls.push(b);
    free(b, (o.random() - 0.5) * S * 0.12, 0, now);
  };

  const deck: Deck = {
    get geo() {
      return geo;
    },
    balls,
    world,
    parts,
    get clock() {
      return clock;
    },
    total: 0,
    lit: sg.slots.map(() => false),
    spinners,
    stats,
    arrivals,
    sent,
    gifts: giftLog,
    setSlots(infos, frames) {
      present = frames;
      const sig = (list: readonly SlotInfo[]) => list.map((s) => `${slotKey(s)}/${s.n}`).join(",");
      if (sig(infos) === sig(sg.slots)) return;
      const old = new Map(sg.slots.map((s) => [s.key, s]));
      sg = buildSlots(o.W, o.H, o.count, infos, unit, chute);
      geo = { ...pf, ...sg };
      for (const s of sg.slots) {
        const was = old.get(s.key);
        if (!was) continue;
        s.playing = was.playing;
        s.open = was.open;
        s.score = was.score;
        s.left = was.left;
        s.inPlay = was.inPlay;
        s.seen = was.seen;
      }
      deck.lit = sg.slots.map((_, i) => deck.lit[i] ?? false);
      apply();
      for (const b of balls) {
        if (b.hole >= sg.slots.length) b.hole = nearestHole(b.x);
      }
      for (const t of tokens) if (t.slot >= sg.slots.length) t.slot = -1;
    },
    up(m, from, now, local) {
      lastUp = local;
      const slot =
        sg.slots.find((s) => s.frame === from && s.h === m.h) ??
        sg.slots.find((s) => s.pos === m.p && s.h === m.h) ??
        null;
      const x = slot?.at
        ? slot.at.tx + m.u * slot.at.tw
        : o.W * bankFraction(m.p, (m.h + m.u) / m.n, o.count);
      const due = m.t + CLIMB_MS;
      const k = slot?.k ?? sg.Rc / BALL_R;
      const rc = BALL_R * k;
      makeRoom(now);
      const b = ball(x, o.H + rc, rc, m.c % 8);
      b.owner = slot?.key ?? `${from}:${m.h}`;
      b.from = from;
      b.ref = m.i;
      b.phase = "chute";
      b.life = due;
      b.pts = [
        { x, y: o.H + rc },
        { x, y: sg.launchY },
      ];
      const rise = Math.max(o.H * 0.1, sg.launchY - o.H * 0.16);
      const launch = Math.sqrt(2 * world.gravity * rise) * (0.88 + o.random() * 0.16);
      b.motion = { length: polyLength(b.pts), ms: CHUTE_MS, v0: CROSS_V * k, v1: launch };
      b.start = due;
      b.r0 = rc;
      b.r1 = sg.R;
      b.vx0 =
        (o.random() - 0.5) * 0.2 * launch + Math.max(-1, Math.min(1, m.vx / 2000)) * 0.08 * launch;
      b.x = x;
      b.y = o.H + rc;
      balls.push(b);
      arrivals.push({ from, ref: m.i, late: now - due, at: now, x });
      if (arrivals.length > 16) arrivals.shift();
    },
    score(m, from, local) {
      const s = sg.slots.find((x) => x.frame === from && x.h === m.h);
      if (!s) return;
      s.playing = m.g === 1;
      s.open = m.a === 1;
      s.score = m.s;
      s.left = m.b;
      s.inPlay = m.q;
      s.seen = local;
    },
    rain(now) {
      for (const s of sg.slots) {
        if (!isPresent(s) || !hasRoom(s)) continue;
        makeRoom(now);
        const b = ball(s.holeX, pf.ceiling + sg.R * 2, sg.R, s.color);
        b.rain = true;
        balls.push(b);
        guideTo(b, s.index, now, 1400);
        flash("rain", s.index);
      }
    },
    giveGift: (s, kind, x, y, now) => sendGift(s, kind, x, y, now),
    update(dt, now, local) {
      clock = now;
      for (const s of sg.slots) {
        if (local - s.seen <= STALE_MS) continue;
        s.playing = false;
        s.open = false;
      }
      aimNest();
      world.events.length = 0;
      stepWorld(world, dt, DECK_SUBSTEPS);
      handleEvents(now);
      tendCaptive(now);
      for (const sp of spinners) {
        sp.angle = (sp.angle + sp.speed * dt) % (Math.PI * 2);
        sp.speed *= Math.exp(-dt * 1.2);
      }
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (!b) continue;
        if (b.phase === "free") {
          if (b.y > sg.holeY + sg.R * 0.3) {
            fall(b, nearestHole(b.x), now);
            continue;
          }
          if (now - b.freeAt > DECK_GUIDE_MS || now - b.life > DECK_LIFE_MS) {
            guide(b, now);
            continue;
          }
          const popped = bubbles.hit(b, now);
          if (popped) {
            flash("bubble", 0);
            count("bubble");
            score(b, DECK_POINTS.bubble);
            const s = b.owner ? slotByKey(b.owner) : null;
            if (s) sendGift(s, popped.kind, popped.x, popped.y, now);
          }
          if (offer(b, now)) continue;
          unstick(b, now);
          continue;
        }
        if (b.phase === "held") {
          if (now - b.qt > HOLD_LIMIT_MS) {
            release(b, now);
            guide(b, now, true);
            count("eject");
          }
          continue;
        }
        if (now < b.start) continue;
        const m = motionAt(b.motion, now - b.start);
        const p = pointAlong(b.pts, m.s);
        b.px = b.x;
        b.py = b.y;
        b.x = p.x;
        b.y = p.y;
        const f = b.motion.length > 0 ? m.s / b.motion.length : 1;
        b.r = b.r0 + (b.r1 - b.r0) * Math.min(1, f * (b.phase === "chute" ? 1.6 : 1));
        if (!m.done) continue;
        if (b.phase === "chute") {
          free(b, b.vx0, -endSpeeds(b.motion).v1, now);
        } else if (b.phase === "rail") {
          const v = endSpeeds(b.motion).v1;
          free(b, p.dx * v, p.dy * v, now);
        } else if (b.phase === "guided") {
          fall(b, b.hole, now);
        } else {
          remove(b);
        }
      }
      const rel: Release[] = [];
      for (const d of devices) d.update(now, rel);
      handleRelease(rel, now);
      for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i]!;
        const m = motionAt(t.motion, now - t.start);
        const p = pointAlong(t.pts, m.s);
        t.x = p.x;
        t.y = p.y;
        if (m.done) tokens.splice(i, 1);
      }
      for (let i = resend.length - 1; i >= 0; i--) {
        const r = resend[i]!;
        if (now > r.until) {
          resend.splice(i, 1);
          continue;
        }
        if (r.slot.frame && !present.has(r.slot.frame)) {
          resend.splice(i, 1);
          const alt = nearestPlaying(r.slot.index) ?? nearest(r.slot.index, takes);
          if (alt?.frame) {
            const m = { ...r.m, h: alt.h, t: Math.max(r.m.t, now + 300) };
            o.onDown(alt, m);
            alt.inPlay++;
            sent.push({
              to: alt.frame,
              h: alt.h,
              id: m.i,
              from: "",
              ref: 0,
              t: m.t,
              at: now,
              slot: alt.index,
            });
            if (sent.length > 24) sent.shift();
          }
        }
      }
      if (deck.total >= nextRain) {
        nextRain = (Math.floor(deck.total / RAIN_STEP) + 1) * RAIN_STEP;
        deck.rain(now);
      }
      tendBubbles(now, dt);
      ambient(now, local);
      flush(local);
    },
    playing: () => sg.slots.some((s) => isPresent(s) && s.playing),
    flashAge(tag, index) {
      const at = flashes.get(`${tag}:${index}`);
      return at === undefined ? Infinity : world.t - at;
    },
    reset() {
      // Balls in flight and in devices finish their trips: some belong to tables below.
      pending.clear();
      deck.total = 0;
      nextRain = RAIN_STEP;
      deck.lit = sg.slots.map(() => false);
      flashes.clear();
      big.hits = 0;
      big.level = 0;
      pf.big.r = pf.bigR;
      pf.big.kick = bigKick;
      moveCircle(pf.big, pf.big.x, pf.big.y, 0);
    },
  };
  return deck;
};
