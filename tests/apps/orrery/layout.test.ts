import { describe, expect, it } from "vitest";
import { hitAt, MIN_TARGET, SEAM_SHARE, targets } from "../../../src/apps/orrery/layout";
import type { FrameKind, Rect } from "../../../src/core/types";
import { layoutOf, reachTop, SIZES } from "./helpers";

const KINDS: FrameKind[] = ["panel", "pair", "wall", "kiosk"];
const VARIANTS = ["seasons", "moon"] as const;

const cases = () =>
  KINDS.flatMap((kind) =>
    VARIANTS.flatMap((variant) =>
      [false, true]
        .filter((bank) => !bank || kind === "panel" || kind === "pair")
        .flatMap((bank) =>
          (kind === "wall" ? [true, false] : [false]).map((compare) => ({
            kind,
            variant,
            bank,
            compare,
            name: `${kind} ${variant}${bank ? " bank" : ""}${kind === "wall" && !compare ? " alone" : ""}`,
          })),
        ),
    ),
  );

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("layouts", () => {
  for (const c of cases()) {
    it(`fit the frame, reach and the touch rules: ${c.name}`, () => {
      const l = layoutOf(c.kind, { variant: c.variant, bank: c.bank, compare: c.compare });
      const [w, h] = SIZES[c.kind];
      const reach = reachTop(c.kind);
      const all = targets(l);
      expect(all.length).toBeGreaterThan(3);
      for (const t of all) {
        // Every target is at least 120 venue px across and inside the frame.
        expect(Math.min(t.rect.width, t.rect.height), t.name).toBeGreaterThanOrEqual(MIN_TARGET);
        expect(t.rect.x, t.name).toBeGreaterThanOrEqual(0);
        expect(t.rect.y, t.name).toBeGreaterThanOrEqual(0);
        expect(t.rect.x + t.rect.width, t.name).toBeLessThanOrEqual(w);
        expect(t.rect.y + t.rect.height, t.name).toBeLessThanOrEqual(h);
        // Within adult reach.
        expect(t.rect.y, t.name).toBeGreaterThanOrEqual(reach.adult);
      }
      // No two targets overlap.
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          expect(overlap(all[i]!.rect, all[j]!.rect), `${all[i]!.name} and ${all[j]!.name}`).toBe(
            false,
          );
        }
      }
      // The wheel and spin button are lowest, in a child's reach.
      expect(l.wheel).not.toBeNull();
      expect(l.wheel!.y).toBeGreaterThanOrEqual(reach.child);
      const spin = l.spin!;
      expect(spin.y + spin.height / 2).toBeGreaterThanOrEqual(reach.child);
      // (On a kiosk a child reaches everything, so the order doesn't matter there.)
      for (const t of reach.child > 0 ? all : []) {
        if (t.name === "wheel" || t.name === "spin") continue;
        expect(t.rect.y + t.rect.height / 2, t.name).toBeLessThanOrEqual(l.wheel!.y + 1);
      }
      // Seasons has the tilt slider and Reset; Moon the flat orbit and three speeds.
      if (c.variant === "seasons") {
        expect(l.tilt).not.toBeNull();
        expect(l.resetTilt).not.toBeNull();
        expect(l.flat).toBeNull();
      } else {
        expect(l.tilt).toBeNull();
        expect(l.flat).not.toBeNull();
        expect(l.speeds).toHaveLength(3);
      }
      // A place slider on every solo frame's ground view, none in a bank.
      expect(l.places).toHaveLength(c.bank ? 0 : l.grounds.length);
      // Views inside the frame.
      for (const r of [l.space?.rect, ...l.grounds.map((g) => g.rect)]) {
        if (!r) continue;
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(w + 0.5);
        expect(r.y + r.height).toBeLessThanOrEqual(h + 0.5);
      }
    });
  }

  it("keep every pair control a fifth of the width from the seam, and each view to one half", () => {
    for (const variant of VARIANTS) {
      for (const bank of [false, true]) {
        const l = layoutOf("pair", { variant, bank });
        const seam = 1080;
        const gap = 2160 * SEAM_SHARE;
        for (const t of targets(l)) {
          const near = Math.max(t.rect.x - seam, seam - (t.rect.x + t.rect.width));
          expect(near, `${variant} ${t.name}`).toBeGreaterThanOrEqual(gap);
        }
        const halves = [l.space!.rect, ...l.grounds.map((g) => g.rect)];
        for (const r of halves) {
          expect(r.x + r.width <= seam + 0.5 || r.x >= seam - 0.5).toBe(true);
        }
      }
    }
  });

  it("put the wall's other place on the left and Brisbane on the right, sliders in place order", () => {
    const l = layoutOf("wall");
    expect(l.grounds.map((g) => g.place)).toEqual([1, 0]);
    expect(l.grounds[0]!.rect.x).toBeLessThan(l.space!.rect.x);
    expect(l.grounds[1]!.rect.x).toBeGreaterThan(l.space!.rect.x);
    expect(l.places[0]!.x0).toBeGreaterThan(l.places[1]!.x0);
    const alone = layoutOf("wall", { compare: false });
    expect(alone.grounds).toHaveLength(1);
    expect(alone.space!.rect.x).toBe(0);
  });

  it("give a screen the space view and no controls, with labels over a bank", () => {
    const l = layoutOf("screen", { bank: true });
    expect(targets(l)).toEqual([]);
    expect(l.touch).toBe(false);
    expect(l.bankStrip).not.toBeNull();
    expect(hitAt(l, 2000, 2000)).toBeNull();
    expect(layoutOf("screen").bankStrip).toBeNull();
  });

  it("hit the controls under a finger", () => {
    const l = layoutOf("panel");
    expect(hitAt(l, l.wheel!.x, l.wheel!.y)).toEqual({ kind: "wheel" });
    expect(hitAt(l, l.dial!.x + l.dial!.r * 0.8, l.dial!.y)).toEqual({ kind: "dial" });
    expect(hitAt(l, (l.tilt!.x0 + l.tilt!.x1) / 2, l.tilt!.y + 20)).toEqual({ kind: "tilt" });
    expect(hitAt(l, l.places[0]!.x1, l.places[0]!.y)).toEqual({ kind: "place", index: 0 });
    expect(hitAt(l, 540, l.space!.rect.y + 100)).toEqual({ kind: "space" });
    expect(hitAt(l, 540, l.space!.rect.y + 100, false)).toBeNull();
  });

  it("stay put on a frame larger than the design, controls to the bottom", () => {
    const l = layoutOf("panel");
    const tall = layoutOf("panel", { height: 2100 });
    expect(tall.wheel!.y - l.wheel!.y).toBeCloseTo(180, 9);
    expect(tall.space!.rect.height).toBeGreaterThan(l.space!.rect.height);
  });
});
