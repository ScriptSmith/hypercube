/**
 * Versus: two walls, each running its own ring, and both rings start every round the same (same
 * seed, cars and driver noise). Children throw slowdowns at the other wall with the big cone
 * buttons: a cone flies off the top of this wall, drops onto the other road a moment later and
 * the car it lands by brakes gently. On a road of people that small slowdown grows into a jam; the
 * adults defend their own road with the speed limit and smart cars, which damp it. Each wall
 * scores the share of its cars' time spent moving rather than crawling; after ROUND_MS the side
 * with the higher share gets a sparkle in its colour, and the next round starts on the shared
 * clock.
 *
 * The score is time moving rather than flow (cars past a line): on a ring flow is the mean
 * speed, which smart cars and lower limits barely change even while they clear the jams, so a
 * flow score would leave the adults nothing to do.
 *
 * With no other wall heard for PEER_LOST_MS a phantom plays the far side on this frame: its own
 * ring, with slowdowns now and then, so a lone wall still has a game.
 */
import type { AppContext, AppInstance, Pointer, Rect } from "../../core/types";
import { FONT } from "../../core/ui";
import {
  controlAt,
  type ControlState,
  drawCone,
  drawHand,
  drawSlowButton,
  drawSparkles,
  type Sparkle,
} from "./art";
import { type Bots, createBots } from "./bots";
import { type Config, type Settings, SPACING } from "./config";
import { createDriver, type Driver, startCount } from "./driver";
import { createFeed } from "./feed";
import {
  circlePoint,
  frameLayout,
  type FrameLayout,
  type LayoutInput,
  ringLengthFor,
} from "./layout";
import { CAR_LENGTH, hash3, jams } from "./model";
import { createScene, type Ripple } from "./scene";
import { diagramFor } from "./touch";
import { paintDue } from "./diagram";
import { decodeScore, decodeSlow, encodeScore, encodeSlow, TOPIC, type WireCar } from "./wire";

export const ROUND_MS = 90_000;
export const BREAK_MS = 8_000;
export const PERIOD_MS = ROUND_MS + BREAK_MS;
/** A thrown cone lands on the other road this long after the press. */
export const FLIGHT_MS = 1600;
/** Each button recharges for this long after a throw. */
export const RECHARGE_MS = 3000;
/** A slowdown brakes the car it lands by this hard (m/s²) for this long (real ms). */
const SLOW_DECEL = 3;
const SLOW_BRAKE_MS = 800;
/** Cars slower than this (m/s) are crawling, for the score. */
export const MOVING_V = 1.5;
const SAMPLE_MS = 250;
const PEER_LOST_MS = 4000;
const SCORE_EVERY_MS = 1000;
const MAX_FLIGHTS = 24;
const MAX_SPARKLES = 240;
const OWN_PLAN = { d0: 60, d1: 60, t0: 0 };
const ATTRACT_AFTER_MS = 20_000;
const FADE_MS = 900;
const NONE_PRESSED: ReadonlyMap<number, number> = new Map();

export interface Round {
  k: number;
  start: number;
  end: number;
  next: number;
}

export const roundAt = (now: number): Round => {
  const k = Math.floor(now / PERIOD_MS);
  const start = k * PERIOD_MS;
  return { k, start, end: start + ROUND_MS, next: start + PERIOD_MS };
};

/** The seed both walls use for round `k`. */
export const roundSeed = (seed: number, k: number): number =>
  Math.floor(hash3(seed, k, 0x7a11) * 2 ** 31);

/** The share of car time spent moving, sampled through a round. */
export interface Meter {
  moving: number;
  total: number;
}

export const sampleMeter = (m: Meter, d: Driver): void => {
  for (const c of d.ring.cars) {
    m.total++;
    if (c.v >= MOVING_V) m.moving++;
  }
};

/** Per mille of car time moving; 1000 before any sample. */
export const meterScore = (m: Meter): number =>
  m.total === 0 ? 1000 : Math.round((1000 * m.moving) / m.total);

interface Flight {
  /** Thrown from here (outgoing) or landing at f along this road (incoming). */
  out: boolean;
  x: number;
  y: number;
  /** Fraction along the road it lands at (incoming). */
  f: number;
  /** Shared clock ms it was thrown and lands. */
  t0: number;
  t1: number;
  done: boolean;
}

const sideColor = (palette: readonly string[], side: number) =>
  palette[side === 1 ? 2 : 0] ?? "#6fa4fc";

export const mountVersus = (ctx: AppContext, cfg: Config): AppInstance => {
  const side = ctx.setup.side === 1 ? 1 : 0;
  const clock = () => ctx.clock.now();
  const palette = ctx.ui.palette.players;
  const mine = sideColor(palette, side);
  const theirs = sideColor(palette, 1 - side);
  let frame = ctx.frame;

  const inputFor = (): LayoutInput => {
    const u = frame.unit;
    return {
      kind: "wall",
      width: frame.width / u,
      height: frame.height / u,
      reachTop: { adult: frame.reachTop.adult / u, child: frame.reachTop.child / u },
      seams: frame.seams.map((s) => s / u),
      bank: null,
      versus: true,
      road: cfg.road,
    };
  };
  let layout: FrameLayout = frameLayout(inputFor());
  const scene = createScene(ctx.root);
  scene.setup(frame, layout);
  let diagram = diagramFor(layout);
  const rows = { at: performance.now() };
  const length = ringLengthFor(inputFor());
  const base = startCount(length, SPACING[cfg.density]);
  const defaults: Settings = { count: base, limit: cfg.limit, smart: cfg.smart };
  let settings: Settings = { ...defaults };

  /** The round's ring, run on from the round's start so both walls agree. */
  const ringFor = (r: Round, s: Settings): Driver => {
    const d = createDriver({
      length,
      baseCount: base,
      settings: { ...s, count: base },
      noise: cfg.noise,
      seed: roundSeed(ctx.seed, r.k),
      start: r.start,
    });
    d.fastForward(Math.min(clock(), r.end));
    return d;
  };

  let round = roundAt(clock());
  let driver = ringFor(round, settings);
  /** The far side when no other wall is heard. */
  let phantom: Driver | null = null;
  const feed = createFeed();
  let snapAt = Number.NEGATIVE_INFINITY;
  const wire: WireCar[] = [];

  let theirScore = { round: -1, n: 1000, at: Number.NEGATIVE_INFINITY, done: false };
  let scoreAt = Number.NEGATIVE_INFINITY;
  let sampleAt = Number.NEGATIVE_INFINITY;
  let ours: Meter = { moving: 0, total: 0 };
  let ghostly: Meter = { moving: 0, total: 0 };
  let lastPerson = Number.NEGATIVE_INFINITY;
  const flights: Flight[] = [];
  const pending: { t: number; f: number }[] = [];
  const recharged = layout.slowdowns.map(() => 0);
  const pressed = new Map<string, number>();
  const ripples: Ripple[] = [];
  const sparkles: Sparkle[] = [];
  let verdict: { round: number; winner: number | null } | null = null;
  let thrown = 0;
  let landed = 0;
  const rng = ctx.rng(`traffic:versus:${side}`);

  const peerAlive = (local: number) => local - theirScore.at < PEER_LOST_MS;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    if (timers.size >= MAX_FLIGHTS) return;
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const throwAt = (i: number, person: boolean) => {
    const local = performance.now();
    const now = clock();
    const r = layout.slowdowns[i];
    if (!r || local < recharged[i]!) return;
    if (now >= round.end) return;
    recharged[i] = local + RECHARGE_MS;
    pressed.set(`slow:${i}`, local);
    if (person) {
      lastPerson = local;
      ctx.idle.poke();
    }
    thrown++;
    if (flights.length >= MAX_FLIGHTS) flights.shift();
    flights.push({
      out: true,
      x: r.x + r.width / 2,
      y: r.y + r.height * 0.3,
      f: 0,
      t0: now,
      t1: now + FLIGHT_MS * 0.5,
      done: false,
    });
    // Thrown to the other side, as if it faced this one: our left is their right. Beside a
    // circle the buttons span the part of the wall right of it, so they throw across the ring.
    const f = layout.circle ? 1 - throwShare(r) : 1 - (r.x + r.width / 2) / layout.width;
    const t = now + FLIGHT_MS;
    if (peerAlive(local)) ctx.net.send(TOPIC.slow, encodeSlow({ round: round.k, t, f }));
    else if (phantom) {
      // The phantom's road takes it.
      const target = nearest(phantom, f);
      if (target !== null) {
        later(() => phantom?.brake(target, SLOW_BRAKE_MS, 1, SLOW_DECEL), FLIGHT_MS);
      }
    }
  };

  const throwShare = (r: Rect): number => {
    const first = layout.slowdowns[0];
    const last = layout.slowdowns[layout.slowdowns.length - 1];
    if (!first || !last || last.x <= first.x) return 0.5;
    const k = (r.x - first.x) / (last.x - first.x);
    return 0.1 + 0.8 * k;
  };

  /** Where a cone landing at fraction `f` along the ring comes down, venue px. */
  const landing = (f: number): { x: number; y: number } => {
    if (!layout.circle) return { x: f * layout.width, y: layout.laneY };
    const p = circlePoint(layout.circle, f, { x: 0, y: 0, angle: 0 });
    return { x: p.x, y: p.y };
  };

  const nearest = (d: Driver, f: number): number | null => {
    const x = f * d.ring.length;
    let best: number | null = null;
    let dist = Infinity;
    for (const c of d.ring.cars) {
      let dx = Math.abs(c.x + CAR_LENGTH / 2 - x);
      dx = Math.min(dx, d.ring.length - dx);
      if (dx < dist) {
        dist = dx;
        best = c.id;
      }
    }
    return best;
  };

  const incoming = (t: number, f: number) => {
    if (pending.length >= MAX_FLIGHTS) pending.shift();
    pending.push({ t, f });
    if (flights.length >= MAX_FLIGHTS) flights.shift();
    const at = landing(f);
    flights.push({
      out: false,
      x: at.x,
      y: at.y,
      f,
      t0: t - FLIGHT_MS * 0.5,
      t1: t,
      done: false,
    });
  };

  const offs = [
    ctx.net.on(TOPIC.slow, (data, from) => {
      const m = decodeSlow(data);
      const p = ctx.net.peers().find((x) => x.frame === from);
      if (!m || !p || (p.side ?? 0) === side) return;
      if (m.round !== round.k) return;
      const now = clock();
      // A cone that should have landed long ago lands now.
      incoming(Math.max(now + 200, Math.min(m.t, now + FLIGHT_MS * 2)), m.f);
    }),
    ctx.net.on(TOPIC.score, (data, from) => {
      const m = decodeScore(data);
      const p = ctx.net.peers().find((x) => x.frame === from);
      if (!m || !p || (p.side ?? 0) === side) return;
      theirScore = { round: m.round, n: m.n, at: performance.now(), done: m.done };
      phantom = null;
    }),
  ];

  // ---- Input ------------------------------------------------------------------------------

  const slowAt = (x: number, y: number): number => {
    let best = -1;
    let dist = 40;
    layout.slowdowns.forEach((r, i) => {
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const d = Math.hypot(x - cx, y - cy) - r.width / 2;
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  };

  const down = (p: Pointer) => {
    const u = frame.unit;
    const x = p.x / u;
    const y = p.y / u;
    const person = !p.synthetic;
    if (person) {
      lastPerson = performance.now();
      ctx.idle.poke();
    }
    const hit = controlAt(layout.controls, x, y);
    if (hit) {
      if (hit.cell < 0) return;
      pressed.set(`${hit.key}:${hit.cell}`, performance.now());
      if (hit.key === "limit") settings = { ...settings, limit: hit.cell };
      else if (hit.key === "smart") settings = { ...settings, smart: hit.cell };
      driver.set({ limit: settings.limit, smart: settings.smart });
      return;
    }
    const i = slowAt(x, y);
    if (i >= 0) {
      throwAt(i, person);
      return;
    }
    if (ripples.length >= 12) ripples.shift();
    ripples.push({ x, y, at: performance.now(), hit: false });
  };
  offs.push(ctx.input.on("down", down));

  // ---- Bots and attract -------------------------------------------------------------------

  const bots: Bots | null =
    ctx.bots > 0
      ? createBots(
          ctx.input,
          ctx.bots,
          {
            cars: () => [],
            controls: () => layout.controls,
            settings: () => settings,
            defaults: () => defaults,
            slowdowns: () => layout.slowdowns,
            lastPerson: () => lastPerson,
            unit: () => frame.unit,
            size: () => ({ width: layout.width, height: layout.height }),
          },
          ctx.rng(`traffic:bots:versus:${side}`),
        )
      : null;

  let ghostAt = performance.now() + 6000 + rng.range(0, 4000);
  let ghostPress: { i: number; at: number } | null = null;
  let phantomAt = performance.now() + 5000;

  // ---- Loop -------------------------------------------------------------------------------

  /** The other side's score this round: the phantom's, or the other wall's latest. */
  const theirNow = (): number | null =>
    phantom ? meterScore(ghostly) : theirScore.round === round.k ? theirScore.n : null;

  const update = () => {
    const local = performance.now();
    const now = clock();
    const r = roundAt(now);
    if (r.k !== round.k) {
      round = r;
      driver = ringFor(round, settings);
      if (phantom) phantom = ringFor(round, defaults);
      ours = { moving: 0, total: 0 };
      ghostly = { moving: 0, total: 0 };
      pending.length = 0;
      verdict = null;
    }
    driver.advance(now);
    // The other wall is gone: a phantom plays it here.
    if (!peerAlive(local) && !phantom) {
      phantom = ringFor(round, defaults);
      ghostly = { moving: 0, total: 0 };
    }
    if (phantom) {
      phantom.advance(now);
      if (local >= phantomAt && now < round.end) {
        phantomAt = local + rng.range(5000, 11_000);
        const f = rng.range(0.05, 0.95);
        incoming(now + FLIGHT_MS, f);
      }
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i]!;
      if (now < p.t) continue;
      pending.splice(i, 1);
      if (now >= round.end) continue;
      const target = nearest(driver, p.f);
      if (target !== null) {
        driver.brake(target, SLOW_BRAKE_MS, 1, SLOW_DECEL);
        landed++;
      }
    }
    if (local - snapAt >= 25) {
      snapAt = local;
      const s = driver.snapshot(OWN_PLAN, false, wire);
      feed.push({ ...s, cars: s.cars.map((c) => ({ ...c })) }, ctx.net.self);
    }
    const done = now >= round.end;
    if (!done && now - sampleAt >= SAMPLE_MS) {
      sampleAt = now;
      sampleMeter(ours, driver);
      if (phantom) sampleMeter(ghostly, phantom);
    }
    if (local - scoreAt >= SCORE_EVERY_MS) {
      scoreAt = local;
      ctx.net.send(TOPIC.score, encodeScore({ round: round.k, n: meterScore(ours), done }));
    }
    if (done && !verdict && now >= round.end + 1200) {
      const mine = meterScore(ours);
      const other = theirNow();
      const winner = other === null ? null : mine > other ? side : other > mine ? 1 - side : null;
      verdict = { round: round.k, winner };
      celebrate(winner);
    }
    // Attract: a ghost hand throws a cone now and then.
    const attract = local - lastPerson > ATTRACT_AFTER_MS;
    if (attract && local >= ghostAt && !done) {
      ghostAt = local + rng.range(15_000, 30_000);
      const i = rng.int(layout.slowdowns.length);
      ghostPress = { i, at: local };
      later(() => throwAt(i, false), 600);
    }
    bots?.update(local);
  };

  const celebrate = (winner: number | null) => {
    const b = layout.board;
    if (!b) return;
    const now = performance.now();
    const colors = winner === null ? [mine, theirs] : [winner === side ? mine : theirs];
    const n = winner === side ? 160 : 70;
    for (let i = 0; i < n && sparkles.length < MAX_SPARKLES; i++) {
      const wide = winner === side && i % 2 === 0;
      sparkles.push({
        x: wide ? rng.range(0, layout.width) : b.x + rng.range(0, b.width),
        y: wide ? layout.laneY - rng.range(0, 300) : b.y + rng.range(0, b.height),
        vx: rng.range(-260, 260),
        vy: rng.range(-520, -120),
        at: now + rng.range(0, 1500),
        life: rng.range(1400, 2600),
        color: colors[i % colors.length]!,
      });
    }
  };

  const cars: WireCar[] = [];

  const drawBoard = (g: CanvasRenderingContext2D, now: number) => {
    const b = layout.board;
    if (!b) return;
    g.save();
    g.beginPath();
    g.roundRect(b.x, b.y, b.width, b.height, 40);
    g.fillStyle = "rgba(9,13,24,0.88)";
    g.fill();
    const us = meterScore(ours);
    const other = theirNow() ?? 1000;
    // Two bars, ours first: colour dots, bars and the share of cars moving.
    const row = (y: number, n: number, color: string, label: string) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(b.x + 70, y, 34, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.08)";
      g.fillRect(b.x + 130, y - 30, b.width - 440, 60);
      g.fillStyle = color;
      g.fillRect(b.x + 130, y - 30, ((b.width - 440) * n) / 1000, 60);
      g.fillStyle = "#f2f5fa";
      g.font = `800 72px ${FONT}`;
      g.textAlign = "right";
      g.textBaseline = "middle";
      g.fillText(`${Math.round(n / 10)}%`, b.x + b.width - 170, y + 4);
      g.font = `700 44px ${FONT}`;
      g.textAlign = "left";
      g.fillStyle = "rgba(214,222,238,0.85)";
      g.fillText(label, b.x + b.width - 150, y + 4);
    };
    row(b.y + 110, us, mine, "us");
    row(b.y + 210, other, theirs, "them");
    g.fillStyle = "rgba(214,222,238,0.75)";
    g.font = `700 46px ${FONT}`;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillText("Cars moving", b.x + 130, b.y + 62);
    // Round timer: a ring that empties.
    const left = now < round.end ? (round.end - now) / ROUND_MS : 0;
    const cx = b.x + b.width - 80;
    const cy = b.y + 60;
    g.lineWidth = 14;
    g.strokeStyle = "rgba(255,255,255,0.12)";
    g.beginPath();
    g.arc(cx, cy, 34, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "#f2f5fa";
    g.beginPath();
    g.arc(cx, cy, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    g.stroke();
    g.restore();
  };

  const drawFlights = (g: CanvasRenderingContext2D, now: number) => {
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]!;
      const k = (now - f.t0) / (f.t1 - f.t0);
      if (k >= 1.3 || (f.out && k >= 1)) {
        flights.splice(i, 1);
        continue;
      }
      if (k < 0) continue;
      if (f.out) {
        // Up and off the top of the wall, spinning.
        const y = f.y - (f.y + 300) * k * k;
        g.save();
        g.translate(f.x, y);
        g.rotate(k * 5);
        drawCone(g, 0, 60, 150);
        g.restore();
      } else {
        // Down from the top onto the road, then a bump.
        const kk = Math.min(1, k);
        const y = -200 + (f.y + 200) * kk * kk;
        drawCone(g, f.x, y + 40, 140, k > 1 ? 1 - (k - 1) / 0.3 : 1);
      }
    }
  };

  const draw = () => {
    const local = performance.now();
    const now = clock();
    const t = now - OWN_PLAN.d0;
    const L = length;
    paintDue(diagram, rows, local, L, 0, 1, (ago, out) => feed.at(t - ago, out));
    feed.at(t, cars);
    for (let i = ripples.length - 1; i >= 0; i--)
      if (local - ripples[i]!.at > 700) ripples.splice(i, 1);
    scene.background(settings.limit);
    // Cars fade between rounds, when the ring starts again.
    const toNext = round.next - now;
    const sinceStart = now - round.start;
    const fade = Math.max(
      0,
      Math.min(1, 1 - toNext / FADE_MS),
      Math.min(1, 1 - sinceStart / (FADE_MS * 0.7)),
    );
    scene.draw({
      cars,
      length: L,
      now: local,
      pressed: NONE_PRESSED,
      ripples,
      diagram,
      frac: (local - rows.at) / diagram.rowMs,
      f0: 0,
      f1: 1,
      fade,
      extra(g) {
        layout.slowdowns.forEach((r: Rect, i) => {
          const ready = 1 - Math.max(0, recharged[i]! - local) / RECHARGE_MS;
          const at = pressed.get(`slow:${i}`);
          const flash = at === undefined ? 0 : Math.max(0, 1 - (local - at) / 250);
          const pulse = 0.5 + 0.5 * Math.sin(local / 400 + i);
          drawSlowButton(g, r, mine, now < round.end ? ready : 0, pulse, flash);
        });
        drawFlights(g, now);
        drawBoard(g, now);
        drawSparkles(g, sparkles, local, 26);
        if (ghostPress && local - ghostPress.at < 1500) {
          const r = layout.slowdowns[ghostPress.i];
          if (r) {
            const age = local - ghostPress.at;
            const k = Math.min(1, age / 600);
            const alpha = 0.85 * Math.min(1, k * 2) * (1 - Math.max(0, (age - 900) / 600));
            drawHand(g, r.x + r.width / 2, r.y + r.height / 2 - (1 - k) * 80, r.width, alpha);
          }
        }
      },
    });
    let flashing = false;
    for (const [k, at] of pressed) {
      if (local - at < 320) flashing = true;
      else if (!k.startsWith("slow:")) pressed.delete(k);
    }
    const key = `${settings.limit}|${settings.smart}`;
    if (flashing || key !== controlsKey) {
      controlsKey = flashing ? "" : key;
      const state: ControlState = {
        count: base,
        limit: settings.limit,
        smart: settings.smart,
        fewer: false,
        more: false,
        pressed,
        now: local,
      };
      scene.controls(state);
    }
  };
  let controlsKey = "";

  const loop = ctx.loop({ hz: 60, update, render: draw });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    layout = frameLayout(inputFor());
    scene.setup(frame, layout);
    diagram.dispose();
    diagram = diagramFor(layout);
    controlsKey = "";
  });

  const debugKey = "__traffic";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: false,
          mode: "versus",
          side,
          round: round.k,
          roundStart: round.start,
          roundEnd: round.end,
          clock: clock(),
          unit: frame.unit,
          settings,
          length,
          phantom: phantom !== null,
          ours: meterScore(ours),
          theirs: theirNow(),
          theirRound: phantom ? round.k : theirScore.round,
          thrown,
          landed,
          verdict,
          slowdowns: layout.slowdowns,
          controls: layout.controls,
          ring: driver.ring.cars.map((c) => ({ id: c.id, x: c.x, v: c.v, mark: c.mark })),
          step: driver.ring.step,
          seed: driver.ring.seed,
          painted: diagram.painted,
        }),
        peek(f: number, secs: number) {
          return diagram.peek(f, (secs * 1000) / diagram.rowMs);
        },
        setLag() {},
      },
    });
  }

  return {
    reset() {
      settings = { ...defaults };
      driver.set({ limit: settings.limit, smart: settings.smart });
    },
    attract() {
      ghostAt = Math.min(ghostAt, performance.now() + 4000);
    },
    // The default, top right of the adults' band, is clear of the plates and the buttons.
    homeSpot: () => null,
    status() {
      return {
        mode: "versus",
        round: round.k,
        ours: meterScore(ours),
        theirs: theirNow() ?? -1,
        phantom: phantom !== null,
        jams: jams(driver.ring),
        speed: Math.round((cars.reduce((a, c) => a + c.v, 0) / Math.max(1, cars.length)) * 3.6),
      };
    },
    dispose() {
      loop.stop();
      offResize();
      for (const off of offs) off();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      bots?.dispose();
      feed.clear();
      diagram.dispose();
      scene.dispose();
      flights.length = 0;
      pending.length = 0;
      sparkles.length = 0;
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
