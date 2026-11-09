import { describe, expect, it } from "vitest";
import { TEXT } from "../../../src/apps/xrd/captions";
import {
  compose,
  type Driver,
  HOLD_BOT_MS,
  HOLD_PERSON_MS,
  ownRun,
} from "../../../src/apps/xrd/drive";
import { CHAPTER_IDS, type ChapterId, WALL_SETS } from "../../../src/apps/xrd/ids";
import {
  bankParts,
  PART_CHAPTERS,
  PART_IDS,
  partOf,
  placeParts,
} from "../../../src/apps/xrd/parts";
import { shares } from "../../../src/apps/xrd/shares";
import { VENUE_SIZE } from "../../../src/core/frame";
import { bankFraction } from "../../../src/core/layout";

const num = (id: ChapterId) => TEXT[id].number;

describe("the machine's parts", () => {
  it("names a part for every chapter but interference, which uses none", () => {
    const named = CHAPTER_IDS.filter((id) => id !== "interference");
    expect(PART_IDS.flatMap((p) => [...PART_CHAPTERS[p]]).sort()).toEqual([...named].sort());
    for (const id of named) expect(PART_CHAPTERS[partOf(id)!]).toContain(id);
    expect(partOf("interference")).toBeNull();
  });

  it("hangs each part over its chapters' frames on six panels, its bracket at their edges", () => {
    const spots = bankParts(6, num);
    const at = (p: string) => spots.find((s) => s.part === p)!;
    const span = (from: number, to: number) => ({ from: from / 6, to: to / 6 });
    expect(at("tube").span).toEqual(span(0, 1));
    expect(at("tube").numbers).toEqual([1]);
    expect(at("sample").span).toEqual(span(1, 2));
    expect(at("sample").numbers).toEqual([3, 4]);
    expect(at("stage").span).toEqual(span(2, 3));
    expect(at("detector").span).toEqual(span(2, 4));
    expect(at("detector").numbers).toEqual([6, 7, 8]);
    expect(at("computer").span).toEqual(span(4, 5));
    expect(at("fibre").span).toEqual(span(4, 5));
    expect(at("cards").span).toEqual(span(5, 6));
    for (const s of spots) expect(s.at).toBeCloseTo((s.span!.from + s.span!.to) / 2, 9);
  });

  it("lines every bracket up with the frames below to well within 3 px of the screen", () => {
    const W = VENUE_SIZE.screen.width;
    for (let count = 1; count <= 10; count++) {
      for (const span of [1, 2]) {
        const slots = count * span;
        const all = shares(slots);
        for (const s of bankParts(slots, num)) {
          if (!s.span) continue;
          // Every slot showing the part's chapters, as frames left to right.
          const hits = all.flatMap((chs, i) =>
            chs.some((c) => PART_CHAPTERS[s.part].includes(c)) ? [i] : [],
          );
          const first = Math.min(...hits);
          const last = Math.max(...hits);
          const left = bankFraction(Math.floor(first / span), (first % span) / span, count) * W;
          const right =
            bankFraction(Math.floor(last / span), ((last % span) + 1) / span, count) * W;
          expect(Math.abs(s.span.from * W - left), `${count}x${span} ${s.part}`).toBeLessThan(3);
          expect(Math.abs(s.span.to * W - right), `${count}x${span} ${s.part}`).toBeLessThan(3);
        }
      }
    }
  });

  it("follows the wall's set, leaving out parts with no column and slotting the stage by the sample", () => {
    const hl = placeParts(
      WALL_SETS.highlights.map((id) => [id]),
      num,
    );
    expect(hl.map((s) => s.part)).toEqual([
      "tube",
      "sample",
      "stage",
      "detector",
      "fibre",
      "cards",
    ]);
    expect(hl.find((s) => s.part === "tube")!.span).toBeNull();
    expect(hl.find((s) => s.part === "stage")!.span).toBeNull();
    expect(hl.find((s) => s.part === "sample")!.span).toEqual({ from: 0, to: 2 / 6 });
    expect(hl.find((s) => s.part === "detector")!.span).toEqual({ from: 2 / 6, to: 4 / 6 });
    const first = placeParts(
      WALL_SETS.first.map((id) => [id]),
      num,
    );
    expect(first.map((s) => s.part)).toEqual(["tube", "sample", "stage", "detector"]);
    // Interference, the second column, hangs from no part.
    expect(first.find((s) => s.part === "tube")!.span).toEqual({ from: 0, to: 1 / 6 });
  });
});

describe("who moves the shared machine", () => {
  const drv = (over: Partial<Driver>): Driver => ({
    chapter: "goniometer",
    drive: { stage: { omega: 30 }, arm: 60 },
    touchedAt: 1000,
    person: false,
    held: false,
    ...over,
  });

  it("runs itself when nobody drives it", () => {
    const base = ownRun(10);
    const out = compose(base, [], 5000);
    expect(out.state).toEqual(base.state);
    expect(out.active).toEqual({});
  });

  it("lets the latest touch win, a person beating a bot, each held a while", () => {
    const t = 10_000;
    const out = compose(
      ownRun(0),
      [
        drv({ touchedAt: t - 100, drive: { stage: { omega: 11 } } }),
        drv({
          chapter: "bragg",
          touchedAt: t - 2000,
          person: true,
          drive: { stage: { omega: 22 }, arm: 44 },
        }),
      ],
      t,
    );
    expect(out.state.omega).toBe(22);
    expect(out.state.armTwoTheta).toBe(44);
    expect(out.active.sample).toBe("bragg");
    const later = compose(ownRun(0), [drv({ touchedAt: t - HOLD_BOT_MS - 1 })], t);
    expect(later.active).toEqual({});
    const person = compose(
      ownRun(0),
      [drv({ touchedAt: t - HOLD_PERSON_MS + 10, person: true })],
      t,
    );
    expect(person.state.omega).toBe(30);
    expect(person.active.stage).toBe("goniometer");
  });

  it("keeps a held control driving however long ago it began", () => {
    const out = compose(ownRun(0), [drv({ touchedAt: 0, held: true })], 1e9);
    expect(out.state.armTwoTheta).toBe(60);
  });

  it("darkens the detector for light no crystal diffracts", () => {
    const out = compose(ownRun(0), [drv({ chapter: "spectrum", drive: { lambda: null } })], 1100);
    expect(out.dark).toBe(true);
    expect(out.active.tube).toBe("spectrum");
  });
});
