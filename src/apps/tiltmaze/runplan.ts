/**
 * The marble run's shape, in glass metres: positions on the frame's (or screen's) own plane, x to
 * the right and y up, as venue space has them on the wall. Things behind the glass are placed
 * along the eye's rays (see glass.ts), so a plan drawn here lands where it was laid out.
 *
 * A jar stands on its own, its size set by how many balls fill it, packed in rows that stagger.
 * Rails lead to it from each side that has room: one long rail sloping down to the jar mouth, or
 * where there's height, three that zigzag (a ball drops off the end of one onto the next). Tubes
 * rise behind the rails and deliver balls onto the top rail wherever they stand.
 */

export interface Point {
  x: number;
  y: number;
}

export interface RunPath {
  /** -1 for the side left of the jar, 1 for the right. */
  side: -1 | 1;
  /** Ball centres along the path, from the outer end of the top rail to the jar's mouth. */
  pts: Point[];
  /** Arc length to each point. */
  cum: number[];
  /** Whether each segment (pts[i] to pts[i + 1]) is a drop rather than a rail. */
  fall: boolean[];
  length: number;
}

export interface JarPlan {
  cx: number;
  /** Bottom of the inside and its size; the mouth is the top of it. */
  bottom: number;
  w: number;
  h: number;
  mouth: number;
  perRow: number;
  capacity: number;
  /** Where each ball sits, in filling order. */
  slots: Point[];
}

export interface RunPlan {
  /** Ball radius as it looks on the rails and in the jar. */
  rb: number;
  /** As it looks in the tubes, and the tubes' radius there. */
  tubeRb: number;
  tubeR: number;
  railR: number;
  rails: 1 | 3;
  jar: JarPlan;
  paths: RunPath[];
  /** The lowest the jar's stand reaches (the bottom of the area it was planned in). */
  floor: number;
}

export interface PlanInput {
  /** Ball radius; null picks the largest the jar has room for, up to `rbMax`. */
  rb: number | null;
  rbMax: number;
  capacity: number;
  /** Rails go between x0 and x1, from below `top` down to no lower than `railBottom`. */
  x0: number;
  x1: number;
  top: number;
  railBottom: number;
  /** The jar hangs below the last rail, centred on `cx`, its stand reaching down to `floor`. */
  jar: { cx: number; floor: number; maxW: number };
  /** Largest drop between zigzag rails, in radii. */
  maxDrop?: number;
  /**
   * How big a ball looks in the tubes' plane for its look on the rails (the tubes stand behind;
   * the rails can be nearer the eye). Default 1.
   */
  tubeScale?: number;
}

const SQ3 = Math.sqrt(3);
/** Gap between balls in the jar, as a share of the radius. */
const JAR_GAP = 0.06;
/** How far above the top rail a tube's top stands, and its lip above that, in radii. */
export const TUBE_HEAD = 2.4;
const TUBE_LIP = 1.2;
/** Slopes (rise over run) and the drop between zigzag rails, in radii. */
const SLOPE = { min: 0.035, mid: 0.06, max: 0.085 };
const DROP = { min: 3.4, max: 13 };

/** Balls per row: even rows hold `perRow`, odd rows one fewer, staggered. */
export const jarRows = (capacity: number, perRow: number): number => {
  let rows = 0;
  let held = 0;
  while (held < capacity) {
    held += rows % 2 === 0 ? perRow : Math.max(1, perRow - 1);
    rows++;
  }
  return rows;
};

const jarSize = (rb: number, capacity: number, perRow: number) => {
  const rows = jarRows(capacity, perRow);
  const pitch = 2 * rb * (1 + JAR_GAP / 2);
  return {
    rows,
    w: perRow * pitch + rb * 0.2,
    h: 2 * rb + (rows - 1) * SQ3 * rb * (1 + JAR_GAP / 2) + 1.4 * rb,
  };
};

/** Slots from the bottom row up; each row fills from its middle outwards. */
const jarSlots = (cx: number, bottom: number, rb: number, capacity: number, perRow: number) => {
  const slots: Point[] = [];
  const pitch = 2 * rb * (1 + JAR_GAP / 2);
  for (let row = 0; slots.length < capacity; row++) {
    const n = row % 2 === 0 ? perRow : Math.max(1, perRow - 1);
    const y = bottom + rb + row * SQ3 * rb * (1 + JAR_GAP / 2);
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2) || a - b,
    );
    for (const i of order) {
      if (slots.length >= capacity) break;
      slots.push({ x: cx + (i - (n - 1) / 2) * pitch, y });
    }
  }
  return slots;
};

/** The most balls (up to `want`) a jar of balls of radius `rb` holds within a box. */
export const fitCapacity = (rb: number, maxW: number, maxH: number, want: number): number => {
  for (let c = Math.max(1, Math.round(want)); c > 1; c--) {
    for (let n = 2; n <= 14; n++) {
      const s = jarSize(rb, c, n);
      if (s.w <= maxW && s.h <= maxH) return c;
    }
  }
  return 1;
};

/** The ball size and balls per row for a jar that has to fit in a box. */
const fitJar = (capacity: number, maxW: number, maxH: number, rbMax: number) => {
  let best = { rb: 0, perRow: 3 };
  for (let n = 2; n <= 14; n++) {
    const unit = jarSize(1, capacity, n);
    const rb = Math.min(maxW / unit.w, maxH / unit.h);
    if (rb > best.rb + 1e-9) best = { rb, perRow: n };
  }
  return { rb: Math.min(best.rb, rbMax), perRow: best.perRow };
};

/** Balls per row for a given ball size: a jar a little taller than wide, within the box. */
const shapeJar = (rb: number, capacity: number, maxW: number, maxH: number) => {
  let best = 3;
  let score = Infinity;
  for (let n = 2; n <= 14; n++) {
    const s = jarSize(rb, capacity, n);
    const over = Math.max(0, s.w - maxW) + Math.max(0, s.h - maxH);
    const v = over * 100 + Math.abs(s.h / s.w - 1.15);
    if (v < score) {
      score = v;
      best = n;
    }
  }
  return best;
};

const makePath = (side: -1 | 1, pts: Point[], fall: boolean[]): RunPath => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { side, pts, cum, fall, length: cum[cum.length - 1] ?? 0 };
};

export const buildPlan = (o: PlanInput): RunPlan => {
  const capacity = Math.max(1, Math.round(o.capacity));
  const head0 = TUBE_HEAD + TUBE_LIP;
  const maxH = Math.max(0, o.railBottom - o.jar.floor);
  let rb: number;
  let perRow: number;
  if (o.rb === null) {
    rb = fitJar(capacity, o.jar.maxW, maxH, o.rbMax).rb;
    perRow = shapeJar(rb, capacity, o.jar.maxW, maxH);
  } else {
    rb = o.rb;
    perRow = shapeJar(rb, capacity, o.jar.maxW, maxH);
  }
  const size = jarSize(rb, capacity, perRow);
  const cx = o.jar.cx;
  const halfW = size.w / 2;

  const leftRoom = cx - halfW - o.x0;
  const rightRoom = o.x1 - (cx + halfW);
  const sides = ([-1, 1] as const).filter((s) => (s < 0 ? leftRoom : rightRoom) >= 4 * rb);
  const both = sides.length === 2;

  /** The x positions of one side's rails: outer end, inner end of the top rail, end at the jar. */
  const xs = (s: -1 | 1) => ({
    out: s < 0 ? o.x0 + 1.5 * rb : o.x1 - 1.5 * rb,
    inner: cx + s * (both ? 2.4 * rb : -halfW + 1.3 * rb),
    end: cx + s * (halfW - 1.3 * rb),
  });
  const span = (f: (x: ReturnType<typeof xs>) => number) =>
    Math.max(0, ...sides.map((s) => Math.abs(f(xs(s)))));
  const longest = span((x) => x.inner - x.out);
  const endLen = span((x) => x.end - x.out);

  // Rails from the top down: the top rail just under the tubes' heads, the last one no lower
  // than `railBottom`, the jar hanging under its end.
  const yTop = o.top - head0 * rb;
  const avail = yTop - o.railBottom;
  const maxDrop = (o.maxDrop ?? DROP.max) * rb;
  const zig = endLen + 2 * longest;
  let rails: 1 | 3 = 1;
  let slope: number;
  let drop = 0;
  if (avail >= SLOPE.min * zig + 2 * DROP.min * rb) {
    rails = 3;
    slope = Math.min(SLOPE.mid, Math.max(SLOPE.min, (avail - 2 * DROP.min * rb) / zig));
    drop = Math.min(maxDrop, Math.max(DROP.min * rb, (avail - slope * zig) / 2));
  } else {
    slope = Math.max(0.012, Math.min(SLOPE.max, avail / Math.max(1e-6, endLen)));
  }
  const used = rails === 3 ? slope * zig + 2 * drop : slope * endLen;
  const yEnd = yTop - used;
  const above = rb * 1.6;
  const mouth = yEnd - above;
  const bottom = mouth - size.h;

  const paths = sides.map((s) => {
    const x = xs(s);
    if (rails === 1) {
      return makePath(
        s,
        [
          { x: x.out, y: yTop },
          { x: x.end, y: yEnd },
        ],
        [false],
      );
    }
    const lenA = Math.abs(x.inner - x.out);
    const lenC = Math.abs(x.end - x.out);
    const a0 = yTop;
    const a1 = a0 - slope * lenA;
    const b0 = a1 - drop;
    const b1 = b0 - slope * lenA;
    const c0 = b1 - drop;
    return makePath(
      s,
      [
        { x: x.out, y: a0 },
        { x: x.inner, y: a1 },
        { x: x.inner, y: b0 },
        { x: x.out, y: b1 },
        { x: x.out, y: c0 },
        { x: x.end, y: c0 - slope * lenC },
      ],
      [false, true, false, true, false],
    );
  });

  const tubeRb = rb * (o.tubeScale ?? 1);
  return {
    rb,
    tubeRb,
    tubeR: tubeRb * 1.28,
    railR: rb * 0.2,
    rails,
    jar: {
      cx,
      bottom,
      w: size.w,
      h: size.h,
      mouth,
      perRow,
      capacity,
      slots: jarSlots(cx, bottom, rb, capacity, perRow),
    },
    paths,
    floor: Math.min(o.jar.floor, bottom),
  };
};

/** Where a tube standing at `x` delivers onto a path's top rail: its arc length and the point. */
export const entryOn = (path: RunPath, x: number): { s: number; p: Point } => {
  const a = path.pts[0]!;
  const b = path.pts[1]!;
  const lo = Math.min(a.x, b.x);
  const hi = Math.max(a.x, b.x);
  const cx = Math.min(hi, Math.max(lo, x));
  const f = b.x === a.x ? 0 : (cx - a.x) / (b.x - a.x);
  const p = { x: cx, y: a.y + (b.y - a.y) * f };
  return { s: f * (path.cum[1] ?? 0), p };
};

/** The path for a tube at `x`: its own side's if there is one, else the other. */
export const pathFor = (plan: RunPlan, x: number): RunPath | null => {
  const side = x < plan.jar.cx ? -1 : 1;
  return plan.paths.find((p) => p.side === side) ?? plan.paths[0] ?? null;
};

/** The point at arc length `s` along a path, written into `out`. */
export const pointAt = (path: RunPath, s: number, out: Point): Point => {
  const { pts, cum } = path;
  if (s <= 0) {
    out.x = pts[0]!.x;
    out.y = pts[0]!.y;
    return out;
  }
  for (let i = 1; i < pts.length; i++) {
    if (s <= cum[i]! || i === pts.length - 1) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const span = cum[i]! - cum[i - 1]!;
      const f = span > 0 ? Math.min(1, (s - cum[i - 1]!) / span) : 1;
      out.x = a.x + (b.x - a.x) * f;
      out.y = a.y + (b.y - a.y) * f;
      return out;
    }
  }
  return out;
};

/** Which segment arc length `s` falls in. */
export const segmentAt = (path: RunPath, s: number): number => {
  for (let i = 1; i < path.cum.length; i++) if (s < path.cum[i]!) return i - 1;
  return path.cum.length - 2;
};

/** A tube's top (where the ball waits to hop out) for a tube at `x` feeding `path`. */
export const tubeTop = (plan: RunPlan, path: RunPath, x: number): number =>
  entryOn(path, x).p.y + TUBE_HEAD * plan.rb;
