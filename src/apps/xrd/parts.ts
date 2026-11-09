/**
 * The machine's parts and the chapters that explain them, and where each part goes along a band
 * so it hangs over those chapters: over the bank below the screen, or over the wall's columns.
 * Pure.
 *
 * Positions are fractions across the band (0 left, 1 right). On a bank a part sits over the
 * middle of the slots (frames, or a pair's halves) showing its chapters, and its leader line
 * spans them; the screen spans the bank exactly, so a fraction of the bank is a fraction of the
 * screen (src/core/layout.ts).
 */
import type { ChapterId } from "./ids";
import { shares } from "./shares";

export type PartId = "tube" | "sample" | "stage" | "detector" | "computer" | "fibre" | "cards";

export const PART_IDS: readonly PartId[] = [
  "tube",
  "sample",
  "stage",
  "detector",
  "computer",
  "fibre",
  "cards",
];

/**
 * The chapters each part stands for: a part hangs only over chapters about it, so a leader never
 * suggests a link that isn't there. Interference uses no part of the machine; the pattern
 * chapters (spots and rings, spacing, missing spots) are all about what the detector records.
 */
export const PART_CHAPTERS: Record<PartId, readonly ChapterId[]> = {
  tube: ["spectrum"],
  sample: ["crystal", "bragg"],
  stage: ["goniometer"],
  detector: ["patterns", "inverse", "absences"],
  computer: ["synthesis"],
  fibre: ["helix"],
  cards: ["mystery"],
};

/** The part a chapter stands for, or null for one that uses none (interference). */
export const partOf = (id: ChapterId): PartId | null =>
  (Object.keys(PART_CHAPTERS) as PartId[]).find((p) => PART_CHAPTERS[p].includes(id)) ?? null;

export interface PartSpot {
  part: PartId;
  /** Where the part hangs, a fraction across the band. */
  at: number;
  /** The span of slots its chapters fill, fractions; null when none of them is shown. */
  span: { from: number; to: number } | null;
  /** The chapters' numbers (1 to 11) shown below it. */
  numbers: number[];
}

/**
 * Where each part goes for a row of slots, each showing some chapters, left to right. A part
 * none of whose chapters is shown sits between its neighbours (the stage beside the sample, say),
 * except the parts beyond the core machine (computer, fibre, cards), which are left out.
 */
export const placeParts = (
  slots: readonly (readonly ChapterId[])[],
  numberOf: (id: ChapterId) => number,
): PartSpot[] => {
  const n = Math.max(1, slots.length);
  const out: PartSpot[] = [];
  for (const part of PART_IDS) {
    const hits: number[] = [];
    const nums: number[] = [];
    slots.forEach((chs, s) => {
      for (const id of chs) {
        if (PART_CHAPTERS[part].includes(id)) {
          hits.push(s);
          nums.push(numberOf(id));
        }
      }
    });
    if (hits.length === 0) {
      out.push({ part, at: Number.NaN, span: null, numbers: [] });
      continue;
    }
    const from = Math.min(...hits) / n;
    const to = (Math.max(...hits) + 1) / n;
    out.push({
      part,
      at: (from + to) / 2,
      span: { from, to },
      numbers: [...new Set(nums)].sort((a, b) => a - b),
    });
  }
  // Core parts with no slot of their own sit between their neighbours along the beam.
  const core: PartId[] = ["tube", "sample", "stage", "detector"];
  const at = (p: PartId) => out.find((o) => o.part === p)!;
  for (let i = 0; i < core.length; i++) {
    const me = at(core[i]!);
    if (!Number.isNaN(me.at)) continue;
    let left = Number.NaN;
    let right = Number.NaN;
    for (let j = i - 1; j >= 0 && Number.isNaN(left); j--) left = at(core[j]!).at;
    for (let j = i + 1; j < core.length && Number.isNaN(right); j++) right = at(core[j]!).at;
    me.at = Number.isNaN(left)
      ? Number.isNaN(right)
        ? (i + 0.5) / core.length
        : Math.max(0.02, right - 0.08)
      : Number.isNaN(right)
        ? Math.min(0.98, left + 0.08)
        : (left + right) / 2;
  }
  return out.filter((o) => !Number.isNaN(o.at));
};

/** The parts over a bank of `slots` slots (frames, or pairs' halves). */
export const bankParts = (slots: number, numberOf: (id: ChapterId) => number): PartSpot[] =>
  placeParts(shares(slots), numberOf);
