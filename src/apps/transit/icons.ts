/**
 * Mode pictograms and zoom symbols (our own drawings, 64 x 64, in currentColor) and line sketches
 * for buttons.
 */
import type { ZoomAction } from "./layout";
import type { Mode } from "./routes";

const DARK = "#05070d";

const BODY: Record<Mode, string> = {
  bus:
    `<rect x="6" y="14" width="52" height="31" rx="7" fill="currentColor"/>` +
    `<rect x="11" y="19" width="42" height="10" rx="2.5" fill="${DARK}" opacity=".55"/>` +
    `<circle cx="19" cy="46" r="6.5" fill="currentColor" stroke="${DARK}" stroke-width="3"/>` +
    `<circle cx="45" cy="46" r="6.5" fill="currentColor" stroke="${DARK}" stroke-width="3"/>`,
  train:
    `<rect x="15" y="6" width="34" height="42" rx="10" fill="currentColor"/>` +
    `<rect x="20" y="12" width="24" height="13" rx="3" fill="${DARK}" opacity=".55"/>` +
    `<circle cx="24" cy="38" r="3.2" fill="${DARK}" opacity=".55"/>` +
    `<circle cx="40" cy="38" r="3.2" fill="${DARK}" opacity=".55"/>` +
    `<path d="M23 48 17 57M41 48l6 9M11 58h42" stroke="currentColor" stroke-width="4" stroke-linecap="round" fill="none"/>`,
  ferry:
    `<path d="M5 37h54l-8 12H13z" fill="currentColor"/>` +
    `<rect x="15" y="22" width="32" height="14" rx="3.5" fill="currentColor"/>` +
    `<rect x="19" y="25.5" width="24" height="6" rx="1.5" fill="${DARK}" opacity=".55"/>` +
    `<path d="M5 57q6.5-4.5 13.5 0t13.5 0 13.5 0 13.5 0" stroke="currentColor" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
};

export const modeIcon = (mode: Mode): string =>
  `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">${BODY[mode]}</svg>`;

const ZOOM: Record<ZoomAction, string> = {
  in: `<path d="M32 13v38M13 32h38" stroke="currentColor" stroke-width="7" stroke-linecap="round" fill="none"/>`,
  out: `<path d="M13 32h38" stroke="currentColor" stroke-width="7" stroke-linecap="round" fill="none"/>`,
  // Corners of a frame round a dot: back to the whole view.
  reset:
    `<path d="M9 23V9h14M41 9h14v14M55 41v14H41M23 55H9V41" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
    `<circle cx="32" cy="32" r="6.5" fill="currentColor"/>`,
};

export const zoomIcon = (action: ZoomAction): string =>
  `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">${ZOOM[action]}</svg>`;

/**
 * An SVG path sketching polylines (local metres, north up) fitted inside `w` x `h` with `pad`,
 * keeping their shape. At most `maxPoints` points per line.
 */
export const sketchPath = (
  lines: readonly Float32Array[],
  w: number,
  h: number,
  pad: number,
  maxPoints = 60,
): string => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const pts of lines) {
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]!);
      x1 = Math.max(x1, pts[i]!);
      y0 = Math.min(y0, pts[i + 1]!);
      y1 = Math.max(y1, pts[i + 1]!);
    }
  }
  if (!Number.isFinite(x0)) return "";
  const sx = (w - 2 * pad) / Math.max(1, x1 - x0);
  const sy = (h - 2 * pad) / Math.max(1, y1 - y0);
  const s = Math.min(sx, sy);
  const ox = pad + (w - 2 * pad - (x1 - x0) * s) / 2;
  const oy = pad + (h - 2 * pad - (y1 - y0) * s) / 2;
  const parts: string[] = [];
  for (const pts of lines) {
    const n = pts.length / 2;
    const step = Math.max(1, Math.ceil(n / maxPoints));
    for (let i = 0; i < n; i += step) {
      const j = i + step >= n ? n - 1 : i;
      const x = ox + (pts[j * 2]! - x0) * s;
      const y = oy + (y1 - pts[j * 2 + 1]!) * s;
      parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
      if (j === n - 1) break;
    }
  }
  return parts.join("");
};
