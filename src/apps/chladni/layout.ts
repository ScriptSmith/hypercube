import type { FrameKind, Reach } from "../../core/types";
import {
  aspectOf,
  BANK_KEYS_PER_PANEL,
  bankKeyMode,
  bankKeysOf,
  MAX_ASPECT,
  type PlateShape,
  type Point,
  soloKeyModes,
} from "./modes";

/**
 * Where everything goes, in frame venue px (origin top left). Keys sit in the child band, lowest
 * notes left (and in the bottom row when there are two); above them each group has a row with
 * its glide strip and reset, and above that a row with the stretch and damping sliders, in the
 * adult band where the frame has one. Where the plate is out of reach (the wall) or elsewhere
 * (a bank's screen) a map of the plate beside or above the rows moves the drive point. On a
 * merged pair nothing touchable comes within SEAM_CLEAR of a seam.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A drawn plate rectangle (or the box around a disc), by its centre. */
export interface Rect {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * A plate: a square of side `size` or a disc of diameter `size`, centred on (cx, cy). Stretched,
 * it grows within `room`, its long side across when `wide`. With `hang` it keeps its top edge
 * instead and, once short enough, widens into `hang` (the wall, whose sides hold controls below).
 */
export interface PlateBox {
  cx: number;
  cy: number;
  size: number;
  room: Box;
  wide: boolean;
  hang: Box | null;
}

export interface KeySpec {
  /** Index among this frame's keys. */
  index: number;
  /** The plate mode it rings. */
  mode: number;
  box: Box;
  plate: number;
  /** Key number along a bank, or null on a solo frame. */
  bank: number | null;
}

export interface GlideSpec {
  index: number;
  box: Box;
  vertical: boolean;
  plate: number;
  /** Modes at its marks, ascending. */
  notes: number[];
  /** Neighbouring notes beyond its ends, if any. */
  below: number | null;
  above: number | null;
}

export type Knob = "stretch" | "damping";

export interface SliderSpec {
  index: number;
  knob: Knob;
  box: Box;
  vertical: boolean;
  plate: number;
}

/** A small picture of a plate, inside the reach band, that moves its drive point. */
export interface MapSpec {
  index: number;
  box: Box;
  plate: number;
  /** False when the drive point is fixed: the map only shows the plate. */
  touch: boolean;
}

export interface ResetSpec {
  box: Box;
  plate: number;
}

/** A frame playing on its own plate, a bank touch frame playing the screen's, or the screen. */
export type Mode = "solo" | "keyboard" | "screen";

export interface Layout {
  mode: Mode;
  venue: { width: number; height: number };
  plates: PlateBox[];
  keys: KeySpec[];
  glides: GlideSpec[];
  sliders: SliderSpec[];
  maps: MapSpec[];
  resets: ResetSpec[];
  /** Stage y (venue px) of the top of adult and child reach. */
  reach: { adult: number; child: number };
}

/** Which of the plate's settings the frame offers. */
export interface Controls {
  glide: boolean;
  stretch: boolean;
  damping: boolean;
  puck: boolean;
}

export interface LayoutInput {
  kind: FrameKind;
  mode: Mode;
  venue: { width: number; height: number };
  reach: Reach;
  shape: PlateShape;
  /** Keys on a solo frame. */
  keys: number;
  /** Plates on a wall. */
  plates: number;
  controls: Controls;
  modeCount: number;
  /** Panels in a merged frame. */
  span: number;
  /** Bank position and touch frame count. */
  pos: number;
  count: number;
}

export const SEAM_CLEAR = 140;
export const MIN_KEY = 240;
export const RESET_SIZE = 150;
const MARGIN = 40;
const GAP = 20;
const ROW_GAP = 30;
export const GLIDE_H = 150;
export const SLIDER_H = 130;
/** Side of a wall's map, which spans its slider and glide rows. */
const SIDE_MAP = SLIDER_H + GAP + GLIDE_H;
export const MIN_DAMPING = 300;

/** Smallest key the layout accepts on each kind; the wall is coarse, the kiosk fine. */
export const minKeyFor = (kind: FrameKind): number =>
  kind === "kiosk" ? 150 : kind === "wall" ? 200 : MIN_KEY;

/** Shortest glide and stretch slider: 600 on panels, less on the coarse wall and the kiosk. */
export const minStripFor = (kind: FrameKind): number =>
  kind === "wall" ? 500 : kind === "kiosk" ? 520 : 600;

const maxKeyFor = (kind: FrameKind, mode: Mode): number =>
  mode === "keyboard" ? 460 : kind === "wall" ? 260 : kind === "kiosk" ? 240 : 280;

export const inBox = (b: Box, x: number, y: number, slop = 0): boolean =>
  x >= b.x - slop && y >= b.y - slop && x <= b.x + b.width + slop && y <= b.y + b.height + slop;

// ---- Plates ---------------------------------------------------------------------------------

/** A square plate filling the middle of `room`, which it may stretch to fill. */
const plateIn = (room: Box): PlateBox => {
  const size = Math.min(room.width, room.height);
  // Lay the long side whichever way gives the larger plate at full stretch.
  const wideArea = Math.min(room.width, room.height * MAX_ASPECT) ** 2 / MAX_ASPECT;
  const tallArea = Math.min(room.height, room.width * MAX_ASPECT) ** 2 / MAX_ASPECT;
  return {
    cx: room.x + room.width / 2,
    cy: room.y + room.height / 2,
    size,
    room,
    wide: wideArea >= tallArea,
    hang: null,
  };
};

/** Fit a rectangle of long side over short side `aspect` in `room`, centred. */
const fitIn = (room: Box, aspect: number, wide: boolean): Rect => {
  const width = wide
    ? Math.min(room.width, room.height * aspect)
    : Math.min(room.width, room.height / aspect);
  const height = wide ? width / aspect : width * aspect;
  return { cx: room.x + room.width / 2, cy: room.y + room.height / 2, width, height };
};

/** The plate as drawn at a stretch of 0 (square) to 1 (2:1). */
export const plateRect = (p: PlateBox, stretch: number): Rect => {
  const a = aspectOf(stretch);
  if (a <= 1) return { cx: p.cx, cy: p.cy, width: p.size, height: p.size };
  if (!p.hang) return fitIn(p.room, a, p.wide);
  // The wall: keep the top edge and narrow from below; once clear of the side controls, widen.
  const top = p.cy - p.size / 2;
  const h = p.size / a;
  if (h > p.hang.height) return { cx: p.cx, cy: top + h / 2, width: p.size, height: h };
  const height = Math.min(p.hang.height, p.hang.width / a);
  return { cx: p.cx, cy: top + height / 2, width: height * a, height };
};

/** Room a map leaves round its plate, as a share of its side, so a puck at the rim stays inside. */
const MAP_INSET = 0.12;

/** A plate drawn inside a map's box, as the map shows it. */
export const mapRect = (box: Box, stretch: number, wide: boolean): Rect => {
  const pad = MAP_INSET * Math.min(box.width, box.height);
  const inner = {
    x: box.x + pad,
    y: box.y + pad,
    width: box.width - 2 * pad,
    height: box.height - 2 * pad,
  };
  return fitIn(inner, aspectOf(stretch), wide);
};

/** Plate coordinates of a frame point on a drawn rectangle (not clamped). */
export const toPlate = (r: Rect, x: number, y: number): Point => ({
  u: ((x - r.cx) / r.width) * 2,
  v: ((y - r.cy) / r.height) * 2,
});

/** The frame point of plate coordinates on a drawn rectangle. */
export const fromPlate = (r: Rect, p: Point): { x: number; y: number } => ({
  x: r.cx + (p.u * r.width) / 2,
  y: r.cy + (p.v * r.height) / 2,
});

/** Plate coordinates of a frame point, or null when it is off every plate. */
export const plateAt = (
  layout: Layout,
  round: boolean,
  x: number,
  y: number,
  stretch: (plate: number) => number = () => 0,
): { plate: number; u: number; v: number } | null => {
  for (let i = 0; i < layout.plates.length; i++) {
    const { u, v } = toPlate(plateRect(layout.plates[i]!, stretch(i)), x, y);
    if (round ? u * u + v * v <= 1 : Math.abs(u) <= 1 && Math.abs(v) <= 1)
      return { plate: i, u, v };
  }
  return null;
};

// ---- Keys -----------------------------------------------------------------------------------

interface Fit {
  size: number;
  rows: number;
  cols: number;
}

/** Each extra row must buy keys this much larger, since a row costs the plate height. */
const ROW_COST = 0.12;

/** The largest square keys (up to `max`) that fit `n` keys in `width` by `height`. */
export const fitKeys = (
  n: number,
  width: number,
  height: number,
  max: number,
  rowCost = ROW_COST,
): Fit => {
  let best: Fit = { size: 0, rows: 1, cols: Math.max(1, n) };
  let bestScore = -1;
  for (let rows = 1; rows <= Math.max(1, n); rows++) {
    const cols = Math.ceil(n / rows);
    const size = Math.floor(
      Math.min(max, (width - (cols - 1) * GAP) / cols, (height - (rows - 1) * GAP) / rows),
    );
    const score = size * (1 - rowCost * (rows - 1));
    if (size > 0 && score > bestScore + 0.5) {
      best = { size, rows, cols };
      bestScore = score;
    }
  }
  return best;
};

/**
 * Key boxes for `fit` in an area whose bottom edge is `bottom`, aligned left, right or centred
 * between `x0` and `x1`. Row-major from the bottom row, so the lowest notes are lowest.
 */
const placeKeys = (
  n: number,
  fit: Fit,
  x0: number,
  x1: number,
  bottom: number,
  align: "left" | "right" | "center",
): Box[] => {
  const out: Box[] = [];
  const s = fit.size;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / fit.cols);
    const inRow = Math.min(fit.cols, n - row * fit.cols);
    const rowWidth = inRow * s + (inRow - 1) * GAP;
    const start =
      align === "left" ? x0 : align === "right" ? x1 - rowWidth : (x0 + x1 - rowWidth) / 2;
    const col = i - row * fit.cols;
    out.push({
      x: start + col * (s + GAP),
      y: bottom - (row + 1) * s - row * GAP,
      width: s,
      height: s,
    });
  }
  return out;
};

/** The fewest rows that fit `n` keys of `size` across `width`. */
const rowsFor = (n: number, width: number, size: number): Fit => {
  for (let rows = 1; rows < n; rows++) {
    const cols = Math.ceil(n / rows);
    if (cols * size + (cols - 1) * GAP <= width + 0.5) return { size, rows, cols };
  }
  return { size, rows: n, cols: 1 };
};

const blockHeight = (fit: Fit) => fit.rows * fit.size + (fit.rows - 1) * GAP;

/** Split `modes` into `groups` runs, lower runs first and no smaller than later ones. */
const split = (modes: number[], groups: number): number[][] => {
  const out: number[][] = [];
  let at = 0;
  for (let g = 0; g < groups; g++) {
    const take = Math.ceil((modes.length - at) / (groups - g));
    out.push(modes.slice(at, at + take));
    at += take;
  }
  return out;
};

// ---- Rows of controls -----------------------------------------------------------------------

interface Group {
  /** Horizontal extent available to the group's controls. */
  x0: number;
  x1: number;
  align: "left" | "right" | "center";
  /** Which end the reset sits at. */
  resetEnd: "left" | "right";
  plate: number;
  modes: number[];
  bank: number[] | null;
  /** A map at this end of the rows (the wall), or none. */
  mapEnd: "left" | "right" | null;
  /** Room left free at the slider row's right end (the wall's Home control). */
  clearRight: number;
  sliders: Knob[];
}

const reachYs = (venue: { height: number }, reach: Reach) => ({
  adult: venue.height * (1 - reach.adult),
  child: venue.height * (1 - reach.child),
});

/** The knobs a frame offers as sliders. */
const knobsOf = (input: LayoutInput): Knob[] => {
  const out: Knob[] = [];
  if (input.controls.stretch && input.shape === "square") out.push("stretch");
  if (input.controls.damping) out.push("damping");
  return out;
};

/**
 * Give each group its sliders: all of them where every group on a plate has room for each at its
 * shortest, otherwise one each in turn among the groups sharing that plate.
 */
const shareSliders = (groups: Group[], knobs: Knob[], kind: FrameKind) => {
  const room = (g: Group) => g.x1 - g.x0 - (g.mapEnd ? SIDE_MAP + GAP : 0) - g.clearRight;
  const need = minStripFor(kind) + GAP + MIN_DAMPING;
  const plates = new Set(groups.map((g) => g.plate));
  for (const plate of plates) {
    const mine = groups.filter((g) => g.plate === plate);
    const all = knobs.length < 2 || mine.length < 2 || mine.every((g) => room(g) >= need);
    mine.forEach((g, i) => {
      g.sliders = all ? [...knobs] : knobs.length ? [knobs[i % knobs.length]!] : [];
    });
  }
};

/** Glide neighbours for consecutive groups that share a plate. */
const linkGlides = (glides: GlideSpec[]) => {
  for (const g of glides) {
    const prev = glides.find((o) => o.plate === g.plate && o.index === g.index - 1);
    const next = glides.find((o) => o.plate === g.plate && o.index === g.index + 1);
    if (prev && g.below === null) g.below = prev.notes[prev.notes.length - 1] ?? null;
    if (next && g.above === null) g.above = next.notes[0] ?? null;
  }
};

type Rows = Pick<Layout, "keys" | "glides" | "sliders" | "maps" | "resets"> & {
  keysTop: number;
  /** Top of the topmost row: the plate (or a bank's map) goes above it. */
  top: number;
};

/**
 * Rows of keys along the bottom with a glide strip and a reset above each group, and the
 * sliders above those: the panel, the merged pair, the wall and the bank keyboard all use this.
 * `rowsBottom` places the glide row's bottom edge (default: just above the keys).
 */
const rowLayout = (
  input: LayoutInput,
  groups: Group[],
  keyArea: { bottom: number; maxHeight: number },
  rowsBottom: ((keysTop: number) => number) | null,
): Rows => {
  const max = maxKeyFor(input.kind, input.mode);
  // One key size for the whole frame, so both sides of a pair or wall match, and one block
  // height: the tallest group's.
  let size = max;
  for (const g of groups) {
    size = Math.min(
      size,
      fitKeys(Math.max(1, g.modes.length), g.x1 - g.x0, keyArea.maxHeight, max).size,
    );
  }
  const fits = groups.map((g) => rowsFor(Math.max(1, g.modes.length), g.x1 - g.x0, size));
  const rowsUsed = Math.max(...fits.map((f) => f.rows));
  const keysTop = keyArea.bottom - blockHeight({ size, rows: rowsUsed, cols: 1 });
  const glideBottom = rowsBottom ? rowsBottom(keysTop) : keysTop - ROW_GAP;
  const glideTop = glideBottom - GLIDE_H;
  const anySliders = groups.some((g) => g.sliders.length > 0);
  const sliderTop = anySliders ? glideTop - GAP - SLIDER_H : glideTop;
  const out: Rows = {
    keys: [],
    glides: [],
    sliders: [],
    maps: [],
    resets: [],
    keysTop,
    top: sliderTop,
  };
  groups.forEach((g, gi) => {
    const boxes = placeKeys(
      g.modes.length,
      { ...fits[gi]!, size },
      g.x0,
      g.x1,
      keyArea.bottom,
      g.align,
    );
    g.modes.forEach((mode, i) => {
      out.keys.push({
        index: out.keys.length,
        mode,
        box: boxes[i]!,
        plate: g.plate,
        bank: g.bank ? (g.bank[i] ?? null) : null,
      });
    });
    let x0 = g.x0;
    let x1 = g.x1;
    if (g.mapEnd) {
      const mx = g.mapEnd === "left" ? g.x0 : g.x1 - SIDE_MAP;
      out.maps.push({
        index: out.maps.length,
        box: { x: mx, y: sliderTop, width: SIDE_MAP, height: glideBottom - sliderTop },
        plate: g.plate,
        touch: input.controls.puck,
      });
      if (g.mapEnd === "left") x0 += SIDE_MAP + GAP;
      else x1 -= SIDE_MAP + GAP;
    }
    const resetX = g.resetEnd === "left" ? x0 : x1 - RESET_SIZE;
    out.resets.push({
      box: {
        x: resetX,
        y: glideTop + (GLIDE_H - RESET_SIZE) / 2,
        width: RESET_SIZE,
        height: RESET_SIZE,
      },
      plate: g.plate,
    });
    if (input.controls.glide) {
      const x = g.resetEnd === "left" ? x0 + RESET_SIZE + GAP : x0;
      out.glides.push({
        index: gi,
        box: { x, y: glideTop, width: x1 - x0 - RESET_SIZE - GAP, height: GLIDE_H },
        vertical: false,
        plate: g.plate,
        notes: [...g.modes],
        below: null,
        above: null,
      });
    }
    const sx1 = x1 - g.clearRight;
    if (g.sliders.length === 1) {
      out.sliders.push({
        index: out.sliders.length,
        knob: g.sliders[0]!,
        box: { x: x0, y: sliderTop, width: sx1 - x0, height: SLIDER_H },
        vertical: false,
        plate: g.plate,
      });
    } else if (g.sliders.length === 2) {
      const total = sx1 - x0 - GAP;
      const stretch = Math.min(
        total - MIN_DAMPING,
        Math.max(minStripFor(input.kind), Math.round(total * 0.6)),
      );
      out.sliders.push(
        {
          index: out.sliders.length,
          knob: g.sliders[0]!,
          box: { x: x0, y: sliderTop, width: stretch, height: SLIDER_H },
          vertical: false,
          plate: g.plate,
        },
        {
          index: out.sliders.length + 1,
          knob: g.sliders[1]!,
          box: { x: x0 + stretch + GAP, y: sliderTop, width: total - stretch, height: SLIDER_H },
          vertical: false,
          plate: g.plate,
        },
      );
    }
  });
  return out;
};

const group = (g: Omit<Group, "mapEnd" | "clearRight" | "sliders"> & Partial<Group>): Group => ({
  mapEnd: null,
  clearRight: 0,
  sliders: [],
  ...g,
});

// ---- Frames ---------------------------------------------------------------------------------

/** Below this the panel's plate gives way to its keys rather than shrink further. */
const PANEL_PLATE_MIN = 880;

const panelSolo = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input.venue;
  const reach = reachYs(input.venue, input.reach);
  const modes = soloKeyModes(input.keys, input.modeCount);
  const bottom = H - 50;
  const groups = [
    group({ x0: 24, x1: W - 24, align: "center", resetEnd: "right", plate: 0, modes, bank: null }),
  ];
  shareSliders(groups, knobsOf(input), input.kind);
  const rowsH = GLIDE_H + ROW_GAP + (groups[0]!.sliders.length ? SLIDER_H + GAP : 0);
  const childRoom = bottom - Math.max(reach.child, H * 0.4);
  const plateRoom = bottom - (MARGIN + PANEL_PLATE_MIN + MARGIN + rowsH);
  let rows = rowLayout(
    input,
    groups,
    { bottom, maxHeight: Math.min(800, childRoom, plateRoom) },
    null,
  );
  // Many keys: let them have the child band rather than shrink below the smallest key.
  if (rows.keys.some((k) => k.box.width < minKeyFor(input.kind))) {
    rows = rowLayout(input, groups, { bottom, maxHeight: Math.min(800, childRoom) }, null);
  }
  const room = { x: MARGIN, y: MARGIN, width: W - 2 * MARGIN, height: rows.top - 2 * MARGIN };
  return {
    mode: "solo",
    venue: input.venue,
    plates: [plateIn(room)],
    ...pick(rows),
    reach,
  };
};

const pick = (rows: Rows): Pick<Layout, "keys" | "glides" | "sliders" | "maps" | "resets"> => ({
  keys: rows.keys,
  glides: rows.glides,
  sliders: rows.sliders,
  maps: rows.maps,
  resets: rows.resets,
});

const pairSolo = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input.venue;
  const span = Math.max(2, input.span);
  const panel = W / span;
  const reach = reachYs(input.venue, input.reach);
  const [low, high] = split(soloKeyModes(input.keys, input.modeCount), 2);
  const bottom = H - 50;
  const groups: Group[] = [
    group({
      x0: MARGIN,
      x1: panel - SEAM_CLEAR,
      align: "left",
      resetEnd: "left",
      plate: 0,
      modes: low!,
      bank: null,
    }),
    group({
      x0: W - panel + SEAM_CLEAR,
      x1: W - MARGIN,
      align: "right",
      resetEnd: "right",
      plate: 0,
      modes: high!,
      bank: null,
    }),
  ];
  shareSliders(groups, knobsOf(input), input.kind);
  const rows = rowLayout(
    input,
    groups,
    { bottom, maxHeight: Math.min(620, bottom - Math.max(reach.child, H * 0.45)) },
    null,
  );
  linkGlides(rows.glides);
  const room = { x: MARGIN, y: MARGIN, width: W - 2 * MARGIN, height: rows.top - 2 * MARGIN };
  return { mode: "solo", venue: input.venue, plates: [plateIn(room)], ...pick(rows), reach };
};

/** Room the wall keeps beside its plates for a side's keys and controls (more with two plates). */
const WALL_SIDE_MIN = 1300;
const WALL_SIDE_TWO = 1500;
const WALL_PLATE_GAP = 120;
/** The runtime's Home control on a wall (top right of the reach band), and its margin. */
const WALL_HOME = 160 + 28 + GAP;

const wallSolo = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input.venue;
  const reach = reachYs(input.venue, input.reach);
  const two = input.plates >= 2;
  const n = two ? 2 : 1;
  const tall = H - 100;
  const side = two ? WALL_SIDE_TWO : WALL_SIDE_MIN;
  const size = Math.max(400, Math.min(tall, (W - 2 * side - (n - 1) * WALL_PLATE_GAP) / n));
  const centres = two
    ? [W / 2 - size / 2 - WALL_PLATE_GAP / 2, W / 2 + size / 2 + WALL_PLATE_GAP / 2]
    : [W / 2];
  const left = centres[0]! - size / 2;
  const right = centres[centres.length - 1]! + size / 2;
  const modes = soloKeyModes(input.keys, input.modeCount);
  const [low, high] = two ? [modes, modes] : split(modes, 2);
  const showMap = input.controls.puck;
  const groups: Group[] = [
    group({
      x0: MARGIN * 2,
      x1: left - MARGIN * 2,
      align: "right",
      resetEnd: "left",
      plate: 0,
      modes: low!,
      bank: null,
      mapEnd: showMap ? "right" : null,
    }),
    group({
      x0: right + MARGIN * 2,
      x1: W - MARGIN * 2,
      align: "left",
      resetEnd: "right",
      plate: two ? 1 : 0,
      modes: high!,
      bank: null,
      mapEnd: showMap ? "left" : null,
      clearRight: WALL_HOME - MARGIN * 2,
    }),
  ];
  shareSliders(groups, knobsOf(input), input.kind);
  // Keys between about knee and waist height; the glide and sliders in the adult band above the
  // child band.
  const keyTop = reach.child + 20;
  const bottom = Math.max(keyTop + 200, H - 150);
  const rows = rowLayout(input, groups, { bottom, maxHeight: bottom - keyTop }, (keysTop) =>
    Math.min(keysTop - GAP, reach.child - 10),
  );
  if (!two) linkGlides(rows.glides);
  const top = (H - tall) / 2;
  const plates: PlateBox[] = centres.map((cx) => {
    const room = { x: cx - size / 2, y: top, width: size, height: tall };
    const p = plateIn(room);
    return { ...p, cx, cy: H / 2, size };
  });
  if (!two) {
    // One plate can stretch out over the side controls once it is short enough to clear them.
    const clear = rows.top - 60;
    plates[0] = {
      ...plates[0]!,
      cy: top + size / 2,
      wide: true,
      hang: { x: MARGIN * 2, y: top, width: W - MARGIN * 4, height: clear - top },
    };
  }
  return { mode: "solo", venue: input.venue, plates, ...pick(rows), reach };
};

/** A kiosk's reset is a little smaller, to fit the column beside the plate. */
const KIOSK_RESET = 130;
/** Width each kiosk side keeps for its keys, glide and reset. */
const KIOSK_SIDE = 420;

const kioskSolo = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input.venue;
  const reach = reachYs(input.venue, input.reach);
  const [low, high] = split(soloKeyModes(input.keys, input.modeCount), 2);
  // Each side: a column of keys on the outside, and on the inside (by the plate) a glide strip
  // running up the plate's edge with the reset under it. The sliders run under the plate.
  const inner = KIOSK_RESET;
  const sideW = KIOSK_SIDE;
  const colW = sideW - inner - GAP;
  const top = 40;
  // Keys keep clear of the top corners, where the runtime's Home control goes.
  const keyTop = 180;
  const bottom = H - 30;
  const max = maxKeyFor("kiosk", "solo");
  // Keys stack up the side, so rows cost nothing here.
  const s = Math.min(
    fitKeys(low!.length, colW, bottom - keyTop, max, 0).size,
    fitKeys(Math.max(1, high!.length), colW, bottom - keyTop, max, 0).size,
  );
  const keys: KeySpec[] = [];
  const glides: GlideSpec[] = [];
  const resets: ResetSpec[] = [];
  const side = (modes: number[], x0: number, outer: "left" | "right", gi: number) => {
    const cols = Math.max(1, Math.floor((colW + GAP) / (s + GAP)));
    const perCol = Math.max(1, Math.floor((bottom - keyTop + GAP) / (s + GAP)));
    const used = Math.min(cols, Math.ceil(modes.length / perCol));
    const blockW = used * s + (used - 1) * GAP;
    const keyX = outer === "left" ? x0 : x0 + sideW - blockW;
    const innerX = outer === "left" ? x0 + sideW - inner : x0;
    modes.forEach((mode, i) => {
      const row = Math.floor(i / used);
      const col = i % used;
      keys.push({
        index: keys.length,
        mode,
        box: {
          x: keyX + col * (s + GAP),
          y: bottom - (row + 1) * s - row * GAP,
          width: s,
          height: s,
        },
        plate: 0,
        bank: null,
      });
    });
    resets.push({
      box: { x: innerX, y: bottom - inner, width: inner, height: inner },
      plate: 0,
    });
    if (input.controls.glide) {
      glides.push({
        index: gi,
        box: { x: innerX, y: top, width: inner, height: bottom - inner - GAP - top },
        vertical: true,
        plate: 0,
        notes: [...modes],
        below: null,
        above: null,
      });
    }
  };
  side(low!, 30, "left", 0);
  if (high!.length) side(high!, W - 30 - sideW, "right", 1);
  linkGlides(glides);
  // Between the two sides: the plate, with the sliders in a row under it.
  const x0 = 30 + sideW + 60;
  const x1 = W - 30 - sideW - 60;
  const knobs = knobsOf(input);
  const sliders: SliderSpec[] = [];
  const rowTop = bottom - SLIDER_H;
  if (knobs.length === 2) {
    const total = x1 - x0 - GAP;
    const first = Math.max(minStripFor("kiosk"), Math.round(total * 0.6));
    sliders.push(
      { index: 0, knob: knobs[0]!, box: box(x0, rowTop, first), vertical: false, plate: 0 },
      {
        index: 1,
        knob: knobs[1]!,
        box: box(x0 + first + GAP, rowTop, total - first),
        vertical: false,
        plate: 0,
      },
    );
  } else if (knobs.length === 1) {
    sliders.push({
      index: 0,
      knob: knobs[0]!,
      box: box(x0, rowTop, x1 - x0),
      vertical: false,
      plate: 0,
    });
  }
  const plateBottom = sliders.length ? rowTop - MARGIN : bottom;
  const room = { x: x0, y: top, width: x1 - x0, height: plateBottom - top };
  return {
    mode: "solo",
    venue: input.venue,
    plates: [plateIn(room)],
    keys,
    glides,
    sliders,
    maps: [],
    resets,
    reach,
  };
};

const box = (x: number, y: number, width: number, height = SLIDER_H): Box => ({
  x,
  y,
  width,
  height,
});

const screenLayout = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input.venue;
  const room = { x: 80, y: 80, width: W - 160, height: H - 160 };
  return {
    mode: "screen",
    venue: input.venue,
    plates: [plateIn(room)],
    keys: [],
    glides: [],
    sliders: [],
    maps: [],
    resets: [],
    reach: { adult: H, child: H },
  };
};

/** The orientation the screen above a bank stretches its plate in. */
export const screenWide = (venue: { width: number; height: number }): boolean =>
  plateIn({ x: 80, y: 80, width: venue.width - 160, height: venue.height - 160 }).wide;

/** Total keys along a bank of `count` frames each `span` panels wide. */
export const bankKeyCount = (count: number, span: number): number =>
  Math.max(1, count) * Math.max(1, span) * BANK_KEYS_PER_PANEL;

/**
 * A bank touch frame: two keys and a glide per panel, the sliders above them, and a map of the
 * screen's plate (its current figure, and the drive point to move) above those.
 */
const keyboard = (input: LayoutInput): Layout => {
  const { width: W, height: H } = input.venue;
  const span = input.kind === "pair" ? Math.max(2, input.span) : 1;
  const panel = W / span;
  const reach = reachYs(input.venue, input.reach);
  const total = bankKeyCount(input.count, span);
  const own = bankKeysOf(Math.min(input.pos, Math.max(0, input.count - 1)), span);
  const groups: Group[] = [];
  for (let p = 0; p < span; p++) {
    const keys = own.slice(p * BANK_KEYS_PER_PANEL, (p + 1) * BANK_KEYS_PER_PANEL);
    const leftSeam = p > 0;
    const rightSeam = p < span - 1;
    groups.push(
      group({
        x0: p * panel + (leftSeam ? SEAM_CLEAR : MARGIN),
        x1: (p + 1) * panel - (rightSeam ? SEAM_CLEAR : MARGIN),
        align: "center",
        resetEnd: span > 1 && p === 0 ? "left" : "right",
        plate: 0,
        modes: keys.map((k) => bankKeyMode(k, total, input.modeCount)),
        bank: keys,
      }),
    );
  }
  shareSliders(groups, knobsOf(input), input.kind);
  const bottom = H - 60;
  const rows = rowLayout(
    input,
    groups,
    { bottom, maxHeight: Math.min(480, bottom - Math.max(reach.child, H * 0.5)) },
    null,
  );
  // Each strip reaches towards the notes on the neighbouring panels, here or along the bank.
  rows.glides.forEach((g, i) => {
    const first = own[i * BANK_KEYS_PER_PANEL]!;
    const last = own[(i + 1) * BANK_KEYS_PER_PANEL - 1]!;
    g.below = first > 0 ? bankKeyMode(first - 1, total, input.modeCount) : null;
    g.above = last < total - 1 ? bankKeyMode(last + 1, total, input.modeCount) : null;
  });
  // A map of the screen's plate over each panel's controls, below a pointer up to the screen.
  const mapTop = 90;
  const mapBottom = rows.top - MARGIN;
  for (const g of groups) {
    const width = g.x1 - g.x0;
    const height = Math.max(0, mapBottom - mapTop);
    const side = Math.min(width, height);
    rows.maps.push({
      index: rows.maps.length,
      box: {
        x: g.x0 + (width - side) / 2,
        y: mapTop + (height - side) / 2,
        width: side,
        height: side,
      },
      plate: 0,
      touch: input.controls.puck,
    });
  }
  return { mode: "keyboard", venue: input.venue, plates: [], ...pick(rows), reach };
};

export const computeLayout = (input: LayoutInput): Layout => {
  if (input.mode === "screen") return screenLayout(input);
  if (input.mode === "keyboard") return keyboard(input);
  switch (input.kind) {
    case "wall":
      return wallSolo(input);
    case "pair":
      return pairSolo(input);
    case "kiosk":
      return kioskSolo(input);
    case "screen":
      return screenLayout(input);
    default:
      return panelSolo(input);
  }
};

/** Position 0 to 1 along a strip (left to right, or bottom to top) for a frame point. */
export const stripT = (g: { box: Box; vertical: boolean }, x: number, y: number): number => {
  const b = g.box;
  const pad = Math.min(b.width, b.height) / 2;
  const t = g.vertical
    ? (b.y + b.height - pad - y) / Math.max(1, b.height - 2 * pad)
    : (x - b.x - pad) / Math.max(1, b.width - 2 * pad);
  return Math.min(1, Math.max(0, t));
};

/** The frame point at position `t` along a strip's centre line. */
export const stripPoint = (
  g: { box: Box; vertical: boolean },
  t: number,
): { x: number; y: number } => {
  const b = g.box;
  const pad = Math.min(b.width, b.height) / 2;
  return g.vertical
    ? { x: b.x + b.width / 2, y: b.y + b.height - pad - t * (b.height - 2 * pad) }
    : { x: b.x + pad + t * (b.width - 2 * pad), y: b.y + b.height / 2 };
};

/** Glide strips use the same geometry as sliders. */
export const glideT = stripT;
export const glidePoint = stripPoint;

/** Every touchable box, for overlap and seam checks. */
export const controlBoxes = (l: Layout): Box[] => [
  ...l.keys.map((k) => k.box),
  ...l.glides.map((g) => g.box),
  ...l.sliders.map((s) => s.box),
  ...l.maps.map((m) => m.box),
  ...l.resets.map((r) => r.box),
];
