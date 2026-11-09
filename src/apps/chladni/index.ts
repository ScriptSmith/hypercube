import { venueSize } from "../../core/frame";
import { PALETTE } from "../../core/ui";
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { createPlateArt, type PlateArt } from "./art";
import { type Bots, createBots } from "./bots";
import { readConfig, tintIndex } from "./config";
import {
  createGlides,
  createKeys,
  createMotion,
  type Glides,
  type Keys,
  LATCH_MS,
  lift,
  type PlateMotion,
} from "./drive";
import { drawMotion, noteColor } from "./figure";
import { createGpu, type Gpu, type GpuCaps } from "./gpu/context";
import { createSand, createSandKit, type Sand, type SandKit } from "./gpu/sand";
import {
  createSprinkler,
  grainCount,
  grainSize,
  levels,
  type Sprinkler,
  stateSize,
} from "./grains";
import {
  approach,
  clampPoint,
  clean,
  HOME_GLIDE_S,
  type KnobId,
  knobHome,
  type Knobs,
  qOf,
  STRETCH_EASE_S,
} from "./knobs";
import {
  computeLayout,
  fromPlate,
  glideT,
  inBox,
  type Layout,
  mapRect,
  type Mode as LayoutMode,
  plateAt,
  plateRect,
  type Rect,
  screenWide,
  stripT,
  toPlate,
} from "./layout";
import { createDownlink, createUplink, type Downlink, type Uplink } from "./link";
import {
  type Drive,
  formModes,
  HOME,
  glideAt,
  glideScale,
  type GlideScale,
  halfSides,
  type Mode,
  modeId,
  modesFor,
  type Point,
  ringsAt,
  turnToward,
} from "./modes";
import { createTune, type Tune, type TuneState } from "./tune";
import { createView, needleFor, type View } from "./view";
import {
  encodePlate,
  KNOB_CODES,
  PLATE_BUSY_MS,
  PLATE_MS,
  type PlateMsg,
  SCREEN_TIMEOUT_MS,
} from "./wire";

/** A plate still for this long gets fresh sand, slowly. */
const QUIET_MS = 30_000;
const QUIET_SPRINKLE_MS = 9000;
const RESET_SPRINKLE_MS = 1800;
const TUNE_SPRINKLE_MS = 3000;
const BOT_YIELD_MS = 15_000;
/** A screen with touch frames but no drive from them for this long plays its own tune. */
const SCREEN_ATTRACT_MS = 20_000;
/** Longest simulation step; slow frames take several. */
const STEP_MAX_S = 1 / 30;
const MAX_STEPS = 3;
/** How far a grain shivers at full local motion, venue px either way. */
const SHIVER_PX = 4;
const MAX_TOUCHES = 20;
/** Remote key glows fade if the screen's reports stop. */
const REMOTE_STALE_MS = 1500;
/** A knob let go here keeps showing its own value this long, until the screen's report agrees. */
const LOCAL_HOLD_MS = 1200;
/** Key pictures follow a stretch in this many steps, at most this often. */
const RESTYLE_STEPS = 20;
const RESTYLE_MS = 120;
/** Maps of a plate on this frame redraw this often. */
const MAP_MS = 200;
/** Puck size on plates, venue px, and the extra reach of its grip. */
const PUCK_PX: Record<string, number> = { wall: 170, screen: 260, kiosk: 100 };
const PUCK_DEFAULT = 112;
const PUCK_GRIP = 26;
/** The attract show turns a knob this often and puts it back after holding it this long. */
const SHOW_EVERY_MS = 22_000;
const SHOW_HOLD_MS = 11_000;
/** Below this a key's figure counts as unable to ring from the drive point. */
const LIVE_FROM = 0.3;
const LIVE_FULL = 0.6;

interface PlateState {
  motion: PlateMotion;
  keys: Keys;
  glides: Glides;
  sprinkler: Sprinkler;
  sand: Sand | null;
  stillSince: number;
  quietDone: boolean;
  tune: Tune | null;
  tuneState: TuneState | null;
  /** What the controls ask for. */
  knobs: Knobs;
  /** The stretch the plate is at now, easing towards the knob's. */
  stretch: number;
  /** Where idle or the attract show is gliding the knobs, or null. */
  goal: { at: Point | null; stretch: number | null } | null;
  /** The attract show: when it next turns a knob, and when it puts it back. */
  showAt: number;
  showBack: number | null;
  /** The plate's modes in its current form, and the stretch step they were built at. */
  modes: readonly Mode[];
  /** Stretch step of the key pictures, and when they were last redrawn. */
  styled: number;
  styledAt: number;
  turn: number;
}

type Touch =
  | { kind: "key"; key: number }
  | { kind: "glide"; glide: number }
  | { kind: "slider"; slider: number }
  | { kind: "puck"; plate: number; map: number | null; du: number; dv: number }
  | { kind: "damp"; plate: number }
  | { kind: "none" };

/** A knob touched on this frame of a bank: its value and since when a finger has held it. */
interface LocalKnob {
  x: number;
  y: number;
  held: boolean;
  since: number;
  releasedAt: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How well a mode can ring from the drive point, 0 to 1, for dimming keys and marks. */
const liveOf = (mode: Mode | undefined, at: Point): number =>
  mode ? smooth(LIVE_FROM, LIVE_FULL, ringsAt(mode, at)) : 1;

export const mount = (ctx: AppContext): AppInstance => {
  const kind = ctx.frame.kind;
  const config = readConfig(ctx.variant, ctx.options, kind);
  const shape = config.shape;
  const baseModes = modesFor(shape);
  const round = shape === "round";
  const isScreen = kind === "screen" || ctx.setup.role === "screen";
  const inBank = ctx.setup.name === "bank";
  const side = ctx.setup.side;
  const pos = ctx.setup.pos;
  const count = Math.max(1, ctx.setup.count);
  const span = kind === "pair" ? Math.max(2, ctx.frame.span ?? 2) : 1;
  const seedRng = ctx.rng(`chladni:${ctx.identity.frame ?? "local"}`);
  const res = ctx.frame.pixelRatio / Math.min(window.devicePixelRatio || 1, 2);
  const now = () => performance.now();
  const shared = () => ctx.clock.now();
  const mountedAt = now();
  const puckSize = PUCK_PX[kind] ?? PUCK_DEFAULT;
  // A bank's touch frames show the screen's plate, which stretches the screen's way.
  const bankWide = screenWide(venueSize("screen"));

  let frame: FrameInfo = ctx.frame;
  let mode: LayoutMode = isScreen ? "screen" : inBank ? "keyboard" : "solo";
  let layout: Layout = makeLayout();
  let view: View | null = null;
  let art: PlateArt | null = null;
  let plates: PlateState[] = [];
  let caps: GpuCaps = { software: false };
  let kit: SandKit | null = null;
  let gpu: Gpu | null = null;
  let disposed = false;
  let tick = 1;
  let lastRender = 0;
  let frameMs = 16.7;
  let share = 1;
  let lastHuman = Number.NEGATIVE_INFINITY;
  let attractMode = true;
  let lastPlate = mountedAt;
  const remoteRe = new Float64Array(baseModes.length);
  const remoteIm = new Float64Array(baseModes.length);
  const remoteAmps = new Float64Array(baseModes.length);
  let remoteOrder: number[] = [];
  let remoteAt = Number.NEGATIVE_INFINITY;
  let remoteGlide: number | null = null;
  /** The screen's knobs as its last report gave them (a bank's touch frames). */
  const sharedKnobs: Knobs & { wide: boolean } = { ...knobHome(shape), wide: bankWide };
  const localKnobs = new Map<KnobId, LocalKnob>();
  let mapAt = Number.NEGATIVE_INFINITY;
  let remoteDirty = false;
  const touches = new Map<number, Touch>();
  const glideOwner = new Map<number, number>();
  const sliderOwner = new Map<number, number>();
  const puckOwner = new Map<number, number>();
  const needles: (number | null)[] = [];
  let screenScaleAxis: GlideScale = glideScale(baseModes.map((m) => m.freq));
  let screenScaleNow = screenScaleAxis;

  function makeLayout(): Layout {
    return computeLayout({
      kind,
      mode,
      venue: { width: frame.venueWidth, height: frame.venueHeight },
      reach: frame.reach,
      shape,
      keys: config.keys,
      plates: config.plates,
      controls: {
        glide: config.glide,
        stretch: config.stretch,
        damping: config.damping,
        puck: config.puck,
      },
      modeCount: baseModes.length,
      span,
      pos,
      count,
    });
  }

  const makePlate = (): PlateState => ({
    motion: createMotion(baseModes.length),
    keys: createKeys(),
    glides: createGlides(),
    sprinkler: createSprinkler(),
    sand: null,
    stillSince: now(),
    quietDone: true,
    tune: null,
    tuneState: null,
    knobs: knobHome(shape),
    stretch: 0,
    goal: null,
    showAt: 0,
    showBack: null,
    modes: baseModes,
    styled: 0,
    styledAt: Number.NEGATIVE_INFINITY,
    turn: 0,
  });

  // ---- DOM -----------------------------------------------------------------------------------

  const backdrop = document.createElement("div");
  backdrop.style.cssText =
    "position:absolute;inset:0;background:radial-gradient(ellipse at 50% 40%,#0c1119 0%," +
    `${PALETTE.background} 75%);`;
  const artHost = document.createElement("div");
  artHost.style.cssText = "position:absolute;inset:0;overflow:hidden;";
  const glHost = document.createElement("div");
  glHost.style.cssText = "position:absolute;inset:0;";
  ctx.root.append(backdrop, artHost, glHost);

  const scaleOf = () => frame.pixelRatio * (caps.software ? 0.5 : 1);

  // ---- Plate forms ---------------------------------------------------------------------------

  const wideOf = (i: number) => layout.plates[i]?.wide ?? true;
  const rectOf = (i: number): Rect | null => {
    const box = layout.plates[i];
    const p = plates[i];
    return box && p ? plateRect(box, p.stretch) : null;
  };

  /** Turn a round plate's figures to put the drive point on their axis. */
  const turnFor = turnToward;

  const reform = (p: PlateState, wide: boolean) => {
    p.turn = round ? turnFor(p.knobs.at, p.turn) : 0;
    p.modes = formModes(shape, { stretch: p.stretch, wide, turn: p.turn });
  };

  // ---- Tunes ---------------------------------------------------------------------------------

  const tuneFor = (plate: number): Tune => {
    if (mode === "screen") {
      return createTune(
        ctx.rng(`chladni-tune-s${side}-${plate}`),
        baseModes.map((m) => ({ key: null, mode: m.index })),
        [{ strip: -1, scale: screenScaleAxis }],
      );
    }
    const notes = layout.keys
      .filter((k) => k.plate === plate)
      .map((k) => ({ key: k.index, mode: k.mode }));
    const strips = layout.glides
      .filter((g) => g.plate === plate)
      .map((g) => ({ strip: g.index, scale: view?.glideScale(g.index) ?? glideScale([1]) }));
    // Each frame of a bank plays its own tune when it falls back to a plate of its own.
    return createTune(ctx.rng(`chladni-tune-${side}-${pos}-${plate}`), notes, strips);
  };

  /** The frequency at `t` on strip `strip` as the plate is now (the screen's strip is -1). */
  const stripFreq = (strip: number, t: number): number => {
    const scale = strip < 0 ? screenScaleNow : view?.glideScale(strip);
    return scale ? glideAt(scale, t) : 1;
  };

  // ---- Layout and mode -------------------------------------------------------------------------

  const resetPlate = (plate: number) => {
    if (mode === "keyboard") {
      uplink?.sprinkle();
      return;
    }
    plates[plate]?.sprinkler.start(now(), RESET_SPRINKLE_MS, seedRng.int(2 ** 31));
  };

  const relayout = () => {
    layout = makeLayout();
    view?.dispose();
    view = createView({
      root: ctx.root,
      layout,
      unit: frame.unit,
      pixelRatio: frame.pixelRatio,
      shape,
      modes: baseModes,
      puckSize,
      wide: bankWide,
      ui: ctx.ui,
      onReset: (p) => resetPlate(p),
    });
    // Round keys draw their figures as the plate draws them from the drive point's home.
    if (round) {
      const facing = formModes(shape, { stretch: 0, wide: true, turn: turnToward(HOME.round) });
      for (let i = 0; i < Math.max(1, layout.plates.length); i++) view.restyle(i, facing, 0);
    }
    const n = Math.max(1, layout.plates.length);
    if (plates.length !== n) {
      for (const p of plates) p.sand?.dispose();
      plates = Array.from({ length: n }, makePlate);
    }
    plates.forEach((p, i) => {
      reform(p, wideOf(i));
      p.styled = 0;
      p.styledAt = Number.NEGATIVE_INFINITY;
      p.tune = tuneFor(i);
      p.tune.restart(now(), 1500);
    });
    needles.length = 0;
    layout.glides.forEach((g, i) => {
      const t = view?.glideScale(i)?.marks[0] ?? 0.5;
      needles.push(t);
      view?.needle(g.index, t, false);
    });
    art?.dispose();
    art = createPlateArt(
      artHost,
      layout.plates,
      shape,
      frame.unit,
      frame.pixelRatio,
      ctx.rng("chladni-art"),
    );
    sizeCanvas();
    if (gpu?.ready) gpu.run((gl) => buildSands(gl));
  };

  const sizeCanvas = () => {
    const s = scaleOf();
    gpu?.resize(frame.width * s, frame.height * s);
  };

  const buildSands = (gl: WebGL2RenderingContext) => {
    if (!kit || kit.gl !== gl) {
      kit?.dispose();
      kit = createSandKit(gl);
    }
    plates.forEach((p, i) => {
      p.sand?.dispose();
      p.sand = null;
      const box = layout.plates[i];
      if (!box) return;
      const n = grainCount(box.size, shape, res, caps.software);
      const sand = createSand(kit!, stateSize(n), seedRng.int(2 ** 31));
      sand.fill(seedRng.int(2 ** 31), {
        round,
        modes: p.modes,
        re: p.motion.re,
        im: p.motion.im,
        half: halfSides({ stretch: p.stretch, wide: wideOf(i) }),
        level: 0,
        wave2: 0,
        lift: 0,
        dt: 0,
        tick: tick++,
        share: 1,
      });
      p.sand = sand;
    });
  };

  const ensureGpu = () => {
    if (gpu) return;
    gpu = createGpu({
      host: glHost,
      onReady(gl, c) {
        caps = c;
        kit = null;
        sizeCanvas();
        buildSands(gl);
      },
      onLost() {
        kit = null;
        for (const p of plates) p.sand = null;
      },
      onError(message) {
        console.error(message);
      },
    });
    sizeCanvas();
  };

  const dropGpu = () => {
    if (!gpu) return;
    const g = gpu;
    g.run(() => {
      for (const p of plates) p.sand?.dispose();
      kit?.dispose();
    });
    for (const p of plates) p.sand = null;
    kit = null;
    g.dispose();
    gpu = null;
  };

  const releaseTouches = () => {
    for (const [, t] of touches) if (t.kind === "key") view?.pressed(t.key, false);
    touches.clear();
    glideOwner.clear();
    sliderOwner.clear();
    puckOwner.clear();
    for (const k of localKnobs.values()) {
      if (k.held) {
        k.held = false;
        k.releasedAt = now();
      }
    }
    for (const p of plates) {
      p.keys.clear();
      p.glides.clear();
    }
  };

  const switchMode = (next: LayoutMode) => {
    if (next === mode) return;
    releaseTouches();
    mode = next;
    for (const p of plates) p.sand?.dispose();
    plates = [];
    relayout();
    if (mode === "keyboard") dropGpu();
    else ensureGpu();
  };

  // ---- Network -------------------------------------------------------------------------------

  const onPlateMsg = (m: PlateMsg) => {
    lastPlate = now();
    remoteAt = lastPlate;
    remoteRe.fill(0);
    remoteIm.fill(0);
    remoteAmps.fill(0);
    remoteOrder = [];
    for (const [i, re, im] of m.m) {
      if (i >= remoteRe.length) continue;
      remoteRe[i] = re / 100;
      remoteIm[i] = im / 100;
      remoteAmps[i] = Math.hypot(re, im) / 100;
      remoteOrder.push(i);
    }
    remoteGlide = m.f > 0 ? m.f : null;
    const k = clean(shape, {
      stretch: m.s / 1000,
      damping: m.d / 1000,
      at: { u: m.p[0] / 1000, v: m.p[1] / 1000 },
    });
    sharedKnobs.stretch = k.stretch;
    sharedKnobs.damping = k.damping;
    sharedKnobs.at = k.at;
    sharedKnobs.wide = m.w;
    remoteDirty = true;
  };

  const uplink: Uplink | null =
    inBank && !isScreen ? createUplink(ctx.net, side, onPlateMsg) : null;
  const downlink: Downlink | null = isScreen
    ? createDownlink(ctx.net, {
        side,
        modeCount: baseModes.length,
        now,
        clock: shared,
        every: PLATE_MS,
        busyEvery: PLATE_BUSY_MS,
        onVisitor: () => ctx.idle.poke(),
        onSprinkle: () => resetPlate(0),
      })
    : null;

  // ---- Knobs ---------------------------------------------------------------------------------

  /** The knobs plate `i` shows: its own, or on a bank's touch frame the screen's (or ours). */
  const knobsOf = (i: number): Knobs & { wide: boolean } => {
    if (mode !== "keyboard") {
      const p = plates[i];
      return { ...(p?.knobs ?? knobHome(shape)), wide: wideOf(i) };
    }
    const t = now();
    const mine = (id: KnobId) => {
      const k = localKnobs.get(id);
      return k && (k.held || t - k.releasedAt < LOCAL_HOLD_MS) ? k : null;
    };
    const s = mine("stretch");
    const d = mine("damping");
    const a = mine("at");
    return {
      stretch: s ? s.x : sharedKnobs.stretch,
      damping: d ? d.x : sharedKnobs.damping,
      at: a ? { u: a.x, v: a.y } : sharedKnobs.at,
      wide: sharedKnobs.wide,
    };
  };

  /** A control on plate `plate` moved a knob: apply it here, or send it to the screen. */
  const setKnob = (plate: number, id: KnobId, x: number, y: number, held: boolean) => {
    if (mode === "keyboard") {
      const t = now();
      let k = localKnobs.get(id);
      if (!k) {
        k = { x, y, held, since: shared(), releasedAt: Number.NEGATIVE_INFINITY };
        localKnobs.set(id, k);
      } else if (held && !k.held) {
        k.since = shared();
      }
      if (!held && k.held) k.releasedAt = t;
      k.x = x;
      k.y = y;
      k.held = held;
      uplink?.knob(KNOB_CODES.indexOf(id), x, y, held, k.since);
      return;
    }
    const p = plates[plate];
    if (!p) return;
    const k = clean(shape, {
      ...p.knobs,
      ...(id === "stretch" ? { stretch: x } : id === "damping" ? { damping: x } : {}),
      ...(id === "at" ? { at: { u: x, v: y } } : {}),
    });
    p.knobs = k;
    letGo(p, id);
  };

  /** A person or bot took a knob: stop gliding it. */
  const letGo = (p: PlateState, id: KnobId) => {
    if (!p.goal) return;
    if (id === "at") p.goal.at = null;
    if (id === "stretch") p.goal.stretch = null;
  };

  const sendHome = () => {
    for (const p of plates) {
      const home = knobHome(shape);
      p.knobs.damping = home.damping;
      p.goal = { at: home.at, stretch: home.stretch };
    }
  };

  const showRng = ctx.rng("chladni-show");
  /** Tests stop the show so the drive point stays where they put it. */
  let showOff = false;

  /**
   * The attract show turns a knob now and then, as a visitor might: it glides the drive point
   * somewhere or draws the plate out, holds while the tune plays on, then puts it back.
   */
  const show = (p: PlateState, t: number, playing: boolean) => {
    if (!playing || showOff) {
      p.showAt = 0;
      p.showBack = null;
      return;
    }
    if (p.showAt === 0) p.showAt = t + SHOW_EVERY_MS;
    if (p.showBack !== null && t >= p.showBack) {
      p.goal = { at: knobHome(shape).at, stretch: 0 };
      p.showBack = null;
    } else if (t >= p.showAt) {
      p.showAt = t + SHOW_EVERY_MS;
      if (config.stretch && (showRng.next() < 0.45 || !config.puck)) {
        p.goal = { at: null, stretch: showRng.range(0.45, 1) };
      } else if (config.puck) {
        const a = showRng.range(0, Math.PI * 2);
        const r = showRng.range(0.3, 0.8);
        p.goal = {
          at: clampPoint(shape, { u: r * Math.sin(a), v: r * Math.cos(a) }),
          stretch: null,
        };
      } else {
        return;
      }
      p.showBack = t + SHOW_HOLD_MS;
    }
  };

  // ---- Input ---------------------------------------------------------------------------------

  const venueOf = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });

  const glideFreq = (index: number, x: number, y: number): { t: number; f: number } | null => {
    const g = layout.glides[index];
    const scale = view?.glideScale(index);
    if (!g || !scale) return null;
    const t = glideT(g, x, y);
    return { t, f: glideAt(scale, t) };
  };

  /** The drawn rectangle of a map's plate now. */
  const mapRectOf = (index: number): Rect | null => {
    const m = layout.maps[index];
    if (!m) return null;
    const k = knobsOf(m.plate);
    const stretch = mode === "keyboard" ? k.stretch : (plates[m.plate]?.stretch ?? 0);
    return mapRect(m.box, stretch, k.wide);
  };

  const movePuck = (t: Extract<Touch, { kind: "puck" }>, x: number, y: number, held: boolean) => {
    const r = t.map === null ? rectOf(t.plate) : mapRectOf(t.map);
    if (!r) return;
    const q = toPlate(r, x, y);
    const at = clampPoint(shape, { u: q.u + t.du, v: q.v + t.dv });
    setKnob(t.plate, "at", at.u, at.v, held);
  };

  const puckHit = (x: number, y: number): { plate: number; du: number; dv: number } | null => {
    if (!config.puck || mode !== "solo") return null;
    for (let i = 0; i < layout.plates.length; i++) {
      const r = rectOf(i);
      const p = plates[i];
      if (!r || !p) continue;
      const c = fromPlate(r, p.knobs.at);
      if (Math.hypot(x - c.x, y - c.y) <= puckSize / 2 + PUCK_GRIP) {
        const q = toPlate(r, x, y);
        return { plate: i, du: p.knobs.at.u - q.u, dv: p.knobs.at.v - q.v };
      }
    }
    return null;
  };

  const onDown = (p: Pointer) => {
    if (!p.synthetic) {
      lastHuman = now();
      attractMode = false;
    }
    // A touch whose lift never came is let go before the map can grow.
    if (touches.size >= MAX_TOUCHES) {
      const first = touches.keys().next().value;
      const pt = first === undefined ? undefined : ctx.input.pointers.get(first);
      if (first !== undefined) onUp(pt ?? { ...p, id: first });
    }
    const { x, y } = venueOf(p);
    const key = layout.keys.find((k) => inBox(k.box, x, y));
    if (key) {
      plates[key.plate]?.keys.press(key.index, key.mode, now());
      view?.pressed(key.index, true);
      touches.set(p.id, { kind: "key", key: key.index });
      return;
    }
    const glide = layout.glides.find((g) => inBox(g.box, x, y, 30));
    if (glide) {
      const at = glideFreq(glide.index, x, y);
      if (at) {
        glideOwner.set(glide.index, p.id);
        plates[glide.plate]?.glides.set(glide.index, at.f);
        needles[glide.index] = at.t;
      }
      touches.set(p.id, { kind: "glide", glide: glide.index });
      return;
    }
    const slider = layout.sliders.find((s) => inBox(s.box, x, y, 30));
    if (slider) {
      sliderOwner.set(slider.index, p.id);
      setKnob(slider.plate, slider.knob, stripT(slider, x, y), 0, true);
      touches.set(p.id, { kind: "slider", slider: slider.index });
      return;
    }
    const map = layout.maps.find((m) => m.touch && inBox(m.box, x, y, 20));
    if (map) {
      const t = { kind: "puck" as const, plate: map.plate, map: map.index, du: 0, dv: 0 };
      puckOwner.set(map.plate, p.id);
      touches.set(p.id, t);
      movePuck(t, x, y, true);
      return;
    }
    const grip = puckHit(x, y);
    if (grip) {
      puckOwner.set(grip.plate, p.id);
      touches.set(p.id, { kind: "puck", plate: grip.plate, map: null, du: grip.du, dv: grip.dv });
      letGo(plates[grip.plate]!, "at");
      return;
    }
    if (config.damp && mode === "solo") {
      const on = plateAt(layout, round, x, y, (i) => plates[i]?.stretch ?? 0);
      if (on) {
        touches.set(p.id, { kind: "damp", plate: on.plate });
        return;
      }
    }
    touches.set(p.id, { kind: "none" });
  };

  const onMove = (p: Pointer) => {
    const t = touches.get(p.id);
    if (!t) return;
    const { x, y } = venueOf(p);
    if (t.kind === "glide" && glideOwner.get(t.glide) === p.id) {
      const at = glideFreq(t.glide, x, y);
      const g = layout.glides[t.glide];
      if (!at || !g) return;
      plates[g.plate]?.glides.set(t.glide, at.f);
      needles[t.glide] = at.t;
    } else if (t.kind === "slider" && sliderOwner.get(t.slider) === p.id) {
      const s = layout.sliders[t.slider];
      if (s) setKnob(s.plate, s.knob, stripT(s, x, y), 0, true);
    } else if (t.kind === "puck" && puckOwner.get(t.plate) === p.id) {
      movePuck(t, x, y, true);
    }
  };

  const onUp = (p: Pointer) => {
    const t = touches.get(p.id);
    touches.delete(p.id);
    if (!t) return;
    if (t.kind === "key") {
      const k = layout.keys[t.key];
      if (k) plates[k.plate]?.keys.release(k.index, now());
      if (![...touches.values()].some((o) => o.kind === "key" && o.key === t.key)) {
        view?.pressed(t.key, false);
      }
    } else if (t.kind === "glide" && glideOwner.get(t.glide) === p.id) {
      glideOwner.delete(t.glide);
      const g = layout.glides[t.glide];
      if (g) plates[g.plate]?.glides.set(t.glide, null);
    } else if (t.kind === "slider" && sliderOwner.get(t.slider) === p.id) {
      sliderOwner.delete(t.slider);
      const s = layout.sliders[t.slider];
      const k = s ? knobsOf(s.plate) : null;
      if (s && k) setKnob(s.plate, s.knob, s.knob === "stretch" ? k.stretch : k.damping, 0, false);
    } else if (t.kind === "puck" && puckOwner.get(t.plate) === p.id) {
      puckOwner.delete(t.plate);
      const at = knobsOf(t.plate).at;
      setKnob(t.plate, "at", at.u, at.v, false);
    }
  };

  const offInput = [
    ctx.input.on("down", onDown),
    ctx.input.on("move", onMove),
    ctx.input.on("up", onUp),
    ctx.input.on("cancel", onUp),
  ];

  /** Damping fingers on plate `i`, in plate coordinates. */
  const dampPoints = (i: number): Point[] => {
    const out: Point[] = [];
    for (const [id, t] of touches) {
      if (t.kind !== "damp" || t.plate !== i) continue;
      const p = ctx.input.pointers.get(id);
      if (!p) continue;
      const on = plateAt(layout, round, p.x / frame.unit, p.y / frame.unit, (j) =>
        j === i ? (plates[j]?.stretch ?? 0) : 0,
      );
      if (on && on.plate === i) out.push({ u: on.u, v: on.v });
      if (out.length >= 10) break;
    }
    return out;
  };

  const ringPoints = () => {
    const out: { x: number; y: number }[] = [];
    for (const [id, t] of touches) {
      if (t.kind !== "damp") continue;
      const p = ctx.input.pointers.get(id);
      if (p) out.push({ x: p.x / frame.unit, y: p.y / frame.unit });
    }
    return out;
  };

  // ---- Bots ----------------------------------------------------------------------------------

  const bots: Bots | null =
    ctx.bots > 0 && !isScreen
      ? createBots({
          input: ctx.input,
          rng: ctx.rng("chladni-bots"),
          count: Math.min(4, ctx.bots),
          unit: () => frame.unit,
          scene: () => {
            if (mode === "screen") return null;
            const pucks =
              mode === "solo" && config.puck
                ? plates.flatMap((p, i) => {
                    const r = rectOf(i);
                    if (!r) return [];
                    const c = fromPlate(r, p.knobs.at);
                    // Only a puck within reach, dragged within reach.
                    const top = Math.max(r.cy - r.height / 2, layout.reach.adult + 40);
                    const bottom = r.cy + r.height / 2;
                    if (c.y < layout.reach.adult + 40 || bottom - top < 120) return [];
                    const within = {
                      x: r.cx - r.width / 2,
                      y: top,
                      width: r.width,
                      height: bottom - top,
                    };
                    return [{ x: c.x, y: c.y, within }];
                  })
                : [];
            return { layout, round, damp: config.damp && mode === "solo", pucks };
          },
        })
      : null;

  // ---- Update (60 Hz) ------------------------------------------------------------------------

  const drivesOf = (p: PlateState, t: number): Drive[] => {
    const out: Drive[] = [];
    for (const k of p.keys.active(t)) out.push({ kind: "key", mode: k.mode, freq: 0, level: 1 });
    for (const g of p.glides.active())
      out.push({ kind: "glide", mode: -1, freq: g.freq, level: 1 });
    const ts = p.tuneState;
    if (ts?.note) out.push({ kind: "key", mode: ts.note.mode, freq: 0, level: 1 });
    if (ts?.glide) {
      out.push({ kind: "glide", mode: -1, freq: stripFreq(ts.glide.strip, ts.glide.t), level: 1 });
    }
    return out;
  };

  let screenAttract = true;

  const update = (dt: number) => {
    if (disposed) return;
    const t = now();

    if (mode === "keyboard" || (uplink && mode === "solo")) {
      // Only the screen's reports count, so a moment between hubs doesn't flip the layout.
      const hearing = t - lastPlate < SCREEN_TIMEOUT_MS;
      if (mode === "keyboard" && !hearing && t - mountedAt > SCREEN_TIMEOUT_MS) switchMode("solo");
      else if (mode === "solo" && hearing) switchMode("keyboard");
    }

    const human = t - lastHuman < BOT_YIELD_MS;
    const botsOn = bots && !human ? Math.min(4, ctx.bots) : 0;
    bots?.update(dt, botsOn);

    if (mode === "keyboard") updateKeyboard(t);
    else updatePlates(t, dt, !botsOn && attractMode && !human);
  };

  /** Restyle a plate's key pictures and glide marks when its stretch has moved a step. */
  const restyle = (i: number, stretch: number, t: number) => {
    const p = plates[i];
    if (!p || shape !== "square") return;
    const step = Math.round(stretch * RESTYLE_STEPS);
    if (step === p.styled || t - p.styledAt < RESTYLE_MS) return;
    p.styled = step;
    p.styledAt = t;
    const at = formModes(shape, { stretch: step / RESTYLE_STEPS, wide: wideOf(i), turn: 0 });
    view?.restyle(i, at, step / RESTYLE_STEPS);
    if (mode === "screen" && i === 0) {
      screenScaleNow = glideScale(
        at.map((m) => m.freq),
        null,
        null,
        screenScaleAxis,
      );
    }
  };

  /** Show which keys and marks can ring from `at`, and the drive point's state. */
  const showLive = (
    plate: number,
    list: readonly Mode[],
    at: Point,
    pressed: readonly number[],
  ): number => {
    let dead = 0;
    for (const k of layout.keys) {
      if (k.plate !== plate) continue;
      view?.live(k.index, liveOf(list[k.mode], at));
    }
    for (const g of layout.glides) {
      if (g.plate !== plate) continue;
      view?.marksLive(
        g.index,
        g.notes.map((n) => liveOf(list[n], at)),
      );
    }
    for (const m of pressed) dead = Math.max(dead, 1 - liveOf(list[m], at));
    return dead;
  };

  const updatePlates = (t: number, dt: number, tuneOn: boolean) => {
    const live = downlink ? downlink.remote.size(t) > 0 || downlink.knobs.busy(t) : false;
    if (downlink) {
      const quietFor = t - Math.max(downlink.remote.lastAt, downlink.knobAt);
      screenAttract = downlink.stations().length === 0 || (!live && quietFor > SCREEN_ATTRACT_MS);
      // The bank's knobs: the last touch along the bank wins.
      const p = plates[0];
      if (p) {
        const s = downlink.knobs.winner("stretch", t);
        const d = downlink.knobs.winner("damping", t);
        const a = downlink.knobs.winner("at", t);
        p.knobs = clean(shape, {
          stretch: s ? s.x : p.knobs.stretch,
          damping: d ? d.x : p.knobs.damping,
          at: a ? { u: a.x, v: a.y } : p.knobs.at,
        });
        if (a) letGo(p, "at");
        if (s) letGo(p, "stretch");
      }
    }
    plates.forEach((p, i) => {
      const wide = wideOf(i);
      const playing = mode === "screen" ? screenAttract : tuneOn;
      show(p, t, playing);
      const goal = p.goal;
      if (goal?.at) {
        const to = goal.at;
        p.knobs.at = {
          u: approach(p.knobs.at.u, to.u, dt, HOME_GLIDE_S),
          v: approach(p.knobs.at.v, to.v, dt, HOME_GLIDE_S),
        };
        if (p.knobs.at.u === to.u && p.knobs.at.v === to.v) goal.at = null;
      }
      if (goal && goal.stretch !== null) {
        p.knobs.stretch = approach(p.knobs.stretch, goal.stretch, dt, HOME_GLIDE_S);
        if (p.knobs.stretch === goal.stretch) goal.stretch = null;
      }
      if (goal && !goal.at && goal.stretch === null) p.goal = null;
      p.stretch = approach(p.stretch, p.knobs.stretch, dt, STRETCH_EASE_S);
      reform(p, wide);
      restyle(i, p.stretch, t);
      p.tuneState = playing && p.tune ? p.tune.update(t) : null;
      if (p.tuneState?.sprinkle) p.sprinkler.start(t, TUNE_SPRINKLE_MS, seedRng.int(2 ** 31));
      const drives = drivesOf(p, t);
      if (downlink && i === 0) drives.push(...downlink.remote.drives(t));
      p.motion.update(
        dt,
        p.modes,
        drives,
        p.knobs.at,
        config.damp ? dampPoints(i) : [],
        qOf(p.knobs.damping),
      );
      const level = p.motion.level();
      if (level > 0.05) {
        p.stillSince = t;
        p.quietDone = false;
      } else if (!p.quietDone && t - p.stillSince > QUIET_MS) {
        p.quietDone = true;
        p.sprinkler.start(t, QUIET_SPRINKLE_MS, seedRng.int(2 ** 31));
      }
      const strongest = p.motion.strongest();
      const rect = rectOf(i);
      if (rect) {
        view?.plate(i, rect);
        art?.place(i, rect);
      }
      view?.rim(
        i,
        strongest >= 0 ? noteColor(strongest, baseModes.length) : PALETTE.muted,
        Math.min(1, level),
      );
      // Keys ringing now: when the drive point can't ring them, say why.
      const pressed = [
        ...p.keys.active(t).map((k) => k.mode),
        ...(downlink && i === 0
          ? downlink.remote
              .drives(t)
              .filter((d) => d.kind === "key")
              .map((d) => d.mode)
          : []),
      ];
      const dead = showLive(i, p.modes, p.knobs.at, pressed);
      const deadMode =
        dead > 0.5 ? pressed.find((m) => 1 - liveOf(p.modes[m], p.knobs.at) > 0.5) : undefined;
      const held = puckOwner.has(i);
      const drive = level > 0.15;
      view?.puck(i, config.puck ? p.knobs.at : null, { held, dead, drive });
      view?.ghost(i, deadMode === undefined ? null : (p.modes[deadMode] ?? null), dead);
      layout.sliders.forEach((s) => {
        if (s.plate !== i) return;
        view?.slider(
          s.index,
          s.knob === "stretch" ? p.knobs.stretch : p.knobs.damping,
          sliderOwner.has(s.index),
        );
      });
      layout.maps.forEach((m) => {
        if (m.plate !== i) return;
        view?.map(m.index, {
          stretch: p.stretch,
          wide,
          at: config.puck ? p.knobs.at : null,
          puck: { held, dead, drive },
        });
        if (t - mapAt >= MAP_MS) {
          const order = p.motion.active();
          view?.mapPicture(
            m.index,
            (img) =>
              drawMotion(img, shape, p.modes, order, p.motion.re, p.motion.im, level, SAND_COLOR),
            level > 0.05 ? Math.min(1, 0.5 + level) : 0.35,
          );
          view?.mapGhost(
            m.index,
            deadMode === undefined ? null : (p.modes[deadMode] ?? null),
            dead,
          );
        }
      });
    });
    if (t - mapAt >= MAP_MS) mapAt = t;
    layout.keys.forEach((k) => {
      const p = plates[k.plate];
      if (!p) return;
      const amp = p.motion.amps[k.mode] ?? 0;
      view?.lit(k.index, Math.min(1, amp * 1.1));
      view?.pressed(k.index, p.tuneState?.note?.key === k.index || heldKey(k.index));
    });
    layout.glides.forEach((g) => {
      const p = plates[g.plate];
      const owned = glideOwner.has(g.index);
      const tg = p?.tuneState?.glide;
      if (tg && tg.strip === g.index && !owned) needles[g.index] = tg.t;
      view?.needle(g.index, needles[g.index] ?? null, owned || tg?.strip === g.index);
    });
    view?.rings(ringPoints());
    if (downlink) {
      const p = plates[0];
      if (p) {
        const busy = downlink.knobs.busy(t);
        downlink.report(
          t,
          () =>
            encodePlate(
              p.motion.re,
              p.motion.im,
              p.motion.active(8),
              p.tuneState?.glide ? stripFreq(-1, p.tuneState.glide.t) : null,
              screenAttract,
              { ...p.knobs, wide: wideOf(0) },
            ),
          busy,
        );
      }
    }
  };

  const heldKey = (index: number) =>
    [...touches.values()].some((o) => o.kind === "key" && o.key === index);

  const updateKeyboard = (t: number) => {
    const p = plates[0];
    if (!p || !uplink) return;
    const keys = p.keys.active(t).map((k) => ({
      key: layout.keys[k.key]?.bank ?? 0,
      mode: k.mode,
    }));
    const glides = p.glides.active().map((g) => ({ strip: pos * span + g.strip, freq: g.freq }));
    // Held knobs repeat as a heartbeat; the uplink sends what changed.
    for (const [id, k] of localKnobs) {
      if (k.held) uplink.knob(KNOB_CODES.indexOf(id), k.x, k.y, true, k.since);
    }
    uplink.tick(t, shared(), keys, glides, t - lastHuman > LATCH_MS + 1000);
    for (const [id, k] of localKnobs) {
      if (!k.held && t - k.releasedAt > LOCAL_HOLD_MS * 4) localKnobs.delete(id);
    }
    const knobs = knobsOf(0);
    const turn = round ? turnFor(knobs.at, p.turn) : 0;
    p.turn = turn;
    const list = formModes(shape, { stretch: knobs.stretch, wide: knobs.wide, turn });
    p.modes = list;
    if (shape === "square") {
      const step = Math.round(knobs.stretch * RESTYLE_STEPS);
      if (step !== p.styled && t - p.styledAt >= RESTYLE_MS) {
        p.styled = step;
        p.styledAt = t;
        const at = formModes(shape, { stretch: step / RESTYLE_STEPS, wide: knobs.wide, turn: 0 });
        view?.restyle(0, at, step / RESTYLE_STEPS);
      }
    }
    const fresh = t - remoteAt < REMOTE_STALE_MS;
    layout.keys.forEach((k) => {
      const own = p.keys.ringing(k.index, t) ? 0.55 : 0;
      const far = fresh ? Math.min(1, (remoteAmps[k.mode] ?? 0) * 1.1) : 0;
      view?.lit(k.index, Math.max(own, far));
    });
    layout.glides.forEach((g) => {
      const owned = glideOwner.has(g.index);
      if (!owned) {
        const scale = view?.glideScale(g.index);
        const ghost = scale && fresh ? needleFor(scale, remoteGlide) : null;
        if (ghost !== null) needles[g.index] = ghost;
      }
      view?.needle(g.index, needles[g.index] ?? null, owned);
    });
    const pressed = p.keys.active(t).map((k) => k.mode);
    const dead = showLive(0, list, knobs.at, pressed);
    const deadMode =
      dead > 0.5 ? pressed.find((m) => 1 - liveOf(list[m], knobs.at) > 0.5) : undefined;
    layout.sliders.forEach((s) => {
      view?.slider(
        s.index,
        s.knob === "stretch" ? knobs.stretch : knobs.damping,
        sliderOwner.has(s.index),
      );
    });
    let level = 0;
    for (const i of remoteOrder) level += remoteAmps[i]! ** 2;
    level = fresh ? Math.sqrt(level) : 0;
    const redraw = remoteDirty || t - mapAt >= 1000;
    layout.maps.forEach((m) => {
      view?.map(m.index, {
        stretch: knobs.stretch,
        wide: knobs.wide,
        at: config.puck ? knobs.at : null,
        puck: { held: puckOwner.has(0), dead, drive: level > 0.15 },
      });
      if (redraw) {
        // The screen's figure, as its report gives it (rendered in the screen's form).
        const form = formModes(shape, {
          stretch: sharedKnobs.stretch,
          wide: sharedKnobs.wide,
          turn: round ? turnFor(sharedKnobs.at, turn) : 0,
        });
        view?.mapPicture(
          m.index,
          level > 0.05
            ? (img) =>
                drawMotion(img, shape, form, remoteOrder, remoteRe, remoteIm, level, SAND_COLOR)
            : null,
          level > 0.05 ? Math.min(1, 0.5 + level) : 0.3,
        );
      }
      view?.mapGhost(m.index, deadMode === undefined ? null : (list[deadMode] ?? null), dead);
    });
    if (redraw) {
      remoteDirty = false;
      mapAt = t;
    }
  };

  // ---- Render --------------------------------------------------------------------------------

  const clipRect = (r: Rect): [number, number, number, number] => {
    const W = frame.width / frame.unit;
    const H = frame.height / frame.unit;
    const x0 = r.cx - r.width / 2;
    const y0 = r.cy - r.height / 2;
    return [
      (x0 / W) * 2 - 1,
      1 - (y0 / H) * 2,
      ((x0 + r.width) / W) * 2 - 1,
      1 - ((y0 + r.height) / H) * 2,
    ];
  };

  const render = () => {
    if (disposed || !gpu) return;
    const t = now();
    const dt = lastRender ? Math.min(0.1, (t - lastRender) / 1000) : 1 / 60;
    if (lastRender) {
      frameMs += (t - lastRender - frameMs) * 0.1;
      // Slow frames move fewer grains; fast ones win them back.
      share = Math.min(1, Math.max(0.25, share * (frameMs > 45 ? 0.97 : frameMs < 25 ? 1.02 : 1)));
    }
    lastRender = t;
    gpu.run((gl) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(dt / STEP_MAX_S)));
      plates.forEach((p, i) => {
        const sand = p.sand;
        const rect = rectOf(i);
        if (!sand || !rect) return;
        const active = p.motion.active();
        const { level, wave2 } = levels(p.modes, active, p.motion.amps);
        const lf = lift(level);
        const half = halfSides({ stretch: p.stretch, wide: wideOf(i) });
        for (let s = 0; s < steps; s++) {
          sand.step({
            round,
            modes: p.modes,
            active,
            re: p.motion.re,
            im: p.motion.im,
            half,
            level,
            wave2,
            lift: lf,
            dt: dt / steps,
            tick: tick++,
            sprinkle: p.sprinkler.span(t),
            share,
          });
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        const px = grainSize(rect.width, rect.height, shape, sand.count) * frame.unit * scaleOf();
        sand.draw({
          rect: clipRect(rect),
          size: Math.max(1, px),
          shiver: (2 * SHIVER_PX) / Math.min(rect.width, rect.height),
          tick: tick,
          tint: tintIndex(config.sand),
          alpha: Math.min(0.95, 0.95 * Math.max(0.35, px * px)),
          share,
        });
      });
    });
  };

  // ---- Start ---------------------------------------------------------------------------------

  relayout();
  if (mode !== "keyboard") ensureGpu();

  const loop = ctx.loop({ hz: 60, update, render });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      releaseTouches();
      relayout();
    }, 200);
  });

  const strongestId = () => {
    if (mode === "keyboard") {
      let best = -1;
      let at = 0.12;
      remoteAmps.forEach((a, i) => {
        if (a > at) {
          at = a;
          best = i;
        }
      });
      const m = baseModes[best];
      return m ? modeId(m) : "none";
    }
    const m = baseModes[plates[0]?.motion.strongest() ?? -1];
    return m ? modeId(m) : "none";
  };

  const round3 = (v: number) => Math.round(v * 1000) / 1000;

  // Tests and debugging only: a read-only view of the app's state, and a few levers.
  const debugKey = "__chladni";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          mode,
          shape,
          screen: uplink?.screen() ?? null,
          share,
          grains: plates.map((p) => p.sand?.count ?? 0),
          amps: plates.map((p) => Array.from(p.motion.amps)),
          levels: plates.map((p) => p.motion.level()),
          strongest: strongestId(),
          remote: Array.from(remoteAmps),
          remoteDrives: downlink?.remote.size(now()) ?? 0,
          screenAttract,
          attract: attractMode,
          sent: uplink?.sent ?? 0,
          knobs: plates.map((_, i) => {
            const k = knobsOf(i);
            return { stretch: k.stretch, damping: k.damping, at: k.at, wide: k.wide };
          }),
          stretchNow: plates.map((p) => p.stretch),
          rects: plates.map((_, i) => rectOf(i)),
          freqs: plates.map((p) => p.modes.map((m) => m.freq)),
          layout: {
            keys: layout.keys,
            glides: layout.glides,
            sliders: layout.sliders,
            maps: layout.maps,
            plates: layout.plates,
            reach: layout.reach,
          },
          puckSize,
          modes: baseModes.map((m) => ({ ...m })),
        }),
        grains: (plate = 0) => {
          let out: { u: number[]; v: number[]; motion: number[]; active: number } | null = null;
          gpu?.run(() => {
            const sand = plates[plate]?.sand;
            if (!sand) return;
            const r = sand.read();
            const rows = Math.max(1, Math.min(sand.height, Math.ceil(sand.height * share)));
            out = {
              u: Array.from(r.u),
              v: Array.from(r.v),
              motion: Array.from(r.motion),
              active: rows * sand.width,
            };
          });
          return out;
        },
        sprinkle: (ms = RESET_SPRINKLE_MS) => {
          for (const p of plates) p.sprinkler.start(now(), ms, seedRng.int(2 ** 31));
        },
        stopAttract: () => {
          attractMode = false;
          screenAttract = false;
          showOff = true;
          sendHome();
        },
        loseContext: (ms: number) => gpu?.simulateLoss(ms) ?? false,
      },
    });
  }

  return {
    reset() {
      bots?.release();
      releaseTouches();
      if (mode === "screen" && downlink) {
        const t = now();
        if (downlink.remote.size(t) > 0 || downlink.knobs.busy(t)) return;
      }
      sendHome();
      for (const p of plates) {
        p.sprinkler.start(now(), RESET_SPRINKLE_MS, seedRng.int(2 ** 31));
        p.tune?.restart(now(), 3000);
        p.quietDone = true;
      }
    },
    attract() {
      attractMode = true;
    },
    status() {
      const notes = plates.reduce((n, p) => n + p.keys.presses, 0) + (downlink?.notes ?? 0);
      const k = knobsOf(0);
      return {
        notes,
        figure: strongestId(),
        grains: plates.reduce((n, p) => n + (p.sand?.count ?? 0), 0),
        mode,
        stretch: round3(k.stretch),
        damping: round3(k.damping),
        puck: `${round3(k.at.u)},${round3(k.at.v)}`,
        gl:
          mode === "keyboard"
            ? "none"
            : gpu?.ready
              ? caps.software
                ? "software"
                : "ok"
              : "starting",
      };
    },
    homeSpot(size) {
      if (kind !== "wall" || mode !== "solo") return null;
      return {
        x: Math.round(frame.width - size - 28 * frame.unit),
        y: Math.round((layout.reach.adult + 4) * frame.unit),
      };
    },
    command(name) {
      if (name === "sprinkle")
        for (const p of plates) p.sprinkler.start(now(), RESET_SPRINKLE_MS, seedRng.int(2 ** 31));
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
      art?.dispose();
      art = null;
      dropGpu();
      backdrop.remove();
      artHost.remove();
      glHost.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};

/** Sand on the maps' pictures. */
const SAND_COLOR = "#e9cf9c";
