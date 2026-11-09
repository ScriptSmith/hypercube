/**
 * A touch frame: one or more harmonics' controls and threads.
 *
 * Solo frames are standalone: they run the rules themselves and draw the picture and cloth.
 * Bank frames follow the screen: they send their harmonics up and show what its beacon says
 * for the ones nobody is setting; their threads carry on up the screen. With no screen, the
 * leftmost frame runs the rules and every frame shows a small picture of the whole bank.
 */
import type { AppContext, AppInstance, FrameInfo, OptionValue, Pointer } from "../../core/types";
import { type Bot, createBot } from "./bots";
import { type Conductor, createConductor, type Mode, WEAVE_S } from "./conductor";
import { HZ, PERIOD_S, readConfig } from "./config";
import { wantedScale } from "./draw";
import { createFrameView, type FrameLook, threadEdgeX } from "./frameview";
import { type Layout, layoutFor, type LayoutInput, perFrame } from "./layout";
import {
  BEACON_GRACE_MS,
  BEACON_MS,
  createFollow,
  createInbox,
  type Follow,
  type Inbox,
  sendBeacon,
  sendState,
  STALE_MS,
} from "./link";
import { beaconFrom, createMirror, type Mirror } from "./mirror";
import { BACKGROUND, colourOf } from "./palette";
import { peakOf, phaseDelta, type Target, type Term } from "./series";
import { createStrands } from "./strands";
import { turnAngle } from "./thread";
import { quantAmp, quantPhase, STATE_FLAG, unquantAmp, unquantPhase } from "./wire";

/** Sending a frame's harmonics: while a finger is on them, while live, and otherwise. */
const SEND_HELD_MS = 50;
const SEND_LIVE_MS = 500;
const SEND_IDLE_MS = 1000;
/** With nobody touching this frame for this long, the ghost hand may show. */
const ATTRACT_MS = 20_000;

export const mountFrame = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  const setup = ctx.setup;
  const inBank = setup.name === "bank" && (ctx.frame.kind === "panel" || ctx.frame.kind === "pair");
  const side = setup.side ?? 0;
  const m = perFrame(ctx.frame.kind);
  const firstK = setup.pos * m + 1;
  let frame: FrameInfo = ctx.frame;
  const inputOf = (f: FrameInfo): LayoutInput => {
    const u = f.unit;
    return {
      kind: f.kind,
      width: f.width / u,
      height: f.height / u,
      reachTop: { adult: f.reachTop.adult / u, child: f.reachTop.child / u },
      seams: f.seams.map((s) => s / u),
      bank: inBank,
      harmonics: config.harmonics,
      firstK,
    };
  };
  let layout: Layout = layoutFor(inputOf(frame));
  ctx.root.style.background = BACKGROUND;

  const strands = createStrands(layout, config.variant);
  const own = strands.list;
  /** Harmonics in the whole setup: the bank's, or this frame's. */
  const total = inBank
    ? Math.min(20, Math.max(setup.count, setup.pos + 1) * m)
    : Math.min(20, own.length);
  const base = ctx.rng().fork(inBank ? `loom:${setup.pos}` : "loom");
  const conductor: Conductor = createConductor({
    n: total,
    variant: config.variant,
    rng: base.fork("conductor"),
  });
  const mirror: Mirror | null = inBank ? createMirror(config.variant) : null;
  const follow: Follow | null = inBank
    ? createFollow(ctx.net, { side, pos: setup.pos }, () => performance.now())
    : null;
  const remoteLive = new Set<number>();
  const isOwn = (i: number) => i >= firstK - 1 && i < firstK - 1 + own.length;
  let conducting = !inBank;
  const inbox: Inbox | null = inBank
    ? createInbox(
        ctx.net,
        { side, frame: ctx.net.self },
        () => performance.now(),
        (i, e) => {
          if (!conducting || i >= conductor.n || isOwn(i)) return;
          if (e.f & STATE_FLAG.live) {
            conductor.setLive(i, unquantAmp(e.a), unquantPhase(e.ph));
            remoteLive.add(i);
          } else conductor.setAuto(i);
        },
      )
    : null;
  /** Index in the setup's harmonics of this frame's strand `j`. */
  const globalOf = (j: number) => (inBank ? firstK - 1 + j : j);

  const view = createFrameView(ctx.root, frame, layout);
  let resets: HTMLElement[] = [];
  const now = () => performance.now();

  let followedAt = Number.NEGATIVE_INFINITY;
  let followedFrom: string | null = null;
  let followScreen = false;
  let sentAt = Number.NEGATIVE_INFINITY;
  let sentFlags = "";
  let beaconAt = Number.NEGATIVE_INFINITY;
  let scale = 0;
  let lastPerson = Number.NEGATIVE_INFINITY;
  let disposed = false;
  let time = 0;
  /** Last shown values of this frame's strands, for the ghost hand. */
  const prevShown: Term[] = own.map(() => ({ amp: 0, phase: 0 }));
  const hand = { strand: -1, on: "slider" as "slider" | "dial", alpha: 0, since: 0 };
  let handAt = now();

  interface Source {
    values: readonly Term[];
    live: readonly boolean[];
    ok: readonly boolean[];
    target: Target | null;
    mode: Mode;
    modeT: number;
    fill: number;
  }
  /** Cleared whenever the conductor or the mirror moves on. */
  let sourceCache: Source | null | undefined;
  /** What the rules say now: the local conductor, or the beacon this frame follows. */
  const source = (): Source | null => {
    if (sourceCache === undefined) sourceCache = readSource();
    return sourceCache;
  };
  const readSource = (): Source | null => {
    if (conducting) {
      return {
        values: conductor.values,
        live: conductor.live,
        ok: conductor.ok,
        target: conductor.target(),
        mode: conductor.mode,
        modeT: conductor.modeT,
        fill: conductor.fill,
      };
    }
    if (mirror?.heard) {
      return {
        values: mirror.values,
        live: mirror.live,
        ok: mirror.ok,
        target: mirror.target(),
        mode: mirror.mode,
        modeT: mirror.modeT,
        fill: mirror.fill,
      };
    }
    return null;
  };

  /** Where strand `j` should go for the current target, whether or not hints are shown. */
  const goalOf = (j: number): Term | null =>
    config.variant === "match" ? (source()?.target?.terms[globalOf(j)] ?? null) : null;
  const hintOf = (j: number): Term | null => (config.hints ? goalOf(j) : null);

  /** The value strand `j` shows: its own while live, else what the rules say. */
  const shownOf = (j: number): Term => {
    const s = own[j]!;
    if (s.live) return { amp: s.amp, phase: s.phase };
    const v = source()?.values[globalOf(j)];
    return v ? { amp: v.amp, phase: v.phase } : { amp: s.amp, phase: s.phase };
  };

  const resetStrand = (j: number | null) => {
    strands.release(j);
    for (const b of bots) if (j === null || b.strand === j) b.release();
    if (config.variant === "free") {
      // In free play a reset lays the thread flat.
      for (const s of own) {
        if (j !== null && s.index !== j) continue;
        s.amp = 0;
        s.lastTouch = now();
        s.live = true;
      }
    }
  };

  const buildResets = () => {
    for (const b of resets) b.remove();
    const u = frame.unit;
    const circles = layout.reset
      ? [{ c: layout.reset, j: null as number | null }]
      : layout.strands
          .filter((s) => s.reset)
          .map((s) => ({ c: s.reset!, j: s.index as number | null }));
    resets = circles.map(({ c, j }) =>
      ctx.ui.button({
        icon: "reset",
        rect: { x: (c.x - c.r) * u, y: (c.y - c.r) * u, width: 2 * c.r * u, height: 2 * c.r * u },
        hold: 1000,
        look: "ghost",
        color: "#c9d3ea",
        onPress: () => {
          lastPerson = now();
          resetStrand(j);
        },
      }),
    );
  };

  // Bots on injected touches, one per harmonic up to `bots`.
  const botCount = Math.min(own.length, Math.max(0, Math.round(ctx.bots)));
  const bots: Bot[] = own.slice(0, botCount).map((s, j) =>
    createBot({
      input: ctx.input,
      strand: s,
      layout: () => layout,
      unit: () => frame.unit,
      rng: base.fork(`bot:${j}`),
      hint: () => goalOf(j),
      value: () => shownOf(j),
      free: config.variant === "free",
    }),
  );

  const venueOf = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venueOf(p);
      const t = now();
      if (strands.down(p.id, v.x, v.y, !p.synthetic, t) && !p.synthetic) lastPerson = t;
    }),
    ctx.input.on("move", (p) => {
      const v = venueOf(p);
      strands.move(p.id, v.x, v.y, now());
    }),
    ctx.input.on("up", (p) => strands.up(p.id, now(), hintOf)),
    ctx.input.on("cancel", (p) => strands.up(p.id, now())),
  ];

  /** Send this frame's harmonics to the frame it follows when due. */
  const sendOwn = (t: number) => {
    if (!followedFrom) return;
    const held = own.some((s) => s.held > 0);
    const anyLive = own.some((s) => s.live);
    const flags = own.map((s) => `${s.live ? 1 : 0}${s.held ? 1 : 0}`).join("");
    const gap = held ? SEND_HELD_MS : anyLive ? SEND_LIVE_MS : SEND_IDLE_MS;
    if (flags === sentFlags && t - sentAt < gap) return;
    const ok = sendState(ctx.net, followedFrom, {
      p: setup.pos,
      h: own.map((s) => ({
        k: s.k,
        a: quantAmp(s.amp),
        ph: quantPhase(s.phase),
        f:
          (s.live ? STATE_FLAG.live : 0) |
          (s.held > 0 ? STATE_FLAG.held : 0) |
          (now() - s.lastPerson < 30_000 ? STATE_FLAG.person : 0),
      })),
    });
    if (ok) {
      sentAt = t;
      sentFlags = flags;
    }
  };

  const updateBank = (dt: number, t: number) => {
    if (!follow || !mirror) return;
    const heard = follow.followed();
    if (heard && heard.at !== followedAt) {
      followedAt = heard.at;
      mirror.apply(heard.msg);
    }
    followedFrom = heard?.from ?? null;
    followScreen = heard?.screen ?? false;
    mirror.step(dt);
    const shouldConduct = !heard && t - follow.lastBetter >= BEACON_GRACE_MS;
    if (shouldConduct && !conducting) {
      remoteLive.clear();
      for (let i = 0; i < conductor.n; i++) conductor.setAuto(i);
      if (mirror.heard) {
        conductor.adopt({ round: mirror.round, target: mirror.targetIndex, values: mirror.values });
      }
    }
    conducting = shouldConduct;
    if (conducting) {
      for (const i of remoteLive) {
        if (t - (inbox?.heardAt(i) ?? 0) > STALE_MS) {
          conductor.setAuto(i);
          remoteLive.delete(i);
        }
      }
    } else sendOwn(t);
  };

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      const t = now();
      time += dt;
      sourceCache = undefined;
      strands.step(dt, t);
      if (inBank) updateBank(dt, t);
      sourceCache = undefined;
      if (conducting) {
        own.forEach((s, j) => {
          if (s.live) conductor.setLive(globalOf(j), s.amp, s.phase);
          else conductor.setAuto(globalOf(j));
        });
        conductor.step(dt);
        sourceCache = undefined;
        if (inBank && t - beaconAt >= BEACON_MS && ctx.net.online) {
          beaconAt = t;
          sendBeacon(ctx.net, beaconFrom(conductor, side, false));
        }
      }
      // Auto harmonics carry what the rules say, so a touch starts from there.
      own.forEach((s, j) => {
        if (s.live) return;
        const v = shownOf(j);
        s.amp = v.amp;
        s.phase = v.phase;
      });
      for (const b of bots) b.update(dt, t);
    },
    render() {
      if (disposed) return;
      const t = now();
      const th = turnAngle(ctx.clock.now(), PERIOD_S[config.speed]);
      const src = source();
      const showPicture = !inBank || (src !== null && !followScreen);
      const glow = src
        ? src.mode === "weave"
          ? 1
          : src.mode === "rest"
            ? Math.max(0, 1 - src.modeT)
            : 0
        : 0;
      const values = src?.values ?? own.map((s) => ({ amp: s.amp, phase: s.phase }));
      const n = values.length;
      const shownAll: Term[] = Array.from({ length: n }, (_, i) => {
        const j = i - (inBank ? firstK - 1 : 0);
        return j >= 0 && j < own.length ? shownOf(j) : values[i]!;
      });
      if (showPicture) {
        const peak = src?.target?.peak ?? Math.max(1, peakOf(shownAll));
        const want = wantedScale(layout.picture, peak);
        scale = scale === 0 ? want : scale + (want - scale) * 0.03;
      }
      const look: FrameLook = {
        theta: th,
        time,
        strands: own.map((s, j) => {
          const v = shownOf(j);
          const hint = hintOf(j);
          const ok = src?.ok[globalOf(j)] ?? false;
          return {
            k: s.k,
            colour: colourOf(s.k),
            amp: v.amp,
            phase: v.phase,
            live: s.live,
            held: s.held > 0,
            ok,
            hint,
          };
        }),
        toTop: inBank && !showPicture,
        picture: showPicture
          ? {
              values: shownAll,
              colours: shownAll.map((_, i) => colourOf(i + 1)),
              live: shownAll.map((_, i) => {
                const j = i - (inBank ? firstK - 1 : 0);
                return j >= 0 && j < own.length ? own[j]!.live : (src?.live[i] ?? false);
              }),
              target: src?.target ?? null,
              theta: th,
              fill: src?.fill ?? 0,
              glow,
              title: src?.target?.title ?? null,
            }
          : null,
        pictureScale: scale,
        cloth:
          !inBank && layout.cloth
            ? {
                bands: conductor.cloth.bands,
                progress:
                  conductor.mode === "weave" ? Math.min(1, conductor.modeT / (WEAVE_S * 0.8)) : 1,
                colours: Array.from({ length: conductor.n }, (_, i) => colourOf(i + 1)),
              }
            : null,
        glow,
        hand: ghostHand(t),
      };
      view.draw(look);
    },
  });

  /** In attract, a ghost hand rides on whichever control is moving by itself the most. */
  const ghostHand = (t: number): FrameLook["hand"] => {
    const attract =
      t - lastPerson > ATTRACT_MS && own.every((s) => s.held === 0) && bots.length === 0;
    const dt = Math.max(1e-3, Math.min(0.1, (t - handAt) / 1000));
    handAt = t;
    let best = -1;
    let bestOn: "slider" | "dial" = "slider";
    let bestRate = 0.02;
    own.forEach((s, j) => {
      const v = shownOf(j);
      const p = prevShown[j]!;
      const da = Math.abs(v.amp - p.amp);
      const dp = Math.abs(phaseDelta(p.phase, v.phase)) * Math.max(0.3, v.amp);
      prevShown[j] = v;
      if (s.live) return;
      const rate = Math.max(da, dp) / dt;
      if (rate > bestRate) {
        bestRate = rate;
        best = j;
        bestOn = da >= dp ? "slider" : "dial";
      }
    });
    if (attract && best >= 0 && (hand.strand < 0 || t - hand.since > 1500)) {
      if (hand.strand !== best || hand.on !== bestOn) hand.since = t;
      hand.strand = best;
      hand.on = bestOn;
    }
    const moving = best >= 0 && best === hand.strand;
    hand.alpha += ((attract && moving ? 1 : 0) - hand.alpha) * 0.06;
    if (hand.alpha < 0.02) {
      if (!moving) hand.strand = -1;
      return null;
    }
    const spec = layout.strands[hand.strand];
    if (!spec) return null;
    const v = shownOf(hand.strand);
    if (hand.on === "slider") {
      return {
        x: spec.slider.x,
        y: spec.slider.y0 + (spec.slider.y1 - spec.slider.y0) * v.amp,
        alpha: hand.alpha,
      };
    }
    const a = v.phase - Math.PI / 2;
    return {
      x: spec.dial.x + Math.cos(a) * spec.dial.r * 0.7,
      y: spec.dial.y + Math.sin(a) * spec.dial.r * 0.7,
      alpha: hand.alpha,
    };
  };

  loop.start();
  buildResets();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    layout = layoutFor(inputOf(f));
    strands.setLayout(layout);
    for (const b of bots) b.release();
    view.resize(frame, layout);
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) buildResets();
    }, 150);
  });

  const command = (name: string) => {
    if (!conducting) return;
    if (name === "clear") conductor.cloth.clear();
    else if (name === "next") conductor.next();
  };

  const debugKey = "__loom";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const src = source();
          return {
            screen: false,
            unit: frame.unit,
            width: layout.width,
            height: layout.height,
            bank: inBank,
            conducting,
            following: followedFrom,
            followScreen,
            picture: !inBank || (src !== null && !followScreen),
            n: conductor.n,
            target: src?.target?.id ?? null,
            mode: src?.mode ?? null,
            fill: src?.fill ?? 0,
            matches: conductor.matches,
            peopleMatches: conductor.peopleMatches,
            woven: conductor.cloth.woven,
            strands: own.map((s, j) => ({
              k: s.k,
              ...shownOf(j),
              live: s.live,
              held: s.held,
              hint: hintOf(j),
              ok: src?.ok[globalOf(j)] ?? false,
            })),
            layout: {
              strands: layout.strands.map((s) => ({
                k: s.k,
                slider: s.slider,
                dial: s.dial,
                col: s.col,
              })),
              picture: layout.picture,
            },
            bots: bots.map((b) => b.moves),
          };
        },
        edges: () => {
          const clock = ctx.clock.now();
          const th = turnAngle(clock, PERIOD_S[config.speed]);
          return {
            clock,
            edges: layout.strands.map((s, j) => {
              const v = shownOf(j);
              return { k: s.k, u: threadEdgeX(s, th, v.amp, v.phase) / layout.width };
            }),
          };
        },
        command,
      },
    });
  }

  return {
    reset() {
      // Idle: every harmonic goes auto (in `free` it then fades or drifts with the rest).
      strands.release(null);
      for (const b of bots) b.release();
      hand.strand = -1;
      hand.alpha = 0;
    },
    attract() {},
    status(): Record<string, OptionValue> {
      const src = source();
      const live = own.filter((s) => s.live).length;
      return {
        harmonics: own.map((s) => s.k).join(","),
        live,
        auto: own.length - live,
        target: src?.target?.title ?? (config.variant === "free" ? "free" : "none"),
        fill: Math.round((src?.fill ?? 0) * 100),
        ...(inBank
          ? { screen: followScreen, conducting }
          : { bands: conductor.cloth.bands.length }),
        matches: conductor.matches,
      };
    },
    command(name) {
      command(name);
    },
    homeSpot(sz) {
      const u = frame.unit;
      return {
        x: Math.max(0, Math.min(frame.width - sz, layout.home.x * u)),
        y: Math.max(0, Math.min(frame.height - sz, layout.home.y * u)),
      };
    },
    dispose() {
      disposed = true;
      loop.stop();
      follow?.dispose();
      inbox?.dispose();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      for (const b of bots) b.dispose();
      strands.clear();
      for (const b of resets) b.remove();
      view.dispose();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
