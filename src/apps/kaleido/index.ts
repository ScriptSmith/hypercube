import { bankFraction } from "../../core/layout";
import { PALETTE } from "../../core/ui";
import type { AppContext, AppInstance, FrameInfo, OptionValue, Pointer } from "../../core/types";
import { type Bots, createBots } from "./bots";
import {
  crowdClear,
  crowdFactor,
  gridFor,
  kaleidoQuality,
  type Mode,
  readConfig,
  tuningFor,
  type Variant,
} from "./config";
import { type CheckResult, type CheckScenario, runCheck } from "./gpu/check";
import { createGpu, type GpuCaps } from "./gpu/context";
import { createFluid, type Fluid, MAX_SPLATS, SETTLE_COLUMNS, type Splat } from "./gpu/fluid";
import { createKaleidoView, type KaleidoInputs, type KaleidoView, MAX_SWIRLS } from "./gpu/kaleido";
import { createInkView, type InkView, type LayerInputs } from "./gpu/view";
import { createFollower, drift, handTargets, type KHand } from "./kparams";
import { createGhosts } from "./ghosts";
import { createHourMarks } from "./labels";
import { createDownlink, createUplink, type RemoteFinger } from "./link";
import { createColourCycle, packRgb, paletteFor, type Rgb, unpackRgb } from "./palette";
import { createEmitters, createPourSet, type Pour, type PourLook, splatOf } from "./pours";
import { bandLook, bandTotal, browserKV, COLUMNS, createStrata, dayKey } from "./strata";
import type { InkMsg, WireFinger } from "./wire";

const MEASURE_MS = 500;
const SAVE_MS = 30_000;
const CLOCK_MS = 1000;
/**
 * Ink settles into the layers only within this long of a person's pour (it takes a few seconds
 * to rise). The attract's and bots' ink rises and fades at the top without settling, so an empty
 * room leaves no layer.
 */
const HUMAN_INK_MS = 20_000;
const BOT_YIELD_MS = 12_000;
const LAYER_FADE_S = 1.2;
const LAYER_UPLOAD_MS = 500;
/** Venue px between the bottom of the layers and where ink starts to settle into them. */
const SINK_BAND = 0.07;
const SINK_RATE = 1.6;
const SWIRL_RADIUS = 210;
const PREWARM_S = 4;
const RAINBOW_PICK = [0, 2, 4, 6];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const mount = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  let variant: Variant = config.variant;
  const kind = ctx.frame.kind;
  const isScreen = kind === "screen" || ctx.setup.role === "screen";
  const inBank = ctx.setup.name === "bank" && !isScreen;
  const side = ctx.setup.side;
  const pos = ctx.setup.pos;
  const count = Math.max(1, ctx.setup.count);
  const tuning = tuningFor(kind);
  // Frames of one bank share a seed; their position keeps their bots and colours apart.
  const where = `${side}.${pos}.${ctx.identity.frame ?? ""}`;
  const rng = ctx.rng(`kaleido.${where}`);
  let frame: FrameInfo = ctx.frame;
  let disposed = false;
  let fallback = "";

  const W = () => frame.venueWidth;
  const H = () => frame.venueHeight;
  const now = () => performance.now();

  // ---- Day's layers -------------------------------------------------------------------------

  const persistKey =
    ctx.identity.mode === "show" && ctx.identity.frame
      ? `${ctx.identity.frame}.${ctx.setup.group}`
      : null;
  const strata = createStrata({ kv: browserKV(), key: persistKey, today: dayKey(new Date()) });
  let hour = new Date().getHours();
  /** Debugging only: a fixed hour instead of the clock's. */
  let hourOverride = -1;
  let clockAt = 0;
  let saveAt = now();

  // ---- Mode ---------------------------------------------------------------------------------

  let connected = false;
  const mode = (): Mode => (isScreen ? "screen" : inBank && connected ? "station" : "solo");
  const showsLayers = () => variant === "strata" && config.strata && mode() !== "station";

  // ---- Pours ----------------------------------------------------------------------------------

  const pours = createPourSet(kind === "wall" ? 24 : 12);
  const cycle = createColourCycle(config.colours, rng.int(4));
  const remote = new Map<string, Pour>();
  let lastHuman = Number.NEGATIVE_INFINITY;
  let humanInkAt = Number.NEGATIVE_INFINITY;
  let attractMode = true;

  const look = (): PourLook => ({
    radius: tuning.radius,
    warm: tuning.warm,
    hot: tuning.hot,
    jetWarm: tuning.jetWarm,
    jetHot: tuning.jetHot,
    follow: tuning.follow,
    maxSpeed: tuning.physics.maxSpeed,
    inkRate: tuning.inkRate,
    inkStrength: tuning.inkStrength,
  });

  // The attract: pour spots drifting along the bottom in the ink mural; in the kaleidoscope one
  // slow demonstration hand in the middle of the reach band (never on a screen, which can't be
  // touched).
  const demoHand = config.variant === "kaleido";
  const emitters = createEmitters({
    count: demoHand
      ? isScreen
        ? 0
        : 1
      : isScreen
        ? 4
        : kind === "wall"
          ? 3
          : kind === "pair"
            ? 2
            : 1,
    x0: W() * (demoHand ? 0.2 : 0.08),
    x1: W() * (demoHand ? 0.8 : 0.92),
    y: demoHand ? H() * (1 - frame.reach.adult * 0.5) : isScreen ? H() * 0.95 : H() * 0.86,
    hotShare: isScreen ? 0.5 : 0.35,
    pour: demoHand ? [4, 7] : [3, 7],
    rest: demoHand ? [6, 12] : isScreen ? [1.5, 4.5] : [3, 8],
    colour: () => cycle.next(hour),
    rng: ctx.rng(`kaleido-attract.${where}`),
  });

  const venueOf = (p: Pointer) => ({
    x: p.x / frame.unit,
    y: p.y / frame.unit,
    vx: p.vx / frame.unit,
    vy: p.vy / frame.unit,
  });

  const onDown = (p: Pointer) => {
    if (isScreen) return;
    const v = venueOf(p);
    if (!p.synthetic) {
      lastHuman = now();
      attractMode = false;
    }
    pours.start(p.id, v.x, v.y, cycle.next(hour), !p.synthetic, now());
  };
  const onMove = (p: Pointer) => {
    const v = venueOf(p);
    pours.move(p.id, v.x, v.y, v.vx, v.vy);
    if (!p.synthetic) lastHuman = now();
  };
  const onUp = (p: Pointer) => pours.end(p.id);

  const offInput = [
    ctx.input.on("down", onDown),
    ctx.input.on("move", onMove),
    ctx.input.on("up", onUp),
    ctx.input.on("cancel", onUp),
  ];

  // ---- Bots -------------------------------------------------------------------------------------

  const botArea = () => {
    const top = Math.max(H() * (1 - frame.reach.adult) + 60, 60);
    return { x0: 120, x1: W() - 120, y0: top, y1: H() - 70 };
  };
  const bots: Bots | null =
    ctx.bots > 0 && !isScreen
      ? createBots(ctx.input, ctx.rng(`kaleido-bots.${where}`), botArea, () => frame.unit)
      : null;
  const botCount = Math.min(6, ctx.bots);

  // ---- Bank -------------------------------------------------------------------------------------

  const uplink = inBank ? createUplink(ctx.net, side) : null;
  const downlink = isScreen ? createDownlink(ctx.net, side) : null;

  const wireOf = (p: Pour): WireFinger => ({
    id: p.wire,
    x: bankFraction(pos, p.x / W(), count),
    y: clamp01(p.y / H()),
    vx: p.vx / H(),
    vy: p.vy / H(),
    rgb: packRgb(p.rgb),
    hot: p.hot,
    human: p.human,
  });

  const inkMessage = (): InkMsg => ({
    pos,
    count,
    fingers: [...pours.list, ...(variant === "strata" ? emitters.pours : [])].map(wireOf),
  });

  /** Screen px of jet per frame-height px of a finger's movement, for a remote frame. */
  const remoteScale = (f: RemoteFinger) => {
    const peer = ctx.net.peers().find((p) => p.frame === f.frame);
    const span = peer?.kind === "pair" ? (peer.span ?? 2) : 1;
    return W() / Math.max(1, f.count) / (1080 * span);
  };

  const syncRemote = (fingers: readonly RemoteFinger[], t: number) => {
    const live = new Set<string>();
    for (const f of fingers) {
      const key = `${f.frame}:${f.id}`;
      live.add(key);
      const s = remoteScale(f) * 1920;
      const x = f.x * W();
      // A couple of cells above the floor, which holds no upward flow.
      const y = H() - Math.max(60, 2.5 * (fluid ? W() / fluid.nx : 20));
      let p = remote.get(key);
      if (!p) {
        if (remote.size >= MAX_SPLATS) continue;
        p = {
          wire: 0,
          x,
          y,
          px: x,
          py: y,
          vx: 0,
          vy: 0,
          rgb: unpackRgb(f.rgb),
          hot: f.hot,
          human: f.human,
          since: t,
          phase: rng.range(0, Math.PI * 2),
        };
        remote.set(key, p);
      }
      p.x = x;
      p.vx = f.vx * s;
      p.vy = Math.min(0, f.vy * s);
      p.hot = f.hot;
      p.human = f.human;
    }
    for (const key of remote.keys()) if (!live.has(key)) remote.delete(key);
  };

  // ---- Kaleidoscope ---------------------------------------------------------------------------

  const follower = createFollower(drift(ctx.clock.now() / 1000, config.mirrors));
  let lastKAt = 0;

  const localHands = (): KHand[] =>
    [...pours.list, ...emitters.pours].map((p) => ({
      x: p.x / W(),
      b: clamp01((H() - p.y) / Math.max(1, H() * frame.reach.adult)),
      since: p.since,
    }));

  const stepParams = (t: number, fingers: readonly RemoteFinger[]) => {
    const dt = lastKAt ? Math.min(0.25, (t - lastKAt) / 1000) : 1 / 60;
    lastKAt = t;
    const base = drift(ctx.clock.now() / 1000, config.mirrors);
    let target = isScreen
      ? handTargets(
          fingers.map((f) => ({ x: f.x, b: 1 - f.y, since: f.since })),
          base,
        )
      : handTargets(localHands(), base);
    const sky = uplink?.sky(t);
    if (mode() === "station" && sky?.k) target = sky.k;
    follower.step(dt, target);
  };

  const kPalette = (): Rgb[] => {
    const p = paletteFor(hour, config.colours);
    return config.colours === "rainbow" ? RAINBOW_PICK.map((i) => p[i % p.length]!) : [...p];
  };

  // ---- GPU ------------------------------------------------------------------------------------

  const backdrop = document.createElement("div");
  backdrop.style.cssText = `position:absolute;inset:0;background:${PALETTE.background};`;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;";
  ctx.root.append(backdrop, host);
  const marks = createHourMarks(ctx.root, kind === "wall" || isScreen ? 34 : 30);
  const ghosts = isScreen ? null : createGhosts(ctx.root, kind === "wall" ? 190 : 160);
  const ghostPoints: { x: number; y: number }[] = [];

  let caps: GpuCaps = { float: true, software: false };
  let fluid: Fluid | null = null;
  let inkView: InkView | null = null;
  let kView: KaleidoView | null = null;
  let warned = false;
  let lastStepAt = 0;
  let steps = 0;
  let stepsAt = now();
  let sps = 0;
  let simTime = 0;
  let measureSim = 0;
  let measuredSim = 0;
  let paused = false;
  /** The whole frame's mean ink, measured; it shortens ink's life when a crowd fills the frame. */
  let meanInk = 0;
  let measuring: { lo: number; rate: number } | null = null;
  let layersVersion = -1;
  let layersAt = 0;
  let layerAlpha = showsLayers() ? 1 : 0;
  let glow = 0;
  let glowRgb: Rgb = [1, 1, 1];
  let settledToday = 0;
  const splats: Splat[] = [];

  const scaleOf = () => {
    if (variant === "kaleido") return kaleidoQuality(caps.software).scale;
    return caps.software ? 0.5 : 1;
  };
  const backing = () => ({
    width: frame.width * frame.pixelRatio * scaleOf(),
    height: frame.height * frame.pixelRatio * scaleOf(),
  });

  const dropGpuState = () => {
    fluid = null;
    inkView = null;
    kView = null;
  };

  let cellOverride = 0;
  /** Run a few seconds of the attract at once before the first frame, so water is never bare. */
  let prewarm = false;
  const buildGpu = (gl: WebGL2RenderingContext) => {
    fluid?.dispose();
    inkView?.dispose();
    kView?.dispose();
    dropGpuState();
    if (variant === "strata" && !caps.float) {
      variant = "kaleido";
      fallback = "no float render targets";
      if (!warned) {
        warned = true;
        console.warn(
          "kaleido: the ink mural needs EXT_color_buffer_float; showing the kaleidoscope",
        );
      }
    }
    sizeCanvas();
    if (variant === "strata") {
      const g = gridFor({ width: W(), height: H() }, backing(), caps.software);
      if (cellOverride > 0) g.cell = cellOverride;
      fluid = createFluid(gl, { width: W(), height: H(), ...g });
      inkView = createInkView(gl);
      layersVersion = -1;
      measuring = null;
      prewarm = attractMode && pours.size === 0;
    } else {
      kView = createKaleidoView(gl);
    }
    lastStepAt = 0;
  };

  const sizeCanvas = () => {
    const b = backing();
    gpu?.resize(b.width, b.height);
  };

  // `gpu` is assigned once createGpu returns; onReady runs inside it, so it never uses `gpu`.
  let gpu: ReturnType<typeof createGpu> | null = null;
  gpu = createGpu({
    host,
    onReady(gl, c) {
      caps = c;
      buildGpu(gl);
    },
    onLost() {
      dropGpuState();
    },
    onError(message) {
      console.error(message);
    },
  });
  sizeCanvas();

  // ---- Layers geometry --------------------------------------------------------------------------

  const layerEdges = (): number[] => {
    const zone = tuning.layerZone * H();
    const edges = [0];
    for (const t of strata.thicknesses()) edges.push(edges[edges.length - 1]! + t * zone);
    return edges;
  };

  const sinkZone = () => {
    if (mode() === "station") return { lo: 0, hi: 0, rate: 0 };
    const edges = showsLayers() ? layerEdges() : [0];
    const hi = Math.max(edges[edges.length - 1]!, H() * 0.03);
    return { lo: hi + H() * SINK_BAND, hi, rate: SINK_RATE };
  };

  const settle = (avg: Float32Array, lo: number, rate: number, seconds: number) => {
    const t = now();
    if (t - humanInkAt > HUMAN_INK_MS) {
      glow *= 0.7;
      return;
    }
    const area = ((W() / COLUMNS) * lo) / 1e4;
    let total = 0;
    let rgbSum: [number, number, number] = [0, 0, 0];
    for (let col = 0; col < SETTLE_COLUMNS; col++) {
      const r = avg[col * 3]!;
      const g = avg[col * 3 + 1]!;
      const b = avg[col * 3 + 2]!;
      const sum = r + g + b;
      if (sum < 1e-3) continue;
      const max = Math.max(r, g, b);
      const amount = sum * rate * area * seconds;
      strata.add(hour, col, [(r / max) * 0.92, (g / max) * 0.92, (b / max) * 0.92], amount);
      total += amount;
      rgbSum = [rgbSum[0] + r, rgbSum[1] + g, rgbSum[2] + b];
    }
    settledToday += total;
    const rateNow = total / Math.max(0.05, seconds);
    glow += (clamp01(rateNow / 3) - glow) * 0.3;
    const m = Math.max(rgbSum[0], rgbSum[1], rgbSum[2]);
    if (m > 1e-4) glowRgb = [rgbSum[0] / m, rgbSum[1] / m, rgbSum[2] / m];
  };

  const updateLayers = (t: number, dt: number) => {
    const want = showsLayers() ? 1 : 0;
    layerAlpha +=
      Math.sign(want - layerAlpha) * Math.min(Math.abs(want - layerAlpha), dt / LAYER_FADE_S);
    if (!inkView) return;
    if (strata.version !== layersVersion && t - layersAt >= LAYER_UPLOAD_MS) {
      layersVersion = strata.version;
      layersAt = t;
      inkView.setLayers(strata.bands.map(bandLook));
    }
  };

  const layerInputs = (): LayerInputs => {
    const edges = layerEdges();
    const n = strata.bands.length;
    let thinnest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) thinnest = Math.min(thinnest, edges[i + 1]! - edges[i]!);
    const current = strata.bands[n - 1]?.hour === hour;
    return {
      edges,
      bands: showsLayers() || layerAlpha > 0 ? n : 0,
      wave: n > 0 ? Math.min(9, thinnest * 0.28) : 0,
      alpha: config.strata ? layerAlpha : 0,
      glow: current ? glow : 0,
      glowRgb,
    };
  };

  let marksAt = 0;
  const showMarks = (t: number) => {
    if (t - marksAt < 250) return;
    marksAt = t;
    if (!config.strata || variant !== "strata") {
      marks.show([], frame.unit, 0);
      return;
    }
    const edges = layerEdges();
    marks.show(
      strata.bands.map((b, i) => ({ hour: b.hour, top: edges[i]!, bottom: edges[i + 1]! })),
      frame.unit,
      layerAlpha,
    );
  };

  // ---- Update (60 Hz) -----------------------------------------------------------------------

  const update = (dt: number) => {
    if (disposed) return;
    const t = now();
    if (t - clockAt >= CLOCK_MS) {
      clockAt = t;
      const d = new Date();
      hour = hourOverride >= 0 ? hourOverride : d.getHours();
      if (strata.roll(dayKey(d))) layersVersion = -1;
    }
    if (t - saveAt >= SAVE_MS) {
      saveAt = t;
      strata.save();
    }

    if (uplink) {
      const was = connected;
      connected = uplink.screen(t) !== null;
      if (connected !== was)
        ctx.log(connected ? "screen found" : "screen gone; drawing own layers");
      uplink.tick(t, inkMessage);
    }
    if (downlink) {
      downlink.beacon(t, () => ({
        side,
        variant,
        k: variant === "kaleido" ? { ...follower.now } : null,
      }));
      if (downlink.human(t, 1000)) {
        ctx.idle.poke();
        humanInkAt = t;
      }
    }
    if (pours.list.some((p) => p.human)) humanInkAt = t;

    const botsOn = bots && t - lastHuman > BOT_YIELD_MS ? botCount : 0;
    bots?.update(dt, botsOn);
    const emittersOn = isScreen
      ? variant === "strata" && (downlink?.frames(t) ?? 0) === 0
      : attractMode && botsOn === 0;
    emitters.update(dt, emittersOn, t);
    updateLayers(t, dt);
  };

  // ---- Render -----------------------------------------------------------------------------------

  const governedPhysics = { ...tuning.physics };
  /** The physics with ink's life shortened, and faint ink cleared, while a crowd fills the frame. */
  const governed = () => {
    Object.assign(governedPhysics, tuning.physics);
    governedPhysics.inkLife = tuning.physics.inkLife * crowdFactor(meanInk);
    governedPhysics.clear = tuning.physics.clear * crowdClear(meanInk);
    return governedPhysics;
  };

  /** One fluid step of `dt` seconds with every pour, then the settling measurements. */
  const stepStrata = (dt: number, t: number, fingers: readonly RemoteFinger[]) => {
    const f = fluid;
    if (!f) return;
    simTime += dt;
    const ts = simTime % 10_000;
    const childTop = (1 - frame.reach.child) * H();
    const lk = look();
    splats.length = 0;
    if (isScreen) syncRemote(fingers, t);
    for (const p of pours.list) {
      p.hot = p.y < childTop;
      splats.push(splatOf(p, lk, dt, ts));
    }
    for (const p of emitters.pours) splats.push(splatOf(p, lk, dt, ts));
    for (const p of remote.values()) splats.push(splatOf(p, lk, dt, ts));
    if (splats.length > MAX_SPLATS) splats.length = MAX_SPLATS;
    const sink = sinkZone();
    f.step(splats, { dt, time: ts, open: mode() === "station", sink, physics: governed() });
    steps++;

    const got = f.pollMeasure();
    if (got && measuring) {
      meanInk = got.mean;
      if (measuring.rate > 0) {
        settle(got.columns, measuring.lo, measuring.rate, Math.min(2, simTime - measuredSim));
      }
      measuredSim = simTime;
      measuring = null;
    }
    if (!measuring && simTime - measureSim >= MEASURE_MS / 1000) {
      const rate = showsLayers() ? sink.rate : 0;
      if (f.measure(sink)) {
        measureSim = simTime;
        if (rate === 0) measuredSim = simTime;
        measuring = { lo: sink.lo, rate };
      }
    }
    if (!showsLayers()) glow *= 0.95;
  };

  const drawStrata = (gl: WebGL2RenderingContext) => {
    if (!fluid || !inkView) return;
    inkView.draw(
      fluid.dye,
      { width: W(), height: H() },
      tuning.gain,
      layerInputs(),
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
    );
  };

  const renderStrata = (
    gl: WebGL2RenderingContext,
    t: number,
    fingers: readonly RemoteFinger[],
  ) => {
    const dt = lastStepAt ? Math.min(1 / 30, Math.max(1 / 240, (t - lastStepAt) / 1000)) : 1 / 60;
    lastStepAt = t;
    if (prewarm) {
      prewarm = false;
      const n = caps.software ? 48 : 240;
      const step = PREWARM_S / n;
      for (let i = 0; i < n && fluid; i++) {
        emitters.update(step, true, t);
        stepStrata(step, t, fingers);
      }
    }
    if (!paused) stepStrata(dt, t, fingers);
    drawStrata(gl);
  };

  const kaleidoInputs = (
    t: number,
    w: number,
    h: number,
    fingers: readonly RemoteFinger[],
  ): KaleidoInputs => {
    const q = kaleidoQuality(caps.software);
    const k = follower.now;
    const s = w / Math.max(1, frame.width);
    const st = ctx.clock.now() / 1000;
    const swirlR = SWIRL_RADIUS * frame.unit * s;
    const swirls: KaleidoInputs["swirls"][number][] = [];
    const twist = (since: number) =>
      1.7 * Math.min(1, (t - since) / 900) * (1 + 0.2 * Math.sin(t / 700));
    if (isScreen) {
      for (const f of fingers) {
        if (swirls.length >= MAX_SWIRLS) break;
        swirls.push({
          x: f.x * w,
          y: h * (1 - (0.62 + 0.35 * f.y)),
          r: swirlR * 2.2,
          angle: twist(f.since),
          rgb: unpackRgb(f.rgb),
        });
      }
    } else {
      for (const p of [...pours.list, ...emitters.pours]) {
        if (swirls.length >= MAX_SWIRLS) break;
        swirls.push({
          x: p.x * frame.unit * s,
          y: h - p.y * frame.unit * s,
          r: swirlR,
          angle: twist(p.since),
          rgb: p.rgb,
        });
      }
    }
    const half = Math.sqrt(w * h) / 2;
    return {
      centre: [w / 2, h / 2],
      scale: 1.15 / Math.max(1, half) / k.zoom,
      rot: k.rot,
      c: [k.cx, k.cy],
      offset: [0.22 * Math.sin(st / 41), 0.18 * Math.cos(st / 57)],
      trap: [0.35 * Math.cos(st / 67), 0.35 * Math.sin(st / 83)],
      mirrors: k.mirrors,
      fromMirrors: follower.fromMirrors,
      fade: follower.fade,
      palette: kPalette(),
      phase: (st / 150) % 1,
      iterations: q.iterations,
      supersample: q.supersample,
      swirls,
    };
  };

  const renderKaleido = (
    gl: WebGL2RenderingContext,
    t: number,
    fingers: readonly RemoteFinger[],
  ) => {
    const v = kView;
    if (!v) return;
    stepParams(t, fingers);
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    v.draw(kaleidoInputs(t, w, h, fingers), w, h);
    steps++;
  };

  const render = () => {
    if (disposed) return;
    const t = now();
    if (t - stepsAt >= 2000) {
      sps = Math.round((steps * 1000) / (t - stepsAt));
      steps = 0;
      stepsAt = t;
    }
    const fingers = downlink?.fingers(t) ?? [];
    gpu?.run((gl) => {
      if (variant === "strata") renderStrata(gl, t, fingers);
      else renderKaleido(gl, t, fingers);
    });
    showMarks(t);
    if (ghosts) {
      ghostPoints.length = 0;
      for (const p of emitters.pours) ghostPoints.push(p);
      for (const p of pours.list) if (!p.human) ghostPoints.push(p);
      ghosts.show(ghostPoints, frame.unit);
    }
  };

  const loop = ctx.loop({ hz: 60, update, render });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      sizeCanvas();
      if (variant !== "strata" || !fluid) return;
      const g = gridFor({ width: W(), height: H() }, backing(), caps.software);
      const nx = Math.round(W() / g.cell);
      if (Math.abs(nx - fluid.nx) / fluid.nx > 0.15) gpu?.run((gl) => buildGpu(gl));
    }, 250);
  });

  const onHide = () => strata.save();
  window.addEventListener("pagehide", onHide);

  /** Admin: `clear` empties today's layers; `gl-lose` tests context loss. */
  const command = (name: string) => {
    if (name === "clear") {
      strata.clear();
      strata.save();
      layersVersion = -1;
    } else if (name === "gl-lose") gpu?.simulateLoss(1500);
  };

  // ---- Debugging and tests --------------------------------------------------------------------

  const debugKey = "__kaleido";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          mode: mode(),
          variant,
          connected,
          pours: pours.list.length,
          humans: pours.list.filter((p) => p.human).length,
          remote: remote.size,
          emitters: emitters.pours.length,
          grid: fluid ? [fluid.nx, fluid.ny, fluid.mx, fluid.my] : null,
          bands: strata.bands.map((b) => ({ hour: b.hour, total: bandTotal(b) })),
          layerAlpha,
          sent: uplink?.sent ?? 0,
          received: downlink?.received ?? 0,
          frames: downlink?.frames(now()) ?? 0,
          params: { ...follower.now, fade: follower.fade },
          settledToday,
          meanInk,
          steps: sps,
          hour,
          day: strata.day,
        }),
        dye: () => {
          let out: { total: number; centroid: number; top: number; max: number } | null = null;
          gpu?.run(() => {
            if (!fluid) return;
            const d = fluid.readDye();
            let total = 0;
            let cy = 0;
            let top = 0;
            let max = 0;
            const { mx, my } = fluid;
            for (let y = 0; y < my; y++) {
              for (let x = 0; x < mx; x++) {
                const i = (y * mx + x) * 4;
                const s = d[i]! + d[i + 1]! + d[i + 2]!;
                total += s;
                // Rows run bottom to top; report height as a fraction from the bottom.
                cy += s * ((y + 0.5) / my);
                if (y >= my * 0.75) top += s;
                if (s > max) max = s;
              }
            }
            out = {
              total: total / (mx * my),
              centroid: total > 0 ? cy / total : 0,
              top: top / (mx * my),
              max,
            };
          });
          return out;
        },
        loseContext: (ms: number) => gpu?.simulateLoss(ms) ?? false,
        command,
        /** A synthetic touch at (u, v), fractions of the frame; returns its id for `lift`. */
        touch: (u: number, v: number) => ctx.input.inject.down(u * frame.width, v * frame.height),
        lift: (id: number) => ctx.input.inject.up(id),
        /** Where the screen pours remote ink, as fractions across it. */
        remoteAt: () => [...remote.values()].map((p) => p.x / W()),
        losses: () => gpu?.losses ?? 0,
        stopAttract: () => {
          attractMode = false;
          emitters.clear();
        },
        probe: (w: number, h: number) => {
          let out: number[] | null = null;
          gpu?.run(() => {
            if (kView) {
              out = Array.from(
                kView.sample(kaleidoInputs(now(), w, h, downlink?.fingers(now()) ?? []), w, h),
              );
            } else if (fluid && inkView) {
              const venue = { width: W(), height: H() };
              out = Array.from(inkView.sample(fluid.dye, venue, tuning.gain, layerInputs(), w, h));
            }
          });
          return out;
        },
        check: (s: Partial<CheckScenario> & { patch?: Partial<typeof tuning.physics> }) => {
          let out: CheckResult | null = null;
          gpu?.run((gl) => {
            if (!caps.float) return;
            out = runCheck(gl, {
              width: W(),
              height: H(),
              cell: 10,
              steps: 120,
              every: 10,
              pours: [],
              look: look(),
              ...s,
              // A quiet frame's physics (no crowd clearing), with any changes the test asks for.
              physics: { ...tuning.physics, clear: 0, ...s.patch },
            });
          });
          return out;
        },
        tuning: () => tuning,
        regrid: (cell: number) => {
          cellOverride = cell;
          gpu?.run((gl) => buildGpu(gl));
        },
        setPhysics: (p: Partial<typeof tuning.physics>) => Object.assign(tuning.physics, p),
        setLook: (p: Partial<typeof tuning>) => Object.assign(tuning, p),
        /** Review only: fill today with a made-up day of layers (never saved for preview frames). */
        fakeDay: (from: number, to: number) => {
          const r = ctx.rng("kaleido-fake");
          for (let h = from; h <= to; h++) {
            const busy = r.range(0.1, 1);
            for (let i = 0; i < 40; i++) {
              const col = Math.min(
                COLUMNS - 1,
                Math.floor(r.range(0, 1) ** (0.6 + r.next()) * COLUMNS),
              );
              strata.add(h, col, r.pick(paletteFor(h, config.colours)), r.range(10, 160) * busy);
            }
          }
        },
        setHour: (h: number) => {
          hourOverride = h;
          hour = h >= 0 ? h : new Date().getHours();
        },
        pause: (on: boolean) => {
          paused = on;
        },
        advance: (n: number) => {
          gpu?.run((gl) => {
            const fingers = downlink?.fingers(now()) ?? [];
            for (let i = 0; i < n; i++) stepStrata(1 / 60, now(), fingers);
            drawStrata(gl);
          });
          return simTime;
        },
      },
    });
  }

  return {
    reset() {
      bots?.release();
      pours.clear();
      remote.clear();
      emitters.clear();
    },
    attract() {
      attractMode = true;
    },
    status() {
      const out: Record<string, OptionValue> = {
        mode: mode(),
        variant,
        fingers: pours.list.length + (downlink?.fingers(now()).length ?? 0),
        grid: fluid ? `${fluid.nx}x${fluid.ny}` : "-",
        stepsPerSec: sps,
        bandsToday: strata.bands.length,
        palette: config.colours === "rainbow" ? "rainbow" : `hour ${hour}`,
        gl: gpu?.ready ? (caps.software ? "software" : "ok") : "starting",
      };
      if (fallback) out.fallback = fallback;
      return out;
    },
    command,
    dispose() {
      disposed = true;
      strata.save();
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      window.removeEventListener("pagehide", onHide);
      for (const off of offInput) off();
      uplink?.dispose();
      downlink?.dispose();
      bots?.dispose();
      gpu?.run(() => {
        fluid?.dispose();
        inkView?.dispose();
        kView?.dispose();
      });
      dropGpuState();
      gpu?.dispose();
      marks.dispose();
      ghosts?.dispose();
      backdrop.remove();
      host.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
