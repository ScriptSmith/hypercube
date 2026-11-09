/**
 * A bank frame's side of the shared ring. One frame hosts: it runs the ring at the shared clock
 * and sends snapshots of every car SNAP_HZ times a second; every frame (the host too) draws from
 * those snapshots `delay` ms behind the clock, so a car crossing from one frame to the next is in
 * the same place on both.
 *
 * Who hosts: the screen if it is there, else the lowest `pos` (the same order as
 * `Channel.leader()`), but decided from the snapshots themselves so it doesn't wait for the
 * roster to notice a frame has gone. A host that hears a better-ranked host's snapshots steps
 * down. When the host goes quiet for HOST_LOST_MS, the best-ranked touch frame takes over, so a
 * screen that leaves hands the road to the first panel. A screen arriving late takes over the
 * same way.
 *
 * Between hosts nothing arrives for a while (the room may be electing a new hub, too), so a
 * frame that stops hearing cars carries on from the last snapshot itself: the ring is
 * deterministic, so every frame that heard the same snapshot predicts the same cars, and the new
 * host carries on with its own prediction. When snapshots come back the prediction is dropped.
 *
 * Delay: frames report how late snapshots reach them (`tf:beat`, once a second); the host asks
 * everyone to draw just behind the latest of them, eased so cars never jump.
 */
import type { Channel, PeerInfo } from "../../core/types";
import {
  BASE_DELAY_MS,
  type Config,
  HOST_LOST_MS,
  HOST_WAIT_MS,
  MAX_DELAY_MS,
  type Settings,
  SNAP_HZ,
} from "./config";
import { adoptDriver, applyCtl, createDriver, type Driver } from "./driver";
import { createFeed, type Feed } from "./feed";
import {
  decodeBeat,
  decodeBrake,
  decodeCtl,
  decodeSnap,
  encodeBeat,
  encodeBrake,
  encodeCtl,
  encodeSnap,
  type DelayPlan,
  delayAt,
  type SnapMsg,
  TOPIC,
  type WireCar,
} from "./wire";

/** Snapshots older than this (shared clock) are too stale to carry on from. */
const ADOPT_MS = 10_000;
/** A host that went quiet is passed over for this long, unless it speaks again. */
const GONE_MS = 15_000;
const BEAT_MS = 1000;
/** Beats older than this no longer count towards the delay. */
const BEAT_KEEP_MS = 3500;
/** Delay changes start this far ahead on the clock, so every frame hears of them in time. */
const DELAY_LEAD_MS = 600;
/** Snapshots arrive this far apart at most, plus a margin for jitter. */
const SNAP_GAP_MS = 1000 / SNAP_HZ;
const DELAY_MARGIN_MS = 40;
/** With no snapshot for this long a frame predicts the cars itself. */
export const PREDICT_AFTER_MS = 350;
const LATE_SAMPLES = 40;
const MAX_BEATS = 64;
/**
 * Frames stay in mind this long after they leave the roster: while the room elects a new hub
 * the roster is briefly empty, and a frame that vanished keeps its place in line until the room
 * notices.
 */
const KNOWN_MS = 4000;
const MAX_KNOWN = 128;
/** The feed's name for this frame's own predictions. */
const PREDICTED = "~predicted";

export interface LinkOptions {
  net: Channel;
  /** Shared clock ms. */
  clock(): number;
  /** Local monotonic ms. */
  local?(): number;
  isScreen: boolean;
  pos: number;
  config: Config;
  seed: number;
  /** The ring this frame would start if nobody else had one: metres. */
  ringLength(): number;
  baseCount(length: number): number;
  defaults(length: number): Settings;
  /** Host only: people or bots on other frames did something (for idle). */
  onActivity?(person: boolean): void;
  /** Host only: a brake started on this car from another frame. */
  onBrake?(car: number, person: boolean): void;
  /** Host at once when alone (a lone screen); otherwise wait for others first. */
  eager?: boolean;
  /** A person touched this frame lately (told to the host, so its idle timer waits). */
  personActive?(): boolean;
  /** Messages can be held back for tests, as a slow network would. */
  send?(topic: string, data: unknown, to?: string): void;
}

export interface BankLink {
  readonly feed: Feed;
  /** The ring this frame runs: as host, or predicting while no host is heard. */
  readonly driver: Driver | null;
  readonly hosting: boolean;
  readonly predicting: boolean;
  /** The frame whose cars this frame draws (itself while hosting), if any is fresh. */
  readonly host: string | null;
  /** How far behind the clock to draw, ms, eased. */
  readonly delay: number;
  /** Local ms since cars were last heard from a host (0 while hosting). */
  quiet(local: number): number;
  /** Would this frame host if the current host went quiet? */
  nextInLine(): boolean;
  /** The settings in force, as the host last said (or holds). */
  settings(): Settings | null;
  /** True while the host's ring is in attract. */
  readonly attract: boolean;
  setAttract(on: boolean): void;
  tick(): void;
  brake(car: number, ms: number, person: boolean): void;
  ctl(key: 0 | 1 | 2, value: number, person: boolean): void;
  /** How late snapshots reach this frame, ms (90th percentile of recent ones). */
  readonly late: number;
  readonly hostedAt: number;
  readonly handovers: number;
  dispose(): void;
}

const rankOf = (p: PeerInfo): number =>
  p.role === "screen" || p.kind === "screen" ? 0 : 1 + p.pos;

export const createLink = (opts: LinkOptions): BankLink => {
  const { net } = opts;
  const local = opts.local ?? (() => performance.now());
  const send = opts.send ?? ((t: string, d: unknown, to?: string) => net.send(t, d, to));
  const self = net.self;
  const myRank = opts.isScreen ? 0 : 1 + opts.pos;
  const mountedAt = local();
  const feed = createFeed(local);
  const gone = new Map<string, number>();
  const beats = new Map<string, { late: number; at: number }>();
  const known = new Map<string, { rank: number; touch: boolean; seen: number }>();
  const lates: number[] = [];
  /** This frame's ring: hosting, or predicting (`hosting` false). */
  let driver: Driver | null = null;
  let hosting = false;
  let plan: DelayPlan = { d0: BASE_DELAY_MS, d1: BASE_DELAY_MS, t0: 0 };
  let snapAt = Number.NEGATIVE_INFINITY;
  let beatAt = Number.NEGATIVE_INFINITY;
  /** The last snapshot from another host, who sent it and when it came. */
  let heard: SnapMsg | null = null;
  let heardFrom: string | null = null;
  let heardAt = Number.NEGATIVE_INFINITY;
  let quietSince = mountedAt;
  let attract = true;
  let hostedAt = Number.NEGATIVE_INFINITY;
  let handovers = 0;
  let late = 0;
  const wire: WireCar[] = [];

  const learn = (l: number) => {
    for (const p of net.peers()) {
      if (p.frame === self) continue;
      if (!known.has(p.frame) && known.size >= MAX_KNOWN) {
        let old: string | null = null;
        let at = Infinity;
        for (const [f, k] of known) {
          if (k.seen < at) {
            old = f;
            at = k.seen;
          }
        }
        if (old) known.delete(old);
      }
      const screen = p.role === "screen" || p.kind === "screen";
      known.set(p.frame, { rank: rankOf(p), touch: !screen, seen: l });
    }
  };
  const rank = (frame: string): number =>
    frame === self ? myRank : (known.get(frame)?.rank ?? 1e6);
  const better = (a: string, b: string): boolean => {
    const ra = rank(a);
    const rb = rank(b);
    return ra < rb || (ra === rb && a < b);
  };

  const fresh = (l: number): string | null =>
    heardFrom !== null && l - heardAt < HOST_LOST_MS ? heardFrom : null;

  const ownSnapshot = (d: Driver) => {
    const snap = d.snapshot(plan, attract, wire);
    return { snap, copy: { ...snap, cars: snap.cars.map((c) => ({ ...c })) } as SnapMsg };
  };

  const start = () => {
    const now = opts.clock();
    if (driver) {
      // Carry on with our own prediction: frames that predicted from the same snapshot agree.
    } else if (heard && now - heard.t < ADOPT_MS && heard.cars.length > 0) {
      driver = adoptDriver(heard, {
        baseCount: opts.baseCount(heard.length),
        noise: opts.config.noise,
        seed: opts.seed,
      });
      attract = heard.attract;
    } else {
      const length = opts.ringLength();
      driver = createDriver({
        length,
        baseCount: opts.baseCount(length),
        settings: opts.defaults(length),
        noise: opts.config.noise,
        seed: opts.seed,
        start: now,
      });
    }
    driver.advance(now);
    hosting = true;
    hostedAt = local();
    handovers++;
    snapAt = Number.NEGATIVE_INFINITY;
  };

  const applyBrake = (d: Driver, car: number, ms: number, person: boolean, remote: boolean) => {
    if (d.brake(car, ms, 1) === "started" && remote) opts.onBrake?.(car, person);
  };

  const offs = [
    net.on(TOPIC.cars, (data, from) => {
      if (from === self) return;
      const m = decodeSnap(data);
      if (!m) return;
      const l = local();
      learn(l);
      gone.delete(from);
      if (hosting) {
        if (!better(from, self)) return;
        hosting = false;
      } else {
        const current = fresh(l);
        if (current && current !== from && better(current, from)) return;
      }
      // A host is heard: any prediction of ours gives way to it.
      driver = null;
      if (lates.length >= LATE_SAMPLES) lates.shift();
      lates.push(Math.max(0, opts.clock() - m.t));
      heard = m;
      heardFrom = from;
      heardAt = l;
      feed.push(m, from);
    }),
    net.on(TOPIC.brake, (data) => {
      const m = decodeBrake(data);
      if (!m || !hosting || !driver) return;
      applyBrake(driver, m.car, m.ms, m.person, true);
      opts.onActivity?.(m.person);
    }),
    net.on(TOPIC.ctl, (data) => {
      const m = decodeCtl(data);
      if (!m || !hosting || !driver) return;
      applyCtl(driver, m.key, m.value);
      opts.onActivity?.(m.person);
    }),
    net.on(TOPIC.beat, (data, from) => {
      const m = decodeBeat(data);
      if (!m) return;
      if (!beats.has(from) && beats.size >= MAX_BEATS) beats.delete(beats.keys().next().value!);
      beats.set(from, { late: m.late, at: local() });
      if (hosting && m.person) opts.onActivity?.(true);
    }),
  ];

  const nextInLine = (l = local()): boolean => {
    for (const [f, at] of gone) if (l - at > GONE_MS) gone.delete(f);
    for (const [f, k] of known) {
      if (l - k.seen > KNOWN_MS || gone.has(f) || !k.touch) continue;
      if (better(f, self)) return false;
    }
    return true;
  };

  const shouldHost = (l: number): boolean => {
    const current = fresh(l);
    if (current) return better(self, current) && l - mountedAt >= HOST_WAIT_MS;
    if (opts.eager) return true;
    // The host went quiet: don't wait for it again.
    if (heardFrom && !gone.has(heardFrom) && heardAt > Number.NEGATIVE_INFINITY) {
      gone.set(heardFrom, l);
    }
    const waited = l - Math.max(quietSince, heardAt);
    if (opts.isScreen) return waited >= (heard ? HOST_LOST_MS : HOST_WAIT_MS);
    if (!nextInLine(l)) return false;
    const screenListed = [...known].some(
      ([f, k]) => !k.touch && l - k.seen <= KNOWN_MS && !gone.has(f),
    );
    const wait = heard ? HOST_LOST_MS : HOST_WAIT_MS + (screenListed ? 1500 : 0);
    return waited >= wait;
  };

  /** Host: ease towards `target`, starting DELAY_LEAD_MS from now. */
  const replan = (target: number, now: number) => {
    const t = Math.round(target);
    const rising = t > plan.d1 + 8;
    const falling = t < plan.d1 - 25;
    if (!rising && !falling) return;
    const t0 = now + DELAY_LEAD_MS;
    plan = { d0: delayAt(plan, t0), d1: t, t0 };
  };

  const p90 = (xs: readonly number[]) => {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]!;
  };

  return {
    feed,
    get driver() {
      return driver;
    },
    get hosting() {
      return hosting;
    },
    get predicting() {
      return !hosting && driver !== null;
    },
    get host() {
      if (hosting) return self;
      return fresh(local());
    },
    get delay() {
      return delayAt(plan, opts.clock());
    },
    get attract() {
      return attract;
    },
    setAttract(on) {
      attract = on;
    },
    quiet(l) {
      if (hosting) return 0;
      return l - Math.max(mountedAt, heardAt);
    },
    nextInLine: () => nextInLine(),
    settings() {
      if (driver) return driver.settings;
      return heard ? { count: heard.count, limit: heard.limit, smart: heard.smart } : null;
    },
    get late() {
      return late;
    },
    get hostedAt() {
      return hostedAt;
    },
    get handovers() {
      return handovers;
    },
    tick() {
      const l = local();
      const now = opts.clock();
      learn(l);
      late = p90(lates);
      if (!hosting && shouldHost(l)) start();
      if (hosting && driver) {
        driver.advance(now);
        let worst = 0;
        for (const [f, b] of beats) {
          if (l - b.at > BEAT_KEEP_MS) beats.delete(f);
          else worst = Math.max(worst, b.late);
        }
        const want = Math.min(
          MAX_DELAY_MS,
          Math.max(BASE_DELAY_MS, worst > 0 ? worst + SNAP_GAP_MS + DELAY_MARGIN_MS : 0),
        );
        replan(want, now);
        if (l - snapAt >= SNAP_GAP_MS - 2) {
          snapAt = l;
          const { snap, copy } = ownSnapshot(driver);
          send(TOPIC.cars, encodeSnap(snap));
          feed.push(copy, self);
        }
        quietSince = l;
        return;
      }
      if (heard) plan = heard.delay;
      // Nobody heard for a moment: carry the cars on ourselves until a host speaks.
      if (!driver && heard && l - heardAt > PREDICT_AFTER_MS && now - heard.t < ADOPT_MS) {
        driver = adoptDriver(heard, {
          baseCount: opts.baseCount(heard.length),
          noise: opts.config.noise,
          seed: opts.seed,
        });
        snapAt = Number.NEGATIVE_INFINITY;
      }
      if (driver) {
        driver.advance(now);
        if (l - snapAt >= SNAP_GAP_MS - 2) {
          snapAt = l;
          feed.push(ownSnapshot(driver).copy, PREDICTED);
        }
      }
      const host = fresh(l);
      if (host && l - beatAt >= BEAT_MS) {
        beatAt = l;
        send(TOPIC.beat, encodeBeat({ late, person: opts.personActive?.() ?? false }), host);
      }
    },
    brake(car, ms, person) {
      if (driver) applyBrake(driver, car, ms, person, false);
      if (hosting) return;
      const host = fresh(local());
      if (host) send(TOPIC.brake, encodeBrake({ car, ms, person }), host);
    },
    ctl(key, value, person) {
      if (driver) applyCtl(driver, key, value);
      if (hosting) return;
      const host = fresh(local());
      if (host) send(TOPIC.ctl, encodeCtl({ key, value, person }), host);
    },
    dispose() {
      for (const off of offs) off();
      feed.clear();
      beats.clear();
      gone.clear();
      known.clear();
      driver = null;
      hosting = false;
      heard = null;
    },
  };
};
