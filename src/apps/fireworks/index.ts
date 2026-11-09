import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { createPadBots, type PadBots } from "./bots";
import { type Config, readConfig, SCREEN_GRACE_MS } from "./config";
import { createDirector, type Director, type ShowFit } from "./director";
import { createEngine, type Engine } from "./engine";
import { createClimbView } from "./gpu/climb2d";
import { createRenderer, type Glow, type Renderer, type View } from "./gpu/renderer";
import {
  createDownlink,
  createUplink,
  type Downlink,
  padsOn,
  touchFrameWidth,
  type Uplink,
} from "./link";
import { createPads, type LaunchIntent, type Pads } from "./pad";
import { createPadView, type PadView } from "./padview";
import { layoutPads, mouthOf, type PadFrame, type PadLayout } from "./pads";
import { exitOf, launchMessage, pathOf } from "./launch";
import { positionAt, timeToHeight } from "./path";
import { COLORS, MIXED, type ShapeId } from "./recipe";
import { decodeBurst, decodeShell } from "./wire";
import {
  bankSky,
  burstHeight,
  defaultBankWidth,
  frameRegion,
  localSky,
  NOMINAL_DEPTH,
  type Region,
  screenRegion,
  type Sky,
} from "./sky";

/**
 * The shell leaves the tube this long after the press, while the launch message goes at once:
 * a little ignition that also gives the message more time to reach the screen.
 */
export const IGNITE_MS = 240;
const GLOW_MS = 1700;
const MAX_GLOW_QUEUE = 6;
const UI_HZ = 30;

interface Sizes {
  shells: number;
  bursts: number;
  budget: number;
  density: number;
}

const SIZES: Record<string, Sizes> = {
  screen: { shells: 64, bursts: 96, budget: 64, density: 1 },
  wall: { shells: 48, bursts: 72, budget: 44, density: 0.62 },
  pair: { shells: 24, bursts: 36, budget: 24, density: 0.46 },
  panel: { shells: 16, bursts: 28, budget: 18, density: 0.4 },
};

/** The default panel's pad area top, which is the horizon every frame of a bank shares. */
const horizonFor = (cfg: Config): number => {
  const panel: PadFrame = { kind: "panel", width: 1080, height: 1920, span: 1 };
  return -(layoutPads(panel, cfg)[0]?.top ?? 1210);
};

export const mount = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  const setup = ctx.setup;
  const isScreen = ctx.frame.kind === "screen" || setup.role === "screen";
  const corner = setup.name === "corner";
  const inBank = setup.name === "bank" || corner;
  const side = corner ? setup.side : 0;
  const count = Math.max(1, setup.count);
  const ui = () => performance.now();
  const clock = () => ctx.clock.now();
  const seedText = String(ctx.seed);
  const rng = ctx.rng(`fireworks:${ctx.seed}:${ctx.identity.frame ?? "local"}`);
  const horizon = horizonFor(config);

  const backdrop = document.createElement("div");
  backdrop.style.cssText =
    "position:absolute;inset:0;background:linear-gradient(180deg,#020309 0%,#060914 55%,#0b0f22 100%);";
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;";
  ctx.root.append(backdrop, host);

  let frame: FrameInfo = ctx.frame;
  let disposed = false;
  let sent = 0;
  let received = 0;
  let lag = 0;
  const lagTimers = new Set<number>();
  /** For tests: how late recent launches reached this screen, against when they leave the frame below. */
  const arrivals: { seed: number; late: number; exit: number }[] = [];
  /** For tests: shells and bursts this frame has held lately, so slow polling misses nothing. */
  const history: {
    kind: "shell" | "burst";
    id: number;
    seed: number;
    shared: boolean;
    /** Launched from this frame's own pads. */
    own: boolean;
    x: number;
    y: number;
    t0: number;
  }[] = [];
  const seenUpTo = { shell: 0, burst: 0 };
  const remember = () => {
    let top = seenUpTo.shell;
    for (const s of engine.shells.slots) {
      if (!s.live || s.id <= seenUpTo.shell) continue;
      top = Math.max(top, s.id);
      const own = s.ghost || s.frame === ctx.net.self;
      history.push({
        kind: "shell",
        id: s.id,
        seed: s.seed,
        shared: s.shared,
        own,
        x: s.path.x,
        y: s.path.y,
        t0: s.t0,
      });
    }
    seenUpTo.shell = top;
    top = seenUpTo.burst;
    for (const b of engine.bursts.slots) {
      if (!b.live || b.id <= seenUpTo.burst) continue;
      top = Math.max(top, b.id);
      history.push({
        kind: "burst",
        id: b.id,
        seed: b.seed,
        shared: false,
        own: false,
        x: b.x,
        y: b.y,
        t0: b.t0,
      });
    }
    seenUpTo.burst = top;
    if (history.length > 160) history.splice(0, history.length - 160);
  };

  /**
   * WebGL for every frame with a sky of its own; a light 2D view for a touch frame while its screen
   * is up, since all it shows is shells climbing away.
   */
  type Look = "gl" | "2d";
  const makeRenderer = (look: Look): Renderer => {
    const o = { host, onError: (m: string) => console.error(m) };
    return look === "gl" ? createRenderer(o) : createClimbView(o);
  };
  let look: Look = !isScreen && inBank ? "2d" : "gl";
  let renderer = makeRenderer(look);
  const kindSizes = SIZES[isScreen ? "screen" : frame.kind] ?? SIZES.panel!;
  const soft = () => (renderer.software ? 0.42 : 1);
  const venue = () => ({ w: frame.width / frame.unit, h: frame.height / frame.unit });

  // ---- Screens ------------------------------------------------------------------------------

  let downlink: Downlink | null = null;
  let partner: () => string | null = () => null;
  let screenFw = touchFrameWidth([]);

  const screenGeometry = () => {
    const bankW = inBank ? count * screenFw : defaultBankWidth();
    const xo = corner && side === 0 ? -bankW : 0;
    const v = venue();
    const aspect = v.h / Math.max(1, v.w);
    return {
      bankW,
      xo,
      aspect,
      region: screenRegion(bankW, xo, aspect),
      sky: bankSky(bankW, xo, aspect),
    };
  };

  // ---- Touch frames -------------------------------------------------------------------------

  const fw = () => venue().w;
  const fh = () => venue().h;
  const touchXo = () => (corner && side === 0 ? -count * fw() : 0);
  const touchRegion = (): Region => frameRegion(touchXo(), inBank ? setup.pos : 0, fw(), fh());
  let layouts: PadLayout[] = [];
  let pads: Pads | null = null;
  let padView: PadView | null = null;
  let resetButtons: HTMLElement[] = [];
  let bots: PadBots | null = null;
  let uplink: Uplink | null = null;
  let screenAbove: () => string | null = () => null;
  let mode: "screen" | "local" = isScreen ? "screen" : inBank ? "screen" : "local";
  let screenSince = -Infinity;
  const glows: { u: number; color: number; at: number }[] = [];

  const padFrame = (): PadFrame => ({
    kind: frame.kind,
    width: fw(),
    height: fh(),
    span: frame.span ?? 1,
  });
  const skyBottom = () => (frame.kind === "wall" ? fh() * 0.55 : fh() * 0.5);
  const mouthDepth = () => {
    const p = layouts[0];
    return p ? p.tube.base - p.tube.length : fh() * 0.8;
  };
  const touchLocalSky = (): Sky =>
    localSky(touchRegion(), skyBottom(), mouthDepth(), { wall: frame.kind === "wall" });
  const touchBankSky = (): Sky => bankSky(count * fw(), touchXo());

  // ---- Engine and director ------------------------------------------------------------------

  const engine: Engine = createEngine({
    shells: kindSizes.shells,
    bursts: kindSizes.bursts,
    budget: kindSizes.budget,
    onBurst(s, b) {
      if (!isScreen || !s.frame || !downlink) return;
      downlink.boom(s.frame, { p: s.pad, c: b.color >= MIXED ? MIXED : b.color, u: s.exitU });
    },
  });

  const sky = (): Sky => (isScreen ? screenGeometry().sky : touchLocalSky());
  const fit = (): ShowFit => {
    if (isScreen) {
      const g = screenGeometry();
      return {
        x0: corner ? -g.bankW : g.xo,
        x1: corner ? g.bankW : g.xo + g.bankW,
        launchY: -NOMINAL_DEPTH,
        density: 1,
        maxRank: 99,
        rx0: g.region.x0,
        rx1: g.region.x1,
      };
    }
    const s = touchLocalSky();
    const r = touchRegion();
    const margin = s.rHi * 0.7;
    const thin =
      frame.kind === "panel"
        ? { density: 0.55, maxRank: 1 }
        : frame.kind === "pair"
          ? { density: 0.8, maxRank: 2 }
          : { density: 1, maxRank: 99 };
    return {
      x0: r.x0 + margin,
      x1: r.x1 - margin,
      launchY: -mouthDepth(),
      ...thin,
      rx0: r.x0,
      rx1: r.x1,
    };
  };

  // The downlink's handlers use the director, which needs the downlink for the corner.
  let director: Director | null = null;
  if (isScreen) {
    downlink = createDownlink(
      ctx.net,
      { side, corner, count: () => count, clock, now: ui },
      {
        launch(m, from) {
          received++;
          ctx.idle.poke();
          if (m.fw !== screenFw && inBank) screenFw = m.fw;
          const xo = screenGeometry().xo;
          const path = pathOf(m, xo);
          const exit = exitOf(m, xo);
          if (ctx.debug) {
            arrivals.push({ seed: m.k, late: clock() - m.t, exit: (exit.t ?? 0) * 1000 });
            if (arrivals.length > 16) arrivals.shift();
          }
          director?.launch({
            x: path.x,
            y: path.y,
            angle: m.a,
            v: m.v,
            g: m.g,
            t0: m.t,
            color: m.c,
            shape: m.s as ShapeId,
            size: m.z,
            seed: m.k,
            frame: from,
            pad: m.p,
            exitU: exit.u,
            key: `${from}:${m.p}`,
          });
        },
        cross(data) {
          director?.addRemoteShell((s) => decodeShell(data, s));
        },
        spill(data) {
          director?.addRemoteBurst((b) => decodeBurst(data, b));
        },
        volley(m) {
          director?.partnerVolley(m.c, m.t);
        },
      },
    );
    const dl = downlink;
    partner = () => dl.partner();
  }
  const dl = downlink;
  const sky0: Director = createDirector({
    engine,
    config,
    seed: seedText,
    sky,
    fit,
    corner:
      corner && dl
        ? {
            side,
            partner: () => partner() !== null,
            sendCross: (s) => {
              sent++;
              dl.cross(s);
            },
            sendSpill: (b) => {
              sent++;
              dl.spill(b);
            },
            sendVolley: (c, t) => dl.volley(c, t),
          }
        : null,
    pads: () => (dl ? padsOn(dl.stations(), count) : layouts.length),
    showAllowed: () => isScreen || mode === "local",
  });
  director = sky0;

  // ---- Pads ---------------------------------------------------------------------------------

  const launchFromPad = (i: LaunchIntent): number => {
    const p = layouts[i.pad];
    if (!p) return 0;
    const m = mouthOf(p, i.angle);
    const region = touchRegion();
    const x = region.x0 + m.x;
    const y = -m.y;
    const t0 = clock() + IGNITE_MS;
    const toScreen = mode === "screen" && uplink !== null && screenAbove() !== null;
    if (toScreen && uplink) {
      const bs = touchBankSky();
      const msg = launchMessage({
        pad: i.pad,
        pads: layouts.length,
        pos: setup.pos,
        fw: fw(),
        fh: fh(),
        mouth: m,
        angle: i.angle,
        sky: bs,
        recipe: i.recipe,
        seed: i.seed,
        t: t0,
      });
      const ok = lag > 0 ? delayed(() => uplink?.send(msg)) : uplink.send(msg);
      if (ok) {
        sent++;
        const path = pathOf(msg, touchXo());
        const fuse = timeToHeight(path, burstHeight(bs, i.recipe.size)) ?? 3;
        engine.addShell((s) => {
          s.t0 = t0;
          s.path = path;
          s.tb = t0 + fuse * 1000;
          s.color = i.recipe.color;
          s.shape = i.recipe.shape;
          s.size = i.recipe.size;
          s.seed = i.seed;
          s.radius = 1;
          s.star = bs.star;
          s.ghost = true;
        });
        return Math.min(fuse * 1000, 4000) + IGNITE_MS + 200;
      }
    }
    const s = sky0.launch({
      x,
      y,
      angle: i.angle,
      v: touchLocalSky().v,
      g: touchLocalSky().g,
      t0,
      color: i.recipe.color,
      shape: i.recipe.shape,
      size: i.recipe.size,
      seed: i.seed,
      frame: ctx.net.self,
      pad: i.pad,
      exitU: m.x / fw(),
      key: `${ctx.net.self}:${i.pad}`,
    });
    return s.tb - t0 + IGNITE_MS + 150;
  };

  const delayed = (send: () => boolean | undefined): boolean => {
    const id = window.setTimeout(() => {
      lagTimers.delete(id);
      if (!disposed) send();
    }, lag);
    lagTimers.add(id);
    return screenAbove() !== null;
  };

  const buildPads = () => {
    padView?.dispose();
    for (const b of resetButtons) b.remove();
    resetButtons = [];
    bots?.dispose();
    bots = null;
    if (isScreen) return;
    layouts = layoutPads(padFrame(), config);
    const globalPad = (i: number) => (inBank ? setup.pos * layouts.length : 0) + i;
    pads = createPads({
      layouts,
      config,
      globalPad,
      now: ui,
      rng,
      narrow: frame.kind !== "wall",
      launch: launchFromPad,
    });
    padView = createPadView(ctx.root, layouts, frame.unit);
    const u = frame.unit;
    resetButtons = layouts.map((p, i) =>
      ctx.ui.button({
        icon: "reset",
        rect: {
          x: (p.reset.x - p.reset.r) * u,
          y: (p.reset.y - p.reset.r) * u,
          width: 2 * p.reset.r * u,
          height: 2 * p.reset.r * u,
        },
        hold: 1000,
        look: "ghost",
        color: "#c9d3ea",
        onPress: () => pads?.resetPad(i),
      }),
    );
    const botPads = Array.from({ length: Math.min(ctx.bots, layouts.length) }, (_, i) =>
      Math.floor((i * layouts.length) / Math.max(1, Math.min(ctx.bots, layouts.length))),
    );
    if (botPads.length > 0 && pads) {
      const pp = pads;
      bots = createPadBots({
        input: ctx.input,
        layouts,
        config,
        unit: () => frame.unit,
        pads: botPads,
        rng: ctx.rng(`fireworks-bots:${ctx.seed}:${ctx.identity.frame ?? "local"}`),
        clock,
        seed: ctx.seed,
        now: ui,
        lastHuman: (i) => pp.lastHuman(i),
        ready: (i) => pp.looks()[i]?.ready ?? false,
      });
    }
  };

  if (!isScreen) {
    buildPads();
    if (inBank) {
      uplink = createUplink(ctx.net, side, ui, (m) => {
        glows.push({ u: m.u, color: m.c, at: ui() });
        while (glows.length > MAX_GLOW_QUEUE) glows.shift();
        pads?.landed(m.p);
      });
      const up = uplink;
      screenAbove = () => up.screen();
      screenSince = ui();
    }
  }

  /**
   * The screen's beacons already carry a grace period, so a silent screen counts as gone at once;
   * at start-up the frame waits a little for the first beacon. Back to the screen only after it
   * has been heard for half a second, so a flickering link doesn't flip the sky back and forth.
   */
  let seenFrom = Infinity;
  let modeAt = Date.now();
  const watchScreen = () => {
    if (isScreen || !uplink) return;
    const t = ui();
    const was = mode;
    if (screenAbove() !== null) {
      if (seenFrom === Infinity) seenFrom = t;
      if (mode === "local" && t - seenFrom >= 500) mode = "screen";
    } else {
      seenFrom = Infinity;
      if (mode === "screen" && t - screenSince > SCREEN_GRACE_MS) mode = "local";
      screenSince = -Infinity;
    }
    if (mode !== was) modeAt = Date.now();
  };

  // ---- Input --------------------------------------------------------------------------------

  const at = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const offs = isScreen
    ? []
    : [
        ctx.input.on("down", (p) => {
          const v = at(p);
          pads?.down(p.id, v.x, v.y, p.synthetic);
        }),
        ctx.input.on("move", (p) => {
          const v = at(p);
          pads?.move(p.id, v.x, v.y);
        }),
        ctx.input.on("up", (p) => {
          const v = at(p);
          pads?.up(p.id, v.x, v.y);
        }),
        ctx.input.on("cancel", (p) => pads?.cancel(p.id)),
      ];

  // ---- Loop ---------------------------------------------------------------------------------

  const view = (): View => {
    if (isScreen) {
      const g = screenGeometry();
      return {
        region: g.region,
        horizon,
        zenith: g.region.y1,
        ground: false,
        starCell: g.region.y1 * 0.034,
      };
    }
    const region = touchRegion();
    const local = mode === "local";
    const padTop = -(layouts[0]?.top ?? fh() * 0.63);
    return {
      region,
      horizon: inBank ? horizon : padTop,
      zenith: local ? 0 : touchBankSky().height,
      ground: true,
      starCell: local ? fh() * 0.07 : touchBankSky().height * 0.034,
    };
  };

  const glowList = (): Glow[] => {
    const t = ui();
    const r = touchRegion();
    const out: Glow[] = [];
    for (let i = glows.length - 1; i >= 0; i--) {
      const g = glows[i]!;
      const age = t - g.at;
      if (age > GLOW_MS) {
        glows.splice(i, 1);
        continue;
      }
      const on = Math.min(1, age / 150);
      const rgb =
        g.color >= MIXED
          ? ([1, 0.9, 0.8] as const)
          : (COLORS[g.color]?.rgb ?? ([1, 1, 1] as const));
      out.push({
        x: r.x0 + g.u * fw(),
        y: 0,
        width: 300,
        strength: on * Math.exp(-age / 650),
        rgb,
      });
    }
    return out;
  };

  const resize = () => {
    renderer.resize(
      Math.round(frame.width * frame.pixelRatio * (renderer.software ? 0.5 : 1)),
      Math.round(frame.height * frame.pixelRatio * (renderer.software ? 0.5 : 1)),
    );
  };
  resize();

  /** Change view when the mode calls for it; back to 2D only once this sky's own bursts are over. */
  const swapLook = () => {
    const want: Look = isScreen || !inBank || mode === "local" ? "gl" : "2d";
    if (want === look) return;
    if (want === "2d") {
      const now = clock();
      for (const b of engine.bursts.slots) if (b.live && now - b.t0 < b.life * 1000) return;
    }
    renderer.dispose();
    look = want;
    renderer = makeRenderer(look);
    resize();
  };

  let lastRender = ui();
  let uiAt = 0;
  let softSized = renderer.software;
  const loop = ctx.loop({
    hz: UI_HZ,
    update() {
      if (disposed) return;
      watchScreen();
      swapLook();
      downlink?.tick();
      bots?.update();
    },
    render() {
      if (disposed) return;
      const t = ui();
      const dt = Math.min(0.25, (t - lastRender) / 1000);
      lastRender = t;
      if (renderer.software !== softSized) {
        softSized = renderer.software;
        resize();
      }
      const now = clock();
      sky0.update(now);
      if (ctx.debug) remember();
      renderer.draw(
        now,
        dt,
        engine,
        view(),
        isScreen ? [] : glowList(),
        kindSizes.density * soft(),
      );
      if (pads && padView && t - uiAt > 1000 / UI_HZ) {
        uiAt = t;
        padView.update(pads.looks());
      }
    },
  });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    resize();
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) buildPads();
    }, 200);
  });

  const offPeers = isScreen
    ? ctx.net.onPeers(() => {
        const st = downlink?.stations() ?? [];
        if (st.length > 0 && inBank) screenFw = touchFrameWidth(st);
      })
    : () => {};

  const debugKey = "__fireworks";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          mode: isScreen ? "screen" : mode,
          showing: sky0.showing,
          section: sky0.showName,
          sent,
          received,
          partner: partner(),
          screenAbove: screenAbove(),
          region: isScreen ? screenGeometry().region : touchRegion(),
          shells: engine.shells.slots
            .filter((s) => s.live)
            .map((s) => {
              const p = positionAt(s.path, Math.max(0, (clock() - s.t0) / 1000));
              return {
                id: s.id,
                seed: s.seed,
                x: p.x,
                y: p.y,
                t0: s.t0,
                tb: s.tb,
                ghost: s.ghost,
                shared: s.shared,
                burst: s.burst,
                own: s.frame === ctx.net.self,
              };
            }),
          bursts: engine.bursts.slots
            .filter((b) => b.live)
            .map((b) => ({
              seed: b.seed,
              x: b.x,
              y: b.y,
              t0: b.t0,
              shape: b.shape,
              count: b.count,
            })),
          pads: layouts.map((p) => ({
            tube: p.tube,
            color: p.color,
            shape: p.shape,
            size: p.size,
            aim: p.aim,
            x0: p.x0,
            x1: p.x1,
          })),
          unit: frame.unit,
          clock: clock(),
          arrivals: [...arrivals],
          history: [...history],
          modeAt,
          beaconGap: uplink?.beacons.maxGap ?? 0,
          online: ctx.net.online,
        }),
        setLag: (ms: number) => {
          lag = Math.max(0, Math.min(2000, ms));
        },
      },
    });
  }

  return {
    reset() {
      pads?.reset();
      bots?.release();
      sky0.reset();
      glows.length = 0;
    },
    attract() {},
    status() {
      const d = sky0;
      const now = clock();
      return {
        mode: isScreen ? "screen" : mode,
        lpm: d.launchesPerMinute(now),
        bursts: engine.bursts.live,
        shells: engine.shells.live,
        show: d.showing ? d.showName || "on" : "",
        ended: engine.ended,
        gl:
          look === "2d"
            ? "2d"
            : renderer.lost
              ? "lost"
              : renderer.ready
                ? renderer.software
                  ? "software"
                  : "ok"
                : "starting",
        launches: pads?.launches ?? 0,
        sent,
        received,
      };
    },
    command(name) {
      if (name === "show") sky0.forceShow(clock());
      else if (name === "gl-lose") renderer.simulateLoss(1500);
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      for (const id of lagTimers) clearTimeout(id);
      lagTimers.clear();
      offResize();
      offPeers();
      for (const off of offs) off();
      bots?.dispose();
      padView?.dispose();
      for (const b of resetButtons) b.remove();
      uplink?.dispose();
      downlink?.dispose();
      engine.clear();
      renderer.dispose();
      backdrop.remove();
      host.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
