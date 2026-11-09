/**
 * Where things go on each frame, in venue px: the road and how ring metres map onto it, the
 * time-space diagram, and the controls.
 *
 * - A bank stretch (panel or pair): a straight road across the frame low down, cars driving left
 *   to right; the frame shows its share of the ring, so the last frame's road runs on into the
 *   first's. The diagram of that stretch sits on the road, the controls above it.
 * - A wall: the same with the whole ring, cars leaving the right edge coming back on the left,
 *   the diagram filling the upper wall and the controls on plates in the adults' band.
 * - A panel or pair on its own: one frame is too short for a ring that jams (a car needs about
 *   four car lengths of road at speed), so the road is a loop low on the frame and the diagram
 *   shows the ring unrolled above it.
 * - A screen: the diagram of the whole ring across the bank, and a strip of road at its foot.
 *
 * With the `road` option set to circle, a frame that runs a ring of its own draws it as a circle
 * instead, with the diagram (the ring unrolled) and the controls beside it, and the screen draws
 * the bank's ring as a circle above its diagram. Bank stretches stay straight, and a lone pair
 * keeps its loop, which already spans both halves. Round a circle, ring fraction 0 is at the top
 * and cars go anticlockwise, so along the bottom, where children reach, they drive left to right,
 * and the middle of the diagram is the bottom of the circle.
 */
import type { FrameKind, Rect } from "../../core/types";
import { CAR_PX, CAR_W, type RoadShape, SNAP_PX } from "./config";
import { CAR_LENGTH } from "./model";

/** Venue px per metre for a car CAR_PX long. */
export const PX_PER_M = CAR_PX / CAR_LENGTH;

export interface Placement {
  /** Car centre, venue px, and heading (radians, 0 to the right). */
  x: number;
  y: number;
  angle: number;
}

export interface RoadPath {
  readonly kind: "line" | "loop" | "circle";
  /** Venue px per ring metre along the road. */
  pxPerM(length: number): number;
  /**
   * Where a car whose rear bumper is at ring metre `x` is drawn, on a ring of `length` metres:
   * none, one or two placements (two near the edges of a road that wraps across one frame).
   */
  place(x: number, length: number, out: Placement[]): number;
}

export interface LoopShape {
  /** Centres of the two end arcs, their radius and the straights' y, venue px. */
  xl: number;
  xr: number;
  yc: number;
  r: number;
}

export interface CircleShape {
  /** Centre and radius of the lane, venue px. */
  cx: number;
  cy: number;
  r: number;
  /**
   * The road's width scale, venue px, as the loop's: the asphalt is 1.5 times this wide and the
   * kerbs reach LANE_KERB of it either side of the lane.
   */
  lane: number;
  /** Venue px per ring metre when this frame runs a ring of its own (unused on a screen). */
  pxPerM: number;
}

/** How far a circle's kerbs reach either side of its lane, as a share of `lane`. */
export const LANE_KERB = 0.81;

export type ControlKey = "cars" | "limit" | "smart";

export interface ControlGroup {
  key: ControlKey;
  /** The group's plate, title above its buttons. */
  plate: Rect;
  title: { x: number; y: number; size: number };
  /** Cars: minus, count, plus. Limit: one per sign. Smart: one per share. */
  cells: Rect[];
}

export interface FrameLayout {
  kind: "stretch" | "wall" | "loop" | "screen";
  width: number;
  height: number;
  /** The road band (asphalt), venue px. For a loop, its bounding box. */
  road: Rect;
  laneY: number;
  loop: LoopShape | null;
  circle: CircleShape | null;
  /** Grass to paint behind a circle. */
  ground: Rect | null;
  path: RoadPath | null;
  /** The diagram's place, and which ring metres its x covers ([m0, m0 + span), by fraction). */
  diagram: Rect;
  /** Seconds of history the diagram holds. */
  history: number;
  controls: ControlGroup[];
  /** Plates that sit over the diagram rather than beside it. */
  overlay: boolean;
  /** Versus: the children's slowdown buttons, and the scoreboard. */
  slowdowns: Rect[];
  board: Rect | null;
  carPx: number;
  carW: number;
  /** Where a bank frame sits: its share of the ring. */
  slice: { pos: number; count: number };
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  /** Stage y of the top of adult and child reach, venue px. */
  reachTop: { adult: number; child: number };
  seams: number[];
  bank: { pos: number; count: number } | null;
  /** Versus walls have no cars buttons; the child band holds slowdown buttons instead. */
  versus: boolean;
  /** Straight when absent. Bank stretches are always straight. */
  road?: RoadShape;
}

const wrapM = (v: number, L: number) => ((v % L) + L) % L;

/** A straight road: the frame shows ring metres [f0, f1) as fractions of the ring. */
const linePath = (width: number, laneY: number, f0: number, f1: number, pad: number): RoadPath => ({
  kind: "line",
  pxPerM: (L) => width / Math.max(1e-6, (f1 - f0) * L),
  place(x, L, out) {
    out.length = 0;
    const span = (f1 - f0) * L;
    const k = width / Math.max(1e-6, span);
    const d = wrapM(x + CAR_LENGTH / 2 - f0 * L, L);
    for (const dd of [d - L, d, d + L]) {
      const px = dd * k;
      if (px + pad >= 0 && px - pad <= width) out.push({ x: px, y: laneY, angle: 0 });
    }
    return out.length;
  },
});

export const loopLength = (s: LoopShape): number => 2 * (s.xr - s.xl) + 2 * Math.PI * s.r;

/** A point a distance `s` venue px round the loop, counter-clockwise from the bottom left. */
export const loopPoint = (shape: LoopShape, s: number, out: Placement): Placement => {
  const { xl, xr, yc, r } = shape;
  const S = xr - xl;
  const P = loopLength(shape);
  let d = ((s % P) + P) % P;
  if (d < S) {
    out.x = xl + d;
    out.y = yc + r;
    out.angle = 0;
    return out;
  }
  d -= S;
  if (d < Math.PI * r) {
    const t = d / r;
    out.x = xr + r * Math.sin(t);
    out.y = yc + r * Math.cos(t);
    out.angle = -t;
    return out;
  }
  d -= Math.PI * r;
  if (d < S) {
    out.x = xr - d;
    out.y = yc - r;
    out.angle = Math.PI;
    return out;
  }
  d -= S;
  const t = d / r;
  out.x = xl - r * Math.sin(t);
  out.y = yc - r * Math.cos(t);
  out.angle = Math.PI - t;
  return out;
};

const loopPath = (shape: LoopShape): RoadPath => {
  const P = loopLength(shape);
  return {
    kind: "loop",
    pxPerM: (L) => P / Math.max(1e-6, L),
    place(x, L, out) {
      out.length = 0;
      const p = { x: 0, y: 0, angle: 0 };
      loopPoint(shape, ((x + CAR_LENGTH / 2) / L) * P, p);
      out.push(p);
      return 1;
    },
  };
};

export const circleLength = (s: CircleShape): number => 2 * Math.PI * s.r;

/** The point a fraction `f` round the circle from the top, anticlockwise on screen. */
export const circlePoint = (shape: CircleShape, f: number, out: Placement): Placement => {
  const t = 2 * Math.PI * (f - Math.floor(f)) - Math.PI;
  out.x = shape.cx + shape.r * Math.sin(t);
  out.y = shape.cy + shape.r * Math.cos(t);
  out.angle = -t;
  return out;
};

const circlePath = (shape: CircleShape): RoadPath => ({
  kind: "circle",
  pxPerM: (L) => circleLength(shape) / Math.max(1e-6, L),
  place(x, L, out) {
    out.length = 0;
    out.push(
      circlePoint(shape, (x + CAR_LENGTH / 2) / Math.max(1e-6, L), { x: 0, y: 0, angle: 0 }),
    );
    return 1;
  },
});

/**
 * The car drawn nearest (x, y), venue px, within `snap` of its body, or null. On a circle the
 * distance runs along the arc and across the lane, so a touch snaps to the car nearest it round
 * the road; elsewhere it is measured from each car's body as drawn.
 */
export const carNear = (
  drawn: readonly { id: number; x: number; y: number; angle: number }[],
  x: number,
  y: number,
  carPx: number,
  carW: number,
  circle: CircleShape | null,
  snap = SNAP_PX,
): number | null => {
  let best: number | null = null;
  let dist = snap;
  const rho = circle ? Math.hypot(x - circle.cx, y - circle.cy) : 0;
  const phi = circle ? Math.atan2(y - circle.cy, x - circle.cx) : 0;
  for (const c of drawn) {
    let along: number;
    let across: number;
    if (circle) {
      const rc = Math.hypot(c.x - circle.cx, c.y - circle.cy);
      let dphi = Math.abs(phi - Math.atan2(c.y - circle.cy, c.x - circle.cx));
      if (dphi > Math.PI) dphi = 2 * Math.PI - dphi;
      along = dphi * rc;
      across = Math.abs(rho - rc);
    } else {
      const dx = x - c.x;
      const dy = y - c.y;
      const ca = Math.cos(c.angle);
      const sa = Math.sin(c.angle);
      along = Math.abs(dx * ca + dy * sa);
      across = Math.abs(-dx * sa + dy * ca);
    }
    const d = Math.hypot(Math.max(0, along - carPx / 2), Math.max(0, across - carW / 2));
    if (d < dist) {
      dist = d;
      best = c.id;
    }
  }
  return best;
};

/** Lay groups out left to right in a row starting at `x`, `cell` px buttons. */
const groupAt = (
  key: ControlKey,
  x: number,
  y: number,
  cell: number,
  gap: number,
  title: number,
): ControlGroup => {
  const n = key === "cars" ? 3 : key === "limit" ? 3 : 4;
  const pad = Math.round(cell * 0.12);
  const cells: Rect[] = [];
  let cx = x + pad;
  const top = y + pad + title;
  for (let i = 0; i < n; i++) {
    // The middle of the cars group only shows the count.
    const w = key === "cars" && i === 1 ? Math.round(cell * 0.62) : cell;
    cells.push({ x: cx, y: top, width: w, height: cell });
    cx += w + gap;
  }
  const width = cx - gap + pad - x;
  return {
    key,
    plate: { x, y, width, height: title + cell + pad * 2 },
    title: { x: x + pad, y: y + pad + title * 0.62, size: title * 0.62 },
    cells,
  };
};

export const groupWidth = (key: ControlKey, cell: number, gap: number): number => {
  const g = groupAt(key, 0, 0, cell, gap, 0);
  return g.plate.width;
};

const shift = (g: ControlGroup, dx: number): ControlGroup => ({
  ...g,
  plate: { ...g.plate, x: g.plate.x + dx },
  title: { ...g.title, x: g.title.x + dx },
  cells: g.cells.map((c) => ({ ...c, x: c.x + dx })),
});

/** Ring metres a bank frame of this many venue px wide holds. */
export const stretchMetres = (width: number): number => width / PX_PER_M;

/** The loop for a lone panel or pair: as long as the frame is wide, low on the frame. */
const soloLoop = (width: number, height: number): LoopShape => {
  const r = 170;
  const margin = 50 + CAR_W;
  const yc = height - 225 - r;
  return { xl: margin + r, xr: width - margin - r, yc, r };
};

/** Venue px per ring metre on the wall's circle: about 16 cars at `many`, enough to jam alone. */
export const WALL_CIRCLE_PX_PER_M = 21.5;

export const ringLengthFor = (input: LayoutInput): number => {
  const l = frameLayout(input);
  if (l.circle) return circleLength(l.circle) / l.circle.pxPerM;
  if (l.loop) return loopLength(l.loop) / PX_PER_M;
  if (l.kind === "wall") return (l.width / l.carPx) * CAR_LENGTH;
  return stretchMetres(l.width) * l.slice.count;
};

export const frameLayout = (input: LayoutInput): FrameLayout => {
  const { kind, width: W, height: H } = input;
  const circular = input.road === "circle";
  if (kind === "screen" && circular) return screenCircle(input);
  if (kind === "wall" && circular) return wallCircle(input);
  if (kind === "screen") {
    const strip = Math.round(H * 0.035);
    return {
      kind: "screen",
      width: W,
      height: H,
      road: { x: 0, y: H - strip, width: W, height: strip },
      laneY: H - strip / 2,
      loop: null,
      circle: null,
      ground: null,
      path: null,
      diagram: { x: 0, y: 0, width: W, height: H - strip },
      history: 120,
      controls: [],
      overlay: false,
      slowdowns: [],
      board: null,
      carPx: 0,
      carW: 0,
      slice: input.bank ?? { pos: 0, count: 1 },
    };
  }

  if (kind === "wall") {
    const carPx = 130;
    const carW = 64;
    const laneY = Math.round(H - Math.min(H * 0.11, input.versus ? 230 : 290));
    const road = { x: 0, y: laneY - 95, width: W, height: 190 };
    const cell = 200;
    const gap = 24;
    const title = 62;
    const adultTop = Math.max(0, input.reachTop.adult);
    const childTop = Math.max(adultTop + 1, input.reachTop.child);
    // Plates sit in the adults' band, above the children's, centred in what is left.
    const plateH = title + cell + Math.round(cell * 0.14) * 2;
    const room = childTop - adultTop;
    const y = Math.round(room >= plateH ? adultTop + (room - plateH) / 2 : childTop - plateH);
    const keys: ControlKey[] = input.versus ? ["limit", "smart"] : ["cars", "limit", "smart"];
    const centres = input.versus ? [W * 0.3, W * 0.7] : [W * 0.17, W * 0.5, W * 0.83];
    const controls = keys.map((key, i) => {
      const g = groupAt(key, 0, y, cell, gap, title);
      return shift(g, Math.round(centres[i]! - g.plate.width / 2));
    });
    // Versus: big slowdown buttons in the children's band, between their reach and the road.
    const slowdowns: Rect[] = [];
    let board: Rect | null = null;
    if (input.versus) {
      const size = Math.max(200, Math.min(250, road.y - childTop - 30));
      const top = Math.round(Math.max(childTop + 10, road.y - size - 20));
      for (const f of [0.1, 0.36, 0.64, 0.9]) {
        slowdowns.push({ x: Math.round(W * f - size / 2), y: top, width: size, height: size });
      }
      board = { x: Math.round(W / 2 - 900), y: 40, width: 1800, height: 330 };
    }
    return {
      kind: "wall",
      width: W,
      height: H,
      road,
      laneY,
      loop: null,
      circle: null,
      ground: null,
      path: linePath(W, laneY, 0, 1, carPx),
      diagram: { x: 0, y: 0, width: W, height: road.y },
      history: 40,
      controls,
      overlay: true,
      slowdowns,
      board,
      carPx,
      carW,
      slice: { pos: 0, count: 1 },
    };
  }

  // Panels and pairs.
  const pair = kind === "pair";
  const cell = pair ? 140 : 150;
  const gap = pair ? 8 : 16;
  const title = 56;
  const controls: ControlGroup[] = [];
  const top = 34;
  if (pair) {
    // Each half keeps clear of the seam by at least 120 venue px.
    const seam = input.seams[0] ?? W / 2;
    const leftEnd = seam - 130;
    const rightStart = seam + 130;
    const cars = groupAt("cars", 40, top, cell, gap, title);
    const limit = groupAt("limit", 0, top, cell, gap, title);
    controls.push(cars, shift(limit, leftEnd - limit.plate.width));
    const smart = groupAt("smart", 0, top, cell, gap, title);
    controls.push(shift(smart, Math.round((rightStart + W - 40) / 2 - smart.plate.width / 2)));
  } else {
    const cars = groupAt("cars", 36, top, cell, gap, title);
    const limit = groupAt("limit", 0, top, cell, gap, title);
    controls.push(cars, shift(limit, W - 36 - limit.plate.width));
    const row2 = top + cars.plate.height + 22;
    const smart = groupAt("smart", 0, row2, cell, gap, title);
    controls.push(shift(smart, Math.round(W / 2 - smart.plate.width / 2)));
  }
  const controlsBottom = Math.max(...controls.map((g) => g.plate.y + g.plate.height));

  if (input.bank) {
    // A quarter of the way up the frame, in the children's band.
    const laneY = Math.round(H * 0.775);
    const road = { x: 0, y: laneY - 90, width: W, height: 180 };
    const { pos, count } = input.bank;
    const n = Math.max(1, count);
    return {
      kind: "stretch",
      width: W,
      height: H,
      road,
      laneY,
      loop: null,
      circle: null,
      ground: null,
      path: linePath(W, laneY, pos / n, (pos + 1) / n, CAR_PX),
      diagram: { x: 0, y: controlsBottom + 24, width: W, height: road.y - controlsBottom - 24 },
      history: 14,
      controls,
      overlay: false,
      slowdowns: [],
      board: null,
      carPx: CAR_PX,
      carW: CAR_W,
      slice: { pos, count: n },
    };
  }

  if (circular && !pair) return loneCircle(input, controls, controlsBottom);

  const loop = soloLoop(W, H);
  const road = {
    x: loop.xl - loop.r - 90,
    y: loop.yc - loop.r - 90,
    width: loop.xr - loop.xl + 2 * loop.r + 180,
    height: 2 * loop.r + 180,
  };
  return {
    kind: "loop",
    width: W,
    height: H,
    road,
    laneY: loop.yc + loop.r,
    loop,
    circle: null,
    ground: null,
    path: loopPath(loop),
    diagram: { x: 0, y: controlsBottom + 24, width: W, height: road.y - controlsBottom - 40 },
    history: 30,
    controls,
    overlay: false,
    slowdowns: [],
    board: null,
    carPx: CAR_PX,
    carW: CAR_W,
    slice: { pos: 0, count: 1 },
  };
};

/** The asphalt's bounding box round a circle. */
const circleBox = (c: CircleShape): Rect => {
  const out = c.r + c.lane * LANE_KERB;
  return { x: c.cx - out, y: c.cy - out, width: out * 2, height: out * 2 };
};

/**
 * A wall's circle: as big as it can be with its centre no higher than the top of adult reach,
 * so every car comes down through reach on its lower half and passes along the bottom in the
 * children's band; the top is for watching. It sits at the left. To its right the diagram (the
 * ring unrolled) fills the wall's height, with the adults' plates over it in their band, and in
 * versus the slowdown buttons over it in the children's band and the board at the top.
 */
const wallCircle = (input: LayoutInput): FrameLayout => {
  const { width: W, height: H } = input;
  const carPx = 110;
  const carW = 55;
  const lane = carW * 1.5;
  const kerb = lane * LANE_KERB;
  const adultTop = Math.max(0, input.reachTop.adult);
  const childTop = Math.max(adultTop + 1, input.reachTop.child);
  const below = 170;
  const bottom = H - below;
  const r = Math.floor(
    Math.max(300, Math.min(bottom - adultTop, (bottom - kerb - 40) / 2, W * 0.2)),
  );
  const circle: CircleShape = {
    cx: below + r,
    cy: bottom - r,
    r,
    lane,
    pxPerM: WALL_CIRCLE_PX_PER_M,
  };
  const x0 = Math.round(circle.cx + r + kerb + 140);
  const x1 = W - 60;
  const span = Math.max(1, x1 - x0);

  const cell = 200;
  const gap = 24;
  const title = 62;
  const plateH = title + cell + Math.round(cell * 0.14) * 2;
  const room = childTop - adultTop;
  const y = Math.round(room >= plateH ? adultTop + (room - plateH) / 2 : childTop - plateH);
  const keys: ControlKey[] = input.versus ? ["limit", "smart"] : ["cars", "limit", "smart"];
  const at = input.versus ? [0.3, 0.7] : [1 / 6, 1 / 2, 5 / 6];
  const controls = keys.map((key, i) => {
    const g = groupAt(key, 0, y, cell, gap, title);
    return shift(g, Math.round(x0 + span * at[i]! - g.plate.width / 2));
  });

  const slowdowns: Rect[] = [];
  let board: Rect | null = null;
  let top = 60;
  if (input.versus) {
    const size = Math.max(200, Math.min(250, H - 40 - childTop - 30));
    const sy = Math.round(Math.max(childTop + 10, H - size - 150));
    for (const f of [0.125, 0.375, 0.625, 0.875]) {
      slowdowns.push({ x: Math.round(x0 + span * f - size / 2), y: sy, width: size, height: size });
    }
    board = { x: Math.round(x0 + span / 2 - 900), y: 40, width: 1800, height: 330 };
    top = board.y + board.height + 40;
  }
  return {
    kind: "wall",
    width: W,
    height: H,
    road: circleBox(circle),
    laneY: circle.cy + r,
    loop: null,
    circle,
    ground: { x: 0, y: 0, width: x0 - 70, height: H },
    path: circlePath(circle),
    diagram: { x: x0, y: top, width: span, height: Math.max(64, H - 60 - top) },
    history: 40,
    controls,
    overlay: true,
    slowdowns,
    board,
    carPx,
    carW,
    slice: { pos: 0, count: 1 },
  };
};

/** Least height for a lone panel's diagram between its controls and its circle. */
const PANEL_DIAGRAM_MIN = 300;

/**
 * A lone panel's circle: low on the frame and as wide as it fits, under a diagram that keeps
 * at least PANEL_DIAGRAM_MIN.
 */
const loneCircle = (
  input: LayoutInput,
  controls: ControlGroup[],
  controlsBottom: number,
): FrameLayout => {
  const { width: W, height: H } = input;
  const lane = CAR_W * 1.5;
  const kerb = lane * LANE_KERB;
  const bottom = H - 160;
  const top = controlsBottom + 24;
  // The lane's leftmost point, leaving the kerb and a margin inside the frame (as the loop does).
  const edge = 50 + CAR_W;
  const r = Math.min((W - 2 * edge) / 2, (bottom - top - PANEL_DIAGRAM_MIN - 40 - kerb) / 2);
  const circle: CircleShape = { cx: W / 2, cy: bottom - r, r, lane, pxPerM: PX_PER_M };
  const end = circle.cy - r - kerb - 40;
  const diagram: Rect = { x: 0, y: top, width: W, height: end - top };
  const ground: Rect = { x: 0, y: end, width: W, height: H - end };
  return {
    kind: "loop",
    width: W,
    height: H,
    road: circleBox(circle),
    laneY: circle.cy + circle.r,
    loop: null,
    circle,
    ground,
    path: circlePath(circle),
    diagram,
    history: 30,
    controls,
    overlay: false,
    slowdowns: [],
    board: null,
    carPx: CAR_PX,
    carW: CAR_W,
    slice: { pos: 0, count: 1 },
  };
};

/**
 * A screen's circle: the bank's whole ring seen from above in the top part of the screen, the
 * diagram below it still lined up with the panels underneath, now at its foot.
 */
const screenCircle = (input: LayoutInput): FrameLayout => {
  const { width: W, height: H } = input;
  const band = Math.round(H * 0.5);
  const lane = Math.round(band * 0.022);
  const r = Math.round(band / 2 - lane * LANE_KERB - 50);
  const circle: CircleShape = { cx: W / 2, cy: band / 2, r, lane, pxPerM: 0 };
  return {
    kind: "screen",
    width: W,
    height: H,
    road: circleBox(circle),
    laneY: circle.cy + r,
    loop: null,
    circle,
    ground: null,
    path: circlePath(circle),
    diagram: { x: 0, y: band, width: W, height: H - band },
    history: 120,
    controls: [],
    overlay: false,
    slowdowns: [],
    board: null,
    carPx: 0,
    carW: 0,
    slice: input.bank ?? { pos: 0, count: 1 },
  };
};
