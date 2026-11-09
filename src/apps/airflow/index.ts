import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { PALETTE } from "../../core/ui";
import { type Bots, type BotScene, createBots } from "./bots";
import {
  BULK_TAU,
  type Config,
  DISC_UNITS,
  FORCE_EMA,
  KINDS,
  nearestStep,
  PLUME_RANGE,
  RAMP_S,
  RAMP_STEPS,
  readConfig,
  SCREEN_SMOKE_HALF_LIFE_S,
  SCREEN_UREF,
  SIZE_S,
  SMAGORINSKY,
  SMOKE_HALF_LIFE_S,
  SPONGE_TAU,
  speedOf,
  tauOf,
  U_REF,
  type View as ViewName,
  VIEWS,
} from "./config";
import { createDirector, type Director, firstAct } from "./director";
import {
  coefficient,
  createTrack,
  fitArrows,
  type ForceTrack,
  hear,
  pause,
  settle,
  shown,
} from "./forces";
import { createGpu, type Gpu, type GpuCaps } from "./gpu/context";
import {
  type Affine,
  createKit,
  createSolver,
  type Kit,
  MASK_FLOATS,
  type Solver,
} from "./gpu/solver";
import { buildInlet, screenInlet } from "./inflow";
import { MAX_SHAPES, SOLID } from "./lattice";
import {
  apply,
  clampHandle,
  clampShape,
  computeLayout,
  homeOf,
  inBox,
  knobAt,
  type Layout,
  type Range,
  shapeAt,
  sizeButtonsAt,
  type Sting,
  sliderBox,
  sliderValue,
  streamAngle,
  travelOf,
} from "./layout";
import { createDownlink, createUplink, type Downlink, type Uplink } from "./link";
import { place, REACHES, SHAPE_IDS, SHAPES, type ShapeId, trianglesOf } from "./shapes";
import { createView, type View } from "./view";
import { encodePlume } from "./wire";

/** Bots step aside for this long after a person touches. */
const BOT_YIELD_MS = 15_000;
const MAX_FINGERS = 12;
const MAX_TOUCHES = 24;
/** Most lattice steps in one frame, whatever the clock says. */
const MAX_STEPS = 40;
/** Mask redraws within one frame's steps when something moves fast. */
const MAX_CHUNKS = 6;
const FORCE_MS = 160;
const PROBE_MS = 1000;
/** A flow that breaks this many times in a minute counts as unstable in the status. */
const RESET_WINDOW_MS = 60_000;
const HANDLE_GRIP = 30;
const KNOB_GRIP = 26;
const SHAPE_EASE_S = 0.07;
const ANGLE_EASE_S = 0.08;
const WIND_EASE_S = 1.2;
const DIRECTOR_EASE_S = 0.5;
/** Coefficient at which a force arrow is as long as the shape. */
const ARROW_FULL = 2.2;
const SCREEN_TAU = 0.52;
/** The governor never takes fewer than this share of the steps the clock asks for. */
const MIN_SHARE = 0.02;
/** A software rasteriser (no GPU) gets a lattice this much coarser and a smaller canvas. */
const SOFTWARE_COARSE = 2.5;
/**
 * Arrows pause while a shape moves faster than this share of the steady air, or turns faster
 * than this many degrees a second, and for MOVING_PAUSE_MS after.
 */
const MOVING_SHARE = 0.25;
const MOVING_SPIN = 30;
const MOVING_PAUSE_MS = 500;
/** A swapped-in shape pops up from this share of its size over POP_S seconds. */
const POP_FROM = 0.3;
const POP_S = 0.4;
/** A finger's obstacle grows in, and fades out after it lifts, over this long (seconds). */
const GROW_S = 0.25;
/** Fewest lattice steps in a frame. */
const MIN_STEPS = 3;
const BACK: [number, number, number] = [0.018, 0.026, 0.055];
const TINTS: [number, number, number][] = [
  [0.95, 0.97, 1.0],
  [0.42, 0.86, 1.0],
  [1.0, 0.52, 0.8],
];

interface StingState {
  shape: ShapeId;
  /** Handle centre and the shape's target angle (degrees anticlockwise as drawn). */
  hx: number;
  hy: number;
  angle: number;
  /** The shape's pose now, easing towards the handle's. */
  sx: number;
  sy: number;
  a: number;
  /** Pose at the last mask drawing. */
  mx: number;
  my: number;
  ma: number;
  /** Force coefficients along and across the stream, smoothed. */
  force: ForceTrack;
  /** A shape swapped in pops up from small: its share of its size now. */
  grow: number;
  /**
   * The size step asked for (an index into the sting's scales), and the shape's scale easing
   * towards it from `scaleFrom`, `scaleT` of the way there (1 when settled).
   */
  step: number;
  scale: number;
  scaleFrom: number;
  scaleT: number;
  /** The size drawn (grow times scale) at the last mask drawing. */
  mz: number;
  owner: number | null;
  turner: number | null;
}

interface ZoneState {
  /** Wind slider position asked for, and the inlet's now (easing towards it). */
  wind: number;
  now: number;
  view: ViewName;
  owner: number | null;
}

type Touch =
  | { kind: "handle"; sting: number; dx: number; dy: number }
  | { kind: "knob"; sting: number; last: number | null }
  | { kind: "slider"; zone: number }
  | { kind: "finger" }
  | { kind: "none" };

interface Finger {
  x: number;
  y: number;
  /** Position at the last mask drawing. */
  mx: number;
  my: number;
  /** Size (0 to 1) now and at the last mask drawing: an obstacle grows in and fades out. */
  k: number;
  mk: number;
  /** Still touching. */
  live: boolean;
}

const wrap = (a: number) => {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
};

const approach = (value: number, target: number, dt: number, tau: number): number =>
  tau <= 0 ? target : value + (target - value) * (1 - Math.exp(-dt / tau));

export const mount = (ctx: AppContext): AppInstance => {
  const kind = ctx.frame.kind;
  const config: Config = readConfig(ctx.variant, ctx.options, kind);
  const isScreen = kind === "screen" || ctx.setup.role === "screen";
  const inBank = ctx.setup.name === "bank";
  const span = kind === "pair" ? Math.max(2, ctx.frame.span ?? 2) : 1;
  const res = ctx.frame.pixelRatio / Math.min(window.devicePixelRatio || 1, 2);
  const now = () => performance.now();
  const mountedAt = now();
  const spec = KINDS[kind];
  /** This kind's steady inlet speed: the views and plumes measure against it. */
  const uRef = U_REF * spec.speed;

  let frame: FrameInfo = ctx.frame;
  let caps: GpuCaps = { software: false };
  let layout: Layout = makeLayout();
  let view: View | null = null;
  let gpu: Gpu | null = null;
  let kit: Kit | null = null;
  let solver: Solver | null = null;
  let disposed = false;

  function makeLayout(): Layout {
    const coarse = (1 / Math.min(1, Math.max(0.25, res))) * (caps.software ? SOFTWARE_COARSE : 1);
    return computeLayout({
      kind,
      venue: { width: frame.venueWidth, height: frame.venueHeight },
      reach: frame.reach,
      shapes: config.shapes,
      coarse,
      span,
      hands: config.hands,
    });
  }

  // ---- State -------------------------------------------------------------------------------

  /** Each sting starts with its first attract act's shape, so the show needs no swap. */
  const showOffset = (ctx.setup.pos * span * 3 + ctx.setup.side) % 7;
  const startShape = (i: number): ShapeId => firstAct(showOffset, i).shape;

  const restAngle = (id: ShapeId): number => {
    const def = SHAPES[id];
    return def.aligned ? streamAngle(layout.tunnel) + def.rest : def.rest;
  };

  const homeStep = (s: Sting) => nearestStep(s.scales, 1);

  const makeSting = (s: Sting, i: number): StingState => {
    const shape = startShape(i);
    const h = homeOf(s);
    const p = shapeAt(s, h.x, h.y);
    const a = restAngle(shape);
    return {
      shape,
      hx: h.x,
      hy: h.y,
      angle: a,
      sx: p.x,
      sy: p.y,
      a,
      mx: p.x,
      my: p.y,
      ma: a,
      force: createTrack(),
      grow: 1,
      step: homeStep(s),
      scale: 1,
      scaleFrom: 1,
      scaleT: 1,
      mz: 1,
      owner: null,
      turner: null,
    };
  };

  let stings: StingState[] = layout.stings.map(makeSting);
  let zones: ZoneState[] = layout.zones.map(() => ({
    wind: config.wind,
    now: config.wind,
    view: config.view,
    owner: null,
  }));
  const touches = new Map<number, Touch>();
  const fingers = new Map<number, Finger>();
  /** The hands variant's attract show: slow hands held in the stream by nobody. */
  const ghosts: Finger[] = [];
  let ghostT = 0;
  /** Everything round in the stream: fingers, then ghost hands. */
  const obstacles = (): Finger[] => [...fingers.values(), ...ghosts];
  const liveFingers = (): Finger[] => [...fingers.values()].filter((f) => f.live);
  let lastHuman = Number.NEGATIVE_INFINITY;
  let attractMode = true;
  let directorOff = false;
  /** Tests and debugging: draw another field (3 is density). */
  let debugView: number | null = null;
  const director: Director = createDirector(layout.stings.length, showOffset, config.wind);

  // Flow bookkeeping.
  let stepAcc = 0;
  let lastSteps = 0;
  /** Steps and time since the flow last started from still air. */
  let startSteps = 0;
  let startAt = now();
  let share = 1;
  let frameMs = 1000 / 60;
  let lastRender = 0;
  let stepsDone = 0;
  let stepsRate = 0;
  let rateAt = now();
  let rateSteps = 0;
  let forceAt = 0;
  let probeAt = 0;
  let topSpeed = 0;
  const resets: number[] = [];
  let resetCount = 0;
  const inletData = { buf: new Float32Array(0) };
  let inletKey = "";
  const maskVerts = new Float32Array(6000 * MASK_FLOATS);

  // ---- DOM ---------------------------------------------------------------------------------

  const backdrop = document.createElement("div");
  backdrop.style.cssText = `position:absolute;inset:0;background:${PALETTE.background};`;
  const glHost = document.createElement("div");
  glHost.style.cssText = "position:absolute;inset:0;";
  const viewHost = document.createElement("div");
  viewHost.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  ctx.root.append(backdrop, glHost, viewHost);

  /** The scale a sting's size step asks for. */
  const scaleOf = (i: number): number => {
    const s = stings[i];
    return (s && layout.stings[i]?.scales[s.step]) ?? 1;
  };

  /** The handle's range now: narrower while the shape is large, so the shape stays in its lane. */
  const rangeOf = (i: number): Range | null => {
    const s = stings[i];
    const spec = layout.stings[i];
    return s && spec ? travelOf(spec, s.shape, s.grow * s.scale) : null;
  };

  /** Dim a size button at its limit. */
  const showLimits = (i: number) => {
    const s = stings[i];
    const spec = layout.stings[i];
    if (s && spec) view?.sizeLimits(i, s.step > 0, s.step < spec.scales.length - 1);
  };

  /** Ask for a size step; the shape eases to it. False when it was already there or out of range. */
  const setStep = (i: number, step: number): boolean => {
    const s = stings[i];
    const spec = layout.stings[i];
    if (!s || !spec || step < 0 || step >= spec.scales.length || step === s.step) return false;
    s.step = step;
    s.scaleFrom = s.scale;
    s.scaleT = 0;
    showLimits(i);
    return true;
  };

  const trayOf = (s: StingState, n: number): ShapeId[] => {
    const at = SHAPE_IDS.indexOf(s.shape);
    return Array.from({ length: n }, (_, k) => SHAPE_IDS[(at + 1 + k) % SHAPE_IDS.length]!);
  };

  const buildView = () => {
    view?.dispose();
    view = createView(viewHost, layout);
    stings.forEach((s, i) => {
      view?.setShape(i, s.shape);
      view?.tiles(i, trayOf(s, layout.stings[i]?.tiles.length ?? 0));
      showLimits(i);
    });
    zones.forEach((z, i) => view?.view(i, z.view));
    view.invite(attractMode);
  };

  // ---- GPU -----------------------------------------------------------------------------------

  const canvasScale = () => {
    // Two canvas pixels per lattice cell is as sharp as the flow gets.
    const perCell = (layout.tunnel.cell * frame.unit) / 2;
    const most = caps.software ? Math.min(0.5, frame.pixelRatio) : frame.pixelRatio;
    return Math.min(most, Math.max(0.2, 1 / Math.max(1e-3, perCell)));
  };

  const sizeCanvas = () => {
    const s = canvasScale();
    gpu?.resize(frame.width * s, frame.height * s);
  };

  const discCells = () => ((DISC_UNITS / 100) * spec.shape) / layout.tunnel.cell;

  const buildSolver = (gl: WebGL2RenderingContext) => {
    solver?.dispose();
    solver = null;
    if (!kit || kit.gl !== gl) {
      kit?.dispose();
      kit = createKit(gl);
    }
    const t = layout.tunnel;
    solver = createSolver(kit, {
      width: t.width,
      height: t.height,
      visible: t.visible,
      plumeSamples: layout.plume?.samples ?? 1,
    });
    inletKey = "";
    drawMask(0, 1, 0);
    startFlow();
    stepAcc = 0;
  };

  /** Still air everywhere, smoke streaks across the tunnel, and the fan spinning up. */
  const startFlow = () => {
    if (!solver) return;
    startSteps = 0;
    startAt = now();
    writeInlet(true);
    solver.init();
  };

  const spinUp = () => {
    const q = Math.min(1, Math.max(startSteps / RAMP_STEPS, (now() - startAt) / 1000 / RAMP_S));
    return q * q * (3 - 2 * q);
  };

  const ensureGpu = () => {
    if (gpu) return;
    gpu = createGpu({
      host: glHost,
      onReady(gl, c) {
        const changed = c.software !== caps.software;
        caps = c;
        // A software rasteriser starts low and works up.
        if (c.software) share = Math.min(share, 0.3);
        if (changed) relayout();
        sizeCanvas();
        buildSolver(gl);
      },
      onLost() {
        solver = null;
        kit = null;
      },
      onError(message) {
        console.error(message);
      },
    });
    sizeCanvas();
  };

  const relayout = () => {
    const before = layout;
    layout = makeLayout();
    if (before.stings.length !== layout.stings.length) stings = layout.stings.map(makeSting);
    if (before.zones.length !== layout.zones.length) {
      zones = layout.zones.map(() => ({
        wind: config.wind,
        now: config.wind,
        view: config.view,
        owner: null,
      }));
    }
    stings.forEach((s, i) => {
      const spec = layout.stings[i];
      if (!spec) return;
      s.step = Math.min(s.step, spec.scales.length - 1);
      const h = clampHandle(spec, s.hx, s.hy, travelOf(spec, s.shape, s.grow * s.scale));
      s.hx = h.x;
      s.hy = h.y;
    });
    buildView();
    sizeCanvas();
    if (gpu?.ready) gpu.run((gl) => buildSolver(gl));
  };

  // ---- Inlet and mask ------------------------------------------------------------------------

  const downlink: Downlink | null = isScreen
    ? createDownlink(ctx.net, {
        side: ctx.setup.side,
        count: Math.max(1, ctx.setup.count),
        now,
        clock: () => ctx.clock.now(),
      })
    : null;
  const uplink: Uplink | null = inBank && !isScreen ? createUplink(ctx.net, ctx.setup.side) : null;

  const writeInlet = (force: boolean) => {
    if (!solver) return;
    const t = layout.tunnel;
    if (inletData.buf.length !== t.height * 8) inletData.buf = new Float32Array(t.height * 8);
    const ramp = spinUp();
    const spacing = spec.streak / t.cell;
    if (isScreen) {
      screenInlet(
        t,
        Math.max(1, ctx.setup.count),
        downlink!.slots,
        now(),
        (now() - mountedAt) / 1000,
        SCREEN_TAU,
        spacing,
        inletData.buf,
      );
      for (let r = 0; r < t.height; r++) {
        inletData.buf[r * 4] = inletData.buf[r * 4]! * ramp;
        inletData.buf[r * 4 + 1] = inletData.buf[r * 4 + 1]! * ramp;
      }
      solver.setInlet(inletData.buf);
      return;
    }
    const key = `${zones.map((z) => z.now.toFixed(4)).join(",")}:${ramp.toFixed(3)}`;
    if (!force && key === inletKey) return;
    inletKey = key;
    const disc = discCells();
    buildInlet(
      t.height,
      layout.zones.map((z, i) => ({
        rows: z.rows,
        speed: speedOf(zones[i]?.now ?? config.wind, spec.speed) * ramp,
        tau: tauOf(zones[i]?.now ?? config.wind, disc, spec.speed),
      })),
      spacing,
      inletData.buf,
    );
    solver.setInlet(inletData.buf);
  };

  /** Draw the solids at a pose between the last drawing (k = 0) and now (k = 1). */
  const drawMask = (from: number, to: number, steps: number) => {
    if (!solver) return;
    const t = layout.tunnel;
    let n = 0;
    const push = (x: number, y: number, vx: number, vy: number, id: number) => {
      if (n >= 6000) return;
      const o = n * MASK_FLOATS;
      maskVerts[o] = x;
      maskVerts[o + 1] = y;
      maskVerts[o + 2] = vx;
      maskVerts[o + 3] = vy;
      maskVerts[o + 4] = id;
      n++;
    };
    const per = steps > 0 ? 1 / steps : 0;
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    stings.forEach((s, i) => {
      const spec = layout.stings[i];
      if (!spec) return;
      const def = SHAPES[s.shape];
      const tri = trianglesOf(s.shape);
      const ax = lerp(s.mx, s.sx, from);
      const ay = lerp(s.my, s.sy, from);
      const aa = lerp(s.ma, s.a, from);
      const bx = lerp(s.mx, s.sx, to);
      const by = lerp(s.my, s.sy, to);
      const ba = lerp(s.ma, s.a, to);
      // Something growing pushes the air out with its rim, as something moving pushes it along.
      const az = spec.size * lerp(s.mz, s.grow * s.scale, from);
      const bz = spec.size * lerp(s.mz, s.grow * s.scale, to);
      for (const k of tri) {
        const p = def.outline[k]!;
        const [vx0, vy0] = place(p, ax, ay, aa, az);
        const [vx1, vy1] = place(p, bx, by, ba, bz);
        const [gx0, gy0] = apply(t.toGrid, vx0, vy0);
        const [gx1, gy1] = apply(t.toGrid, vx1, vy1);
        push(gx1, gy1, (gx1 - gx0) * per, (gy1 - gy0) * per, i + 1);
      }
    });
    const seg = 20;
    const r = layout.finger / t.cell;
    let drawn = 0;
    for (const f of obstacles()) {
      if (drawn >= MAX_FINGERS) break;
      const r0 = r * lerp(f.mk, f.k, from);
      const r1 = r * lerp(f.mk, f.k, to);
      if (r1 < 0.5) continue;
      drawn++;
      const [gx0, gy0] = apply(t.toGrid, lerp(f.mx, f.x, from), lerp(f.my, f.y, from));
      const [gx1, gy1] = apply(t.toGrid, lerp(f.mx, f.x, to), lerp(f.my, f.y, to));
      // Each vertex moves with the finger and, while it grows or fades, out or in with the rim.
      const rim = (a: number) => {
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const x1 = gx1 + c * r1;
        const y1 = gy1 + sn * r1;
        push(x1, y1, (x1 - gx0 - c * r0) * per, (y1 - gy0 - sn * r0) * per, SOLID.finger);
      };
      for (let k = 0; k < seg; k++) {
        push(gx1, gy1, (gx1 - gx0) * per, (gy1 - gy0) * per, SOLID.finger);
        rim((Math.PI * 2 * k) / seg);
        rim((Math.PI * 2 * (k + 1)) / seg);
      }
    }
    for (const [x0, y0, x1, y1] of layout.walls) {
      for (const [x, y] of [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y0],
        [x1, y1],
        [x0, y1],
      ] as const) {
        push(x, y, 0, 0, SOLID.wall);
      }
    }
    solver.drawMask(maskVerts, n);
  };

  /** How far, in cells, anything moved since the mask was last drawn. */
  const maskMotion = (): number => {
    const t = layout.tunnel;
    let m = 0;
    stings.forEach((s, i) => {
      const spec = layout.stings[i];
      if (!spec) return;
      const reach = spec.size / 2;
      const d =
        Math.hypot(s.sx - s.mx, s.sy - s.my) +
        (Math.abs(s.a - s.ma) * Math.PI * reach) / 180 +
        Math.abs(s.grow * s.scale - s.mz) * reach;
      m = Math.max(m, d / t.cell);
    });
    for (const f of obstacles()) {
      const d = Math.hypot(f.x - f.mx, f.y - f.my) + Math.abs(f.k - f.mk) * layout.finger;
      m = Math.max(m, d / t.cell);
    }
    return m;
  };

  const commitMask = () => {
    for (const s of stings) {
      s.mx = s.sx;
      s.my = s.sy;
      s.ma = s.a;
      s.mz = s.grow * s.scale;
    }
    for (const f of obstacles()) {
      f.mx = f.x;
      f.my = f.y;
      f.mk = f.k;
    }
    // A released finger is gone once its obstacle has faded from the mask.
    for (const [id, f] of fingers) if (!f.live && f.k <= 0 && f.mk <= 0) fingers.delete(id);
  };

  const restart = () => {
    if (!solver) return;
    resetCount++;
    resets.push(now());
    if (resets.length > 20) resets.shift();
    startFlow();
  };

  // ---- Input ---------------------------------------------------------------------------------

  const venueOf = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });

  const swapShape = (i: number, id: ShapeId) => {
    const s = stings[i];
    if (!s || s.shape === id) return;
    const before = restAngle(s.shape);
    s.shape = id;
    // Keep any turn the visitor gave, measured from the new shape's resting angle.
    const turn = s.angle - before;
    s.angle = restAngle(id) + (SHAPES[id].aligned ? Math.max(-40, Math.min(40, turn)) : 0);
    s.a = s.angle;
    s.ma = s.angle;
    settle(s.force, now());
    // The new shape pops up from small, so it pushes the air aside rather than all at once. It
    // keeps the sting's size.
    s.grow = POP_FROM;
    s.mz = POP_FROM * s.scale;
    view?.setShape(i, id);
    view?.tiles(i, trayOf(s, layout.stings[i]?.tiles.length ?? 0));
  };

  const onDown = (p: Pointer) => {
    if (isScreen) return;
    if (!p.synthetic) {
      lastHuman = now();
      if (attractMode) {
        attractMode = false;
        view?.invite(false);
      }
    }
    if (touches.size >= MAX_TOUCHES) {
      const first = touches.keys().next().value;
      if (first !== undefined) release(first);
    }
    const { x, y } = venueOf(p);
    for (const z of layout.zones) {
      const b = z.views.find((v) => inBox(v.box, x, y, 10));
      if (b) {
        const zs = zones[z.index];
        if (zs) zs.view = b.view;
        view?.view(z.index, b.view);
        touches.set(p.id, { kind: "none" });
        return;
      }
    }
    for (const z of layout.zones) {
      if (z.slider && inBox(sliderBox(z.slider), x, y, 20)) {
        const zs = zones[z.index];
        if (zs) {
          zs.owner = p.id;
          zs.wind = sliderValue(z.slider, x, y);
        }
        touches.set(p.id, { kind: "slider", zone: z.index });
        return;
      }
    }
    for (let i = 0; i < layout.stings.length; i++) {
      const spec = layout.stings[i]!;
      const k = spec.tiles.findIndex((t) => inBox(t, x, y, 8));
      if (k >= 0) {
        const s = stings[i];
        const id = s ? trayOf(s, spec.tiles.length)[k] : undefined;
        if (id) {
          swapShape(i, id);
          view?.flashTile(i, k);
        }
        touches.set(p.id, { kind: "none" });
        return;
      }
    }
    for (let i = 0; i < layout.stings.length; i++) {
      const s = stings[i];
      if (!s) continue;
      const b = sizeButtonsAt(layout.stings[i]!, s.hx, s.hy);
      const dir = inBox(b.bigger, x, y, 6) ? 1 : inBox(b.smaller, x, y, 6) ? -1 : 0;
      if (dir !== 0) {
        // At the limit the button is dim and does nothing.
        if (setStep(i, s.step + dir)) view?.flashSize(i, dir > 0 ? "bigger" : "smaller");
        touches.set(p.id, { kind: "none" });
        return;
      }
    }
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    stings.forEach((s, i) => {
      const spec = layout.stings[i];
      if (!spec) return;
      const d = Math.hypot(x - s.hx, y - s.hy);
      if (d <= spec.handle / 2 + HANDLE_GRIP && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best >= 0) {
      const s = stings[best]!;
      s.owner = p.id;
      touches.set(p.id, { kind: "handle", sting: best, dx: s.hx - x, dy: s.hy - y });
      return;
    }
    for (let i = 0; i < stings.length; i++) {
      const s = stings[i]!;
      const spec = layout.stings[i]!;
      const k = knobAt(spec, s.hx, s.hy);
      if (Math.hypot(x - k.x, y - k.y) <= spec.knob / 2 + KNOB_GRIP) {
        s.turner = p.id;
        touches.set(p.id, { kind: "knob", sting: i, last: null });
        turnKnob(i, x, y);
        return;
      }
    }
    const t = layout.tunnel.rect;
    const inConsole = layout.zones.some((z) => z.console && inBox(z.console, x, y));
    if (!inConsole && inBox(t, x, y) && liveFingers().length < MAX_FINGERS) {
      fingers.set(p.id, { x, y, mx: x, my: y, k: 0, mk: 0, live: true });
      touches.set(p.id, { kind: "finger" });
      return;
    }
    touches.set(p.id, { kind: "none" });
  };

  const turnKnob = (i: number, x: number, y: number) => {
    const s = stings[i];
    const spec = layout.stings[i];
    const t = touches.get(s?.turner ?? -1);
    if (!s || !spec || !t || t.kind !== "knob") return;
    const k = knobAt(spec, s.hx, s.hy);
    if (Math.hypot(x - k.x, y - k.y) < spec.knob * 0.12) return;
    const at = Math.atan2(y - k.y, x - k.x);
    if (t.last !== null) {
      // y points down, so a clockwise drag raises atan2 and turns the shape clockwise.
      s.angle -= (wrap(at - t.last) * 180) / Math.PI;
    }
    t.last = at;
  };

  const onMove = (p: Pointer) => {
    const t = touches.get(p.id);
    if (!t) return;
    const { x, y } = venueOf(p);
    if (t.kind === "handle") {
      const s = stings[t.sting];
      const spec = layout.stings[t.sting];
      if (!s || !spec || s.owner !== p.id) return;
      const h = clampHandle(spec, x + t.dx, y + t.dy, rangeOf(t.sting) ?? spec.travel);
      s.hx = h.x;
      s.hy = h.y;
    } else if (t.kind === "knob") {
      if (stings[t.sting]?.turner === p.id) turnKnob(t.sting, x, y);
    } else if (t.kind === "slider") {
      const z = layout.zones[t.zone];
      const zs = zones[t.zone];
      if (z?.slider && zs && zs.owner === p.id) zs.wind = sliderValue(z.slider, x, y);
    } else if (t.kind === "finger") {
      const f = fingers.get(p.id);
      if (f) {
        f.x = x;
        f.y = y;
      }
    }
  };

  const release = (id: number) => {
    const t = touches.get(id);
    touches.delete(id);
    if (!t) return;
    if (t.kind === "handle") {
      const s = stings[t.sting];
      if (s?.owner === id) s.owner = null;
    } else if (t.kind === "knob") {
      const s = stings[t.sting];
      if (s?.turner === id) s.turner = null;
    } else if (t.kind === "slider") {
      const z = zones[t.zone];
      if (z?.owner === id) z.owner = null;
    } else if (t.kind === "finger") {
      const f = fingers.get(id);
      if (f) f.live = false;
    }
  };

  const onUp = (p: Pointer) => release(p.id);

  const offInput = [
    ctx.input.on("down", onDown),
    ctx.input.on("move", onMove),
    ctx.input.on("up", onUp),
    ctx.input.on("cancel", onUp),
  ];

  const releaseAll = () => {
    for (const id of touches.keys()) release(id);
    fingers.clear();
  };

  // ---- Bots ----------------------------------------------------------------------------------

  const bots: Bots | null =
    ctx.bots > 0 && !isScreen
      ? createBots({
          input: ctx.input,
          rng: ctx.rng("airflow-bots"),
          count: Math.min(3, ctx.bots),
          unit: () => frame.unit,
          scene: (): BotScene => {
            const t = layout.tunnel.rect;
            const top = Math.max(t.y, layout.adultTop + 40);
            const stream =
              t.y + t.height - 60 > top
                ? {
                    x: t.x + t.width * 0.12,
                    y: top,
                    width: t.width * 0.5,
                    height: t.y + t.height - 60 - top,
                  }
                : null;
            return {
              handles: stings.map((s, i) => ({
                x: s.hx,
                y: s.hy,
                travel: rangeOf(i) ?? layout.stings[i]!.travel,
              })),
              knobs: stings.map((s, i) => {
                const spec = layout.stings[i]!;
                const k = knobAt(spec, s.hx, s.hy);
                return { x: k.x, y: k.y, r: spec.knob / 2 };
              }),
              tiles: layout.stings.flatMap((s) => s.tiles),
              sizes: stings.map((s, i) => ({
                ...sizeButtonsAt(layout.stings[i]!, s.hx, s.hy),
                size: scaleOf(i),
              })),
              sliders: layout.zones.flatMap((z) => (z.slider ? [z.slider] : [])),
              views: layout.zones.flatMap((z) => z.views.map((v) => v.box)),
              stream,
            };
          },
        })
      : null;

  // ---- Update (60 Hz) ------------------------------------------------------------------------

  /**
   * With nobody there, the hands variant holds a hand or two in the stream, drifting slowly
   * enough that eddies peel off them, within the reach band where hands would be.
   */
  const moveGhosts = (dt: number, on: boolean) => {
    if (!on || isScreen) {
      ghosts.length = 0;
      ghostT = 0;
      return;
    }
    ghostT += dt;
    const n = kind === "wall" ? 2 : 1;
    const r = layout.finger;
    const t = layout.tunnel.rect;
    const right = layout.tunnel.flow === "right";
    const x0 = right ? t.x + t.width * 0.15 : t.x + r + 20;
    const x1 = right ? t.x + t.width * 0.55 : t.x + t.width - r - 20;
    const y0 = right ? Math.max(t.y + r, layout.adultTop + r) : t.y + t.height * 0.4;
    const y1 = t.y + t.height - r - (right ? 30 : 60);
    while (ghosts.length < n) {
      ghosts.push({ x: x0, y: y1, mx: Number.NaN, my: Number.NaN, k: 0, mk: 0, live: true });
    }
    ghosts.forEach((g, i) => {
      const a = ghostT * 0.12 + i * 2.1;
      const u = 0.5 + 0.45 * Math.sin(a * 0.7 + i);
      const v = 0.5 + 0.45 * Math.sin(a * 0.45 + i * 1.7);
      g.x = x0 + (x1 - x0) * (n > 1 ? (i + u) / n : u);
      g.y = y0 + (y1 - y0) * v;
      // A new ghost appears where it stands rather than sweeping in.
      if (Number.isNaN(g.mx)) {
        g.mx = g.x;
        g.my = g.y;
      }
    });
  };

  const update = (dt: number) => {
    if (disposed) return;
    const t = now();
    // The screen eases each frame's plume in while it arrives and out when it stops.
    downlink?.slots.update(t, dt);
    const human = t - lastHuman < BOT_YIELD_MS;
    const botsOn = bots && !human ? Math.min(3, ctx.bots) : 0;
    bots?.update(dt, botsOn);
    const show = attractMode && !botsOn && !human && !directorOff;
    if (show && stings.length + zones.length > 0) {
      const acts = director.update(dt);
      acts.forEach((act, i) => {
        const s = stings[i];
        const spec = layout.stings[i];
        if (!s || !spec || s.owner !== null || s.turner !== null) return;
        if (act.shape !== s.shape) swapShape(i, act.shape);
        setStep(i, nearestStep(spec.scales, act.size));
        const range = rangeOf(i) ?? spec.travel;
        const hx = range.x0 + (range.x1 - range.x0) * act.u;
        const hy = range.y0 + (range.y1 - range.y0) * act.v;
        s.hx = approach(s.hx, hx, dt, DIRECTOR_EASE_S);
        s.hy = approach(s.hy, hy, dt, DIRECTOR_EASE_S);
        const flip = layout.tunnel.flow === "up" ? -1 : 1;
        s.angle = approach(s.angle, restAngle(s.shape) + act.turn * flip, dt, DIRECTOR_EASE_S);
      });
      const w = director.wind();
      for (const z of zones) if (z.owner === null) z.wind = w;
    }
    moveGhosts(dt, show && config.hands);
    for (const f of obstacles()) {
      f.k = Math.min(1, Math.max(0, f.k + (f.live ? dt : -dt) / GROW_S));
    }
    // Without a lattice to clear them from, released fingers go at once.
    if (!solver) for (const [id, f] of fingers) if (!f.live && f.k <= 0) fingers.delete(id);
    for (const s of stings) s.grow = Math.min(1, s.grow + dt / POP_S);
    stings.forEach((s, i) => {
      if (s.scaleT >= 1) return;
      s.scaleT = Math.min(1, s.scaleT + dt / SIZE_S);
      const e = s.scaleT * s.scaleT * (3 - 2 * s.scaleT);
      s.scale = s.scaleT >= 1 ? scaleOf(i) : s.scaleFrom + (scaleOf(i) - s.scaleFrom) * e;
      // A shape changing size feels mostly its own growth: the arrows wait, then come back.
      pause(s.force, t, MOVING_PAUSE_MS);
    });
    stings.forEach((s, i) => {
      const spec = layout.stings[i];
      if (!spec) return;
      // A growing shape needs room: its handle eases inward with the growth, held or not, and
      // the shape keeps inside its lane. Shrinking gives the room back.
      const h = clampHandle(spec, s.hx, s.hy, rangeOf(i) ?? spec.travel);
      s.hx = h.x;
      s.hy = h.y;
      const target = shapeAt(spec, s.hx, s.hy);
      const before = { x: s.sx, y: s.sy, a: s.a };
      const kept = clampShape(
        spec,
        approach(s.sx, target.x, dt, SHAPE_EASE_S),
        approach(s.sy, target.y, dt, SHAPE_EASE_S),
        REACHES[s.shape] * spec.size * s.grow * s.scale,
      );
      s.sx = kept.x;
      s.sy = kept.y;
      s.a = approach(s.a, s.angle, dt, ANGLE_EASE_S);
      // A shape moving fast through the air feels mostly its own motion (and the lattice's
      // reaction to cells flipping under it): the arrows wait until it slows.
      if (dt > 0) {
        const air = uRef * layout.tunnel.cell * stepsPerSecond();
        const speed = Math.hypot(s.sx - before.x, s.sy - before.y) / dt;
        const spin = Math.abs(s.a - before.a) / dt;
        if (speed > air * MOVING_SHARE || spin > MOVING_SPIN) pause(s.force, t, MOVING_PAUSE_MS);
      }
    });
    for (const z of zones) z.now = approach(z.now, z.wind, dt, WIND_EASE_S);
    // A long show could wind the angle up without bound; keep it within a turn of rest.
    for (const s of stings) {
      const rest = restAngle(s.shape);
      if (Math.abs(s.angle - rest) > 540) {
        const k = Math.round((s.angle - rest) / 360) * 360;
        s.angle -= k;
        s.a -= k;
        s.ma -= k;
      }
    }
  };

  // ---- Render --------------------------------------------------------------------------------

  const canvasToGrid = (): Affine => {
    const k = 1 / (frame.unit * canvasScale());
    const m = layout.tunnel.toGrid;
    return {
      r0: [m.r0[0] * k, m.r0[1] * k, m.r0[2]],
      r1: [m.r1[0] * k, m.r1[1] * k, m.r1[2]],
    };
  };

  const stepsPerSecond = () => {
    const uref = isScreen ? SCREEN_UREF : uRef;
    return layout.tunnel.visible / (uref * spec.crossing);
  };

  const stepParams = () => ({
    bulk: BULK_TAU,
    soft: true,
    smagorinsky: SMAGORINSKY,
    spongeFrom: layout.tunnel.visible,
    spongeTau: SPONGE_TAU,
    forceEma: FORCE_EMA,
  });

  const forceBoxes = (): [number, number, number, number][] => {
    const t = layout.tunnel;
    return stings.map((s, i) => {
      const spec = layout.stings[i]!;
      const r = (spec.size * 0.75 * Math.max(s.scale, scaleOf(i))) / t.cell + 3;
      const [gx, gy] = apply(t.toGrid, s.sx, s.sy);
      return [gx - r, gy - r, gx + r, gy + r];
    });
  };

  let forcesAt = 0;
  const readForces = (data: Float32Array) => {
    const t = layout.tunnel;
    const at = now();
    const dt = forcesAt ? (at - forcesAt) / 1000 : FORCE_MS / 1000;
    forcesAt = at;
    stings.forEach((s, i) => {
      if (i >= MAX_SHAPES) return;
      const sting = layout.stings[i]!;
      const zone = zones[sting.zone];
      const u = speedOf(zone?.now ?? config.wind, spec.speed);
      // Coefficients are per the shape's length now, so they hold steady as it grows.
      const len = ((SHAPES[s.shape].span / 100) * sting.size * s.scale) / t.cell;
      const fx = data[i * 3] ?? 0;
      const fy = data[i * 3 + 1] ?? 0;
      hear(s.force, coefficient(fx, u, len), coefficient(fy, u, len), at, dt);
    });
  };

  const readProbe = (data: Uint8Array) => {
    let bad = false;
    let top = 0;
    for (let i = 0; i < data.length; i += 4) {
      top = Math.max(top, data[i]!);
      if (data[i + 1]! > 128) bad = true;
    }
    topSpeed = (top / 255) * 0.5;
    if (bad) restart();
  };

  const render = () => {
    if (disposed) return;
    const t = now();
    const dt = lastRender ? Math.min(0.1, (t - lastRender) / 1000) : 1 / 60;
    if (lastRender) {
      const gap = t - lastRender;
      frameMs += (gap - frameMs) * 0.08;
      // Slow frames take fewer steps (the air slows); fast ones win them back. A very slow
      // frame cuts hard at once, so a weak GPU never stalls the page for long.
      // In the simulator many frames share one GPU and every frame is slow whatever this one
      // does, so the hard cut only comes when this frame's own steps were many.
      const k =
        gap > 90 && lastSteps > MIN_STEPS * 3
          ? 0.6
          : frameMs > 24
            ? 0.97
            : frameMs < 19
              ? 1.015
              : 1;
      share = Math.min(1, Math.max(MIN_SHARE, share * k));
    }
    lastRender = t;
    drawOverlay();
    if (!gpu || !solver) return;
    gpu.run((gl) => {
      const sv = solver;
      if (!sv) return;
      stepAcc += stepsPerSecond() * Math.min(dt, 1 / 20) * share;
      // A few steps every frame keep the air moving even on the slowest machine.
      const steps = Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.floor(stepAcc)));
      stepAcc = Math.max(0, Math.min(stepAcc - steps, 2));
      lastSteps = steps;
      writeInlet(false);
      // Something moving fast is drawn at several poses through the frame's steps, so it
      // never jumps more than about a cell at a time.
      const moved = maskMotion();
      const chunks = Math.max(1, Math.min(MAX_CHUNKS, steps, Math.ceil(moved / 1.2)));
      let done = 0;
      for (let c = 0; c < chunks; c++) {
        const n = Math.round((steps * (c + 1)) / chunks) - done;
        if (n <= 0) continue;
        drawMask(c / chunks, (c + 1) / chunks, n);
        sv.step(n, stepParams());
        done += n;
      }
      commitMask();
      stepsDone += steps;
      startSteps += steps;
      rateSteps += steps;
      if (t - rateAt >= 1000) {
        stepsRate = (rateSteps * 1000) / (t - rateAt);
        rateSteps = 0;
        rateAt = t;
      }
      sv.macro();
      // Smoke fades with the air's own time, so a slow machine shows the same streaks.
      const halfLife = isScreen ? SCREEN_SMOKE_HALF_LIFE_S : SMOKE_HALF_LIFE_S;
      const fade = 0.5 ** (steps / (halfLife * stepsPerSecond()));
      sv.advect(steps, fade, 1.5);
      const canvas = { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const toGrid = canvasToGrid();
      const k = frame.unit * canvasScale();
      const disc = Math.max(4, discCells());
      layout.zones.forEach((z, i) => {
        const zs = zones[i];
        const r = z.rect;
        gl.enable(gl.SCISSOR_TEST);
        const x0 = Math.floor(r.x * k);
        const y0 = Math.floor(canvas.height - (r.y + r.height) * k);
        gl.scissor(x0, y0, Math.ceil(r.width * k) + 1, Math.ceil(r.height * k) + 1);
        sv.render({
          toGrid,
          canvas,
          view: debugView ?? VIEWS.indexOf(zs?.view ?? "smoke"),
          uref: isScreen ? SCREEN_UREF : speedOf(zs?.now ?? config.wind, spec.speed),
          wref: ((isScreen ? SCREEN_UREF : uRef) / (isScreen ? 8 : disc)) * 1.6,
          tints: TINTS,
          back: BACK,
        });
        gl.disable(gl.SCISSOR_TEST);
      });
      // Readbacks: forces a few times a second, plumes for the screen, health once a second.
      const forces = sv.pollForces();
      if (forces) readForces(forces);
      if (stings.length > 0 && t - forceAt >= FORCE_MS) {
        forceAt = t;
        sv.requestForces(forceBoxes());
      }
      const plume = sv.pollPlume();
      if (plume && uplink && layout.plume) {
        const auto = t - lastHuman > BOT_YIELD_MS;
        uplink.send(encodePlume(ctx.setup.pos, plume, layout.plume.samples, ctx.clock.now(), auto));
      }
      if (uplink && layout.plume && uplink.due(t)) {
        const tn = layout.tunnel;
        sv.requestPlume({
          toGrid: tn.toGrid,
          line: layout.plume.line,
          width: layout.plume.width,
          samples: layout.plume.samples,
          dir: [-tn.down[1], -tn.across[1], tn.down[0], tn.across[0]],
          uref: uRef,
          range: PLUME_RANGE,
        });
      }
      const probe = sv.pollProbe();
      if (probe) readProbe(probe);
      if (t - probeAt >= PROBE_MS) {
        probeAt = t;
        sv.requestProbe();
      }
    });
  };

  /** The overlay: stings, arrows, sliders, rings. */
  const drawOverlay = () => {
    if (!view) return;
    const t = layout.tunnel;
    stings.forEach((s, i) => {
      const spec = layout.stings[i];
      if (!spec) return;
      const k = knobAt(spec, s.hx, s.hy);
      view?.sting(i, {
        hx: s.hx,
        hy: s.hy,
        sx: s.sx,
        sy: s.sy,
        kx: k.x,
        ky: k.y,
        angle: s.a,
        scale: s.grow * s.scale,
        held: s.owner !== null,
        turning: s.turner !== null,
      });
      if (!config.arrows) {
        view?.arrows(i, null, null);
        return;
      }
      // The arrows grow with the shape: the same coefficient on a bigger shape is a bigger force.
      const scale = (spec.size * s.scale) / ARROW_FULL;
      const show = shown(s.force);
      const cd = show * Math.max(0, Math.min(ARROW_FULL * 1.3, s.force.drag));
      const cl = show * Math.max(-ARROW_FULL, Math.min(ARROW_FULL, s.force.lift));
      const drag = { x: t.down[0] * cd * scale, y: t.down[1] * cd * scale };
      const lift = { x: t.across[0] * cl * scale, y: t.across[1] * cl * scale };
      const zone = layout.zones[spec.zone]?.rect ?? t.rect;
      const fit = fitArrows(s.sx, s.sy, [drag, lift], zone, 40);
      view?.arrows(
        i,
        { x: drag.x * fit, y: drag.y * fit },
        { x: lift.x * fit, y: lift.y * fit },
        s.scale,
      );
    });
    zones.forEach((z, i) => {
      view?.slider(i, z.now, z.owner !== null, 4 + z.now * 26);
    });
    const pts: { x: number; y: number; r: number }[] = [];
    for (const f of obstacles()) if (f.k > 0) pts.push({ x: f.x, y: f.y, r: layout.finger * f.k });
    view?.fingers(pts);
  };

  // ---- Start ---------------------------------------------------------------------------------

  buildView();
  ensureGpu();

  const loop = ctx.loop({ hz: 60, update, render });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      releaseAll();
      sizeCanvas();
    }, 200);
  });

  const toHome = () => {
    stings.forEach((s, i) => {
      const spec = layout.stings[i];
      if (!spec) return;
      swapShape(i, startShape(i));
      setStep(i, homeStep(spec));
      const h = homeOf(spec);
      s.hx = h.x;
      s.hy = h.y;
      s.angle = restAngle(s.shape);
    });
    zones.forEach((z, i) => {
      z.wind = config.wind;
      z.view = config.view;
      view?.view(i, z.view);
    });
  };

  const stable = () => resets.filter((r) => now() - r < RESET_WINDOW_MS).length === 0;

  // Tests and debugging only: a read-only view of the app's state, and a few levers.
  const debugKey = "__airflow";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          kind,
          screen: isScreen,
          grid: {
            width: layout.tunnel.width,
            height: layout.tunnel.height,
            visible: layout.tunnel.visible,
            cell: layout.tunnel.cell,
          },
          flow: layout.tunnel.flow,
          ready: gpu?.ready ?? false,
          software: caps.software,
          steps: stepsDone,
          rate: stepsRate,
          share,
          resets: resetCount,
          topSpeed,
          attract: attractMode,
          stings: stings.map((s, i) => ({
            shape: s.shape,
            size: scaleOf(i),
            scale: s.scale,
            sizeButtons: sizeButtonsAt(layout.stings[i]!, s.hx, s.hy),
            range: rangeOf(i),
            hx: s.hx,
            hy: s.hy,
            sx: s.sx,
            sy: s.sy,
            angle: s.a,
            drag: s.force.drag,
            lift: s.force.lift,
            held: s.owner !== null,
          })),
          zones: zones.map((z) => ({ wind: z.wind, now: z.now, view: z.view })),
          fingers: liveFingers().map((f) => ({ x: f.x, y: f.y })),
          layout: {
            stings: layout.stings,
            zones: layout.zones.map((z) => ({ ...z })),
            tunnel: { rect: layout.tunnel.rect, flow: layout.tunnel.flow },
            adultTop: layout.adultTop,
            childTop: layout.childTop,
            finger: layout.finger,
          },
          sent: uplink?.sent ?? 0,
          heard: downlink?.heard ?? 0,
          live: downlink ? downlink.slots.update(now(), 0) : [],
          weights: downlink
            ? Array.from(
                { length: Math.max(1, ctx.setup.count) },
                (_, i) => downlink.slots.get(i)?.weight ?? 0,
              )
            : [],
          losses: gpu?.losses ?? 0,
        }),
        /** Velocity, density - 1 and solid flag of the cell under a venue point. */
        sample: (x: number, y: number) => {
          let out: number[] | null = null;
          gpu?.run(() => {
            const [gx, gy] = apply(layout.tunnel.toGrid, x, y);
            out = solver?.readVelocity(Math.floor(gx), Math.floor(gy)) ?? null;
          });
          return out;
        },
        /** Run the shader step on a small lattice: returns the populations after `steps`. */
        gpuCheck: (opts: {
          width: number;
          height: number;
          mask: number[];
          inlet: number[];
          steps: number;
          smagorinsky: number;
          spongeFrom: number;
          spongeTau: number;
          forceEma: number;
          bulk: number;
          soft: boolean;
        }) => {
          let out: number[][] | null = null;
          gpu?.run(() => {
            if (!kit) return;
            const small = createSolver(kit, {
              width: opts.width,
              height: opts.height,
              visible: opts.width,
              plumeSamples: 1,
            });
            try {
              small.uploadMask(Uint8Array.from(opts.mask));
              small.setInlet(Float32Array.from(opts.inlet));
              small.init();
              small.step(opts.steps, opts);
              out = small.readPopulations().map((a) => Array.from(a));
            } finally {
              small.dispose();
            }
          });
          return out;
        },
        stopAttract: () => {
          attractMode = false;
          directorOff = true;
          view?.invite(false);
        },
        setWind: (zone: number, v: number) => {
          const z = zones[zone];
          if (z) z.wind = Math.min(1, Math.max(0, v));
        },
        setView: (zone: number, v: ViewName) => {
          const z = zones[zone];
          if (z && VIEWS.includes(v)) {
            z.view = v;
            view?.view(zone, v);
          }
        },
        setShape: (i: number, id: ShapeId) => swapShape(i, id),
        debugView: (v: number | null) => {
          debugView = v;
        },
        loseContext: (ms: number) => gpu?.simulateLoss(ms) ?? false,
        restart: () => gpu?.run(() => restart()),
      },
    });
  }

  return {
    reset() {
      bots?.release();
      releaseAll();
      director.restart();
      toHome();
    },
    attract() {
      attractMode = true;
      view?.invite(true);
    },
    status() {
      const t = layout.tunnel;
      const z = zones[0];
      return {
        grid: `${t.width}x${t.height}`,
        stepsPerSec: Math.round(stepsRate),
        wind: z ? Math.round(z.now * 100) / 100 : 0,
        view: z?.view ?? config.view,
        shapes: stings.map((s) => s.shape).join(",") || "none",
        sizes: stings.map((_, i) => scaleOf(i)).join(",") || "none",
        stable: stable(),
        resets: resetCount,
        gl: gpu?.ready ? (caps.software ? "software" : "ok") : "starting",
        ...(downlink ? { plumes: downlink.slots.update(now(), 0).length } : {}),
        ...(uplink ? { sent: uplink.sent } : {}),
      };
    },
    homeSpot(size) {
      if (kind !== "panel" && kind !== "pair") return null;
      // The top of the rightmost chimney, clear of the consoles' view buttons.
      const rect = layout.tunnel.rect;
      const x = (rect.x + rect.width - 30) * frame.unit - size;
      return { x: Math.round(x), y: Math.round(30 * frame.unit) };
    },
    command(name) {
      if (name === "restart") gpu?.run(() => restart());
      else if (name === "gl-lose") gpu?.simulateLoss(1500);
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offInput) off();
      bots?.dispose();
      uplink?.dispose();
      downlink?.dispose();
      view?.dispose();
      view = null;
      if (gpu) {
        const g = gpu;
        g.run(() => {
          solver?.dispose();
          kit?.dispose();
        });
        solver = null;
        kit = null;
        g.dispose();
        gpu = null;
      }
      backdrop.remove();
      glHost.remove();
      viewHost.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
