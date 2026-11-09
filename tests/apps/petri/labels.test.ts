import { describe, expect, it } from "vitest";
import { type Box, dishFor } from "../../../src/apps/petri/dish";
import {
  computeLayout,
  controlBoxes,
  detentAt,
  type Labelled,
  type Layout,
  labelBoxes,
  MIN_LABEL,
  type Mode,
  SEAM_CLEAR,
  sliceMarks,
  textEm,
} from "../../../src/apps/petri/layout";
import {
  FAMILIES,
  type Family,
  presetCount,
  presetLabel,
  STAMPS,
} from "../../../src/apps/petri/stamps";
import type { FrameKind, Reach } from "../../../src/core/types";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 0.01 &&
  inner.y >= outer.y - 0.01 &&
  inner.x + inner.width <= outer.x + outer.width + 0.01 &&
  inner.y + inner.height <= outer.y + outer.height + 0.01;

// The wall, a solo panel and pair, and a bank's touch frames (droppers) as panels and pairs.
const CASES: [FrameKind, Mode][] = [
  ["wall", "solo"],
  ["panel", "solo"],
  ["pair", "solo"],
  ["panel", "dropper"],
  ["pair", "dropper"],
];

const each = (
  fn: (l: Layout, at: string, kind: FrameKind, family: Family, reach: Reach) => void,
) => {
  for (const [kind, mode] of CASES) {
    const reaches: Reach[] = [
      DEFAULT_REACH[kind],
      kind === "wall" ? { adult: 0.45, child: 0.25 } : { adult: 0.85, child: 0.5 },
    ];
    for (const reach of reaches) {
      for (const family of FAMILIES) {
        for (const regions of [1, 2, 3]) {
          const l = computeLayout(kind, mode, VENUE_SIZE[kind], reach, family, regions);
          fn(
            l,
            `${kind} ${mode} ${family} ${reach.adult}/${reach.child} ${regions}`,
            kind,
            family,
            reach,
          );
        }
      }
    }
  }
};

const labelled = (l: Layout, family: Family): { text: string; parts: Labelled }[] => [
  ...l.pads.flatMap((p) => p.swatches.map((s) => ({ text: s.stamp.label, parts: s as Labelled }))),
  ...l.dials.flatMap((d) => d.chips.map((c, i) => ({ text: presetLabel(family, i), parts: c }))),
];

describe("petri labels", () => {
  it("gives every swatch and detent a plain label of one or two words", () => {
    const jargon = /methuselah|gray|scott|pentomino|diehard|lwss|physarum|mitosis|agent|reagent/i;
    const words: string[] = [];
    for (const f of FAMILIES) {
      words.push(...STAMPS[f].map((s) => s.label));
      for (let i = 0; i < presetCount(f); i++) words.push(presetLabel(f, i));
    }
    expect(words.length).toBe(5 + 3 + 4 + 4 + 4);
    for (const w of words) {
      expect(w.trim(), w).toBe(w);
      expect(w.length, w).toBeGreaterThan(0);
      expect(w.length, w).toBeLessThanOrEqual(12);
      const parts = w.split(" ");
      expect(parts.length, w).toBeLessThanOrEqual(2);
      // Sentence case: a capital, then lower case.
      expect(w[0], w).toBe(w[0]!.toUpperCase());
      expect(w.slice(1), w).toBe(w.slice(1).toLowerCase());
      expect(jargon.test(w), w).toBe(false);
    }
    // Labels in one tray or on one dial differ.
    for (const f of FAMILIES) {
      const tray = STAMPS[f].map((s) => s.label);
      expect(new Set(tray).size).toBe(tray.length);
      const dial = Array.from({ length: presetCount(f) }, (_, i) => presetLabel(f, i));
      expect(new Set(dial).size).toBe(dial.length);
    }
  });

  it("fits each label and icon inside its tile or chip at a size readable from 3 m", () => {
    each((l, at, kind, family) => {
      for (const { text, parts } of labelled(l, family)) {
        const { box, icon, label, font } = parts;
        expect(inside(label, box), `${at} ${text}`).toBe(true);
        expect(inside(icon, box), `${at} ${text}`).toBe(true);
        expect(overlaps(icon, label), `${at} ${text}`).toBe(false);
        expect(textEm(text) * font, `${at} ${text}`).toBeLessThanOrEqual(label.width);
        expect(label.height).toBeGreaterThanOrEqual(font);
        // Wall venue px are three times the size of a panel's, so a smaller count reads further.
        expect(font, `${at} ${text}`).toBeGreaterThanOrEqual(kind === "wall" ? 30 : MIN_LABEL);
      }
    });
  });

  it("keeps labels apart from each other, the reset control and a pair's seam", () => {
    each((l, at, kind, family) => {
      const labels = labelBoxes(l);
      expect(labels.length).toBe(labelled(l, family).length);
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          expect(overlaps(labels[i]!, labels[j]!), `${at} ${i} ${j}`).toBe(false);
        }
        for (const p of l.pads) {
          expect(overlaps(labels[i]!, p.reset), `${at} reset ${i}`).toBe(false);
          if (p.pipette) expect(overlaps(labels[i]!, p.pipette), `${at} pipette ${i}`).toBe(false);
        }
        const b = labels[i]!;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(l.venue.width);
        if (kind === "pair") {
          const seam = l.venue.width / 2;
          const clear = b.x + b.width <= seam - SEAM_CLEAR || b.x >= seam + SEAM_CLEAR;
          expect(clear, `${at} seam ${i}`).toBe(true);
        }
      }
      // Tiles and chips still never overlap any other control.
      const boxes = controlBoxes(l);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(overlaps(boxes[i]!, boxes[j]!), `${at} ${i} ${j}`).toBe(false);
        }
      }
    });
  });

  it("keeps labels in their control's reach band", () => {
    each((l, at, _kind, _family, reach) => {
      const H = l.venue.height;
      const childTop = H * (1 - reach.child);
      const adultTop = H * (1 - Math.min(1, reach.adult));
      for (const p of l.pads) {
        for (const s of p.swatches) {
          if (s.stamp.band === "child") {
            expect(s.label.y, `${at} ${s.stamp.id}`).toBeGreaterThanOrEqual(childTop);
          } else {
            expect(s.label.y + s.label.height, `${at} ${s.stamp.id}`).toBeLessThanOrEqual(childTop);
          }
        }
      }
      for (const d of l.dials) {
        for (const c of d.chips) {
          expect(c.box.y, at).toBeGreaterThanOrEqual(Math.max(adultTop, H * 0.15) - 1);
          expect(c.box.y + c.box.height, at).toBeLessThanOrEqual(childTop);
        }
      }
    });
  });

  it("keeps detent chips big enough to tap, each on its own detent", () => {
    each((l, at) => {
      l.dials.forEach((d, i) => {
        d.chips.forEach((c, v) => {
          expect(Math.min(c.box.width, c.box.height) + 20, at).toBeGreaterThanOrEqual(120);
          const hit = detentAt(l, c.box.x + c.box.width / 2, c.box.y + c.box.height / 2);
          expect(hit, at).toEqual({ dial: i, value: v });
        });
        expect(detentAt(l, d.cx, d.cy)).toBeNull();
      });
    });
  });

  it("labels the slice marks under the screen's dish without crowding them", () => {
    const venue = VENUE_SIZE.screen;
    const dish = dishFor(venue.width, venue.height);
    for (const family of ["slime", "turing"] as const) {
      const words = Array.from({ length: presetCount(family) }, (_, i) => presetLabel(family, i));
      for (const count of [1, 3, 5, 10]) {
        const xs = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * venue.width);
        const marks = sliceMarks(venue, xs, words);
        expect(marks.length).toBe(count);
        for (const m of marks) {
          expect(m.font).toBeGreaterThanOrEqual(MIN_LABEL);
          for (const w of words) expect(textEm(w) * m.font).toBeLessThanOrEqual(m.label.width);
          expect(m.icon.y).toBeGreaterThanOrEqual(dish.y + dish.r);
          expect(m.label.y + m.label.height).toBeLessThanOrEqual(venue.height);
          expect(overlaps(m.icon, m.label)).toBe(false);
        }
        for (let i = 1; i < marks.length; i++) {
          expect(overlaps(marks[i - 1]!.box, marks[i]!.box)).toBe(false);
        }
      }
    }
    expect(sliceMarks(venue, [], ["Web"])).toEqual([]);
  });
});
