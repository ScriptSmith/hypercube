import type { Rect } from "../../core/types";
import type { MenuFrame, TitleSpot } from "./layout";

/** The shape of one option control, which is all the layout needs to know. */
export type ControlShape =
  | { kind: "segments"; count: number }
  | { kind: "stepper" }
  | { kind: "toggle" };

export interface ChooseSpec {
  /** Variant tiles to show; 0 when the variant is fixed or there is no choice. */
  variants: number;
  controls: readonly ControlShape[];
  /** Centre x of the tile that opened the step. A wall puts the step in front of it. */
  anchorX?: number;
}

export interface ControlSpot {
  label: Rect;
  control: Rect;
  /** Segments left to right; a stepper's minus, value and plus; a toggle's switch. */
  parts: Rect[];
}

export interface ChooseLayout {
  header: TitleSpot;
  variants: Rect[];
  controls: ControlSpot[];
  play: Rect;
  back: Rect;
  /** Font sizes in stage px. */
  text: { variantTitle: number; blurb: number; label: number; control: number };
  radius: number;
}

interface Item {
  natural: number;
  min: number;
  /** Space above this item. */
  gap: number;
}

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

/**
 * Heights for a column of items: their natural heights if they fit in `avail`, else shrunk by
 * a common factor, never below their minimums.
 */
const fitHeights = (items: readonly Item[], avail: number): number[] => {
  const gaps = items.slice(1).reduce((s, it) => s + it.gap, 0);
  const total = (k: number) => items.reduce((s, it) => s + Math.max(it.min, it.natural * k), gaps);
  let k = 1;
  if (total(1) > avail) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (total(mid) <= avail) lo = mid;
      else hi = mid;
    }
    k = lo;
  }
  return items.map((it) => Math.max(it.min, it.natural * k));
};

/** Stack items (listed top to bottom) upwards from `bottom`, sharing the space down from `top`. */
const stackUp = (items: readonly Item[], x: number, width: number, top: number, bottom: number) => {
  const heights = fitHeights(items, bottom - top);
  const out: Rect[] = [];
  let y = bottom;
  for (let i = items.length - 1; i >= 0; i--) {
    const h = heights[i] ?? 0;
    y -= h;
    out.unshift(rect(x, y, width, h));
    y -= items[i]?.gap ?? 0;
  }
  return out;
};

/** Smallest segment, in venue px, before a row puts its label above the control instead. */
const MIN_PART = 120;

/** How option rows split between label and control in one column. */
interface RowStyle {
  labelFrac: number;
  gap: number;
  /** Height of a label placed above its control. */
  labelH: number;
  unit: number;
}

/** Whether a row of this width puts the label above the control, to keep segments wide. */
const stacked = (shape: ControlShape, width: number, st: RowStyle): boolean => {
  if (shape.kind !== "segments") return false;
  const n = Math.max(1, shape.count);
  const control = width * (1 - st.labelFrac) - st.gap;
  return (control - ((n - 1) * st.gap) / 2) / n < MIN_PART * st.unit;
};

/** Split an option row into its label and control, and the control into its parts. */
const controlSpot = (row: Rect, shape: ControlShape, st: RowStyle): ControlSpot => {
  const { gap } = st;
  let label: Rect;
  let control: Rect;
  if (stacked(shape, row.width, st)) {
    label = rect(row.x, row.y, row.width, st.labelH);
    control = rect(row.x, row.y + st.labelH, row.width, row.height - st.labelH);
  } else {
    const labelW = row.width * st.labelFrac;
    label = rect(row.x, row.y, labelW, row.height);
    control = rect(row.x + labelW + gap, row.y, row.width - labelW - gap, row.height);
  }
  const h = control.height;
  let parts: Rect[];
  if (shape.kind === "segments") {
    const n = Math.max(1, shape.count);
    const g = gap * 0.5;
    const w = (control.width - (n - 1) * g) / n;
    parts = Array.from({ length: n }, (_, i) => rect(control.x + i * (w + g), control.y, w, h));
  } else if (shape.kind === "stepper") {
    const side = Math.min(h, control.width / 3);
    parts = [
      rect(control.x, control.y, side, h),
      rect(control.x + side, control.y, control.width - 2 * side, h),
      rect(control.x + control.width - side, control.y, side, h),
    ];
  } else {
    parts = [rect(control.x, control.y, Math.min(control.width, h * 2.3), h)];
  }
  return { label, control, parts };
};

interface Scale {
  variant: [number, number];
  option: [number, number];
  action: number;
  gap: number;
  section: number;
}

const variantItems = (n: number, s: Scale): Item[] =>
  Array.from({ length: n }, (_, i) => ({
    natural: s.variant[0],
    min: s.variant[1],
    gap: i === 0 ? 0 : s.gap,
  }));

const optionItems = (
  shapes: readonly ControlShape[],
  s: Scale,
  firstGap: number,
  width: number,
  st: RowStyle,
): Item[] =>
  shapes.map((shape, i) => {
    const extra = stacked(shape, width, st) ? st.labelH : 0;
    return {
      natural: s.option[0] + extra,
      min: s.option[1] + extra,
      gap: i === 0 ? firstGap : s.gap,
    };
  });

/** One column, bottom up: Back and Play side by side, the options, then the variants. */
const panelChoose = (f: MenuFrame, spec: ChooseSpec): ChooseLayout => {
  const u = f.unit;
  const margin = 56 * u;
  const s: Scale = {
    variant: [170 * u, 128 * u],
    option: [132 * u, 120 * u],
    action: 170 * u,
    gap: 20 * u,
    section: 46 * u,
  };
  const header = 88 * u;
  const x = margin;
  const width = f.width - 2 * margin;
  const text = { variantTitle: 56 * u, blurb: 36 * u, label: 44 * u, control: 50 * u };
  const st: RowStyle = { labelFrac: 0.3, gap: 24 * u, labelH: text.label * 1.5, unit: u };
  const items: Item[] = [
    ...variantItems(spec.variants, s),
    ...optionItems(spec.controls, s, spec.variants > 0 ? s.section : 0, width, st),
    { natural: s.action, min: s.action, gap: s.section },
  ];
  const top = margin + header * 2;
  const rows = stackUp(items, x, width, top, f.height - margin);
  const variants = rows.slice(0, spec.variants);
  const optionRows = rows.slice(spec.variants, spec.variants + spec.controls.length);
  const actions = rows[rows.length - 1] ?? rect(x, f.height - margin - s.action, width, s.action);
  const backW = width * 0.34;
  const contentTop = rows[0]?.y ?? actions.y;
  return {
    header: {
      x: f.width / 2,
      y: Math.max(margin + header / 2, contentTop - header * 1.1),
      width,
      size: header,
    },
    variants,
    controls: optionRows.map((r, i) => controlSpot(r, spec.controls[i] ?? { kind: "toggle" }, st)),
    back: rect(actions.x, actions.y, backW, actions.height),
    play: rect(actions.x + backW + s.gap, actions.y, width - backW - s.gap, actions.height),
    text,
    radius: 30 * u,
  };
};

interface Column {
  x: number;
  width: number;
}

/**
 * Two columns, each inside one panel (pair) or half (kiosk). The left holds the title, the
 * variants and Back; the right holds the options and Play. Without variants the options are
 * shared between the columns.
 */
const twoColumns = (
  f: MenuFrame,
  spec: ChooseSpec,
  left: Column,
  right: Column,
  s: Scale,
  margin: number,
  header: number,
  text: ChooseLayout["text"],
  radius: number,
): ChooseLayout => {
  const n = spec.controls.length;
  const leftOptions = spec.variants > 0 ? 0 : Math.floor(n / 2);
  const st: RowStyle = { labelFrac: 0.28, gap: s.gap, labelH: text.label * 1.5, unit: f.unit };
  const bottom = f.height - margin;
  const top = margin + header * 2;
  // Variants that don't fit above Back at their smallest go on at the top of the right column.
  const fitLeft = Math.floor(
    (bottom - top - s.section - s.action + s.gap) / (s.variant[1] + s.gap),
  );
  const leftVariants = Math.min(spec.variants, Math.max(1, fitLeft));
  const rightVariants = spec.variants - leftVariants;
  const leftItems: Item[] = [
    ...variantItems(leftVariants, s),
    ...optionItems(spec.controls.slice(0, leftOptions), s, 0, left.width, st),
    { natural: s.action, min: s.action, gap: s.section },
  ];
  const rightItems: Item[] = [
    ...variantItems(rightVariants, s),
    ...optionItems(
      spec.controls.slice(leftOptions),
      s,
      rightVariants > 0 ? s.section : 0,
      right.width,
      st,
    ),
    { natural: s.action, min: s.action, gap: s.section },
  ];
  const l = stackUp(leftItems, left.x, left.width, top, bottom);
  const r = stackUp(rightItems, right.x, right.width, margin, bottom);
  const variants = [...l.slice(0, leftVariants), ...r.slice(0, rightVariants)];
  const optionRows = [
    ...l.slice(leftVariants, leftVariants + leftOptions),
    ...r.slice(rightVariants, -1),
  ];
  const backRow = l[l.length - 1]!;
  const playRow = r[r.length - 1]!;
  // The title sits in the left column but above the tops of both.
  const contentTop = Math.min(l[0]?.y ?? backRow.y, r[0]?.y ?? playRow.y);
  return {
    header: {
      x: left.x + left.width / 2,
      y: Math.max(margin + header / 2, contentTop - header * 1.1),
      width: left.width,
      size: header,
    },
    variants,
    controls: optionRows.map((row, i) =>
      controlSpot(row, spec.controls[i] ?? { kind: "toggle" }, st),
    ),
    // Back at the outer edge, away from the seam and from Play.
    back: { ...backRow, width: backRow.width * 0.5 },
    play: playRow,
    text,
    radius,
  };
};

const pairChoose = (f: MenuFrame, spec: ChooseSpec): ChooseLayout => {
  const u = f.unit;
  const panels = Math.max(2, f.seams.length + 1);
  const panelW = f.width / panels;
  const margin = 64 * u;
  const clear = panelW * 0.2;
  const left = { x: margin, width: panelW - clear - margin };
  const lastLeft = (panels - 1) * panelW + clear;
  const right = { x: lastLeft, width: f.width - margin - lastLeft };
  const s: Scale = {
    variant: [200 * u, 140 * u],
    option: [150 * u, 124 * u],
    action: 190 * u,
    gap: 24 * u,
    section: 48 * u,
  };
  return twoColumns(
    f,
    spec,
    left,
    right,
    s,
    margin,
    92 * u,
    { variantTitle: 58 * u, blurb: 38 * u, label: 46 * u, control: 52 * u },
    34 * u,
  );
};

const kioskChoose = (f: MenuFrame, spec: ChooseSpec): ChooseLayout => {
  const u = f.unit;
  const margin = 40 * u;
  const gap = 48 * u;
  const colW = (f.width - 2 * margin - gap) / 2;
  const s: Scale = {
    variant: [170 * u, 124 * u],
    option: [124 * u, 120 * u],
    action: 150 * u,
    gap: 20 * u,
    section: 36 * u,
  };
  return twoColumns(
    f,
    spec,
    { x: margin, width: colW },
    { x: margin + colW + gap, width: colW },
    s,
    margin,
    64 * u,
    { variantTitle: 46 * u, blurb: 30 * u, label: 40 * u, control: 44 * u },
    24 * u,
  );
};

/**
 * Side by side inside the reachable band, centred on the tile that was tapped so the visitor
 * needn't walk: variants, then the options (in more columns if they don't fit), then Back over
 * Play. The title sits above the band.
 */
const wallChoose = (f: MenuFrame, spec: ChooseSpec): ChooseLayout => {
  const u = f.unit;
  const margin = 100 * u;
  const gap = 100 * u;
  const rowGap = 34 * u;
  const bandTop = Math.min(Math.max(0, f.reachTop.adult), f.height);
  const top = Math.min(bandTop + 30 * u, f.height - 700 * u);
  const bottom = f.height - 50 * u;
  const avail = bottom - top;
  const s: Scale = {
    variant: [270 * u, 180 * u],
    option: [200 * u, 170 * u],
    action: 380 * u,
    gap: rowGap,
    section: 40 * u,
  };
  const n = spec.controls.length;
  // At most four rows a column, and columns share the rows evenly.
  const fit = Math.floor((avail + rowGap) / (s.option[1] + rowGap));
  const perColMax = Math.max(1, Math.min(4, fit));
  const optionCols = n > 0 ? Math.ceil(n / perColMax) : 0;
  const perCol = optionCols > 0 ? Math.ceil(n / optionCols) : 0;
  // Variants that don't fit one column at full height, where blurbs aren't cut, go on into more.
  const fitVariants = Math.max(1, Math.floor((avail + rowGap) / (s.variant[0] + rowGap)));
  const variantCols = spec.variants > 0 ? Math.ceil(spec.variants / fitVariants) : 0;
  // Columns narrow together when a shorter wall can't take them at their usual widths.
  const natural = {
    variant: (optionCols > 1 || variantCols > 1 ? 1000 : 1100) * u,
    option: (optionCols > 1 ? 1250 : 1500) * u,
    action: 520 * u,
  };
  const count = variantCols + optionCols + 1;
  const sum = variantCols * natural.variant + optionCols * natural.option + natural.action;
  const k = Math.min(1, (f.width - 2 * margin - (count - 1) * gap) / sum);
  const variantW = natural.variant * k;
  const optionW = natural.option * k;
  const actionW = natural.action * k;
  const text = { variantTitle: 80 * u, blurb: 52 * u, label: 66 * u, control: 68 * u };
  const st: RowStyle = { labelFrac: 0.3, gap: 30 * u, labelH: text.label * 1.5, unit: u };
  const cols = [
    ...Array.from({ length: variantCols }, () => variantW),
    ...Array.from({ length: optionCols }, () => optionW),
    actionW,
  ];
  const blockW = cols.reduce((a, b) => a + b, 0) + (cols.length - 1) * gap;
  const anchor = spec.anchorX ?? f.width / 2;
  const x0 = Math.min(
    Math.max(margin, anchor - blockW / 2),
    Math.max(margin, f.width - margin - blockW),
  );
  let x = x0;
  const take = (w: number) => {
    const at = x;
    x += w + gap;
    return at;
  };

  const variants: Rect[] = [];
  for (let c = 0; c < variantCols; c++) {
    const count =
      Math.floor(spec.variants / variantCols) + (c < spec.variants % variantCols ? 1 : 0);
    variants.push(...stackUp(variantItems(count, s), take(variantW), variantW, top, bottom));
  }
  const optionRows: Rect[] = [];
  for (let c = 0; c < optionCols; c++) {
    const shapes = spec.controls.slice(c * perCol, (c + 1) * perCol);
    const items = optionItems(shapes, s, 0, optionW, st);
    optionRows.push(...stackUp(items, take(optionW), optionW, top, bottom));
  }
  const ax = take(actionW);
  const playH = Math.min(s.action, avail * 0.55);
  const play = rect(ax, bottom - playH, actionW, playH);
  const backH = Math.min(240 * u, play.y - top - s.section);
  const back = rect(ax, play.y - s.section - backH, actionW, backH);
  const header = 200 * u;
  return {
    header: {
      x: x0 + blockW / 2,
      y: Math.max(header / 2, bandTop - 260 * u),
      width: blockW,
      size: header,
    },
    variants,
    controls: optionRows.map((row, i) =>
      controlSpot(row, spec.controls[i] ?? { kind: "toggle" }, st),
    ),
    play,
    back,
    text,
    radius: 44 * u,
  };
};

/** Where the choose step's parts go on this frame. */
export const layoutChoose = (f: MenuFrame, spec: ChooseSpec): ChooseLayout => {
  switch (f.kind) {
    case "panel":
      return panelChoose(f, spec);
    case "pair":
      return pairChoose(f, spec);
    case "wall":
      return wallChoose(f, spec);
    case "kiosk":
    case "screen":
    case "sphere":
      return kioskChoose(f, spec);
  }
};
