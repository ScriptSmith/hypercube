import { describe, expect, it } from "vitest";
import {
  type ChooseLayout,
  type ChooseSpec,
  type ControlShape,
  layoutChoose,
} from "../../../src/apps/menu/chooselayout";
import { runsSolo } from "../../../src/apps/menu/catalog";
import { controlFor, variantChoices, visitorOptions } from "../../../src/apps/menu/choices";
import type { MenuFrame } from "../../../src/apps/menu/layout";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { listApps } from "../../../src/core/registry";
import type { FrameKind, Rect } from "../../../src/core/types";

const KINDS: FrameKind[] = ["panel", "pair", "wall", "kiosk"];
const MIN_TARGET = 120;

const frameOf = (kind: FrameKind, over: Partial<MenuFrame> = {}): MenuFrame => {
  const { width, height } = VENUE_SIZE[kind];
  const reach = DEFAULT_REACH[kind];
  return {
    kind,
    width,
    height,
    unit: 1,
    reachTop: { adult: height * (1 - reach.adult), child: height * (1 - reach.child) },
    seams: kind === "pair" ? [width / 2] : [],
    ...over,
  };
};

const seg = (count: number): ControlShape => ({ kind: "segments", count });

const SPECS: Record<string, ChooseSpec> = {
  "three variants and four options": {
    variants: 3,
    controls: [seg(3), seg(3), seg(3), seg(4)],
  },
  "a preset with four options": { variants: 0, controls: [seg(3), seg(3), seg(3), seg(4)] },
  "variants only": { variants: 3, controls: [] },
  "one option": { variants: 0, controls: [{ kind: "toggle" }] },
  "six options, as hockey on a wall": {
    variants: 3,
    controls: [seg(3), seg(3), seg(3), { kind: "toggle" }, seg(2), seg(4)],
  },
  "every control kind": {
    variants: 4,
    controls: [seg(5), { kind: "stepper" }, { kind: "toggle" }, seg(2), seg(4)],
  },
};

/** Everything a finger can press. A stepper's middle part shows the value and isn't pressed. */
const targets = (l: ChooseLayout, spec: ChooseSpec): Rect[] => [
  ...l.variants,
  ...l.controls.flatMap((c, i) =>
    spec.controls[i]?.kind === "stepper" ? [c.parts[0]!, c.parts[2]!] : c.parts,
  ),
  l.play,
  l.back,
];

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - 1e-6 &&
  b.x < a.x + a.width - 1e-6 &&
  a.y < b.y + b.height - 1e-6 &&
  b.y < a.y + a.height - 1e-6;

describe("choose layout", () => {
  for (const kind of KINDS) {
    const f = frameOf(kind);
    describe(kind, () => {
      for (const [name, spec] of Object.entries(SPECS)) {
        const l = layoutChoose(f, spec);
        const all = targets(l, spec);

        it(`places every part (${name})`, () => {
          expect(l.variants).toHaveLength(spec.variants);
          expect(l.controls).toHaveLength(spec.controls.length);
          spec.controls.forEach((c, i) => {
            const parts = l.controls[i]!.parts;
            expect(parts).toHaveLength(
              c.kind === "segments" ? c.count : c.kind === "stepper" ? 3 : 1,
            );
          });
        });

        it(`keeps every target in the frame and the adult band (${name})`, () => {
          for (const r of all) {
            expect(r.x).toBeGreaterThanOrEqual(-1e-6);
            expect(r.x + r.width).toBeLessThanOrEqual(f.width + 1e-6);
            expect(r.y).toBeGreaterThanOrEqual(f.reachTop.adult - 1e-6);
            expect(r.y + r.height).toBeLessThanOrEqual(f.height + 1e-6);
          }
        });

        it(`makes targets at least ${MIN_TARGET} venue px and Play bigger still (${name})`, () => {
          for (const r of all) {
            expect(r.width).toBeGreaterThanOrEqual(MIN_TARGET - 1e-6);
            expect(r.height).toBeGreaterThanOrEqual(MIN_TARGET - 1e-6);
          }
          expect(l.play.width * l.play.height).toBeGreaterThan(l.back.width * l.back.height);
          expect(l.play.height).toBeGreaterThanOrEqual(150);
        });

        it(`never overlaps two targets, or a label and a target (${name})`, () => {
          for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
              expect(overlap(all[i]!, all[j]!), `${i} and ${j}`).toBe(false);
            }
          }
          for (const c of l.controls) {
            for (const r of all) expect(overlap(c.label, r)).toBe(false);
          }
        });

        it(`keeps the title clear of everything else (${name})`, () => {
          const h = l.header;
          const box = { x: h.x - h.width / 2, y: h.y - h.size / 2, width: h.width, height: h.size };
          for (const r of [...all, ...l.controls.map((c) => c.label)]) {
            expect(overlap(box, r)).toBe(false);
          }
          expect(box.y).toBeGreaterThanOrEqual(0);
        });
      }
    });
  }

  it("puts Play low on a panel, in children's reach", () => {
    const f = frameOf("panel");
    const l = layoutChoose(f, SPECS["three variants and four options"]!);
    expect(l.play.y).toBeGreaterThanOrEqual(f.reachTop.child);
    expect(l.play.y + l.play.height).toBeCloseTo(f.height - 56, 6);
  });

  it("keeps a pair's controls a fifth of a panel clear of the seam", () => {
    const f = frameOf("pair");
    for (const spec of Object.values(SPECS)) {
      const l = layoutChoose(f, spec);
      for (const r of [...targets(l, spec), ...l.controls.map((c) => c.label)]) {
        const near = r.x < 1080 + 216 - 1e-6 && r.x + r.width > 1080 - 216 + 1e-6;
        expect(near).toBe(false);
      }
      // Back and Play sit at opposite outer edges.
      expect(l.back.x).toBeLessThan(1080);
      expect(l.play.x).toBeGreaterThan(1080);
      expect(l.header.x + l.header.width / 2).toBeLessThanOrEqual(1080);
    }
  });

  it("puts a wall's step in front of the tile that was tapped, inside the frame", () => {
    const f = frameOf("wall");
    const spec = SPECS["three variants and four options"]!;
    const box = (l: ChooseLayout) => {
      const rs = targets(l, spec);
      const left = Math.min(...rs.map((r) => r.x));
      const right = Math.max(...rs.map((r) => r.x + r.width));
      return { left, right, mid: (left + right) / 2 };
    };
    const centre = f.width / 2;
    const mid = box(layoutChoose(f, { ...spec, anchorX: centre }));
    expect(mid.mid).toBeCloseTo(centre, 0);
    const left = box(layoutChoose(f, { ...spec, anchorX: 200 }));
    expect(left.left).toBeGreaterThanOrEqual(0);
    expect(left.mid).toBeLessThan(centre);
    const right = box(layoutChoose(f, { ...spec, anchorX: f.width - 80 }));
    expect(right.right).toBeLessThanOrEqual(f.width);
    expect(right.mid).toBeGreaterThan(centre);
  });

  it("shares a wall's options evenly between columns of at most four rows", () => {
    const f = frameOf("wall");
    for (const [n, cols] of [
      [3, 1],
      [4, 1],
      [5, 2],
      [6, 2],
      [7, 2],
      [9, 3],
    ] as const) {
      const controls = Array.from({ length: n }, (_, i) =>
        i % 3 === 0 ? { kind: "toggle" as const } : seg(i % 2 ? 4 : 2),
      );
      const spec: ChooseSpec = { variants: 3, controls };
      const l = layoutChoose(f, spec);
      const byCol = new Map<number, number>();
      for (const c of l.controls) byCol.set(c.label.x, (byCol.get(c.label.x) ?? 0) + 1);
      expect(byCol.size, `${n} options`).toBe(cols);
      const counts = [...byCol.values()];
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      for (const r of targets(l, spec)) {
        expect(r.y).toBeGreaterThanOrEqual(f.reachTop.adult);
        expect(r.y + r.height).toBeLessThanOrEqual(f.height);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(f.width);
        expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(150);
      }
    }
  });

  it("keeps a wall's step for hockey's six wall options within about 9 m", () => {
    const f = frameOf("wall");
    const spec: ChooseSpec = {
      variants: 3,
      controls: [seg(3), seg(3), seg(3), { kind: "toggle" }, seg(2), seg(4)],
    };
    const l = layoutChoose(f, spec);
    const rs = targets(l, spec);
    const width = Math.max(...rs.map((r) => r.x + r.width)) - Math.min(...rs.map((r) => r.x));
    expect(width).toBeLessThanOrEqual(4400);
  });

  it("puts the wall title above the band", () => {
    const f = frameOf("wall");
    const l = layoutChoose(f, SPECS["variants only"]!);
    expect(l.header.y + l.header.size / 2).toBeLessThanOrEqual(f.reachTop.adult);
  });

  // Every visitor option at once, as if each `when` held, so the fullest step is checked.
  it("fits every app's own choose step on every kind it runs solo on", () => {
    for (const app of listApps()) {
      for (const kind of KINDS) {
        if (!runsSolo(app, kind)) continue;
        const f = frameOf(kind);
        const controls: ControlShape[] = visitorOptions(app, kind)
          .map(controlFor)
          .map((c) => (c.kind === "segments" ? { kind: "segments", count: c.values.length } : c));
        const spec: ChooseSpec = {
          variants: variantChoices({ app, variant: null, key: app.id }).length,
          controls,
        };
        const l = layoutChoose(f, spec);
        const all = targets(l, spec);
        const where = `${app.id} on a ${kind}`;
        for (const r of all) {
          expect(Math.min(r.width, r.height), where).toBeGreaterThanOrEqual(MIN_TARGET - 1e-6);
          expect(r.x, where).toBeGreaterThanOrEqual(-1e-6);
          expect(r.x + r.width, where).toBeLessThanOrEqual(f.width + 1e-6);
          expect(r.y, where).toBeGreaterThanOrEqual(f.reachTop.adult - 1e-6);
          expect(r.y + r.height, where).toBeLessThanOrEqual(f.height + 1e-6);
        }
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            expect(overlap(all[i]!, all[j]!), `${where}: ${i} and ${j}`).toBe(false);
          }
        }
        const labels = l.controls.map((c) => c.label);
        for (const c of labels) {
          for (const r of all) expect(overlap(c, r), where).toBe(false);
        }
        const h = l.header;
        const title = { x: h.x - h.width / 2, y: h.y - h.size / 2, width: h.width, height: h.size };
        expect(title.y, where).toBeGreaterThanOrEqual(0);
        for (const r of [...all, ...labels]) expect(overlap(title, r), where).toBe(false);
        if (kind === "pair") {
          for (const r of [...all, ...labels]) {
            expect(r.x < 1080 + 216 && r.x + r.width > 1080 - 216, `${where} seam`).toBe(false);
          }
        }
      }
    }
  });

  it("carries a kiosk's or a wall's variants on into another column when they don't fit", () => {
    for (const kind of ["kiosk", "wall"] as const) {
      const f = frameOf(kind);
      const spec: ChooseSpec = { variants: 7, controls: [] };
      const l = layoutChoose(f, spec);
      expect(new Set(l.variants.map((r) => r.x)).size, kind).toBeGreaterThanOrEqual(2);
      for (const r of l.variants) {
        expect(r.y, kind).toBeGreaterThanOrEqual(f.reachTop.adult - 1e-6);
        expect(r.height, kind).toBeGreaterThanOrEqual(MIN_TARGET);
      }
    }
  });
});
