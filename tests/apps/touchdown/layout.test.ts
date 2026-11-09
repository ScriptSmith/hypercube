import { describe, expect, it } from "vitest";
import {
  layoutFor,
  nearPad,
  padAt,
  type PadSpec,
  PAIR_EDGE,
} from "../../../src/apps/touchdown/layout";
import type { Rect } from "../../../src/core/types";
import { KINDS, layoutInput, layoutOf } from "./helpers";

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const gapX = (a: Rect, b: Rect) => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));

const VARIANTS = ["duo", "crew"] as const;

describe("touchdown layout", () => {
  for (const kind of KINDS) {
    for (const variant of VARIANTS) {
      it(`keeps every control on the frame, apart and big enough on a ${kind} (${variant})`, () => {
        const crews = kind === "wall" ? [1, 2, 3] : [1];
        for (const n of crews) {
          const l = layoutOf(kind, variant, n);
          expect(l.crews).toHaveLength(n);
          const pads = l.crews.flatMap((c) => c.pads);
          expect(pads).toHaveLength(n * (variant === "duo" ? 2 : 3));
          for (const p of pads) {
            const r = p.rect;
            expect(r.x).toBeGreaterThanOrEqual(0);
            expect(r.y).toBeGreaterThanOrEqual(0);
            expect(r.x + r.width).toBeLessThanOrEqual(l.width);
            expect(r.y + r.height).toBeLessThanOrEqual(l.height);
            expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(120);
            if (kind === "panel" || kind === "pair") {
              expect(r.width).toBeGreaterThanOrEqual(300);
              expect(r.height).toBeGreaterThanOrEqual(420);
            }
            if (kind === "wall") expect(r.width).toBeGreaterThanOrEqual(480);
          }
          for (let i = 0; i < pads.length; i++) {
            for (let j = i + 1; j < pads.length; j++) {
              expect(overlaps(pads[i]!.rect, pads[j]!.rect)).toBe(false);
            }
          }
          for (const c of l.crews) {
            const r = c.reset;
            expect(2 * r.r).toBeGreaterThanOrEqual(120);
            const box = { x: r.x - r.r, y: r.y - r.r, width: 2 * r.r, height: 2 * r.r };
            for (const p of pads) expect(overlaps(box, p.rect)).toBe(false);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(l.width);
            expect(box.y + box.height).toBeLessThanOrEqual(l.height);
            const input = layoutInput(kind, variant);
            expect(box.y).toBeGreaterThanOrEqual(input.reachTop.adult);
            // Each crew's pads sit in its own lane.
            for (const p of c.pads) {
              expect(p.rect.x).toBeGreaterThanOrEqual(kind === "wall" ? c.lane.x0 : 0);
              expect(p.rect.x + p.rect.width).toBeLessThanOrEqual(
                kind === "wall" ? c.lane.x1 : l.width,
              );
            }
          }
        }
      });
    }
  }

  it("puts duo pads and the crew's main engine in the child band", () => {
    for (const kind of KINDS) {
      for (const variant of VARIANTS) {
        const input = layoutInput(kind, variant);
        const l = layoutFor(input);
        for (const p of l.crews.flatMap((c) => c.pads)) {
          if (p.role === "turnLeft" || p.role === "turnRight") continue;
          expect(p.rect.y, `${kind} ${variant} ${p.role}`).toBeGreaterThanOrEqual(
            input.reachTop.child,
          );
        }
      }
    }
  });

  it("puts the crew's turn pads in the adult band on a wall and a pair", () => {
    for (const kind of ["wall", "pair"] as const) {
      const input = layoutInput(kind, "crew");
      const l = layoutFor(input);
      const turns = l.crews.flatMap((c) => c.pads).filter((p) => p.role.startsWith("turn"));
      expect(turns.length).toBeGreaterThan(0);
      for (const p of turns) {
        expect(p.rect.y).toBeGreaterThanOrEqual(input.reachTop.adult);
        expect(p.rect.y + p.rect.height).toBeLessThanOrEqual(input.reachTop.child);
      }
    }
  });

  it("keeps a pair's players at the outer edges, one per half, clear of the seam", () => {
    for (const variant of VARIANTS) {
      const l = layoutOf("pair", variant);
      const seam = l.width / 2;
      const pads = l.crews[0]!.pads;
      for (const p of pads) {
        const r = p.rect;
        const left = r.x + r.width <= seam;
        expect(left || r.x >= seam).toBe(true);
        expect(Math.min(Math.abs(r.x - seam), Math.abs(r.x + r.width - seam))).toBeGreaterThan(300);
        expect(Math.min(r.x, l.width - r.x - r.width)).toBeGreaterThanOrEqual(PAIR_EDGE);
      }
      // The two players stand on different halves.
      const halves = new Set(pads.map((p) => p.rect.x < seam));
      expect(halves.size).toBe(2);
    }
    const duo = layoutOf("pair", "duo").crews[0]!.pads;
    expect(duo.find((p) => p.role === "left")!.rect.x).toBe(PAIR_EDGE);
    expect(duo.find((p) => p.role === "right")!.rect.x + 300).toBe(2160 - PAIR_EDGE);
  });

  it("keeps neighbouring wall crews' pads at least 400 px apart", () => {
    for (const variant of VARIANTS) {
      for (const n of [2, 3]) {
        const l = layoutOf("wall", variant, n);
        for (let i = 1; i < n; i++) {
          const a = l.crews[i - 1]!.pads;
          const b = l.crews[i]!.pads;
          for (const p of a)
            for (const q of b) expect(gapX(p.rect, q.rect)).toBeGreaterThanOrEqual(400);
        }
      }
    }
  });

  it("keeps duo pads below the ground, so hands never cover the craft or a landing pad", () => {
    for (const kind of ["panel", "pair", "wall"] as const) {
      const l = layoutOf(kind, "duo");
      for (const p of l.crews.flatMap((c) => c.pads)) {
        expect(p.rect.y).toBeGreaterThan(l.ground.bottom);
      }
    }
  });

  it("sizes the craft from the drop so the game plays the same at every scale", () => {
    for (const kind of KINDS) {
      for (const variant of VARIANTS) {
        const l = layoutOf(kind, variant);
        expect(l.drop / l.craft).toBeCloseTo(6.2, 6);
        expect(l.spawnY).toBeLessThan(l.ground.top - l.drop * 0.5);
        expect(l.craft, kind).toBeGreaterThan(kind === "kiosk" ? 110 : 140);
      }
    }
  });

  it("follows an operator's reach override", () => {
    const low = layoutFor(layoutInput("panel", "duo", { reachTop: { adult: 0, child: 1300 } }));
    for (const p of low.crews[0]!.pads) {
      expect(p.rect.y).toBeGreaterThanOrEqual(1300 - 120);
      expect(p.rect.height).toBeGreaterThanOrEqual(300);
    }
  });

  it("finds pads under a finger, with some slop, and lets go far off", () => {
    const l = layoutOf("pair");
    const p = l.crews[0]!.pads[0]! as PadSpec;
    const r = p.rect;
    expect(padAt(l, r.x + r.width / 2, r.y + r.height / 2)).toBe(p);
    expect(padAt(l, r.x - 10, r.y + 10)).toBe(p);
    expect(padAt(l, l.width / 2, 100)).toBeNull();
    expect(nearPad(p, r.x - 100, r.y)).toBe(true);
    expect(nearPad(p, r.x + r.width + 400, r.y)).toBe(false);
  });
});
