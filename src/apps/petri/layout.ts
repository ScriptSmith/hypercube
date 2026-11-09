import type { FrameKind, Reach } from "../../core/types";
import { type Box, boxOf, type Circle, dishFor } from "./dish";
import { type Family, presetCount, presetLabel, type StampDef, stampsIn } from "./stamps";

/**
 * Where everything goes, in frame venue px (origin top left). Trays, pipettes and placement are in
 * the child band; dials (or Life's larger stamps) in the adult band. On a merged pair nothing
 * touchable comes within SEAM_CLEAR of the seam.
 */
export const SWATCH = 220;
export const MIN_SWATCH = 200;
const GAP = 26;
const MARGIN = 40;
export const SEAM_CLEAR = 220;
export const RESET_SIZE = 140;
/** Half the width a wall dial may take, either side of its centre. */
const WALL_DIAL_HALF = 400;

/** A wall or solo frame where taps place; a touch frame in a bank; the screen above a bank. */
export type Mode = "solo" | "dropper" | "screen";

/** A tile or chip with its icon above and its label below, all inside `box`. */
export interface Labelled {
  box: Box;
  icon: Box;
  label: Box;
  /** Label font size, venue px. */
  font: number;
}

export interface SwatchBox extends Labelled {
  stamp: StampDef;
}

export interface DialSpec {
  cx: number;
  cy: number;
  /** Knob radius. */
  r: number;
  /** Total sweep of the detents, radians, centred on straight up. */
  spread: number;
  /** Which condition region it sets. */
  region: number;
  /** One chip per detent, each on its detent's ray from the knob. */
  chips: Labelled[];
}

export interface Pad {
  side: number;
  /** The x range this pad looks after. */
  x0: number;
  x1: number;
  swatches: SwatchBox[];
  pipette: Box | null;
  /** Where a flick may start. */
  flick: Box | null;
  reset: Box;
  /** The condition region (or bank slice pad) this side sets. */
  region: number;
  /** Where the preview shows this pad's stamp. */
  spot: { x: number; y: number };
}

export interface Layout {
  venue: { width: number; height: number };
  world: Box;
  dish: Circle | null;
  /** Bottom of the culture's window on a bank touch frame. */
  benchTop: number | null;
  pads: Pad[];
  dials: DialSpec[];
  regions: number;
  /** Region borders (venue x) for faint marks. */
  marks: number[];
  /** Where the culture reseeds itself. */
  rain: Box;
  /** The reachable band, where attract and bots demonstrate taps. */
  reach: { top: number; child: number };
}

const contains = (b: Box, x: number, y: number) =>
  x >= b.x && y >= b.y && x <= b.x + b.width && y <= b.y + b.height;

export const inBox = contains;

/** Lay `n` squares out in `area`, as many to a row as fit, anchored to its bottom. */
export const grid = (
  n: number,
  area: Box,
  align: "left" | "right" | "center",
  size = SWATCH,
): Box[] => {
  if (n <= 0) return [];
  let s = size;
  let cols = Math.max(1, Math.min(n, Math.floor((area.width + GAP) / (s + GAP))));
  let rows = Math.ceil(n / cols);
  while (rows * (s + GAP) - GAP > area.height && s > MIN_SWATCH) {
    s = Math.max(MIN_SWATCH, s - 10);
    cols = Math.max(1, Math.min(n, Math.floor((area.width + GAP) / (s + GAP))));
    rows = Math.ceil(n / cols);
  }
  const out: Box[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const col = i % cols;
    const rowW = inRow * (s + GAP) - GAP;
    const x0 =
      align === "left"
        ? area.x
        : align === "right"
          ? area.x + area.width - rowW
          : area.x + (area.width - rowW) / 2;
    const y = area.y + area.height - (rows - row) * (s + GAP) + GAP;
    out.push({ x: x0 + col * (s + GAP), y, width: s, height: s });
  }
  return out;
};

/**
 * Rough advance widths of a heavy sans serif in em, so label boxes can be sized without laying out
 * any text. They err wide; the view still shrinks a label that measures wider than its box.
 */
const NARROW = new Set("iljI.,'!| ");
const WIDE = new Set("mwMW");
export const textEm = (text: string): number => {
  let em = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) em += 0.32;
    else if (WIDE.has(ch)) em += 0.98;
    else if (ch === "t" || ch === "f" || ch === "r") em += 0.47;
    else if (ch === "s" || ch === "c") em += 0.56;
    else if (ch === "a" || ch === "e" || ch === "S") em += 0.62;
    else if (ch >= "A" && ch <= "Z") em += 0.72;
    else em += 0.65;
  }
  return em;
};

/** Labels are at least this size on panels, and as large as the tile allows. */
export const MIN_LABEL = 38;

/** Room across a tile for its label: the tile's rounded corners clip the rest. */
const LABEL_SPAN = 0.88;

/** One font for a row of tiles of size `s`, so the longest label fits and the row looks even. */
const rowFont = (labels: readonly string[], s: number): number => {
  const em = Math.max(1, ...labels.map(textEm));
  return Math.floor(Math.min(s * 0.2, (s * LABEL_SPAN) / em));
};

/** Icon above, label below, inside a square tile. */
const tileParts = (box: Box, font: number): Omit<Labelled, "box" | "font"> => {
  const s = box.width;
  const h = font * 1.2;
  const label = {
    x: box.x + (s * (1 - LABEL_SPAN)) / 2,
    y: box.y + s * 0.95 - h,
    width: s * LABEL_SPAN,
    height: h,
  };
  const top = box.y + s * 0.1;
  const size = Math.max(1, label.y - s * 0.03 - top);
  return { icon: { x: box.x + (s - size) / 2, y: top, width: size, height: size }, label };
};

const tiles = (stamps: readonly StampDef[], boxes: readonly Box[]): SwatchBox[] => {
  const font = rowFont(
    stamps.map((st) => st.label),
    Math.min(...boxes.map((b) => b.width)),
  );
  return stamps.map((stamp, i) => {
    const box = boxes[i]!;
    return { stamp, box, font, ...tileParts(box, font) };
  });
};

const overlaps = (a: Box, b: Box, gap = 0) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

/** Distance from a point to the nearest point of a box (0 inside it). */
const distToBox = (x: number, y: number, b: Box) =>
  Math.hypot(Math.max(b.x - x, 0, x - b.x - b.width), Math.max(b.y - y, 0, y - b.y - b.height));

/** A detent chip of label size `font`, wide enough for the family's longest label. */
const chipSize = (font: number, em: number) => {
  const icon = font * 1.8;
  return {
    width: Math.max(icon + font * 0.9, em * font + font * 0.7),
    height: font * (0.3 + 1.8 + 0.12 + 1.2 + 0.28),
    icon,
  };
};

const chipAt = (
  x: number,
  y: number,
  size: ReturnType<typeof chipSize>,
  font: number,
): Labelled => {
  const box = {
    x: x - size.width / 2,
    y: y - size.height / 2,
    width: size.width,
    height: size.height,
  };
  const lh = font * 1.2;
  return {
    box,
    font,
    icon: {
      x: x - size.icon / 2,
      y: box.y + font * 0.3,
      width: size.icon,
      height: size.icon,
    },
    label: {
      x: box.x + font * 0.25,
      y: box.y + box.height - font * 0.28 - lh,
      width: box.width - font * 0.5,
      height: lh,
    },
  };
};

/**
 * Chips for `n` detents around a knob at the origin: each sits on its detent's ray, as close in as
 * it can without touching the knob or a chip nearer the middle. Mirrored detents move out together
 * so the dial stays symmetric.
 */
const placeChips = (n: number, spread: number, r: number, font: number, em: number): Labelled[] => {
  const size = chipSize(font, em);
  const gap = Math.max(16, font * 0.5);
  const angles = detentAngles(n, spread);
  const out: (Labelled | null)[] = angles.map(() => null);
  const placed: Box[] = [];
  const order = angles
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a <= 1e-9)
    .sort((p, q) => Math.abs(p.a) - Math.abs(q.a));
  for (const { a, i } of order) {
    const j = n - 1 - i;
    let d = r;
    for (; d < r + 20 * size.height; d += 2) {
      const left = chipAt(Math.sin(a) * d, -Math.cos(a) * d, size, font);
      const right = chipAt(-Math.sin(a) * d, -Math.cos(a) * d, size, font);
      const mine = j === i ? [left.box] : [left.box, right.box];
      const clear =
        mine.every((b) => distToBox(0, 0, b) >= r + gap) &&
        (mine.length === 1 || !overlaps(mine[0]!, mine[1]!, gap)) &&
        mine.every((b) => placed.every((p) => !overlaps(b, p, gap)));
      if (clear) {
        out[i] = left;
        if (j !== i) out[j] = right;
        placed.push(...mine);
        break;
      }
    }
  }
  return out.map((c) => c ?? chipAt(0, -r * 3, size, font));
};

/** The box around a whole dial: knob and chips. */
const dialBounds = (d: DialSpec): Box => {
  let x0 = d.cx - d.r;
  let y0 = d.cy - d.r;
  let x1 = d.cx + d.r;
  let y1 = d.cy + d.r;
  for (const c of d.chips) {
    x0 = Math.min(x0, c.box.x);
    y0 = Math.min(y0, c.box.y);
    x1 = Math.max(x1, c.box.x + c.box.width);
    y1 = Math.max(y1, c.box.y + c.box.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};
export { dialBounds };

const bands = (height: number, reach: Reach) => {
  const child = height * (1 - Math.min(1, Math.max(0.05, reach.child)));
  const adultTop = Math.max(height * (1 - Math.min(1, reach.adult)), height * 0.15);
  return { child, adultTop, adultBottom: Math.max(adultTop + 1, child - 16) };
};

/** Detent sweeps to try, narrowest first: a wider one lowers the middle chips on a short band. */
const SPREADS = [130, 160, 180].map((d) => (d * Math.PI) / 180);
const MAX_KNOB = 170;
const MIN_KNOB = 80;
const MAX_DIAL_FONT = 42;
const MIN_DIAL_FONT = 24;

/**
 * A dial with labelled detents that fits inside `area` (its reach band, clear of edges and seams),
 * centred across at `cx`. The largest label that fits wins, then the largest knob, then the
 * narrowest sweep; the whole dial sits in the middle of the band.
 */
const dialIn = (family: Family, cx: number, area: Box, region: number): DialSpec => {
  const n = presetCount(family);
  const em = Math.max(1, ...Array.from({ length: n }, (_, i) => textEm(presetLabel(family, i))));
  const half = Math.min(cx - area.x, area.x + area.width - cx);
  const build = (font: number, r: number, spread: number): DialSpec => ({
    cx: 0,
    cy: 0,
    r,
    spread,
    region,
    chips: placeChips(n, spread, r, font, em),
  });
  const fit = (): DialSpec => {
    for (let font = MAX_DIAL_FONT; font >= MIN_DIAL_FONT; font--) {
      for (const ratio of [3.8, 3.2, 2.6]) {
        const r = Math.min(MAX_KNOB, Math.max(MIN_KNOB, font * ratio));
        for (const spread of SPREADS) {
          const spec = build(font, r, spread);
          const b = dialBounds(spec);
          if (b.height <= area.height && Math.max(-b.x, b.x + b.width) <= half) return spec;
        }
      }
    }
    return build(MIN_DIAL_FONT, MIN_KNOB, SPREADS.at(-1)!);
  };
  const spec = fit();
  const b = dialBounds(spec);
  const dy = area.y + (area.height - b.height) / 2 - b.y;
  const move = (box: Box): Box => ({ ...box, x: box.x + cx, y: box.y + dy });
  return {
    ...spec,
    cx,
    cy: dy,
    chips: spec.chips.map((c) => ({
      ...c,
      box: move(c.box),
      icon: move(c.icon),
      label: move(c.label),
    })),
  };
};

/**
 * One pad: a tray of small stamps at the bottom of the child band (and, for Life, a tray of larger
 * stamps in the adult band), a pipette above the tray on a bank, and a reset control.
 */
const pad = (
  family: Family,
  mode: Mode,
  side: number,
  x0: number,
  x1: number,
  height: number,
  b: ReturnType<typeof bands>,
  align: "left" | "right" | "center",
  region: number,
  world: Box,
): Pad => {
  const small = stampsIn(family, "child");
  const big = stampsIn(family, "adult");
  const width = x1 - x0;
  const trayArea: Box = { x: x0, y: b.child + 60, width, height: height - MARGIN - b.child - 60 };
  // On a bank the tray stays in one row so the pipette has room above it.
  const rows = mode === "dropper" ? 1 : 2;
  const trayH = Math.min(trayArea.height, rows * (SWATCH + GAP));
  const boxes = grid(
    small.length,
    { ...trayArea, y: height - MARGIN - trayH, height: trayH },
    align,
  );
  const swatches: SwatchBox[] = tiles(small, boxes);
  if (big.length > 0) {
    const area: Box = { x: x0, y: b.adultTop, width, height: b.adultBottom - b.adultTop };
    swatches.push(...tiles(big, grid(big.length, area, align, Math.min(240, SWATCH + 20))));
  }
  const trayTop = Math.min(...boxes.map((x) => x.y));
  const trayLeft = Math.min(...boxes.map((x) => x.x));
  const trayRight = Math.max(...boxes.map((x) => x.x + x.width));
  let pipette: Box | null = null;
  let flick: Box | null = null;
  if (mode === "dropper") {
    // Room above the bulb for the hint, which must stay below the culture's window.
    const top = b.child + 150;
    const bottom = trayTop - 50;
    const w = 150;
    const cx = (x0 + x1) / 2;
    pipette = { x: cx - w / 2, y: top, width: w, height: Math.max(160, bottom - top) };
    flick = { x: x0, y: b.child, width, height: Math.max(1, trayTop - 16 - b.child) };
  }
  // Reset sits beside the tray on the side towards the frame's middle if there is room in the
  // pad's range, else above the tray at the outer edge.
  const resetY = trayTop - RESET_SIZE - 30;
  const above: Box = {
    x: align === "right" ? x1 - RESET_SIZE : x0,
    y: Math.max(b.child + 10, resetY),
    width: RESET_SIZE,
    height: RESET_SIZE,
  };
  const besideX = align === "left" ? trayRight + 40 : trayLeft - 40 - RESET_SIZE;
  const fits = besideX >= x0 && besideX + RESET_SIZE <= x1;
  const reset: Box =
    mode === "dropper" || align === "center" || !fits
      ? above
      : { x: besideX, y: height - MARGIN - RESET_SIZE, width: RESET_SIZE, height: RESET_SIZE };
  const spot = {
    x: (Math.max(x0, world.x) + Math.min(x1, world.x + world.width)) / 2,
    y: world.y + world.height * (family === "life" ? 0.3 : 0.17),
  };
  return { side, x0, x1, swatches, pipette, flick, reset, region, spot };
};

export const computeLayout = (
  kind: FrameKind,
  mode: Mode,
  venue: { width: number; height: number },
  reach: Reach,
  family: Family,
  regions: number,
): Layout => {
  const W = venue.width;
  const H = venue.height;
  const b = bands(H, reach);
  const dials = family !== "life";

  if (mode === "screen") {
    const dish = dishFor(W, H);
    return {
      venue,
      world: boxOf(dish),
      dish,
      benchTop: null,
      pads: [],
      dials: [],
      regions: 1,
      marks: [],
      rain: boxOf(dish),
      reach: { top: 0, child: H },
    };
  }

  const world: Box =
    mode === "dropper"
      ? { x: 0, y: 0, width: W, height: b.child }
      : { x: 0, y: 0, width: W, height: H };
  const benchTop = mode === "dropper" ? b.child : null;

  if (kind === "wall") {
    const n = Math.min(3, Math.max(1, regions));
    const sideW = Math.min(W * 0.3, 1100);
    const pads = [
      pad(family, mode, 0, MARGIN, MARGIN + sideW, H, b, "left", 0, world),
      pad(
        family,
        mode,
        1,
        W - MARGIN - sideW,
        W - MARGIN,
        H,
        b,
        "right",
        n === 1 ? 0 : n - 1,
        world,
      ),
    ];
    const ds: DialSpec[] = [];
    if (dials) {
      const band = (x: number, half: number): Box => ({
        x: x - half,
        y: b.adultTop,
        width: 2 * half,
        height: b.adultBottom - b.adultTop,
      });
      const side = MARGIN + WALL_DIAL_HALF;
      ds.push(dialIn(family, side, band(side, WALL_DIAL_HALF), 0));
      if (n === 3) ds.push(dialIn(family, W / 2, band(W / 2, WALL_DIAL_HALF + 80), 1));
      ds.push(dialIn(family, W - side, band(W - side, WALL_DIAL_HALF), n === 1 ? 0 : n - 1));
    }
    return {
      venue,
      world,
      dish: null,
      benchTop,
      pads,
      dials: ds,
      regions: dials ? n : 1,
      marks: dials ? Array.from({ length: n - 1 }, (_, i) => ((i + 1) * W) / n) : [],
      rain: { x: 200, y: 160, width: W - 400, height: Math.max(200, b.adultTop - 360) },
      reach: { top: b.adultTop, child: b.child },
    };
  }

  if (kind === "pair" || kind === "kiosk") {
    const seam = W / 2;
    const pads = [
      pad(family, mode, 0, MARGIN, seam - SEAM_CLEAR, H, b, "left", 0, world),
      pad(family, mode, 1, seam + SEAM_CLEAR, W - MARGIN, H, b, "right", 1, world),
    ];
    // Each half's preview sits in the middle of its own half.
    pads[0]!.spot.x = seam / 2;
    pads[1]!.spot.x = seam + seam / 2;
    const half = (x0: number, x1: number): Box => ({
      x: x0,
      y: b.adultTop,
      width: x1 - x0,
      height: b.adultBottom - b.adultTop,
    });
    const left = half(MARGIN, seam - SEAM_CLEAR);
    const right = half(seam + SEAM_CLEAR, W - MARGIN);
    const ds = dials
      ? [
          dialIn(family, left.x + left.width / 2, left, 0),
          dialIn(family, right.x + right.width / 2, right, 1),
        ]
      : [];
    return {
      venue,
      world,
      dish: null,
      benchTop,
      pads,
      dials: ds,
      regions: dials ? 2 : 1,
      marks: dials ? [seam] : [],
      rain: { x: 120, y: 80, width: W - 240, height: Math.max(160, world.height * 0.3) },
      reach: { top: b.adultTop, child: b.child },
    };
  }

  const pads = [pad(family, mode, 0, MARGIN, W - MARGIN, H, b, "center", 0, world)];
  return {
    venue,
    world,
    dish: null,
    benchTop,
    pads,
    dials: dials
      ? [
          dialIn(
            family,
            W / 2,
            {
              x: MARGIN,
              y: b.adultTop,
              width: W - 2 * MARGIN,
              height: b.adultBottom - b.adultTop,
            },
            0,
          ),
        ]
      : [],
    regions: 1,
    marks: [],
    rain: { x: 100, y: 80, width: W - 200, height: Math.max(160, world.height * 0.3) },
    reach: { top: b.adultTop, child: b.child },
  };
};

/**
 * The condition marks in the strip under the screen's dish: an icon over a label at each slice
 * centre `xs` (venue x), sized so neighbours never touch.
 */
export const sliceMarks = (
  venue: { width: number; height: number },
  xs: readonly number[],
  labels: readonly string[],
): Labelled[] => {
  if (xs.length === 0) return [];
  const sorted = [...xs].sort((a, b) => a - b);
  let spacing = Math.min(venue.width, 2 * sorted[0]!, 2 * (venue.width - sorted.at(-1)!));
  for (let i = 1; i < sorted.length; i++) spacing = Math.min(spacing, sorted[i]! - sorted[i - 1]!);
  const em = Math.max(1, ...labels.map(textEm));
  const font = Math.floor(Math.min(56, (spacing * 0.86) / em));
  const icon = Math.min(110, spacing * 0.6);
  const lh = font * 1.2;
  const bottom = venue.height - venue.height * 0.008;
  const top = bottom - lh - 8 - icon;
  return xs.map((x) => {
    const width = Math.max(icon, em * font);
    return {
      box: { x: x - width / 2, y: top, width, height: bottom - top },
      icon: { x: x - icon / 2, y: top, width: icon, height: icon },
      label: { x: x - width / 2, y: bottom - lh, width, height: lh },
      font,
    };
  });
};

/** Which pad a position belongs to: the one whose range is nearest across. */
export const padAt = (layout: Layout, x: number): Pad | null => {
  let best: Pad | null = null;
  let bestD = Infinity;
  for (const p of layout.pads) {
    const d = x < p.x0 ? p.x0 - x : x > p.x1 ? x - p.x1 : 0;
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
};

/** Every touchable box in a layout, for overlap checks. */
export const controlBoxes = (layout: Layout): Box[] => [
  ...layout.pads.flatMap((p) => [
    ...p.swatches.map((s) => s.box),
    p.reset,
    ...(p.pipette ? [p.pipette] : []),
  ]),
  ...layout.dials.flatMap((d) => [
    { x: d.cx - d.r, y: d.cy - d.r, width: 2 * d.r, height: 2 * d.r },
    ...d.chips.map((c) => c.box),
  ]),
];

/** Every label box in a layout, for overlap checks. */
export const labelBoxes = (layout: Layout): Box[] => [
  ...layout.pads.flatMap((p) => p.swatches.map((s) => s.label)),
  ...layout.dials.flatMap((d) => d.chips.map((c) => c.label)),
];

/** Which detent chip, if any, is under a point. */
export const detentAt = (
  layout: Layout,
  x: number,
  y: number,
): { dial: number; value: number } | null => {
  for (let i = 0; i < layout.dials.length; i++) {
    const chips = layout.dials[i]!.chips;
    for (let v = 0; v < chips.length; v++) {
      const b = chips[v]!.box;
      if (x >= b.x - 10 && y >= b.y - 10 && x <= b.x + b.width + 10 && y <= b.y + b.height + 10)
        return { dial: i, value: v };
    }
  }
  return null;
};

/** Angle of (dx, dy) from straight up, clockwise positive (y points down). */
export const angleFromUp = (dx: number, dy: number): number => Math.atan2(dx, -dy);

/** Detent angles, evenly spread over `spread` and centred on straight up. */
export const detentAngles = (n: number, spread: number): number[] =>
  n <= 1 ? [0] : Array.from({ length: n }, (_, i) => -spread / 2 + (spread * i) / (n - 1));

export const nearestDetent = (angle: number, n: number, spread: number): number => {
  const angles = detentAngles(n, spread);
  let best = 0;
  let bestD = Infinity;
  angles.forEach((a, i) => {
    const d = Math.abs(a - angle);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
};
