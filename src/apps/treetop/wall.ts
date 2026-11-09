/**
 * A wall runs the bank and its screen in one frame. Lanes stand side by side from the floor up
 * to adult reach (layout.ts `wallLayout`), and the race shows above them where people watch
 * (overview.ts).
 *
 * The rules are the bank's own: the screen's host (host.ts) and one game per column of lanes
 * (game.ts) are members of an in-frame bus (localbus.ts), with the column as the game's `pos`,
 * so the lobby, countdown, joined lanes only, practice runs, early ends, placings and the attract
 * bots that leave when anyone joins all behave as on a bank of panels under a screen. Nothing
 * goes out on the room's network: one wall is one race.
 *
 * Each lane is a station. A touch on an idle lane takes it, and taps anywhere in it fly its
 * glider. `bots=` claims that many lanes for test bots, spread along the wall, which join and
 * race like people.
 */
import type {
  AppContext,
  AppInstance,
  FrameInfo,
  OptionValues,
  Station,
  StationSet,
} from "../../core/types";
import { type Atlas, buildAtlas } from "./art";
import { COURSE_H, type FlapConfig } from "./config";
import { distanceOf } from "./flight";
import { createGame, type Game, type GameLane } from "./game";
import { createGfx } from "./gl";
import { createHost } from "./host";
import {
  burstFor,
  createLaneDrawer,
  createLaneView,
  disposeLaneView,
  type LaneDrawer,
  type LaneView,
  startCam,
  type TimerSpot,
} from "./lanes";
import { laneAt, type LaneSpec, type WallLayout, wallLayout } from "./layout";
import { createLocalBus } from "./localbus";
import { createOverview } from "./overview";
import { createParticles, type Particles, SKY_DARK } from "./scene";

const HZ = 120;
const HOOK_MS = 500;
/** Bots kept for testing take an idle station back after this long. */
const TEST_RECLAIM_MS = 8000;
/** Wall lanes this tall or more label their timer. */
const LABEL_MIN_H = 900;

/** Lanes across the wall (columns in `pads`), from the `lanes` option. */
export const wallColumns = (options: OptionValues): number => {
  const n = Number(options.lanes);
  return n === 4 ? 4 : 6;
};

interface Column {
  pos: number;
  game: Game;
  particles: Particles;
  views: LaneView[];
  drawer: LaneDrawer;
}

interface Slot {
  column: Column;
  view: LaneView;
}

export const mountWall = (ctx: AppContext, cfg: FlapConfig): AppInstance => {
  const palette = ctx.ui.palette;
  const count = wallColumns(ctx.options);
  const now = () => ctx.clock.now();
  const local = () => performance.now();
  const bus = createLocalBus(ctx.manifest.id);
  const host = createHost({ net: bus.join("wall-race", "screen", 0), now, local, cfg });

  let frame: FrameInfo = ctx.frame;
  let layout: WallLayout = wallLayout(venueShape(frame), cfg.variant, count, frame.reach);
  let slots: Slot[] = [];
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

  const stationOf = (c: Column, slot: number): Station | undefined => {
    const i = slots.findIndex((s) => s.column === c && s.view.spec.slot === slot);
    return i < 0 ? undefined : set?.list[i];
  };

  const makeColumn = (pos: number): Column => {
    const fx = ctx.rng(`treetop:fx:${pos}`);
    const particles = createParticles(160, () => fx.next());
    const viewOf = (l: GameLane) => column.views.find((v) => v.spec.slot === l.slot);
    const game = createGame({
      net: bus.join(`wall-${pos}`, "station", pos),
      now,
      local,
      cfg,
      solo: false,
      pos,
      count,
      rng: (label) => ctx.rng(label),
      useGhost: () => false,
      endStation: (slot) => stationOf(column, slot)?.end(),
      onEvent(who, lane, e) {
        const v = lane && viewOf(lane);
        if (!v) return;
        burstFor(particles, e, who.flight, v.rgb, v.spec.slot, true);
        if (e.type === "crash") v.shake = 1;
      },
      onRestart(lane) {
        const v = viewOf(lane);
        if (v) v.cam = startCam(v.spec);
      },
    });
    const drawer = createLaneDrawer({
      gfx,
      atlas: () => atlas,
      frame: () => frame,
      game,
      cfg,
      palette,
      particles,
      now,
      // The race above the lanes is this wall's screen.
      hasScreen: () => true,
      colorAt,
      rivalRgb: () => [1, 1, 1],
      viewOf,
      labelMinH: LABEL_MIN_H,
    });
    const column: Column = { pos, game, particles, views: [], drawer };
    return column;
  };
  const columns = Array.from({ length: count }, (_, pos) => makeColumn(pos));

  const overview = createOverview({
    gfx,
    hud,
    atlas: () => atlas,
    frame: () => frame,
    layout: () => layout,
    host,
    columns,
    palette,
    now,
  });

  // ---- Lanes and stations --------------------------------------------------------------------

  const build = (f: FrameInfo) => {
    layout = wallLayout(venueShape(f), cfg.variant, count, f.reach);
    const u = f.unit;
    set?.dispose();
    const old = new Map(slots.map((s) => [`${s.column.pos}:${s.view.spec.slot}`, s.view.cam]));
    for (const s of slots) disposeLaneView(s.view);
    slots = [];
    for (const c of columns) {
      const specs = layout.lanes.filter((l) => l.column === c.pos);
      c.game.setLanes(specs.map((s) => ({ slot: s.slot, adult: s.adult })));
      c.views = specs.map((spec) => {
        const index = c.pos * specs.length + spec.slot;
        const rings = Math.floor(index / palette.players.length);
        const cam = old.get(`${c.pos}:${spec.slot}`);
        return createLaneView(hud, spec, index, colorAt(index), rings, u, cam, wallTimer(spec));
      });
      for (const view of c.views) slots.push({ column: c, view });
    }
    set = ctx.stations.define(
      slots.map(({ view }) => ({
        id: `lane-${view.index}`,
        rect: {
          x: view.spec.touch.x * u,
          y: view.spec.touch.y * u,
          width: view.spec.touch.width * u,
          height: view.spec.touch.height * u,
        },
        calibrate: false,
        color: view.color,
        playTimeout: 0,
        // Home, when the picker launched this, sits at the top right of the last lane.
        resetCorner: "top-left",
      })),
    );
    const list = set.list;
    set.on("ready", () => set?.startReady());
    set.on("start", (s) => {
      const slot = slots[list.indexOf(s)];
      if (slot) slot.column.game.join(slot.view.spec.slot, s.bot);
    });
    set.on("end", (s) => {
      const slot = slots[list.indexOf(s)];
      if (!slot) return;
      slot.view.test = false;
      slot.view.idleSince = performance.now();
      slot.column.game.leave(slot.view.spec.slot);
    });
    claimTestBots(true);
    sizeCanvas(f);
    overview.resize();
  };

  /** Test bots go to lanes spread along the wall: every column's first lane, then the rest. */
  const spread = spreadColumns(ctx.bots, count);
  const botOrder = () =>
    slots
      .map((s, i) => ({ s, i }))
      .sort(
        (a, b) =>
          a.s.view.spec.slot - b.s.view.spec.slot ||
          spread.indexOf(a.s.column.pos) - spread.indexOf(b.s.column.pos),
      );

  const claimTestBots = (now = false) => {
    if (!set) return;
    const list = set.list;
    let have = slots.filter((s, i) => s.view.test && list[i]?.state !== "idle").length;
    const at = performance.now();
    for (const { s, i } of botOrder()) {
      const st = list[i];
      if (!st || have >= ctx.bots || st.state !== "idle") continue;
      if (!now && at - s.view.idleSince < TEST_RECLAIM_MS) continue;
      s.view.test = true;
      st.claimForBot();
      have++;
    }
  };

  const sizeCanvas = (f: FrameInfo) => {
    const k = f.unit * f.pixelRatio;
    gfx.resize(f.width * f.pixelRatio, f.height * f.pixelRatio);
    const lanes = Math.max(...layout.lanes.map((l) => l.scale));
    const scale = Math.max(lanes, (layout.packH / COURSE_H) * 1.4) * k;
    if (!atlas || Math.abs(atlas.scale - scale) / scale > 0.1) {
      atlas = buildAtlas(Math.max(0.05, scale), cfg.flyer);
      gfx.setAtlas(atlas.canvas);
    }
  };

  // ---- Input ---------------------------------------------------------------------------------

  const offDown = ctx.input.on("down", (p) => {
    if (p.synthetic) return;
    const u = frame.unit;
    const spec = laneAt(
      slots.map((s) => s.view.spec),
      p.x / u,
      p.y / u,
    );
    const i = slots.findIndex((s) => s.view.spec === spec);
    const slot = slots[i];
    if (!slot || set?.list[i]?.state !== "playing") return;
    slot.column.game.tap(slot.view.spec.slot);
  });

  // ---- Loop ----------------------------------------------------------------------------------

  let lastDraw = performance.now();
  let lastClaim = -Infinity;
  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      host.tick();
      for (const c of columns) c.game.update(dt);
      overview.update();
      const at = performance.now();
      if (at - lastClaim >= 100) {
        lastClaim = at;
        claimTestBots();
      }
      if (at - lastHook >= HOOK_MS) {
        lastHook = at;
        hook();
      }
    },
    render(alpha) {
      const at = performance.now();
      const dt = Math.min(0.1, (at - lastDraw) / 1000);
      lastDraw = at;
      const clock = now();
      for (const c of columns) {
        c.particles.step(dt);
        c.drawer.numerals(clock);
      }
      overview.numerals(clock);
      if (!atlas || !gfx.begin(SKY_DARK[0], SKY_DARK[1], SKY_DARK[2])) return;
      const time = at / 1000;
      for (const c of columns) {
        for (const l of c.game.lanes) {
          const v = c.views.find((x) => x.spec.slot === l.slot);
          if (v) c.drawer.draw(l, v, alpha, time, dt);
        }
      }
      overview.draw(alpha, at, dt);
      gfx.end();
    },
  });

  // ---- Test hook and admin -------------------------------------------------------------------

  const hook = () => {
    const p = host.plan;
    const list = set?.list ?? [];
    const u = frame.unit;
    const course = columns[0]?.game.course ?? null;
    ctx.root.dataset.treetop = JSON.stringify({
      k: p.k,
      phase: host.phase,
      play: p.play,
      heat: host.heats.heat?.phase ?? null,
      racers: host.heats.heat?.lanes ?? [],
      leading: host.heats.leading,
      start: p.start,
      next: Math.round(p.next),
      hash: course?.hash ?? 0,
      label: course?.label ?? "",
      hashes: [...new Set(columns.map((c) => c.game.course?.hash ?? 0))],
      columns: count,
      synced: ctx.clock.synced,
      places: host.board.places ? [...host.board.places.entries()] : null,
      lanes: slots.map((s, i) => {
        const l = s.column.game.lanes.find((x) => x.slot === s.view.spec.slot);
        const t = s.view.spec.touch;
        return {
          id: l?.id ?? -1,
          column: s.column.pos,
          pad: s.view.spec.pad,
          ctrl: l?.ctrl ?? "attract",
          state: list[i]?.state ?? "idle",
          joined: l?.joined ?? false,
          racer: l?.racer ?? false,
          practice: l?.practice ?? false,
          shown: l ? s.column.game.shows(l) : false,
          mode: l?.flight.mode ?? "waiting",
          d: l ? Math.round(distanceOf(l.flight)) : 0,
          y: l ? Math.round(l.flight.y) : 0,
          fin: l?.flight.fin ?? null,
          place: l ? s.column.game.placeOf(l) : null,
          /** Stage px: the middle of the lane's touch area. */
          at: [Math.round((t.x + t.width / 2) * u), Math.round((t.y + t.height / 2) * u)],
        };
      }),
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
      slots.forEach((s, i) => {
        const l = s.column.game.lanes.find((x) => x.slot === s.view.spec.slot);
        if (l?.ctrl === "human") list[i]?.end();
      });
      overview.reset();
    },
    status() {
      const lanes = columns.flatMap((c) => c.game.lanes);
      return {
        variant: cfg.variant,
        race: host.plan.k,
        play: host.plan.play,
        phase: host.plan.play === "bank" ? host.phase : "attract",
        humans: lanes.filter((l) => l.ctrl === "human" && l.joined).length,
        ...(errors ? { gfxErrors: errors } : {}),
      };
    },
    homeSpot(size) {
      const u = frame.unit;
      const margin = 28 * u;
      return { x: frame.width - size - margin, y: layout.laneTop * u + margin };
    },
    dispose() {
      loop.stop();
      offDown();
      offResize();
      set?.dispose();
      for (const s of slots) disposeLaneView(s.view);
      slots = [];
      overview.dispose();
      for (const c of columns) {
        c.game.dispose();
        c.particles.clear();
      }
      host.dispose();
      bus.dispose();
      gfx.dispose();
      hud.remove();
      atlas = null;
    },
  };
};

/**
 * A wall lane's timer sits near its top, above the platform's tap hint in the middle of the lane,
 * so the two never overlap however short the lane.
 */
export const wallTimer = (spec: LaneSpec): TimerSpot => {
  const { x, y, width, height } = spec.rect;
  const hintTop = height / 2 - Math.min(320, height * 0.4) / 2;
  // The ring's dots stand 17 px out from it, and its label's middle is 50 px below it.
  const r = Math.min(Math.min(width, height) * 0.1, (hintTop - 50) / 2);
  const cy = Math.max(r + 21, Math.min(height * 0.24, r + 75, hintTop - r - 82));
  return { x: x + width / 2, y: y + cy, r, labelY: y + cy + r + 50 };
};

const venueShape = (f: FrameInfo) => ({ width: f.width / f.unit, height: f.height / f.unit });

/** Columns in the order bots take them, so the first `bots` are spread evenly along the wall. */
export const spreadColumns = (bots: number, count: number): number[] => {
  const b = Math.min(count, Math.max(1, Math.round(bots)));
  const out: number[] = [];
  for (let i = 0; i < b; i++) {
    const c = Math.min(count - 1, Math.floor(((i + 0.5) * count) / b));
    if (!out.includes(c)) out.push(c);
  }
  for (let i = 0; i < count; i++) if (!out.includes(i)) out.push(i);
  return out;
};
