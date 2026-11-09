/**
 * A short label with a leader line to one spot of a pattern ("One set of layers"), shared by
 * chapters 6 and 7. It sits beside the pattern when the watch view has room there, and inside
 * the pattern's top-left corner on a dark pill when it hasn't (the kiosk's square fills its view).
 */
import { withAlpha } from "../../../../core/ui/palette";
import { COLOR } from "../../config";
import { font, roundRect } from "../../controls";
import { wrapLines } from "../../draw";
import type { Rect } from "../../layout";

export interface SpotLabelOpts {
  size: number;
  /** Radius of the ring drawn round the spot. */
  ring: number;
  color?: string;
  alpha?: number;
}

export const spotLabel = (
  g: CanvasRenderingContext2D,
  view: Rect,
  sq: Rect,
  spot: { x: number; y: number },
  text: string,
  o: SpotLabelOpts,
): void => {
  const color = o.color ?? COLOR.real;
  const size = o.size;
  const m = size * 0.6;
  const lh = size * 1.15;
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.font = font(800, size);
  const side = sq.x - view.x - 2 * m;
  let lines = [text];
  if (g.measureText(text).width > side) lines = wrapLines(g, text, Math.max(1, side));
  const widest = Math.max(...lines.map((l) => g.measureText(l).width));
  let anchor: { x: number; y: number };
  let tx: number;
  let ty: number;
  let room: number;
  if (widest <= side && lines.length <= 2) {
    // Beside the pattern, on the left, level with the spot.
    const h = lines.length * lh;
    ty = Math.max(view.y + m, Math.min(view.y + view.height - m - h, spot.y - h / 2));
    tx = sq.x - m;
    room = side;
    g.textAlign = "right";
    anchor = { x: tx + m * 0.5, y: ty + h / 2 };
  } else {
    // Inside the pattern's top-left corner, on a pill.
    lines = [text];
    const w = Math.min(g.measureText(text).width, sq.width * 0.7);
    room = w;
    const px = sq.x + m;
    const py = sq.y + m;
    roundRect(g, { x: px, y: py, width: w + m * 1.4, height: lh + m * 0.6 }, lh);
    g.fillStyle = withAlpha(COLOR.background, 0.82);
    g.fill();
    tx = px + m * 0.7;
    ty = py + m * 0.3;
    g.textAlign = "left";
    anchor = { x: px + (w + m * 1.4) * 0.5, y: py + lh + m * 0.6 };
  }
  g.fillStyle = color;
  g.textBaseline = "top";
  lines.forEach((l, i) => g.fillText(l, tx, ty + i * lh, Math.max(1, room)));
  // The leader stops at the ring, so the spot itself stays clear.
  const dx = spot.x - anchor.x;
  const dy = spot.y - anchor.y;
  const d = Math.hypot(dx, dy) || 1;
  const end = Math.max(0, d - o.ring - 4);
  g.strokeStyle = withAlpha(color, 0.85);
  g.lineWidth = Math.max(2, size * 0.09);
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(anchor.x, anchor.y);
  g.lineTo(anchor.x + (dx / d) * end, anchor.y + (dy / d) * end);
  g.stroke();
  g.beginPath();
  g.arc(spot.x, spot.y, o.ring, 0, Math.PI * 2);
  g.stroke();
  g.restore();
};
