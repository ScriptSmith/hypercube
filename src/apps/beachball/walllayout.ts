/**
 * Where things go on a wall, in metres: x from the left edge, y up from the bottom edge. The
 * balls rest on the sand low enough for a child to reach their tops, the sea and the horizon
 * sit above them, and the sky fills the rest.
 */
import { activeVenue } from "../../core/venue";
import type { Reach } from "../../core/types";
import { UMBRELLA_RADIUS, UMBRELLA_RIM, UMBRELLA_TOP, type UmbrellaLayout } from "./wallumbrella";

/** Venue px per metre on the venue's wall. */
export const pxPerM = (): number => {
  const wall = activeVenue().wall;
  return wall.width / wall.widthM;
};

export const MAX_BALLS = 3;
/** Distance from the viewer's eye to the wall, metres, for the ground's perspective. */
export const EYE_DISTANCE = 3;
/** A big beach ball, and the smallest one that still makes a large target. */
export const BALL_RADIUS = 0.45;
export const MIN_RADIUS = 0.26;
/** Share of a child's reach the top of a resting ball may come to. */
const CHILD_SHARE = 0.88;
/** The net's top as a share of an adult's reach, so people either side can bat a ball over. */
export const NET_SHARE = 0.75;
/** Share of the net's height that is mesh, and the most mesh there is, metres. */
const NET_MESH = 0.55;
const NET_MESH_MAX = 0.95;
export const NET_RADIUS = 0.04;
/** Room kept clear round each resting ball, the net, the umbrella's pole and the wall's ends. */
const CLEAR = { ball: 0.35, net: 0.4, pole: 0.3, end: 0.25 };
/** The umbrella's pole stands this far in from the left end, past its canopy's edge. */
const UMBRELLA_IN = 0.35;

export interface NetLayout {
  x: number;
  /** Top of the tape, and the bottom of the mesh. */
  top: number;
  bottom: number;
  radius: number;
}

/** How far a toy reaches left and right of its centre as it is put out. */
export interface PropFit {
  left: number;
  right: number;
}

export interface WallLayoutOptions {
  net?: boolean;
  props?: readonly PropFit[];
  umbrella?: boolean;
  /** Find the crab a stretch of open sand to start on. */
  crab?: boolean;
}

export interface WallLayout {
  width: number;
  height: number;
  /** The sand line the balls rest on. */
  floor: number;
  radius: number;
  /** Tops of child and adult reach. */
  childTop: number;
  adultTop: number;
  /** Where the sea's wash normally reaches up to, and the horizon. */
  shore: number;
  horizon: number;
  /** Each ball's resting place along the sand. */
  rest: number[];
  net: NetLayout | null;
  /** Each toy's resting place, in the order given. */
  props: number[];
  umbrella: UmbrellaLayout | null;
  /** Where the crab starts, in the middle of the widest open stretch of sand. */
  crab: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const ballCount = (value: unknown): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? clamp(n, 1, MAX_BALLS) : 2;
};

export const wallLayout = (
  venueWidth: number,
  venueHeight: number,
  reach: Reach,
  balls: number,
  options: WallLayoutOptions = {},
): WallLayout => {
  const scale = pxPerM();
  const width = venueWidth / scale;
  const height = venueHeight / scale;
  const floor = clamp(0.03 * height, 0.08, 0.2);
  const childTop = clamp(reach.child, 0, 1) * height;
  const adultTop = Math.max(childTop, clamp(reach.adult, 0, 1) * height);
  const n = ballCount(balls);
  const room = width / (2.5 * n);
  const radius = clamp(
    (CHILD_SHARE * childTop - floor) / 2,
    MIN_RADIUS,
    Math.min(BALL_RADIUS, room),
  );
  const shore = Math.max(0.2 * height, floor + 2 * radius + 0.08);
  const horizon = Math.min(0.75 * height, Math.max(shore + 0.55, 0.36 * height));
  let net: NetLayout | null = null;
  let rest: number[];
  if (options.net) {
    const top = clamp(
      NET_SHARE * adultTop,
      floor + 2 * radius + 0.25,
      Math.max(adultTop - 0.1, floor + 2 * radius + 0.25),
    );
    const mesh = Math.min(NET_MESH_MAX, NET_MESH * (top - floor));
    net = { x: width / 2, top, bottom: top - mesh, radius: NET_RADIUS };
    // Half the balls each side of the net, the odd one on the left.
    const left = Math.ceil(n / 2);
    const right = n - left;
    const half = width / 2;
    rest = [
      ...Array.from({ length: left }, (_, i) => ((i + 0.5) / left) * half),
      ...Array.from({ length: right }, (_, i) => half + ((i + 0.5) / right) * half),
    ];
  } else {
    rest = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * width);
  }
  let umbrella: UmbrellaLayout | null = null;
  if (options.umbrella) {
    const x = Math.min(UMBRELLA_RADIUS + UMBRELLA_IN, 0.2 * width);
    // A shorter pole where adults reach less high, keeping the rim above a child's reach.
    const reachable = Math.max(adultTop, childTop + (UMBRELLA_TOP - UMBRELLA_RIM) + 0.05);
    const top = Math.min(floor + UMBRELLA_TOP, height - 0.3, reachable);
    umbrella = { x, rim: top - (UMBRELLA_TOP - UMBRELLA_RIM), top, radius: UMBRELLA_RADIUS };
    // A ball that would rest against the pole moves along to the right of it.
    const clear = radius + CLEAR.pole + 0.05;
    rest = rest.map((r) => (Math.abs(r - x) < clear ? x + clear : r));
  }
  const blocks: (readonly [number, number])[] = [
    ...rest.map((x) => [x - radius - CLEAR.ball, x + radius + CLEAR.ball] as const),
    ...(net ? [[net.x - CLEAR.net, net.x + CLEAR.net] as const] : []),
    ...(umbrella ? [[umbrella.x - CLEAR.pole, umbrella.x + CLEAR.pole] as const] : []),
  ];
  const fits = options.props ?? [];
  const props = placeProps(width, blocks, fits);
  let crab: number | null = null;
  if (options.crab) {
    const taken = [
      ...blocks,
      ...props.map((x, i) => [x + fits[i]!.left, x + fits[i]!.right] as const),
    ];
    const gaps = gapsOf(width, taken);
    let best = gaps[0] ?? { lo: 0, hi: width };
    for (const g of gaps) if (g.hi - g.lo > best.hi - best.lo) best = g;
    crab = (best.lo + best.hi) / 2;
  }
  return {
    width,
    height,
    floor,
    radius,
    childTop,
    adultTop,
    shore,
    horizon,
    rest,
    net,
    props,
    umbrella,
    crab,
  };
};

/** The open stretches of sand between blocked spans, keeping clear of the wall's ends. */
const gapsOf = (width: number, blocks: readonly (readonly [number, number])[]) => {
  const sorted = [...blocks].sort((a, b) => a[0] - b[0]);
  const gaps: { lo: number; hi: number }[] = [];
  let lo = CLEAR.end;
  for (const [a, b] of sorted) {
    if (a > lo) gaps.push({ lo, hi: a });
    lo = Math.max(lo, b);
  }
  if (width - CLEAR.end > lo) gaps.push({ lo, hi: width - CLEAR.end });
  return gaps;
};

/**
 * Toys go in the gaps along the sand between the balls, the net and the ends, each in the gap
 * with the most room left, then spread evenly within their gaps in the order given.
 */
const placeProps = (
  width: number,
  blocks: readonly (readonly [number, number])[],
  fits: readonly PropFit[],
): number[] => {
  if (fits.length === 0) return [];
  const gaps = gapsOf(width, blocks).map((g) => ({ ...g, items: [] as number[] }));
  if (gaps.length === 0) gaps.push({ lo: 0, hi: width, items: [] });
  const widthOf = (i: number) => fits[i]!.right - fits[i]!.left;
  const room = (g: (typeof gaps)[number]) =>
    g.hi - g.lo - g.items.reduce((s, i) => s + widthOf(i), 0) - CLEAR.end * g.items.length;
  fits.forEach((_, i) => {
    let best = gaps[0]!;
    for (const g of gaps) if (room(g) - widthOf(i) > room(best) - widthOf(i) + 1e-9) best = g;
    best.items.push(i);
  });
  const out = fits.map(() => width / 2);
  for (const g of gaps) {
    if (g.items.length === 0) continue;
    const used = g.items.reduce((s, i) => s + widthOf(i), 0);
    const space = Math.max(0, g.hi - g.lo - used) / (g.items.length + 1);
    let x = g.lo + space;
    for (const i of g.items) {
      out[i] = x - fits[i]!.left;
      x += widthOf(i) + space;
    }
  }
  return out;
};

export interface Shadow {
  x: number;
  y: number;
  /** Outer half-width and half-height, metres on the wall. */
  hx: number;
  hy: number;
  /** Share of the outer size that fades out. */
  soft: number;
  alpha: number;
}

/**
 * A ball's shadow on the sand, as it looks on the wall. The sand is drawn as seen from standing
 * height, receding to the horizon, and the balls sit on it just behind the wall. With the sun
 * nearly overhead the shadow lies under the ball, slightly to the right and further back; the
 * higher the ball, the larger, fainter and softer it is, so it sharpens as the ball comes down.
 * `sun` points towards the sun.
 */
export const ballShadow = (
  x: number,
  y: number,
  r: number,
  floor: number,
  horizon: number,
  sun: readonly [number, number, number],
): Shadow => {
  const h = Math.max(0, y - r - floor);
  const c = r + h;
  const e = horizon;
  const d = EYE_DISTANCE;
  // How far behind the wall the balls' line of sand lies, and the shadow's place on the sand.
  const z0 = (floor * d) / Math.max(1e-3, e - floor);
  // A low sun in front of the people would put the shadow in front of the wall: keep it on it.
  const zs = Math.max(0.03, z0 + (sun[2] / sun[1]) * c);
  const sx = x - (sun[0] / sun[1]) * c;
  const sy = (e * zs) / (d + zs);
  const shrink = (d + z0) / (d + zs);
  const soft = clamp(0.25 + 0.22 * h, 0.25, 0.85);
  const hx = r * shrink * (1 + 0.08 * h) * (1 + 0.5 * soft);
  return { x: sx, y: sy, hx, hy: (hx * e) / (d + zs), soft, alpha: 0.5 / (1 + 0.8 * h) };
};
