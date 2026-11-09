/**
 * A touch frame: a wall or a lone panel or pair running its own ring, or a bank frame showing
 * its stretch of the bank's ring (link.ts). A bank frame that hears no cars for LOCAL_AFTER_MS,
 * and isn't next in line to host, runs a ring of its own in the lone layout until cars come back.
 *
 * Touch a car and it brakes: hard while the finger stays, for TAP_MS after a tap. The brake
 * lights come on at once here; on a bank the host hears about it and the car slows a moment later.
 */
import type { AppContext, AppInstance, Pointer } from "../../core/types";
import { controlAt, type ControlState } from "./art";
import { type Bots, createBots } from "./bots";
import {
  type Config,
  countRange,
  GHOST_MAX_S,
  GHOST_MIN_S,
  LOCAL_AFTER_MS,
  type Settings,
  SNAP_HZ,
  SPACING,
  TAP_MS,
  TIME_SCALE,
} from "./config";
import { createDiagram, type Diagram, paintDue } from "./diagram";
import { applyCtl, createDriver, type Driver, startCount } from "./driver";
import { createFeed } from "./feed";
import {
  carNear,
  type ControlGroup,
  type FrameLayout,
  frameLayout,
  type LayoutInput,
  ringLengthFor,
  stretchMetres,
} from "./layout";
import { createLagSend } from "./lag";
import { createLink, type BankLink } from "./link";
import { jams } from "./model";
import { createScene, type Ripple } from "./scene";
import type { WireCar } from "./wire";

/** Own rings draw this far behind the clock (snapshots come from this frame). */
const OWN_DELAY_MS = 60;
const OWN_PLAN = { d0: OWN_DELAY_MS, d1: OWN_DELAY_MS, t0: 0 };
/** Least time between switching to a ring of our own and back. */
const SWITCH_MS = 2000;
/** No touch from a person for this long: attract mode, with the ghost hand. */
const ATTRACT_AFTER_MS = 20_000;
const POKE_MS = 1000;
const REPORT_MS = 400;
const MAX_RIPPLES = 12;

interface Hold {
  car: number;
  downAt: number;
  person: boolean;
  sentAt: number;
}

export const diagramFor = (layout: FrameLayout): Diagram => {
  const d = layout.diagram;
  const w = Math.min(2400, Math.max(64, Math.round(d.width / 2)));
  const rows = Math.min(1600, Math.max(64, Math.round(d.height / 2.5)));
  return createDiagram(w, rows, layout.history * 1000);
};

export const mountTouch = (ctx: AppContext, cfg: Config): AppInstance => {
  const kind = ctx.frame.kind;
  const inBank = ctx.setup.name === "bank" && (kind === "panel" || kind === "pair");
  const place = inBank ? { pos: ctx.setup.pos, count: Math.max(1, ctx.setup.count) } : null;
  const clock = () => ctx.clock.now();
  let frame = ctx.frame;
  let mode: "solo" | "bank" | "local" = inBank ? "bank" : "solo";
  let modeAt = performance.now();

  const inputFor = (bank: boolean): LayoutInput => {
    const u = frame.unit;
    return {
      kind: frame.kind,
      width: frame.width / u,
      height: frame.height / u,
      reachTop: { adult: frame.reachTop.adult / u, child: frame.reachTop.child / u },
      seams: frame.seams.map((s) => s / u),
      bank: bank ? place : null,
      versus: false,
      road: cfg.road,
    };
  };

  const baseCount = (length: number) => startCount(length, SPACING[cfg.density]);
  const defaults = (length: number): Settings => ({
    count: baseCount(length),
    limit: cfg.limit,
    smart: cfg.smart,
  });

  let layout = frameLayout(inputFor(mode === "bank"));
  const scene = createScene(ctx.root);
  scene.setup(frame, layout);
  let diagram = diagramFor(layout);
  const rows = { at: performance.now() };

  const lagged = createLagSend(ctx.net);
  const send = lagged.send;

  let lastPerson = Number.NEGATIVE_INFINITY;
  let brakes = 0;
  let day = new Date().toDateString();
  const countBrake = () => {
    const today = new Date().toDateString();
    if (today !== day) {
      day = today;
      brakes = 0;
    }
    brakes++;
  };

  const link: BankLink | null = place
    ? createLink({
        net: ctx.net,
        clock,
        isScreen: false,
        pos: place.pos,
        config: cfg,
        seed: ctx.seed,
        ringLength: () => stretchMetres(frame.width / frame.unit) * place.count,
        baseCount,
        defaults,
        send,
        personActive: () => performance.now() - lastPerson < 5000,
        onActivity(person) {
          if (person) {
            lastPerson = performance.now();
            ctx.idle.poke();
          }
        },
        onBrake(_car, person) {
          if (person) countBrake();
        },
      })
    : null;

  // A ring of our own: solo, or a bank frame that lost its host.
  let driver: Driver | null = null;
  const ownFeed = createFeed();
  let ownSnapAt = Number.NEGATIVE_INFINITY;
  const ownWire: WireCar[] = [];
  const makeOwn = (keep: Settings | null) => {
    const length = ringLengthFor(inputFor(false));
    const base = defaults(length);
    driver = createDriver({
      length,
      baseCount: baseCount(length),
      settings: keep ? { ...base, limit: keep.limit, smart: keep.smart } : base,
      noise: cfg.noise,
      seed: ctx.seed,
      start: clock(),
    });
    ownFeed.clear();
    ownSnapAt = Number.NEGATIVE_INFINITY;
  };
  if (mode === "solo") makeOwn(null);

  /** The driver this frame runs, if any: its own ring, or the bank's while hosting. */
  const owned = (): Driver | null =>
    mode === "bank" ? (link?.hosting ? link.driver : null) : driver;

  const relayout = () => {
    layout = frameLayout(inputFor(mode === "bank"));
    scene.setup(frame, layout);
    diagram.dispose();
    diagram = diagramFor(layout);
    rows.at = performance.now();
    controlsKey = "";
  };

  const goLocal = () => {
    mode = "local";
    modeAt = performance.now();
    makeOwn(link?.settings() ?? null);
    relayout();
    holds.clear();
  };
  const goBank = () => {
    mode = "bank";
    modeAt = performance.now();
    driver = null;
    ownFeed.clear();
    relayout();
    holds.clear();
  };

  // ---- Settings and controls --------------------------------------------------------------

  let pending: { key: 0 | 1 | 2; value: number; until: number } | null = null;
  const pressed = new Map<string, number>();
  let controlsKey = "";

  const settingsNow = (): Settings | null => {
    const d = owned();
    if (d) return d.settings;
    return link?.settings() ?? null;
  };

  const shownSettings = (): Settings | null => {
    const s = settingsNow();
    if (!s) return null;
    if (!pending || performance.now() > pending.until) {
      pending = null;
      return s;
    }
    if (pending.key === 1) return { ...s, limit: pending.value };
    if (pending.key === 2) return { ...s, smart: pending.value };
    return s;
  };

  const ctl = (key: 0 | 1 | 2, value: number, person: boolean) => {
    const d = owned();
    if (d) {
      applyCtl(d, key, value);
      return;
    }
    link?.ctl(key, value, person);
    if (key !== 0) pending = { key, value, until: performance.now() + 1500 };
  };

  const ringLength = () => {
    const d = owned();
    if (d) return d.ring.length;
    return (mode === "bank" ? link?.feed.latest?.length : ownFeed.latest?.length) ?? 0;
  };

  const pressControl = (key: ControlGroup["key"], cell: number, person: boolean) => {
    const s = shownSettings();
    if (!s || cell < 0) return;
    pressed.set(`${key}:${cell}`, performance.now());
    if (key === "cars") {
      if (cell === 1) return;
      ctl(0, cell === 0 ? -1 : 1, person);
    } else if (key === "limit") {
      if (cell !== s.limit) ctl(1, cell, person);
    } else if (cell !== s.smart) ctl(2, cell, person);
  };

  // ---- Touches ------------------------------------------------------------------------------

  const holds = new Map<number, Hold>();
  const pressedCars = new Map<number, number>();
  const ripples: Ripple[] = [];

  const brake = (car: number, ms: number, person: boolean) => {
    const d = owned();
    if (d) {
      if (d.brake(car, ms, 1) === "started" && person) countBrake();
      return;
    }
    link?.brake(car, ms, person);
  };

  const carAt = (x: number, y: number): number | null =>
    carNear(scene.drawn, x, y, layout.carPx, layout.carW, layout.circle);

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
      pressControl(hit.key, hit.cell, person);
      return;
    }
    const car = carAt(x, y);
    const now = performance.now();
    if (ripples.length >= MAX_RIPPLES) ripples.shift();
    ripples.push({ x, y, at: now, hit: car !== null });
    if (car === null) return;
    holds.set(p.id, { car, downAt: now, person, sentAt: now });
    pressedCars.set(car, now + TAP_MS);
    brake(car, TAP_MS, person);
  };

  const up = (p: Pointer) => {
    const h = holds.get(p.id);
    if (!h) return;
    holds.delete(p.id);
    const now = performance.now();
    const left = Math.max(0, TAP_MS - (now - h.downAt));
    pressedCars.set(h.car, now + left);
    brake(h.car, left, h.person);
  };

  const offs = [ctx.input.on("down", down), ctx.input.on("up", up), ctx.input.on("cancel", up)];

  // ---- Attract ------------------------------------------------------------------------------

  /** On a circle, the cars drawn within adult reach (the top of a wall's is out of reach). */
  const reachable = (): Set<number> | null => {
    if (!layout.circle) return null;
    const top = frame.reachTop.adult / frame.unit;
    return new Set(scene.drawn.filter((c) => c.y >= top).map((c) => c.id));
  };

  const ghostRng = ctx.rng("traffic:ghost");
  let ghostAt = performance.now() + 7000 + ghostRng.range(0, 3000);
  const ghost = (local: number) => {
    const d = owned();
    if (!d || local < ghostAt) return;
    const attract = local - lastPerson > ATTRACT_AFTER_MS;
    if (link && mode === "bank") link.setAttract(attract);
    if (!attract) {
      ghostAt = local + 5000;
      return;
    }
    ghostAt = local + ghostRng.range(GHOST_MIN_S, GHOST_MAX_S) * 1000;
    // The quickest car, so the jam it starts is plain to see; on a circle, one people can reach.
    const reach = reachable();
    let pick: { id: number; v: number } | null = null;
    for (const c of d.ring.cars) {
      if (reach && !reach.has(c.id)) continue;
      if (!pick || c.v > pick.v) pick = { id: c.id, v: c.v };
    }
    if (pick) d.brake(pick.id, 1300, 2);
  };

  // ---- Bots ---------------------------------------------------------------------------------

  const bots: Bots | null =
    ctx.bots > 0
      ? createBots(
          ctx.input,
          ctx.bots,
          {
            cars: () => {
              const L = ringLength();
              const k = L > 0 ? (layout.path?.pxPerM(L) ?? 0) * TIME_SCALE : 0;
              const reach = reachable();
              return scene.drawn
                .filter((c) => !reach || reach.has(c.id))
                .map((c) => {
                  const v = cars.find((w) => w.id === c.id)?.v ?? 0;
                  return { ...c, vx: Math.cos(c.angle) * v * k, vy: Math.sin(c.angle) * v * k };
                });
            },
            controls: () => layout.controls,
            settings: () => settingsNow(),
            defaults: () => defaults(ringLength() || 1),
            lastPerson: () => lastPerson,
            unit: () => frame.unit,
            size: () => ({ width: layout.width, height: layout.height }),
          },
          ctx.rng(`traffic:bots:${ctx.setup.side}:${ctx.setup.pos}`),
        )
      : null;

  // ---- Loop ---------------------------------------------------------------------------------

  const cars: WireCar[] = [];
  let lastPoke = Number.NEGATIVE_INFINITY;
  let lastReport = Number.NEGATIVE_INFINITY;
  let lostAfter: number | null = null;

  const update = () => {
    const local = performance.now();
    const now = clock();
    if (link) {
      link.tick();
      if (local - modeAt >= SWITCH_MS) {
        if (
          mode === "bank" &&
          !link.hosting &&
          link.quiet(local) > LOCAL_AFTER_MS &&
          !link.nextInLine()
        ) {
          lostAfter = Math.round(link.quiet(local));
          goLocal();
        } else if (mode === "local" && (link.hosting || link.quiet(local) < 400)) {
          goBank();
        }
      }
    }
    if (driver && mode !== "bank") {
      driver.advance(now);
      if (local - ownSnapAt >= 1000 / (SNAP_HZ * 2) - 2) {
        ownSnapAt = local;
        const snap = driver.snapshot(OWN_PLAN, local - lastPerson > ATTRACT_AFTER_MS, ownWire);
        ownFeed.push({ ...snap, cars: snap.cars.map((c) => ({ ...c })) }, ctx.net.self);
      }
    }
    // Held fingers keep their cars braking, and tell the host now and then.
    for (const h of holds.values()) {
      const held = local - h.downAt;
      pressedCars.set(h.car, local + 150);
      const own = owned();
      if (own) own.brake(h.car, Math.max(TAP_MS - held, 150), 1);
      else if (local - h.sentAt >= 400) {
        h.sentAt = local;
        link?.brake(h.car, Math.max(TAP_MS - held, 800), h.person);
      }
    }
    for (const [car, until] of pressedCars) if (until < local - 2000) pressedCars.delete(car);
    ghost(local);
    bots?.update(local);
    const people = [...holds.values()].some((h) => h.person);
    if (people && local - lastPoke >= POKE_MS) {
      lastPoke = local;
      ctx.idle.poke();
    }
    if (local - lastReport >= REPORT_MS) {
      lastReport = local;
      ctx.root.dataset.traffic = mode;
    }
  };

  const draw = () => {
    const local = performance.now();
    const feed = mode === "bank" ? link!.feed : ownFeed;
    const delay = mode === "bank" ? link!.delay : OWN_DELAY_MS;
    const t = clock() - delay;
    const L = feed.latest?.length ?? 1;
    const f0 = layout.slice.pos / layout.slice.count;
    const f1 = (layout.slice.pos + 1) / layout.slice.count;
    const whole = layout.loop !== null || layout.circle !== null || layout.kind === "wall";
    paintDue(diagram, rows, local, L, whole ? 0 : f0, whole ? 1 : f1, (ago, out) =>
      feed.at(t - ago, out),
    );
    const has = feed.at(t, cars);
    if (!has) cars.length = 0;
    for (let i = ripples.length - 1; i >= 0; i--)
      if (local - ripples[i]!.at > 700) ripples.splice(i, 1);
    const s = shownSettings();
    if (s) scene.background(s.limit);
    scene.draw({
      cars,
      length: L,
      now: local,
      pressed: pressedCars,
      ripples,
      diagram,
      frac: (local - rows.at) / diagram.rowMs,
      f0: whole ? 0 : f0,
      f1: whole ? 1 : f1,
    });
    if (s) {
      const range = countRange(owned()?.baseCount ?? baseCount(L));
      let flashing = false;
      for (const [k, at] of pressed) {
        if (local - at < 320) flashing = true;
        else pressed.delete(k);
      }
      const key = `${s.count}|${s.limit}|${s.smart}|${range.lo}|${range.hi}`;
      if (flashing || key !== controlsKey) {
        controlsKey = flashing ? "" : key;
        const state: ControlState = {
          count: s.count,
          limit: s.limit,
          smart: s.smart,
          fewer: s.count > range.lo,
          more: s.count < range.hi,
          pressed,
          now: local,
        };
        scene.controls(state);
      }
    }
  };

  const loop = ctx.loop({ hz: 60, update, render: draw });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    relayout();
  });

  const debugKey = "__traffic";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const s = settingsNow();
          const d = owned();
          return {
            screen: false,
            mode,
            modeAt,
            lostAfter,
            hosting: link?.hosting ?? true,
            host: link?.host ?? null,
            handovers: link?.handovers ?? 0,
            hostedAt: link?.hostedAt ?? null,
            delay: mode === "bank" ? (link?.delay ?? 0) : OWN_DELAY_MS,
            late: link?.late ?? 0,
            clock: clock(),
            unit: frame.unit,
            settings: s,
            length: ringLength(),
            stepT: d?.t ?? null,
            brakes,
            layout: {
              kind: layout.kind,
              width: layout.width,
              height: layout.height,
              road: layout.road,
              laneY: layout.laneY,
              diagram: layout.diagram,
              controls: layout.controls,
              carPx: layout.carPx,
              circle: layout.circle,
            },
            painted: diagram.painted,
            cars: scene.drawn.map((c) => {
              const w = cars.find((x) => x.id === c.id);
              return { ...c, v: w?.v ?? 0, ringX: w?.x ?? 0, flags: w?.flags ?? 0 };
            }),
            ring: cars.map((c) => ({ ...c })),
            jams: d ? jams(d.ring) : null,
          };
        },
        /** The diagram's colour at fraction `f` across (of what it shows), `secs` ago. */
        peek(f: number, secs: number) {
          return diagram.peek(f, (secs * 1000) / diagram.rowMs);
        },
        setLag(ms: number) {
          lagged.setLag(ms);
        },
      },
    });
  }

  return {
    reset() {
      holds.clear();
      pending = null;
      const d = owned();
      if (d) d.set(defaults(d.ring.length));
    },
    attract() {
      ghostAt = Math.min(ghostAt, performance.now() + 4000);
    },
    homeSpot(size) {
      // The wall's default (top right of the adults' band) is clear of its plates; on panels
      // and pairs the controls fill the top, so Home goes just below them.
      if (layout.kind === "wall") return null;
      const f = frame;
      const margin = 28 * f.unit;
      const y = (layout.diagram.y + 20) * f.unit;
      return { x: f.width - size - margin, y };
    },
    status() {
      const d = owned();
      let mean = 0;
      for (const c of cars) mean += c.v;
      mean = cars.length ? mean / cars.length : 0;
      const s = settingsNow();
      return {
        mode,
        cars: s?.count ?? cars.length,
        speed: Math.round(mean * 3.6),
        jams: d ? jams(d.ring) : 0,
        flow: d ? d.flow() : 0,
        brakes,
        host: mode === "bank" ? (link?.hosting ? "this frame" : (link?.host ?? "none")) : "own",
      };
    },
    dispose() {
      loop.stop();
      offResize();
      for (const off of offs) off();
      lagged.dispose();
      bots?.dispose();
      link?.dispose();
      ownFeed.clear();
      diagram.dispose();
      scene.dispose();
      holds.clear();
      pressedCars.clear();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
