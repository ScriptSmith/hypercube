/**
 * One cell of a crystal drawn in turning perspective on a 2D canvas: the cell's edges and its
 * atoms, heavier atoms larger, nearer atoms brighter. For chapter 11's reveal.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { COLOR } from "../../config";
import {
  cellAtoms,
  type CrystalId,
  CRYSTALS,
  directBasis,
  electrons,
  type Species,
  type Vec3,
} from "../../crystals";
import type { Rect } from "../../layout";

interface Atom {
  p: Vec3;
  sp: Species;
}

const cache = new Map<CrystalId, Atom[]>();

/** The cell's atoms in Å, with the images on its faces and edges for a cubic cell. */
const atomsOf = (id: CrystalId): Atom[] => {
  const hit = cache.get(id);
  if (hit) return hit;
  const c = CRYSTALS[id];
  const [a, b, cc] = directBasis(c.cell);
  const cubic = c.cell.alpha === 90 && c.cell.beta === 90 && c.cell.gamma === 90;
  const out: Atom[] = [];
  for (const s of cellAtoms(c)) {
    const shifts = cubic
      ? [0, 1].flatMap((i) =>
          [0, 1].flatMap((j) =>
            [0, 1]
              .map((k) => [i, j, k] as const)
              .filter(([x, y, z]) => {
                const f = [s.x + x, s.y + y, s.z + z];
                return f.every((v) => v <= 1 + 1e-6);
              }),
          ),
        )
      : [[0, 0, 0] as const];
    for (const [i, j, k] of shifts) {
      const x = s.x + i;
      const y = s.y + j;
      const z = s.z + k;
      out.push({
        p: [
          x * a[0] + y * b[0] + z * cc[0],
          x * a[1] + y * b[1] + z * cc[1],
          x * a[2] + y * b[2] + z * cc[2],
        ],
        sp: s.sp,
      });
    }
  }
  cache.set(id, out);
  return out;
};

export const drawCrystal = (
  g: CanvasRenderingContext2D,
  box: Rect,
  id: CrystalId,
  t: number,
): void => {
  const c = CRYSTALS[id];
  const [a, b, cc] = directBasis(c.cell);
  const mid: Vec3 = [
    (a[0] + b[0] + cc[0]) / 2,
    (a[1] + b[1] + cc[1]) / 2,
    (a[2] + b[2] + cc[2]) / 2,
  ];
  const yaw = t * 0.45;
  const pitch = 0.38;
  // Crystal z up on screen, turning about it.
  const view = (q: Vec3) => {
    const x = q[0] - mid[0];
    const y = q[1] - mid[1];
    const z = q[2] - mid[2];
    const x1 = x * Math.cos(yaw) - y * Math.sin(yaw);
    const y1 = x * Math.sin(yaw) + y * Math.cos(yaw);
    const up = z * Math.cos(pitch) + y1 * Math.sin(pitch);
    const depth = -z * Math.sin(pitch) + y1 * Math.cos(pitch);
    return { x: x1, y: up, depth };
  };
  const corners: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const f = [i & 1, (i >> 1) & 1, (i >> 2) & 1];
    corners.push([
      f[0]! * a[0] + f[1]! * b[0] + f[2]! * cc[0],
      f[0]! * a[1] + f[1]! * b[1] + f[2]! * cc[1],
      f[0]! * a[2] + f[1]! * b[2] + f[2]! * cc[2],
    ]);
  }
  const reach = Math.max(
    ...corners.map((q) => Math.hypot(q[0] - mid[0], q[1] - mid[1], q[2] - mid[2])),
  );
  const k = (Math.min(box.width, box.height) * 0.42) / reach;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const P = (q: Vec3) => {
    const v = view(q);
    return { x: cx + v.x * k, y: cy - v.y * k, depth: v.depth };
  };
  g.save();
  g.strokeStyle = withAlpha(COLOR.real, 0.45);
  g.lineWidth = Math.max(2.5, box.width * 0.007);
  for (let i = 0; i < 8; i++)
    for (const bit of [1, 2, 4]) {
      const j = i | bit;
      if (j === i) continue;
      const p = P(corners[i]!);
      const q = P(corners[j]!);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(q.x, q.y);
      g.stroke();
    }
  g.restore();
  const atoms = atomsOf(id).map((at) => ({ ...P(at.p), z: electrons(at.sp) }));
  const zMax = Math.max(...atoms.map((x) => x.z));
  atoms.sort((p, q) => q.depth - p.depth);
  for (const at of atoms) {
    const r = k * (0.28 + 0.07 * Math.sqrt(at.z));
    const near = 0.6 + 0.4 * Math.max(0, Math.min(1, 0.5 - at.depth / (2 * reach)));
    const heavy = at.z >= zMax - 0.5;
    const base = heavy ? COLOR.real : "#d5f3dc";
    const grad = g.createRadialGradient(at.x - r * 0.35, at.y - r * 0.35, r * 0.1, at.x, at.y, r);
    grad.addColorStop(0, withAlpha("#ffffff", 0.85 * near));
    grad.addColorStop(0.4, withAlpha(base, near));
    grad.addColorStop(1, withAlpha(base, 0.55 * near));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(at.x, at.y, r, 0, Math.PI * 2);
    g.fill();
  }
};
