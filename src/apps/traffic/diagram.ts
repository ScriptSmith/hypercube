/**
 * The time-space diagram: x is position along the ring (a slice of it, lined up with the road
 * below), y is time with now at the bottom. Every row paints each car's body in a colour for its
 * speed, bright and cool when fast, warm and dark when crawling, so a jam shows as a dark warm
 * stripe that slants back against the traffic. A car a finger is braking paints white, so the
 * stripe can be traced to the touch that started it.
 *
 * Rows go into a fixed offscreen canvas used as a ring buffer and are drawn scrolled, so the
 * history is bounded by the canvas.
 */
import type { Rect } from "../../core/types";
import { CAR_LENGTH } from "./model";
import { FLAG, type WireCar } from "./wire";

export const BACKDROP = "#070a14";

/** Speed (m/s of ring time) to colour, through crimson, violet and blue to ice. */
const STOPS: [number, [number, number, number]][] = [
  [0, [92, 14, 34]],
  [1.2, [176, 34, 62]],
  [3.5, [168, 62, 170]],
  [6.5, [70, 110, 255]],
  [10, [120, 220, 255]],
  [14, [214, 248, 255]],
];

const SHADES = 64;
const MAX_V = 15;

const rgbAt = (v: number): [number, number, number] => {
  for (let i = 1; i < STOPS.length; i++) {
    const [v1, c1] = STOPS[i]!;
    const [v0, c0] = STOPS[i - 1]!;
    if (v <= v1) {
      const f = (v - v0) / (v1 - v0);
      return [0, 1, 2].map((k) => Math.round(c0[k]! + (c1[k]! - c0[k]!) * f)) as [
        number,
        number,
        number,
      ];
    }
  }
  return STOPS[STOPS.length - 1]![1];
};

export const SPEED_COLORS: readonly string[] = Array.from({ length: SHADES }, (_, i) => {
  const [r, g, b] = rgbAt((i / (SHADES - 1)) * MAX_V);
  return `rgb(${r},${g},${b})`;
});

export const speedColor = (v: number): string =>
  SPEED_COLORS[Math.max(0, Math.min(SHADES - 1, Math.round((v / MAX_V) * (SHADES - 1))))]!;

export interface Diagram {
  readonly width: number;
  readonly rows: number;
  /** Real ms per row. */
  readonly rowMs: number;
  /**
   * Paint one row: the cars on a ring of `length` metres, of which the diagram shows fractions
   * [f0, f1).
   */
  addRow(cars: readonly WireCar[], length: number, f0: number, f1: number): void;
  /**
   * Draw into `rect` of `g`, scrolled up by `frac` of a row (the time since the newest row, as a
   * fraction of rowMs), so the scroll is smooth between rows.
   */
  draw(g: CanvasRenderingContext2D, rect: Rect, frac: number): void;
  /** Rows painted so far (bounded by `rows` in what is kept). */
  readonly painted: number;
  /** The colour at fraction `f` across, `back` rows before the newest (for tests). */
  peek(f: number, back: number): [number, number, number];
  clear(): void;
  dispose(): void;
}

export const createDiagram = (width: number, rows: number, historyMs: number): Diagram => {
  const W = Math.max(8, Math.round(width));
  const H = Math.max(8, Math.round(rows));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d", { alpha: false });
  let head = -1;
  let painted = 0;

  const clear = () => {
    if (!g) return;
    g.fillStyle = BACKDROP;
    g.fillRect(0, 0, W, H);
    head = -1;
    painted = 0;
  };
  clear();

  const paint = (x0: number, w: number, y: number, color: string) => {
    if (!g) return;
    const a = Math.max(0, x0);
    const b = Math.min(W, x0 + w);
    if (b <= a) return;
    g.fillStyle = color;
    g.fillRect(a, y, b - a, 1);
  };

  return {
    width: W,
    rows: H,
    rowMs: historyMs / H,
    get painted() {
      return painted;
    },
    addRow(cars, length, f0, f1) {
      if (!g || length <= 0) return;
      head = (head + 1) % H;
      painted++;
      const y = head;
      g.fillStyle = BACKDROP;
      g.fillRect(0, y, W, 1);
      const span = (f1 - f0) * length;
      const k = W / span;
      const body = Math.max(1, CAR_LENGTH * k);
      const from = f0 * length;
      for (const c of cars) {
        let d = (c.x - from) % length;
        if (d < 0) d += length;
        const color = c.flags & (FLAG.touched | FLAG.ghost) ? "#ffffff" : speedColor(c.v);
        paint(d * k, body, y, color);
        // The same car seen again across the wrap (a frame that shows the whole ring).
        if (d + CAR_LENGTH > length) paint((d - length) * k, body, y, color);
      }
    },
    draw(target, rect, frac) {
      if (painted === 0) {
        target.fillStyle = BACKDROP;
        target.fillRect(rect.x, rect.y, rect.width, rect.height);
        return;
      }
      const rowH = rect.height / H;
      const lift = Math.max(0, Math.min(1, frac)) * rowH;
      target.save();
      target.beginPath();
      target.rect(rect.x, rect.y, rect.width, rect.height);
      target.clip();
      target.fillStyle = BACKDROP;
      target.fillRect(rect.x, rect.y, rect.width, rect.height);
      const bottom = rect.y + rect.height - lift;
      // Rows 0..head are the newest, head+1..H-1 the oldest.
      const newer = head + 1;
      const older = H - newer;
      const kept = Math.min(painted, H);
      if (newer > 0) {
        target.drawImage(
          canvas,
          0,
          0,
          W,
          newer,
          rect.x,
          bottom - newer * rowH,
          rect.width,
          newer * rowH,
        );
      }
      const olderKept = Math.min(older, kept - newer);
      if (olderKept > 0) {
        target.drawImage(
          canvas,
          0,
          H - olderKept,
          W,
          olderKept,
          rect.x,
          bottom - (newer + olderKept) * rowH,
          rect.width,
          olderKept * rowH,
        );
      }
      // The newest row stretches down over the gap the scroll leaves.
      if (lift > 0 && newer > 0) {
        target.drawImage(canvas, 0, head, W, 1, rect.x, bottom, rect.width, lift + 0.5);
      }
      target.restore();
    },
    peek(f, back) {
      if (!g || painted === 0) return [0, 0, 0];
      const y = (((head - Math.round(back)) % H) + H) % H;
      const x = Math.max(0, Math.min(W - 1, Math.floor(f * W)));
      const d = g.getImageData(x, y, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    },
    clear,
    dispose() {
      canvas.width = 1;
      canvas.height = 1;
    },
  };
};

const rowCars: WireCar[] = [];

/**
 * Paint the rows due by local ms `local`, one per rowMs, each with the cars as they were at its
 * own moment (`carsAgo(ms, out)` fills `out` with the cars `ms` before now), so the diagram stays
 * smooth when frames come slowly. After a long stall it skips ahead rather than paint a block.
 * `carsAgo` may reuse car objects, so call this before reading cars for anything else.
 */
export const paintDue = (
  d: Diagram,
  rows: { at: number },
  local: number,
  length: number,
  f0: number,
  f1: number,
  carsAgo: (ms: number, out: WireCar[]) => boolean,
): void => {
  if (local - rows.at > d.rowMs * 20) rows.at = local - d.rowMs;
  while (local - rows.at >= d.rowMs) {
    rows.at += d.rowMs;
    if (carsAgo(local - rows.at, rowCars)) d.addRow(rowCars, length, f0, f1);
  }
};
