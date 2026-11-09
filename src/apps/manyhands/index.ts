/**
 * Many Hands. Every touch frame is a workstation of quick tasks; each finished task makes a part
 * for a group build. The pieces:
 *
 * - layout.ts    workstations, slots and the build area from the frame's size and reach
 * - slot.ts      one slot: deals tasks, takes touches, plays bots and the attract ghost
 * - tasks/       the tasks, one module each (library.ts lists them)
 * - themes.ts    each build's picture split into slots; build.ts and foreman.ts run builds
 * - art.ts, scene.ts, frameview.ts   drawing
 * - link.ts, wire.ts                 a bank's messages; screen.ts the screen above a bank
 *
 * A frame on its own runs its own build. In a bank each touch frame sends its parts to the
 * screen above, which runs the build; a panel that loses its screen runs its own until it is back.
 */
import type { AppContext, AppInstance, FrameInfo, OptionValue, Pointer } from "../../core/types";
import {
  type Config,
  EXIT_SPEED,
  LOCAL_FLY_MS,
  MADE_MS,
  readConfig,
  type ThemeId,
  ACTIVE_MS,
  WORKING_MS,
} from "./config";
import { createForeman, type Foreman } from "./foreman";
import { createFrameView, type Exit, type FrameView, type Pop } from "./frameview";
import { layoutFor, type Layout, type LayoutInput, slotsOf } from "./layout";
import { createUplink, type Uplink } from "./link";
import { mountScreen } from "./screen";
import { createSlot, type Slot, type Who } from "./slot";
import type { TaskId } from "./tasks/common";
import { tasksFor } from "./tasks/library";
import { createSequence } from "./wire";
import { filledCount, madeCount } from "./build";

const MAX_POPS = 32;
const MAX_EXITS = 32;
/** A bank panel that has never heard its screen makes its own build after this long. */
const FIRST_SCREEN_MS = 3000;
const BOT_COLOR = "#ffffff";

export type Mode = "solo" | "screen" | "local";

export const mount = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  if (ctx.frame.kind === "screen" || ctx.setup.role === "screen") return mountScreen(ctx, config);
  return mountFrame(ctx, config);
};

const inputOf = (f: FrameInfo, config: Config): LayoutInput => {
  const u = f.unit;
  const H = f.height / u;
  // Kiosks aren't a declared kind; if one is pushed here it gets two wall-style stations.
  const kiosk = f.kind === "kiosk";
  return {
    kind: kiosk ? "wall" : f.kind,
    width: f.width / u,
    height: H,
    reachTop: kiosk
      ? { adult: H * 0.12, child: H * 0.5 }
      : { adult: f.reachTop.adult / u, child: f.reachTop.child / u },
    seams: f.seams.map((s) => s / u),
    span: f.kind === "pair" ? Math.max(2, f.span ?? 2) : 1,
    stations: kiosk ? 2 : config.stations,
    slots: config.slots,
  };
};

const mountFrame = (ctx: AppContext, config: Config): AppInstance => {
  let frame = ctx.frame;
  let layout: Layout = layoutFor(inputOf(frame, config));
  const setup = ctx.setup;
  const inBank = setup.name === "bank" && (frame.kind === "panel" || frame.kind === "pair");
  const players = ctx.ui.palette.players;
  const colorIndex = (station: number) =>
    ((inBank ? setup.pos * layout.stations.length : 0) + station) % players.length;
  const colorOf = (station: number) => players[colorIndex(station)] ?? "#6fa4fc";
  const clock = () => ctx.clock.now();
  const seq = createSequence();
  const view: FrameView = createFrameView(ctx.root, { players }, String(ctx.seed));
  const uplink: Uplink | null = inBank
    ? createUplink(ctx.net, setup.side ?? 0, () => performance.now())
    : null;

  let mode: Mode = inBank ? "screen" : "solo";
  let modeAt = Date.now();
  const mountedAt = performance.now();
  let heardScreen = false;
  let foreman: Foreman | null = null;
  let slots: Slot[] = [];
  let slotStation: number[] = [];
  let resetButtons: HTMLElement[] = [];
  let lastPart: number[] = [];
  const pops: Pop[] = [];
  const exits: Exit[] = [];
  const owners = new Map<number, Slot>();
  const sent: { i: number; t: number; at: number; clock: number }[] = [];
  const counts = { person: 0, bot: 0, ghost: 0 };
  let day = new Date().toDateString();
  let disposed = false;
  let backTheme: ThemeId | null = null;

  const cover = () => {
    const now = performance.now();
    return {
      columns: layout.stations.length,
      working: (c: number) => now - (lastPart[c] ?? Number.NEGATIVE_INFINITY) < WORKING_MS,
      active: slots.filter((s) => now - s.lastActive < ACTIVE_MS).length,
    };
  };

  const startLocal = () => {
    foreman = createForeman({
      round: config.round,
      theme: config.theme,
      first: setup.pos,
      now: clock(),
      cover: cover(),
    });
  };

  const remoteBuild = () => (mode === "screen" ? (uplink?.build ?? null) : null);

  const currentTheme = (): ThemeId =>
    foreman?.build.theme ??
    remoteBuild()?.theme ??
    (config.theme === "rotate" ? "rocket" : config.theme);

  const orderOf = (station: number): number => {
    if (foreman) return foreman.orders[station] ?? -1;
    const b = remoteBuild();
    if (!b) return -1;
    return b.orders[setup.pos * layout.stations.length + station] ?? -1;
  };

  const syncBack = () => {
    const th = foreman ? foreman.build.theme : null;
    if (th !== backTheme) {
      backTheme = th;
      view.back(th);
    }
  };

  const setMode = (next: Mode) => {
    if (next === mode) return;
    mode = next;
    modeAt = Date.now();
    ctx.log(`mode ${next}`);
    if (next === "local") startLocal();
    else if (next === "screen") foreman = null;
    syncBack();
  };

  const finished = (i: number, station: number, who: Who) => {
    const slot = slots[i];
    if (!slot || disposed) return;
    const now = performance.now();
    const theme = currentTheme();
    const order = orderOf(station);
    const kind = order >= 0 ? order : 0;
    const color = who === "person" ? colorOf(station) : BOT_COLOR;
    pops.push({ slot: i, kind, theme, color, at: now, practice: who === "ghost" });
    while (pops.length > MAX_POPS) pops.shift();
    counts[who]++;
    if (who === "ghost") return;
    lastPart[station] = now;
    const t = slot.spec.task;
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    if (mode === "screen") {
      const rise = ((2 * cy) / EXIT_SPEED) * 1000;
      exits.push({
        kind,
        theme,
        color,
        x: cx,
        y0: cy,
        departAt: now + MADE_MS,
        exitAt: now + MADE_MS + rise,
      });
      while (exits.length > MAX_EXITS) exits.shift();
      const msg = {
        i: seq(),
        p: Math.max(0, setup.pos),
        w: station,
        l: slot.spec.band === "low" ? 0 : 1,
        k: kind,
        b: remoteBuild()?.id ?? 0,
        c: who === "person" ? colorIndex(station) : -1,
        u: cx / layout.width,
        t: clock() + MADE_MS + rise,
      };
      if (uplink?.sendPart(msg)) {
        sent.push({ i: msg.i, t: msg.t, at: Date.now(), clock: clock() });
        while (sent.length > 32) sent.shift();
      }
      return;
    }
    if (foreman) {
      const area = layout.top;
      const c0 = clock();
      foreman.deliver(
        {
          kind,
          maker: who,
          color: colorIndex(station),
          column: station,
          departAt: c0 + MADE_MS,
          arriveAt: c0 + MADE_MS + LOCAL_FLY_MS,
          sx: (cx - area.x) / area.w,
          sy: (cy - area.y) / area.h,
        },
        c0,
      );
    }
  };

  const buildSlots = () => {
    for (const s of slots) s.dispose();
    for (const b of resetButtons) b.remove();
    owners.clear();
    const specs = slotsOf(layout);
    lastPart = layout.stations.map(() => Number.NEGATIVE_INFINITY);
    slotStation = specs.map((s) => s.station);
    slots = specs.map(({ station, spec }, i) => {
      const at = (x: number, y: number): [number, number] => [
        (spec.task.x + x) * frame.unit,
        (spec.task.y + y) * frame.unit,
      ];
      return createSlot({
        spec,
        defs: tasksFor(spec.band, config.variant),
        rng: ctx.rng(`slot:${setup.pos}:${station}:${spec.band}`),
        color: colorOf(station),
        bot: i < ctx.bots,
        sink: {
          down: (x, y) => ctx.input.inject.down(...at(x, y)),
          move: (id, x, y) => ctx.input.inject.move(id, ...at(x, y)),
          up: (id) => ctx.input.inject.up(id),
        },
        onDone: (who) => finished(i, station, who),
      });
    });
    const u = frame.unit;
    resetButtons = slots.map((slot) => {
      const r = slot.spec.reset;
      return ctx.ui.button({
        icon: "reset",
        rect: { x: (r.x - r.r) * u, y: (r.y - r.r) * u, width: 2 * r.r * u, height: 2 * r.r * u },
        hold: 1000,
        look: "ghost",
        color: "#c9d3ea",
        onPress: () => slot.deal(performance.now(), true),
      });
    });
  };

  const setupView = () => {
    view.setup(
      frame,
      layout,
      layout.stations.map((s) => colorOf(s.index)),
    );
    backTheme = null;
    syncBack();
  };

  if (mode === "solo") startLocal();
  buildSlots();
  setupView();

  // ---- Input --------------------------------------------------------------------------------

  const venue = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venue(p);
      const now = performance.now();
      for (const s of slots) {
        if (s.down(p.id, v.x, v.y, p.synthetic, now)) {
          owners.set(p.id, s);
          return;
        }
      }
    }),
    ctx.input.on("move", (p) => {
      const s = owners.get(p.id);
      if (!s) return;
      const v = venue(p);
      s.move(p.id, v.x, v.y);
    }),
    ctx.input.on("up", (p) => {
      owners.get(p.id)?.up(p.id);
      owners.delete(p.id);
    }),
    ctx.input.on("cancel", (p) => {
      owners.get(p.id)?.up(p.id);
      owners.delete(p.id);
    }),
  ];

  // ---- Loop ---------------------------------------------------------------------------------

  const beat = () => {
    const now = performance.now();
    let mask = 0;
    lastPart.forEach((t, i) => {
      if (now - t < WORKING_MS) mask |= 1 << i;
    });
    return {
      p: Math.max(0, setup.pos),
      s: layout.stations.length,
      a: slots.filter((s) => now - s.lastActive < ACTIVE_MS).length,
      g: mask,
    };
  };

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      if (disposed) return;
      const now = performance.now();
      const today = new Date().toDateString();
      if (today !== day) {
        day = today;
        counts.person = 0;
        counts.bot = 0;
        counts.ghost = 0;
        foreman?.resetTotals();
      }
      if (uplink) {
        const screen = uplink.screen();
        if (screen) heardScreen = true;
        if (screen) setMode("screen");
        else if (mode === "screen" && (heardScreen || now - mountedAt > FIRST_SCREEN_MS)) {
          setMode("local");
        }
        if (mode === "screen") uplink.tick(beat);
      }
      for (const s of slots) s.update(dt, now);
      if (foreman) {
        foreman.update(clock(), cover());
        for (const e of foreman.takeEvents()) {
          if (e.type === "start") syncBack();
          else if (e.type === "alive") view.celebrate(e.early, now, e.id);
        }
      }
    },
    render() {
      if (disposed) return;
      const now = performance.now();
      while (exits.length > 0 && now - exits[0]!.exitAt > 3000) exits.shift();
      while (pops.length > 0 && now - pops[0]!.at > 3000) pops.shift();
      const rb = remoteBuild();
      view.draw({
        layout,
        slots,
        slotStation,
        stations: layout.stations.map((s) => ({
          color: colorOf(s.index),
          order: orderOf(s.index),
        })),
        pops,
        exits,
        local: foreman ? { build: foreman.build, trophies: foreman.trophies } : null,
        remote: rb
          ? {
              theme: rb.theme,
              made: rb.made,
              total: rb.total,
              start: rb.start,
              end: rb.end,
              phase: rb.phase,
            }
          : null,
        clock: clock(),
        now,
        time: now / 1000,
        ghosts: true,
      });
    },
  });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    const next = layoutFor(inputOf(f, config));
    const same =
      Math.abs(next.width - layout.width) < 2 && Math.abs(next.height - layout.height) < 2;
    layout = next;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      if (!same) buildSlots();
      else {
        // Same venue size: only the reset buttons' stage positions change.
        const u = frame.unit;
        resetButtons.forEach((b, i) => {
          const r = slots[i]?.spec.reset;
          if (!r) return;
          b.style.left = `${(r.x - r.r) * u}px`;
          b.style.top = `${(r.y - r.r) * u}px`;
          b.style.width = `${2 * r.r * u}px`;
          b.style.height = `${2 * r.r * u}px`;
        });
      }
      setupView();
    }, 150);
    setupView();
  });

  const command = (name: string) => {
    if (name === "next") foreman?.finish(clock());
  };

  const status = (): Record<string, OptionValue> => {
    const b = foreman?.build;
    const rb = remoteBuild();
    const totals = foreman?.totals;
    return {
      mode,
      theme: b?.theme ?? rb?.theme ?? "",
      filled: b ? filledCount(b) : (rb?.made ?? 0),
      total: b?.slots.length ?? rb?.total ?? 0,
      builds: totals?.builds ?? 0,
      people: counts.person,
      bots: counts.bot,
      helpers: totals?.helper ?? 0,
    };
  };

  const debugKey = "__manyhands";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const b = foreman?.build ?? null;
          const rb = remoteBuild();
          return {
            screen: false,
            mode,
            modeAt,
            unit: frame.unit,
            width: layout.width,
            height: layout.height,
            top: layout.top,
            home: layout.home,
            stations: layout.stations.map((s) => ({
              index: s.index,
              order: orderOf(s.index),
              color: colorOf(s.index),
              low: s.low.rect,
              high: s.high?.rect ?? null,
            })),
            slots: slots.map((s, i) => ({
              station: slotStation[i],
              band: s.spec.band,
              task: s.taskId,
              phase: s.phase,
              who: s.who,
              progress: s.task.progress,
              made: s.made,
              rect: s.spec.task,
              reset: s.spec.reset,
            })),
            build: b
              ? {
                  id: b.id,
                  theme: b.theme,
                  phase: b.phase,
                  total: b.slots.length,
                  made: madeCount(b),
                  filled: filledCount(b),
                  people: b.slots.filter((s) => s.maker === "person").length,
                  bots: b.slots.filter((s) => s.maker === "bot").length,
                  trophies: foreman?.trophies ?? 0,
                }
              : null,
            remote: rb,
            sent: [...sent],
            counts: { ...counts },
            clock: clock(),
            totals: foreman ? { ...foreman.totals } : null,
          };
        },
        setLag(ms: number) {
          if (uplink) uplink.lag = ms;
        },
        deal(i: number, id: TaskId) {
          slots[i]?.deal(performance.now(), false, id);
        },
        /** Where a bot would touch slot `i` first right now, frame venue px. */
        target(i: number) {
          const s = slots[i];
          const f = s?.task.bot(1)?.at(0)?.[0];
          return s && f ? { x: s.spec.task.x + f.x, y: s.spec.task.y + f.y } : null;
        },
        command,
      },
    });
  }

  return {
    reset() {
      const now = performance.now();
      for (const s of slots) s.idle(now);
      foreman?.clearTrophies();
    },
    attract() {},
    status,
    command(name) {
      command(name);
    },
    homeSpot(size) {
      const h = layout.home;
      const u = frame.unit;
      return {
        x: Math.round((h.x + h.w / 2) * u - size / 2),
        y: Math.round((h.y + h.h / 2) * u - size / 2),
      };
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      for (const s of slots) s.dispose();
      for (const b of resetButtons) b.remove();
      uplink?.dispose();
      view.dispose();
      owners.clear();
      pops.length = 0;
      exits.length = 0;
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
