/**
 * Builds. Each theme is a picture whose parts are slots, and it splits the same picture into as
 * many slots as the build has parts (12 to 48): more parts make smaller pieces of the same
 * rocket rather than a bigger rocket. Coordinates are build units: the box is `aspect` wide and
 * 1 tall, y grows downwards and the ground is at the bottom. Pure, so tests can check every size.
 */
import { MAX_PARTS, MIN_PARTS, type ThemeId } from "./config";

export interface SlotShape {
  kind: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lower fills first, so builds grow from the ground up. */
  order: number;
  /** Parts in one group move together while the build is alive (a waving arm, a flag). */
  group: number;
  /** A drawing hint, such as which side a fin points or a stone's row. */
  v: number;
}

export interface ThemeDef {
  id: ThemeId;
  /** Part kinds, by index. Names are for code and tests, never shown. */
  kinds: readonly string[];
  aspect: number;
  slots(n: number): SlotShape[];
}

const GAP = 0.006;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `total` split over `rows` as evenly as possible, any shortfall in the top rows. */
export const spread = (total: number, rows: number): number[] => {
  const r = Math.max(1, rows);
  const base = Math.floor(total / r);
  const extra = total - base * r;
  return Array.from({ length: r }, (_, i) => base + (i >= r - extra ? 1 : 0));
};

type Cell = Omit<SlotShape, "order">;

const cell = (
  kind: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  group = 0,
  v = 0,
): Cell => ({
  kind,
  x: x0 + GAP,
  y: y0 + GAP,
  w: Math.max(0.001, x1 - x0 - 2 * GAP),
  h: Math.max(0.001, y1 - y0 - 2 * GAP),
  group,
  v,
});

/**
 * Rows of cells between y0 and y1, `counts[i]` cells in row i (top first), each row spanning
 * `span(yMid)`. `kindAt(row, col, count)` picks each cell's kind.
 */
const rows = (
  counts: readonly number[],
  y0: number,
  y1: number,
  span: (y: number) => [number, number],
  kindAt: (row: number, col: number, count: number) => number,
  v: (row: number) => number = (row) => row,
): Cell[] => {
  const out: Cell[] = [];
  const rh = (y1 - y0) / Math.max(1, counts.length);
  counts.forEach((count, r) => {
    if (count <= 0) return;
    const ya = y0 + r * rh;
    const [xa, xb] = span(ya + rh / 2);
    const cw = (xb - xa) / count;
    for (let c = 0; c < count; c++) {
      out.push(cell(kindAt(r, c, count), xa + c * cw, ya, xa + (c + 1) * cw, ya + rh, 0, v(r)));
    }
  });
  return out;
};

/** Number the cells bottom first, then left to right. */
const ordered = (cells: Cell[]): SlotShape[] => {
  const idx = cells.map((_, i) => i);
  idx.sort((a, b) => {
    const ca = cells[a]!;
    const cb = cells[b]!;
    const dy = cb.y + cb.h - (ca.y + ca.h);
    return Math.abs(dy) > 1e-6 ? dy : ca.x - cb.x;
  });
  const order: number[] = Array.from({ length: cells.length }, () => 0);
  idx.forEach((i, rank) => {
    order[i] = rank;
  });
  return cells.map((c, i) => ({ ...c, order: order[i]! }));
};

// ---- Rocket ------------------------------------------------------------------------------

export const ROCKET = {
  aspect: 0.62,
  cx: 0.31,
  body: { x0: 0.21, x1: 0.41, y0: 0.2, y1: 0.84 },
  boosters: { w: 0.075, gap: 0.01, y0: 0.46, y1: 0.84 },
  noseTop: 0.05,
  bell: 0.9,
} as const;

const rocket = (n: number): SlotShape[] => {
  const { body, boosters: bo } = ROCKET;
  const fins = n >= 24 ? 4 : 2;
  const per = clamp(Math.round(n / 12), 1, 4);
  const rest = n - fins - 2 * per;
  const cols = rest <= 12 ? 2 : 3;
  const counts = spread(rest, Math.ceil(rest / cols));
  const cells = rows(
    counts,
    body.y0,
    body.y1,
    () => [body.x0, body.x1],
    (r, c, count) => (r % 3 === 1 && c === Math.floor((count - 1) / 2) ? 1 : 0),
  );
  if (!cells.some((c) => c.kind === 1) && cells[0]) cells[0].kind = 1;
  const left = body.x0 - bo.gap - bo.w;
  const right = body.x1 + bo.gap;
  const th = (bo.y1 - bo.y0) / per;
  for (let i = 0; i < per; i++) {
    const y = bo.y0 + i * th;
    cells.push(cell(3, left, y, left + bo.w, y + th, 0, i === 0 ? 1 : 0));
    cells.push(cell(3, right, y, right + bo.w, y + th, 0, i === 0 ? 1 : 0));
  }
  const finW = 0.08;
  const lowFin = [0.66, 0.84] as const;
  const highFin = [0.5, 0.64] as const;
  const finRows = fins === 4 ? [lowFin, highFin] : [lowFin];
  for (const [y0, y1] of finRows) {
    cells.push(cell(2, left - finW - 0.005, y0, left - 0.005, y1, 0, -1));
    cells.push(cell(2, right + bo.w + 0.005, y0, right + bo.w + 0.005 + finW, y1, 0, 1));
  }
  return ordered(cells);
};

// ---- Treehouse ---------------------------------------------------------------------------

export const TREEHOUSE = {
  aspect: 1,
  trunk: { x0: 0.44, x1: 0.56 },
  platform: { x0: 0.2, x1: 0.8, y0: 0.56, y1: 0.61 },
  walls: { x0: 0.25, x1: 0.75, y0: 0.33, y1: 0.56 },
  roof: { apex: 0.1, base: 0.33, half: 0.3 },
  ladder: { x0: 0.3, x1: 0.38, y0: 0.61, y1: 0.98 },
  /** Branches the lanterns hang from: from the trunk out to the tip. */
  branches: [
    { x0: 0.44, y0: 0.62, x1: 0.02, y1: 0.43 },
    { x0: 0.56, y0: 0.6, x1: 0.98, y1: 0.41 },
  ],
} as const;

export const branchY = (b: (typeof TREEHOUSE.branches)[number], x: number): number =>
  b.y0 + ((b.y1 - b.y0) * (x - b.x0)) / (b.x1 - b.x0);

const treehouse = (n: number): SlotShape[] => {
  const T = TREEHOUSE;
  const lanterns = clamp(Math.round(n / 8), 2, 6);
  const rungs = clamp(Math.round(n / 6), 2, 7);
  const windows = clamp(Math.round(n / 12), 1, 4);
  const planks = n - lanterns - rungs - windows;
  const floor = clamp(Math.round(planks * 0.18), 1, 4);
  const roof = clamp(Math.round(planks * 0.3), 1, 10);
  const wall = planks - floor - roof + windows;
  const cells: Cell[] = [];

  const roofRows = clamp(Math.round(roof / 2), 1, 4);
  const halfAt = (y: number) => (T.roof.half * (y - T.roof.apex)) / (T.roof.base - T.roof.apex);
  const roofTop = T.roof.apex + (T.roof.base - T.roof.apex) * 0.15;
  cells.push(
    ...rows(
      spread(roof, roofRows),
      roofTop,
      T.roof.base,
      (y) => [0.5 - halfAt(y) * 0.92, 0.5 + halfAt(y) * 0.92],
      () => 0,
      () => 1,
    ),
  );

  const wallRows = clamp(Math.round(Math.sqrt(wall / 1.6)), 1, 5);
  const wallCounts = spread(wall, wallRows);
  // Windows go in the middle of the rows, as evenly over the rows as they fit.
  const wallCells = rows(
    wallCounts,
    T.walls.y0,
    T.walls.y1,
    () => [T.walls.x0, T.walls.x1],
    () => 0,
    () => 2,
  );
  const rowOf: number[] = [];
  wallCounts.forEach((c, r) => {
    for (let i = 0; i < c; i++) rowOf.push(r);
  });
  let placed = 0;
  for (let k = 0; placed < windows && k < wallCells.length * 2; k++) {
    const r = k % wallRows;
    const start = rowOf.indexOf(r);
    const count = wallCounts[r] ?? 0;
    if (start < 0 || count === 0) continue;
    const order = [Math.floor((count - 1) / 2), Math.ceil((count - 1) / 2), 0, count - 1];
    for (const c of order) {
      const target = wallCells[start + c];
      if (target && target.kind === 0) {
        target.kind = 1;
        placed++;
        break;
      }
    }
  }
  for (let i = 0; placed < windows && i < wallCells.length; i++) {
    if (wallCells[i]!.kind === 0) {
      wallCells[i]!.kind = 1;
      placed++;
    }
  }
  cells.push(...wallCells);

  cells.push(
    ...rows(
      [floor],
      T.platform.y0,
      T.platform.y1,
      () => [T.platform.x0, T.platform.x1],
      () => 0,
    ),
  );

  const step = (T.ladder.y1 - T.ladder.y0) / rungs;
  for (let i = 0; i < rungs; i++) {
    const yc = T.ladder.y0 + (i + 0.5) * step;
    cells.push(cell(2, T.ladder.x0, yc - 0.018, T.ladder.x1, yc + 0.018, 0, i));
  }

  const lw = 0.05;
  const sides = [Math.ceil(lanterns / 2), Math.floor(lanterns / 2)];
  sides.forEach((count, side) => {
    const branch = T.branches[side]!;
    for (let i = 0; i < count; i++) {
      // Left lanterns from the tip inwards, right ones mirrored, clear of the platform.
      const xl = 0.025 + i * (lw + 0.01);
      const x0 = side === 0 ? xl : 1 - xl - lw;
      const y0 = branchY(branch, x0 + lw / 2) + 0.025;
      cells.push(cell(3, x0, y0, x0 + lw, y0 + 0.085, 1, side));
    }
  });
  return ordered(cells);
};

// ---- Lighthouse --------------------------------------------------------------------------

export const LIGHTHOUSE = {
  aspect: 0.6,
  cx: 0.3,
  tower: { top: 0.3, bottom: 0.9, halfTop: 0.1, halfBottom: 0.165 },
  gallery: { y0: 0.25, y1: 0.3, half: 0.15 },
  lamp: { y0: 0.13, y1: 0.25, half: 0.085 },
  dome: 0.06,
} as const;

export const towerHalf = (y: number): number => {
  const t = LIGHTHOUSE.tower;
  return t.halfTop + ((t.halfBottom - t.halfTop) * (y - t.top)) / (t.bottom - t.top);
};

const lighthouse = (n: number): SlotShape[] => {
  const L = LIGHTHOUSE;
  const lamp = clamp(Math.round(n / 14), 1, 3);
  const rails = clamp(Math.round(n / 8), 2, 6);
  const windows = clamp(Math.round(n / 12), 1, 3);
  const tower = n - lamp - rails;
  const cols = tower <= 14 ? 2 : 3;
  const counts = spread(tower, Math.ceil(tower / cols));
  const cells = rows(
    counts,
    L.tower.top,
    L.tower.bottom,
    (y) => [L.cx - towerHalf(y), L.cx + towerHalf(y)],
    () => 0,
  );
  // Windows climb the middle of the tower, every few rows.
  const starts: number[] = [];
  let at = 0;
  for (const c of counts) {
    starts.push(at);
    at += c;
  }
  const every = Math.max(1, Math.floor(counts.length / windows));
  let placed = 0;
  for (let r = Math.floor(every / 2); r < counts.length && placed < windows; r += every) {
    const count = counts[r] ?? 0;
    const target = cells[(starts[r] ?? 0) + Math.floor((count - 1) / 2)];
    if (target && count > 0) {
      target.kind = 1;
      placed++;
    }
  }
  cells.push(
    ...rows(
      [rails],
      L.gallery.y0,
      L.gallery.y1,
      () => [L.cx - L.gallery.half, L.cx + L.gallery.half],
      () => 2,
    ),
  );
  for (const c of rows(
    [lamp],
    L.lamp.y0,
    L.lamp.y1,
    () => [L.cx - L.lamp.half, L.cx + L.lamp.half],
    () => 3,
  )) {
    cells.push({ ...c, group: 1 });
  }
  return ordered(cells);
};

// ---- Robot -------------------------------------------------------------------------------

export const ROBOT = {
  aspect: 0.82,
  cx: 0.41,
  head: { y0: 0.075, y1: 0.27, half: 0.12 },
  torso: { y0: 0.3, y1: 0.64, half: 0.16 },
  arms: { y0: 0.31, y1: 0.66, inner: 0.19, outer: 0.28 },
  legs: { y0: 0.69, y1: 0.93 },
} as const;

const robot = (n: number): SlotShape[] => {
  const R = ROBOT;
  const per = clamp(Math.round(n / 12), 1, 3);
  const lights = clamp(Math.round(n / 8), 2, 6);
  const torso = n - 2 * per - lights;
  const cols = torso <= 12 ? 3 : 4;
  const cells = rows(
    spread(torso, Math.ceil(torso / cols)),
    R.torso.y0,
    R.torso.y1,
    () => [R.cx - R.torso.half, R.cx + R.torso.half],
    (r, c) => ((r + c) % 2 === 0 ? 0 : 1),
  );
  const eyeY = R.head.y0 + (R.head.y1 - R.head.y0) * 0.3;
  for (const dx of [-0.055, 0.055]) {
    const x = R.cx + dx;
    cells.push(cell(2, x - 0.04, eyeY, x + 0.04, eyeY + 0.08, 0, 0));
  }
  if (lights >= 3) cells.push(cell(2, R.cx - 0.035, 0, R.cx + 0.035, 0.065, 0, 1));
  const belt = lights - 3;
  for (let i = 0; i < belt; i++) {
    const w = (2 * R.torso.half) / belt;
    const x0 = R.cx - R.torso.half + i * w;
    const x1 = x0 + w;
    const mid = (x0 + x1) / 2;
    const half = Math.min(0.03, w / 2 - 0.004);
    cells.push(cell(2, mid - half, R.torso.y1 + 0.004, mid + half, R.torso.y1 + 0.056, 0, 2));
  }
  const ah = (R.arms.y1 - R.arms.y0) / per;
  for (let i = 0; i < per; i++) {
    const y = R.arms.y0 + i * ah;
    const v = i === per - 1 ? 1 : 0;
    cells.push(cell(3, R.cx - R.arms.outer, y, R.cx - R.arms.inner, y + ah, 0, v));
    cells.push(cell(3, R.cx + R.arms.inner, y, R.cx + R.arms.outer, y + ah, 1, v));
  }
  return ordered(cells);
};

// ---- Sandcastle --------------------------------------------------------------------------

export const SANDCASTLE = {
  aspect: 1.5,
  ground: 0.92,
  tower: { w: 0.17, top: 0.36 },
  wallTop: 0.56,
  flag: { y0: 0.16, y1: 0.355, w: 0.12 },
  span: [0.2, 1.3] as const,
} as const;

export const towerCentres = (t: number): number[] => {
  const [a, b] = SANDCASTLE.span;
  return Array.from({ length: t }, (_, i) => a + ((b - a) * i) / Math.max(1, t - 1));
};

const sandcastle = (n: number): SlotShape[] => {
  const S = SANDCASTLE;
  const towers = n < 20 ? 2 : n < 34 ? 3 : 4;
  const shells = clamp(Math.round(n / 8), 2, 6);
  const segs = clamp(Math.round(n / 12) + 1, 2, 4);
  const blocks = n - towers - shells - towers * segs;
  const xs = towerCentres(towers);
  const tw = S.tower.w;
  const cells: Cell[] = [];
  const sh = (S.ground - S.tower.top) / segs;
  for (const x of xs) {
    for (let i = 0; i < segs; i++) {
      const y = S.tower.top + i * sh;
      cells.push(cell(1, x - tw / 2, y, x + tw / 2, y + sh, 0, i === 0 ? 1 : 0));
    }
    cells.push(cell(2, x - S.flag.w / 2, S.flag.y0, x + S.flag.w / 2, S.flag.y1, 1, 0));
  }
  const gaps = towers - 1;
  spread(blocks, gaps).forEach((count, g) => {
    const x0 = xs[g]! + tw / 2;
    const x1 = xs[g + 1]! - tw / 2;
    const rowCount = clamp(Math.round(Math.sqrt(count / 2)), 1, 4);
    cells.push(
      ...rows(
        spread(count, rowCount),
        S.wallTop,
        S.ground,
        () => [x0, x1],
        () => 0,
        (r) => (r === 0 ? 1 : 0),
      ),
    );
  });
  const sw = 0.075;
  const [a, b] = [0.1, S.aspect - 0.1];
  for (let i = 0; i < shells; i++) {
    const x = a + ((b - a - sw) * (i + 0.5)) / shells;
    cells.push(cell(3, x, 0.928, x + sw, 0.995, 0, i % 2));
  }
  return ordered(cells);
};

export const THEMES: Record<ThemeId, ThemeDef> = {
  rocket: {
    id: "rocket",
    kinds: ["plate", "window", "fin", "tank"],
    aspect: ROCKET.aspect,
    slots: rocket,
  },
  treehouse: {
    id: "treehouse",
    kinds: ["plank", "window", "rung", "lantern"],
    aspect: TREEHOUSE.aspect,
    slots: treehouse,
  },
  lighthouse: {
    id: "lighthouse",
    kinds: ["stone", "window", "rail", "lamp"],
    aspect: LIGHTHOUSE.aspect,
    slots: lighthouse,
  },
  robot: {
    id: "robot",
    kinds: ["gear", "bolt", "light", "arm"],
    aspect: ROBOT.aspect,
    slots: robot,
  },
  sandcastle: {
    id: "sandcastle",
    kinds: ["block", "tower", "flag", "shell"],
    aspect: SANDCASTLE.aspect,
    slots: sandcastle,
  },
};

/** Exactly `n` slots for a build, with `n` held to the allowed sizes. */
export const slotsFor = (theme: ThemeId, n: number): SlotShape[] =>
  THEMES[theme].slots(clamp(Math.round(n), MIN_PARTS, MAX_PARTS));
