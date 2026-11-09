/**
 * A touch frame: one or more sorting lines (world.ts), drawn by render.ts. Standalone it runs
 * its own little plant and park at the top. In a bank the screen above drops items in through
 * the top edge and takes the full bins; if the screen goes quiet for 3 s the frame starts its
 * own plant again, and stops it when the screen comes back.
 */
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { createBot, type Bot } from "./bots";
import {
  ATTRACT_SCALE,
  BELT_SPEED,
  HZ,
  PACE_BELT,
  readConfig,
  SIMPLE_SCALE,
  SLOW_SCALE,
} from "./config";
import { createFeed } from "./feed";
import { createGhosts } from "./ghost";
import { BIN_KINDS, ITEMS } from "./items";
import { createLagged } from "./lag";
import { type Belt, type Layout, layoutFor } from "./layout";
import { createUplink } from "./link";
import { createPace } from "./pace";
import { createPark, THING_KINDS } from "./park";
import { createPicker } from "./picker";
import { type Fall, fallAt, fallTimeTo } from "./physics";
import { createFrameView } from "./render";
import type { DropMsg } from "./wire";
import { createWorld, type Item, type World, type WorldEvent } from "./world";

const MAX_ITEMS: Record<string, number> = { panel: 20, pair: 32, kiosk: 16, wall: 60 };
/** Seconds between items on one line from the frame's own plant, at calm pace. */
const FEED_S: Record<string, number> = { panel: 2.6, pair: 3, kiosk: 2.4, wall: 2.6 };
const LOAD_MS = 1000;
const MAX_ARRIVALS = 24;
const MAX_SENT = 32;

const BACKGROUND = "#0b1120";

interface Arrival {
  id: number;
  line: number;
  /** Clock ms: the fall's start, when it crosses the top edge, and when the message came. */
  t0: number;
  cross: number;
  received: number;
  /** Item centre, venue px, the first time it was drawn inside the frame; and when. */
  enterY: number | null;
  enterAt: number | null;
  x: number;
}

export const mountFrame = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  const kind = ctx.frame.kind;
  const inBank = ctx.setup.name === "bank" && (kind === "panel" || kind === "pair");
  let frame: FrameInfo = ctx.frame;
  const layoutOf = (f: FrameInfo): Layout => {
    const u = f.unit;
    return layoutFor({
      kind,
      width: f.width / u,
      height: f.height / u,
      reachTop: { adult: f.reachTop.adult / u, child: f.reachTop.child / u },
      seams: f.seams.map((s) => s / u),
      variant: config.variant,
    });
  };
  let layout = layoutOf(frame);
  ctx.root.style.background = BACKGROUND;

  const rng = ctx.rng().fork(inBank ? `recycling:${ctx.setup.pos}` : "recycling");
  const pace = createPace();
  const park = createPark(layout.parkSlots);
  const now = () => performance.now();
  const clock = () => ctx.clock.now();
  const lagged = ctx.debug ? createLagged(ctx.net) : null;
  const net = lagged?.net ?? ctx.net;

  let mode: "attract" | "play" = "attract";
  const botCount = Math.max(0, Math.round(ctx.bots));
  const active = () => mode === "play" || botCount > 0;
  const scale =
    (config.speed === "slow" ? SLOW_SCALE : 1) * (config.variant === "simple" ? SIMPLE_SCALE : 1);

  const beltSpeed = (b: Belt) => {
    const base = BELT_SPEED[b.speed] * layout.d;
    const p = b.speed === "slow" ? 0 : pace.value;
    return base * (1 + PACE_BELT * p) * (active() ? 1 : ATTRACT_SCALE) * scale;
  };

  let screenId: string | null = null;
  const toScreen = () => inBank && screenId !== null;
  const plantGoal = () =>
    layout.kind === "wall" ? layout.plant.y + layout.plant.height : layout.ground;

  const makeWorld = (l: Layout): World =>
    createWorld({
      layout: l,
      hints: config.hints,
      beltSpeed,
      liftGoal: () => (toScreen() ? 0 : plantGoal()),
      maxItems: MAX_ITEMS[kind] ?? 20,
    });
  let world = makeWorld(layout);
  const picker = createPicker(rng.fork("picker"), config.variant);
  const makeFeeder = (label: string) =>
    createFeed({
      world,
      picker,
      rng: rng.fork(label),
      interval: () =>
        (((FEED_S[kind] ?? 2.6) / (1 + 0.8 * pace.value)) * (active() ? 1 : 1 / 0.55)) / scale,
      target: (line) => {
        const l = layout.lines[line];
        if (!l) return 0;
        const cap = l.belts.reduce((n, b) => n + world.beltCapacity(b), 0);
        return Math.max(3, Math.round(cap * (active() ? 0.75 : 0.5)));
      },
    });
  let feeder = makeFeeder("feed");

  // ---- Bank ---------------------------------------------------------------------------------

  const arrivals: Arrival[] = [];
  const arrivalIds = new Map<number, Arrival>();
  const sentFull = new Set<number>();
  const onDrop = (m: DropMsg) => {
    const line = layout.lines[m.i];
    if (!line) return;
    const fall: Fall = {
      t0: m.t0,
      x0: line.inlet.x,
      y0: -m.y0,
      vx0: 0,
      vy0: m.vy,
      g: m.g,
      tau: m.tau,
    };
    const it = world.arrive(m.i, m.k, fall, m.a, m.w);
    if (!it || !ctx.debug) return;
    const t = fallTimeTo(fall, 0);
    arrivals.push({
      id: m.id,
      line: m.i,
      t0: m.t0,
      cross: t === null ? Number.NaN : m.t0 + t * 1000,
      received: clock(),
      enterY: null,
      enterAt: null,
      x: line.inlet.x,
    });
    if (arrivals.length > MAX_ARRIVALS) arrivals.shift();
    arrivalIds.set(it.id, arrivals[arrivals.length - 1]!);
    if (arrivalIds.size > MAX_ARRIVALS) {
      const first = arrivalIds.keys().next().value;
      if (first !== undefined) arrivalIds.delete(first);
    }
  };
  const uplink = inBank ? createUplink(net, ctx.setup.side ?? 0, now, onDrop) : null;

  // ---- View ---------------------------------------------------------------------------------

  const view = createFrameView(ctx.root);
  const setupView = () => {
    const ratio = Math.min(frame.pixelRatio, 2);
    view.setup(layout, frame.width * ratio, frame.height * ratio, frame.unit * ratio);
  };
  setupView();
  view.setTop(!inBank);
  let ownTop = !inBank;

  // ---- People, bots and the ghost -------------------------------------------------------------

  const lastHuman = layout.lines.map(() => Number.NEGATIVE_INFINITY);
  const lineAt = (x: number) => {
    const i = layout.lines.findIndex((l) => x >= l.x0 && x < l.x1);
    return i < 0 ? 0 : i;
  };
  const claimed = new Set<number>();
  const makeBots = (): Bot[] =>
    Array.from({ length: Math.min(botCount, layout.lines.length * 2) }, (_, i) =>
      createBot({
        input: ctx.input,
        world: () => world,
        line: i % layout.lines.length,
        unit: () => frame.unit,
        rng: rng.fork(`bot:${i}`),
        lastHuman: () => lastHuman[i % layout.lines.length] ?? Number.NEGATIVE_INFINITY,
        claimed,
      }),
    );
  let bots = makeBots();
  let ghosts = createGhosts(() => world, rng.fork("ghost"));

  const venueOf = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venueOf(p);
      const person = !p.synthetic;
      const got = world.grab(p.id, v.x, v.y, person ? "person" : "bot");
      if (!person) return;
      if (mode === "attract") {
        mode = "play";
        ghosts.stop();
        feeder.restart();
      }
      lastHuman[got?.line ?? lineAt(v.x)] = now();
    }),
    ctx.input.on("move", (p) => {
      const v = venueOf(p);
      world.move(p.id, v.x, v.y);
    }),
    ctx.input.on("up", (p) => world.release(p.id, p.vx / frame.unit, p.vy / frame.unit)),
    ctx.input.on("cancel", (p) => world.release(p.id, 0, 0)),
  ];

  // ---- Loop ---------------------------------------------------------------------------------

  let loadAt = Number.NEGATIVE_INFINITY;
  let lastRender = now();
  let disposed = false;
  const counts = { delivered: 0, sentFull: 0, sentSorted: 0 };

  const handle = (e: WorldEvent) => {
    view.event(e);
    if (e.type === "sorted") {
      if (e.by !== "ghost" && !toScreen()) {
        if (e.right) pace.right();
        else pace.wrong();
      }
      if (toScreen() && e.by !== "ghost" && uplink) {
        if (
          uplink.sorted({
            k: e.kind,
            b: BIN_KINDS.indexOf(e.bin),
            r: e.right ? 1 : 0,
            h: e.by === "person" ? 1 : 0,
          })
        )
          counts.sentSorted++;
      }
    } else if (e.type === "full") {
      if (toScreen() && uplink) {
        const rb = e.rise;
        const ok = uplink.full({
          b: BIN_KINDS.indexOf(rb.kind),
          m: rb.product ? THING_KINDS.indexOf(rb.product) : -1,
          u: (rb.x / layout.width) * 1000,
          w: (rb.w / layout.width) * 1000,
          h: rb.h,
          t: clock() + (rb.y / rb.v) * 1000,
          v: rb.v,
        });
        if (ok) {
          sentFull.add(rb.id);
          counts.sentFull++;
          if (sentFull.size > MAX_SENT) {
            const first = sentFull.values().next().value;
            if (first !== undefined) sentFull.delete(first);
          }
        }
      }
    } else if (e.type === "delivered") {
      counts.delivered++;
      // A bin the screen was told about is the screen's now; any other becomes a local thing.
      if (sentFull.has(e.rise.id)) sentFull.delete(e.rise.id);
      else if (e.rise.product) park.add(e.rise.product);
    }
  };

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      const t = now();
      const c = clock();
      if (uplink) {
        screenId = uplink.screen();
        const beacon = uplink.beacon();
        pace.follow(beacon ? beacon.p / 1000 : Number.NaN);
        if (screenId && t - loadAt >= LOAD_MS) {
          loadAt = t;
          uplink.load({
            p: Math.max(0, Math.min(63, ctx.setup.pos)),
            n: Math.min(500, world.load()),
            c: MAX_ITEMS[kind] ?? 20,
            q: Math.min(
              500,
              world.items.filter((it) => it.state === "queue" || it.state === "fall").length,
            ),
            a: active() ? 1 : 0,
          });
        }
      }
      const own = !toScreen();
      if (own !== ownTop) {
        ownTop = own;
        view.setTop(own);
        if (own) feeder.restart();
      }
      pace.step(dt);
      if (own) feeder.step(dt, c);
      ghosts.step(dt, mode === "attract" && botCount === 0);
      for (const b of bots) b.update(dt, t);
      world.step(dt, c);
      for (const e of world.events) handle(e);
      world.events.length = 0;
      park.step(dt);
    },
    render(alpha) {
      if (disposed) return;
      const t = now();
      const dt = Math.min(0.1, (t - lastRender) / 1000);
      lastRender = t;
      const c = clock();
      const pos = { x: 0, y: 0, vx: 0, vy: 0 };
      view.draw({
        items: world.items,
        bins: world.bins,
        rising: world.rising,
        park,
        clock: c,
        alpha,
        dt,
        speeds: layout.belts.map((b) => beltSpeed(b)),
        ghosts: ghosts.hands,
        fallAt: (it: Item) => {
          if (!it.fall) return { x: it.x, y: it.y };
          fallAt(it.fall, (c - it.fall.t0) / 1000, pos);
          const a = arrivalIds.get(it.id);
          if (a && a.enterY === null && pos.y > -layout.r) {
            a.enterY = pos.y;
            a.enterAt = c;
          }
          return { x: pos.x, y: pos.y };
        },
      });
    },
  });
  loop.start();

  const rebuild = () => {
    layout = layoutOf(frame);
    for (const b of bots) b.dispose();
    claimed.clear();
    world = makeWorld(layout);
    feeder = makeFeeder("feed2");
    park.setCapacity(layout.parkSlots);
    bots = makeBots();
    ghosts = createGhosts(() => world, rng.fork("ghost2"));
    lastHuman.length = 0;
    for (let i = 0; i < layout.lines.length; i++) lastHuman.push(Number.NEGATIVE_INFINITY);
  };

  const offResize = ctx.onResize((f) => {
    const before = { w: frame.width / frame.unit, h: frame.height / frame.unit };
    frame = f;
    const after = { w: f.width / f.unit, h: f.height / f.unit };
    if (Math.abs(before.w - after.w) > 1 || Math.abs(before.h - after.h) > 1) rebuild();
    setupView();
    view.setTop(ownTop);
  });

  const resetAll = () => {
    world.dropHolds();
    for (const b of bots) b.release();
    ghosts.stop();
    mode = "attract";
    pace.reset();
    feeder.restart();
  };

  const command = (name: string) => {
    if (name === "clear") {
      world.clear();
      park.clear();
    } else if (name === "reset") resetAll();
  };

  const debugKey = "__recycling";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: false,
          kind,
          unit: frame.unit,
          mode,
          own: ownTop,
          toScreen: screenId,
          clock: clock(),
          pace: pace.value,
          streak: pace.streak,
          layout: {
            width: layout.width,
            height: layout.height,
            d: layout.d,
            r: layout.r,
            childTop: layout.childTop,
            lines: layout.lines.map((l) => ({
              x0: l.x0,
              x1: l.x1,
              inlet: l.inlet,
              belts: l.belts,
              bins: l.bins,
            })),
            belts: layout.belts.map((b) => ({
              id: b.id,
              start: b.start,
              end: b.end,
              y: b.y,
              speed: b.speed,
              takes: b.takes,
            })),
            bins: layout.bins.map((b) => ({
              id: b.id,
              kind: b.kind,
              line: b.line,
              x: b.x,
              w: b.w,
              top: b.top,
              bottom: b.bottom,
              mouth: b.mouth,
              cap: b.cap,
            })),
          },
          items: world.items.map((it) => ({
            id: it.id,
            kind: it.kind,
            item: ITEMS[it.kind]?.id,
            bin: ITEMS[it.kind]?.bin,
            line: it.line,
            state: it.state,
            x: it.x,
            y: it.y,
            belt: it.belt,
            s: it.s,
            by: it.by,
          })),
          bins: world.bins.map((b) => ({
            kind: b.slot.kind,
            fill: b.fill,
            phase: b.phase,
            glow: b.glow,
          })),
          counts: { ...world.counts, ...counts, ghost: ghosts.sorted },
          park: park.things.map((t) => t.kind),
          rising: world.rising.length,
          particles: view.particles,
          arrivals: arrivals.map((a) => ({ ...a })),
          bots: bots.map((b) => ({ line: b.line, ...b.stats })),
        }),
        setLag: (ms: number) => {
          if (lagged) lagged.lag = ms;
        },
        /** Bring every bin to one short of full, to see bins lifted without waiting. */
        fillBins: () => {
          for (const b of world.bins) b.fill = Math.max(b.fill, b.slot.cap - 1);
        },
        command,
      },
    });
  }

  return {
    reset() {
      resetAll();
    },
    attract() {},
    status() {
      return {
        mode,
        items: world.load(),
        right: world.counts.right,
        wrong: world.counts.wrong,
        missed: world.counts.missed,
        people: world.counts.people,
        bins: world.bins.map((b) => `${b.fill}/${b.slot.cap}`).join(" "),
        park: park.things.length,
        pace: Math.round(pace.value * 100) / 100,
        ...(uplink ? { screen: toScreen() } : {}),
      };
    },
    command(name) {
      command(name);
    },
    dispose() {
      disposed = true;
      loop.stop();
      offResize();
      for (const off of offs) off();
      for (const b of bots) b.dispose();
      ghosts.stop();
      uplink?.dispose();
      lagged?.dispose();
      view.dispose();
      world.clear();
      park.clear();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
