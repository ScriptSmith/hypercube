/**
 * Where everything goes on a wall: a row of cabinets standing on the floor, each a front view in
 * the sphere's 2D look, with its control panel low enough for a child and its prize hatch at its
 * foot under the chute. Sizes are venue px with y down from the top of the stage; the play area
 * inside each cabinet is in physics units (u) as on the sphere.
 *
 * From the floor up: a plinth, the base with the hatch, the control panel (left and right arrows
 * and a drop button inside the children's reach, a timer above the drop button), the glass, and
 * the canopy and lit sign in the sphere cabinet's proportions.
 */
import type { Reach, Rect } from "../../core/types";
import { PART, PLAY_CANOPY, PLAY_HEIGHT } from "./layout";
import { CHUTE } from "./world";

export type Button = "left" | "right" | "drop";
export const BUTTONS: readonly Button[] = ["left", "right", "drop"];

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface WallCabinet {
  index: number;
  chute: -1 | 1;
  /** The body's left edge and the sign's top, venue px on the stage. */
  x: number;
  y: number;
  /** Stage venue px. */
  buttons: Record<Button, Circle>;
  /** How far from each button's middle a touch still presses it. */
  hit: Record<Button, number>;
  /** The seconds left, above the drop button. */
  timer: Rect;
  /** The prize hatch, stage venue px. */
  hatch: Rect;
  /** The whole cabinet, sign included, stage venue px. */
  bounds: Rect;
}

export interface WallLayout {
  /** The stage, venue px. */
  width: number;
  height: number;
  /** Stage y of the tops of adult and child reach. */
  adultTop: number;
  childTop: number;
  play: { width: number; height: number; canopy: number };
  /** Venue px per u. */
  k: number;
  /** A sphere cabinet's height with this glass, which sizes the trim, the sign and its lights. */
  scale: number;
  /** A cabinet's total height and its body's width (pillars included), venue px. */
  cabinetH: number;
  bodyW: number;
  pillar: number;
  /** Rows of each part, from the sign's top, venue px. */
  rows: Record<"marquee" | "canopy" | "glass" | "ledge" | "base" | "plinth", [number, number]>;
  /** The arrows' diameter, venue px. */
  button: number;
  cabinets: WallCabinet[];
  /** Room left free at each end of the wall, venue px. */
  margin: number;
}

/** Narrowest play area on the wall, u: narrower leaves the claw little room beside the chute. */
const WALL_MIN = 2.9;
const PLAY_MAX = 5;
/** Free wall at each end (room for the runtime's Home control) and between cabinets. */
const OUTER = 0.08;
const INNER = 0.13;
const HEADROOM = 0.02;
const PLINTH = 28;
/** The sign and canopy above the glass, and the pillars, as fractions of `scale`. */
const GLASS = PART.glass.bottom - PART.glass.top;
const ABOVE = PART.glass.top;
const PILLAR = 0.03;
/** Arrows: a share of the children's band, within limits; the drop button is larger. */
const BUTTON_SHARE = 0.36;
const BUTTON_MIN = 160;
const BUTTON_FLOOR = 150;
const BUTTON_MAX = 240;
const DROP = 1.2;
/** The group: left, right, drop, as multiples of the arrows' diameter from the left arrow. */
const RIGHT_AT = 1.2;
const DROP_AT = 2.75;
const GROUP = 0.5 + DROP_AT + DROP / 2;
/** Room above the drop button for the timer, as a multiple of the arrows' diameter. */
const TIMER_ROOM = 0.55;
const HATCH_MIN = 0.26;
const HATCH_MAX = 0.4;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The vertical stack under the glass, venue px up from the floor. */
const stack = (height: number, reach: Reach) => {
  const childUp = clamp(reach.child, 0, 1) * height;
  const s = clamp(Math.round(BUTTON_SHARE * childUp), BUTTON_MIN, BUTTON_MAX);
  const d = DROP * s;
  // Low enough for a child, with the base and hatch below.
  const centre = Math.max(PLINTH + 40 + 0.85 * s, 0.55 * childUp);
  const consoleTop = centre + d / 2 + TIMER_ROOM * s;
  const ledgeBottom = centre - d / 2 - 0.25 * s;
  return { s, d, centre, consoleTop, ledgeBottom };
};

export const layoutWall = (
  size: { width: number; height: number },
  reach: Reach,
  count: number,
): WallLayout => {
  const n = clamp(Math.round(count), 1, 6);
  const vw = Math.max(1, size.width);
  const vh = Math.max(1, size.height);
  const st = stack(vh, reach);
  const outer = OUTER * vh;
  const inner = INNER * vh;

  // The glass as tall as the wall allows, then narrower cabinets if they would crowd.
  const room = vh * (1 - HEADROOM) - st.consoleTop;
  const glassMax = Math.max(PLAY_HEIGHT * 40, room / (1 + ABOVE / GLASS));
  const pillarPerGlass = PILLAR / GLASS;
  const bodyMax = (vw - 2 * outer - (n - 1) * inner) / n;
  let k = glassMax / PLAY_HEIGHT;
  let width = (bodyMax - 2 * pillarPerGlass * glassMax) / k;
  if (width < WALL_MIN) {
    width = WALL_MIN;
    k = bodyMax / (WALL_MIN + 2 * pillarPerGlass * PLAY_HEIGHT);
  } else if (width > PLAY_MAX) {
    width = PLAY_MAX;
  }
  const glassH = PLAY_HEIGHT * k;
  const scale = glassH / GLASS;
  const pillar = PILLAR * scale;
  const bodyW = width * k + 2 * pillar;
  const cabH = ABOVE * scale + glassH + st.consoleTop;
  const top = vh - cabH;
  const local = (up: number) => cabH - up;
  const rows: WallLayout["rows"] = {
    marquee: [0, PART.marquee.bottom * scale],
    canopy: [PART.canopy.top * scale, PART.canopy.bottom * scale],
    glass: [ABOVE * scale, ABOVE * scale + glassH],
    ledge: [local(st.consoleTop), local(st.ledgeBottom)],
    base: [local(st.ledgeBottom), local(PLINTH)],
    plinth: [local(PLINTH), cabH],
  };

  // Even gaps, with the ends at least `outer` from the wall's edges.
  const free = vw - n * bodyW;
  let end = free / (2 * n);
  let gap = free / n;
  if (end < outer && n > 1) {
    end = outer;
    gap = (free - 2 * outer) / (n - 1);
  } else if (n === 1) {
    end = free / 2;
  }

  const chutePx = (CHUTE.width - CHUTE.wall / 2) * k;
  const m = 0.12 * st.s;
  const cabinets: WallCabinet[] = [];
  let s = st.s;
  for (let i = 0; i < n; i++) {
    const chute: -1 | 1 = i % 2 ? -1 : 1;
    const x = end + i * (bodyW + gap);
    // The hatch under the chute, as wide as the controls leave.
    const holeMid = pillar + (chute > 0 ? width - CHUTE.width / 2 : CHUTE.width / 2) * k;
    const forButtons = bodyW - 2 * pillar - 3 * m - GROUP * st.s;
    const hw = clamp(Math.min(1.3 * chutePx, forButtons), HATCH_MIN * bodyW, HATCH_MAX * bodyW);
    const hx = clamp(holeMid - hw / 2, 0.6 * pillar, bodyW - 0.6 * pillar - hw);
    const hy0 = local(st.consoleTop) + 0.14 * st.s;
    const hy1 = local(PLINTH) - 0.1 * st.s;
    // The buttons on the other side, centred in what is left.
    const r0 = chute > 0 ? pillar + m : hx + hw + m;
    const r1 = chute > 0 ? hx - m : bodyW - pillar - m;
    s = Math.max(BUTTON_FLOOR, Math.min(st.s, (r1 - r0) / GROUP));
    const d = DROP * s;
    const gx = (r0 + r1) / 2 - (GROUP * s) / 2;
    const cy = top + local(st.centre);
    const left = { x: x + gx + s / 2, y: cy, r: s / 2 };
    const right = { x: left.x + RIGHT_AT * s, y: cy, r: s / 2 };
    const drop = { x: left.x + DROP_AT * s, y: cy, r: d / 2 };
    const tw = 0.8 * s;
    const th = 0.38 * s;
    cabinets.push({
      index: i,
      chute,
      x,
      y: top,
      buttons: { left, right, drop },
      // Up to half the gap between the arrows, more round the drop button.
      hit: { left: 0.6 * s, right: 0.6 * s, drop: d / 2 + 0.22 * s },
      timer: { x: drop.x - tw / 2, y: drop.y - d / 2 - 0.1 * s - th, width: tw, height: th },
      hatch: { x: x + hx, y: top + hy0, width: hw, height: hy1 - hy0 },
      bounds: {
        x: x - PART.marquee.overhang * scale,
        y: top,
        width: bodyW + 2 * PART.marquee.overhang * scale,
        height: cabH,
      },
    });
  }

  return {
    width: vw,
    height: vh,
    adultTop: vh * (1 - clamp(reach.adult, 0, 1)),
    childTop: vh * (1 - clamp(reach.child, 0, 1)),
    play: { width, height: PLAY_HEIGHT, canopy: PLAY_CANOPY },
    k,
    scale,
    cabinetH: cabH,
    bodyW,
    pillar,
    rows,
    button: s,
    cabinets,
    margin: end,
  };
};

/** The button a touch at (x, y) venue px presses, or null. */
export const buttonAt = (
  l: WallLayout,
  x: number,
  y: number,
): { cabinet: number; button: Button } | null => {
  let best: { cabinet: number; button: Button } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of l.cabinets) {
    for (const b of BUTTONS) {
      const p = c.buttons[b];
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= c.hit[b] && d < bestD) {
        bestD = d;
        best = { cabinet: c.index, button: b };
      }
    }
  }
  return best;
};

/** The cabinet a touch at (x, y) venue px lands on, sign included, or null. */
export const cabinetAt = (l: WallLayout, x: number, y: number): number | null => {
  for (const c of l.cabinets) {
    const b = c.bounds;
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return c.index;
  }
  return null;
};
