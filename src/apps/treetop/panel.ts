/**
 * A touch frame: one or more lanes, each with its own station and camera. The races themselves
 * are in game.ts; this file wires stations and touches to it and draws.
 *
 * - A touch on an idle lane takes its station, which starts at once.
 * - Alone, or in a bank's attract, idle lanes fly faded bots. In a bank race idle lanes fly
 *   nothing: they show the platform's tap hint and the seconds to the next race. A practice run
 *   says so above the glider, with the same timer.
 */
import type { AppContext, AppInstance, FrameInfo, StationSet } from "../../core/types";
import { type Atlas, buildAtlas } from "./art";
import type { FlapConfig } from "./config";
import { distanceOf, type Flight } from "./flight";
import { createGame, type GameLane } from "./game";
import { createGfx, rgb, type Rgb } from "./gl";
import { laneAt, lanesFor } from "./layout";
import {
  burstFor,
  createLaneDrawer,
  createLaneView,
  disposeLaneView,
  type LaneView,
  startCam,
} from "./lanes";
import { createParticles, SKY_DARK } from "./scene";

const HZ = 120;
const HOOK_MS = 500;
/** Bots kept for testing take an idle station back after this long. */
const TEST_RECLAIM_MS = 8000;

export const mountPanel = (ctx: AppContext, cfg: FlapConfig): AppInstance => {
  const palette = ctx.ui.palette;
  const solo = ctx.setup.name === "solo";
  const pos = ctx.setup.role === "solo" ? 0 : ctx.setup.pos;
  const fx = ctx.rng(`treetop:fx:${pos}`);
  const particles = createParticles(220, () => fx.next());

  let frame: FrameInfo = ctx.frame;
  let views: LaneView[] = [];
  let set: StationSet | null = null;
  let atlas: Atlas | null = null;
  let lastHook = -Infinity;
  let errors = 0;

  const gfx = createGfx(ctx.root, 0, (msg) => {
    errors++;
    console.error(msg);
  });
  const hud = document.createElement("div");
  hud.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden;";
  ctx.root.append(hud);

  const colorAt = (index: number) =>
    palette.players[index % palette.players.length] ?? palette.accent;

  const hasScreen = () => ctx.net.peers().some((p) => p.role === "screen");

  const viewOf = (l: GameLane) => views.find((v) => v.spec.slot === l.slot);

  const game = createGame({
    net: ctx.net,
    now: () => ctx.clock.now(),
    local: () => performance.now(),
    cfg,
    solo,
    pos,
    count: ctx.setup.count,
    rng: (label) => ctx.rng(label),
    useGhost: () => solo && cfg.ghost && views.length === 1 && frame.kind === "panel",
    endStation: (slot) => set?.list[views.findIndex((v) => v.spec.slot === slot)]?.end(),
    onEvent(who, lane, e) {
      const color = lane ? viewOf(lane)?.rgb : rivalRgb(who.flight);
      if (!color) return;
      burstFor(particles, e, who.flight, color, lane ? lane.slot : -1, lane !== null);
      if (e.type === "crash") {
        const v = lane && viewOf(lane);
        if (v) v.shake = 1;
      }
    },
    onRestart(lane) {
      const v = viewOf(lane);
      if (v) v.cam = startCam(v.spec);
    },
  });

  const rivalColors = new Map<number, Rgb>();
  const rivalRgb = (f: Flight): Rgb => {
    const index =
      pos * Math.max(1, views.length) + (game.rivals.find((r) => r.flight === f)?.index ?? 0);
    let c = rivalColors.get(index);
    if (!c) {
      c = rgb(colorAt(index));
      if (rivalColors.size < 16) rivalColors.set(index, c);
    }
    return c;
  };

  // ---- Lanes and stations --------------------------------------------------------------------

  const venueShape = (f: FrameInfo) => ({
    width: f.width / f.unit,
    height: f.height / f.unit,
    seams: f.seams.map((s) => s / f.unit),
  });

  const build = (f: FrameInfo) => {
    const specs = lanesFor(venueShape(f), cfg.variant);
    const n = specs.length;
    const old = views;
    set?.dispose();
    for (const v of old) disposeLaneView(v);
    const u = f.unit;
    set = ctx.stations.define(
      specs.map((spec) => {
        const index = pos * n + spec.slot;
        const left = spec.column === 0 && (f.seams.length === 0 || spec.rect.x < f.width / u / 2);
        return {
          id: `lane-${spec.slot}`,
          rect: {
            x: spec.touch.x * u,
            y: spec.touch.y * u,
            width: spec.touch.width * u,
            height: spec.touch.height * u,
          },
          calibrate: false,
          color: colorAt(index),
          playTimeout: 0,
          resetCorner: left ? "top-left" : "top-right",
        };
      }),
    );
    game.setLanes(specs.map((s) => ({ slot: s.slot, adult: s.adult })));
    views = specs.map((spec, i) => {
      const index = pos * n + spec.slot;
      const rings = Math.floor(index / palette.players.length);
      return createLaneView(hud, spec, index, colorAt(index), rings, u, old[i]?.cam);
    });
    const stations = set.list;
    set.on("ready", () => set?.startReady());
    set.on("start", (s) => {
      const v = views[stations.indexOf(s)];
      if (v) game.join(v.spec.slot, s.bot);
    });
    set.on("end", (s) => {
      const v = views[stations.indexOf(s)];
      if (!v) return;
      v.test = false;
      v.idleSince = performance.now();
      game.leave(v.spec.slot);
    });
    claimTestBots(true);
    sizeCanvas(f);
  };

  const claimTestBots = (now = false) => {
    if (!set) return;
    const list = set.list;
    let have = views.filter((v, i) => v.test && list[i]?.state !== "idle").length;
    const local = performance.now();
    views.forEach((v, i) => {
      const st = list[i];
      if (!st || have >= ctx.bots || st.state !== "idle") return;
      if (!now && local - v.idleSince < TEST_RECLAIM_MS) return;
      v.test = true;
      st.claimForBot();
      have++;
    });
  };

  const sizeCanvas = (f: FrameInfo) => {
    const k = f.unit * f.pixelRatio;
    gfx.resize(f.width * f.pixelRatio, f.height * f.pixelRatio);
    const scale = Math.max(...views.map((v) => v.spec.scale * k), 0.05);
    if (!atlas || Math.abs(atlas.scale - scale) / scale > 0.1) {
      atlas = buildAtlas(scale, cfg.flyer);
      gfx.setAtlas(atlas.canvas);
    }
  };

  // ---- Input ---------------------------------------------------------------------------------

  const offDown = ctx.input.on("down", (p) => {
    if (p.synthetic) return;
    const u = frame.unit;
    const spec = laneAt(
      views.map((v) => v.spec),
      p.x / u,
      p.y / u,
    );
    const i = views.findIndex((v) => v.spec === spec);
    if (i < 0 || set?.list[i]?.state !== "playing") return;
    game.tap(views[i]!.spec.slot);
  });

  // ---- Drawing -------------------------------------------------------------------------------

  const drawer = createLaneDrawer({
    gfx,
    atlas: () => atlas,
    frame: () => frame,
    game,
    cfg,
    palette,
    particles,
    now: () => ctx.clock.now(),
    hasScreen,
    colorAt,
    rivalRgb,
    viewOf,
  });

  // ---- Loop ----------------------------------------------------------------------------------

  let lastDraw = performance.now();
  let lastClaim = -Infinity;
  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      game.update(dt);
      const local = performance.now();
      if (local - lastClaim >= 100) {
        lastClaim = local;
        claimTestBots();
      }
      if (local - lastHook >= HOOK_MS) {
        lastHook = local;
        hook(ctx.clock.now());
      }
    },
    render(alpha) {
      const local = performance.now();
      const dt = Math.min(0.1, (local - lastDraw) / 1000);
      lastDraw = local;
      particles.step(dt);
      drawer.numerals(ctx.clock.now());
      if (!atlas || !gfx.begin(SKY_DARK[0], SKY_DARK[1], SKY_DARK[2])) return;
      const time = local / 1000;
      for (const l of game.lanes) {
        const v = viewOf(l);
        if (v) drawer.draw(l, v, alpha, time, dt);
      }
      gfx.end();
    },
  });

  // ---- Test hook and admin -------------------------------------------------------------------

  const hook = (now: number) => {
    const p = game.plan;
    const list = set?.list ?? [];
    ctx.root.dataset.treetop = JSON.stringify({
      k: p.k,
      phase: game.phase,
      play: p.play,
      heat: game.heats?.heat?.phase ?? null,
      start: p.start,
      next: Math.round(p.next),
      hash: game.course?.hash ?? 0,
      label: game.course?.label ?? "",
      leader: game.board.leader(),
      screen: hasScreen(),
      rivals: game.rivals.length,
      ghost: game.ghost !== null,
      offset: Math.round(now - (performance.timeOrigin + performance.now())),
      synced: ctx.clock.synced,
      lanes: game.lanes.map((l, i) => ({
        id: l.id,
        ctrl: l.ctrl,
        state: list[i]?.state ?? "idle",
        joined: l.joined,
        racer: l.racer,
        practice: l.practice,
        shown: game.shows(l),
        mode: l.flight.mode,
        d: Math.round(distanceOf(l.flight)),
        y: Math.round(l.flight.y),
        fin: l.flight.fin,
        place: game.placeOf(l),
      })),
      known: game.board.live().length,
    });
  };

  build(frame);
  const offResize = ctx.onResize((f) => {
    frame = f;
    build(f);
  });
  loop.start();

  return {
    reset() {
      const list = set?.list ?? [];
      game.lanes.forEach((l, i) => {
        if (l.ctrl === "human") list[i]?.end();
      });
    },
    status() {
      return {
        variant: cfg.variant,
        race: game.plan.k,
        play: game.plan.play,
        humans: game.lanes.filter((l) => l.ctrl === "human" && l.joined).length,
        ...(errors ? { gfxErrors: errors } : {}),
      };
    },
    homeSpot(size) {
      const u = frame.unit;
      const margin = 28 * u;
      const seam = frame.seams[0];
      if (seam !== undefined) return { x: seam - size - margin, y: margin };
      return { x: frame.width - size - margin, y: margin };
    },
    dispose() {
      loop.stop();
      offDown();
      offResize();
      set?.dispose();
      for (const v of views) disposeLaneView(v);
      views = [];
      game.dispose();
      gfx.dispose();
      hud.remove();
      atlas = null;
    },
  };
};
