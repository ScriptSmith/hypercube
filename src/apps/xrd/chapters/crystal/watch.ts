/**
 * Chapter 3's watch view, drawn on a canvas so the screen can draw it too: the zoom from a grain
 * you could hold down to its atoms repeating, one repeat outlined and named, and with a family of
 * layers shown, the view turned to look along the layers edge on, the gap d marked between them.
 * The family's (h k l) is left to the Maths fold and the figure, so visitors read words here.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { TEXT } from "../../captions";
import { COLOR } from "../../config";
import { font } from "../../controls";
import { CRYSTALS, type Vec3 } from "../../crystals";
import { bracket, clipTo, label, line, TAU, well } from "../../draw";
import type { Rect } from "../../layout";
import {
  apply,
  between,
  blockOf,
  edgeOn,
  familyOf,
  GRAIN_LOOK,
  type GrainShape,
  lookOf,
  type Mat3,
  SOLIDS,
  type Tile,
  turnOf,
  ZOOM_DECADES,
} from "./model";

const L = TEXT.crystal.labels;

export interface CrystalView {
  tile: Tile;
  /** 0 for none, else 1 + the family's index. */
  family: number;
  yaw: number;
  pitch: number;
  /** The zoom from the grain, 0 to 1 (1 at rest). */
  zoom: number;
  /** How far the view has turned to look along the layers, 0 to 1. */
  edge: number;
}

export type Spot = { part: string; x: number; y: number };

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Shaded balls, one small canvas per colour, drawn scaled. */
const sprites = new Map<string, HTMLCanvasElement>();
const MAX_SPRITES = 12;
const sprite = (colour: string): HTMLCanvasElement => {
  let s = sprites.get(colour);
  if (s) return s;
  if (sprites.size >= MAX_SPRITES) sprites.clear();
  s = document.createElement("canvas");
  s.width = s.height = 64;
  const g = s.getContext("2d")!;
  const grad = g.createRadialGradient(24, 22, 2, 32, 32, 31);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.22, colour);
  grad.addColorStop(0.85, withAlpha(colour, 0.85));
  grad.addColorStop(1, "rgba(0,0,0,0.6)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(32, 32, 31, 0, TAU);
  g.fill();
  sprites.set(colour, s);
  return s;
};

const formatLength = (m: number): string =>
  m >= 1e-3 ? "1 mm" : m >= 1e-6 ? `${Math.round(m / 1e-6)} µm` : `${Math.round(m / 1e-9)} nm`;

/** The turn the view is at: the person's turn, eased towards looking along the layers. */
export const viewTurn = (v: CrystalView): Mat3 => {
  const base = turnOf(v.yaw, v.pitch);
  if (v.family <= 0 || v.edge <= 0) return base;
  const fam = familyOf(v.tile, v.tile.families[v.family - 1]!);
  const e = v.edge * v.edge * (3 - 2 * v.edge);
  return between(base, edgeOn(fam), e);
};

/** A grain's shape, `size` px across, turned by M and lit from the upper left. */
export const drawSolid = (
  g: CanvasRenderingContext2D,
  shape: GrainShape,
  cx: number,
  cy: number,
  size: number,
  M: Mat3,
  alpha = 1,
): void => {
  const solid = SOLIDS[shape];
  const look = GRAIN_LOOK[shape];
  const pts = solid.vertices.map((p) => apply(M, p));
  const light: Vec3 = [-0.45, 0.6, 0.66];
  const faces = solid.faces
    .map((f) => {
      const a = pts[f[0]!]!;
      const b = pts[f[1]!]!;
      const c = pts[f[2]!]!;
      const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const w: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n: Vec3 = [
        u[1] * w[2] - u[2] * w[1],
        u[2] * w[0] - u[0] * w[2],
        u[0] * w[1] - u[1] * w[0],
      ];
      const l = Math.hypot(...n) || 1;
      return {
        f,
        facing: n[2] / l,
        shade: 0.35 + 0.65 * Math.max(0, (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / l),
        z: f.reduce((sum, i) => sum + pts[i]![2], 0) / f.length,
      };
    })
    .filter((x) => x.facing > 0)
    .sort((p, q) => p.z - q.z);
  for (const face of faces) {
    g.beginPath();
    face.f.forEach((i, j) => {
      const p = pts[i]!;
      const x = cx + p[0] * size;
      const y = cy - p[1] * size;
      if (j === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.closePath();
    const c = look.colour.map((x) => Math.round(x * face.shade));
    g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${look.alpha * alpha})`;
    g.fill();
    g.strokeStyle = `rgba(255,255,255,${0.35 * alpha})`;
    g.lineWidth = Math.max(1, size * 0.012);
    g.stroke();
  }
};

export const drawCrystal = (
  g: CanvasRenderingContext2D,
  r: Rect,
  v: CrystalView,
  o: {
    now: number;
    size: number;
    level?: (p: string) => number;
    alpha?: (p: string) => number;
  },
): Spot[] => {
  const level = o.level ?? (() => 0);
  // Strokes grow with the text, so the screen's big copy reads as well as a panel's.
  const u = Math.max(1, o.size / 38);
  const alpha = o.alpha ?? (() => 1);
  well(g, r);
  clipTo(g, r, 28);
  const block = blockOf(v.tile);
  const M = viewTurn(v);
  const R = block.radius + 1;
  const s = (Math.min(r.width, r.height) * 0.56) / R;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  // Less perspective edge on, so each row of atoms stacks into one.
  const depth = R * (7 + 40 * v.edge);
  const proj = (p: Vec3) => {
    const q = apply(M, p);
    const f = depth / (depth - q[2]);
    return { x: cx + q[0] * s * f, y: cy - q[1] * s * f, z: q[2], f };
  };
  const z = v.zoom;
  const atomsA = smooth(0.7, 0.95, z);
  const solidA = 1 - smooth(0.72, 0.9, z);
  const spots: Spot[] = [];

  // The zoom: rings rushing outwards while the scale bar counts down to atoms.
  if (z < 0.9) {
    const k = smooth(0.08, 0.2, z) * (1 - smooth(0.7, 0.9, z));
    for (let i = 0; i < 6; i++) {
      const t = (((o.now / 900 + i / 6) % 1) + 1) % 1;
      g.save();
      g.globalAlpha = k * (1 - t) * 0.5;
      g.strokeStyle = COLOR.ink;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, Math.min(r.width, r.height) * (0.15 + 0.7 * t), 0, TAU);
      g.stroke();
      g.restore();
    }
  }
  if (solidA > 0.01) {
    const grow = R * (0.95 + 0.4 * smooth(0.1, 0.75, z));
    drawSolid(g, v.tile.grain, cx, cy, grow * s, M, solidA);
  }

  if (atomsA > 0.01) {
    const fam = v.family > 0 ? familyOf(v.tile, v.tile.families[v.family - 1]!) : null;
    const famA = atomsA * (fam ? 1 : 0);
    // The layers, behind.
    if (fam) {
      g.save();
      g.globalAlpha = famA * 0.18;
      g.fillStyle = COLOR.real;
      for (const poly of fam.planes) {
        g.beginPath();
        poly.forEach((p, j) => {
          const q = proj(p);
          if (j === 0) g.moveTo(q.x, q.y);
          else g.lineTo(q.x, q.y);
        });
        g.closePath();
        g.fill();
      }
      g.restore();
    }
    // Bonds, then atoms back to front.
    const P = block.atoms.map((a) => proj(a.p));
    g.save();
    g.globalAlpha = atomsA * 0.5;
    g.strokeStyle = COLOR.real;
    g.lineWidth = Math.max(1.5, s * 0.16);
    g.lineCap = "round";
    g.beginPath();
    for (const [i, j] of block.bonds) {
      g.moveTo(P[i]!.x, P[i]!.y);
      g.lineTo(P[j]!.x, P[j]!.y);
    }
    g.stroke();
    g.restore();
    const order = P.map((_, i) => i).sort((a, b) => P[a]!.z - P[b]!.z);
    g.save();
    for (const i of order) {
      const a = block.atoms[i]!;
      const p = P[i]!;
      const look = lookOf(a.sp);
      const rr = look.r * s * p.f;
      g.globalAlpha = atomsA * (0.55 + 0.45 * Math.max(0, Math.min(1, (p.z + R) / (2 * R))));
      g.drawImage(sprite(look.colour), p.x - rr, p.y - rr, rr * 2, rr * 2);
    }
    g.restore();
    // The layers' edges, over the atoms, so edge on they are lines through the rows.
    if (fam) {
      g.save();
      g.globalAlpha = famA * 0.85;
      g.strokeStyle = COLOR.real;
      g.lineWidth = 3 * u;
      for (const poly of fam.planes) {
        g.beginPath();
        poly.forEach((p, j) => {
          const q = proj(p);
          if (j === 0) g.moveTo(q.x, q.y);
          else g.lineTo(q.x, q.y);
        });
        g.closePath();
        g.stroke();
      }
      g.restore();
      // d between the two layers nearest the middle, out at the block's right.
      const n = fam.normal;
      const right: Vec3 = [M[0], M[1], M[2]];
      const lv = fam.levels;
      let k = 0;
      for (let i = 1; i < lv.length; i++) if (Math.abs(lv[i]!) < Math.abs(lv[k]!)) k = i;
      const k2 = k + 1 < lv.length ? k + 1 : k - 1;
      if (k2 >= 0 && k2 !== k) {
        // Just beyond the block's right side as seen now.
        let out = 0;
        for (const c of block.corners)
          out = Math.max(out, c[0] * right[0] + c[1] * right[1] + c[2] * right[2]);
        out += 1.5;
        const at = (t: number): Vec3 => [
          right[0] * out + n[0] * t,
          right[1] * out + n[1] * t,
          right[2] * out + n[2] * t,
        ];
        const p0 = proj(at(lv[k]!));
        const p1 = proj(at(lv[k2]!));
        const big = Math.hypot(p1.x - p0.x, p1.y - p0.y) > 18;
        if (big) {
          g.save();
          g.globalAlpha = famA * alpha("d");
          bracket(g, p0.x + 18, p0.y, p1.x + 18, p1.y, {
            label: "d",
            color: COLOR.real,
            width: 5 * u * (1 + 1.4 * level("d")),
            size: o.size * 1.15,
            side: -1,
          });
          g.restore();
          spots.push({ part: "d", x: (p0.x + p1.x) / 2 + 40, y: (p0.y + p1.y) / 2 });
        }
      }
    }
    // The cell, outlined, and named while the view isn't edge on.
    // Gone at once when layers come on (their gap is marked where it stood), back once the
    // view has turned most of the way back.
    const named = atomsA * (v.family > 0 ? 0 : 1 - smooth(0, 0.5, v.edge));
    if (named > 0.02) {
      let right = -Infinity;
      for (const c of block.corners) right = Math.max(right, proj(c).x);
      let cx1 = -Infinity;
      let cy0 = 0;
      for (const [a] of block.cell) {
        const p = proj(a);
        cx1 = Math.max(cx1, p.x);
        cy0 += p.y / block.cell.length;
      }
      const tx = right + 34 * u;
      g.save();
      g.font = font(800, o.size);
      const tw = g.measureText(L.repeat ?? "").width;
      g.restore();
      if (L.repeat && tx + tw < r.x + r.width - 20 * u) {
        g.save();
        g.globalAlpha = named;
        line(g, cx1 + 6 * u, cy0, tx - 10 * u, cy0, withAlpha(COLOR.angle, 0.8), 3 * u, [
          8 * u,
          6 * u,
        ]);
        g.restore();
        label(g, L.repeat, tx, cy0, {
          size: o.size,
          align: "left",
          color: COLOR.angle,
          weight: 800,
          alpha: named,
        });
      }
    }
    const la = level("a");
    g.save();
    g.globalAlpha = atomsA * alpha("a");
    for (const [a, b] of block.cell) {
      const p = proj(a);
      const q = proj(b);
      line(g, p.x, p.y, q.x, q.y, COLOR.angle, 4 * u * (1 + 1.2 * la));
    }
    g.restore();
    const [c0, c1] = block.cell[0]!;
    const e0 = proj(c0);
    const e1 = proj(c1);
    if (Math.hypot(e1.x - e0.x, e1.y - e0.y) > 30) {
      label(g, "a", (e0.x + e1.x) / 2, (e0.y + e1.y) / 2 + o.size * 0.7, {
        size: o.size * (1 + 0.2 * la),
        color: COLOR.angle,
        italic: true,
        alpha: atomsA * alpha("a"),
      });
      spots.push({ part: "a", x: (e0.x + e1.x) / 2, y: (e0.y + e1.y) / 2 + o.size * 0.7 });
    }
    // The gap between the layers, top right, in words.
    if (fam) {
      const x = r.x + r.width - 24;
      const y = r.y + 24 + o.size * 0.6;
      label(g, L.gap ?? "", x, y, {
        size: o.size,
        align: "right",
        color: COLOR.real,
        weight: 800,
        alpha: famA,
      });
      label(g, `${fam.d.toFixed(2)} Å`, x, y + o.size * 1.2, {
        size: o.size * (1 + 0.2 * level("d")),
        align: "right",
        color: COLOR.real,
        weight: 700,
        alpha: famA * alpha("d"),
      });
      spots.push({ part: "d", x: x - o.size * 2, y: y + o.size * 1.2 });
    }
  }
  g.restore();

  // The crystal's name, and the scale bar: a grain's millimetre counting down to a nanometre.
  const pad = 24 * u;
  label(g, L[v.tile.id] ?? v.tile.id, r.x + pad, r.y + pad + o.size * 0.6, {
    size: o.size * 1.05,
    align: "left",
    color: COLOR.ink,
    weight: 800,
  });
  label(g, CRYSTALS[v.tile.crystal].formula, r.x + pad, r.y + pad + o.size * 1.8, {
    size: o.size * 0.85,
    align: "left",
    color: COLOR.muted,
    weight: 700,
  });
  let barLen: number;
  let barText: string;
  if (z >= 0.72) {
    barLen = 10 * s;
    barText = formatLength(1e-9);
  } else {
    const i = Math.max(
      0,
      Math.min(ZOOM_DECADES.length - 1, Math.floor(((z - 0.08) / 0.6) * ZOOM_DECADES.length)),
    );
    barLen = Math.min(r.width * 0.2, 10 * s);
    barText = formatLength(10 ** ZOOM_DECADES[i]!);
  }
  const by = r.y + r.height - pad - 8;
  line(g, r.x + pad, by, r.x + pad + barLen, by, COLOR.ink, 5 * u);
  for (const x of [r.x + pad, r.x + pad + barLen])
    line(g, x, by - 10 * u, x, by + 4 * u, COLOR.ink, 4 * u);
  label(g, barText, r.x + pad + barLen + 14, by - 4, {
    size: o.size * 0.8,
    align: "left",
    color: COLOR.ink,
    weight: 700,
  });
  return spots;
};
