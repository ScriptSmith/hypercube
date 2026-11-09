import { describe, expect, it } from "vitest";
import {
  buttonAt,
  type Layout,
  layoutFrame,
  MIN_BUTTON,
  seamsOf,
} from "../../../src/apps/ballpit/layout";
import { boundsOf, pointAt, type PathPoint } from "../../../src/apps/ballpit/pipes";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind } from "../../../src/core/types";

const INLETS = Array.from({ length: 6 }, (_, k) => ((k + 0.5) * VENUE_SIZE.screen.width) / 6);

const frame = (
  kind: FrameKind,
  variant: "one" | "two",
  answers: number[],
  span = 2,
  feeder = false,
) => {
  const size = VENUE_SIZE[kind];
  const W = kind === "pair" ? 1080 * span : size.width;
  const H = size.height;
  const reach = DEFAULT_REACH[kind];
  return layoutFrame({
    kind,
    W,
    H,
    span: kind === "pair" ? span : 1,
    adultTop: H * (1 - reach.adult),
    childTop: H * (1 - reach.child),
    variant,
    answers,
    feeder,
    inlets: kind === "screen" ? INLETS : undefined,
  });
};

const touchKinds: FrameKind[] = ["panel", "pair", "wall", "kiosk"];
const variants = ["one", "two"] as const;
const counts = [2, 3, 4, 5, 6];
const answersFor = (variant: "one" | "two", n: number) =>
  variant === "one" ? [n] : [Math.min(n, 4), n];

const each = (
  fn: (l: Layout, kind: FrameKind, variant: "one" | "two", n: number, feeder: boolean) => void,
) => {
  for (const kind of touchKinds)
    for (const variant of variants)
      for (const n of counts) {
        fn(frame(kind, variant, answersFor(variant, n)), kind, variant, n, false);
        if (kind === "panel" || kind === "pair")
          fn(frame(kind, variant, answersFor(variant, n), 2, true), kind, variant, n, true);
      }
};

const at = (path: Parameters<typeof pointAt>[0], s: number): PathPoint =>
  pointAt(path, s, { x: 0, y: 0, dx: 0, dy: 0 });

const overlap = (
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("ballpit layout", () => {
  it("never puts a button or a pipe across a seam", () => {
    for (const feeder of [false, true]) {
      for (const span of [2, 3]) {
        for (const variant of variants) {
          for (const n of counts) {
            const l = frame("pair", variant, answersFor(variant, n), span, feeder);
            for (const seam of seamsOf(l.W, span)) {
              for (const b of l.blocks.flatMap((x) => x.buttons)) {
                expect(b.x + b.w <= seam || b.x >= seam, `button ${b.answer} over seam`).toBe(true);
              }
              for (const p of l.pipes) {
                const bb = boundsOf(p.path, p.inner + 2 * p.wall);
                expect(bb.x1 <= seam + 0.5 || bb.x0 >= seam - 0.5, `pipe over seam ${seam}`).toBe(
                  true,
                );
              }
            }
          }
        }
      }
    }
  });

  it("gives every panel of a merged frame every answer", () => {
    for (const feeder of [false, true]) {
      const l = frame("pair", "one", [6], 2, feeder);
      for (const cell of [0, 1]) {
        const answers = l.blocks
          .filter((b) => b.cell === cell)
          .flatMap((b) => b.buttons.map((x) => x.answer));
        expect(answers.sort()).toEqual([0, 1, 2, 3, 4, 5]);
      }
    }
  });

  it("makes buttons big enough for each kind", () => {
    each((l, kind) => {
      for (const b of l.blocks.flatMap((x) => x.buttons)) {
        expect(Math.min(b.w, b.h), `${kind} button`).toBeGreaterThanOrEqual(
          Math.min(MIN_BUTTON[kind], 190),
        );
        expect(b.w).toBeGreaterThanOrEqual(MIN_BUTTON[kind]);
        expect(Math.min(b.w, b.h)).toBeGreaterThanOrEqual(120);
      }
    });
  });

  it("keeps children's buttons in the child band and adults' in the adult band", () => {
    each((l, kind, variant) => {
      const H = l.H;
      const reach = DEFAULT_REACH[kind];
      const childTop = H * (1 - reach.child);
      const adultTop = H * (1 - reach.adult);
      for (const block of l.blocks) {
        for (const b of block.buttons) {
          expect(b.y + b.h).toBeLessThanOrEqual(H);
          if (block.slot === 0)
            expect(b.y, `${kind} ${variant} child button`).toBeGreaterThanOrEqual(childTop - 1);
          else expect(b.y, `${kind} adult button`).toBeGreaterThanOrEqual(adultTop - 1);
        }
      }
    });
    // On the wall the adults' buttons sit above the children's reach.
    const wall = frame("wall", "two", [4, 6]);
    const adult = wall.blocks.find((b) => b.slot === 1)!;
    const childTop = wall.H * (1 - DEFAULT_REACH.wall.child);
    for (const b of adult.buttons) expect(b.y + b.h).toBeLessThanOrEqual(childTop + 1);
  });

  it("stands each tube with its pipe over its button, fed from the button's top edge", () => {
    each((l, kind, variant, n, feeder) => {
      if (feeder) return;
      const what = `${kind} ${variant} ${n}`;
      for (const block of l.blocks) {
        for (const [k, t] of block.tubes.entries()) {
          expect(t.x0).toBeGreaterThanOrEqual(block.region.x);
          expect(t.x1).toBeLessThanOrEqual(block.region.x + block.region.w);
          expect(t.bottom - t.top, what).toBeGreaterThan(kind === "kiosk" ? 140 : 100);
          const b = block.buttons.find((x) => x.answer === t.answer)!;
          expect(t.bottom).toBeLessThan(Math.min(...block.buttons.map((x) => x.y)));
          const cx = (t.x0 + t.x1) / 2;
          expect(cx).toBeGreaterThan(b.x);
          expect(cx).toBeLessThan(b.x + b.w);
          // The pipe starts on the button's top edge, clear of its rounded corners...
          const way = block.ways[t.answer]!;
          const start = way.path.start;
          expect(start.y).toBeCloseTo(b.y);
          expect(start.x, what).toBeGreaterThan(b.x + 10);
          expect(start.x, what).toBeLessThan(b.x + b.w - 10);
          // ...and ends at an outlet over the middle of the tube's mouth, pointing down.
          const end = at(way.path, way.path.length);
          expect(end.x).toBeCloseTo(cx);
          expect(end.y).toBeLessThan(t.top);
          expect(end.y).toBeGreaterThan(t.top - 60);
          expect(end.dy).toBeCloseTo(1);
          // The pipe and its hook stay below the question and inside the block.
          const spout = block.spouts[k]!;
          const bb = boundsOf(way.path, spout.inner + 2 * spout.wall);
          expect(bb.y0, what).toBeGreaterThanOrEqual(block.text.y + block.text.h);
          expect(bb.x0).toBeGreaterThanOrEqual(block.region.x);
          expect(bb.x1).toBeLessThanOrEqual(block.region.x + block.region.w);
          // Balls fit in the pipe.
          expect(2 * way.r).toBeLessThan(spout.inner);
        }
      }
    });
  });

  it("keeps every pipe's climb clear of the other tubes and the other pipes", () => {
    each((l, kind, variant, n, feeder) => {
      if (feeder) return;
      const what = `${kind} ${variant} ${n}`;
      for (const block of l.blocks) {
        const climbs = block.spouts.map((s) => {
          const half = s.inner / 2 + s.wall;
          const top = s.yOut - 1.15 * s.bend;
          const foot = block.buttons.find((b) => b.answer === s.answer)!.y;
          return { x0: s.x - half, x1: s.x + half, y0: top, y1: foot, answer: s.answer };
        });
        for (const c of climbs) {
          for (const t of block.tubes) {
            const glass = {
              x0: t.x0 - block.glass,
              x1: t.x1 + block.glass,
              y0: t.top,
              y1: t.bottom,
            };
            expect(overlap(c, glass), `${what}: pipe ${c.answer} into tube ${t.answer}`).toBe(
              false,
            );
          }
          for (const d of climbs) {
            if (d === c) continue;
            expect(overlap(c, d), `${what}: pipes ${c.answer} and ${d.answer}`).toBe(false);
          }
          // Other answers' buttons don't sit on this pipe's way up.
          for (const b of block.buttons) {
            if (b.answer === c.answer) continue;
            const box = { x0: b.x, x1: b.x + b.w, y0: b.y, y1: b.y + b.h };
            expect(overlap(c, box), `${what}: pipe ${c.answer} over button ${b.answer}`).toBe(
              false,
            );
          }
        }
      }
    });
  });

  it("uses one row for up to four answers on a panel, two for more", () => {
    const rows = (n: number) =>
      new Set(frame("panel", "one", [n]).blocks[0]!.buttons.map((b) => b.y)).size;
    expect(rows(2)).toBe(1);
    expect(rows(4)).toBe(1);
    expect(rows(5)).toBe(2);
    expect(rows(6)).toBe(2);
  });

  it("gives a panel under a screen only buttons, filling its band, around a riser", () => {
    for (const kind of ["panel", "pair"] as const) {
      for (const variant of variants) {
        for (const n of counts) {
          const l = frame(kind, variant, answersFor(variant, n), 2, true);
          const what = `${kind} ${variant} ${n}`;
          const cells = kind === "pair" ? 2 : 1;
          const cellW = l.W / cells;
          expect(l.risers.length).toBe(cells);
          for (const [c, rx] of l.risers.entries()) expect(rx).toBeCloseTo((c + 0.5) * cellW);
          for (const block of l.blocks) {
            expect(block.tubes).toEqual([]);
            let area = 0;
            for (const b of block.buttons) {
              area += b.w * b.h;
              // Each button sends its ball from its inner edge, through the riser, off the top.
              const way = block.ways[b.answer]!;
              expect(way.lands).toBe(false);
              const rx = l.risers[block.cell]!;
              expect(Math.abs(way.path.start.x - rx)).toBeLessThan(cellW / 4);
              expect(way.path.start.y).toBeGreaterThan(b.y);
              expect(way.path.start.y).toBeLessThan(b.y + b.h);
              const end = at(way.path, way.path.length);
              expect(end.y).toBeLessThan(-way.r);
              expect(end.x).toBeCloseTo(rx);
              // The riser runs between the buttons, never over one.
              expect(b.x + b.w <= rx - 50 || b.x >= rx + 50, what).toBe(true);
            }
            expect(area / (block.region.w * block.region.h), what).toBeGreaterThan(0.6);
          }
        }
      }
    }
  });

  it("lays out the screen with labels, no buttons, and a pipe from each panel to each tube", () => {
    for (const variant of variants) {
      for (const n of counts) {
        const l = frame("screen", variant, answersFor(variant, n));
        const net = l.network!;
        const what = `screen ${variant} ${n}`;
        expect(net.inlets.length).toBe(6);
        for (const [bi, block] of l.blocks.entries()) {
          expect(block.buttons).toEqual([]);
          expect(block.labels.length).toBe(block.tubes.length);
          for (const lb of block.labels) {
            expect(lb.y + lb.size).toBeLessThanOrEqual(l.H);
            // Pictures sit above the header.
            expect(lb.y + lb.size * 1.5).toBeLessThan(net.yHeader - 60);
          }
          for (const [k, t] of block.tubes.entries()) {
            const s = block.spouts[k]!;
            // The branch climbs clear of every tube and every picture.
            const half = s.inner / 2 + s.wall;
            const climb = { x0: s.x - half, x1: s.x + half, y0: t.top - 200, y1: net.yHeader };
            for (const u of block.tubes) {
              const glass = {
                x0: u.x0 - block.glass,
                x1: u.x1 + block.glass,
                y0: u.top,
                y1: u.bottom,
              };
              expect(overlap(climb, glass), `${what}: branch ${k} into tube ${u.answer}`).toBe(
                false,
              );
            }
            for (const lb of block.labels) {
              const pic = {
                x0: lb.cx - lb.size / 2,
                x1: lb.cx + lb.size / 2,
                y0: lb.y,
                y1: lb.y + lb.size,
              };
              expect(overlap(climb, pic), `${what}: branch ${k} over picture ${lb.answer}`).toBe(
                false,
              );
            }
            for (const i of [0, 3, 5]) {
              const way = net.way(i, bi, t.answer)!;
              expect(way.path.start.y).toBeGreaterThan(l.H);
              expect(way.path.start.x).toBeCloseTo(INLETS[i]!);
              const end = at(way.path, way.path.length);
              expect(end.x).toBeCloseTo((t.x0 + t.x1) / 2);
              expect(end.y).toBeLessThan(t.top);
              expect(end.dy).toBeCloseTo(1);
              // Every way books its inlet, its lane and its branch.
              const ids = way.nodes.map((nd) => nd.id);
              expect(ids).toContain(`i${i}`);
              expect(ids).toContain(`b${bi}.${t.answer}`);
              expect(ids.some((id) => id.startsWith("U") || id.startsWith("L"))).toBe(true);
            }
          }
        }
        expect(net.nearest(INLETS[3]! + 20)).toBe(3);
      }
    }
  });

  it("finds the button under a point", () => {
    const l = frame("panel", "one", [4]);
    const b = l.blocks[0]!.buttons[2]!;
    expect(buttonAt(l, b.x + 5, b.y + 5)?.button.answer).toBe(2);
    expect(buttonAt(l, b.x - 1, b.y + 5)?.button.answer).not.toBe(2);
    expect(buttonAt(l, 10, 10)).toBeNull();
  });
});
