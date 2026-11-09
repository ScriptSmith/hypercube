/**
 * The Layers button's pictogram: a small box with three of a family's layers through it, so the
 * button shows which way the layers slice (flat, slanted or across a corner) without naming them.
 */
import { withAlpha } from "../../../../core/ui/palette";
import type { IconDraw } from "../../controls";
import type { Vec3 } from "../../crystals";
import { apply, dot, type Mat3, turnOf } from "./model";

const VIEW: Mat3 = turnOf(32, 22);

const CORNERS: Vec3[] = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORNERS.push([x, y, z]);
const EDGES: [number, number][] = [];
for (let i = 0; i < 8; i++)
  for (let j = i + 1; j < 8; j++) {
    const a = CORNERS[i]!;
    const b = CORNERS[j]!;
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) === 2)
      EDGES.push([i, j]);
  }

/** Where the plane n·p = c cuts a box from -1 to 1, as a polygon in order round it. */
export const sliceOfBox = (n: Vec3, c: number): Vec3[] => {
  const pts: Vec3[] = [];
  for (const [i, j] of EDGES) {
    const a = CORNERS[i]!;
    const b = CORNERS[j]!;
    const da = dot(n, a) - c;
    const db = dot(n, b) - c;
    if (da === db || da * db > 0) continue;
    const t = da / (da - db);
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  if (pts.length < 3) return [];
  const m: Vec3 = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) m[k]! += p[k]! / pts.length;
  // Order the points round the middle, in the plane.
  const u: Vec3 = (() => {
    const p = pts[0]!;
    const v: Vec3 = [p[0] - m[0], p[1] - m[1], p[2] - m[2]];
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  })();
  const w: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const angle = (p: Vec3) => {
    const v: Vec3 = [p[0] - m[0], p[1] - m[1], p[2] - m[2]];
    return Math.atan2(dot(v, w), dot(v, u));
  };
  // Drop repeats where the plane passes through a corner.
  const out: Vec3[] = [];
  for (const p of pts.sort((a, b) => angle(a) - angle(b)))
    if (!out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 1e-6)) out.push(p);
  return out.length >= 3 ? out : [];
};

/** The pictogram for layers with unit normal `n` (world, y up); null draws the box alone. */
export const layersIcon =
  (n: Vec3 | null): IconDraw =>
  (g, b, color) => {
    const s = Math.min(b.width, b.height) * 0.3;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const P = (p: Vec3) => {
      const q = apply(VIEW, p);
      return { x: cx + q[0] * s, y: cy - q[1] * s };
    };
    g.save();
    g.lineJoin = "round";
    g.lineCap = "round";
    if (n) {
      const ext = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]);
      for (const c of [-0.55, 0, 0.55]) {
        const poly = sliceOfBox(n, c * ext);
        if (poly.length < 3) continue;
        g.beginPath();
        poly.forEach((p, i) => {
          const q = P(p);
          if (i === 0) g.moveTo(q.x, q.y);
          else g.lineTo(q.x, q.y);
        });
        g.closePath();
        g.fillStyle = withAlpha(color, 0.45);
        g.fill();
        g.strokeStyle = color;
        g.lineWidth = Math.max(2, s * 0.09);
        g.stroke();
      }
    }
    g.strokeStyle = withAlpha(color, n ? 0.55 : 0.9);
    g.lineWidth = Math.max(2, s * 0.08);
    g.beginPath();
    for (const [i, j] of EDGES) {
      const a = P(CORNERS[i]!);
      const c = P(CORNERS[j]!);
      g.moveTo(a.x, a.y);
      g.lineTo(c.x, c.y);
    }
    g.stroke();
    g.restore();
  };
