import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { createPourers, type Pourers } from "./bots";
import {
  type Box,
  computeGeometry,
  type Geometry,
  readConfig,
  softwareCell,
  venueToCell,
} from "./config";
import { createControls, type Controls } from "./controls";
import { createCritters, type Critters, type Ground, groundFromHeights } from "./critters";
import { createDirector, type DrainLevels } from "./director";
import { E, ELEMENTS, elementDef, hexToRgb } from "./elements";
import { createGadgets, type GadgetSizes, type GadgetZone, type Gadgets } from "./gadgets";
import { createGpu } from "./gpu/context";
import { createRenderInputs } from "./gpu/render";
import { createTickInputs, MAX_EMITTERS, MAX_HEATS, MAX_STAMPS, MAX_ZONES, put4 } from "./gpu/sim";
import { columnsFor, homeReserve, homeWidgets, swatchSize, type WidgetSpec } from "./layout";
import { createPaletteView, MAX_GHOST_HANDS, type PaletteView } from "./palette";
import { createPieceSet, type Piece, PIECE_MATERIAL, PIECE_SHAPE, type PieceSet } from "./pieces";
import { BASE_POUR_AREA, createHands, type Hands } from "./pour";
import { buildScene, type Scene } from "./scene";
import { MAX_CLOUDS, MAX_CURSORS, MAX_GHOSTS } from "./shaders/common";
import { createSprites, type Sprites } from "./sprites";
import { allSwatches, isTool, paletteFor } from "./swatches";
import {
  createInbox,
  createLanding,
  createUplink,
  type Landing,
  TOPIC_UP,
  unpackBatch,
  type Uplink,
} from "./uplink";
import { createWeather, type Emit, type Weather } from "./weather";

/** Block passes per tick at full speed: about 6 cells of fall per tick. */
const PASSES = 6;
const MIN_PASSES = 2;
/** GPU ticks allowed per rendered frame, so a slow GPU runs in slow motion instead of stalling. */
const MAX_TICKS_PER_FRAME = 2;
/** Emitters kept for fingers; weather, spouts and arrivals get the rest. */
const FINGER_EMITTERS = 22;
const STATS_MS = 2000;
const GROUND_MS = 500;
/** Bots stand back for this long after a person touches. */
const BOT_YIELD_MS = 15_000;
const PIECE_GAP = 50;
const CURSOR_RADIUS = 46;
/** Arrivals brought in per tick on the screen. */
const ARRIVALS_PER_TICK = 80;

const STAMP_OP = { place: 0, remove: 1, crumble: 2 } as const;
/** Finger ring colour per element: the light end of its palette; Remove is rose. */
const CURSOR_RGB = ELEMENTS.map((e, i) =>
  i === E.EMPTY ? hexToRgb("#f2a7b0") : hexToRgb(e.colors[2]),
);

const BOT_WEIGHTS: Record<string, number> = {
  sand: 4,
  water: 4,
  seed: 2,
  snow: 1.2,
  ice: 1,
  salt: 0.6,
  popcorn: 0.8,
  oil: 0.8,
  fire: 1,
  lava: 1,
  acid: 0.6,
  block: 0.25,
  ramp: 0.25,
  bowl: 0.25,
  platform: 0.25,
  remove: 0.3,
  geyser: 1,
  fan: 0.4,
  heater: 0.4,
  cooler: 0.3,
  spout: 0.4,
  beetle: 0.6,
};
const ATTRACT_WEIGHTS: Record<string, number> = {
  sand: 3,
  water: 3,
  seed: 2,
  beetle: 0.6,
  geyser: 0.8,
};

interface World {
  geometry: Geometry;
  scene: Scene;
  spec: WidgetSpec | null;
  palette: PaletteView | null;
  controls: Controls | null;
  hands: Hands;
  pieces: PieceSet;
  gadgets: Gadgets;
  critters: Critters;
  sprites: Sprites;
  weather: Weather;
  bots: Pourers | null;
  attract: Pourers | null;
  sizes: GadgetSizes;
}

export const mount = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.frame.kind, ctx.variant, ctx.options);
  const screen = ctx.frame.kind === "screen" || ctx.setup.role === "screen";
  const inBank = ctx.setup.name === "bank";
  const rng = ctx.rng("tinyworld");
  const palette = paletteFor(config.variant, config.palette);
  const swatchIds = new Set(allSwatches(palette).map((s) => s.id));

  // Seen under the canvas, and instead of it while the GPU is unavailable.
  const backdrop = document.createElement("div");
  backdrop.style.cssText =
    "position:absolute;inset:0;background:linear-gradient(180deg,#080c16 0%,#131b2a 62%,#0b111b 100%);";
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;";
  ctx.root.append(backdrop, host);

  const tick = createTickInputs();
  const view = createRenderInputs();
  const levels: DrainLevels = { sink: 0, crumble: 0, fade: 0 };
  const stamps: { op: number; piece: Piece }[] = [];
  const zones: GadgetZone[] = [];
  let frame: FrameInfo = ctx.frame;
  let world: World | null = null;
  let ground: Ground | null = null;
  let passes = PASSES;
  let ticksSinceRender = 0;
  let pendingDt = 0;
  let lastHuman = -Infinity;
  let attractMode = false;
  let statsAt = 0;
  let groundAt = 0;
  let markAt = 0;
  let outletAt = 0;
  let outletPending = false;
  let sent = 0;
  let received = 0;
  let frameMs = 16.7;
  let lastRender = 0;
  let slowFor = 0;
  let disposed = false;
  let built = false;

  const now = () => performance.now();
  // A software rasteriser draws at half resolution: the coarse cells lose nothing by it.
  const canvasSize = (css: number) =>
    Math.max(1, Math.round(css * frame.pixelRatio * (gpu.software ? 0.5 : 1)));

  const uplink: Uplink | null =
    inBank && !screen ? createUplink(ctx.net, ctx.setup.pos, ctx.setup.count) : null;
  const inbox = createInbox();
  let landing: Landing | null = null;
  const offNet = screen
    ? ctx.net.on(TOPIC_UP, (data) => {
        const arrivals = unpackBatch(data);
        if (!arrivals) return;
        received += arrivals.length;
        inbox.push(arrivals);
      })
    : () => {};

  const queueStamp = (op: keyof typeof STAMP_OP, piece: Piece) => {
    stamps.push({ op: STAMP_OP[op], piece });
    if (stamps.length > 32) stamps.shift();
  };

  const director = createDirector({
    onDrained() {
      const w = world;
      if (!w) return;
      w.pieces.clear();
      w.hands.clear();
      stamps.length = 0;
      // A fresh landscape each time: new noise, and the pond somewhere else.
      w.scene.world.seed = rng.range(0, 1000);
      if (config.variant === "sandbox")
        w.scene.world.terrain[2] = w.geometry.gridW * rng.range(0.25, 0.75);
      gpu.run((sim) => sim.genesis(w.scene.world, "regrow"));
      director.reveal0();
    },
    onCycle() {
      startDrain("cycle");
    },
  });

  const gpu = createGpu({
    host,
    onReady(sim) {
      if (!world) return;
      sim.genesis(world.scene.world, "build");
      // After a lost context the pieces are still known here; put them back.
      stamps.length = 0;
      for (const p of world.pieces.list) queueStamp("place", p);
      // The world is simply there at start-up; after a lost context the land rises back.
      if (built) director.reveal0();
      built = true;
    },
    onError(message) {
      console.error(message);
    },
  });

  const startDrain = (cause: "idle" | "manual" | "cycle") => {
    director.startDrain(cause);
    world?.weather.calm();
    world?.gadgets.clear();
    world?.critters.leave();
  };

  const build = () => {
    const prev = world;
    prev?.palette?.dispose();
    prev?.bots?.dispose();
    prev?.attract?.dispose();
    prev?.sprites.dispose();
    prev?.controls?.clear();
    const venueW = frame.width / frame.unit;
    const venueH = frame.height / frame.unit;
    const cell = gpu.software ? softwareCell(venueW, venueH, config.cell) : config.cell;
    const geometry = computeGeometry(frame, cell);
    // The GPU keeps its world while the grid stays the same size (a resize that only changes
    // the scale), so what it holds must stay tracked here too.
    const same =
      prev !== null &&
      prev.geometry.gridW === geometry.gridW &&
      prev.geometry.gridH === geometry.gridH &&
      prev.geometry.cell === geometry.cell;
    const scene = same
      ? prev.scene
      : buildScene(config, geometry, rng.range(0, 1000), () => rng.next());
    const wall = frame.kind === "wall";
    const spec: WidgetSpec | null = screen
      ? null
      : { palette, cols: columnsFor(frame.kind), size: swatchSize(frame.kind) };
    const homes = spec ? homeWidgets(frame.kind, geometry, frame.reach, spec) : [];
    const pal = spec
      ? createPaletteView(ctx.root, spec, homes, geometry.unit, () => startDrain("manual"))
      : null;
    const pieces =
      same && prev
        ? prev.pieces
        : createPieceSet(
            {
              cap: config.pieceCap,
              gap: PIECE_GAP,
              stack: 1.25,
              jitter: 0.06,
              bounds: scene.bounds,
              keepOut: [],
            },
            frame.kind,
          );
    const hands =
      same && prev
        ? prev.hands
        : createHands({
            radius: wall ? 400 : 260,
            ttlMs: 30_000,
            max: 16,
            pickMs: 30_000,
            placeMs: 15_000,
            burst: 6,
            refill: 0.35,
            fallback: E.SAND,
            side: (x) => world?.palette?.side(x) ?? 0,
          });
    const gadgets =
      same && prev
        ? prev.gadgets
        : createGadgets({ cap: config.gadgetCap, gap: 160, bounds: scene.bounds, spoutMs: 60_000 });
    const critters =
      same && prev
        ? prev.critters
        : createCritters({
            cap: config.beetleCap,
            lifeMs: 120_000,
            speed: wall ? 80 : 60,
            step: wall ? 30 : 24,
            drop: wall ? 60 : 48,
            width: geometry.width,
          });
    const sprites = createSprites(
      ctx.root,
      geometry.unit,
      { gadgets: config.gadgetCap, beetles: config.beetleCap * 2 },
      { gadget: wall ? 124 : 104, beetle: wall ? 84 : 64 },
    );
    const weather =
      same && prev ? prev.weather : createWeather(scene.weather, ctx.rng("tinyworld-weather"));
    const controls = pal
      ? createControls({
          geometry,
          widgets: pal,
          pieces,
          hands,
          movable: config.variant === "delta",
          rand: () => rng.next(),
          now,
          stamp: queueStamp,
          placeTool(kind, x, y, element) {
            if (kind === "beetle") critters.spawn(x, y, now());
            else gadgets.place(kind, x, y, element, now());
          },
          removeAt(x, y) {
            const piece = pieces.at(x, y, 20);
            if (piece && pieces.remove(piece.id)) queueStamp("remove", piece);
            const g = gadgets.at(x, y, 80);
            if (g) gadgets.remove(g.id);
            critters.shoo(x, y, 90);
          },
          tapPlaced(x, y) {
            const g = gadgets.at(x, y, 70);
            if (g?.kind !== "fan") return false;
            gadgets.flip(g.id);
            return true;
          },
          pressed: (w, sw) => pal.press(w, sw),
        })
      : null;

    const reachTop = frame.reachTop.adult / geometry.unit;
    const top = Math.max(reachTop + 80, geometry.height * 0.12);
    const area: Box = {
      x: 220,
      y: top,
      width: Math.max(1, geometry.width - 440),
      height: Math.max(1, geometry.height * 0.86 - top),
    };
    const locate = (w: number, id: string) => {
      const l = pal?.layouts[w];
      const found = l?.swatches.find((s) => s.swatch.id === id);
      if (found) return { swatch: found.box, tab: null };
      const page = palette.pages.findIndex((p) => p.swatches.some((s) => s.id === id));
      const tab = l?.parts.find((p) => p.type === "tab" && p.page === page);
      return { swatch: null, tab: tab?.box ?? null };
    };
    const only = (weights: Record<string, number>) =>
      Object.fromEntries(Object.entries(weights).filter(([id]) => swatchIds.has(id)));
    const placed = (id: string) => {
      const sw = allSwatches(palette).find((s) => s.id === id);
      return sw?.choice.type === "place";
    };
    const aim = () => {
      const g = gadgets.list.find((x) => x.kind === "geyser");
      return g ? { x: g.x, y: g.y } : null;
    };
    const pourers = (
      count: number,
      label: string,
      weights: Record<string, number>,
      rest: [number, number],
      pour: [number, number],
    ) =>
      createPourers(ctx.input, count, {
        unit: geometry.unit,
        area,
        widgets: homes.length,
        locate,
        placed,
        aim,
        rng: ctx.rng(label),
        weights: only(weights),
        rest,
        pour,
      });
    // In a bank the point is throwing things up to the screen, so bots build geysers more often.
    const botWeights = uplink ? { ...BOT_WEIGHTS, geyser: 3 } : BOT_WEIGHTS;
    const bots =
      pal && ctx.bots > 0
        ? pourers(
            Math.min(ctx.bots, MAX_GHOST_HANDS),
            "tinyworld-bots",
            botWeights,
            [0.6, 2.2],
            [2, 5],
          )
        : null;
    const attract = pal
      ? pourers(1, "tinyworld-attract", ATTRACT_WEIGHTS, [9, 16], [3, 4.5])
      : null;
    landing = screen ? createLanding(geometry.gridW, MAX_ZONES) : null;

    world = {
      geometry,
      scene,
      spec,
      palette: pal,
      controls,
      hands,
      pieces,
      gadgets,
      critters,
      sprites,
      weather,
      bots,
      attract,
      sizes: {
        jetWidth: wall ? 84 : 72,
        jetTop: geometry.height * 0.1,
        fanReach: wall ? 900 : 520,
        fanHeight: 200,
        heatRadius: wall ? 190 : 150,
      },
    };

    gpu.configure(
      {
        gridW: geometry.gridW,
        gridH: geometry.gridH,
        worldCellsW: geometry.width / geometry.cell,
        worldCellsH: geometry.height / geometry.cell,
        worldW: geometry.width,
        worldH: geometry.height,
        cell: geometry.cell,
      },
      canvasSize(frame.width),
      canvasSize(frame.height),
    );
  };

  // ---- Input ------------------------------------------------------------------------------

  const human = (p: Pointer) => {
    if (p.synthetic) return;
    lastHuman = now();
    if (attractMode) {
      attractMode = false;
      director.setAttract(false, lastHuman);
    }
    director.interrupt();
  };
  const at = (p: Pointer) => {
    const u = world?.geometry.unit ?? 1;
    return { x: p.x / u, y: p.y / u };
  };
  const offs = [
    ctx.input.on("down", (p) => {
      human(p);
      const v = at(p);
      world?.controls?.down(p.id, v.x, v.y, p.synthetic);
    }),
    ctx.input.on("move", (p) => {
      const v = at(p);
      world?.controls?.move(p.id, v.x, v.y);
    }),
    ctx.input.on("up", (p) => world?.controls?.up(p.id, false)),
    ctx.input.on("cancel", (p) => world?.controls?.up(p.id, true)),
  ];

  // ---- Tick (60 Hz) -------------------------------------------------------------------------

  const emit: Emit = (x0, y0, x1, y1, radius, chance, element, life, mode = 0) => {
    const i = tick.emitCount;
    if (i >= MAX_EMITTERS || chance <= 0) return;
    put4(tick.emitA, i, x0, y0, x1, y1);
    put4(tick.emitB, i, radius, chance, element, life[0]);
    put4(tick.emitC, i, life[1], mode, 0, 0);
    tick.emitCount = i + 1;
  };
  const fingerEmit: Emit = (...args) => {
    if (tick.emitCount < FINGER_EMITTERS) emit(...args);
  };

  const fillStamps = (g: Geometry) => {
    tick.stampCount = 0;
    while (stamps.length > 0 && tick.stampCount < MAX_STAMPS) {
      const s = stamps.shift();
      if (!s) break;
      const p = s.piece;
      const c = venueToCell(g, p.x, p.y);
      const i = tick.stampCount++;
      put4(tick.stampA, i, c.x, c.y, p.width / 2 / g.cell, p.height / 2 / g.cell);
      put4(tick.stampB, i, PIECE_SHAPE[p.kind], PIECE_MATERIAL[p.kind], s.op, p.mirror ? 1 : 0);
    }
  };

  /** Gadget zones (and the screen's arrival jets) in cells, and the outlet when it's due. */
  const fillGadgets = (w: World, dt: number, t: number) => {
    const g = w.geometry;
    const connected = uplink?.connected ?? false;
    // With a screen above, geysers reach the top and what they lift leaves through the outlet.
    w.sizes.jetTop = connected ? -100 : g.height * 0.1;
    let n = w.gadgets.zones(w.sizes, zones);
    if (landing) {
      for (const j of landing.jets) {
        if (n >= MAX_ZONES) break;
        const x = j.x * g.cell;
        zones[n++] = {
          box: { x: x - 40, y: g.height * 0.55, width: 80, height: g.height * 0.45 },
          kind: "lift",
          strength: 0.95,
        };
      }
    }
    n = Math.min(n, MAX_ZONES);
    tick.zoneCount = n;
    tick.outlet.fill(0);
    let cols = 0;
    for (let i = 0; i < n; i++) {
      const z = zones[i];
      if (!z) continue;
      const x0 = z.box.x / g.cell;
      const x1 = (z.box.x + z.box.width) / g.cell;
      const y0 = (g.height - (z.box.y + z.box.height)) / g.cell;
      const y1 = (g.height - z.box.y) / g.cell;
      put4(tick.zoneA, i, x0, y0, x1, y1);
      put4(tick.zoneB, i, z.kind === "lift" ? 1 : z.kind === "right" ? 2 : 3, z.strength, 0, 0);
      if (z.kind === "lift" && z.box.y < 0) put4(tick.outletCols, cols++, x0, x1, 0, 0);
    }
    if (connected && cols > 0 && !outletPending && t - outletAt > 250) {
      put4(tick.outlet, 0, 6, cols, 0, 0);
      outletPending = true;
      outletAt = t;
    }
    tick.heatCount = 0;
    for (const gd of w.gadgets.list) {
      if (gd.kind === "spout") {
        const def = elementDef(gd.element);
        const mouth = venueToCell(g, gd.x + gd.dir * 50, gd.y + 30);
        const radius = Math.max(1.5, 14 / g.cell);
        const wanted = ((BASE_POUR_AREA * 0.5) / (g.cell * g.cell)) * dt;
        emit(
          mouth.x,
          mouth.y,
          mouth.x,
          mouth.y - radius,
          radius,
          Math.min(1, wanted / (radius * radius * 4)),
          gd.element,
          def.pour?.life ?? [0, 0],
        );
      } else if ((gd.kind === "heater" || gd.kind === "cooler") && tick.heatCount < MAX_HEATS) {
        const c = venueToCell(g, gd.x, gd.y);
        put4(
          tick.heats,
          tick.heatCount++,
          c.x,
          c.y,
          w.sizes.heatRadius / g.cell,
          gd.kind === "heater" ? 1 : -1,
        );
      }
    }
  };

  const fillWorldInputs = (w: World) => {
    const s = w.scene;
    director.levels(levels);
    tick.sink = s.openFloor ? Math.max(0.6, levels.sink) : levels.sink;
    tick.crumble = levels.crumble;
    tick.fade = levels.fade;
    if (s.sea) put4(tick.sea, 0, s.sea.x0, s.sea.x1, s.sea.level, 1);
    else tick.sea.fill(0);
    tick.cloudCount = 0;
    for (const c of w.weather.clouds) {
      if (tick.cloudCount >= MAX_CLOUDS) break;
      put4(tick.clouds, tick.cloudCount, c.x, c.y, c.rx, c.ry);
      tick.cloudCount++;
    }
    tick.wind = w.weather.wind;
    tick.erosion = s.erosion;
    tick.evaporation = s.evaporation;
    tick.condenseY = s.condenseY;
    tick.plantScale = s.plantScale;
  };

  const land = (t: number) => {
    if (!landing) return;
    landing.expire(t);
    const arrivals = inbox.take(ARRIVALS_PER_TICK);
    if (arrivals.length === 0) return;
    landing.land(arrivals, t, (x, element, count) => {
      const def = elementDef(element);
      const r = 2;
      const area = Math.PI * r * r + 2 * r * 6;
      emit(x, 3, x, 9, r, Math.min(1, count / area), element, def.pour?.life ?? [120, 200]);
    });
  };

  const update = (dt: number) => {
    const w = world;
    if (!w || disposed) return;
    const t = now();
    director.update(dt, t);
    w.weather.update(dt);
    w.gadgets.expire(t);
    w.critters.update(dt, t, ground, () => rng.next());

    const botsActive =
      w.bots && t - lastHuman > BOT_YIELD_MS ? Math.min(ctx.bots, MAX_GHOST_HANDS) : 0;
    w.bots?.update(dt, botsActive);
    w.attract?.update(dt, !w.bots && attractMode && !director.draining ? 1 : 0);

    // A slow GPU runs fewer ticks than updates; pours and weather pile up until the next one,
    // so a finger pours the same amount however many ticks the GPU manages.
    pendingDt += dt;
    if (ticksSinceRender < (gpu.software ? 1 : MAX_TICKS_PER_FRAME)) {
      tick.emitCount = 0;
      w.controls?.emit(fingerEmit, pendingDt, FINGER_EMITTERS);
      w.weather.emit(emit, pendingDt * 60);
      fillGadgets(w, pendingDt, t);
      land(t);
      fillWorldInputs(w);
      fillStamps(w.geometry);
      gpu.run((sim) => sim.tick(tick, passes));
      pendingDt = 0;
    }
    ticksSinceRender++;
  };

  // ---- Render -------------------------------------------------------------------------------

  const fillView = (w: World, t: number) => {
    const g = w.geometry;
    view.time = (t / 1000) % 3600;
    view.reveal = director.reveal;
    view.cloudCount = 0;
    for (const c of w.weather.clouds) {
      const i = view.cloudCount++;
      put4(view.clouds, i, c.x, c.y, c.rx, c.ry);
      put4(view.cloudLook, i, c.rain * 0.85, 0.82, c.seed, 0);
    }
    view.cursorCount = 0;
    view.ghostCount = 0;
    for (const f of w.controls?.fingers.values() ?? []) {
      if (f.mode !== "pour" && f.mode !== "place" && f.mode !== "move") continue;
      if (view.cursorCount < MAX_CURSORS) {
        const material =
          f.mode === "place" && f.place && !isTool(f.place)
            ? PIECE_MATERIAL[f.place]
            : f.mode === "move" && f.moving
              ? PIECE_MATERIAL[f.moving.kind]
              : f.mode === "place"
                ? E.SNOW
                : f.element;
        const [r, gg, b] = CURSOR_RGB[material] ?? [1, 1, 1];
        const i = view.cursorCount++;
        put4(view.cursors, i, f.x, f.y, CURSOR_RADIUS, f.synthetic ? 0.55 : 0.9);
        put4(view.cursorColors, i, r, gg, b, 0);
      }
      const kind =
        f.mode === "place" && f.place && !isTool(f.place)
          ? f.place
          : f.mode === "move"
            ? (f.moving?.kind ?? null)
            : null;
      if (kind && view.ghostCount < MAX_GHOSTS) {
        const spot = w.pieces.fit(kind, f.x, f.y);
        if (spot) {
          const c = venueToCell(g, spot.x, spot.y);
          const i = view.ghostCount++;
          put4(view.ghostA, i, c.x, c.y, spot.width / 2 / g.cell, spot.height / 2 / g.cell);
          put4(view.ghostB, i, PIECE_SHAPE[kind], spot.mirror ? 1 : 0, PIECE_MATERIAL[kind], 0);
        }
      }
    }
    view.fxCount = 0;
    for (let i = 0; i < tick.zoneCount && i < MAX_ZONES; i++) {
      const z = zones[i];
      if (!z) continue;
      put4(
        view.fxA,
        view.fxCount,
        z.box.x,
        Math.max(0, z.box.y),
        z.box.width,
        z.box.height + Math.min(0, z.box.y),
      );
      put4(view.fxB, view.fxCount++, z.kind === "lift" ? 1 : z.kind === "right" ? 2 : 3, 0, 0, 0);
    }
    view.glowCount = 0;
    for (const gd of w.gadgets.list) {
      if ((gd.kind === "heater" || gd.kind === "cooler") && view.glowCount < MAX_HEATS) {
        put4(
          view.glows,
          view.glowCount++,
          gd.x,
          gd.y,
          w.sizes.heatRadius,
          gd.kind === "heater" ? 1 : -1,
        );
      }
    }
  };

  const adapt = (t: number) => {
    if (lastRender) frameMs += (t - lastRender - frameMs) * 0.05;
    lastRender = t;
    // A slow GPU gets fewer passes per tick (slower motion) rather than a stalled page.
    if (frameMs > 34) slowFor++;
    else if (frameMs < 20) slowFor--;
    if (slowFor > 60) {
      passes = Math.max(MIN_PASSES, passes - 1);
      slowFor = 0;
    } else if (slowFor < -120) {
      passes = Math.min(PASSES, passes + 1);
      slowFor = 0;
    }
  };

  const render = () => {
    const w = world;
    if (!w || disposed) return;
    const t = now();
    ticksSinceRender = 0;
    adapt(t);
    fillView(w, t);
    gpu.run((sim, renderer) => {
      renderer.draw(sim.state, view, canvasSize(frame.width), canvasSize(frame.height));
      // Readbacks: never more than one of each in flight, and a new one never in the frame
      // that collected the last.
      const f = sim.pollStats();
      if (f !== null) {
        director.setFullness(f);
        statsAt = t;
      } else if (t - statsAt > STATS_MS) {
        statsAt = t;
        sim.requestStats();
      }
      const heights = sim.pollHeight();
      if (heights) {
        ground = groundFromHeights(heights, sim.heightColumns, w.geometry.cell, w.geometry.height);
        groundAt = t;
      } else if (w.critters.list.length > 0 && t - groundAt > GROUND_MS) {
        groundAt = t;
        const reach = frame.kind === "wall" ? frame.reach.adult + 0.08 : 1;
        sim.requestHeight(sim.height * Math.min(1, reach) - 1);
      }
      const out = sim.pollOutlet();
      if (out) {
        outletPending = false;
        if (uplink?.send(out, sim.width, sim.outletRows, t)) sent++;
      }
    });
    w.sprites.update(w.gadgets.list, w.critters.list);
    const pal = w.palette;
    if (pal) {
      const ghosts = w.bots ?? w.attract;
      for (let i = 0; i < MAX_GHOST_HANDS; i++) pal.ghost(i, ghosts?.touches[i] ?? null);
      if (t - markAt > 200) {
        markAt = t;
        pal.layouts.forEach((_, i) => {
          const pending = w.hands.pending(i, t);
          pal.mark(i, w.hands.current(i), pending?.type === "place" ? pending.place : null);
        });
      }
    }
  };

  build();
  if (gpu.software) passes = MIN_PASSES;
  const loop = ctx.loop({ hz: 60, update, render });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) build();
    }, 250);
  });

  // Tests and debugging only: a read-only view of the app's state.
  const debugKey = "__tinyworld";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          fingers: [...(world?.controls?.fingers.values() ?? [])].map((f) => ({
            mode: f.mode,
            element: elementDef(f.element).key,
            place: f.place,
          })),
          current:
            world?.palette?.layouts.map((_, i) => elementDef(world!.hands.current(i)).key) ?? [],
          pieces: world?.pieces.list.length ?? 0,
          gadgets: world?.gadgets.list.map((g) => g.kind) ?? [],
          beetles: world?.critters.list.length ?? 0,
          widgets: world?.palette?.layouts.map((l) => l.box) ?? [],
          sent,
          received,
        }),
      },
    });
  }

  return {
    reset() {
      world?.bots?.release();
      world?.attract?.release();
      world?.palette?.home();
      startDrain("idle");
    },
    attract() {
      attractMode = true;
      director.setAttract(true, now());
    },
    status() {
      return {
        fullness: Math.round(director.fullness * 100),
        pieces: world?.pieces.list.length ?? 0,
        gadgets: world?.gadgets.list.length ?? 0,
        beetles: world?.critters.list.length ?? 0,
        fingers: world?.controls?.fingers.size ?? 0,
        passes,
        gl: gpu.lost ? "lost" : gpu.ready ? (gpu.software ? "software" : "ok") : "starting",
        draining: director.cause ?? "",
        sent,
        received,
      };
    },
    homeSpot(size) {
      const g = world?.geometry;
      const box = g && !screen ? homeReserve(frame.kind, g, frame.reach) : null;
      if (!box || !g) return null;
      // Centre the runtime's control in the square kept for it.
      const cx = (box.x + box.width / 2) * g.unit;
      const cy = (box.y + box.height / 2) * g.unit;
      return { x: Math.round(cx - size / 2), y: Math.round(cy - size / 2) };
    },
    command(name) {
      if (name === "drain") startDrain("manual");
      else if (name === "gl-lose") gpu.simulateLoss(1500);
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      offNet();
      world?.bots?.dispose();
      world?.attract?.dispose();
      world?.palette?.dispose();
      world?.sprites.dispose();
      world?.controls?.clear();
      world = null;
      gpu.dispose();
      backdrop.remove();
      host.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
