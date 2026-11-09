/**
 * Where the patches of park and their controls go on a touch frame, in venue px. A panel is one
 * patch, a merged pair one per panel, a wall `flyers` side by side. In each patch the spool, a big
 * round button held to reel the kite in, sits in the child band, and the stunt bar's two handles
 * above it, in the adult band. Handles move only downwards along their travel and spring back
 * when let go.
 */
import type { FrameKind, Rect } from "../../core/types";
import type { Variant } from "./config";

export interface LayoutInput {
  kind: FrameKind;
  /** Venue px. */
  width: number;
  height: number;
  reachTop: { adult: number; child: number };
  seams: number[];
  variant: Variant;
  flyers: number;
}

export interface GripSpec {
  /** Centre x and the centre y at rest, venue px. */
  x: number;
  restY: number;
  /** How far down the grip can be pulled. */
  travel: number;
  w: number;
  h: number;
  /** Where a touch takes the grip. */
  hit: Rect;
}

/** The spool: a round button whose rim is the reel. */
export interface SpoolSpec {
  /** Centre and radius, venue px. */
  x: number;
  y: number;
  r: number;
  /** Where a touch takes it. */
  hit: Rect;
}

export interface PatchSpec {
  index: number;
  x0: number;
  x1: number;
  cx: number;
  spool: SpoolSpec;
  /** Null in the `single` variant. */
  stunt: { left: GripSpec; right: GripSpec } | null;
  reset: { x: number; y: number; r: number };
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  patches: PatchSpec[];
  /** Bottom edge of the frame's own sky (when it draws one), venue px from the top. */
  horizon: number;
  /** Kite size in venue px when the frame draws its own sky. */
  kitePx: number;
  /** Where the runtime's Home control should go on this frame, or null for its default. */
  home: { x: number; y: number; size: number } | null;
}

/** Keep controls this far from a seam. */
export const SEAM_CLEAR = 120;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({
  x: x0,
  y: y0,
  width: Math.max(0, x1 - x0),
  height: Math.max(0, y1 - y0),
});

/** Clip a hit area to the patch, leaving SEAM_CLEAR on any side that is a seam. */
const clip = (r: Rect, lo: number, hi: number): Rect => {
  const x0 = Math.max(r.x, lo);
  const x1 = Math.min(r.x + r.width, hi);
  return { ...r, x: x0, width: Math.max(0, x1 - x0) };
};

interface Sizes {
  spoolR: number;
  handleW: number;
  handleH: number;
  handleTravel: number;
  handleApart: number;
  resetR: number;
  kitePx: number;
}

const sizesFor = (wall: boolean, single: boolean, pw: number): Sizes =>
  wall
    ? {
        spoolR: single ? 140 : 110,
        handleW: 170,
        handleH: 130,
        handleTravel: 190,
        handleApart: Math.min(380, pw - 300),
        resetR: 65,
        kitePx: 190,
      }
    : {
        spoolR: single ? 230 : 170,
        handleW: 200,
        handleH: 160,
        handleTravel: 260,
        handleApart: Math.min(620, pw - 300),
        resetR: 65,
        kitePx: 112,
      };

export const layoutFor = (input: LayoutInput): Layout => {
  const { width: W, height: H, kind } = input;
  const wall = kind === "wall";
  const single = input.variant === "single";
  const n = wall
    ? clamp(Math.round(input.flyers), 1, 8)
    : Math.max(1, kind === "pair" ? input.seams.length + 1 : 1);
  const pw = W / n;
  const s = sizesFor(wall, single, pw);
  const adultTop = clamp(input.reachTop.adult, 0, H);
  const childTop = clamp(Math.max(input.reachTop.child, adultTop + 200), 0, H - 300);
  const seams = input.seams;

  // Spool: low in the child band, clear of the bottom edge and the resets in the corners.
  const band = H - childTop;
  const spoolY = clamp(
    childTop + band * (single ? 0.5 : 0.58),
    childTop + s.spoolR + 30,
    H - s.spoolR - (wall ? 110 : 150),
  );
  // Stunt handles: their pulled position ends just above the child band.
  const room = childTop - adultTop - s.handleH - 24;
  const handleTravel = clamp(room, 90, s.handleTravel);
  const handleRest = childTop - 20 - s.handleH / 2 - handleTravel;
  const above = single && !wall ? childTop - 120 : handleRest - s.handleH / 2 - 60;
  const horizon = Math.max(H * 0.2, wall ? Math.min(above, adultTop - 30) : above);

  const patches: PatchSpec[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = i * pw;
    const x1 = x0 + pw;
    const cx = x0 + pw / 2;
    const seamLeft = seams.some((x) => Math.abs(x - x0) < 2);
    const seamRight = seams.some((x) => Math.abs(x - x1) < 2);
    const lo = x0 + (seamLeft ? SEAM_CLEAR : 8);
    const hi = x1 - (seamRight ? SEAM_CLEAR : 8);
    const r = Math.min(s.spoolR, (hi - lo) / 2 - 40);
    const margin = wall ? 30 : 40;
    // In `single` the whole child band of the patch holds the spool.
    const spoolHit = single
      ? rect(lo, childTop, hi, H)
      : rect(cx - r - margin, spoolY - r - margin, cx + r + margin, spoolY + r + margin);
    const spool: SpoolSpec = { x: cx, y: spoolY, r, hit: clip(spoolHit, lo, hi) };
    let stunt: PatchSpec["stunt"] = null;
    if (!single) {
      const apart = s.handleApart / 2;
      const handle = (x: number): GripSpec => ({
        x,
        restY: handleRest,
        travel: handleTravel,
        w: s.handleW,
        h: s.handleH,
        hit: clip(
          rect(
            x - s.handleW / 2 - 30,
            handleRest - s.handleH / 2 - 36,
            x + s.handleW / 2 + 30,
            handleRest + handleTravel + s.handleH / 2 + 16,
          ),
          lo,
          hi,
        ),
      });
      stunt = { left: handle(cx - apart), right: handle(cx + apart) };
    }
    // Hold-to-reset at the patch's outer bottom corner; on the wall the left one, since the
    // runtime's Home sits at the wall's bottom right.
    const outerLeft = wall || kind === "panel" ? true : !seamLeft;
    const rx = outerLeft ? x0 + (seamLeft ? SEAM_CLEAR : 0) + 20 + s.resetR : x1 - 20 - s.resetR;
    patches.push({
      index: i,
      x0,
      x1,
      cx,
      spool,
      stunt,
      reset: { x: rx, y: H - 24 - s.resetR, r: s.resetR },
    });
  }
  const homeSize = wall ? 160 : 120;
  return {
    kind,
    width: W,
    height: H,
    patches,
    horizon,
    kitePx: s.kitePx,
    home: wall ? { x: W - homeSize - 28, y: H - homeSize - 28, size: homeSize } : null,
  };
};

/** The control under venue point (x, y): its patch and which grip, or null. */
export type GripId = "spool" | "left" | "right";

export const gripAt = (
  layout: Layout,
  x: number,
  y: number,
): { patch: number; grip: GripId } | null => {
  const inside = (r: Rect) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
  for (const p of layout.patches) {
    if (x < p.x0 || x > p.x1) continue;
    if (p.stunt) {
      if (inside(p.stunt.left.hit)) return { patch: p.index, grip: "left" };
      if (inside(p.stunt.right.hit)) return { patch: p.index, grip: "right" };
    }
    if (inside(p.spool.hit)) return { patch: p.index, grip: "spool" };
  }
  return null;
};
