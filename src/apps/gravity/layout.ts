/**
 * Where everything goes on each kind of frame, in the frame's venue px. Slingshots and their body
 * pickers sit in the children's band; the black-hole launcher, the time control and the scene
 * button in the adult band above it. On a pair every player's controls stay a fifth of the width
 * clear of the seam. The sky (where scenes sit) fills the rest. On a bank, lengths are "bank px":
 * the touch frames' venue px across the whole bank, with y = 0 at the frames' top edge and the
 * screen above it at negative y.
 */
import { activeVenue } from "../../core/venue";
import { PICKS, type Pick } from "./bodies";
import type { Sky } from "./scenes";
import { gm0Of } from "./scenes";

export type TouchKind = "wall" | "panel" | "pair" | "kiosk";

export interface PadSpot {
  index: number;
  /** Where the body rests. */
  x: number;
  y: number;
  /** Touches this close to the rest point take the slingshot. */
  grab: number;
  /** Longest pull, and the shortest that launches (less just cancels). */
  pull: number;
  minPull: number;
  color: number;
  /** Launch speeds at the shortest and longest pull, before the scene's speed scale. */
  vmin: number;
  vmax: number;
  /** Launches stay within this angle of straight up (radians). */
  spread: number;
}

export interface LauncherSpot {
  index: number;
  x: number;
  y: number;
  r: number;
  /** Velocity of the black holes it fires, before the scene's speed scale. */
  vx: number;
  vy: number;
}

export interface Btn {
  x: number;
  y: number;
  r: number;
}

export interface PickBtn extends Btn {
  pick: Pick;
}

export interface Layout {
  kind: TouchKind;
  w: number;
  h: number;
  pads: PadSpot[];
  /** The body picker beside each slingshot. */
  pickers: PickBtn[][];
  launchers: LauncherSpot[];
  slower: Btn;
  faster: Btn;
  /** Where the time factor is written, and its text height. */
  readout: { x: number; y: number; size: number };
  /** Switches between drawn and true sizes. */
  sizes: Btn;
  scene: Btn;
  /** The frame's own sky when it plays alone. */
  sky: Sky;
  /** Particle size, display px. */
  dot: number;
  maxBodies: number;
  dustCap: number;
  /** Top-left of the runtime's Home control. */
  home: { x: number; y: number };
}

/** Per-kind numbers. */
interface Tuning {
  grab: number;
  pull: number;
  spread: number;
  pickR: number;
  ctlR: number;
  launcherR: number;
  T0: number;
  boost: number;
  minR: number;
  dot: number;
}

const TUNING: Record<TouchKind, Tuning> = {
  wall: {
    grab: 200,
    pull: 400,
    spread: 1.25,
    pickR: 66,
    ctlR: 74,
    launcherR: 115,
    T0: 7,
    boost: 1.3,
    minR: 7,
    dot: 3.2,
  },
  panel: {
    grab: 165,
    pull: 300,
    spread: 0.95,
    pickR: 62,
    ctlR: 62,
    launcherR: 88,
    T0: 6,
    boost: 1.35,
    minR: 5,
    dot: 2.6,
  },
  pair: {
    grab: 165,
    pull: 300,
    spread: 1.05,
    pickR: 62,
    ctlR: 62,
    launcherR: 88,
    T0: 6,
    boost: 1.3,
    minR: 5,
    dot: 2.6,
  },
  kiosk: {
    grab: 140,
    pull: 250,
    spread: 1.2,
    pickR: 60,
    ctlR: 60,
    launcherR: 80,
    T0: 6,
    boost: 1.2,
    minR: 5,
    dot: 2.4,
  },
};

/** Launch speeds as shares of the escape speed from home at the pad: a half pull orbits. */
export const SPEED_MIN = 0.4;
export const SPEED_MAX = 1.1;
/** Black holes leave at this share of the escape speed where they start. */
const HOLE_SPEED = 0.75;

export const MAX_BODIES = { big: 48, small: 24 };
export const DUST_CAP = { big: 3000, small: 800 };

const grid = (cx: number, cy: number, r: number, gap: number): PickBtn[] => {
  const d = r + gap / 2;
  return PICKS.map((pick, i) => ({
    pick,
    x: cx + (i % 2 === 0 ? -d : d),
    y: cy + (i < 2 ? -d : d),
    r,
  }));
};

const escape = (gm: number, d: number) => Math.sqrt((2 * gm) / Math.max(1, d));

/** Throw speeds for a slingshot at (x, y) in a sky: shares of the escape speed from home. */
export const padSpeeds = (sky: Sky, x: number, y: number) => {
  const ve = escape(gm0Of(sky), Math.hypot(x - sky.cx, y - sky.cy));
  return { vmin: ve * SPEED_MIN, vmax: ve * SPEED_MAX };
};

/**
 * Give pads and launchers speeds for a sky: pads from a share of the escape speed from home at
 * the pad, launchers towards a point beside home. `ox`, `oy` place the frame in the sky's space.
 */
export const withSpeeds = (l: Layout, sky: Sky, ox = 0, oy = 0, straightUp = false): Layout => {
  const gm = gm0Of(sky);
  const pads = l.pads.map((p) => ({ ...p, ...padSpeeds(sky, p.x + ox, p.y + oy) }));
  const launchers = l.launchers.map((s) => {
    const x = s.x + ox;
    const y = s.y + oy;
    const v = escape(gm, Math.hypot(x - sky.cx, y - sky.cy)) * HOLE_SPEED;
    if (straightUp) return { ...s, vx: 0, vy: -v };
    const tx = sky.cx + (x < sky.cx ? -0.5 : 0.5) * sky.L;
    const dx = tx - x;
    const dy = sky.cy - y;
    const d = Math.hypot(dx, dy) || 1;
    return { ...s, vx: (dx / d) * v, vy: (dy / d) * v };
  });
  return { ...l, pads, launchers };
};

const pad = (t: Tuning, index: number, x: number, y: number, color: number): PadSpot => ({
  index,
  x,
  y,
  grab: t.grab,
  pull: t.pull,
  minPull: t.pull * 0.16,
  color,
  vmin: 0,
  vmax: 0,
  spread: t.spread,
});

const skyOf = (t: Tuning, w: number, h: number, cx: number, cy: number, L: number): Sky => ({
  cx,
  cy,
  L,
  T0: t.T0,
  boost: t.boost,
  minR: t.minR,
  view: { x0: 0, y0: 0, x1: w, y1: h },
});

export interface LayoutOptions {
  /** Slingshots on a wall: 4, 6 or 8. */
  pads?: number;
  /** First pad colour (a bank frame's position). */
  colorBase?: number;
}

/** A touch frame's layout, with speeds for its own sky. `w` and `h` are its venue size. */
export const layoutFor = (
  kind: TouchKind,
  w: number,
  h: number,
  opts: LayoutOptions = {},
): Layout => {
  const l = baseLayout(kind, w, h, opts);
  return withSpeeds(l, l.sky);
};

const baseLayout = (kind: TouchKind, w: number, h: number, opts: LayoutOptions): Layout => {
  const t = TUNING[kind];
  const c0 = opts.colorBase ?? 0;
  const big = kind === "wall";
  const common = {
    kind,
    w,
    h,
    dot: t.dot,
    maxBodies: big ? MAX_BODIES.big : MAX_BODIES.small,
    dustCap: big ? DUST_CAP.big : DUST_CAP.small,
  };
  const launcher = (index: number, x: number, y: number): LauncherSpot => ({
    index,
    x,
    y,
    r: t.launcherR,
    vx: 0,
    vy: 0,
  });
  if (kind === "wall") {
    const n = opts.pads === 4 || opts.pads === 8 ? opts.pads : 6;
    const cw = w / n;
    const gridW = 2 * (2 * t.pickR + 8);
    const unit = 2 * t.grab + 30 + gridW;
    const padY = h - t.pull - 50;
    const pads: PadSpot[] = [];
    const pickers: PickBtn[][] = [];
    for (let i = 0; i < n; i++) {
      const x = i * cw + (cw - unit) / 2 + t.grab;
      pads.push(pad(t, i, x, padY, (c0 + i) % 8));
      pickers.push(grid(x + t.grab + 30 + gridW / 2, padY + 5, t.pickR, 8));
    }
    const ly = h * 0.654;
    const lx = n === 6 ? [w / 3, (2 * w) / 3] : [w / 4, (3 * w) / 4];
    return {
      ...common,
      pads,
      pickers,
      launchers: lx.map((x, i) => launcher(i, x, ly)),
      slower: { x: w / 2 - 180, y: ly + 10, r: t.ctlR },
      faster: { x: w / 2 + 180, y: ly + 10, r: t.ctlR },
      readout: { x: w / 2, y: ly + 10, size: 64 },
      sizes: { x: w / 2 - 430, y: ly + 10, r: t.ctlR + 2 },
      scene: { x: w / 2 + 430, y: ly + 10, r: t.ctlR + 2 },
      sky: skyOf(t, w, h, w / 2, h * 0.354, h * 0.354),
      home: { x: 40, y: h * 0.58 },
    };
  }
  if (kind === "kiosk") {
    const padY = h - t.pull - 40;
    const pads = [pad(t, 0, w * 0.25, padY, c0 % 8), pad(t, 1, w * 0.75, padY, (c0 + 1) % 8)];
    const gx = t.grab + 2 * t.pickR + 20;
    const row = h - 95;
    return {
      ...common,
      pads,
      pickers: [grid(pads[0]!.x - gx, padY, t.pickR, 8), grid(pads[1]!.x + gx, padY, t.pickR, 8)],
      launchers: [launcher(0, w * 0.555, h - t.launcherR - 30)],
      slower: { x: w * 0.375, y: row, r: t.ctlR },
      faster: { x: w * 0.481, y: row, r: t.ctlR },
      readout: { x: w * 0.428, y: row, size: 46 },
      sizes: { x: w * 0.307, y: row, r: t.ctlR },
      scene: { x: w * 0.633, y: row, r: t.ctlR },
      sky: skyOf(t, w, h, w / 2, h * 0.343, h * 0.343),
      home: { x: 30, y: 30 },
    };
  }
  // Panels and pairs: the slingshot low with its picker above it, adult controls above that.
  const padY = h - t.pull - 50;
  const pickY = padY - t.grab - t.pickR * 2 - 30;
  const row = h * 0.42;
  const L = Math.min(w / 2, h * 0.27);
  if (kind === "pair") {
    // Players at the outer edges, all of their controls a fifth of the width clear of the seam.
    const pads = [pad(t, 0, w * 0.2, padY, c0 % 8), pad(t, 1, w * 0.8, padY, (c0 + 1) % 8)];
    return {
      ...common,
      pads,
      pickers: pads.map((p) => grid(p.x, pickY, t.pickR, 10)),
      launchers: [launcher(0, w * 0.107, row - 10), launcher(1, w * 0.893, row - 10)],
      slower: { x: w * 0.194, y: row, r: t.ctlR },
      faster: { x: w * 0.259, y: row, r: t.ctlR },
      readout: { x: w * 0.2265, y: row - 92, size: 46 },
      sizes: { x: w * 0.734, y: row, r: t.ctlR + 2 },
      scene: { x: w * 0.8, y: row, r: t.ctlR + 2 },
      sky: skyOf(t, w, h, w / 2, h * 0.28, L),
      home: { x: 24, y: h * 0.3 },
    };
  }
  const pads = [pad(t, 0, w / 2, padY, c0 % 8)];
  return {
    ...common,
    pads,
    pickers: [grid(w / 2, pickY, t.pickR, 10)],
    launchers: [launcher(0, w * 0.824, row - 10)],
    slower: { x: w * 0.074, y: row, r: t.ctlR },
    faster: { x: w * 0.272, y: row, r: t.ctlR },
    readout: { x: w * 0.173, y: row, size: 46 },
    sizes: { x: w * 0.407, y: row, r: t.ctlR + 2 },
    scene: { x: w * 0.537, y: row, r: t.ctlR + 2 },
    sky: skyOf(t, w, h, w / 2, h * 0.28, L),
    home: { x: 24, y: h * 0.3 },
  };
};

/**
 * A bank touch frame's layout: the panel or pair layout, with speeds for the screen's sky. Its
 * own sky is kept for when it plays alone.
 */
export const stationLayout = (
  kind: "panel" | "pair",
  w: number,
  h: number,
  colorBase: number,
  screenSky: Sky,
  offX: number,
): Layout => withSpeeds(baseLayout(kind, w, h, { colorBase }), screenSky, offX, 0, true);

/** The screen above a bank: the space in bank px, y from -H (top) to 0 (the frames' top edge). */
export const screenSize = (bankWidth: number, screenW: number, screenH: number) => ({
  W: bankWidth,
  H: (bankWidth * screenH) / screenW,
});

/** Bank px per pixel of the venue's screen, for a bank `W` bank px wide. */
const screenPx = (W: number): number => W / activeVenue().screen.width;

/** The screen's sky in bank px. */
export const screenSky = (W: number, H: number): Sky => {
  const px = screenPx(W);
  return {
    cx: W / 2,
    cy: -H / 2,
    L: 0.47 * Math.min(W, H),
    T0: 8,
    boost: 1,
    minR: 7 * px,
    view: { x0: 0, y0: -H, x1: W, y1: 0 },
  };
};

/** Particle size and caps on the screen. */
export const screenScale = (W: number) => ({
  dot: screenPx(W) * 3.4,
  maxBodies: MAX_BODIES.big,
  dustCap: DUST_CAP.big,
});

/** Every touch target on a layout, for tests. */
export const targets = (l: Layout): (Btn & { what: string })[] => [
  ...l.pads.map((p) => ({ x: p.x, y: p.y, r: p.grab, what: `pad ${p.index}` })),
  ...l.pickers.flatMap((g, i) => g.map((b) => ({ ...b, what: `pick ${i} ${b.pick}` }))),
  ...l.launchers.map((s) => ({ x: s.x, y: s.y, r: s.r, what: `launcher ${s.index}` })),
  { ...l.slower, what: "slower" },
  { ...l.faster, what: "faster" },
  { ...l.sizes, what: "sizes" },
  { ...l.scene, what: "scene" },
];
