/**
 * Kites. Wires the pieces together:
 *
 * - layout.ts   patches of park and their grips on a touch frame
 * - sky.ts      the sky kites fly in (the screen's, or the frame's own) and its units
 * - kite.ts     the spool and stunt kite models; autopilot.ts flies them in attract and for bots
 * - patch.ts    one patch: its kites, grips and who is flying them
 * - wind.ts     the shared wind; rings.ts the drifting rings; tangle.ts crossing lines
 * - frameview.ts, scene.ts, draw.ts, art.ts   drawing; bots.ts injected touches
 * - link.ts, wire.ts   the bank: frames stream kites to the screen above (screen.ts, fleet.ts)
 * - live.ts     today's real wind
 *
 * A touch frame owns its kites' physics. In a bank it flies them in the screen's sky and sends
 * them up; while no screen answers it flies them in a sky of its own.
 */
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { botKites, type Bots, createBots } from "./bots";
import { type Config, readConfig, SCREEN_GRACE_MS } from "./config";
import { createSparkles } from "./art";
import { attachPoints, type KiteView, tailPoint } from "./draw";
import { createFrameView, type FrameScene } from "./frameview";
import { WIND_SPEED } from "./kite";
import { gripAt, type GripId, type Layout, layoutFor, type LayoutInput } from "./layout";
import { createExitHistory, createUplink, type Uplink } from "./link";
import {
  createPatch,
  drag,
  grab,
  heldBy,
  type Patch,
  rebase,
  relaunch,
  release,
  releaseAll,
  resetPatch,
  stepPatch,
} from "./patch";
import { createCaught, inRing, type Ring, ringsAt } from "./rings";
import { createSkyScene, type SkyRect } from "./scene";
import { mountScreen } from "./screen";
import { bankSky, exitX, frameX, frameY, localSky, type SkyFrame, worldX } from "./sky";
import { createTail, stepTail, type Tail } from "./tail";
import { createTangles, type Line } from "./tangle";
import { FLAG, type KiteMsg, SHAPES, TOPIC, type WireKite } from "./wire";
import { createWindState, type WindState } from "./windstate";
import { windAt } from "./wind";

const HZ = 120;
const RING_LOOK_MS = 100;
const TANGLE_LOOK_MS = 50;
const HISTORY_MS = 33;
/** A person touched a kite this recently: it counts as flown by people. */
const HUMAN_MS = 20_000;
const MAX_LAG_TIMERS = 64;

export const mount = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  if (ctx.frame.kind === "screen" || ctx.setup.role === "screen") return mountScreen(ctx, config);
  return mountFrame(ctx, config);
};

const inputOf = (f: FrameInfo, config: Config): LayoutInput => {
  const u = f.unit;
  return {
    kind: f.kind,
    width: f.width / u,
    height: f.height / u,
    reachTop: { adult: f.reachTop.adult / u, child: f.reachTop.child / u },
    seams: f.seams.map((s) => s / u),
    variant: config.variant,
    flyers: config.flyers,
  };
};

const mountFrame = (ctx: AppContext, config: Config): AppInstance => {
  const setup = ctx.setup;
  let frame = ctx.frame;
  const inBank = setup.name === "bank" && (frame.kind === "panel" || frame.kind === "pair");
  const place = inBank ? { pos: setup.pos, count: Math.max(1, setup.count) } : null;
  const side = setup.side ?? 0;
  const colors = ctx.ui.palette.players;
  const clock = () => ctx.clock.now();
  const mountedAt = performance.now();
  const preview = ctx.identity.mode === "preview";

  // Messages to the screen can be held back for tests (`setLag`), like a slow network.
  let lag = 0;
  const lagTimers = new Set<number>();
  const net = ctx.net;
  const lagged = {
    ...net,
    get online() {
      return net.online;
    },
    get self() {
      return net.self;
    },
    peers: () => net.peers(),
    leader: () => net.leader(),
    on: net.on.bind(net),
    onPeers: net.onPeers.bind(net),
    send(topic: string, data: unknown, to?: string) {
      if (lag <= 0 || topic !== TOPIC.kite) {
        net.send(topic, data, to);
        return;
      }
      if (lagTimers.size >= MAX_LAG_TIMERS) return;
      const id = window.setTimeout(() => {
        lagTimers.delete(id);
        net.send(topic, data, to);
      }, lag);
      lagTimers.add(id);
    },
  };

  const wind: WindState = createWindState(ctx, config, preview);
  const uplink: Uplink | null = inBank ? createUplink(lagged, side) : null;
  const history = createExitHistory(48);
  const view = createFrameView(ctx.root);
  const sparkles = createSparkles(240);
  const tangles = createTangles();
  const caught = createCaught(32);
  const tally = new Map<number, number>();
  const tails = new Map<number, Tail>();
  const rings: Ring[] = [];
  const counts = { flown: 0, rings: 0, tangles: 0 };
  let day = new Date().toDateString();

  let layout: Layout = layoutFor(inputOf(frame, config));
  let mode: "bank" | "local" = inBank ? "bank" : "local";
  let modeAt = mountedAt;
  let sky: SkyFrame = mode === "bank" && place ? bankSky(layout, place) : localSky(layout, place);
  let patches: Patch[] = [];
  let bots: Bots | null = null;
  let resetButtons: HTMLElement[] = [];
  let scenery = createSkyScene(() => wind.field, { clouds: 3, px: layout.horizon, seed: ctx.seed });
  const holds = new Map<number, { patch: number; grip: GripId }>();
  let disposed = false;

  const globalOf = (i: number) => (place ? place.pos * layout.patches.length + i : i);
  const startSide = () => (wind.dir(clock() / 1000) >= 0 ? 1 : -1);

  const buildPatches = () => {
    const s = startSide();
    patches = layout.patches.map((spec, i) =>
      createPatch(spec, globalOf(i), sky, s, ctx.rng(`kites:patch:${globalOf(i)}`).next() * 6.283),
    );
    holds.clear();
    tails.clear();
    history.clear();
    for (const t of tangles.clear()) void t;
  };

  const buildControls = () => {
    for (const b of resetButtons) b.remove();
    bots?.dispose();
    const u = frame.unit;
    resetButtons = patches.map((p) => {
      const r = p.spec.reset;
      return ctx.ui.button({
        icon: "reset",
        rect: { x: (r.x - r.r) * u, y: (r.y - r.r) * u, width: 2 * r.r * u, height: 2 * r.r * u },
        hold: 1000,
        look: "ghost",
        color: "#c9d3ea",
        onPress: () => relaunch(p, sky, performance.now()),
      });
    });
    const which = botKites(patches, ctx.bots);
    bots = which.length
      ? createBots({
          input: ctx.input,
          patches: () => patches,
          kites: which,
          unit: () => frame.unit,
        })
      : null;
  };

  const setMode = (next: "bank" | "local") => {
    if (next === mode) return;
    mode = next;
    modeAt = performance.now();
    sky = mode === "bank" && place ? bankSky(layout, place) : localSky(layout, place);
    for (const p of patches) {
      rebase(p, sky);
      p.spool.tangled = false;
      if (p.stunt) p.stunt.tangled = false;
    }
    for (const t of tangles.clear()) void t;
    tails.clear();
    caught.clear();
    view.setup(frame, layout, mode);
  };

  buildPatches();
  view.setup(frame, layout, mode);
  buildControls();

  // ---- Input --------------------------------------------------------------------------------

  const offs = [
    ctx.input.on("down", (p: Pointer) => {
      const u = frame.unit;
      const hit = gripAt(layout, p.x / u, p.y / u);
      if (!hit) return;
      const patch = patches[hit.patch];
      if (!patch) return;
      // The latest finger on a grip takes it.
      for (const [id, h] of holds)
        if (h.patch === hit.patch && h.grip === hit.grip) holds.delete(id);
      holds.set(p.id, hit);
      grab(patch, hit.grip, p.id, p.y / u, !p.synthetic, performance.now());
    }),
    ctx.input.on("move", (p: Pointer) => {
      const h = holds.get(p.id);
      if (!h) return;
      const patch = patches[h.patch];
      if (patch) drag(patch, h.grip, p.id, p.y / frame.unit, performance.now());
    }),
    ctx.input.on("up", (p: Pointer) => {
      const h = holds.get(p.id);
      if (!h) return;
      holds.delete(p.id);
      const patch = patches[h.patch];
      if (patch) release(patch, h.grip, p.id);
    }),
    ctx.input.on("cancel", (p: Pointer) => {
      const h = holds.get(p.id);
      if (!h) return;
      holds.delete(p.id);
      const patch = patches[h.patch];
      if (patch) release(patch, h.grip, p.id);
    }),
  ];

  // ---- Simulation ---------------------------------------------------------------------------

  let windT = clock() / 1000;
  const windFn = (x: number, y: number) => windAt(wind.field, windT, sky.fOf(x), y) * WIND_SPEED;

  const slotOf = (patch: number, stunt: boolean) => patch * 2 + (stunt ? 1 : 0);

  /**
   * Where each line crosses the sky's bottom edge now, frame px: per patch the spool's line, then
   * the stunt kite's left and right lines. Each leans towards its kite but stays over its patch.
   */
  const exitsNow: number[] = [];
  const computeExits = (out: number[]) => {
    out.length = patches.length * 3;
    const base = sky.baseY;
    patches.forEach((p, i) => {
      const s = p.spec;
      const lo = s.x0 + (frame.kind === "pair" && i > 0 ? 130 : 40);
      const hi = s.x1 - (frame.kind === "pair" && i < patches.length - 1 ? 130 : 40);
      const lean = Math.max(40, (s.x1 - s.x0) / 2 - 90);
      const exit = (x: number, top: number, kx: number, ky: number) =>
        Math.min(hi, Math.max(lo, exitX(x, top - base, kx, ky, base, lean)));
      const b = s.spool;
      out[i * 3] = exit(b.x, b.y - b.r, frameX(sky, p.spool.x), frameY(sky, p.spool.y));
      const k = p.stunt;
      const l = s.stunt?.left;
      const r = s.stunt?.right;
      if (k && l && r) {
        out[i * 3 + 1] = exit(l.x, l.restY - l.h / 2, frameX(sky, k.x), frameY(sky, k.y));
        out[i * 3 + 2] = exit(r.x, r.restY - r.h / 2, frameX(sky, k.x), frameY(sky, k.y));
      } else {
        out[i * 3 + 1] = out[i * 3 + 2] = s.cx;
      }
    });
    return out;
  };

  const flagsOf = (p: Patch, stunt: boolean, now: number): number => {
    const which = stunt ? "stunt" : "spool";
    const k = stunt ? p.stunt! : p.spool;
    let f = 0;
    if (k.tangled) f |= FLAG.tangled;
    if (p.modes[which] === "auto") f |= FLAG.auto;
    if (now - p.human[which] < HUMAN_MS) f |= FLAG.human;
    if (stunt && p.stunt) {
      if (p.stunt.phase === "down") f |= FLAG.down;
      if (p.stunt.parked > 0.5) f |= FLAG.parked;
    } else if (p.spool.sparkle) f |= FLAG.sparkle;
    return f;
  };

  const kiteList: WireKite[] = [];
  const buildMsg = (): KiteMsg => {
    const now = performance.now();
    const fw = layout.width;
    computeExits(exitsNow);
    kiteList.length = 0;
    patches.forEach((p, i) => {
      const e = exitsNow[i * 3]!;
      kiteList.push({
        slot: slotOf(i, false),
        u: e / fw,
        u2: e / fw,
        x: sky.fOf(p.spool.x),
        y: p.spool.y,
        spin: p.spool.spin,
        tension: p.spool.tension,
        flags: flagsOf(p, false, now),
        color: p.color,
        shape: SHAPES.indexOf(p.shape),
      });
      if (p.stunt && p.spec.stunt) {
        kiteList.push({
          slot: slotOf(i, true),
          u: exitsNow[i * 3 + 1]! / fw,
          u2: exitsNow[i * 3 + 2]! / fw,
          x: sky.fOf(p.stunt.x),
          y: p.stunt.y,
          spin: p.stunt.spin,
          tension: p.stunt.tension,
          flags: flagsOf(p, true, now),
          color: p.color,
          shape: SHAPES.indexOf("delta"),
        });
      }
    });
    return {
      t: Math.round(clock()),
      pos: setup.pos,
      count: Math.max(1, setup.count),
      kites: kiteList,
    };
  };

  let ringAt = 0;
  const lookRings = (now: number, t: number) => {
    if (!config.rings || now < ringAt) return;
    ringAt = now + RING_LOOK_MS;
    ringsAt(wind.field, t, rings);
    for (const p of patches) {
      const k = config.variant === "single" ? p.spool : p.stunt;
      if (!k) continue;
      if (k.kind === "stunt" && k.phase === "down") continue;
      for (const r of rings) {
        if (caught.has(r.id) || !inRing(r, k.x, k.y, sky.width, sky.ring)) continue;
        caught.add(r.id);
        p.counts.rings++;
        counts.rings++;
        if (mode === "bank") {
          uplink?.ring({ ring: r.id, color: p.color, t: Math.round(clock()) });
        } else {
          tally.set(p.color, (tally.get(p.color) ?? 0) + 1);
          const c = colors[p.color % colors.length] ?? "#ffffff";
          sparkles.emit(frameX(sky, r.f * sky.width), frameY(sky, r.h), c, 26, sky.scale * 0.5);
        }
      }
    }
  };

  const lines: Line[] = [];
  let tangleAt = 0;
  let tangleLast = performance.now();
  const lookTangles = (now: number) => {
    if (mode === "bank") {
      const caughtNow = uplink?.tangles(now);
      patches.forEach((p, i) => {
        for (const k of p.stunt ? [p.spool, p.stunt] : [p.spool]) {
          const was = k.tangled;
          k.tangled = config.tangles && !!caughtNow?.has(slotOf(i, k.kind === "stunt"));
          if (k.tangled && !was) {
            p.counts.tangles++;
            counts.tangles++;
          }
        }
      });
      return;
    }
    if (!config.tangles || now < tangleAt) return;
    const dt = Math.min(0.5, (now - tangleLast) / 1000);
    tangleAt = now + TANGLE_LOOK_MS;
    tangleLast = now;
    computeExits(exitsNow);
    lines.length = 0;
    patches.forEach((p, i) => {
      lines.push({
        key: String(slotOf(i, false)),
        group: String(i),
        auto: p.modes.spool === "auto",
        x0: worldX(sky, exitsNow[i * 3]!),
        y0: 0,
        x1: p.spool.x,
        y1: p.spool.y,
      });
      if (p.stunt) {
        lines.push({
          key: String(slotOf(i, true)),
          group: String(i),
          auto: p.modes.stunt === "auto",
          x0: worldX(sky, (exitsNow[i * 3 + 1]! + exitsNow[i * 3 + 2]!) / 2),
          y0: 0,
          x1: p.stunt.x,
          y1: p.stunt.y,
        });
      }
    });
    for (const e of tangles.update(lines, dt)) {
      for (const key of [e.a, e.b]) {
        const slot = Number(key);
        const p = patches[slot >> 1];
        const k = slot & 1 ? p?.stunt : p?.spool;
        if (!p || !k) continue;
        k.tangled = e.on;
        if (e.on) {
          p.counts.tangles++;
          counts.tangles++;
        }
      }
    }
  };

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      const now = performance.now();
      windT = clock() / 1000;
      wind.tick(now, windT);
      for (const p of patches) stepPatch(p, dt, windT, now, windFn, sky);
      bots?.update(now, windT, sky);
    },
    render() {
      if (disposed) return;
      frameRender();
    },
  });

  // ---- Drawing ------------------------------------------------------------------------------

  const views: KiteView[] = [];
  const drawExits: number[] = [];
  let historyAt = 0;
  let pokedAt = 0;
  let lastRender = performance.now();
  let sparkleAt = 0;
  const skyRect: SkyRect = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    unit: 1,
    fOf: (px) => sky.fOf(worldX(sky, px)),
  };

  const viewFor = (i: number, p: Patch, stunt: boolean, alpha: number, now: number): KiteView => {
    const k = stunt ? p.stunt! : p.spool;
    const slot = slotOf(i, stunt);
    const x = frameX(sky, k.px + (k.x - k.px) * alpha);
    const y = frameY(sky, k.py + (k.y - k.py) * alpha);
    const size = sky.kite * sky.scale;
    const which = stunt ? "stunt" : "spool";
    const color = colors[p.color % colors.length] ?? "#6fa4fc";
    const base = sky.baseY;
    let starts: { x: number; y: number }[];
    if (stunt && p.spec.stunt) {
      starts = [
        { x: exitsNow[i * 3 + 1]!, y: base },
        { x: exitsNow[i * 3 + 2]!, y: base },
      ];
    } else {
      starts = [{ x: exitsNow[i * 3]!, y: base }];
    }
    let tail: Tail | null = null;
    if (!stunt) {
      tail = tails.get(slot) ?? null;
      if (!tail) {
        tail = createTail(p.shape === "dragon" ? 9 : 10, size * 0.16);
        tails.set(slot, tail);
      }
    }
    let twist: { x: number; y: number } | null = null;
    if (k.tangled) {
      for (const t of tangles.active()) {
        if (t.a === String(slot) || t.b === String(slot)) {
          twist = { x: frameX(sky, t.x), y: frameY(sky, t.y) };
          break;
        }
      }
    }
    return {
      kind: stunt ? "stunt" : "spool",
      x,
      y,
      spin: k.spin,
      size,
      color,
      shape: stunt ? "delta" : p.shape,
      tension: k.tension,
      alpha: 1,
      glow: p.modes[which] === "people" && now - p.touched[which] < HUMAN_MS,
      starts,
      tail,
      twist,
    };
  };

  const frameRender = () => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - lastRender) / 1000);
    lastRender = now;
    const t = clock() / 1000;
    const today = new Date().toDateString();
    if (today !== day) {
      day = today;
      counts.flown = counts.rings = counts.tangles = 0;
      for (const p of patches) p.counts.flown = p.counts.rings = p.counts.tangles = 0;
    }

    // A person holding a control still makes no touch events, so tell the idle timer.
    if (
      now - pokedAt > 1000 &&
      patches.some((p) => heldBy(p, "spool") === "person" || heldBy(p, "stunt") === "person")
    ) {
      pokedAt = now;
      ctx.idle.poke();
    }
    if (inBank && uplink) {
      const screen = uplink.screen(now);
      if (screen) setMode("bank");
      else if (now - mountedAt > SCREEN_GRACE_MS + 800 || mode === "local") setMode("local");
    }
    lookRings(now, t);
    lookTangles(now);
    computeExits(exitsNow);
    if (mode === "bank" && uplink) {
      if (now >= historyAt) {
        historyAt = now + HISTORY_MS;
        history.record(clock(), exitsNow);
      }
      uplink.tick(now, buildMsg);
      if (!history.at(clock() - uplink.delay, drawExits)) drawExits.length = 0;
    }
    sparkles.step(dt);
    views.length = 0;
    if (mode === "local") {
      scenery.step(dt, t);
      const alpha = 1;
      patches.forEach((p, i) => {
        const v = viewFor(i, p, false, alpha, now);
        if (v.tail) {
          const tp = tailPoint(v);
          const w = windAt(wind.field, t, sky.fOf(p.spool.x), p.spool.y) * WIND_SPEED;
          stepTail(v.tail, tp.x, tp.y, w * sky.scale * 3, sky.scale * 0.8, dt);
        }
        views.push(v);
        if (p.spool.sparkle && now > sparkleAt) {
          const at = v.tail
            ? { x: v.tail.x[v.tail.n - 1]!, y: v.tail.y[v.tail.n - 1]! }
            : attachPoints(v)[0]!;
          sparkles.emit(at.x, at.y, "#fff4c0", 1, sky.scale * 0.08);
        }
        if (p.stunt) views.push(viewFor(i, p, true, alpha, now));
      });
      if (now > sparkleAt) sparkleAt = now + 70;
      skyRect.x = 0;
      skyRect.y = 0;
      skyRect.w = layout.width;
      skyRect.h = layout.horizon;
      skyRect.unit = sky.scale;
    }
    const scene: FrameScene = {
      mode,
      layout,
      patches,
      colors,
      views,
      exits: mode === "bank" && drawExits.length === exitsNow.length ? drawExits : exitsNow,
      baseY: sky.baseY,
      rings: config.rings ? rings : [],
      ringRadius: sky.ring,
      hideRing: (id) => caught.has(id),
      tally,
      sky: skyRect,
      t,
      now,
      attribution: wind.attribution,
      sparkles,
      scenery,
    };
    view.draw(scene);
  };

  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      const next = layoutFor(inputOf(frame, config));
      const same =
        Math.abs(next.width - layout.width) < 2 && Math.abs(next.height - layout.height) < 2;
      layout = next;
      sky = mode === "bank" && place ? bankSky(layout, place) : localSky(layout, place);
      if (!same) {
        bots?.release();
        buildPatches();
      } else {
        for (const p of patches) rebase(p, sky);
      }
      scenery.dispose();
      scenery = createSkyScene(() => wind.field, { clouds: 3, px: layout.horizon, seed: ctx.seed });
      view.setup(frame, layout, mode);
      buildControls();
    }, 150);
  });

  const gust = () => wind.commandGust();

  const debugKey = "__kites";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: false,
          mode,
          modeAt,
          unit: frame.unit,
          delay: uplink?.delay ?? 0,
          sent: uplink?.sent ?? 0,
          horizon: layout.horizon,
          baseY: sky.baseY,
          exits: [...exitsNow],
          drawExits: [...drawExits],
          clock: clock(),
          tally: [...tally],
          rings: rings.map((r) => ({ ...r, caught: caught.has(r.id) })),
          counts: { ...counts },
          wind: wind.status(),
          attribution: wind.attribution,
          gusts: wind.field.commanded.length,
          patches: patches.map((p) => ({
            cx: p.spec.cx,
            color: p.color,
            modes: { ...p.modes },
            reset: { ...p.spec.reset },
            button: {
              x: p.button.spec.x,
              y: p.button.spec.y,
              r: p.button.spec.r,
              hit: { ...p.button.spec.hit },
              held: p.button.pointer !== null,
              reeling: p.button.reeling,
            },
            grips: {
              left: p.grips.left ? { ...p.grips.left.spec, y: p.grips.left.y } : null,
              right: p.grips.right ? { ...p.grips.right.spec, y: p.grips.right.y } : null,
            },
            spool: {
              x: p.spool.x,
              y: p.spool.y,
              length: p.spool.length,
              theta: p.spool.theta,
              col: [p.spool.colMin, p.spool.colMax],
              tangled: p.spool.tangled,
              sparkle: p.spool.sparkle,
            },
            stunt: p.stunt
              ? {
                  x: p.stunt.x,
                  y: p.stunt.y,
                  heading: p.stunt.heading,
                  speed: p.stunt.speed,
                  phase: p.stunt.phase,
                  parked: p.stunt.parked,
                  tangled: p.stunt.tangled,
                }
              : null,
          })),
        }),
        setLag(ms: number) {
          lag = Math.max(0, Math.min(2000, ms));
        },
        command(name: string) {
          if (name === "gust") gust();
        },
      },
    });
  }

  return {
    reset() {
      bots?.release();
      const s = startSide();
      for (const p of patches) resetPatch(p, sky, s);
      holds.clear();
      tally.clear();
      caught.clear();
      sparkles.clear();
      tails.clear();
      for (const t of tangles.clear()) void t;
    },
    attract() {},
    status() {
      const now = performance.now();
      let flying = 0;
      for (const p of patches) {
        if (now - p.human.spool < HUMAN_MS) flying++;
        if (p.stunt && now - p.human.stunt < HUMAN_MS) flying++;
      }
      const flown = patches.reduce((n, p) => n + p.counts.flown, 0);
      const w = wind.status();
      return {
        mode,
        kites: patches.length * (config.variant === "single" ? 1 : 2),
        flying,
        flown,
        rings: counts.rings,
        tangles: counts.tangles,
        wind: w.source,
        windSpeed: w.speed,
      };
    },
    command(name) {
      if (name === "gust") gust();
    },
    homeSpot(size) {
      const h = layout.home;
      if (!h) return null;
      const u = frame.unit;
      return { x: (h.x + h.size) * u - size, y: (h.y + h.size) * u - size };
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      for (const id of lagTimers) clearTimeout(id);
      lagTimers.clear();
      bots?.dispose();
      for (const b of resetButtons) b.remove();
      for (const p of patches) releaseAll(p);
      uplink?.dispose();
      wind.dispose();
      view.dispose();
      scenery.dispose();
      sparkles.clear();
      tails.clear();
      holds.clear();
      tally.clear();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
