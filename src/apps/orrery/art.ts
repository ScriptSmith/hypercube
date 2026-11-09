/**
 * Small Canvas2D drawings shared by the overlay and the ground view's Moon: the Moon at a phase,
 * a ghost hand, and text with a dark outline that reads on any sky.
 */
import { FONT } from "../../core/ui/style";

export const font = (size: number, weight = 700): string =>
  `${weight} ${Math.max(1, size)}px ${FONT}`;

/**
 * The Moon with its lit side towards `angle` (degrees, 0 right, 90 up), `lit` of its face lit.
 * In an eclipse of the Moon it is drawn dark red.
 */
export const drawMoon = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  lit: number,
  angle: number,
  eclipse = false,
): void => {
  g.save();
  g.translate(x, y);
  g.rotate((-angle * Math.PI) / 180);
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fillStyle = eclipse ? "#5a2418" : "#2b2f3a";
  g.fill();
  if (!eclipse && lit > 0.003) {
    // The terminator is half an ellipse: x = t sqrt(r² - y²), from t = 1 (new) to -1 (full).
    const t = 1 - 2 * Math.max(0, Math.min(1, lit));
    g.beginPath();
    g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    const n = 32;
    for (let i = 0; i <= n; i++) {
      const yy = r - (2 * r * i) / n;
      g.lineTo(t * Math.sqrt(Math.max(0, r * r - yy * yy)), yy);
    }
    g.closePath();
    g.fillStyle = "#eef0f4";
    g.fill();
  }
  // A few darker seas, so it reads as the Moon and not a ball.
  g.globalAlpha = 0.14;
  g.fillStyle = "#1a1d26";
  for (const [mx, my, mr] of [
    [-0.25, -0.3, 0.22],
    [0.2, -0.15, 0.16],
    [0.05, 0.3, 0.18],
  ] as const) {
    g.beginPath();
    g.arc(mx * r, my * r, mr * r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.lineWidth = Math.max(1, r * 0.04);
  g.strokeStyle = "rgba(242,245,250,0.35)";
  g.stroke();
  g.restore();
};

/** A ghost hand with its fingertip at (x, y). */
export const drawHand = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void => {
  if (alpha <= 0.01) return;
  const k = size / 100;
  g.save();
  g.translate(x - 40 * k, y - 4 * k);
  g.scale(k, k);
  g.fillStyle = `rgba(242,245,250,${0.72 * alpha})`;
  g.strokeStyle = `rgba(5,7,13,${0.6 * alpha})`;
  g.lineWidth = 4;
  const p = new Path2D();
  p.roundRect(32, 4, 17, 60, 8.5);
  p.roundRect(52, 42, 14, 28, 7);
  p.roundRect(69, 46, 13, 26, 6.5);
  p.roundRect(85, 51, 11, 22, 5.5);
  p.addPath(new Path2D("M30 58H96V74C96 87 86 97 73 97H52C39 97 30 88 30 76Z"));
  g.stroke(p);
  g.fill(p);
  g.lineCap = "round";
  g.lineWidth = 14;
  g.strokeStyle = `rgba(242,245,250,${0.72 * alpha})`;
  g.beginPath();
  g.moveTo(32, 64);
  g.lineTo(18, 50);
  g.stroke();
  g.restore();
};

/** Text with a dark outline. */
export const text = (
  g: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  align: CanvasTextAlign = "center",
  weight = 700,
): number => {
  g.font = font(size, weight);
  g.textAlign = align;
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = Math.max(2, size * 0.16);
  g.strokeStyle = "rgba(4,6,12,0.8)";
  g.strokeText(s, x, y);
  g.fillStyle = colour;
  g.fillText(s, x, y);
  return g.measureText(s).width;
};

/** The largest size up to `size` at which `s` fits `width`. */
export const fitSize = (
  g: CanvasRenderingContext2D,
  s: string,
  width: number,
  size: number,
  weight = 700,
): number => {
  g.font = font(size, weight);
  const w = g.measureText(s).width;
  return w <= width ? size : Math.max(size * 0.4, (size * width) / w);
};

/** Split text into at most `lines` lines that fit `width`, shrinking if needed. */
export const fitLines = (
  g: CanvasRenderingContext2D,
  s: string,
  width: number,
  size: number,
  lines: number,
): { lines: string[]; size: number } => {
  let sz = size;
  for (let tries = 0; tries < 12; tries++) {
    g.font = font(sz);
    const words = s.split(" ");
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (g.measureText(next).width <= width || !cur) cur = next;
      else {
        out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
    if (out.length <= lines && out.every((l) => g.measureText(l).width <= width)) {
      return { lines: out, size: sz };
    }
    sz *= 0.92;
  }
  return { lines: [s], size: fitSize(g, s, width, sz) };
};
