/**
 * A small picture for each chapter's tab, beside its number, so a visitor can tell which tab holds
 * the helix or the game without trying each: a wave, two waves, a block, a flash, the machine,
 * rings, a grid, a missing spot, ripples, an X and a fingerprint. Line drawings in the tab's ink.
 */
import type { IconDraw } from "./controls";
import type { ChapterId } from "./ids";
import type { Rect } from "./layout";

const TAU = Math.PI * 2;

/** Stroke a path drawn in a unit box (0 to 1 each way) into `b`. */
const inBox = (
  g: CanvasRenderingContext2D,
  b: Rect,
  c: string,
  draw: (p: (x: number, y: number) => [number, number], s: number) => void,
) => {
  g.save();
  g.strokeStyle = c;
  g.fillStyle = c;
  g.lineWidth = Math.max(2, b.width * 0.075);
  g.lineCap = "round";
  g.lineJoin = "round";
  draw((x, y) => [b.x + x * b.width, b.y + y * b.height], b.width);
  g.restore();
};

const sine = (
  g: CanvasRenderingContext2D,
  p: (x: number, y: number) => [number, number],
  y0: number,
  amp: number,
  waves: (x: number) => number,
) => {
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const x = 0.06 + (0.88 * i) / 40;
    const [px, py] = p(x, y0 - amp * Math.sin(TAU * waves(x)));
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.stroke();
};

const dot = (
  g: CanvasRenderingContext2D,
  p: (x: number, y: number) => [number, number],
  x: number,
  y: number,
  r: number,
) => {
  const [px, py] = p(x, y);
  g.beginPath();
  g.arc(px, py, r, 0, TAU);
  g.fill();
};

export const TAB_ICON: Record<ChapterId, IconDraw> = {
  // A wave getting shorter, as along the spectrum.
  spectrum: (g, b, c) => inBox(g, b, c, (p) => sine(g, p, 0.5, 0.28, (x) => 0.6 * x + 1.6 * x * x)),
  interference: (g, b, c) =>
    inBox(g, b, c, (p) => {
      sine(g, p, 0.3, 0.16, (x) => 1.6 * x);
      sine(g, p, 0.72, 0.16, (x) => 1.6 * x);
    }),
  // A block seen from a corner.
  crystal: (g, b, c) =>
    inBox(g, b, c, (p) => {
      const pts: [number, number][] = [
        [0.5, 0.1],
        [0.88, 0.3],
        [0.88, 0.72],
        [0.5, 0.92],
        [0.12, 0.72],
        [0.12, 0.3],
      ];
      g.beginPath();
      pts.forEach(([x, y], i) => {
        const [px, py] = p(x, y);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
      g.closePath();
      g.moveTo(...p(0.12, 0.3));
      g.lineTo(...p(0.5, 0.5));
      g.lineTo(...p(0.88, 0.3));
      g.moveTo(...p(0.5, 0.5));
      g.lineTo(...p(0.5, 0.92));
      g.stroke();
    }),
  // Slanted layers with a flash leaving them.
  bragg: (g, b, c) =>
    inBox(g, b, c, (p, s) => {
      g.beginPath();
      for (const y of [0.62, 0.8, 0.98]) {
        g.moveTo(...p(0.04, y));
        g.lineTo(...p(0.6, y - 0.12));
      }
      g.stroke();
      const [cx, cy] = p(0.74, 0.3);
      const r = s * 0.24;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        const k = i % 2 === 0 ? r : r * 0.34;
        if (i === 0) g.moveTo(cx + k * Math.cos(a), cy + k * Math.sin(a));
        else g.lineTo(cx + k * Math.cos(a), cy + k * Math.sin(a));
      }
      g.closePath();
      g.fill();
    }),
  // The stage's circle with the detector's arm.
  goniometer: (g, b, c) =>
    inBox(g, b, c, (p, s) => {
      const [cx, cy] = p(0.42, 0.58);
      g.beginPath();
      g.arc(cx, cy, s * 0.3, 0, TAU);
      g.stroke();
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(...p(0.9, 0.12));
      g.stroke();
      dot(g, p, 0.42, 0.58, s * 0.07);
      g.fillRect(...p(0.8, 0.02), s * 0.18, s * 0.18);
    }),
  patterns: (g, b, c) =>
    inBox(g, b, c, (p, s) => {
      const [cx, cy] = p(0.5, 0.5);
      for (const r of [0.14, 0.28, 0.42]) {
        g.beginPath();
        g.arc(cx, cy, s * r, 0, TAU);
        g.stroke();
      }
    }),
  inverse: (g, b, c) =>
    inBox(g, b, c, (p, s) => {
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) dot(g, p, 0.18 + i * 0.32, 0.18 + j * 0.32, s * 0.08);
    }),
  // A grid of spots with one missing, drawn dashed.
  absences: (g, b, c) =>
    inBox(g, b, c, (p, s) => {
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          if (i === 1 && j === 1) continue;
          dot(g, p, 0.18 + i * 0.32, 0.18 + j * 0.32, s * 0.08);
        }
      const [cx, cy] = p(0.5, 0.5);
      g.save();
      g.lineWidth = Math.max(2, s * 0.05);
      g.setLineDash([s * 0.07, s * 0.06]);
      g.beginPath();
      g.arc(cx, cy, s * 0.11, 0, TAU);
      g.stroke();
      g.restore();
    }),
  // Ripples: parallel slanted crests.
  synthesis: (g, b, c) =>
    inBox(g, b, c, (p) => {
      g.beginPath();
      g.rect(...p(0.06, 0.06), b.width * 0.88, b.height * 0.88);
      g.clip();
      g.beginPath();
      for (const k of [-0.3, -0.1, 0.1, 0.3, 0.5]) {
        g.moveTo(...p(0.1 + k, 0.94));
        g.lineTo(...p(0.5 + k, 0.06));
      }
      g.stroke();
    }),
  helix: (g, b, c) =>
    inBox(g, b, c, (p, s) => {
      g.beginPath();
      g.moveTo(...p(0.18, 0.1));
      g.lineTo(...p(0.82, 0.9));
      g.moveTo(...p(0.82, 0.1));
      g.lineTo(...p(0.18, 0.9));
      g.stroke();
      for (const y of [0.22, 0.36, 0.64, 0.78]) {
        const dx = Math.abs(0.5 - y) * 0.8;
        dot(g, p, 0.5 - dx, y, s * 0.05);
        dot(g, p, 0.5 + dx, y, s * 0.05);
      }
    }),
  // A fingerprint: nested arcs.
  mystery: (g, b, c) =>
    inBox(g, b, c, (p, s) => {
      const [cx, cy] = p(0.5, 0.62);
      for (const r of [0.1, 0.22, 0.34, 0.46]) {
        g.beginPath();
        g.arc(cx, cy, s * r, Math.PI * 1.05, Math.PI * 2.05 - r * 0.6);
        g.stroke();
      }
    }),
};
