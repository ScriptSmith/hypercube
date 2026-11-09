/**
 * Where stations, pads and the arena go on a touch frame, in venue px.
 *
 * - Wall: a pad strip along the bottom PAD_STRIP px with 4 to 8 stations; the arena above it.
 * - Panel, or each panel-wide segment of a pair: one station in the lower part (in child reach),
 *   with the arena (playing alone) or the status (linked to a screen) above it. With two per
 *   frame, a low station's pads sit in the bottom 40 % and a high one's between 55 % and 85 %;
 *   each station is just tall enough for its reset control and pads, and the arena goes in the
 *   band between them.
 * - On a pair, stations keep SEAM_CLEAR px from every seam.
 *
 * The platform draws a hold-to-reset control in a top corner of each playing station; turn pads
 * sit below it so the two never overlap.
 *
 * Grid stations have four direction pads ("aim" pads) laid out the way they point: up above a
 * row of left, down and right, or where that row would be too narrow, up, then left and right,
 * then down. The reset control and the station's info sit in the top corners beside the up pad.
 */
import type { FrameKind, Rect } from "../../core/types";

export const PAD_STRIP = 560;
export const SEAM_CLEAR = 220;
/** Smallest pad side on a wall and on a panel. */
export const PAD_MIN = { wall: 280, panel: 400 } as const;
/**
 * Smallest side of the four direction pads, which can be smaller than turn pads. Eight stations
 * across the default wall leave room for 220 on a wall.
 */
export const AIM_MIN = { wall: 220, panel: 300 } as const;
/** Largest side of a direction pad, so a station stays compact and leaves room for the arena. */
const AIM_MAX = { wall: 300, panel: 330, stacked: 300 } as const;
/** A touch this close to a direction pad counts as on it. */
export const AIM_SLACK = 40;
/** Gap between a panel's lowest pads and its bottom edge. */
const PAD_FOOT = { turn: 50, aim: 30 } as const;
/** The platform's reset control while playing: its size limits, inset and margin. */
const RESET = { min: 120, max: 150, margin: 28, inset: 0.05 } as const;
/** A station's band is never shorter than this (MIN_BAND_VENUE_PX in core/stations). */
const MIN_BAND = 400;
/** Pad side for two stations stacked on one panel. */
const PAD_STACKED = 420;
/** Room above a pad row for the reset control and a gap. */
const ABOVE_PADS = RESET.margin + RESET.max + 20;

export type Tier = "only" | "low" | "high";
/** Two turn pads, or four direction pads. */
export type PadKind = "turn" | "aim";

export interface StationLayout {
  /** Left to right, low before high. */
  index: number;
  rect: Rect;
  kind: PadKind;
  /**
   * Turn pads: left and right. Direction pads: by direction (right, down, left, up, as in
   * DIR_X), so pad `d` points `d` quarter turns round from the right.
   */
  pads: readonly Rect[];
  /** Turn pads: touches in the station left of this x turn left, the rest turn right. */
  split: number;
  /** Room at the top of the station for the heading arrow and short status. */
  info: Rect;
  resetCorner: "top-left" | "top-right";
  /** Where the station's line starts, as a fraction across the frame. */
  u: number;
  tier: Tier;
}

export interface FrameLayout {
  width: number;
  height: number;
  stations: StationLayout[];
  /** The arena's area when the frame plays on its own. */
  arena: Rect;
  /**
   * Room above each station for its status while a bank's screen holds the arena; null for
   * stacked stations, whose info areas hold it.
   */
  status: (Rect | null)[];
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  /** Seam x positions. */
  seams: readonly number[];
  /** y of the top of adult reach. */
  reachTop: number;
  wallStations: number;
  perFrame: 1 | 2;
  /** Default turn. */
  pads?: PadKind;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface StationInput {
  index: number;
  rect: Rect;
  tier: Tier;
  u: number;
  frameW: number;
  reachTop: number;
  padMin: number;
  padMax: number;
  /** y of the pads' bottom edge. */
  padBottom: number;
}

const station = (o: StationInput): StationLayout => {
  const { rect } = o;
  const resetCorner = rect.x + rect.width / 2 < o.frameW / 2 ? "top-left" : "top-right";
  // The same band and reset size the platform works out for an uncalibrated station.
  const bandTop = clamp(o.reachTop, rect.y, rect.y + rect.height - MIN_BAND);
  const r = clamp((rect.y + rect.height - bandTop) * 0.3, RESET.min, RESET.max);
  const resetBottom = bandTop + RESET.margin + r;
  const gap = Math.max(24, rect.width * 0.04);
  const side = Math.max(12, rect.width * 0.02);
  const h = clamp(o.padBottom - resetBottom - 20, o.padMin, o.padMax);
  const w = clamp((rect.width - gap - 2 * side) / 2, o.padMin, h * 1.35);
  const cx = rect.x + rect.width / 2;
  const top = o.padBottom - h;
  const clearX = rect.width * RESET.inset + RESET.margin + r + 16;
  return {
    index: o.index,
    rect,
    pads: [
      { x: cx - gap / 2 - w, y: top, width: w, height: h },
      { x: cx + gap / 2, y: top, width: w, height: h },
    ],
    split: cx,
    info: {
      x: rect.x + clearX,
      y: bandTop + 12,
      width: Math.max(0, rect.width - 2 * clearX),
      height: Math.max(0, top - bandTop - 24),
    },
    resetCorner,
    u: o.u,
    tier: o.tier,
    kind: "turn",
  };
};

/** The platform's reset control while a station plays, for an uncalibrated station. */
export const resetRect = (rect: Rect, corner: StationLayout["resetCorner"], reachTop: number) => {
  const bandTop = clamp(reachTop, rect.y, rect.y + rect.height - MIN_BAND);
  const r = clamp((rect.y + rect.height - bandTop) * 0.3, RESET.min, RESET.max);
  const x = corner.endsWith("left")
    ? rect.x + rect.width * RESET.inset + RESET.margin
    : rect.x + rect.width * (1 - RESET.inset) - RESET.margin - r;
  return { x, y: bandTop + RESET.margin, width: r, height: r };
};

export interface AimFit {
  /** "tee": up above left, down and right. "plus": up, then left and right, then down. */
  shape: "tee" | "plus";
  /** Pad height (and least side), up and down pad width, left and right pad width. */
  side: number;
  w: number;
  lw: number;
  gap: number;
  /** Height of the whole set of pads. */
  height: number;
}

/** The biggest direction pads that fit `width` across and `tall` down, at most `max`. */
export const aimFit = (width: number, tall: number, min: number, max: number): AimFit => {
  const margin = Math.max(12, width * 0.02);
  const gap = clamp(width * 0.015, 12, 16);
  const across = width - 2 * margin;
  const tee = Math.min(max, (across - 2 * gap) / 3, (tall - gap) / 2);
  const plus = Math.min(max, (across - gap) / 2, (tall - 2 * gap) / 3);
  if (tee >= min || tee >= plus) {
    const side = Math.floor(tee);
    const w = Math.floor(Math.min((across - 2 * gap) / 3, side * 1.35));
    return { shape: "tee", side, w, lw: w, gap, height: 2 * side + gap };
  }
  const side = Math.floor(plus);
  const lw = Math.floor(Math.min((across - gap) / 2, side * 1.6));
  return { shape: "plus", side, w: side, lw, gap, height: 3 * side + 2 * gap };
};

interface AimInput {
  index: number;
  x: number;
  width: number;
  tier: Tier;
  u: number;
  frameW: number;
  reachTop: number;
  fit: AimFit;
  /** y of the pads' bottom edge. */
  padBottom: number;
  /** A fixed top for the station (the wall's pad strip); else it starts just above its pads. */
  top?: number;
  bottom: number;
}

const aimStation = (o: AimInput): StationLayout => {
  const { fit } = o;
  const { side, w, lw, gap } = fit;
  const cx = o.x + o.width / 2;
  const padsTop = o.padBottom - fit.height;
  const y = o.top ?? padsTop - RESET.margin;
  const rect = { x: o.x, y, width: o.width, height: o.bottom - y };
  const resetCorner = cx < o.frameW / 2 ? "top-left" : "top-right";
  const up = { x: cx - w / 2, y: padsTop, width: w, height: side };
  const row = padsTop + side + gap;
  let pads: Rect[];
  if (fit.shape === "tee") {
    pads = [
      { x: cx + w / 2 + gap, y: row, width: w, height: side },
      { x: cx - w / 2, y: row, width: w, height: side },
      { x: cx - w * 1.5 - gap, y: row, width: w, height: side },
      up,
    ];
  } else {
    pads = [
      { x: cx + gap / 2, y: row, width: lw, height: side },
      { x: cx - w / 2, y: row + side + gap, width: w, height: side },
      { x: cx - gap / 2 - lw, y: row, width: lw, height: side },
      up,
    ];
  }
  // The info goes in the top corner the reset control leaves free, beside the up pad.
  const margin = Math.max(12, o.width * 0.02);
  const infoX = resetCorner === "top-left" ? up.x + w + gap : o.x + margin;
  const infoW = resetCorner === "top-left" ? o.x + o.width - margin - infoX : up.x - gap - infoX;
  return {
    index: o.index,
    rect,
    kind: "aim",
    pads,
    split: cx,
    info: { x: infoX, y: padsTop, width: Math.max(0, infoW), height: side },
    resetCorner,
    u: o.u,
    tier: o.tier,
  };
};

const wallLayout = (i: LayoutInput): FrameLayout => {
  const n = clamp(Math.round(i.wallStations), 1, 8);
  const sw = i.width / n;
  const top = i.height - PAD_STRIP;
  const padBottom = i.height - 32;
  const fit = aimFit(sw, padBottom - top - RESET.margin, AIM_MIN.wall, AIM_MAX.wall);
  const stations = Array.from({ length: n }, (_, k) =>
    i.pads === "aim"
      ? aimStation({
          index: k,
          x: k * sw,
          width: sw,
          tier: "only",
          u: (k + 0.5) / n,
          frameW: i.width,
          reachTop: i.reachTop,
          fit,
          padBottom,
          top,
          bottom: i.height,
        })
      : station({
          index: k,
          rect: { x: k * sw, y: top, width: sw, height: PAD_STRIP },
          tier: "only",
          u: (k + 0.5) / n,
          frameW: i.width,
          reachTop: i.reachTop,
          padMin: PAD_MIN.wall,
          padMax: 360,
          padBottom,
        }),
  );
  return {
    width: i.width,
    height: i.height,
    stations,
    arena: { x: 0, y: 0, width: i.width, height: top },
    status: stations.map(() => null),
  };
};

const statusAbove = (st: StationLayout): Rect => ({
  x: st.rect.x,
  y: 0,
  width: st.rect.width,
  height: st.rect.y - 20,
});

/**
 * Direction pads for one panel-wide segment of a panel or pair: one station in the child band
 * (the lower half), or a low one in the bottom 40 % and a high one above the middle.
 */
const aimSegment = (
  i: LayoutInput,
  index: number,
  x0: number,
  segW: number,
  x: number,
  w: number,
): StationLayout[] => {
  const H = i.height;
  const foot = H - PAD_FOOT.aim;
  const common = { x, width: w, frameW: i.width, reachTop: i.reachTop, bottom: H };
  if (i.perFrame !== 2) {
    const fit = aimFit(w, foot - H * 0.5, AIM_MIN.panel, AIM_MAX.panel);
    return [
      aimStation({
        ...common,
        index,
        tier: "only",
        u: (x + w / 2) / i.width,
        fit,
        padBottom: foot,
      }),
    ];
  }
  const highTop = H * 0.15;
  const fit = aimFit(
    w,
    Math.min(foot - H * 0.6, H * 0.5 - highTop),
    AIM_MIN.panel,
    AIM_MAX.stacked,
  );
  // The high pads end 55 % up the panel, or lower (but above the middle) if they need the room.
  const highBottom = Math.max(H * 0.45, highTop + fit.height);
  return [
    aimStation({
      ...common,
      index,
      tier: "low",
      u: (x0 + segW * 0.3) / i.width,
      fit,
      padBottom: foot,
    }),
    aimStation({
      ...common,
      index: index + 1,
      tier: "high",
      u: (x0 + segW * 0.7) / i.width,
      fit,
      padBottom: highBottom,
      bottom: highBottom + 20,
    }),
  ];
};

/** Panels, and pairs as a row of panel-wide segments. */
const panelLayout = (i: LayoutInput): FrameLayout => {
  const span = i.seams.length + 1;
  const segW = i.width / span;
  const H = i.height;
  const stations: StationLayout[] = [];
  const status: (Rect | null)[] = [];
  const stacked = i.perFrame === 2;
  for (let s = 0; s < span; s++) {
    const x0 = s * segW;
    // Keep clear of the seams on either side of this segment.
    const left = i.seams.some((x) => Math.abs(x - x0) < 1) ? SEAM_CLEAR : 0;
    const right = i.seams.some((x) => Math.abs(x - (x0 + segW)) < 1) ? SEAM_CLEAR : 0;
    const x = x0 + left;
    const w = segW - left - right;
    const base = { frameW: i.width, reachTop: i.reachTop, padMin: PAD_MIN.panel, padMax: 440 };
    if (i.pads === "aim") {
      const added = aimSegment(i, stations.length, x0, segW, x, w);
      stations.push(...added);
      for (const st of added) status.push(stacked ? null : statusAbove(st));
      continue;
    }
    if (!stacked) {
      const rect = { x, y: H * 0.625, width: w, height: H * 0.375 };
      stations.push(
        station({
          ...base,
          index: stations.length,
          rect,
          tier: "only",
          u: (x + w / 2) / i.width,
          padBottom: H - 50,
        }),
      );
      status.push({ x, y: 0, width: w, height: rect.y - 20 });
      continue;
    }
    const lowPads = H - 50;
    const highPads = H * 0.45;
    const lowTop = lowPads - PAD_STACKED - ABOVE_PADS;
    const highTop = highPads - PAD_STACKED - ABOVE_PADS;
    stations.push(
      station({
        ...base,
        padMax: PAD_STACKED,
        index: stations.length,
        rect: { x, y: lowTop, width: w, height: H - lowTop },
        tier: "low",
        u: (x0 + segW * 0.3) / i.width,
        padBottom: lowPads,
      }),
      station({
        ...base,
        padMax: PAD_STACKED,
        index: stations.length + 1,
        rect: { x, y: highTop, width: w, height: highPads + 20 - highTop },
        tier: "high",
        u: (x0 + segW * 0.7) / i.width,
        padBottom: highPads,
      }),
    );
    status.push(null, null);
  }
  const lows = stations.filter((s) => s.tier !== "high");
  const highs = stations.filter((s) => s.tier === "high");
  const top = Math.max(0, ...highs.map((s) => s.rect.y + s.rect.height));
  const bottom = Math.min(...lows.map((s) => s.rect.y));
  return {
    width: i.width,
    height: H,
    stations,
    arena: { x: 0, y: top, width: i.width, height: Math.max(0, bottom - top) },
    status,
  };
};

export const frameLayout = (i: LayoutInput): FrameLayout =>
  i.kind === "wall" || i.kind === "kiosk" ? wallLayout(i) : panelLayout(i);

/** Whether point (x, y) is on the left half of a station; null outside it. */
export const sideAt = (s: StationLayout, x: number, y: number): -1 | 1 | null => {
  const r = s.rect;
  if (x < r.x || x >= r.x + r.width || y < r.y || y >= r.y + r.height) return null;
  return x < s.split ? -1 : 1;
};
