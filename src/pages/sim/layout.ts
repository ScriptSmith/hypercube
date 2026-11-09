import type { PhysRect, SimFrame, SimPreset } from "./presets";

/** Where a frame is drawn, in sim page px. `scale` maps the iframe's true px to page px. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PhysicalLayout {
  pxPerM: number;
  /** Page x of a physical x in metres. */
  x(m: number): number;
  /** Page y of a height above the floor in metres. */
  y(m: number): number;
  frames: Map<string, ScreenRect>;
}

/** Room for zone labels above, the floor label below and the height ruler on the left. */
const HEAD_ROOM = 40;
const FOOT_ROOM = 22;
const LEFT_ROOM = 44;
const RIGHT_ROOM = 16;

export const physicalBounds = (preset: SimPreset) => {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;
  for (const f of preset.frames) {
    minX = Math.min(minX, f.phys.x);
    maxX = Math.max(maxX, f.phys.x + f.phys.w);
    maxY = Math.max(maxY, f.phys.y + f.phys.h);
  }
  for (const p of preset.people) {
    // A silhouette is about a quarter of its height wide.
    minX = Math.min(minX, p.x - p.height * 0.15);
    maxX = Math.max(maxX, p.x + p.height * 0.15);
    maxY = Math.max(maxY, p.height);
  }
  maxY = Math.max(maxY, preset.ceiling ?? 0);
  return { minX, maxX, maxY };
};

/**
 * Where a frame's picture goes, in metres: its display area, or for a sphere, the largest
 * rectangle of the feed's aspect inside the ball's outline.
 */
export const pictureRect = (f: SimFrame): PhysRect => {
  if (f.kind !== "sphere") return f.phys;
  const r = f.phys.w / 2;
  const aspect = f.width / f.height;
  const h = (2 * r) / Math.hypot(aspect, 1);
  const w = h * aspect;
  return { x: f.phys.x + r - w / 2, y: f.phys.y + r - h / 2, w, h };
};

/** Fit content into a box of `boxW` x `boxH` page px, keeping its aspect, centred. */
const fitInto = (
  frame: { width: number; height: number },
  box: { left: number; top: number; width: number; height: number },
): ScreenRect => {
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
    scale,
  };
};

/** Lay the preset out at true physical proportions, as large as fits in `view`. */
export const layoutPhysical = (preset: SimPreset, view: Viewport): PhysicalLayout => {
  const { minX, maxX, maxY } = physicalBounds(preset);
  const availW = Math.max(1, view.width - LEFT_ROOM - RIGHT_ROOM);
  const availH = Math.max(1, view.height - HEAD_ROOM - FOOT_ROOM);
  const pxPerM = Math.min(availW / (maxX - minX), availH / maxY);
  const offsetX = LEFT_ROOM + (availW - (maxX - minX) * pxPerM) / 2;
  const floorY = HEAD_ROOM + maxY * pxPerM + (availH - maxY * pxPerM) / 2;
  const x = (m: number) => offsetX + (m - minX) * pxPerM;
  const y = (m: number) => floorY - m * pxPerM;
  const frames = new Map<string, ScreenRect>();
  for (const f of preset.frames) {
    const box = pictureRect(f);
    frames.set(
      f.id,
      fitInto(f, {
        left: x(box.x),
        top: y(box.y + box.h),
        width: box.w * pxPerM,
        height: box.h * pxPerM,
      }),
    );
  }
  return { pxPerM, x, y, frames };
};

const COMPACT_GAP = 6;
const COMPACT_PAD = 12;
/** Space under each compact row for the frames' status badges. */
const BADGE_ROOM = 26;

/**
 * Pack frames at one common scale, screens on the first shelf and touch frames below,
 * wrapping rows as needed. Physical proportions are ignored so frames come out larger.
 */
export const layoutCompact = (frames: readonly SimFrame[], view: Viewport) => {
  const shelves = [
    frames.filter((f) => f.kind === "screen"),
    frames.filter((f) => f.kind !== "screen"),
  ].filter((s) => s.length > 0);
  const availW = Math.max(1, view.width - 2 * COMPACT_PAD);
  const availH = Math.max(1, view.height - 2 * COMPACT_PAD);

  const pack = (scale: number) => {
    const rows: { items: SimFrame[]; width: number; height: number }[] = [];
    for (const shelf of shelves) {
      let row: (typeof rows)[number] | null = null;
      for (const f of shelf) {
        const w = f.width * scale;
        const h = f.height * scale;
        if (!row || row.width + COMPACT_GAP + w > availW) {
          row = { items: [], width: -COMPACT_GAP, height: 0 };
          rows.push(row);
        }
        row.items.push(f);
        row.width += COMPACT_GAP + w;
        row.height = Math.max(row.height, h + BADGE_ROOM);
      }
    }
    const height = rows.reduce((sum, r) => sum + r.height, 0) + (rows.length - 1) * COMPACT_GAP;
    const fits =
      height <= availH && frames.every((f) => f.width * scale <= availW) && rows.length > 0;
    return { rows, height, fits };
  };

  let lo = 0;
  let hi = 4;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (pack(mid).fits) lo = mid;
    else hi = mid;
  }
  const scale = lo;
  const { rows, height } = pack(scale);
  const out = new Map<string, ScreenRect>();
  let top = COMPACT_PAD + (availH - height) / 2;
  for (const row of rows) {
    let left = COMPACT_PAD + (availW - row.width) / 2;
    for (const f of row.items) {
      const w = f.width * scale;
      const h = f.height * scale;
      out.set(f.id, {
        left,
        top: top + (row.height - BADGE_ROOM - h),
        width: w,
        height: h,
        scale,
      });
      left += w + COMPACT_GAP;
    }
    top += row.height + COMPACT_GAP;
  }
  return out;
};

/** The largest rect for one frame inside `view`, centred. */
export const focusRect = (frame: { width: number; height: number }, view: Viewport): ScreenRect =>
  fitInto(frame, { left: 0, top: 0, width: view.width, height: view.height });

/**
 * Render resolution for a frame drawn at `scale`. Inside the iframe the backing store is
 * devicePixelRatio times `res` per CSS px, and it is shown at devicePixelRatio times
 * `scale`, so `res` near `scale` keeps detail without wasted pixels.
 */
export const autoRes = (scale: number): number =>
  Math.min(1, Math.max(0.1, Math.ceil(scale * 20) / 20));
