import { type AdminHandle, type FrameConfig, loadOverride, startAdmin } from "./admin";
import { computeFrame, computeSetup, inferKind, spanOf } from "./frame";
import { createIdle, type IdleHandle } from "./idle";
import { identityChanged, resolveIdentity } from "./identity";
import { createInput } from "./input";
import { createLoop } from "./loop";
import { captureLogs } from "./logs";
import { connectRoom, localClock, offlineChannel } from "./net";
import { cleanOptionValues } from "./options";
import { coerceOptions, type Params, parseParams, presetOptions } from "./params";
import { preserveDrawingBuffers } from "./preserve";
import { getManifest, loadApp } from "./registry";
import { createRng, hashSeed } from "./rng";
import { DEG, stageMap } from "./sphere";
import { createStage, type Stage } from "./stage";
import { createStations } from "./stations";
import type {
  AppContext,
  AppInstance,
  AppModule,
  FrameInfo,
  Identity,
  LaunchOptions,
  Loop,
  OptionValue,
  OptionValues,
  PeerInfo,
  Returned,
  Room,
  SetupInfo,
} from "./types";
import { createButton, createUi, PALETTE } from "./ui";
import { DEFAULT_VENUE, mergeVenue, setActiveVenue } from "./venue";

/**
 * Reload after this much uptime (plus up to an hour of per-frame jitter, so a room's frames
 * don't all reload together) at the next idle moment, to shed any slow leak.
 */
const RELOAD_AFTER_MS = 12 * 60 * 60 * 1000;
const RELOAD_JITTER_MS = 60 * 60 * 1000;
const RELOAD_CHECK_MS = 60 * 1000;
/** Waits between attempts to load an app's chunk. */
const LOAD_RETRIES_MS = [1000, 4000, 15000];
/** Reloads we start for errors are at least this far apart, so a broken deploy can't loop fast. */
const MIN_RELOAD_GAP_MS = 5 * 60 * 1000;
const RELOAD_STAMP_KEY = "hc:reloaded-at";
const MAX_ERRORS = 20;
/** House outline for the Home control shown while a launched app runs. */
const HOME_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/>' +
  '<path d="M5.5 10v9.5h5v-5.5h3v5.5h5V10"/></svg>';
/** Longer timeouts overflow and fire at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** How often a networked frame publishes its status to the roster (seen in admin). */
const STATUS_INTERVAL_MS = 5000;

/** Read by tests (Playwright) and the debug overlay. Not an API for apps. */
export interface RuntimeState {
  phase: "booting" | "running" | "error";
  app: string | null;
  variant: string | null;
  /** The mounted app's resolved options. */
  options: OptionValues | null;
  identity: Identity | null;
  frame: FrameInfo | null;
  setup: SetupInfo | null;
  room: Room["status"] | "none";
  /** The live room, for the simulator and tests to inspect. */
  net: Room | null;
  errors: string[];
  mounts: number;
  /** The mounted app's `status()`, for tests. */
  appStatus(): Record<string, OptionValue>;
}

declare global {
  interface Window {
    __hypercube?: RuntimeState;
  }
}

/** How an app came to be mounted. */
interface MountHow {
  /** Started by another app (the picker), which is `home` until this one leaves. */
  launched?: boolean;
  stay?: LaunchOptions["stay"];
  homeControl?: boolean;
  /** Passed on to the app as `ctx.system.returned`. */
  returned?: Returned;
}

interface Mounted {
  config: Required<Pick<FrameConfig, "app">> & FrameConfig;
  how: MountHow;
  /** The app's context, kept so a late host identity can update it in place. */
  ctx: AppContext | null;
  instance: AppInstance | null;
  appRoot: HTMLElement;
  cleanups: (() => void)[];
  /** Set by unmount. A mount still awaiting its app can't register anything after this. */
  disposed: boolean;
  idle: IdleHandle;
}

export const boot = async (host: HTMLElement = document.body): Promise<void> => {
  // First, so admin can fetch everything the page logs from here on.
  const logs = captureLogs();
  const state: RuntimeState = {
    phase: "booting",
    app: null,
    variant: null,
    options: null,
    identity: null,
    frame: null,
    setup: null,
    room: "none",
    net: null,
    errors: [],
    mounts: 0,
    appStatus: () => {
      try {
        return mounted?.instance?.status?.() ?? {};
      } catch {
        return {};
      }
    },
  };
  window.__hypercube = state;

  const recordError = (message: string) => {
    state.errors.push(message);
    if (state.errors.length > MAX_ERRORS) state.errors.shift();
    console.error("[hypercube]", message);
  };
  window.addEventListener("error", (e) => recordError(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => recordError(String(e.reason)));

  /** Reload, but never twice within MIN_RELOAD_GAP_MS (counted across reloads). */
  const reloadSoon = (reason: string) => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_STAMP_KEY) ?? 0);
    } catch {
      // Without storage we can't rate-limit, so don't reload at all.
      return;
    }
    if (Date.now() - last < MIN_RELOAD_GAP_MS) return;
    try {
      sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
    } catch {
      return;
    }
    console.warn("[hypercube] reloading:", reason);
    location.reload();
  };
  // Vite's signal that a lazily imported chunk is gone, usually after a new deploy.
  window.addEventListener("vite:preloadError", () => reloadSoon("chunk preload failed"));

  const params: Params = parseParams(location.search);
  setActiveVenue(mergeVenue(DEFAULT_VENUE, params.venue));
  /** Set once apps can mount; applies a late host identity to the mounted app. */
  let applyIdentity: ((next: Identity) => void) | null = null;
  let identity = await resolveIdentity(params, (next) => {
    const material = identityChanged(identity, next);
    identity = next;
    state.identity = next;
    // Room membership, frame kind and admin keys all hang off identity; a fresh boot is simplest.
    if (material) reloadSoon("identity changed");
    applyIdentity?.(next);
  });
  state.identity = identity;

  const stage: Stage = createStage(host, params.fit);
  const kind = inferKind(params, identity, stage.size());
  const span = spanOf(params, identity, kind);
  let frame = computeFrame(kind, stage.size(), params, span);
  state.frame = frame;

  const appLayer = document.createElement("div");
  appLayer.style.cssText = "position:absolute;inset:0;";
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:10;";
  stage.el.append(appLayer, overlay);

  if (kind === "sphere" && params.look === "globe") {
    // Before any app makes a WebGL context, so the preview can copy what it draws.
    preserveDrawingBuffers();
    void import("./globe")
      .then(({ startGlobe }) => {
        const globe = startGlobe({ host, source: appLayer, frame: () => frame });
        window.addEventListener("pagehide", () => globe.dispose());
      })
      .catch((err) => recordError(`globe preview failed: ${String(err)}`));
  }

  const networked = identity.mode === "show" && identity.frame !== null && params.room !== null;

  const baseSetup = () => computeSetup(params, identity, kind);
  // Admin can't reach a frame outside the room, so an override stored there earlier could never
  // be cleared; a preview shows what its URL says.
  let override = networked ? loadOverride(params.room, identity.frame) : null;
  const effective = (): Required<Pick<FrameConfig, "app">> & FrameConfig => ({
    app: override?.app ?? params.app,
    variant: override?.variant !== undefined ? override.variant : params.variant,
    options: override?.options,
    ...pickSetup(override),
  });
  const presetsFor = (app: string): OptionValues => {
    const m = getManifest(app);
    return m ? presetOptions(app, params.options, override?.launch?.[app], m.options) : {};
  };
  const setupFor = (cfg: FrameConfig): SetupInfo => {
    const base = baseSetup();
    return {
      name: cfg.setup ?? base.name,
      role: cfg.role ?? base.role,
      pos: cfg.pos ?? base.pos,
      count: cfg.count ?? base.count,
      group: cfg.group ?? base.group,
      side: cfg.side ?? base.side,
    };
  };

  const selfInfo = (cfg: FrameConfig): PeerInfo => {
    const setup = setupFor(cfg);
    return {
      frame: identity.frame ?? `preview-${Math.random().toString(36).slice(2, 8)}`,
      app: cfg.app ?? params.app,
      group: setup.group,
      kind,
      role: setup.role,
      pos: setup.pos,
      side: setup.side,
      ...(kind === "pair" ? { span } : {}),
      zone: identity.zone,
      display: identity.display,
    };
  };

  let room: Room | null = null;
  if (networked && params.room) {
    room = connectRoom({
      room: params.room,
      self: selfInfo(effective()),
      signalling: params.peer,
      transport: params.transport,
    });
    state.room = room.status;
    state.net = room;
    room.onStatus((s) => {
      state.room = s;
    });
  }
  const clock = room?.clock ?? localClock();

  let mounted: Mounted | null = null;
  const bootTime = performance.now();
  let lastTouch = 0;
  let mountToken = 0;
  /** The app to return to (the picker) while a launched app runs. */
  let home: (Required<Pick<FrameConfig, "app">> & FrameConfig) | null = null;

  const unmount = () => {
    if (!mounted) return;
    const m = mounted;
    mounted = null;
    m.disposed = true;
    try {
      m.instance?.dispose();
    } catch (err) {
      recordError(`dispose failed: ${String(err)}`);
    }
    for (const fn of m.cleanups.splice(0).reverse()) {
      try {
        fn();
      } catch (err) {
        recordError(`cleanup failed: ${String(err)}`);
      }
    }
    m.appRoot.remove();
  };

  const mount = async (
    cfg: Required<Pick<FrameConfig, "app">> & FrameConfig,
    how: MountHow = {},
  ) => {
    const launched = how.launched === true;
    if (!launched) home = null;
    const token = ++mountToken;
    unmount();
    let manifest = getManifest(cfg.app);
    if (!manifest) {
      recordError(`unknown app "${cfg.app}"`);
      cfg = { app: "idle" };
      manifest = getManifest("idle");
      if (!manifest) throw new Error("idle app missing");
    }
    const setup = setupFor(cfg);
    const variant =
      cfg.variant && manifest.variants?.some((v) => v.id === cfg.variant)
        ? cfg.variant
        : (manifest.variants?.[0]?.id ?? "default");
    // Options from an override or a launch are checked like URL ones before the app sees them.
    // A launched app starts from its own defaults and the operator's presets for it, not the
    // picker's URL options.
    const options = launched
      ? cleanOptionValues({ ...presetsFor(cfg.app), ...cfg.options }, manifest.options)
      : cfg.options
        ? cleanOptionValues(cfg.options, manifest.options)
        : coerceOptions(params.options, manifest.options);

    const appRoot = document.createElement("div");
    appRoot.style.cssText = `position:absolute;inset:0;overflow:hidden;isolation:isolate;background:${PALETTE.background};`;
    appLayer.append(appRoot);

    const cleanups: (() => void)[] = [];
    const resizeListeners = new Set<(f: FrameInfo) => void>();
    const loops = new Set<Loop>();
    const input = createInput(appRoot, { debug: params.debug });
    cleanups.push(
      input.onActivity(() => {
        lastTouch = Date.now();
      }),
    );
    const ui = createUi(appRoot, () => frame);
    const stations = createStations({ root: appRoot, frame: () => frame, input, ui });
    const idle = createIdle(input, params.idle * 1000);
    cleanups.push(
      () => input.dispose(),
      () => ui.dispose(),
      () => stations.dispose(),
      () => idle.dispose(),
      () => {
        for (const loop of loops) loop.stop();
        loops.clear();
        resizeListeners.clear();
      },
    );

    const info = selfInfo(cfg);
    room?.update(info);
    const net = room
      ? room.channel(
          `app:${manifest.id}:${setup.group}`,
          (p) => p.app === manifest.id && p.group === setup.group,
        )
      : offlineChannel(info);
    cleanups.push(() => net.close?.());

    const record: Mounted = {
      config: cfg,
      how,
      ctx: null,
      instance: null,
      appRoot,
      cleanups,
      disposed: false,
      idle,
    };
    mounted = record;

    const seedText = params.seed ?? `${manifest.id}:${setup.group}`;
    const ctx: AppContext = {
      manifest,
      root: appRoot,
      frame,
      setup,
      identity,
      variant,
      options,
      seed: hashSeed(seedText),
      debug: params.debug,
      bots: params.bots,
      rng: (seed) => createRng(seed ?? seedText),
      clock,
      loop(spec) {
        const loop = createLoop(spec);
        if (record.disposed) return { start() {}, stop() {}, running: false };
        loops.add(loop);
        return loop;
      },
      input,
      stations,
      net,
      ui,
      idle,
      onResize(cb) {
        resizeListeners.add(cb);
        return () => resizeListeners.delete(cb);
      },
      onDispose(cb) {
        if (record.disposed) cb();
        else cleanups.push(cb);
      },
      system: {
        launch(app, opts) {
          if (record.disposed || !getManifest(app)) return;
          home = home ?? record.config;
          const how: MountHow = { launched: true };
          const s = opts?.stay;
          // NaN fails both tests; Infinity passes, to stay for good.
          if (s && s.ms >= 0 && s.graceMs >= 0) how.stay = { ms: s.ms, graceMs: s.graceMs };
          if (opts?.homeControl === false) how.homeControl = false;
          void mount(
            {
              ...pickSetup(record.config),
              // Its own group, so two pickers that launch the same app don't share a channel.
              group: `launch:${identity.frame ?? "local"}`,
              app,
              variant: opts?.variant ?? null,
              options: opts?.options,
            },
            how,
          );
        },
        returned: how.returned ?? null,
        presets: presetsFor,
        room,
        search: location.search,
        errors: () => state.errors,
      },
      log: (...args) => {
        if (params.debug) console.log(`[${manifest.id}]`, ...args);
      },
    };

    record.ctx = ctx;
    state.app = manifest.id;
    state.variant = variant;
    state.options = options;
    state.setup = setup;
    state.mounts++;

    cleanups.push(
      stage.onResize(() => {
        ctx.frame = frame;
        for (const cb of resizeListeners) cb(frame);
      }),
    );

    let mod: AppModule | null = null;
    for (let attempt = 0; attempt < LOAD_RETRIES_MS.length && !mod; attempt++) {
      try {
        mod = await loadApp(manifest.id);
      } catch (err) {
        recordError(`load ${manifest.id} failed (attempt ${attempt + 1}): ${String(err)}`);
        await new Promise((r) => setTimeout(r, LOAD_RETRIES_MS[attempt]));
        if (token !== mountToken) return;
      }
    }
    if (token !== mountToken) return;
    if (!mod) {
      // Usually a deploy replaced the hashed chunks this page knows about; a reload fixes it.
      state.phase = "error";
      reloadSoon("app chunk unavailable");
      if (launched && home) void mount(home, { returned: "error" });
      else if (manifest.id !== "idle") void mount({ app: "idle" });
      return;
    }
    try {
      record.instance = await mod.mount(ctx);
      if (token !== mountToken) {
        record.instance.dispose();
        return;
      }
    } catch (err) {
      recordError(`mount ${manifest.id} failed: ${String(err)}`);
      if (token !== mountToken) return;
      state.phase = "error";
      if (launched && home) void mount(home, { returned: "error" });
      else if (manifest.id !== "idle") void mount({ app: "idle" });
      return;
    }

    const back = launched ? home : null;
    if (back && how.homeControl !== false) {
      const size = Math.round((frame.kind === "wall" ? 160 : 120) * frame.unit);
      const margin = Math.round(28 * frame.unit);
      let spot: { x: number; y: number } | null = null;
      try {
        spot = record.instance?.homeSpot?.(size) ?? null;
      } catch (err) {
        recordError(`homeSpot failed: ${String(err)}`);
      }
      const button = createButton(
        {
          icon: HOME_ICON,
          rect: {
            x: spot?.x ?? frame.width - size - margin,
            y: spot?.y ?? Math.max(0, frame.reachTop.adult) + margin,
            width: size,
            height: size,
          },
          hold: 800,
          look: "ghost",
          color: PALETTE.foreground,
          onPress: () => void mount(back, { returned: "home" }),
        },
        frame.unit,
      );
      button.el.style.zIndex = "60";
      appRoot.append(button.el);
      cleanups.push(() => button.dispose());
    }

    // A stay keeps the app through idle moments until its time is up, then leaves at the next
    // one, or once the grace runs out even if someone is still playing.
    const stay = back ? how.stay : undefined;
    let due = false;
    if (stay && back) {
      const leave = () => void mount(back, { returned: "time" });
      const later = (ms: number, fn: () => void) =>
        ms <= MAX_TIMEOUT_MS ? window.setTimeout(fn, ms) : 0;
      const timers = [
        later(stay.ms, () => {
          if (idle.idle) leave();
          else due = true;
        }),
        later(stay.ms + stay.graceMs, leave),
      ];
      cleanups.push(() => {
        for (const t of timers) clearTimeout(t);
      });
    }

    cleanups.push(
      idle.on((isIdle) => {
        if (!isIdle || !record.instance) return;
        if (back && (!stay || due)) {
          void mount(back, { returned: stay ? "time" : "idle" });
          return;
        }
        try {
          record.instance.reset();
          record.instance.attract?.();
        } catch (err) {
          recordError(`reset failed: ${String(err)}`);
        }
      }),
    );
    state.phase = "running";
  };

  stage.onResize((size) => {
    frame = computeFrame(kind, size, params, span);
    state.frame = frame;
  });

  /**
   * Centred on a flat frame. On a sphere, three copies a third of a turn apart, just below the
   * equator, so it can be read from anywhere round it.
   */
  const showOverlayText = (text: string, ms: number, big: boolean) => {
    const spots: { left: string; top: string }[] = [];
    if (frame.sphere) {
      const map = stageMap(frame);
      const { top, bottom } = frame.sphere.view;
      const lat = Math.max(bottom, Math.min(top, 0) - 10 * DEG);
      for (const lon of [-120, 0, 120]) {
        spots.push({ left: `${map.x(lon * DEG)}px`, top: `${map.y(lat)}px` });
      }
    } else {
      spots.push({ left: "50%", top: "50%" });
    }
    for (const spot of spots) {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText =
        `position:absolute;left:${spot.left};top:${spot.top};transform:translate(-50%,-50%);` +
        `padding:0.4em 0.8em;border-radius:0.3em;background:rgba(0,0,0,0.75);` +
        `color:${PALETTE.foreground};font:700 1px system-ui,sans-serif;text-align:center;` +
        "white-space:pre-line;";
      el.style.fontSize = `${Math.round((big ? 220 : 72) * frame.unit)}px`;
      overlay.append(el);
      setTimeout(() => el.remove(), ms);
    }
  };

  let admin: AdminHandle | null = null;
  admin = startAdmin({
    overlay,
    room,
    roomToken: params.room,
    ak: params.ak,
    pinVerifier: params.pv,
    identity: () => identity,
    frame: () => frame,
    setup: () => setupFor(effective()),
    config: effective,
    applyOverride(next) {
      override = next;
      void mount(effective());
    },
    appCommand(name, args) {
      mounted?.instance?.command?.(name, args);
    },
    resetApp() {
      mounted?.instance?.reset();
    },
    reload() {
      location.reload();
    },
    showNotice(text, ms) {
      showOverlayText(text, ms, false);
    },
    identify(ms) {
      const s = setupFor(effective());
      const side = s.name === "corner" || s.name === "versus" ? ` ${s.side === 1 ? "B" : "A"}` : "";
      const place = s.role === "station" ? ` ${s.pos + 1} of ${s.count}` : "";
      const label = [
        identity.name ?? identity.display ?? identity.frame ?? "preview",
        `${kind}${side}${place}`,
        state.app ?? "",
      ]
        .filter(Boolean)
        .join("\n");
      showOverlayText(label, ms, true);
    },
  });
  if (room) {
    const r = room;
    let frames = 0;
    const countFrame = () => {
      frames++;
      requestAnimationFrame(countFrame);
    };
    requestAnimationFrame(countFrame);
    let lastFrames = 0;
    let lastAt = performance.now();
    window.setInterval(() => {
      const now = performance.now();
      const fps = Math.round(((frames - lastFrames) * 1000) / Math.max(1, now - lastAt));
      lastFrames = frames;
      lastAt = now;
      let appStatus: Record<string, OptionValue> = {};
      try {
        appStatus = mounted?.instance?.status?.() ?? {};
      } catch (err) {
        recordError(`status failed: ${String(err)}`);
      }
      // Runtime keys first: the roster keeps only the first keys of a status.
      r.setStatus({
        app: state.app ?? "",
        variant: state.variant ?? "",
        phase: state.phase,
        fps,
        uptime: Math.round((now - bootTime) / 1000),
        lastTouch,
        errors: state.errors.length,
        logErrors: logs.errorCount,
        lastError: state.errors.at(-1)?.slice(0, 120) ?? "",
        override: override !== null,
        ...appStatus,
      });
    }, STATUS_INTERVAL_MS);
  }

  const reloadAfter = RELOAD_AFTER_MS + Math.random() * RELOAD_JITTER_MS;
  window.setInterval(() => {
    if (performance.now() - bootTime < reloadAfter) return;
    if (mounted && !mounted.idle.idle) return;
    location.reload();
  }, RELOAD_CHECK_MS);

  window.addEventListener("pagehide", () => {
    admin?.dispose();
    unmount();
    room?.close();
  });

  // A frame named by its URL boots before the host's `frame-context` arrives, so the siblings
  // (and with them a screen's count) come late. Remount when that changes the setup.
  applyIdentity = (next) => {
    const m = mounted;
    if (!m?.ctx) return;
    if (sameSetup(m.ctx.setup, setupFor(m.config))) m.ctx.identity = next;
    else void mount(m.config, m.how);
  };

  await mount(effective());
};

const sameSetup = (a: SetupInfo, b: SetupInfo): boolean =>
  a.name === b.name &&
  a.role === b.role &&
  a.pos === b.pos &&
  a.count === b.count &&
  a.group === b.group &&
  a.side === b.side;

const pickSetup = (o: FrameConfig | null): FrameConfig => {
  if (!o) return {};
  const out: FrameConfig = {};
  if (o.setup !== undefined) out.setup = o.setup;
  if (o.role !== undefined) out.role = o.role;
  if (o.pos !== undefined) out.pos = o.pos;
  if (o.count !== undefined) out.count = o.count;
  if (o.group !== undefined) out.group = o.group;
  if (o.side !== undefined) out.side = o.side;
  return out;
};
