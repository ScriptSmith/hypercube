import { describe, expect, it } from "vitest";
import {
  type Circle,
  controlAt,
  layoutFor,
  MIN_DIAL,
  MIN_TARGET,
  SEAM_SHARE,
} from "../../../src/apps/robotarm/layout";
import type { Rect } from "../../../src/core/types";
import { KINDS, layoutInput } from "./helpers";

const controlsOf = (c: { dials: Circle[]; grip: Circle; reset: Circle }) => [
  ...c.dials,
  c.grip,
  c.reset,
];

const inside = (c: Circle, r: Rect) =>
  c.x - c.r >= r.x - 1e-6 &&
  c.x + c.r <= r.x + r.width + 1e-6 &&
  c.y - c.r >= r.y - 1e-6 &&
  c.y + c.r <= r.y + r.height + 1e-6;

const cases = KINDS.flatMap((kind) =>
  (kind === "wall" ? [1, 2, 3] : [1]).map((arms) => ({ kind, arms })),
);

describe("robotarm layout", () => {
  for (const { kind, arms } of cases) {
    const input = layoutInput(kind, { arms });
    const l = layoutFor(input);
    const name = `${kind}${kind === "wall" ? ` with ${arms} arms` : ""}`;

    it(`keeps every control on the frame, in its lane, within reach and big enough: ${name}`, () => {
      expect(l.cells).toHaveLength(kind === "wall" ? arms : 1);
      for (const c of l.cells) {
        expect(c.dials.map((d) => d.joint)).toEqual([0, 1, 2, 3, 4, 5]);
        for (const ctl of controlsOf(c)) {
          expect(inside(ctl, c.lane), `${name} control at ${ctl.x},${ctl.y}`).toBe(true);
          expect(inside(ctl, { x: 0, y: 0, width: l.width, height: l.height })).toBe(true);
          expect(2 * ctl.r).toBeGreaterThanOrEqual(MIN_TARGET);
          expect(ctl.y - ctl.r).toBeGreaterThanOrEqual(input.reachTop.adult - 1e-6);
        }
        for (const d of c.dials) {
          if (kind === "panel" || kind === "pair") expect(2 * d.r).toBeGreaterThanOrEqual(MIN_DIAL);
          if (kind === "wall") expect(2 * d.r).toBeGreaterThan(260);
        }
        expect(2 * c.grip.r).toBeGreaterThanOrEqual(2 * c.dials[0]!.r);
        // Nothing overlaps.
        const all = controlsOf(c);
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            const a = all[i]!;
            const b = all[j]!;
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r + 10);
          }
        }
        // The focus rectangle sits in the lane.
        expect(c.focus.x).toBeGreaterThanOrEqual(c.lane.x);
        expect(c.focus.x + c.focus.width).toBeLessThanOrEqual(c.lane.x + c.lane.width + 1e-6);
        expect(c.focus.height).toBeGreaterThan(l.height * 0.35);
      }
    });

    it(`puts the base dial and the grip lowest, in the children's band: ${name}`, () => {
      for (const c of l.cells) {
        const low = [c.dials[0]!, c.grip];
        const others = c.dials.slice(1);
        for (const a of low) {
          expect(a.y - a.r).toBeGreaterThanOrEqual(input.reachTop.child - 1e-6);
          for (const o of others) expect(a.y).toBeGreaterThan(o.y);
        }
        // The arm's dials climb from the shoulder up to the wrist, never downwards.
        expect(c.dials[3]!.y).toBeLessThanOrEqual(c.dials[1]!.y + 1e-6);
      }
    });

    it(`keeps the view clear of the controls: ${name}`, () => {
      for (const c of l.cells) {
        for (const ctl of controlsOf(c)) {
          const f = c.focus;
          // The pair lets the bench's narrow front edge reach down between its two consoles.
          if (kind === "pair") continue;
          const hit =
            ctl.x + ctl.r > f.x &&
            ctl.x - ctl.r < f.x + f.width &&
            ctl.y + ctl.r > f.y &&
            ctl.y - ctl.r < f.y + f.height;
          expect(hit).toBe(false);
        }
      }
    });

    it(`leaves the Home control a free spot: ${name}`, () => {
      const h = l.home;
      const box = { x: h.x, y: h.y, width: h.size, height: h.size };
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(l.width);
      for (const c of l.cells) {
        for (const ctl of controlsOf(c)) {
          const nx = Math.max(box.x, Math.min(ctl.x, box.x + box.width));
          const ny = Math.max(box.y, Math.min(ctl.y, box.y + box.height));
          expect(Math.hypot(ctl.x - nx, ctl.y - ny)).toBeGreaterThan(ctl.r);
        }
      }
    });
  }

  it("keeps the pair's controls a fifth of the width from the seam, and never mirrored", () => {
    const input = layoutInput("pair");
    const l = layoutFor(input);
    const seam = input.seams[0]!;
    const c = l.cells[0]!;
    const all = controlsOf(c);
    for (const ctl of all) {
      expect(Math.abs(ctl.x - seam) - ctl.r).toBeGreaterThanOrEqual(SEAM_SHARE * l.width - 1e-6);
    }
    // Base, shoulder, elbow and grip on the left; roll, bend and twist on the right.
    for (const j of [0, 1, 2]) expect(c.dials[j]!.x).toBeLessThan(seam);
    expect(c.grip.x).toBeLessThan(seam);
    for (const j of [3, 4, 5]) expect(c.dials[j]!.x).toBeGreaterThan(seam);
    // No control on one half has a twin at the mirror place on the other.
    const left = all.filter((a) => a.x < seam);
    const right = all.filter((a) => a.x > seam);
    for (const a of left) {
      for (const b of right) {
        const mirrored = Math.abs(seam - a.x - (b.x - seam)) < 150;
        if (mirrored) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(140);
      }
    }
  });

  it("hit-tests dials and the grip, with a little slop", () => {
    const l = layoutFor(layoutInput("wall", { arms: 3 }));
    const c = l.cells[2]!;
    const d = c.dials[4]!;
    expect(controlAt(l, d.x, d.y)).toEqual({ cell: 2, kind: "dial", joint: 4 });
    expect(controlAt(l, d.x + d.r + 20, d.y)).toEqual({ cell: 2, kind: "dial", joint: 4 });
    expect(controlAt(l, c.grip.x, c.grip.y)).toEqual({ cell: 2, kind: "grip" });
    expect(controlAt(l, c.focus.x + 10, c.focus.y + 10)).toBeNull();
  });

  it("scales with an uneven reach and still fits", () => {
    const input = layoutInput("wall", { reachTop: { adult: 1200, child: 1700 }, arms: 2 });
    const l = layoutFor(input);
    for (const c of l.cells) {
      for (const ctl of controlsOf(c)) {
        expect(ctl.y - ctl.r).toBeGreaterThanOrEqual(1200);
        expect(ctl.y + ctl.r).toBeLessThanOrEqual(l.height);
      }
    }
  });
});
