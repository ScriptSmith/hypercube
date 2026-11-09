import type { AppContext, AppInstance, NetStats, RosterEntry } from "../../core/types";
import { DEG, stageMap } from "../../core/sphere";
import { createOverlay } from "./overlay";
import {
  assessThrottle,
  browserVersion,
  candidateTone,
  createRing,
  formatBytes,
  formatDuration,
  fpsTone,
  LATE_TIMER_MS,
  probeGpu,
  probeWebGpu,
  SLOW_TIMER_MS,
  STALL_MS,
} from "./probes";
import { createSpherePattern } from "./sphere";
import { createView, type TableRow } from "./view";

const TICK_MS = 250;
const REFRESH_MS = 500;
const STATS_MS = 2000;
const MAX_ROSTER_ROWS = 40;
const LONG_FRAME_MS = 50;

/** Sides matter only in two-sided setups (corner, versus), where pos and count are per side. */
const sideName = (side: number | undefined): string => (side === 1 ? "b" : "a");
const twoSided = (setup: string): boolean => setup === "corner" || setup === "versus";

const clockTime = (ms: number | null): string =>
  ms === null ? "never" : new Date(ms).toLocaleTimeString([], { hour12: false });

const ago = (ms: number | null): string => {
  if (ms === null) return "never";
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 1 ? "now" : `${formatDuration(s * 1000)} ago`;
};

export const mount = (ctx: AppContext): AppInstance => {
  const palette = ctx.ui.palette;
  const view = createView(ctx.root, palette);
  const overlay = createOverlay(view.el, palette);
  // On a sphere the readings sit in a box facing longitude 0, where people see well.
  const pattern = ctx.frame.sphere ? createSpherePattern(ctx.root, palette) : null;
  const room = ctx.system.room;
  const startedAt = performance.now();
  const cleanups: (() => void)[] = [];
  let disposed = false;

  const identity = view.section("Identity");
  const idSource = identity.row("Source");
  const idFrame = identity.row("Frame");
  const idZone = identity.row("Zone");
  const idDisplay = identity.row("Display");
  const idName = identity.row("Name");
  const idHostRole = identity.row("Host role");
  const idMode = identity.row("Mode");
  const idSiblings = identity.row("Siblings");

  const frameSec = view.section("Frame");
  const frKind = frameSec.row("Kind");
  const frStage = frameSec.row("Stage");
  const frUnit = frameSec.row("Unit");
  const frDpr = frameSec.row("DPR");
  const frRatio = frameSec.row("Pixel ratio");
  const frReach = frameSec.row("Reach");
  const frSeams = frameSec.row("Seams");
  const frTouch = frameSec.row("Touch points");
  frameSec.row("Grid").set("120 venue px (smallest target)");

  const setupSec = view.section("Setup");
  const suSetup = setupSec.row("Setup");
  const suPos = setupSec.row("Position");
  const suSide = setupSec.row("Side");
  const suGroup = setupSec.row("Group");
  const suApp = setupSec.row("App");

  const gpuSec = view.section("GPU and browser");
  const gpu = probeGpu();
  gpuSec.row("WebGL2").set(gpu.webgl2 ? "yes" : "no", gpu.webgl2 ? "good" : "bad");
  gpuSec.row("Renderer").set(gpu.renderer ?? "unknown", gpu.renderer ? "plain" : "warn");
  gpuSec.row("Vendor").set(gpu.vendor ?? "unknown");
  gpuSec.row("Max texture").set(gpu.maxTexture ? `${gpu.maxTexture} px` : "unknown");
  const gpuWebGpu = gpuSec.row("WebGPU");
  gpuWebGpu.set("checking");
  void probeWebGpu().then((text) => {
    if (!disposed) gpuWebGpu.set(text, text === "adapter available" ? "good" : "plain");
  });
  gpuSec.row("Browser").set(browserVersion(navigator.userAgent));
  gpuSec.row("Cores").set(String(navigator.hardwareConcurrency || "unknown"));

  const timingSec = view.section("Timing");
  const tiFps = timingSec.row("Frame rate");
  const tiFrames = timingSec.row("Frame gaps");
  const tiLong = timingSec.row("Long frames");
  const tiTimers = timingSec.row("Timer lateness");
  const tiVisible = timingSec.row("Visibility");
  const tiThrottle = timingSec.row("Throttling");
  const tiStalls = timingSec.row("Stalls");
  const tiUptime = timingSec.row("Uptime");
  const spark = timingSec.canvas("dg-spark");
  const sparkCtx = spark.getContext("2d");

  const touchSec = view.section("Touch");
  const toNow = touchSec.row("Active");
  const toMax = touchSec.row("Session max");
  const toTotal = touchSec.row("Touches");
  const toLast = touchSec.row("Last touch");

  const netSec = view.section("Network");
  const neStatus = netSec.row("Status");
  const neRole = netSec.row("Role");
  const neSelf = netSec.row("Self");
  const neHub = netSec.row("Hub");
  const neClock = netSec.row("Clock");
  const neConns = netSec.row("Connections");
  const neIce = netSec.row("ICE pairs");
  const neBytes = netSec.row("Traffic");
  const roster = room ? netSec.table(["Frame", "App", "Role", "Pos", "RTT", "Dup"]) : null;

  const errSec = view.section("Errors");
  const erCount = errSec.row("Count");
  const erLast = errSec.row("Last");

  // Timing state. Every history is a fixed-size ring.
  const frameGaps = createRing(240);
  // Ten seconds of timer samples, so a busy moment such as start-up is not called throttling.
  const timerLate = createRing(40);
  let lastFrameAt = 0;
  let framesInWindow = 0;
  let windowStart = performance.now();
  let fps: number | null = null;
  let stalls = 0;
  let lastStallAt: number | null = null;
  let inStall = false;
  let throttled = false;

  // Touch state. Counters only, never lists.
  let touchMax = 0;
  let touchMaxAt: number | null = null;
  let touchTotal = 0;
  let lastTouchAt: number | null = null;
  let overlayDirty = true;

  let stats: NetStats | null = null;
  let statsPending = false;
  let rosterRows = 0;
  let labelPx = 32;

  /** The readings' box in stage px, and its width in venue px. */
  const box = () => {
    const f = ctx.frame;
    if (!f.sphere) return { venueWidth: f.venueWidth };
    const map = stageMap(f);
    const top = map.y(Math.min(f.sphere.view.top, 25 * DEG));
    const bottom = map.y(Math.max(f.sphere.view.bottom, -50 * DEG));
    const left = map.x(-60 * DEG);
    const width = map.x(60 * DEG) - left;
    Object.assign(view.el.style, {
      inset: "auto",
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${Math.max(1, bottom - top)}px`,
      background: "rgba(5,7,13,0.82)",
      borderRadius: `${12 * f.unit}px`,
    });
    return { venueWidth: width / f.unit };
  };

  const fit = () => {
    const f = ctx.frame;
    labelPx = view.fit(f.unit, box().venueWidth, 120 * f.unit) * f.unit;
    if (pattern) {
      view.el.style.backgroundImage = "none";
      pattern.resize(f);
    }
    overlay.resize(f);
    spark.width = Math.max(1, Math.round(spark.clientWidth * f.pixelRatio));
    spark.height = Math.max(1, Math.round(spark.clientHeight * f.pixelRatio));
    overlayDirty = true;
  };

  const onTouch = () => {
    overlayDirty = true;
  };
  cleanups.push(
    ctx.input.on("down", () => {
      touchTotal++;
      lastTouchAt = Date.now();
      const n = ctx.input.pointers.size;
      if (n > touchMax) {
        touchMax = n;
        touchMaxAt = Date.now();
      }
      overlayDirty = true;
    }),
    ctx.input.on("move", onTouch),
    ctx.input.on("up", onTouch),
    ctx.input.on("cancel", onTouch),
  );

  // Bots wander as synthetic touches so the visualiser can be checked with nobody present.
  const botRng = ctx.rng("diag-bots");
  const bots = Array.from({ length: ctx.bots }, () => ({
    id: null as number | null,
    t: 0,
    until: botRng.range(0, 1.5),
    cx: 0,
    cy: 0,
    r: 0,
    speed: 0,
  }));

  const updateBots = (dt: number) => {
    const f = ctx.frame;
    for (const b of bots) {
      b.t += dt;
      if (b.id === null) {
        if (b.t < b.until) continue;
        const reachTop = f.touch ? f.reachTop.adult : 0;
        b.r = botRng.range(60, 200) * f.unit;
        b.cx = botRng.range(b.r, f.width - b.r);
        b.cy = botRng.range(Math.max(reachTop, 0) + b.r, f.height - b.r);
        b.speed = botRng.range(-3, 3);
        b.t = 0;
        b.until = botRng.range(1.5, 4);
        b.id = ctx.input.inject.down(b.cx + b.r, b.cy);
      } else if (b.t >= b.until) {
        ctx.input.inject.up(b.id);
        b.id = null;
        b.t = 0;
        b.until = botRng.range(0.3, 1.5);
      } else {
        const a = b.t * b.speed;
        ctx.input.inject.move(b.id, b.cx + Math.cos(a) * b.r, b.cy + Math.sin(a) * b.r);
      }
    }
  };

  const loop = ctx.loop({
    hz: 30,
    update: updateBots,
    render() {
      const now = performance.now();
      if (lastFrameAt) frameGaps.push(now - lastFrameAt);
      lastFrameAt = now;
      framesInWindow++;
      pattern?.tick(now / 1000);
      if (overlayDirty) {
        overlayDirty = false;
        overlay.draw(ctx.frame, ctx.input.pointers, labelPx);
        view.touches(ctx.input.pointers.size, touchMax);
      }
    },
  });
  loop.start();

  // A plain timer chain: its lateness shows timer throttling even when frames still run.
  let tickHandle = 0;
  let expected = performance.now() + TICK_MS;
  const tick = () => {
    const now = performance.now();
    timerLate.push(Math.max(0, now - expected));
    if (now - windowStart >= 1000) {
      fps = (framesInWindow * 1000) / (now - windowStart);
      framesInWindow = 0;
      windowStart = now;
    }
    const sinceFrame = lastFrameAt ? now - lastFrameAt : 0;
    if (sinceFrame > STALL_MS) {
      if (!inStall) {
        inStall = true;
        stalls++;
        lastStallAt = Date.now();
      }
    } else {
      inStall = false;
    }
    expected = now + TICK_MS;
    tickHandle = window.setTimeout(tick, TICK_MS);
  };
  tickHandle = window.setTimeout(tick, TICK_MS);

  const drawSpark = () => {
    if (!sparkCtx) return;
    const w = spark.width;
    const h = spark.height;
    sparkCtx.clearRect(0, 0, w, h);
    const gaps = frameGaps.values();
    const ceiling = 50;
    const bar = w / frameGaps.capacity;
    for (let i = 0; i < gaps.length; i++) {
      const v = gaps[i] ?? 0;
      sparkCtx.fillStyle = v > LONG_FRAME_MS ? palette.danger : v > 20 ? palette.accent : "#38d39f";
      const bh = (Math.min(v, ceiling) / ceiling) * h;
      sparkCtx.fillRect(i * bar, h - bh, Math.max(1, bar - 0.5), bh);
    }
    // A reference line at one 60 Hz frame.
    sparkCtx.fillStyle = "rgba(255,255,255,0.5)";
    sparkCtx.fillRect(0, h - (16.7 / ceiling) * h, w, Math.max(1, h * 0.02));
  };

  const rosterRow = (e: RosterEntry, hub: string | null): TableRow => ({
    cells: [
      `${e.frame === hub ? "★ " : ""}${e.frame}`,
      e.app,
      e.role,
      twoSided(ctx.setup.name) ? `${sideName(e.side)} ${e.pos}` : String(e.pos),
      e.rtt === undefined ? "-" : `${Math.round(e.rtt)} ms`,
      e.duplicate ? "yes" : "",
    ],
    tone: e.duplicate ? "bad" : undefined,
    strong: room !== null && e.frame === room.self,
  });

  const refreshNet = () => {
    if (!room) {
      const q = new URLSearchParams(ctx.system.search);
      const why =
        ctx.identity.mode === "preview"
          ? "preview mode"
          : q.get("room")
            ? "not connected"
            : "no room token";
      neStatus.set(`not networked (${why})`, "warn");
      for (const f of [neRole, neSelf, neHub, neClock, neConns, neIce, neBytes]) f.set("-");
      return;
    }
    const status = room.status;
    neStatus.set(status, status === "online" ? "good" : status === "connecting" ? "warn" : "bad");
    neRole.set(room.isHub ? "hub" : "client", room.isHub ? "good" : "plain");
    neSelf.set(room.self);
    const offset = room.clock.now() - (performance.timeOrigin + performance.now());
    const sign = offset >= 0 ? "+" : "-";
    neClock.set(
      `${sign}${Math.abs(offset).toFixed(1)} ms · ${room.clock.synced ? "synced" : "not synced"}`,
      room.clock.synced ? "good" : "warn",
    );
    if (stats) {
      neHub.set(stats.hub ?? "none", stats.hub ? "plain" : "warn");
      neConns.set(String(stats.connections));
      neIce.chips(stats.candidates.map((c) => ({ text: c, tone: candidateTone(c) })));
      neBytes.set(`${formatBytes(stats.bytesIn)} in · ${formatBytes(stats.bytesOut)} out`);
    }
    if (roster) {
      const entries = [...room.roster()].sort(
        (a, b) =>
          (a.side ?? 0) - (b.side ?? 0) ||
          Number(b.role === "screen") - Number(a.role === "screen") ||
          a.pos - b.pos ||
          a.frame.localeCompare(b.frame),
      );
      const hub = stats?.hub ?? (room.isHub ? room.self : null);
      const rows = entries.slice(0, MAX_ROSTER_ROWS).map((e) => rosterRow(e, hub));
      if (entries.length > MAX_ROSTER_ROWS) {
        rows.push({ cells: [`+${entries.length - MAX_ROSTER_ROWS} more`, "", "", "", "", ""] });
      }
      roster.setRows(rows);
      if (rows.length !== rosterRows) {
        rosterRows = rows.length;
        fit();
      }
    }
  };

  const pollStats = () => {
    if (!room || statsPending) return;
    statsPending = true;
    room
      .stats()
      .then((s) => {
        stats = s;
      })
      .catch(() => {
        stats = null;
      })
      .finally(() => {
        statsPending = false;
      });
  };

  const refresh = () => {
    const f = ctx.frame;
    const id = ctx.identity;
    const s = ctx.setup;
    view.header(
      id.name ?? id.display ?? id.frame ?? "Unidentified frame",
      `${f.kind} · ${s.name}${twoSided(s.name) ? ` side ${sideName(s.side)}` : ""} · ` +
        `${s.role} ${s.pos + 1} of ${s.count} · group ${s.group}`,
    );

    idSource.set(id.source, id.source === "none" ? "warn" : "plain");
    idFrame.set(id.frame ?? "none", id.frame ? "plain" : "warn");
    idZone.set(id.zone ?? "-");
    idDisplay.set(id.displays?.length ? id.displays.join(", ") : (id.display ?? "-"));
    idName.set(id.name ?? "-");
    idHostRole.set(id.hostRole ?? "-");
    idMode.set(id.mode, id.mode === "preview" ? "warn" : "good");
    idSiblings.set(String(id.siblings.length));

    frKind.set(f.span && f.span > 1 ? `${f.kind} (${f.span} panels)` : f.kind);
    frStage.set(
      `${Math.round(f.width)} × ${Math.round(f.height)} px (venue ${f.venueWidth} × ${f.venueHeight})`,
    );
    frUnit.set(f.unit.toFixed(3));
    frDpr.set(String(window.devicePixelRatio));
    frRatio.set(f.pixelRatio.toFixed(2));
    frReach.set(
      f.sphere
        ? `sphere ${(f.sphere.radius * 2).toFixed(1)} m, bottom ${(f.sphere.centreY - f.sphere.radius).toFixed(1)} m, seen well below ${Math.round(f.sphere.view.top / DEG)}°`
        : f.touch
          ? `adult ${Math.round(f.reach.adult * 100)}% · child ${Math.round(f.reach.child * 100)}%`
          : "none (not touch)",
    );
    frSeams.set(f.seams.length ? f.seams.map((x) => `x ${Math.round(x)} px`).join(", ") : "none");
    frTouch.set(String(navigator.maxTouchPoints), navigator.maxTouchPoints > 0 ? "good" : "warn");

    suSetup.set(`${s.name} · ${s.role}`);
    suPos.set(`${s.pos + 1} of ${s.count}`);
    suSide.set(twoSided(s.name) ? sideName(s.side) : "-");
    suGroup.set(s.group);
    suApp.set(`${ctx.manifest.id} · ${ctx.variant}`);

    const now = performance.now();
    const sinceFrame = lastFrameAt ? now - lastFrameAt : 0;
    const late = timerLate.median();
    const verdict = assessThrottle({ sinceFrame, timerLate: late, hidden: document.hidden });
    throttled = verdict.throttled;
    tiFps.set(
      fps === null ? "measuring" : `${fps.toFixed(1)} fps`,
      fps === null ? "plain" : fpsTone(fps),
    );
    tiFrames.set(`avg ${frameGaps.mean().toFixed(1)} ms · max ${frameGaps.max().toFixed(0)} ms`);
    const long = frameGaps.values().filter((g) => g > LONG_FRAME_MS).length;
    tiLong.set(`${long} of last ${frameGaps.length}`, long > 5 ? "warn" : "plain");
    tiTimers.set(
      `median ${late.toFixed(1)} ms · max ${timerLate.max().toFixed(0)} ms`,
      late > LATE_TIMER_MS ? "bad" : late > SLOW_TIMER_MS ? "warn" : "good",
    );
    tiVisible.set(document.visibilityState, document.hidden ? "bad" : "good");
    tiThrottle.set(
      verdict.throttled ? `THROTTLED: ${verdict.reasons.join(", ")}` : "not detected",
      verdict.throttled ? "bad" : "good",
    );
    tiStalls.set(
      stalls ? `${stalls} (last at ${clockTime(lastStallAt)})` : "none",
      stalls ? "warn" : "good",
    );
    tiUptime.set(formatDuration(now - startedAt));
    view.alert(verdict.throttled ? `Throttled: ${verdict.reasons.join(", ")}` : null);
    drawSpark();

    const active = ctx.input.pointers.size;
    toNow.set(String(active), active > 0 ? "good" : "plain");
    toMax.set(touchMax ? `${touchMax} (at ${clockTime(touchMaxAt)})` : "0");
    toTotal.set(String(touchTotal));
    toLast.set(ago(lastTouchAt));

    refreshNet();

    const errors = ctx.system.errors();
    erCount.set(String(errors.length), errors.length ? "bad" : "good");
    const last = errors.at(-1);
    erLast.set(last ? last.slice(0, 160) : "none");
    if (view.overflowing()) fit();
  };

  view.touches(0, 0);
  refresh();
  fit();
  cleanups.push(ctx.onResize(fit));
  const refreshTimer = window.setInterval(refresh, REFRESH_MS);
  let statsTimer = 0;
  if (room) {
    pollStats();
    statsTimer = window.setInterval(pollStats, STATS_MS);
    cleanups.push(room.onStatus(refreshNet), room.onRoster(refreshNet));
  }

  return {
    // Measurements are what this app is for, so an idle reset keeps them.
    reset() {
      overlayDirty = true;
    },
    status: () => ({ fps: Math.round(fps ?? 0), touchMax, throttled }),
    dispose() {
      disposed = true;
      loop.stop();
      window.clearTimeout(tickHandle);
      window.clearInterval(refreshTimer);
      window.clearInterval(statsTimer);
      for (const b of bots) if (b.id !== null) ctx.input.inject.up(b.id);
      for (const fn of cleanups.splice(0)) fn();
      pattern?.dispose();
      view.el.remove();
    },
  };
};
