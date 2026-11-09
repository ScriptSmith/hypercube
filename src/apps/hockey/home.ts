/**
 * Where the runtime's Home control can go (shown while a visitor-launched app runs): a square
 * in reach that covers as little of anyone's station as possible, never a station's reset
 * corner, and never across a seam. Pure, in venue px.
 */
import type { Rect } from "../../core/types";
import type { Layout, ResetCorner } from "./layout";

const MARGIN = 28;
/** Size of the core's reset control plus its margin, in venue px, for keeping clear of it. */
const RESET_ZONE = 150 + MARGIN * 2;

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** The corner of a station where its reset control sits (approximately: the band is unknown). */
const resetZone = (st: Rect, corner: ResetCorner): Rect => ({
  x: corner.endsWith("left") ? st.x : st.x + st.width - RESET_ZONE,
  y: corner.startsWith("top") ? st.y : st.y + st.height - RESET_ZONE,
  width: RESET_ZONE,
  height: RESET_ZONE,
});

export const homeSpot = (
  layout: Layout,
  reachTop: number,
  seams: readonly number[],
  size: number,
): { x: number; y: number } => {
  const { width: FW, height: FH } = layout;
  const players = layout.tables.flatMap((t) => t.lanes.flatMap((l) => l.players));
  const stations = players.flatMap((p) => (p.station ? [p.station] : []));
  const resets = players.flatMap((p) => (p.station ? [resetZone(p.station, p.resetCorner)] : []));
  const top = Math.min(FH - size - MARGIN, Math.max(0, reachTop) + MARGIN);

  const candidates: number[] = [];
  // Gaps between neighbouring stations, best first; then the top corners of the reach band.
  const xs = [...stations].sort((a, b) => a.x - b.x);
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1]!.x + xs[i - 1]!.width;
    const b = xs[i]!.x;
    if (b > a - size) candidates.push((a + b) / 2 - size / 2);
  }
  candidates.push(FW - size - MARGIN, MARGIN);

  let best: { x: number; y: number; cost: number } | null = null;
  for (let x of candidates) {
    // Never across a seam: shift to whichever side has room, or give the spot up.
    const seam = seams.find((s) => x < s && x + size > s);
    if (seam !== undefined) x = x + size / 2 < seam ? seam - size - 8 : seam + 8;
    x = Math.min(FW - size, Math.max(0, x));
    const sq = { x, y: top, width: size, height: size };
    if (seams.some((s) => sq.x < s && sq.x + size > s)) continue;
    const cost =
      stations.reduce((n, st) => n + overlap(sq, st), 0) +
      resets.reduce((n, r) => n + overlap(sq, r) * 4, 0);
    // Ties go to the right, nearest where the runtime would put it anyway.
    if (!best || cost < best.cost || (cost === best.cost && x > best.x)) best = { x, y: top, cost };
  }
  return best ? { x: best.x, y: best.y } : { x: FW - size - MARGIN, y: top };
};
