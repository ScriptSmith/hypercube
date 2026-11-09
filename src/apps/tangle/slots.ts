/** Start positions: one per station, above it, plus a few bot-only starts along the top. */
import { venueSize } from "../../core/frame";
import type { FrameKind } from "../../core/types";
import type { ArenaParams } from "./arena";
import { frameLayout, type PadKind } from "./layout";
import type { Slot } from "./match";
import { stationKey } from "./protocol";

/** Bot-only starts, across the top heading down, used when an arena has too few stations. */
const VIRTUAL_AT = [0.18, 0.82, 0.38, 0.62] as const;

export interface Inset {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Margins around an arena of this size: a strip along the top for the out order, a thin border. */
export const insetFor = (width: number, height: number): Inset => {
  const side = Math.min(40, Math.max(12, Math.min(width, height) * 0.012));
  return {
    left: side,
    right: side,
    bottom: side,
    top: Math.min(200, Math.max(64, height * 0.05)),
  };
};

const startY = (height: number, p: ArenaParams) => height - p.radius * 0.9;

/** Bot-only slots with keys from `firstKey`, colours continuing from `firstColor`. */
export const virtualSlots = (
  width: number,
  height: number,
  p: ArenaParams,
  firstKey: number,
  firstColor: number,
): Slot[] =>
  VIRTUAL_AT.map((f, i) => ({
    key: firstKey + i,
    start: { x: f * width, y: p.radius * 0.9, heading: Math.PI / 2 },
    color: (firstColor + i) % 8,
    style: 0,
    virtual: true,
  }));

/** The colour and head style of the `n`th station of a bank or frame. */
export const lookOf = (n: number) => ({ color: n % 8, style: Math.floor(n / 8) % 3 });

/**
 * Slots for an arena on its own frame: `us` are the stations' start fractions across the frame,
 * which spans `frameW`; the arena starts `left` in from the frame's edge.
 */
export const localSlots = (
  us: readonly number[],
  frameW: number,
  left: number,
  width: number,
  height: number,
  p: ArenaParams,
): Slot[] => {
  const margin = p.radius * 0.8;
  const stations = us.map((u, j) => ({
    key: j,
    start: {
      x: Math.min(width - margin, Math.max(margin, u * frameW - left)),
      y: startY(height, p),
      heading: -Math.PI / 2,
    },
    ...lookOf(j),
    virtual: false,
  }));
  return [...stations, ...virtualSlots(width, height, p, 100, us.length)];
};

/**
 * Slots for a bank's screen: `count` frames below it, of the kinds given (by pos), each with
 * the stations the touch frames lay out. The screen spans the bank exactly.
 */
export const bankSlots = (
  count: number,
  kindAt: (pos: number) => FrameKind,
  perFrame: 1 | 2,
  pads: PadKind,
  screenW: number,
  left: number,
  width: number,
  height: number,
  p: ArenaParams,
): Slot[] => {
  const margin = p.radius * 0.6;
  const out: Slot[] = [];
  for (let pos = 0; pos < count; pos++) {
    const kind = kindAt(pos) === "pair" ? "pair" : "panel";
    const size = venueSize(kind);
    const lay = frameLayout({
      kind,
      width: size.width,
      height: size.height,
      seams: kind === "pair" ? [size.width / 2] : [],
      reachTop: 0,
      wallStations: 8,
      perFrame,
      pads,
    });
    const n = lay.stations.length;
    for (const st of lay.stations) {
      const f = (pos + st.u) / count;
      out.push({
        key: stationKey(pos, st.index),
        start: {
          x: Math.min(width - margin, Math.max(margin, f * screenW - left)),
          y: startY(height, p),
          heading: -Math.PI / 2,
        },
        ...lookOf(pos * n + st.index),
        virtual: false,
      });
    }
  }
  return [...out, ...virtualSlots(width, height, p, 10_000, out.length)];
};
