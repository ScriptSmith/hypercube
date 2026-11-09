import { PALETTE } from "../../core/ui";
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { type Actors, type ActorScene, createActors } from "./bots";
import { buildConditions } from "./conditions";
import {
  agentCount,
  lifeRate,
  readConfig,
  slimeRate,
  trailCell,
  turingCell,
  turingIterations,
} from "./config";
import { bankSlices, type Box, evenSlices, landing, localLanding, type Slice } from "./dish";
import { createGpu, type GpuCaps } from "./gpu/context";
import type { Culture, StampOp } from "./gpu/culture";
import { STATS_SIZE } from "./gpu/culture";
import { createLifeCulture, lifeSelfTest } from "./gpu/life";
import { createRenderer, FX, MAX_FX, type Renderer, type ViewInputs } from "./gpu/render";
import { createSlimeCulture } from "./gpu/slime";
import { createTuringCulture } from "./gpu/turing";
import { createHands, createLimiter, type Hands, type Limiter } from "./hands";
import { stampTint } from "./icons";
import {
  angleFromUp,
  computeLayout,
  controlBoxes,
  detentAt,
  dialBounds,
  inBox,
  type Layout,
  type Mode,
  nearestDetent,
  type Pad,
  padAt,
} from "./layout";
import {
  arrival,
  climbMs,
  COND_EVERY_MS,
  decodeCond,
  decodeDish,
  decodeDrop,
  decodeLanded,
  DISH_EVERY_MS,
  DISH_TIMEOUT_MS,
  type DishMsg,
  type DropMsg,
  SLICE_TIMEOUT_MS,
  TOPIC_COND,
  TOPIC_DISH,
  TOPIC_DROP,
  TOPIC_LANDED,
} from "./net";
import { createPieces } from "./pieces";
import {
  defaultPreset,
  defaultStamp,
  type Family,
  presetCount,
  type StampDef,
  stampAt,
  stampIndex,
  STAMPS,
} from "./stamps";
import { createView, type View } from "./view";

const STATS_MS = 5000;
const RIPPLE_MS = 1300;
const BOT_YIELD_MS = 15_000;
const PREVIEW_MS = 10_000;
const TAP_SLOP = 60;
const TAP_MS = 750;
const FLICK_MIN = 70;
const FLICK_SPEED = 450;
const WASH_MS = 3000;
const IDLE_WASH_MS = 20_000;
const MAX_QUEUE = 64;
const MAX_RIPPLES = 10;
const MAX_FLIGHTS = 12;
const PAD_DROP_MS = 1500;
/** Life colour index for rain and seeds, after the eight player colours. */
const SEED_COLOR = 8;

const hexRgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const LIFE_HEX = [...PALETTE.players, "#d6f5e8", "#ffffff"];
const STRAIN_HEX = ["#f5c542", "#4fd8ec", "#ff6fa5", "#8fe36b"];
const LIFE_COLORS = new Float32Array(LIFE_HEX.flatMap(hexRgb));
const STRAIN_COLORS = new Float32Array(STRAIN_HEX.flatMap(hexRgb));

/** Coverage below which a culture counts as nearly empty and the rain picks up. */
const SPARSE: Record<Family, number> = { life: 0.004, slime: 0.04, turing: 0.02 };

const BOT_WEIGHTS: Record<string, number> = {
  soup: 3,
  glider: 2,
  ship: 1.5,
  bloom: 1,
  spark: 1,
  spore: 4,
  food: 1.2,
  salt: 0.8,
  "drop-m": 3,
  "drop-s": 2,
  "drop-l": 1.5,
  wash: 0.6,
};
const ATTRACT_WEIGHTS: Record<string, number> = {
  soup: 3,
  glider: 1,
  ship: 1,
  spore: 3,
  food: 0.6,
  "drop-m": 3,
  "drop-l": 1,
};

type Touch =
  | { kind: "none" }
  | { kind: "swatch" }
  | { kind: "dial"; dial: number }
  | { kind: "tap"; x: number; y: number; t: number }
  | { kind: "flick"; pad: number; x: number; y: number; t: number };

interface Ripple {
  x: number;
  y: number;
  r: number;
  born: number;
  color: [number, number, number];
}

interface Flight {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  start: number;
  end: number;
  /** On the shared clock (the screen) rather than this page's. */
  shared: boolean;
  color: [number, number, number];
  size: number;
  land?: () => void;
}

interface SliceState {
  pads: number;
  values: number[];
  at: number;
}

export const mount = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options, ctx.frame.kind);
  const kind = ctx.frame.kind;
  const isScreen = kind === "screen" || ctx.setup.role === "screen";
  const mode: Mode = isScreen ? "screen" : ctx.setup.name === "bank" ? "dropper" : "solo";
  const padsHere = kind === "pair" ? 2 : 1;
  const pos = ctx.setup.pos;
  const count = Math.max(1, ctx.setup.count);
  const rng = ctx.rng("petri");
  const res = ctx.frame.pixelRatio / Math.min(window.devicePixelRatio || 1, 2);

  let frame: FrameInfo = ctx.frame;
  let wanted: Family = config.family;
  let family: Family = wanted;
  let fallback = "";
  let caps: GpuCaps = { float: true, software: false };
  let layout: Layout = computeLayout(kind, mode, venueSize(), frame.reach, family, config.regions);
  let view: View | null = null;
  let culture: Culture | null = null;
  let renderer: Renderer | null = null;
  let disposed = false;

  const queue: StampOp[] = [];
  const ripples: Ripple[] = [];
  const flights: Flight[] = [];
  const pieces = createPieces();
  const touches = new Map<number, Touch>();
  const later: { at: number; fn: () => void }[] = [];
  let regionValues: number[] = [];
  let hands: Hands = makeHands();
  let padSel: string[] = [];
  const padLimit: Limiter[] = Array.from({ length: 4 }, () => createLimiter(PAD_DROP_MS));
  let wash: { start: number; ms: number } | null = null;
  let conditionsDirty = true;
  let coverage: number | null = null;
  let blocks: Uint8Array | null = null;
  let statsAt = -Infinity;
  let rainIn = 3;
  let lastHuman = -Infinity;
  let attractMode = true;
  let lastRender = 0;
  let frameMs = 16.7;
  let load = 1;
  let dropTimes: number[] = [];
  let placed = 0;
  let dropCounter = 0;
  let attractDropIn = 2;

  // Bank state.
  let lastDish = -Infinity;
  let connected = false;
  let previewAt = -Infinity;
  let condSentAt = -Infinity;
  const slicesByPos: (SliceState | null)[] = Array.from({ length: 16 }, () => null);
  let oneValue = 0;
  let dishSentAt = -Infinity;
  let dishDirty = true;
  const landedLog: { id: number; x: number; y: number; pos: number; pad: number; u: number }[] = [];
  let changedAt = 0;

  function venueSize() {
    return { width: frame.venueWidth, height: frame.venueHeight };
  }

  function makeHands(): Hands {
    return createHands({
      radius: 260,
      ttlMs: 60_000,
      max: 12,
      pickMs: 30_000,
      perHandMs: 800,
      perSecond: 6,
      fallback: defaultStamp(family).id,
      colors: 8,
    });
  }

  const now = () => performance.now();
  const shared = () => ctx.clock.now();
  const padColor = (side: number) => (pos * padsHere + side) % 8;

  // ---- Layout and family --------------------------------------------------------------------

  const resetConditions = () => {
    regionValues = Array.from({ length: Math.max(1, layout.regions) }, () => defaultPreset(family));
    oneValue = defaultPreset(family);
    conditionsDirty = true;
    dishDirty = true;
  };

  const relayout = () => {
    layout = computeLayout(kind, mode, venueSize(), frame.reach, family, config.regions);
    view?.dispose();
    view = createView({
      root: ctx.root,
      layout,
      unit: frame.unit,
      family,
      ui: ctx.ui,
      onReset: (side) => resetPad(side),
    });
    if (regionValues.length !== layout.regions) resetConditions();
    if (padSel.length !== layout.pads.length || padSel.some((id) => stampIndex(family, id) < 0)) {
      padSel = layout.pads.map(() => defaultStamp(family).id);
    }
    layout.pads.forEach((p) => view?.select(p.side, padSel[p.side] ?? defaultStamp(family).id));
    layout.dials.forEach((d, i) =>
      view?.setDial(i, regionValues[d.region] ?? defaultPreset(family)),
    );
    sizeCanvas();
  };

  const sizeCanvas = () => {
    const scale = frame.pixelRatio * (caps.software ? 0.5 : 1);
    gpu?.resize(frame.width * scale, frame.height * scale);
  };

  const worldSpec = () => {
    const w = layout.world;
    const d = layout.dish;
    return {
      width: w.width,
      height: w.height,
      mask: d ? { x: d.x - w.x, y: d.y - w.y, r: d.r } : null,
    };
  };

  const buildGpu = (gl: WebGL2RenderingContext) => {
    renderer?.dispose();
    culture?.dispose();
    renderer = null;
    culture = null;
    const spec = worldSpec();
    const sw = caps.software;
    if (family === "life") {
      // A touch frame's window is a small preview, so its cells are drawn larger.
      const cell = mode === "dropper" ? config.cell * 2 : config.cell;
      culture = createLifeCulture(gl, { spec, cell, gensPerSecond: lifeRate(config.speed) });
    } else if (family === "slime") {
      culture = createSlimeCulture(gl, {
        spec,
        cell: trailCell(res, sw),
        agents: agentCount(spec.width * spec.height, res, sw),
        stepsPerSecond: slimeRate(config.speed),
      });
    } else {
      culture = createTuringCulture(gl, {
        spec,
        cell: turingCell(res, sw),
        iterations: Math.max(3, Math.round(turingIterations(config.speed) / (sw ? 3 : 1))),
      });
    }
    renderer = createRenderer(gl, culture);
    conditionsDirty = true;
    queue.length = 0;
    pieces.clear();
    coverage = null;
    blocks = null;
    if (mode === "dropper" && connected) previewAt = -Infinity;
    else seedSparse();
  };

  const setFamily = (f: Family) => {
    if (f === family) return;
    family = f;
    hands = makeHands();
    padSel = [];
    resetConditions();
    relayout();
    gpu?.run((gl) => buildGpu(gl));
  };

  // ---- Stamps ---------------------------------------------------------------------------------

  const rgbOf = (stamp: StampDef, color: number): [number, number, number] => {
    if (stamp.family === "life") return hexRgb(LIFE_HEX[color] ?? "#ffffff");
    if (stamp.kind === "spore") return hexRgb(STRAIN_HEX[color % 4] ?? "#ffffff");
    return hexRgb(stampTint(stamp));
  };

  const ripple = (x: number, y: number, r: number, color: [number, number, number]) => {
    ripples.push({ x, y, r, born: now(), color });
    while (ripples.length > MAX_RIPPLES) ripples.shift();
  };

  const countDrop = (t: number) => {
    dropTimes.push(t);
    if (dropTimes.length > 400 || (dropTimes[0] ?? t) < t - 60_000) {
      dropTimes = dropTimes.filter((x) => x > t - 60_000).slice(-400);
    }
  };

  /** Put a stamp into the culture at frame venue (x, y). */
  const place = (
    stamp: StampDef,
    x: number,
    y: number,
    color: number,
    opts: { transform?: number; seed?: number; quiet?: boolean } = {},
  ): boolean => {
    if (stamp.family !== family) return false;
    const w = layout.world;
    const lx = x - w.x;
    const ly = y - w.y;
    if (lx < 0 || ly < 0 || lx > w.width || ly > w.height) return false;
    const d = layout.dish;
    if (d && Math.hypot(x - d.x, y - d.y) > d.r) return false;
    if (stamp.kind === "food" || stamp.kind === "salt") {
      pieces.add(stamp.kind, lx, ly, stamp.radius, now());
    } else {
      queue.push({
        x: lx,
        y: ly,
        stamp,
        transform: opts.transform ?? rng.int(8),
        color,
        seed: opts.seed ?? rng.int(2 ** 31),
      });
      while (queue.length > MAX_QUEUE) queue.shift();
    }
    if (!opts.quiet) {
      ripple(x, y, Math.max(70, stamp.radius * 1.6), rgbOf(stamp, color));
      placed++;
      countDrop(now());
    }
    return true;
  };

  const randomInWorld = (margin: number, area?: Box): { x: number; y: number } => {
    const d = layout.dish;
    if (d && !area) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * (d.r - margin);
      return { x: d.x + Math.cos(a) * r, y: d.y + Math.sin(a) * r };
    }
    const b = area ?? layout.world;
    return {
      x: rng.range(b.x + margin, b.x + Math.max(margin + 1, b.width - margin)),
      y: rng.range(b.y + margin, b.y + Math.max(margin + 1, b.height - margin)),
    };
  };

  /** A sparse, varied start: what a culture looks like at boot and after a wash. */
  const seedSparse = () => {
    const w = layout.world;
    const area = layout.dish ? Math.PI * layout.dish.r ** 2 : w.width * w.height;
    const per = family === "life" ? 260_000 : family === "slime" ? 1_400_000 : 800_000;
    const n = Math.max(2, Math.min(60, Math.round(area / per)));
    for (let i = 0; i < n; i++) {
      const p = randomInWorld(120);
      if (family === "life") {
        const id = rng.next() < 0.7 ? "soup" : rng.pick(["glider", "ship", "bloom"]);
        place(STAMPS.life[stampIndex("life", id)]!, p.x, p.y, rng.int(8), { quiet: true });
      } else if (family === "slime") {
        place(STAMPS.slime[0]!, p.x, p.y, rng.int(4), { quiet: true });
      } else {
        const id = rng.pick(["drop-m", "drop-l", "drop-s"]);
        place(STAMPS.turing[stampIndex("turing", id)]!, p.x, p.y, 0, { quiet: true });
      }
    }
  };

  const startWash = (ms: number) => {
    wash = { start: now(), ms };
    pieces.clear();
  };

  const washFront = (t: number) => (wash ? ((t - wash.start) / wash.ms) * 1.15 : -1);

  // ---- Conditions ---------------------------------------------------------------------------

  const sliceValue = (p: number, pad: number, t: number): number => {
    const s = slicesByPos[p];
    if (!s || t - s.at > SLICE_TIMEOUT_MS) return defaultPreset(family);
    return s.values[pad] ?? defaultPreset(family);
  };

  const currentSlices = (t: number): Slice[] => {
    if (mode !== "screen") return evenSlices(regionValues);
    if (!config.slices) return evenSlices([oneValue]);
    const pads = Array.from({ length: count }, (_, i) => slicesByPos[i]?.pads ?? 1);
    return bankSlices(count, pads, (p, pad) => sliceValue(p, pad, t));
  };

  const uploadConditions = (c: Culture, t: number) => {
    if (family === "life") return;
    const slices = currentSlices(t);
    const W = layout.venue.width;
    const w = layout.world;
    const columns =
      mode === "screen"
        ? buildConditions(family, slices, 100 / W, (f) => (w.x + f * w.width) / W)
        : buildConditions(family, slices, 180 / w.width);
    c.setConditions(columns);
  };

  const setRegion = (region: number, value: number) => {
    if (value === regionValues[region]) return;
    regionValues[region] = value;
    layout.dials.forEach((d, i) => {
      if (d.region === region) view?.setDial(i, value);
    });
    conditionsDirty = true;
    if (mode === "dropper") sendCond(region);
  };

  // ---- Bank: touch frame side ---------------------------------------------------------------

  const screenPeer = () =>
    ctx.net.peers().find((p) => p.role === "screen" && p.frame !== ctx.net.self)?.frame ?? null;

  const sendCond = (pad: number) => {
    const to = screenPeer();
    if (!to || family === "life") return;
    ctx.net.send(
      TOPIC_COND,
      { fam: family, pos, pad, pads: padsHere, v: regionValues[pad] ?? 0 },
      to,
    );
  };

  const onDish = (d: DishMsg) => {
    lastDish = now();
    if (d.fam !== wanted) {
      wanted = d.fam;
      setFamily(caps.float || wanted === "life" ? wanted : "life");
    }
    if (d.fam !== family) return;
    if (d.one) {
      const v = d.s[0]?.[0];
      if (v !== undefined) regionValues.forEach((_, i) => setRegionQuiet(i, v));
    } else {
      // This frame owns its slices: if the screen disagrees (it reloaded), tell it again.
      const mine = d.s[pos] ?? [];
      for (let pad = 0; pad < padsHere; pad++) {
        if (mine[pad] !== regionValues[pad]) sendCond(pad);
      }
    }
  };

  const setRegionQuiet = (region: number, value: number) => {
    if (regionValues[region] === value) return;
    regionValues[region] = value;
    layout.dials.forEach((d, i) => {
      if (d.region === region) view?.setDial(i, value);
    });
    conditionsDirty = true;
  };

  const sendDrop = (pad: number, stamp: StampDef, u: number, strength: number, bot: boolean) => {
    const to = screenPeer();
    if (!to) return;
    dropCounter = (dropCounter + 1) % 2 ** 24;
    ctx.net.send(
      TOPIC_DROP,
      {
        id: dropCounter * 4 + pad,
        fam: family,
        s: stampIndex(family, stamp.id),
        pos,
        pad,
        u: Math.min(1, Math.max(0, u)),
        f: Math.min(1, Math.max(0, strength)),
        r: rng.int(8),
        seed: rng.int(2 ** 31),
        t: shared(),
        c: padColor(pad),
        a: bot,
      },
      to,
    );
  };

  const flick = (pad: Pad, x: number, y: number, strength: number, bot: boolean) => {
    const t = now();
    if (!padLimit[pad.side]?.take(t)) return;
    const stamp =
      STAMPS[family][stampIndex(family, padSel[pad.side] ?? "")] ?? defaultStamp(family);
    const color = rgbOf(stamp, padColor(pad.side));
    if (!bot) lastHuman = t;
    if (connected) {
      sendDrop(pad.side, stamp, x / layout.venue.width, strength, bot);
      pushFlight({
        x0: x,
        y0: y,
        x1: x,
        y1: -140,
        start: t,
        end: t + climbMs(strength),
        shared: false,
        color,
        size: 34,
      });
      countDrop(t);
      return;
    }
    const to = localLanding(x, strength, layout.world, stamp.radius + 30);
    pushFlight({
      x0: x,
      y0: y,
      x1: to.x,
      y1: to.y,
      start: t,
      end: t + climbMs(strength) + 250,
      shared: false,
      color,
      size: 34,
      land: () => {
        place(stamp, to.x, to.y, padColor(pad.side));
        view?.flash(pad.side);
      },
    });
  };

  const pushFlight = (f: Flight) => {
    flights.push(f);
    while (flights.length > MAX_FLIGHTS) {
      const old = flights.shift();
      old?.land?.();
    }
  };

  const preview = (t: number) => {
    previewAt = t;
    culture?.clear();
    queue.length = 0;
    pieces.clear();
    later.length = 0;
    for (const p of layout.pads) {
      const stamp =
        STAMPS[family][stampIndex(family, padSel[p.side] ?? "")] ?? defaultStamp(family);
      const c = padColor(p.side);
      const { x, y } = p.spot;
      if (stamp.kind === "food" || stamp.kind === "salt") {
        // Food and salt show what they do to spores around them.
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + rng.next();
          place(STAMPS.slime[0]!, x + Math.cos(a) * 160, y + Math.sin(a) * 120, c, { quiet: true });
        }
        place(stamp, x, y, c, { quiet: true });
      } else if (stamp.kind === "wash") {
        for (let i = 0; i < 5; i++) {
          place(STAMPS.turing[0]!, x + rng.range(-200, 200), y + rng.range(-120, 160), 0, {
            quiet: true,
          });
        }
        later.push({ at: t + 3500, fn: () => place(stamp, x, y, c) });
      } else {
        place(stamp, x, y, c, { quiet: true });
      }
    }
  };

  // ---- Bank: screen side --------------------------------------------------------------------

  const peersBelow = () =>
    ctx.net.peers().some((p) => p.role !== "screen" && p.frame !== ctx.net.self);

  const arrive = (d: DropMsg, from: string | null) => {
    const stamp = stampAt(d.fam, d.s);
    const dish = layout.dish;
    if (!stamp || d.fam !== family || !dish) return;
    const to = landing(d.pos, d.u, count, d.f, layout.venue, dish, stamp.radius + 40);
    const when = arrival(d.t, d.f, shared());
    const sx = to.x;
    pushFlight({
      x0: sx,
      y0: layout.venue.height + 80,
      x1: to.x,
      y1: to.y,
      start: when.start,
      end: when.land,
      shared: true,
      color: rgbOf(stamp, d.c),
      size: 46,
      land: () => {
        place(stamp, to.x, to.y, d.c, { transform: d.r, seed: d.seed });
        if (from) ctx.net.send(TOPIC_LANDED, { id: d.id }, from);
        landedLog.push({ id: d.id, x: to.x, y: to.y, pos: d.pos, pad: d.pad, u: d.u });
        if (landedLog.length > 24) landedLog.shift();
      },
    });
    if (!d.a) ctx.idle.poke();
  };

  const dishMessage = (t: number): DishMsg => ({
    fam: family,
    one: !config.slices,
    s: config.slices
      ? Array.from({ length: count }, (_, p) =>
          Array.from({ length: slicesByPos[p]?.pads ?? 1 }, (_, pad) => sliceValue(p, pad, t)),
        )
      : [[oneValue]],
  });

  const offNet = [
    ctx.net.on(TOPIC_DROP, (data, from) => {
      if (mode !== "screen") return;
      const d = decodeDrop(data);
      if (d && d.pos < count) arrive(d, from);
    }),
    ctx.net.on(TOPIC_COND, (data) => {
      if (mode !== "screen") return;
      const c = decodeCond(data);
      if (!c || c.fam !== family || c.pos >= count) return;
      if (!validCond(c.v)) return;
      if (config.slices) {
        const s = slicesByPos[c.pos] ?? { pads: c.pads, values: [], at: 0 };
        s.pads = c.pads;
        s.values[c.pad] = c.v;
        s.values.length = c.pads;
        s.at = now();
        slicesByPos[c.pos] = s;
      } else oneValue = c.v;
      conditionsDirty = true;
      dishDirty = true;
    }),
    ctx.net.on(TOPIC_DISH, (data) => {
      if (mode !== "dropper") return;
      const d = decodeDish(data);
      if (d) onDish(d);
    }),
    ctx.net.on(TOPIC_LANDED, (data) => {
      if (mode !== "dropper") return;
      const id = decodeLanded(data);
      if (id !== null) view?.flash(id % 4);
    }),
  ];

  const validCond = (v: number) => v >= 0 && v < presetCount(family);

  // ---- Input ----------------------------------------------------------------------------------

  const venueOf = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });

  const human = (p: Pointer) => {
    if (p.synthetic) return;
    lastHuman = now();
    attractMode = false;
  };

  const hitSwatch = (x: number, y: number) => {
    for (const p of layout.pads) {
      for (const s of p.swatches) if (inBox(s.box, x, y)) return { pad: p, swatch: s };
    }
    return null;
  };

  const hitDial = (x: number, y: number): number => {
    let found = -1;
    layout.dials.forEach((d, i) => {
      if (Math.hypot(x - d.cx, y - d.cy) <= d.r * 1.12) found = i;
    });
    return found;
  };

  const hitDetent = (x: number, y: number) => detentAt(layout, x, y);

  const turnTo = (dial: number, x: number, y: number) => {
    const d = layout.dials[dial];
    if (!d) return;
    if (Math.hypot(x - d.cx, y - d.cy) < d.r * 0.25) return;
    const a = Math.max(-d.spread / 2, Math.min(d.spread / 2, angleFromUp(x - d.cx, y - d.cy)));
    view?.turnDial(dial, a);
    setRegion(d.region, nearestDetent(a, presetCount(family), d.spread));
  };

  const inWorld = (x: number, y: number) =>
    mode !== "screen" &&
    inBox(layout.world, x, y) &&
    (layout.benchTop === null || y < layout.benchTop);

  const onDown = (p: Pointer) => {
    human(p);
    const { x, y } = venueOf(p);
    if (p.synthetic) view?.ghost(p.id, { x, y });
    const sw = hitSwatch(x, y);
    if (sw) {
      hands.pick(sw.pad.side, sw.swatch.stamp.id, now());
      padSel[sw.pad.side] = sw.swatch.stamp.id;
      view?.select(sw.pad.side, sw.swatch.stamp.id);
      view?.press(sw.pad.side, sw.swatch.stamp.id);
      if (mode === "dropper" && connected) previewAt = -Infinity;
      touches.set(p.id, { kind: "swatch" });
      return;
    }
    const det = hitDetent(x, y);
    if (det) {
      const d = layout.dials[det.dial];
      if (d) setRegion(d.region, det.value);
      touches.set(p.id, { kind: "swatch" });
      return;
    }
    const dial = hitDial(x, y);
    if (dial >= 0) {
      touches.set(p.id, { kind: "dial", dial });
      turnTo(dial, x, y);
      return;
    }
    if (mode === "dropper") {
      const pad = layout.pads.find((pd) => pd.flick && inBox(pd.flick, x, y));
      if (pad) {
        touches.set(p.id, { kind: "flick", pad: pad.side, x, y, t: now() });
        return;
      }
    }
    if (inWorld(x, y)) touches.set(p.id, { kind: "tap", x, y, t: now() });
    else touches.set(p.id, { kind: "none" });
  };

  const onMove = (p: Pointer) => {
    const t = touches.get(p.id);
    const { x, y } = venueOf(p);
    if (p.synthetic) view?.ghost(p.id, { x, y });
    if (t?.kind === "dial") turnTo(t.dial, x, y);
  };

  const onUp = (p: Pointer, cancelled: boolean) => {
    const t = touches.get(p.id);
    touches.delete(p.id);
    view?.ghost(p.id, null);
    if (!t || cancelled) {
      if (t?.kind === "dial") view?.turnDial(t.dial, null);
      return;
    }
    const { x, y } = venueOf(p);
    const elapsed = t.kind === "tap" || t.kind === "flick" ? now() - t.t : 0;
    if (t.kind === "dial") view?.turnDial(t.dial, null);
    else if (t.kind === "tap") {
      if (Math.hypot(x - t.x, y - t.y) > TAP_SLOP || elapsed > TAP_MS) return;
      tapAt(t.x, t.y);
    } else if (t.kind === "flick") {
      const rise = t.y - y;
      const speed = Math.max(-p.vy / frame.unit, (rise * 1000) / Math.max(16, elapsed));
      if (rise < FLICK_MIN || speed < FLICK_SPEED) return;
      const pad = layout.pads[t.pad];
      if (pad)
        flick(pad, x, Math.min(t.y, y), Math.min(1, (speed - FLICK_SPEED) / 2600), p.synthetic);
    }
  };

  const tapAt = (x: number, y: number) => {
    const pad = padAt(layout, x);
    const side = pad?.side ?? 0;
    const t = now();
    const m = hands.bind(x, y, side, t);
    if (!hands.allow(m, t)) return;
    const stamp = STAMPS[family][stampIndex(family, m.stamp)] ?? defaultStamp(family);
    const color = family === "slime" ? m.color % 4 : m.color;
    place(stamp, x, y, color);
    view?.select(side, hands.current(side));
  };

  const offInput = [
    ctx.input.on("down", onDown),
    ctx.input.on("move", onMove),
    ctx.input.on("up", (p) => onUp(p, false)),
    ctx.input.on("cancel", (p) => onUp(p, true)),
  ];

  // ---- Bots and attract ------------------------------------------------------------------------

  const free = (x: number, y: number) =>
    !controlBoxes(layout).some(
      (b) => x > b.x - 60 && y > b.y - 60 && x < b.x + b.width + 60 && y < b.y + b.height + 60,
    ) && !layout.dials.some((d) => inBox(dialBounds(d), x, y));

  const tapArea = (pad: Pad): Box | null => {
    if (mode === "dropper") return null;
    const W = layout.venue.width;
    const H = layout.venue.height;
    const top = Math.max(layout.reach.top + 40, 60);
    const bottom = Math.min(...pad.swatches.map((s) => s.box.y)) - 60;
    if (kind === "wall") {
      const span = Math.min(1600, W / 2 - 200);
      return pad.side === 0
        ? { x: pad.x1 + 80, y: top, width: span, height: Math.max(40, H - 120 - top) }
        : { x: pad.x0 - 80 - span, y: top, width: span, height: Math.max(40, H - 120 - top) };
    }
    return {
      x: pad.x0 + 40,
      y: top,
      width: pad.x1 - pad.x0 - 80,
      height: Math.max(40, bottom - top),
    };
  };

  const scene = (weights: Record<string, number>) => (): ActorScene | null => {
    if (mode === "screen") return null;
    return {
      pads: layout.pads,
      dials: layout.dials,
      detents: presetCount(family),
      weights,
      tapArea: (pad) => {
        const area = tapArea(pad);
        if (!area) return null;
        // A few tries for a spot clear of every control.
        for (let i = 0; i < 6; i++) {
          const x = rng.range(area.x, area.x + area.width);
          const y = rng.range(area.y, area.y + area.height);
          if (free(x, y)) return { x: x - 1, y: y - 1, width: 2, height: 2 };
        }
        return area;
      },
    };
  };

  const bots: Actors | null =
    ctx.bots > 0 && mode !== "screen"
      ? createActors({
          input: ctx.input,
          rng: ctx.rng("petri-bots"),
          count: Math.min(4, ctx.bots),
          unit: () => frame.unit,
          scene: scene(BOT_WEIGHTS),
          rest: [1.2, 3.5],
          dialChance: 0.2,
        })
      : null;
  const attract: Actors | null =
    mode !== "screen"
      ? createActors({
          input: ctx.input,
          rng: ctx.rng("petri-attract"),
          count: 1,
          unit: () => frame.unit,
          scene: scene(ATTRACT_WEIGHTS),
          rest: mode === "dropper" ? [7, 12] : [5, 9],
          dialChance: 0.12,
        })
      : null;

  // ---- Rain -------------------------------------------------------------------------------------

  const emptiest = (area: Box): { x: number; y: number } => {
    let best = randomInWorld(100, area);
    if (!blocks) return best;
    let bestV = Infinity;
    const w = layout.world;
    for (let i = 0; i < 10; i++) {
      const p = layout.dish && area === layout.rain ? rimPoint() : randomInWorld(100, area);
      const bx = Math.floor(((p.x - w.x) / w.width) * STATS_SIZE);
      const by = Math.floor(((p.y - w.y) / w.height) * STATS_SIZE);
      const v =
        blocks[
          Math.min(STATS_SIZE - 1, Math.max(0, by)) * STATS_SIZE +
            Math.min(STATS_SIZE - 1, Math.max(0, bx))
        ] ?? 0;
      if (v < bestV) {
        bestV = v;
        best = p;
      }
    }
    return best;
  };

  const rimPoint = () => {
    const d = layout.dish!;
    const a = rng.range(0, Math.PI * 2);
    const r = d.r * rng.range(0.7, 0.9);
    return { x: d.x + Math.cos(a) * r, y: d.y + Math.sin(a) * r };
  };

  const rainOnce = () => {
    const p = layout.dish ? (blocks ? emptiest(layout.rain) : rimPoint()) : emptiest(layout.rain);
    if (family === "life") {
      const id = rng.next() < 0.6 ? "soup" : rng.pick(["glider", "ship", "bloom", "spark"]);
      place(
        STAMPS.life[stampIndex("life", id)]!,
        p.x,
        p.y,
        rng.next() < 0.5 ? SEED_COLOR : rng.int(8),
      );
    } else if (family === "slime") {
      const food = rng.next() < 0.15;
      place(food ? STAMPS.slime[1]! : STAMPS.slime[0]!, p.x, p.y, rng.int(4));
    } else {
      const crowded = (coverage ?? 0) > 0.5;
      const id = crowded && rng.next() < 0.5 ? "wash" : rng.pick(["drop-m", "drop-l"]);
      place(STAMPS.turing[stampIndex("turing", id)]!, p.x, p.y, 0);
    }
  };

  /** The screen with nobody below: scripted drops arrive from beneath, as if flicked. */
  const attractDrop = () => {
    const stamp = rng.next() < 0.75 ? defaultStamp(family) : rng.pick(STAMPS[family]);
    if (stamp.kind === "wash") return;
    arrive(
      {
        id: 0,
        fam: family,
        s: stampIndex(family, stamp.id),
        pos: rng.int(count),
        pad: 0,
        u: rng.range(0.2, 0.8),
        f: rng.range(0.1, 0.95),
        r: rng.int(8),
        seed: rng.int(2 ** 31),
        t: shared(),
        c: rng.int(8),
        a: true,
      },
      null,
    );
  };

  // ---- Reset --------------------------------------------------------------------------------

  const resetPad = (side: number) => {
    if (mode === "dropper" && connected) {
      padSel[side] = defaultStamp(family).id;
      view?.select(side, padSel[side]);
      const pad = layout.pads[side];
      if (pad) setRegion(pad.region, defaultPreset(family));
      previewAt = -Infinity;
      return;
    }
    startWash(WASH_MS);
  };

  // ---- Update (60 Hz) ---------------------------------------------------------------------------

  const update = (dt: number) => {
    if (disposed) return;
    const t = now();
    pieces.expire(t);
    for (let i = later.length - 1; i >= 0; i--) {
      const l = later[i]!;
      if (l.at <= t) {
        later.splice(i, 1);
        l.fn();
      }
    }
    const st = shared();
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]!;
      if ((f.shared ? st : t) >= f.end) {
        flights.splice(i, 1);
        f.land?.();
      }
    }
    if (wash && washFront(t) > 1.15) {
      wash = null;
      seedSparse();
    }

    if (mode === "dropper") {
      const was = connected;
      connected = screenPeer() !== null && t - lastDish < DISH_TIMEOUT_MS;
      if (connected !== was) {
        changedAt = Date.now();
        if (connected) previewAt = -Infinity;
        else {
          later.length = 0;
          seedSparse();
        }
        conditionsDirty = true;
      }
      if (connected && t - previewAt > PREVIEW_MS && !wash) preview(t);
      if (screenPeer() && t - condSentAt > COND_EVERY_MS) {
        condSentAt = t;
        for (let pad = 0; pad < padsHere; pad++) sendCond(pad);
      }
      layout.pads.forEach((p) => {
        const sel =
          STAMPS[family][stampIndex(family, padSel[p.side] ?? "")] ?? defaultStamp(family);
        const [r, g, b] = rgbOf(sel, padColor(p.side));
        const css = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
        view?.pipette(p.side, css, padLimit[p.side]?.fill(t) ?? 1);
      });
    }

    if (mode === "screen") {
      if (dishDirty || t - dishSentAt > DISH_EVERY_MS) {
        dishSentAt = t;
        dishDirty = false;
        ctx.net.send(TOPIC_DISH, dishMessage(t));
        const W = layout.venue.width;
        const slices = currentSlices(t);
        view?.slices(
          config.slices && ctx.setup.name === "bank"
            ? slices.map((s) => ({ x: ((s.from + s.to) / 2) * W, value: s.value }))
            : [],
          family,
        );
      }
      if (!peersBelow()) {
        attractDropIn -= dt;
        if (attractDropIn <= 0) {
          attractDropIn = rng.range(4, 7);
          attractDrop();
        }
      }
      // Slices fall back to default 30 s after their panel goes quiet.
      if (
        config.slices &&
        slicesByPos.some((s) => s && t - s.at > SLICE_TIMEOUT_MS && s.values.length)
      ) {
        slicesByPos.forEach((s, i) => {
          if (s && t - s.at > SLICE_TIMEOUT_MS) slicesByPos[i] = null;
        });
        conditionsDirty = true;
        dishDirty = true;
      }
    }

    if (config.rain && !(mode === "dropper" && connected) && !wash) {
      rainIn -= dt;
      if (rainIn <= 0) {
        rainOnce();
        const sparse = coverage !== null && coverage < SPARSE[family];
        rainIn = sparse ? 2 : rng.range(25, 45);
      }
    }

    const botsOn = bots && t - lastHuman > BOT_YIELD_MS ? Math.min(4, ctx.bots) : 0;
    bots?.update(dt, botsOn);
    attract?.update(dt, !bots && attractMode && !wash ? 1 : 0);
  };

  // ---- Render -----------------------------------------------------------------------------------

  const fxA = new Float32Array(MAX_FX * 4);
  const fxB = new Float32Array(MAX_FX * 4);
  const viewInputs: ViewInputs = {
    time: 0,
    venue: { width: 1, height: 1 },
    world: { x: 0, y: 0, width: 1, height: 1 },
    dish: null,
    benchTop: null,
    fxCount: 0,
    fxA,
    fxB,
    wash: { front: -1, radial: false },
    marks: [],
    colors: LIFE_COLORS,
    strainColors: STRAIN_COLORS,
  };

  const fillFx = (t: number, st: number) => {
    let n = 0;
    const put = (x: number, y: number, r: number, age: number, c: readonly number[], k: number) => {
      if (n >= MAX_FX) return;
      fxA.set([x, y, r, age], n * 4);
      fxB.set([c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, k], n * 4);
      n++;
    };
    const w = layout.world;
    for (const p of pieces.list) {
      put(
        w.x + p.x,
        w.y + p.y,
        p.r,
        pieces.left(p, t),
        p.kind === "food" ? [1, 0.8, 0.4] : [0.8, 0.9, 1],
        p.kind === "food" ? FX.food : FX.salt,
      );
    }
    for (const f of flights) {
      const clock = f.shared ? st : t;
      const k = (clock - f.start) / Math.max(1, f.end - f.start);
      if (k < 0) continue;
      const e = 1 - (1 - Math.min(1, k)) ** 3;
      const x = f.x0 + (f.x1 - f.x0) * e;
      const y = f.y0 + (f.y1 - f.y0) * e;
      put(x, y, f.size * (1 - 0.25 * e), 0, f.color, FX.bead);
    }
    for (const r of ripples) {
      const age = (t - r.born) / RIPPLE_MS;
      if (age < 1) put(r.x, r.y, r.r, age, r.color, FX.ripple);
    }
    while (ripples.length > 0 && t - (ripples[0]?.born ?? t) > RIPPLE_MS) ripples.shift();
    viewInputs.fxCount = n;
  };

  const render = () => {
    if (disposed) return;
    const t = now();
    const dt = lastRender ? Math.min(0.1, (t - lastRender) / 1000) : 1 / 60;
    if (lastRender) {
      frameMs += (t - lastRender - frameMs) * 0.1;
      // Slow frames shed simulation work; fast ones win it back.
      load = Math.min(1, Math.max(0.2, load * (frameMs > 40 ? 0.94 : frameMs < 24 ? 1.03 : 1)));
    }
    lastRender = t;
    const c = culture;
    const r = renderer;
    if (!c || !r) return;
    gpu?.run((gl) => {
      const st = shared();
      if (conditionsDirty) {
        uploadConditions(c, t);
        conditionsDirty = false;
      }
      const front = washFront(t);
      const radial = layout.dish !== null;
      c.update({
        dt,
        stamps: queue,
        wash: { front, radial },
        pieces: pieceInputs(t),
        time: t / 1000,
        load,
      });
      const s = c.pollStats();
      if (s) {
        coverage = s.coverage;
        blocks = s.blocks;
        if (coverage < SPARSE[family]) rainIn = Math.min(rainIn, 1);
      } else if (t - statsAt > STATS_MS) {
        statsAt = t;
        c.requestStats();
      }
      viewInputs.time = (t / 1000) % 3600;
      viewInputs.venue = layout.venue;
      viewInputs.world = layout.world;
      viewInputs.dish = layout.dish;
      viewInputs.benchTop = layout.benchTop;
      viewInputs.wash = { front, radial };
      viewInputs.marks = markPositions(t);
      fillFx(t, st);
      r.draw(viewInputs, gl.drawingBufferWidth, gl.drawingBufferHeight);
    });
  };

  const pieceInputs = (t: number) =>
    pieces.list.map((p) => ({
      x: p.x,
      y: p.y,
      r: p.r,
      strength: (p.kind === "food" ? 1 : -1) * pieces.left(p, t),
    }));

  let marksCache: number[] = [];
  let marksAt = -Infinity;
  const markPositions = (t: number): number[] => {
    if (family === "life") return [];
    if (t - marksAt < 500) return marksCache;
    marksAt = t;
    if (mode !== "screen") {
      marksCache = layout.marks.filter((_, i) => regionValues[i] !== regionValues[i + 1]);
      return marksCache;
    }
    const slices = currentSlices(t);
    const W = layout.venue.width;
    marksCache = [];
    for (let i = 1; i < slices.length; i++) {
      if (slices[i]!.value !== slices[i - 1]!.value) marksCache.push(slices[i]!.from * W);
    }
    return marksCache;
  };

  // ---- GPU --------------------------------------------------------------------------------------

  const backdrop = document.createElement("div");
  backdrop.style.cssText = `position:absolute;inset:0;background:${PALETTE.background};`;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;";
  ctx.root.append(backdrop, host);

  let warned = false;
  // `gpu` is assigned once createGpu returns; onReady runs inside it, so it never uses `gpu`.
  let gpu: ReturnType<typeof createGpu> | null = null;
  gpu = createGpu({
    host,
    onReady(gl, c) {
      caps = c;
      const f = wanted !== "life" && !c.float ? "life" : wanted;
      if (f !== wanted && !warned) {
        warned = true;
        fallback = "no float render targets";
        console.warn(`petri: ${wanted} needs EXT_color_buffer_float; running life instead`);
      }
      if (f !== family || !view) {
        family = f;
        hands = makeHands();
        padSel = [];
        resetConditions();
        relayout();
      }
      buildGpu(gl);
    },
    onLost() {
      renderer = null;
      culture = null;
    },
    onError(message) {
      console.error(message);
    },
  });
  if (!view) relayout();
  sizeCanvas();

  const loop = ctx.loop({ hz: 60, update, render });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) relayout();
    }, 200);
  });

  // Tests and debugging only: a read-only view of the app's state.
  const debugKey = "__petri";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          family,
          mode,
          connected,
          coverage,
          placed,
          regions: [...regionValues],
          selections: [...padSel],
          slices: mode === "screen" ? currentSlices(now()) : null,
          count,
          changedAt,
          landed: [...landedLog],
          flights: flights.length,
          pieces: pieces.list.length,
          queue: queue.length,
          layout: {
            pads: layout.pads,
            dials: layout.dials,
            world: layout.world,
            dish: layout.dish,
          },
        }),
        lifeCheck: (w: number, h: number, cells: [number, number, number][], gens: number) => {
          let out: number[] | null = null;
          gpu?.run((gl) => {
            out = Array.from(lifeSelfTest(gl, w, h, cells, gens));
          });
          return out;
        },
        flick: (side: number, u: number, strength: number) => {
          const pad = layout.pads[side];
          if (!pad?.flick) return false;
          padLimit[side]?.reset();
          flick(pad, u * layout.venue.width, pad.flick.y + pad.flick.height * 0.7, strength, true);
          return true;
        },
        setDial: (region: number, value: number) => setRegion(region, value),
        load: () => load,
      },
    });
  }

  return {
    reset() {
      bots?.release();
      attract?.release();
      hands.clear();
      padSel = layout.pads.map(() => defaultStamp(family).id);
      layout.pads.forEach((p) => view?.select(p.side, padSel[p.side]!));
      for (let i = 0; i < regionValues.length; i++) setRegion(i, defaultPreset(family));
      oneValue = defaultPreset(family);
      dishDirty = true;
      conditionsDirty = true;
      startWash(IDLE_WASH_MS);
    },
    attract() {
      attractMode = true;
    },
    status() {
      const c = culture;
      const population =
        coverage === null || !c
          ? 0
          : family === "life"
            ? Math.round(coverage * c.gridW * c.gridH)
            : Math.round(coverage * 1000) / 10;
      const t = now();
      return {
        family,
        population,
        dropsPerMin: dropTimes.filter((x) => x > t - 60_000).length,
        mode: mode === "dropper" ? (connected ? "dropper" : "local") : mode,
        gl: gpu?.ready ? (caps.software ? "software" : "ok") : "starting",
        fallback,
        washing: wash !== null,
      };
    },
    homeSpot(size) {
      if (mode === "screen" || kind !== "wall") return null;
      const x = layout.dials.length === 3 ? layout.venue.width / 2 + 520 : layout.venue.width / 2;
      return {
        x: Math.round(x * frame.unit - size / 2),
        y: Math.round((layout.reach.top + 40) * frame.unit),
      };
    },
    command(name) {
      if (name === "wash") startWash(WASH_MS);
      else if (name === "gl-lose") gpu?.simulateLoss(1500);
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offInput) off();
      for (const off of offNet) off();
      bots?.dispose();
      attract?.dispose();
      view?.dispose();
      view = null;
      gpu?.run(() => {
        renderer?.dispose();
        culture?.dispose();
      });
      renderer = null;
      culture = null;
      gpu?.dispose();
      backdrop.remove();
      host.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
