/**
 * The 2D stage, drawn with Canvas2D: a flat shape sliding across an upright line (a world of one
 * dimension), with the part of the line inside the shape lit up. The line world sees only that
 * segment. Redrawn only when something it shows changes.
 */
import type { Rect } from "../../core/types";
import { SLICE_COLOR } from "./config";
import type { Mat4, Vec4 } from "./rot";
import type { Shape } from "./shapes";
import { cutOf, REACH, slice2, turned } from "./slice";

export interface Flat {
  place(lane: Rect, focus: Rect, unit: number, ratio: number): void;
  draw(shape: Shape, rot: Mat4, lever: number, color?: string): void;
  dispose(): void;
}

export const createFlat = (root: HTMLElement): Flat => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;pointer-events:none;z-index:1;";
  root.append(canvas);
  const g = canvas.getContext("2d");
  let lane: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let focus: Rect = lane;
  let k = 1;
  let key = "";
  const pts: Vec4[] = [];

  return {
    place(l, f, unit, ratio) {
      lane = l;
      focus = f;
      const r = Math.min(ratio, 2);
      canvas.style.left = `${l.x * unit}px`;
      canvas.style.top = `${l.y * unit}px`;
      canvas.style.width = `${l.width * unit}px`;
      canvas.style.height = `${l.height * unit}px`;
      canvas.width = Math.max(1, Math.round(l.width * unit * r));
      canvas.height = Math.max(1, Math.round(l.height * unit * r));
      k = unit * r;
      key = "";
    },
    draw(shape, rot, lever, color = SLICE_COLOR) {
      const next = `${shape.family}|${lever.toFixed(4)}|${Array.from(rot.subarray(0, 2))
        .map((x) => x.toFixed(4))
        .join(",")}|${color}`;
      if (next === key || !g) return;
      key = next;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      // Venue px within the lane, then shape units about the focus centre.
      const s = Math.min(focus.width / (2 * (REACH + 1) + 0.3), focus.height / 2.6);
      const cx = focus.x - lane.x + focus.width / 2;
      const cy = focus.y - lane.y + focus.height / 2;
      g.setTransform(k * s, 0, 0, -k * s, k * cx, k * cy);
      const px = 1 / s;
      const off = lever * REACH;
      turned(shape, rot, pts);
      // The line world.
      g.lineCap = "round";
      g.shadowColor = "rgba(127,180,255,0.8)";
      g.shadowBlur = 18 * k;
      g.strokeStyle = "rgba(150,195,255,0.75)";
      g.lineWidth = 8 * px;
      g.beginPath();
      g.moveTo(0, -1.25);
      g.lineTo(0, 1.25);
      g.stroke();
      // The shape.
      g.beginPath();
      if (shape.round) g.arc(off, 0, 1, 0, Math.PI * 2);
      else {
        // A polygon's corners in order round it.
        const order = pts
          .map((p, i) => ({ i, a: Math.atan2(p[1], p[0]) }))
          .sort((a, b) => a.a - b.a)
          .map((o) => pts[o.i]!);
        order.forEach((p, i) =>
          i === 0 ? g.moveTo(p[0] + off, p[1]) : g.lineTo(p[0] + off, p[1]),
        );
        g.closePath();
      }
      g.shadowBlur = 0;
      g.fillStyle = "rgba(140,170,255,0.18)";
      g.fill();
      g.shadowColor = "rgba(200,220,255,0.9)";
      g.shadowBlur = 14 * k;
      g.strokeStyle = "rgba(214,228,255,0.95)";
      g.lineWidth = 10 * px;
      g.lineJoin = "round";
      g.stroke();
      // The slice: where the line crosses the shape.
      const sl = slice2(shape, pts, cutOf(2, lever));
      if (sl.kind === "span") {
        g.shadowColor = color;
        g.shadowBlur = 30 * k;
        g.strokeStyle = color;
        g.lineWidth = 22 * px;
        g.beginPath();
        g.moveTo(0, sl.lo);
        g.lineTo(0, sl.hi);
        g.stroke();
        g.fillStyle = "#ffffff";
        for (const y of [sl.lo, sl.hi]) {
          g.beginPath();
          g.arc(0, y, 14 * px, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.shadowBlur = 0;
    },
    dispose() {
      canvas.remove();
    },
  };
};
