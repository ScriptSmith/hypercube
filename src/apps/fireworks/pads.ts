/**
 * Where each launch pad's parts go, in the frame's venue px (y down). Everything needed to launch
 * sits in the child band: the lower half of a panel, the bottom quarter of the wall. The aim
 * handle is in the adult band above it. On a merged pair each pad keeps 220 px from the seam, and
 * wall pads are a pad's width apart so two people don't share one.
 */
import type { FrameKind, Rect } from "../../core/types";
import type { Config } from "./config";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface AimArc {
  /** Centre of the arc (below the pad) and its radius. */
  cx: number;
  cy: number;
  r: number;
  /** Half-width of the touch band around the arc. */
  band: number;
  /** Largest tilt either way, radians. */
  max: number;
}

export interface PadLayout {
  index: number;
  x0: number;
  x1: number;
  cx: number;
  tube: { x: number; base: number; length: number; width: number };
  tubeHit: Rect;
  color: Circle | null;
  shape: Circle | null;
  size: Circle | null;
  reset: Circle;
  aim: AimArc | null;
  /** Flick: where a drag may start. */
  flick: Rect | null;
  /** The longest drag that still counts as more height, venue px. */
  flickMax: number;
  /** Top of the pad area, where the ground starts. */
  top: number;
}

export const SEAM_GAP = 220;
export const MAX_AIM = (25 * Math.PI) / 180;
/** On panels and pairs the shell has to leave through the top, so the tilt is a little less. */
export const MAX_AIM_NARROW = (21 * Math.PI) / 180;
const SIN_AIM = Math.sin(MAX_AIM);

export interface PadFrame {
  kind: FrameKind;
  width: number;
  height: number;
  /** Panels merged into the frame (pairs). */
  span: number;
}

/**
 * The narrowest share of a wall a pad takes: two columns of 240 px recipe buttons either side
 * of a tube whose target is 240 px wide.
 */
const WALL_PITCH = 772;

/** Pad horizontal ranges for a frame: [x0, x1, cx] each. */
export const padSpans = (f: PadFrame, cfg: Pick<Config, "pads">): [number, number, number][] => {
  if (f.kind === "wall") {
    // A narrow wall gets fewer pads than asked for rather than cramped ones.
    const n = Math.max(1, Math.min(cfg.pads, Math.floor(f.width / WALL_PITCH)));
    const pitch = f.width / n;
    return Array.from({ length: n }, (_, i) => [i * pitch, (i + 1) * pitch, (i + 0.5) * pitch]);
  }
  if (f.kind === "pair") {
    const n = Math.max(2, f.span);
    const panel = f.width / n;
    // One pad per panel, each kept clear of the seams beside it.
    return Array.from({ length: n }, (_, i) => {
      const x0 = i * panel + (i > 0 ? SEAM_GAP : 0);
      const x1 = (i + 1) * panel - (i < n - 1 ? SEAM_GAP : 0);
      return [x0, x1, (x0 + x1) / 2] as [number, number, number];
    });
  }
  return [[0, f.width, f.width / 2]];
};

export const layoutPads = (
  f: PadFrame,
  cfg: Pick<Config, "variant" | "recipe" | "aim" | "pads">,
): PadLayout[] => {
  const wall = f.kind === "wall";
  const H = f.height;
  const spans = padSpans(f, cfg);
  return spans.map(([x0, x1, cx], index) => {
    const half = (x1 - x0) / 2;
    if (wall) {
      const childTop = H * 0.75;
      const adultTop = H * 0.55;
      const r = 120;
      const dx = Math.min(255, half - r - 18);
      const rowA = childTop + r + 18;
      const rowB = Math.min(H - r - 30, rowA + 2 * r + 50);
      const tube = { x: cx, base: H - 30, length: 270, width: 118 };
      return finish({
        index,
        x0,
        x1,
        cx,
        tube,
        tubeHit: {
          x: cx - (dx - r - 8),
          y: childTop + 20,
          width: 2 * (dx - r - 8),
          height: H - childTop - 20,
        },
        rows: [rowA, rowB],
        dx,
        r,
        resetR: 85,
        aimTop: adultTop + 110,
        aimBand: 100,
        flickTop: childTop - 40,
        flickMax: H - childTop + 300,
        top: childTop - 30,
        half,
        cfg,
        narrow: false,
      });
    }
    // Panels and pairs: the lower half is the child band.
    const childTop = H * 0.5;
    const r = 130;
    const dx = Math.min(290, half - r - 10);
    const rowA = Math.max(childTop + r + 150, H - 520);
    const rowB = Math.min(H - r - 50, rowA + 2 * r + 60);
    const tube = { x: cx, base: H - 40, length: 330, width: 150 };
    return finish({
      index,
      x0,
      x1,
      cx,
      tube,
      tubeHit: {
        x: cx - (dx - r - 10),
        y: rowA - r - 40,
        width: 2 * (dx - r - 10),
        height: H - (rowA - r - 40),
      },
      rows: [rowA, rowB],
      dx,
      r,
      resetR: 96,
      aimTop: H * 0.4,
      aimBand: 110,
      flickTop: childTop + 60,
      flickMax: H * 0.45,
      top: rowA - r - 60,
      half,
      cfg,
      narrow: true,
    });
  });
};

interface Draft {
  index: number;
  x0: number;
  x1: number;
  cx: number;
  tube: PadLayout["tube"];
  tubeHit: Rect;
  rows: [number, number];
  dx: number;
  r: number;
  resetR: number;
  aimTop: number;
  aimBand: number;
  flickTop: number;
  flickMax: number;
  top: number;
  half: number;
  cfg: Pick<Config, "variant" | "recipe" | "aim">;
  narrow: boolean;
}

const finish = (d: Draft): PadLayout => {
  const { cx, dx, r, rows, cfg } = d;
  const build = cfg.variant === "build";
  const full = build && cfg.recipe === "full";
  const resetAt: Circle = { x: cx + dx, y: rows[1] + (r - d.resetR) * 0.5, r: d.resetR };
  const max = d.narrow ? MAX_AIM_NARROW : MAX_AIM;
  const arcR = (d.half - d.aimBand * 0.75) / SIN_AIM;
  return {
    index: d.index,
    x0: d.x0,
    x1: d.x1,
    cx,
    tube: d.tube,
    tubeHit: d.tubeHit,
    color: build ? { x: cx - dx, y: rows[0], r } : null,
    shape: full ? { x: cx + dx, y: rows[0], r } : null,
    size: full ? { x: cx - dx, y: rows[1], r } : null,
    reset: resetAt,
    aim: build && cfg.aim ? { cx, cy: d.aimTop + arcR, r: arcR, band: d.aimBand, max } : null,
    flick: build
      ? null
      : { x: d.x0, y: d.flickTop, width: d.x1 - d.x0, height: Number.POSITIVE_INFINITY },
    flickMax: d.flickMax,
    top: d.top,
  };
};

export const inCircle = (c: Circle | null, x: number, y: number, slack = 16): boolean =>
  c !== null && (x - c.x) ** 2 + (y - c.y) ** 2 <= (c.r + slack) ** 2;

export const inRect = (r: Rect | null, x: number, y: number): boolean =>
  r !== null && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** The tilt the aim handle gives for a finger at (x, y), or null when it is off the arc. */
export const aimAngle = (a: AimArc, x: number, y: number, strict: boolean): number | null => {
  const d = Math.hypot(x - a.cx, y - a.cy);
  if (strict && Math.abs(d - a.r) > a.band) return null;
  const angle = Math.atan2(x - a.cx, a.cy - y);
  if (strict && Math.abs(angle) > a.max + 0.12) return null;
  return Math.max(-a.max, Math.min(a.max, angle));
};

/** Where the knob sits for a tilt. */
export const aimKnob = (a: AimArc, angle: number): { x: number; y: number } => ({
  x: a.cx + a.r * Math.sin(angle),
  y: a.cy - a.r * Math.cos(angle),
});

/** The tube's mouth for a tilt, in venue px. */
export const mouthOf = (p: PadLayout, angle: number): { x: number; y: number } => ({
  x: p.tube.x + Math.sin(angle) * p.tube.length,
  y: p.tube.base - Math.cos(angle) * p.tube.length,
});

/**
 * A flick: the drag from (x0, y0) to (x1, y1). Null if it was too short or not upwards;
 * otherwise its tilt (within the limit) and size 0..1 from its length.
 */
export const flickOf = (
  p: PadLayout,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  max = MAX_AIM,
): { angle: number; size: number } | null => {
  const dx = x1 - x0;
  const dy = y0 - y1;
  const len = Math.hypot(dx, dy);
  const min = 110;
  if (len < min || dy <= 0) return null;
  const angle = Math.max(-max, Math.min(max, Math.atan2(dx, dy)));
  const size = Math.max(0, Math.min(1, (len - min) / Math.max(1, p.flickMax - min)));
  return { angle, size };
};
