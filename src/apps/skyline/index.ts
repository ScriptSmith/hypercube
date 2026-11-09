/**
 * Crane Skyline. Wires the pieces together:
 *
 * - crane.ts      one crane and its site (servos, swinging load, yard, lots, loose blocks)
 * - blueprints.ts the building outlines; mechanics.ts the servo and pendulum maths
 * - pilot.ts      the autopilot; bots.ts the same plan on injected touches
 * - layout.ts     where everything goes; controls.ts touches on the pads and buttons
 * - view.ts       a frame's picture (scene.ts, art.ts); sky.ts the day and night
 * - link.ts, wire.ts, model.ts  a bank: frames below, the screen above (screen.ts)
 *
 * Solo frames simulate their own cranes. On a bank each touch frame's cranes live on the
 * screen: the frame sends its pads, release presses and blocks up, and shows what the screen
 * says. A frame that stops hearing the screen builds on its own until it comes back.
 */
import { createRng } from "../../core/rng";
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { createBot, type Bot } from "./bots";
import { AUTO_AFTER_MS, FEED_QUIET_MS, HZ, KIND, readConfig, SELF_FEED_MS } from "./config";
import { createControls, type Who } from "./controls";
import { type Crane, createCrane } from "./crane";
import { layoutFor, type Layout, type LayoutInput, toVenue } from "./layout";
import { createUplink, type Uplink } from "./link";
import { type Driver, padFromCrane, padFromRemote, type PadModel, readoutFromState } from "./model";
import { createPilot, type Pilot } from "./pilot";
import { mountScreen } from "./screen";
import { createSkyLayer, phaseAt } from "./sky";
import { createFrameView, type FrameCrane, type Rider } from "./view";

/** Seconds a sent block takes to ride a bank frame's lift out of its top edge. */
export const BANK_LIFT_S = 2.8;
/** A bank frame waits this long for its screen before building on its own. */
const BOOT_WAIT_MS = 4000;
const PAD_SEND_MS = 66;
const PAD_HEARTBEAT_MS = 1000;
const EXIT_HEARTBEAT_MS = 3000;
/** A block sent counts against the yard's room until the screen's word catches up. */
const SENT_HOLD_MS = 1200;
const MAX_RIDERS = 3;
const GHOST_PRESS_S = 0.7;

interface CraneCtl {
  /** Last touches on this crane's controls by a person and by a bot (ms). */
  lastHuman: number;
  lastBot: number;
  /** Last block a person sent, for the attract feed's pause. */
  lastSend: number;
  feedAt: number;
  ghostPress: { kind: number; t: number } | null;
  /** Bank: the pad's aim to send, and what was sent. */
  out: { x: number; y: number; held: boolean; who: Who; dirty: boolean; at: number };
  riders: Rider[];
  sentAt: number[];
}

const KEY = "hc:skyline:best";

const loadBest = (key: string): number => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const v = JSON.parse(raw) as { day?: string; n?: number };
    return v.day === new Date().toDateString() && typeof v.n === "number" ? v.n : 0;
  } catch {
    return 0;
  }
};
const saveBest = (key: string, n: number) => {
  try {
    localStorage.setItem(key, JSON.stringify({ day: new Date().toDateString(), n }));
  } catch {
    // Storage can be unavailable; the marker just starts afresh.
  }
};

export const mount = (ctx: AppContext): AppInstance => {
  if (ctx.frame.kind === "screen" || ctx.setup.role === "screen") return mountScreen(ctx);
  const config = readConfig(ctx.variant, ctx.options);
  const setup = ctx.setup;
  const inBank =
    setup.name === "bank" &&
    setup.role !== "solo" &&
    (ctx.frame.kind === "panel" || ctx.frame.kind === "pair");
  let frame: FrameInfo = ctx.frame;
  const inputOf = (f: FrameInfo): LayoutInput => {
    const u = f.unit;
    return {
      kind: f.kind,
      width: f.width / u,
      height: f.height / u,
      reachTop: { adult: f.reachTop.adult / u, child: f.reachTop.child / u },
      seams: f.seams.map((s) => s / u),
      cranes: config.cranes,
      variant: config.variant,
    };
  };
  let layout: Layout = layoutFor(inputOf(frame));
  const n = layout.cranes.length;
  const palette = ctx.ui.palette.players;
  // On a bank, colours follow the screen's crane order, one crane per panel.
  const span = ctx.frame.kind === "pair" ? n : 1;
  const colorOf = (i: number) => palette[((inBank ? setup.pos * span : 0) + i) % palette.length]!;
  const base = ctx.rng().fork(inBank ? `skyline:${setup.pos}` : "skyline");
  const now = () => performance.now();
  const bestKey = (i: number) => `${KEY}:${ctx.identity.frame ?? ctx.frame.kind}:${i}`;

  const sky = createSkyLayer(ctx.root, createRng(`${ctx.seed}:sky`).next);
  const view = createFrameView(ctx.root, createRng(`${ctx.seed}:view`).next);
  view.setup(frame, layout);
  const resizeSky = () =>
    sky.resize(frame.width, frame.height, layout.ground * frame.unit, frame.unit);
  resizeSky();

  // ---- Cranes simulated here (solo, or a bank frame on its own) ----------------------------

  let sims: Crane[] | null = null;
  /** Each crane's best tower as last saved, so storage is touched only when it grows. */
  const savedBest: number[] = [];
  let simGen = 0;
  const makeSims = () => {
    simGen++;
    sims = layout.cranes.map((c, i) => {
      const crane = createCrane({
        world: c.world,
        variant: config.variant,
        assist: config.assist,
        wind: config.wind,
        rng: base.fork(`crane:${i}:${simGen}`),
      });
      crane.best = loadBest(bestKey(i));
      savedBest[i] = crane.best;
      return crane;
    });
  };

  const ctl: CraneCtl[] = layout.cranes.map(() => ({
    lastHuman: Number.NEGATIVE_INFINITY,
    lastBot: Number.NEGATIVE_INFINITY,
    lastSend: Number.NEGATIVE_INFINITY,
    feedAt: now() + 3000,
    ghostPress: null,
    out: { x: 0.5, y: 0.5, held: false, who: "person", dirty: false, at: 0 },
    riders: [],
    sentAt: [],
  }));

  const autos: Pilot[] = layout.cranes.map((_, i) =>
    createPilot({
      rng: base.fork(`auto:${i}`),
      hand: {
        aim: (x, y) => sims?.[i]?.setTargetNorm(x, y),
        release: () => sims?.[i]?.release(),
        rest: () => {},
      },
    }),
  );

  const botCount = Math.min(n, Math.max(0, Math.round(ctx.bots)));
  const bots: Bot[] = Array.from({ length: botCount }, (_, i) =>
    createBot({
      input: ctx.input,
      crane: i,
      layout: () => layout.cranes[i],
      unit: () => frame.unit,
      rng: base.fork(`bot:${i}`),
    }),
  );

  // ---- Bank --------------------------------------------------------------------------------

  const uplink: Uplink | null = inBank ? createUplink(ctx.net, setup.side ?? 0, now) : null;
  let mode: "solo" | "bank" = inBank ? "bank" : "solo";
  const mountedAt = now();
  let toldScreen: string | null = null;
  let toldAt = Number.NEGATIVE_INFINITY;
  let nextRider = 1;
  if (!inBank) makeSims();

  const roomOf = (i: number): number => {
    const t = now();
    const c = ctl[i]!;
    if (mode === "solo") return sims?.[i] ? (sims[i]!.canRequest() ? 1 : 0) : 0;
    const st = uplink?.state(i);
    if (!st) return 0;
    while (c.sentAt.length > 0 && t - c.sentAt[0]! > SENT_HOLD_MS) c.sentAt.shift();
    return st.fr - c.riders.length - c.sentAt.length;
  };

  const driverOf = (i: number): Driver => {
    const c = ctl[i]!;
    const t = now();
    if (t - c.lastHuman < AUTO_AFTER_MS) return "person";
    if (t - c.lastBot < AUTO_AFTER_MS) return "bot";
    return "auto";
  };

  // ---- Controls ----------------------------------------------------------------------------

  const touched = (i: number, who: Who) => {
    const c = ctl[i];
    if (!c) return;
    if (who === "person") c.lastHuman = now();
    else c.lastBot = now();
    autos[i]?.reset();
  };

  const sendBlock = (i: number, kind: number, who: Who, ghost = false): boolean => {
    const c = ctl[i];
    if (!c) return false;
    if (who === "person" && !ghost) c.lastSend = now();
    if (mode === "solo") return sims?.[i]?.request(kind) ?? false;
    if (roomOf(i) <= 0 || c.riders.length >= MAX_RIDERS) return false;
    c.riders.push({ id: nextRider++, kind, t: 0, human: who === "person" && !ghost });
    return true;
  };

  const controls = createControls(layout, {
    aim(i, x, y, who) {
      touched(i, who);
      const c = ctl[i]!;
      if (mode === "solo") sims?.[i]?.setTargetNorm(x, y);
      c.out = { x, y, held: true, who, dirty: true, at: c.out.at };
    },
    lift(i, who) {
      const c = ctl[i]!;
      c.out = { ...c.out, held: false, who, dirty: false };
      if (mode === "bank") {
        uplink?.pad({ c: i, x: c.out.x * 1000, y: c.out.y * 1000, h: 0, b: who === "bot" ? 1 : 0 });
      }
    },
    release(i, who) {
      touched(i, who);
      if (mode === "solo") sims?.[i]?.release();
      else uplink?.release(i, who === "bot");
    },
    send(i, kind, who) {
      // Sending a block doesn't take the crane: the autopilot keeps building with it.
      sendBlock(i, kind, who);
    },
  });

  const venueOf = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venueOf(p);
      controls.down(p.id, v.x, v.y, p.synthetic ? "bot" : "person", now());
    }),
    ctx.input.on("move", (p) => {
      const v = venueOf(p);
      controls.move(p.id, v.x, v.y);
    }),
    ctx.input.on("up", (p) => controls.up(p.id)),
    ctx.input.on("cancel", (p) => controls.up(p.id)),
  ];

  // ---- Mode changes on a bank --------------------------------------------------------------

  const enterSolo = () => {
    mode = "solo";
    makeSims();
    ctl.forEach((c, i) => {
      // Blocks on their way up land in this frame's own yard instead.
      for (const r of c.riders) sims?.[i]?.request(r.kind);
      c.riders.length = 0;
      c.sentAt.length = 0;
    });
    for (const a of autos) a.reset();
    for (const b of bots) b.release();
    toldScreen = null;
  };
  const enterBank = () => {
    mode = "bank";
    sims = null;
    for (const a of autos) a.reset();
    for (const b of bots) b.release();
  };

  const tellExits = (t: number) => {
    if (!uplink) return;
    const screen = uplink.screen();
    if (!screen) return;
    if (screen === toldScreen && t - toldAt < EXIT_HEARTBEAT_MS) return;
    const W = layout.width;
    layout.cranes.forEach((c, i) => {
      uplink.exit({ c: i, u: (c.lift.x / W) * 1000, w: (c.lift.width / W) * 1000 });
    });
    toldScreen = screen;
    toldAt = t;
  };

  // ---- Effects -----------------------------------------------------------------------------

  const fx = createRng(`${ctx.seed}:fx`);
  const effects = (i: number, crane: Crane) => {
    const c = layout.cranes[i];
    if (!c) {
      crane.events.length = 0;
      return;
    }
    const sc = c.scene;
    for (const e of crane.events) {
      if (e.type === "placed") {
        const p = toVenue(sc, e.x, e.y - 0.35);
        view.particles.burst(
          p.x,
          p.y,
          { n: 6, speed: 0.9 * sc.s, size: 0.05 * sc.s, colors: ["#e8e2d4"], fall: 1.5 * sc.s },
          fx.next,
        );
      } else if (e.type === "finished") {
        const lot = crane.lots[e.lot];
        if (lot) {
          for (let j = 0; j < 4; j++) {
            const p = toVenue(
              sc,
              lot.left + fx.next() * lot.bp.cols,
              lot.bp.rows * 0.7 * (0.4 + 0.6 * fx.next()),
            );
            view.particles.burst(
              p.x,
              p.y,
              {
                n: 14,
                speed: 2.4 * sc.s,
                size: 0.06 * sc.s,
                colors: [colorOf(i), "#ffffff", "#ffd581"],
                fall: 1.2 * sc.s,
                up: 0.8 * sc.s,
              },
              fx.next,
            );
          }
        }
      } else if (e.type === "capped") {
        const t = crane.tower;
        if (t) {
          const p = toVenue(sc, t.x, t.blocks.length * 0.7);
          view.particles.burst(
            p.x,
            p.y,
            {
              n: 40,
              speed: 3 * sc.s,
              size: 0.07 * sc.s,
              colors: [colorOf(i), "#ffffff", "#ffd581"],
              fall: 1.2 * sc.s,
              up: 1 * sc.s,
            },
            fx.next,
          );
        }
      } else if (e.type === "landed" && e.hard) {
        const p = toVenue(sc, e.x, 0);
        view.particles.burst(
          p.x,
          p.y,
          {
            n: 8,
            speed: 1.2 * sc.s,
            size: 0.06 * sc.s,
            colors: ["#9aa3b5"],
            fall: 2 * sc.s,
            up: 0.6 * sc.s,
          },
          fx.next,
        );
      }
    }
    crane.events.length = 0;
    if (crane.tower && crane.best > 0) {
      const key = bestKey(i);
      if (crane.best > (savedBest[i] ?? 0)) {
        savedBest[i] = crane.best;
        saveBest(key, crane.best);
      }
    }
  };

  // ---- Loop --------------------------------------------------------------------------------

  let disposed = false;
  let simSeconds = 0;
  let lastRender = now();

  const update = (dt: number) => {
    const t = now();
    simSeconds += dt;
    if (uplink) {
      const screen = uplink.screen();
      if (mode === "bank" && !screen && t - mountedAt > BOOT_WAIT_MS) enterSolo();
      else if (mode === "solo" && screen && uplink.state(0)) enterBank();
      if (mode === "bank") tellExits(t);
    }
    layout.cranes.forEach((_, i) => {
      const c = ctl[i]!;
      // The attract feed: now and then a ghost hand sends a block, while nobody else does.
      if (c.ghostPress) {
        c.ghostPress.t += dt / GHOST_PRESS_S;
        if (c.ghostPress.t >= 0.5 && c.ghostPress.t - dt / GHOST_PRESS_S < 0.5) {
          sendBlock(i, c.ghostPress.kind, "person", true);
        }
        if (c.ghostPress.t >= 1) c.ghostPress = null;
      } else if (t >= c.feedAt) {
        c.feedAt = t + SELF_FEED_MS * (0.8 + 0.4 * fx.next());
        const quiet = t - c.lastSend > FEED_QUIET_MS && t - c.lastHuman > FEED_QUIET_MS;
        if (quiet && roomOf(i) > 0 && botCount <= i) {
          // Mostly floors: a roof only fits once a building reaches its top.
          const kinds = layout.cranes[i]!.buttons.map((b) => b.kind);
          const floors = kinds.filter((kd) => kd !== KIND.roof);
          const pool = fx.next() < 0.15 || floors.length === 0 ? kinds : floors;
          if (pool.length > 0) c.ghostPress = { kind: fx.pick(pool), t: 0 };
        }
      }
      if (mode === "solo") {
        const crane = sims?.[i];
        if (!crane) return;
        if (driverOf(i) === "auto") autos[i]!.update(dt, crane.readout());
        crane.step(dt);
        effects(i, crane);
        return;
      }
      // Bank: blocks ride the lift, and the pad's aim goes up.
      for (let j = c.riders.length - 1; j >= 0; j--) {
        const r = c.riders[j]!;
        r.t += dt / BANK_LIFT_S;
        if (r.t < 1) continue;
        c.riders.splice(j, 1);
        const human = r.human ? 1 : 0;
        if (uplink?.block({ c: i, k: r.kind, h: human })) c.sentAt.push(t);
      }
      const o = c.out;
      if (o.held && (o.dirty ? t - o.at >= PAD_SEND_MS : t - o.at >= PAD_HEARTBEAT_MS)) {
        if (uplink?.pad({ c: i, x: o.x * 1000, y: o.y * 1000, h: 1, b: o.who === "bot" ? 1 : 0 })) {
          o.dirty = false;
          o.at = t;
        }
      }
    });
    for (const b of bots) {
      const i = b.crane;
      const readout =
        mode === "solo"
          ? (sims?.[i]?.readout() ?? null)
          : (() => {
              const st = uplink?.state(i);
              return st ? readoutFromState(st) : null;
            })();
      b.update(dt, now(), { readout, room: roomOf(i), lastHuman: ctl[i]!.lastHuman });
    }
  };

  const padModel = (i: number): PadModel | null => {
    if (mode === "solo") {
      const crane = sims?.[i];
      return crane ? padFromCrane(crane, driverOf(i), config.assist) : null;
    }
    const st = uplink?.state(i);
    return st ? padFromRemote(st, uplink?.geo(i) ?? null, roomOf(i)) : null;
  };

  /** Debug only: simulation steps per tick, so tests can watch a building go up quickly. */
  let speed = 1;
  let phaseOverride: number | null = null;
  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      for (let i = 0; i < speed; i++) update(dt);
    },
    render() {
      if (disposed) return;
      const t = now();
      const dt = Math.min(0.1, (t - lastRender) / 1000);
      lastRender = t;
      const phase = phaseOverride ?? phaseAt(ctx.clock.now());
      const colours = sky.update(dt, phase, sims?.[0]?.wind ?? 0);
      const cranes: FrameCrane[] = layout.cranes.map((_, i) => {
        const pad = padModel(i);
        const holder = controls.holder(i);
        const driving = mode === "solo" ? driverOf(i) : (pad?.driver ?? "auto");
        const auto = autos[i]!;
        let ghost = null;
        if (mode === "solo" && driving === "auto" && auto.aim) ghost = auto.aim;
        else if (mode === "bank" && pad?.driver === "auto" && holder === null && pad)
          ghost = pad.target;
        const geo = mode === "bank" ? uplink?.geo(i) : null;
        return {
          color: colorOf(i),
          sim: mode === "solo" ? (sims?.[i] ?? null) : null,
          pad,
          riders: ctl[i]!.riders,
          ghost,
          ghostPress: ctl[i]!.ghostPress,
          mast: geo ? { u: geo.mu / 1000, w: geo.mw / 1000 } : null,
          held: holder !== null,
        };
      });
      view.draw({
        mode,
        cranes,
        t: t / 1000,
        dt,
        night: colours.night,
        assist: config.assist,
        pressed: controls.pressed,
        released: controls.releasedAt,
        now: t,
      });
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    layout = layoutFor(inputOf(f));
    controls.setLayout(layout);
    view.setup(frame, layout);
    resizeSky();
    // The worlds change with the layout; cranes start afresh in them.
    if (mode === "solo") makeSims();
    for (const a of autos) a.reset();
    for (const b of bots) b.release();
  });

  const resetAll = () => {
    for (const c of ctl) {
      c.lastHuman = Number.NEGATIVE_INFINITY;
      c.lastBot = Number.NEGATIVE_INFINITY;
      c.ghostPress = null;
      c.out.held = false;
    }
    for (const a of autos) a.reset();
    for (const b of bots) b.release();
    controls.clear();
    view.particles.clear();
  };

  const command = (name: string) => {
    if (name === "clear") for (const s of sims ?? []) s.clear();
    else if (name === "reset") resetAll();
  };

  const debugKey = "__skyline";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          mode,
          unit: frame.unit,
          sim: simSeconds,
          screenId: uplink?.screen() ?? null,
          sent: uplink?.sent ?? 0,
          layout: {
            width: layout.width,
            height: layout.height,
            ground: layout.ground,
            cranes: layout.cranes.map((c) => ({
              pad: c.pad,
              release: c.release,
              buttons: c.buttons,
              lift: c.lift,
              lane: c.lane,
              scene: c.scene,
            })),
          },
          cranes: layout.cranes.map((_, i) => {
            const s = sims?.[i] ?? null;
            const pad = padModel(i);
            return {
              driver: mode === "solo" ? driverOf(i) : (pad?.driver ?? null),
              pilot: autos[i]!.phase,
              bot: bots.find((b) => b.crane === i)?.pilot.stats ?? null,
              riders: ctl[i]!.riders.map((r) => ({ kind: r.kind, t: r.t })),
              pad: pad
                ? {
                    hook: pad.hook,
                    target: pad.target,
                    carrying: pad.carrying,
                    room: pad.room,
                    slots: pad.slots.length,
                    filled: pad.slots.filter((x) => x.kind >= 0).length,
                    yard: pad.yard.filter((y) => y.kind >= 0).length,
                  }
                : null,
              sim: s
                ? {
                    trolley: s.trolley.x,
                    hook: s.hook(),
                    target: { ...s.target },
                    carrying: s.carrying?.kind ?? -1,
                    counts: { ...s.counts },
                    yard: s.yard.map((b) => b?.kind ?? -1),
                    riders: s.riders.length,
                    loose: s.loose.length,
                    lots: s.lots.map((l) => ({
                      shape: l.bp.shape,
                      phase: l.phase,
                      slots: l.bp.slots.length,
                      filled: l.filled.filter((f) => f !== null).length,
                    })),
                    tower: s.tower
                      ? { floors: s.tower.blocks.length, phase: s.tower.phase, best: s.best }
                      : null,
                    world: s.world,
                    readout: s.readout(),
                  }
                : null,
            };
          }),
          particles: view.particles.list.length,
        }),
        command,
        speed: (k: number) => {
          speed = Math.max(1, Math.min(20, Math.round(k)));
        },
        /** Hold the sky at a time of day (0..1, null to follow the clock). */
        phase: (p: number | null) => {
          phaseOverride = p;
        },
      },
    });
  }

  return {
    reset() {
      resetAll();
    },
    attract() {},
    status() {
      const sum = (k: "placed" | "finished" | "dropped") =>
        (sims ?? []).reduce((acc, s) => acc + s.counts[k], 0);
      return {
        cranes: n,
        mode,
        placed: sum("placed"),
        finished: sum("finished"),
        drivers: layout.cranes.map((_, i) => driverOf(i)[0]).join(""),
        yard: (sims ?? []).map((s) => s.yard.filter(Boolean).length).join(","),
        ...(uplink ? { screen: uplink.screen() !== null, sent: uplink.sent } : {}),
      };
    },
    command(name) {
      command(name);
    },
    homeSpot(size) {
      const h = layout.home;
      const u = frame.unit;
      return { x: Math.min(frame.width - size, h.x * u), y: Math.max(0, h.y * u) };
    },
    dispose() {
      disposed = true;
      loop.stop();
      offResize();
      for (const off of offs) off();
      for (const b of bots) b.dispose();
      uplink?.dispose();
      controls.clear();
      view.dispose();
      sky.dispose();
      sims = null;
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
