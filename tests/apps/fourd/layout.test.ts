import { describe, expect, it } from "vitest";
import {
  controlRects,
  DIAL_PLANES,
  hitAt,
  type Layout,
  leverAt,
  leverX,
  MIN_TARGET,
  SEAM_SHARE,
} from "../../../src/apps/fourd/layout";
import type { Dim } from "../../../src/apps/fourd/shapes";
import { VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind, Rect } from "../../../src/core/types";
import { layoutOf, reachTop, SIZES } from "./helpers";

interface Case {
  name: string;
  kind: FrameKind;
  l: Layout;
}

const cases: Case[] = [];
const add = (name: string, kind: FrameKind, dims: Dim[], bank = false) =>
  cases.push({ name, kind, l: layoutOf(kind, dims, { bank }) });
for (const d of [3, 4] as const) {
  add(`panel ${d}D`, "panel", [d]);
  add(`bank panel ${d}D`, "panel", [d], true);
  add(`kiosk ${d}D`, "kiosk", [d]);
  add(`bank pair ${d}D`, "pair", [d], true);
  add(`wall three ${d}D`, "wall", [d, d, d]);
}
add("pair 3D and 4D", "pair", [3, 4]);
add("pair two 3D", "pair", [3, 3]);
add("wall ladder", "wall", [2, 3, 4]);

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (r: Rect, W: number, H: number) =>
  r.x >= 0 && r.y >= 0 && r.x + r.width <= W + 1e-6 && r.y + r.height <= H + 1e-6;

describe("layout", () => {
  for (const c of cases) {
    describe(c.name, () => {
      const { l, kind } = c;
      const [W, H] = SIZES[kind];
      it("has the stages, dials and buttons each dimension needs", () => {
        for (const st of l.stages) {
          expect(st.dials.length).toBe(DIAL_PLANES[st.dim].length);
          expect(st.orients.length).toBe(st.dim);
          expect(st.shapes.length).toBe(4);
          expect(st.lever).not.toBeNull();
          expect(st.views.length).toBeGreaterThan(0);
        }
      });

      it("keeps every control on the frame, at least 120 venue px, and apart", () => {
        const all: { st: number; r: Rect }[] = [];
        for (const st of l.stages) {
          for (const r of controlRects(st)) {
            expect(inside(r, W, H), `${JSON.stringify(r)} on the frame`).toBe(true);
            expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(MIN_TARGET - 1e-6);
            all.push({ st: st.index, r });
          }
        }
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            expect(
              overlap(all[i]!.r, all[j]!.r),
              `${JSON.stringify(all[i])} and ${JSON.stringify(all[j])}`,
            ).toBe(false);
          }
        }
      });

      it("puts the lever lowest, and the view's focus above the controls", () => {
        for (const st of l.stages) {
          const lever = st.lever!;
          // A kiosk is in everyone's reach; its buttons run down its right edge beside the lever.
          if (kind !== "kiosk") {
            for (const d of st.dials) expect(lever.y).toBeGreaterThan(d.y);
            for (const o of st.orients)
              expect(lever.y).toBeGreaterThan(o.rect.y + o.rect.height / 2);
          }
          for (const v of st.views) {
            const bottom = v.focus.y + v.focus.height;
            for (const r of controlRects(st)) {
              if (r.x < v.focus.x + v.focus.width && r.x + r.width > v.focus.x) {
                expect(bottom, `focus above ${JSON.stringify(r)}`).toBeLessThanOrEqual(r.y + 1);
              }
            }
            expect(v.focus.height).toBeGreaterThan(300);
          }
        }
      });

      it("keeps controls within reach, the lever and shapes in the children's band", () => {
        const reach = reachTop(kind);
        for (const st of l.stages) {
          for (const r of controlRects(st)) expect(r.y).toBeGreaterThanOrEqual(reach.adult - 1);
          if (kind === "wall" || kind === "panel") {
            expect(st.lever!.y - st.lever!.h / 2).toBeGreaterThanOrEqual(reach.child - 1);
          }
          if (kind === "wall") {
            for (const s of st.shapes) expect(s.rect.y).toBeGreaterThanOrEqual(reach.child - 1);
            for (const r of controlRects(st))
              expect(r.y + r.height).toBeLessThanOrEqual(H * 0.92 + 1);
          }
        }
      });

      if (kind === "pair") {
        it("keeps controls a fifth of the width clear of the seam", () => {
          const seam = W / 2;
          for (const st of l.stages) {
            for (const r of controlRects(st)) {
              const gap = r.x >= seam ? r.x - seam : seam - (r.x + r.width);
              expect(gap).toBeGreaterThanOrEqual(SEAM_SHARE * W - 1);
            }
          }
        });
      }

      it("hits each control at its centre, and the view elsewhere", () => {
        for (const st of l.stages) {
          const lv = st.lever!;
          expect(hitAt(l, (lv.x0 + lv.x1) / 2, lv.y)).toEqual({ stage: st.index, kind: "lever" });
          for (const d of st.dials)
            expect(hitAt(l, d.x, d.y)).toEqual({ stage: st.index, kind: "dial", index: d.index });
          for (const o of st.orients) {
            expect(hitAt(l, o.rect.x + o.rect.width / 2, o.rect.y + o.rect.height / 2)).toEqual({
              stage: st.index,
              kind: "orient",
              k: o.k,
            });
          }
          for (const s of st.shapes) {
            expect(hitAt(l, s.rect.x + s.rect.width / 2, s.rect.y + s.rect.height / 2)).toEqual({
              stage: st.index,
              kind: "shape",
              family: s.family,
            });
          }
          const v = st.views[0]!;
          const h = hitAt(l, v.focus.x + v.focus.width / 2, v.focus.y + v.focus.height / 2);
          expect(h).toEqual({ stage: st.index, kind: "view", view: 0 });
          if (st.reset) expect(hitAt(l, st.reset.x, st.reset.y)).toBeNull();
        }
      });
    });
  }

  it("a bank's pair shows its slice on the left and the shadow on the right", () => {
    const l = layoutOf("pair", [4], { bank: true });
    const st = l.stages[0]!;
    expect(st.views.map((v) => v.kind)).toEqual(["slice", "stage"]);
    expect(st.views[0]!.lane.x + st.views[0]!.lane.width).toBeLessThanOrEqual(1080);
    expect(st.views[1]!.lane.x).toBeGreaterThanOrEqual(1080);
  });

  it("a screen on its own has views and no controls", () => {
    const l = layoutOf("screen", [2, 3, 4]);
    expect(l.stages.length).toBe(3);
    for (const st of l.stages) {
      expect(controlRects(st)).toEqual([]);
      expect(st.views.length).toBe(1);
    }
    // The 4D stage gets the whole width below.
    expect(l.stages[2]!.views[0]!.lane.width).toBe(VENUE_SIZE.screen.width);
  });

  it("maps the lever's travel both ways", () => {
    const l = layoutOf("panel", [4]).stages[0]!.lever!;
    expect(leverAt(l, l.x0)).toBe(-1);
    expect(leverAt(l, l.x1)).toBe(1);
    expect(leverAt(l, l.x0 - 100)).toBe(-1);
    for (const t of [-0.6, 0, 0.3]) expect(leverAt(l, leverX(l, t))).toBeCloseTo(t, 12);
  });
});
