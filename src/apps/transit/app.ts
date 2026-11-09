/**
 * Brisbane Transit. Wires the pieces together:
 *
 * - data: network.ts (routes and shapes: bundled, then the day's), replay.ts (the bundled
 *   recording), feed.ts (the live feed: leader fetches, relays), wire.ts (messages), io.ts and
 *   worker.ts (every request, parsing and decoding, off the main thread)
 * - motion: fleet.ts (vehicles moving between fixes along shapes), match.ts
 * - drawing: map.ts and style.ts (MapLibre), layer.ts (vehicles and trails on the GPU)
 * - camera.ts (tour, follow and visitors' moves), views.ts (preset views), gesture.ts (drags,
 *   pinches and taps on the map)
 * - controls.ts, card.ts, layout.ts, highlight.ts (what visitors do), bots.ts
 */
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { withAlpha } from "../../core/ui/palette";
import { FONT } from "../../core/ui/style";
import { createBots } from "./bots";
import { createCard } from "./card";
import { createDirector, type CameraCommand } from "./camera";
import {
  BOOT_WAIT_MS,
  readConfig,
  STATIC_BASE,
  STATIC_RETRY_MS,
  STATIC_TIMEOUT_MS,
} from "./config";
import { createControls } from "./controls";
import { createLiveFeed, FEED_URL, FETCH_TIMEOUT_MS, pickSource } from "./feed";
import { createFleet, type Vehicle } from "./fleet";
import { type Bounds, REGION, toLat, toLocalX, toLocalY, toLon } from "./geo";
import { createGestures, type GestureEvent } from "./gesture";
import { createHighlights, type Pick } from "./highlight";
import { createIO } from "./io";
import { createVehicleLayer, LAYER_ID, type Look } from "./layer";
import { layoutFor, openArea, type TransitLayout, type ZoomAction } from "./layout";
import { createMap, FOLLOW_PITCH, type LineFeatures } from "./map";
import { emptyNetwork, headsignOf, mergeNetworks, type Network, unpackNetwork } from "./network";
import { decodeReplay, replaySnapshot, type Snapshot } from "./replay";
import { FEATURED, type Line, MODE_COLOR, MODE_DIM, MODE_RGB, type Mode, rgb } from "./routes";
import { ATTRIBUTION } from "./style";
import { cameraFor, VIEWS, zoomForSpan } from "./views";
import { decodeChunk, decodePick, encodeSnapshot, TOPIC } from "./wire";
import networkText from "./data/network.json?raw";
import replayText from "./data/replay.json?raw";

/** Ground height shown while following a vehicle. */
const FOLLOW_SPAN_M = 1800;
const APPROACH_MS = 3000;
const TAP_RADIUS = 150;
/** Kiosk colours for picks: palette indices not used by the modes. */
const PICK_COLORS = [5, 6, 4, 3];
const STILL_REPAINT_MS = 33;
/** The closest a visitor can zoom: this much ground across the map's height. */
const CLOSEST_SPAN_M = 700;
/** How far past the whole network a visitor can zoom out. */
const ZOOM_OUT_SLACK = 0.5;
const ZOOM_MS = 350;
/** A drag let go faster than this (venue px a second) glides on for FLING_MS. */
const FLING_MIN = 150;
const FLING_MS = 650;

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const mountTransit = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  const preview = ctx.identity.mode === "preview";
  const mountedAt = performance.now();
  let frame: FrameInfo = ctx.frame;
  const venueOf = (f: FrameInfo) => ({
    kind: f.kind,
    width: f.width / f.unit,
    height: f.height / f.unit,
    reachTop: { adult: f.reachTop.adult / f.unit, child: f.reachTop.child / f.unit },
  });
  let layout: TransitLayout = layoutFor(venueOf(frame));
  const isKiosk = frame.kind === "kiosk";
  const showsPicks = frame.kind === "wall" || frame.kind === "screen";
  const palette = ctx.ui.palette.players;

  // ---- Data -----------------------------------------------------------------------------------

  const bundled = unpackNetwork(parse(networkText), "bundled") ?? emptyNetwork();
  let network: Network = bundled;
  const replay = decodeReplay(parse(replayText));
  const fleet = createFleet({ trails: config.trails });
  const highlights = createHighlights();
  const io = createIO(
    () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  );
  const liveEnabled = config.variant === "live" && !preview;
  let seq = 0;
  let relayed = 0;
  let disposed = false;

  const applySnap = (snap: Snapshot) => {
    if (disposed) return;
    fleet.apply(snap, performance.now(), network);
  };

  const feed = liveEnabled
    ? createLiveFeed({
        fetcher: () => io.feed(FEED_URL, FETCH_TIMEOUT_MS),
        clock: () => performance.now(),
        start: mountedAt,
        onFetched(snap, relay) {
          applySnap(snap);
          if (relay && ctx.net.online) {
            for (const chunk of encodeSnapshot(snap, seq++)) ctx.net.send(TOPIC.snap, chunk);
            relayed++;
          }
        },
      })
    : null;

  let staticState: "bundled" | "loading" | "daily" | "failed" = "bundled";
  let staticTries = 0;
  let staticAt = preview ? Number.POSITIVE_INFINITY : mountedAt + 1500;
  const loadDaily = () => {
    staticState = "loading";
    void io.loadStatic(STATIC_BASE, STATIC_TIMEOUT_MS).then((packed) => {
      if (disposed) return;
      const daily = packed ? unpackNetwork(packed, "daily") : null;
      if (!daily || daily.routes.size === 0) {
        staticState = "failed";
        const wait = STATIC_RETRY_MS[staticTries++];
        staticAt = wait === undefined ? Number.POSITIVE_INFINITY : performance.now() + wait;
        return;
      }
      staticState = "daily";
      network = mergeNetworks(daily, bundled);
      fleet.remode(network);
      controls?.sketch(network);
      setBase();
      linesVersion = -1;
    });
  };

  // ---- Source: live or the replay -------------------------------------------------------------

  let source: "live" | "replay" | "none" = "none";
  let replayStep = -1;
  let replayLoop = -1;

  const chooseSource = (now: number) => {
    const want = pickSource({
      live: feed,
      hasReplay: replay !== null,
      now,
      mountedAt,
      bootWaitMs: BOOT_WAIT_MS,
    });
    if (want !== source) {
      if (want === "live") fleet.retire((v) => v.source === "replay", now);
      if (want === "replay") fleet.retire((v) => v.source === "live", now);
      source = want;
      replayStep = -1;
      replayLoop = -1;
      updateTag();
    }
    if (source !== "replay" || !replay) return;
    const t = ctx.clock.now() / 1000;
    const loop = Math.floor(t / replay.duration);
    const tau = t - loop * replay.duration;
    const step = Math.floor(tau / replay.every);
    if (loop === replayLoop && step === replayStep) return;
    if (replayLoop >= 0 && loop !== replayLoop) fleet.retire((v) => v.source === "replay", now);
    replayLoop = loop;
    replayStep = step;
    fleet.apply(replaySnapshot(replay, step * replay.every, loop), now, network);
  };

  // ---- DOM ------------------------------------------------------------------------------------

  const mapEl = document.createElement("div");
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2;";
  const credit = document.createElement("div");
  const tag = document.createElement("div");
  tag.textContent = "Replay";
  overlay.append(credit, tag);
  ctx.root.append(mapEl, overlay);
  let card = createCard(overlay, frame.unit, layout.card);

  const placeDom = () => {
    const u = frame.unit;
    const m = layout.map;
    mapEl.style.cssText = `position:absolute;left:${m.x * u}px;top:${m.y * u}px;width:${m.w * u}px;height:${m.h * u}px;z-index:1;`;
    const a = layout.attribution;
    const size = a.size * u;
    credit.textContent = ATTRIBUTION.join(" · ");
    credit.style.cssText =
      `position:absolute;font:500 ${size}px ${FONT};color:${withAlpha("#c9d3ea", 0.75)};` +
      `white-space:nowrap;bottom:${frame.height - a.y * u}px;` +
      `padding:${size * 0.2}px ${size * 0.5}px;border-radius:${size}px;` +
      `background:${withAlpha("#05070d", 0.6)};` +
      (a.align === "right"
        ? `right:${frame.width - a.x * u}px;`
        : `left:${a.x * u}px;transform:translateX(-50%);`);
    tag.style.cssText =
      `position:absolute;font:700 ${size * 1.05}px ${FONT};color:#05070d;background:#c9d3ea;` +
      `padding:${size * 0.2}px ${size * 0.6}px;border-radius:${size}px;white-space:nowrap;` +
      `bottom:${frame.height - a.y * u + size * 2.1}px;` +
      (a.align === "right"
        ? `right:${frame.width - a.x * u}px;`
        : `left:${a.x * u}px;transform:translateX(-50%);`);
    updateTag();
  };
  const updateTag = () => {
    tag.style.display = source === "replay" ? "block" : "none";
  };

  // ---- Highlight look ------------------------------------------------------------------------

  const lit = new Map<string, { focus: boolean; pick: Pick | null }>();
  let litVersion = -1;
  const litOf = (route: string, mode: Mode) => {
    if (litVersion !== highlights.version) {
      lit.clear();
      litVersion = highlights.version;
    }
    const k = `${mode}:${route}`;
    let l = lit.get(k);
    if (!l) {
      l = highlights.litBy(route, mode);
      lit.set(k, l);
    }
    return l;
  };
  const pickRgb = new Map<number, [number, number, number]>();
  const pickColor = (i: number) => {
    let c = pickRgb.get(i);
    if (!c) {
      c = rgb(palette[i % palette.length] ?? "#ffffff");
      pickRgb.set(i, c);
    }
    return c;
  };

  const lookOf = (v: Vehicle, out: Look) => {
    const [r, g, b] = MODE_RGB[v.mode];
    out.r = r;
    out.g = g;
    out.b = b;
    out.alpha = 1;
    out.scale = 1;
    out.ring = 0;
    out.trailAlpha = config.trails ? 0.32 : 0;
    out.trailWidth = 2.4;
    out.layer = 1;
    const l = litOf(v.route, v.mode);
    if (highlights.focus) {
      if (l.focus) {
        out.scale = 1.4;
        out.trailAlpha = 0.9;
        out.trailWidth = 3.6;
        out.layer = 2;
      } else if (!l.pick) {
        out.alpha = 0.22;
        out.scale = 0.8;
        out.trailAlpha = 0;
        out.layer = 0;
      }
    }
    if (l.pick && !l.focus) {
      const c = pickColor(l.pick.color);
      out.r = c[0];
      out.g = c[1];
      out.b = c[2];
      out.scale = 1.3;
      out.trailAlpha = 0.85;
      out.trailWidth = 3.4;
      out.layer = 2;
    }
    if (v.key === director.following) {
      out.scale = 1.6;
      out.ring = 1;
      out.alpha = 1;
      out.trailAlpha = Math.max(out.trailAlpha, 0.9);
      out.trailWidth = 4;
      out.layer = 2;
    }
    if (v.key === card.key) {
      out.ring = 1;
      out.alpha = 1;
      out.layer = 2;
    }
  };

  // ---- Map ------------------------------------------------------------------------------------

  const padCss = () => {
    const u = frame.unit;
    const p = layout.pad;
    return { top: p.top * u, right: p.right * u, bottom: p.bottom * u, left: p.left * u };
  };
  const camFor = (bounds: Bounds) =>
    cameraFor(bounds, layout.map.w * frame.unit, layout.map.h * frame.unit, padCss());
  let baseZoom = camFor(VIEWS.network).zoom;
  const director = createDirector(
    {
      tour: config.tour,
      fixed: config.view,
      random: frame.kind === "screen" && config.follow,
    },
    mountedAt,
  );

  const layer = createVehicleLayer({
    vehicles: () => fleet.vehicles,
    look: lookOf,
    glyphPx: (zoom) =>
      frame.unit *
      frame.pixelRatio *
      layout.glyph *
      Math.max(0.85, Math.min(1.9, 2 ** ((zoom - baseZoom) * 0.3))),
    trailPx: () => frame.unit * frame.pixelRatio * layout.glyph * 0.9,
    trailAgeMs: () => 120_000,
    now: () => performance.now(),
  });
  placeDom();
  const map = createMap({
    container: mapEl,
    io,
    pixelRatio: frame.pixelRatio,
    text: frame.unit * layout.text,
    line: frame.unit * layout.glyph * 0.75,
    start: camFor(VIEWS[director.view]),
    layer,
    offset: () => ({ x: layout.map.x * frame.unit, y: layout.map.y * frame.unit }),
  });

  /** Lon/lat coordinates of a shape. Not cached: a mode's lines are tens of thousands of points. */
  const lonLats = (pts: Float32Array): [number, number][] => {
    const c: [number, number][] = [];
    for (let i = 0; i < pts.length; i += 2) c.push([toLon(pts[i]!), toLat(pts[i + 1]!)]);
    return c;
  };
  const featuresFor = (
    has: (route: string, mode: Mode) => boolean,
    color: string,
  ): LineFeatures["features"] => {
    const out: LineFeatures["features"] = [];
    for (const [base, list] of network.byRoute) {
      const info = network.routes.get(base);
      const mode = info?.mode ?? "bus";
      if (!has(base, mode)) continue;
      for (const s of list) {
        if (s.dir !== 0 && list.some((o) => o.dir === 0)) continue;
        out.push({
          type: "Feature",
          properties: { color },
          geometry: { type: "LineString", coordinates: lonLats(s.pts) },
        });
      }
    }
    return out;
  };
  const setBase = () => {
    map.setBase({
      type: "FeatureCollection",
      features: [
        ...featuresFor((_b, m) => m === "train", MODE_DIM.train),
        ...featuresFor((_b, m) => m === "ferry", MODE_DIM.ferry),
      ],
    });
  };
  let linesVersion = -1;
  const refreshLines = () => {
    if (linesVersion === highlights.version) return;
    linesVersion = highlights.version;
    const features: LineFeatures["features"] = [];
    for (const p of highlights.picks.values()) {
      features.push(
        ...featuresFor((b) => p.line.has(b), palette[p.color % palette.length] ?? "#fff"),
      );
    }
    const f = highlights.focus;
    if (f?.kind === "mode")
      features.push(...featuresFor((_b, m) => m === f.mode, MODE_COLOR[f.mode]));
    if (f?.kind === "line")
      features.push(...featuresFor((b) => f.line.has(b), MODE_COLOR[f.line.mode]));
    map.setLines({ type: "FeatureCollection", features });
  };
  setBase();

  // ---- Camera ---------------------------------------------------------------------------------

  let followPhase: "approach" | "track" = "track";
  let approachUntil = 0;
  let lastFrame = mountedAt;

  const followZoom = () =>
    Math.min(17.5, zoomForSpan(FOLLOW_SPAN_M, layout.map.h * frame.unit, -27.47));

  const runCamera = (cmd: CameraCommand | null, now: number) => {
    if (!cmd) return;
    if (cmd.kind === "view") {
      map.fly(camFor(VIEWS[cmd.view]), cmd.duration, 0);
      return;
    }
    const v = fleet.vehicles.get(cmd.key);
    if (!v) return;
    followPhase = "approach";
    approachUntil = now + APPROACH_MS + 150;
    map.fly({ lon: toLon(v.x), lat: toLat(v.y), zoom: followZoom() }, APPROACH_MS, FOLLOW_PITCH);
  };

  const track = (now: number) => {
    const dt = Math.min(0.25, (now - lastFrame) / 1000);
    lastFrame = now;
    const key = director.following;
    if (director.mode !== "follow" || key === null) return;
    if (followPhase === "approach") {
      if (now < approachUntil) return;
      followPhase = "track";
    }
    const v = fleet.vehicles.get(key);
    if (!v) return;
    const c = map.center();
    const k = 1 - Math.exp(-dt * 2.5);
    map.jump(c.lon + (toLon(v.x) - c.lon) * k, c.lat + (toLat(v.y) - c.lat) * k);
  };

  const pickVehicle = (line: Line): number | null => {
    const c = map.center();
    const cx = toLocalX(c.lon);
    const cy = toLocalY(c.lat);
    let best: Vehicle | null = null;
    let bestScore = Infinity;
    for (const v of fleet.vehicles.values()) {
      if (v.alpha < 0.5 || v.retired || !line.has(v.route)) continue;
      const score = Math.hypot(v.x - cx, v.y - cy) * (v.total > 0 ? 1 : 3);
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best?.key ?? null;
  };

  const showLine = (line: Line) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [base, list] of network.byRoute) {
      if (!line.has(base)) continue;
      for (const s of list) {
        x0 = Math.min(x0, s.box[0]);
        y0 = Math.min(y0, s.box[1]);
        x1 = Math.max(x1, s.box[2]);
        y1 = Math.max(y1, s.box[3]);
      }
    }
    if (!Number.isFinite(x0)) return;
    map.fly(
      camFor({ west: toLon(x0), south: toLat(y0), east: toLon(x1), north: toLat(y1) }),
      5000,
      0,
    );
  };

  // ---- Visitors -------------------------------------------------------------------------------

  let humanAt = Number.NEGATIVE_INFINITY;
  let presses = 0;
  const gesturesFor = () =>
    createGestures({ slop: layout.slop * frame.unit, pinch: layout.pinch * frame.unit });
  let gestures = gesturesFor();
  let zoomTarget: number | null = null;

  const zoomRange = () => ({
    min: baseZoom - ZOOM_OUT_SLACK,
    max: Math.min(18, zoomForSpan(CLOSEST_SPAN_M, layout.map.h * frame.unit, -27.47)),
  });
  /** Map px of a stage point. */
  const mapX = (x: number) => x - layout.map.x * frame.unit;
  const mapY = (y: number) => y - layout.map.y * frame.unit;
  const clampLon = (lon: number) => Math.max(REGION.west, Math.min(REGION.east, lon));
  const clampLat = (lat: number) => Math.max(REGION.south, Math.min(REGION.north, lat));
  /** Keep a visitor's camera over the region. */
  const keepInRegion = () => {
    const c = map.center();
    const lon = clampLon(c.lon);
    const lat = clampLat(c.lat);
    if (lon !== c.lon || lat !== c.lat) map.jump(lon, lat);
  };
  const zoomTo = (zoom: number, x: number, y: number, ms: number) => {
    const r = zoomRange();
    const z = Math.max(r.min, Math.min(r.max, zoom));
    zoomTarget = ms > 0 ? z : null;
    map.zoomAround(z, x, y, ms);
  };

  const fling = (vx: number, vy: number) => {
    const speed = Math.hypot(vx, vy);
    if (speed < FLING_MIN * frame.unit) return;
    // An ease-out cubic starts at three times its average speed.
    const reach = Math.min((speed * FLING_MS) / 3000, layout.map.w * frame.unit * 0.5);
    const w = layout.map.w * frame.unit;
    const h = layout.map.h * frame.unit;
    const to = map.unproject(w / 2 - (vx / speed) * reach, h / 2 - (vy / speed) * reach);
    map.glide(clampLon(to.lon), clampLat(to.lat), FLING_MS);
  };

  const onGesture = (events: GestureEvent[], now: number) => {
    for (const e of events) {
      if (e.kind === "tap") tapAt(e.x, e.y, now);
      else if (e.kind === "start") director.manual(now);
      else if (e.kind === "pan") {
        map.pan(e.dx, e.dy);
        keepInRegion();
      } else if (e.kind === "zoom") {
        zoomTo(map.zoom() + Math.log2(e.scale), mapX(e.x), mapY(e.y), 0);
      } else if (e.kind === "end") {
        director.manual(now);
        fling(e.vx, e.vy);
      }
    }
  };

  const onZoom = (action: ZoomAction, human: boolean) => {
    const now = performance.now();
    if (human) humanAt = now;
    presses++;
    if (action === "reset") {
      runCamera(director.release(now), now);
      return;
    }
    director.manual(now);
    const from = zoomTarget !== null && map.moving() ? zoomTarget : map.zoom();
    const w = layout.map.w * frame.unit;
    const h = layout.map.h * frame.unit;
    zoomTo(from + (action === "in" ? 1 : -1), w / 2, h / 2, ZOOM_MS);
  };

  const onMode = (mode: Mode, human: boolean) => {
    const now = performance.now();
    if (human) humanAt = now;
    presses++;
    highlights.mode(mode, now);
  };

  const onLine = (id: string, human: boolean) => {
    const now = performance.now();
    if (human) humanAt = now;
    presses++;
    const line = highlights.line(id, now);
    if (!line) return;
    if (isKiosk && ctx.net.online) {
      ctx.net.send(TOPIC.pick, { line: id, color: kioskColor });
    }
    const key = pickVehicle(line);
    if (key !== null) {
      if (director.follow(key, now)) runCamera({ kind: "follow", key }, now);
    } else if (director.look(now)) showLine(line);
  };

  const kioskColor = (() => {
    let h = 0;
    for (const ch of ctx.net.self) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PICK_COLORS[h % PICK_COLORS.length]!;
  })();

  let controls: ReturnType<typeof createControls> | null = null;
  const buildControls = () => {
    controls?.dispose();
    controls =
      layout.modes.length || layout.lines.length
        ? createControls({ root: ctx.root, layout, unit: frame.unit, onMode, onLine, onZoom })
        : null;
    controls?.sketch(network);
  };
  buildControls();

  const cardFor = (v: Vehicle) => {
    const head = headsignOf(network, v.route, v.dir);
    return {
      key: v.key,
      mode: v.mode,
      title: v.mode === "train" ? (head ?? "Train") : v.route,
      subtitle: v.mode === "train" ? null : head,
    };
  };

  /** The drawn vehicle nearest to stage point (x, y) within `radius` stage px. */
  const nearest = (x: number, y: number, radius: number): Vehicle | null => {
    let best: Vehicle | null = null;
    let bestD = radius;
    for (const v of fleet.vehicles.values()) {
      if (v.alpha < 0.3 || v.retired) continue;
      const p = map.project(v.x, v.y);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  };

  /** Inside the map box and below venue y `top`. */
  const inMap = (x: number, y: number, top: number) => {
    const u = frame.unit;
    const m = layout.map;
    return (
      y >= top * u && x >= m.x * u && y >= m.y * u && x <= (m.x + m.w) * u && y <= (m.y + m.h) * u
    );
  };
  const inTapZone = (x: number, y: number) => inMap(x, y, layout.tapTop);
  /** Open map: not a console's backing, where a missed button press shouldn't count. */
  const onOpenMap = (x: number, y: number) => {
    if (!inMap(x, y, layout.dragTop)) return false;
    const u = frame.unit;
    return !layout.panels.some(
      (b) => x >= b.x * u && x <= (b.x + b.w) * u && y >= b.y * u && y <= (b.y + b.h) * u,
    );
  };

  const tapAt = (x: number, y: number, now: number) => {
    if (!inTapZone(x, y)) return;
    const v = nearest(x, y, TAP_RADIUS * frame.unit);
    if (!v) return;
    // A second tap on a vehicle whose card is up follows it, like a route button does.
    if (card.key === v.key && director.following !== v.key && director.follow(v.key, now)) {
      runCamera({ kind: "follow", key: v.key }, now);
    }
    card.show(cardFor(v), now);
  };

  const offs: (() => void)[] = [
    ctx.input.on("down", (p: Pointer) => {
      const now = performance.now();
      if (!p.synthetic) humanAt = now;
      if (!onOpenMap(p.x, p.y)) return;
      // Any touch on a map a visitor moved keeps it there a while longer.
      if (director.mode === "manual") director.manual(now);
      onGesture(gestures.down(p.id, p.x, p.y, now), now);
    }),
    ctx.input.on("move", (p: Pointer) => {
      const now = performance.now();
      onGesture(gestures.move(p.id, p.x, p.y, now), now);
    }),
    ctx.input.on("up", (p: Pointer) => {
      const now = performance.now();
      onGesture(gestures.up(p.id, p.x, p.y, now), now);
    }),
    ctx.input.on("cancel", (p: Pointer) => {
      onGesture(gestures.cancel(p.id), performance.now());
    }),
    ctx.net.on(TOPIC.snap, (data, from) => {
      if (!feed || from !== ctx.net.leader() || from === ctx.net.self) return;
      const snap = decodeChunk(data);
      if (!snap) return;
      feed.heard(performance.now());
      applySnap(snap);
    }),
    ctx.net.on(TOPIC.pick, (data, from) => {
      if (!showsPicks) return;
      const p = decodePick(data);
      if (p) highlights.pick(from, p.line, p.color, performance.now());
    }),
  ];

  const bots =
    ctx.bots > 0 && frame.touch && (layout.modes.length > 0 || layout.lines.length > 0)
      ? createBots({
          input: ctx.input,
          rng: ctx.rng("transit:bots"),
          buttons: () => controls?.targets() ?? [],
          vehicles: () => {
            const out: { kind: "vehicle"; id: string; x: number; y: number }[] = [];
            const u = frame.unit;
            for (const v of fleet.vehicles.values()) {
              if (v.alpha < 0.8 || out.length >= 40) continue;
              const p = map.project(v.x, v.y);
              if (!p || !inTapZone(p.x, p.y)) continue;
              if (p.x < 20 * u || p.x > frame.width - 20 * u || p.y > frame.height - 20 * u)
                continue;
              const r = ctx.root.getBoundingClientRect();
              const under = document.elementFromPoint(
                r.left + (p.x / frame.width) * r.width,
                r.top + (p.y / frame.height) * r.height,
              );
              if (under?.closest("[role=button]")) continue;
              out.push({ kind: "vehicle", id: String(v.key), x: p.x, y: p.y });
            }
            return out;
          },
          open: () => {
            const a = openArea(layout);
            const u = frame.unit;
            const m = 60;
            if (!a || a.w < 3 * m || a.h < 3 * m) return null;
            return {
              x: (a.x + m) * u,
              y: (a.y + m) * u,
              w: (a.w - 2 * m) * u,
              h: (a.h - 2 * m) * u,
            };
          },
          humanAt: () => humanAt,
          start: mountedAt,
        })
      : null;

  // ---- Loop -----------------------------------------------------------------------------------

  let repaintAt = 0;
  const loop = ctx.loop({
    hz: 10,
    update() {
      if (disposed) return;
      const now = performance.now();
      if (now >= staticAt && staticState !== "loading" && staticState !== "daily") {
        staticAt = Number.POSITIVE_INFINITY;
        loadDaily();
      }
      feed?.tick(now, ctx.net.leader() === ctx.net.self, ctx.net.online);
      chooseSource(now);
      highlights.expire(now);
      refreshLines();
      // A finger holding the map still keeps it from flying off.
      if (gestures.active) director.manual(now);
      runCamera(
        director.tick(
          now,
          (key) => fleet.vehicles.has(key),
          () => randomVehicle(),
        ),
        now,
      );
      bots?.tick(now);
      if (controls) {
        const z = map.zoom();
        const r = zoomRange();
        controls.zoomable(z < r.max - 0.01, z > r.min + 0.01);
      }
    },
    render() {
      if (disposed) return;
      const now = performance.now();
      fleet.step(now);
      track(now);
      const at = card.key !== null ? fleet.vehicles.get(card.key) : undefined;
      card.update(
        now,
        at ? map.project(at.x, at.y) : null,
        frame.width,
        layout.map.y * frame.unit + layout.map.h * frame.unit,
        0,
      );
      controls?.update(highlights.focus, now);
      if (director.mode === "manual" && !map.moving()) keepInRegion();
      if (map.moving() || director.mode === "follow" || now - repaintAt >= STILL_REPAINT_MS) {
        repaintAt = now;
        map.repaint();
      }
    },
  });

  const pickRng = ctx.rng("transit:random-follow");
  /** A moving vehicle already in view: the camera closes in on it rather than flying away. */
  const randomVehicle = (): number | null => {
    const list: number[] = [];
    const w = layout.map.w * frame.unit;
    const h = layout.map.h * frame.unit;
    for (const v of fleet.vehicles.values()) {
      if (v.alpha < 0.9 || v.retired || v.total < 20) continue;
      const p = map.project(v.x, v.y);
      if (!p || p.x < w * 0.1 || p.x > w * 0.9 || p.y < h * 0.1 || p.y > h * 0.9) continue;
      list.push(v.key);
      if (list.length >= 400) break;
    }
    return list.length ? pickRng.pick(list) : null;
  };

  loop.start();

  // ---- Resize ---------------------------------------------------------------------------------

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      layout = layoutFor(venueOf(frame));
      gestures = gesturesFor();
      placeDom();
      buildControls();
      card.dispose();
      card = createCard(overlay, frame.unit, layout.card);
      map.resize(frame.pixelRatio);
      baseZoom = camFor(VIEWS.network).zoom;
      if (director.mode === "tour") map.fly(camFor(VIEWS[director.view]), 0, 0);
    }, 150);
  });

  // ---- Debug and tests ------------------------------------------------------------------------

  const debugKey = "__transit";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const now = performance.now();
          const visible: { key: number; route: string; mode: Mode; x: number; y: number }[] = [];
          for (const v of fleet.vehicles.values()) {
            if (v.alpha < 0.9 || visible.length >= 200) continue;
            const p = map.project(v.x, v.y);
            if (!p || p.x < 0 || p.y < 0 || p.x > frame.width || p.y > frame.height) continue;
            visible.push({ key: v.key, route: v.route, mode: v.mode, x: p.x, y: p.y });
          }
          const f = highlights.focus;
          return {
            source,
            vehicles: fleet.count(),
            visible,
            camera: {
              mode: director.mode,
              view: director.view,
              following: director.following,
              zoom: map.zoom(),
              center: map.center(),
              pitch: map.map.getPitch(),
              range: zoomRange(),
              moving: map.moving(),
            },
            gesture: { active: gestures.active, fingers: gestures.fingers },
            focus: f ? { kind: f.kind, id: f.kind === "mode" ? f.mode : f.line.id } : null,
            picks: [...highlights.picks.values()].map((p) => ({ line: p.line.id, color: p.color })),
            lines: FEATURED.map((l) => ({
              id: l.id,
              vehicles: [...fleet.vehicles.values()].filter((v) => v.alpha > 0.5 && l.has(v.route))
                .length,
            })),
            kioskColor,
            card: card.info ? { ...card.info } : null,
            buttons: controls?.targets() ?? [],
            tapTop: layout.tapTop * frame.unit,
            static: network.source,
            staticState,
            feed: feed
              ? {
                  fetches: feed.fetches,
                  failures: feed.failures,
                  age: (now - feed.lastLive) / 1000,
                }
              : null,
            relayed,
            presses,
            bots: bots ? { actions: bots.actions, last: bots.last, drags: bots.drags } : null,
            map: {
              loaded: map.loaded,
              errors: map.errors,
              lastError: map.lastError,
              layer: map.loaded && map.map.getLayer(LAYER_ID) !== undefined,
            },
            layer: layer.stats(),
            threaded: io.threaded,
            tag: tag.style.display !== "none",
          };
        },
        setTiming(t: {
          follow?: number;
          tour?: number;
          manual?: number;
          mode?: number;
          line?: number;
          pick?: number;
        }) {
          director.setTiming(t, performance.now());
          highlights.setTiming(t);
        },
      },
    });
  }

  return {
    reset() {
      const now = performance.now();
      highlights.clear();
      card.hide();
      gestures.clear();
      if (director.mode !== "tour") runCamera(director.release(now), now);
    },
    attract() {},
    status() {
      const now = performance.now();
      return {
        source,
        vehicles: fleet.count(),
        feedAge:
          feed && Number.isFinite(feed.lastLive) ? Math.round((now - feed.lastLive) / 1000) : -1,
        static: staticState,
        view: director.view,
        camera: director.mode,
        mapErrors: map.errors,
      };
    },
    command(name) {
      if (name === "next") runCamera(director.release(performance.now()), performance.now());
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      bots?.dispose();
      feed?.dispose();
      controls?.dispose();
      card.dispose();
      map.dispose();
      io.dispose();
      fleet.clear();
      lit.clear();
      mapEl.remove();
      overlay.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
