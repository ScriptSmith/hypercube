// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createChart } from "../../../src/apps/ballpit/chart";
import { readConfig } from "../../../src/apps/ballpit/config";
import { blindQuestion } from "../../../src/apps/ballpit/custom";
import { layoutFrame } from "../../../src/apps/ballpit/layout";
import manifest from "../../../src/apps/ballpit/manifest";
import { decodePlan, followSlot, planOf, wordless } from "../../../src/apps/ballpit/plan";
import { PICTURE_IDS } from "../../../src/apps/ballpit/pictures";
import { questionById } from "../../../src/apps/ballpit/questions";
import { slotAt } from "../../../src/apps/ballpit/schedule";
import { loadDay, memoryKV, saveDay } from "../../../src/apps/ballpit/store";
import { createTally } from "../../../src/apps/ballpit/tally";
import { createView } from "../../../src/apps/ballpit/view";
import { VENUE_SIZE } from "../../../src/core/frame";
import { cleanOptionValues } from "../../../src/core/options";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 18, 2, 0);
const DAY = "2026-10-18";

const OWN = {
  question: "custom",
  ask: "Which snack is best?",
  a1: "Apples",
  p1: "apple",
  a2: "",
  p2: "dog",
  a3: "Popcorn",
  p3: "none",
  a4: "Carrots",
  p4: "none",
};
/** Options as the runtime hands them to the app: an admin override, cleaned against the schema. */
const opts = (extra: Record<string, unknown> = {}) =>
  cleanOptionValues({ ...OWN, ...extra }, manifest.options);

describe("the operator's own question", () => {
  it("is offered in admin only, with a picture choice for every answer", () => {
    const defs = manifest.options!;
    const question = defs.find((d) => d.key === "question")!;
    expect(question.type === "enum" && question.values[1]).toEqual({
      id: "custom",
      title: "Your own (set in admin)",
    });
    const own = defs.filter((d) => d.when?.key === "question");
    expect(own.map((d) => d.key)).toEqual([
      "ask",
      ...[1, 2, 3, 4, 5, 6].flatMap((i) => [`a${i}`, `p${i}`]),
    ]);
    for (const d of own) {
      expect(d.when!.is).toEqual(["custom"]);
      expect(d.visitor).toBeUndefined();
      if (d.type === "text") expect(d.maxLength).toBeLessThanOrEqual(d.key === "ask" ? 60 : 18);
      if (d.type === "enum") {
        expect(d.values.map((v) => v.id).sort()).toEqual(["none", ...PICTURE_IDS].sort());
        expect(new Set(d.values.map((v) => v.title)).size).toBe(d.values.length);
      }
    }
    // A text option in a URL never arrives: only admin sets them.
    expect(readConfig("one", cleanOptionValues({ question: "custom" }, defs)).custom).toBeNull();
  });

  it("shows the question with its answers, skipping empty answer slots", () => {
    const cfg = readConfig("one", opts());
    const q = cfg.custom!;
    expect(q.text).toBe("Which snack is best?");
    expect(q.answers.map((a) => a.label)).toEqual(["Apples", "Popcorn", "Carrots"]);
    expect(q.answers.map((a) => a.pic)).toEqual(["apple", null, null]);
    // It stays up through the rotation's periods, with no reveal.
    for (let t = T0; t < T0 + 30 * MIN; t += 4 * MIN) {
      const slot = slotAt(t, cfg);
      expect(slot.questions).toEqual([q]);
      expect(slot.reveal).toBe(false);
    }
    expect(questionById(q.id)).toBe(q);
  });

  it("falls back to the curated rotation when it is incomplete", () => {
    const rotation = readConfig("one", cleanOptionValues({}, manifest.options));
    for (const [extra, why] of [
      [{ ask: "   " }, "no question text"],
      [{ a3: "", a4: "" }, "fewer than two answers"],
      [{ a1: "", a3: "", a4: "" }, "fewer than two answers"],
    ] as const) {
      const cfg = readConfig("one", opts(extra));
      expect(cfg.question).toBe("custom");
      expect(cfg.custom).toBeNull();
      expect(cfg.customWhy).toBe(why);
      for (let t = T0; t < T0 + 20 * MIN; t += 5 * MIN)
        expect(slotAt(t, cfg).questions).toEqual(slotAt(t, rotation).questions);
    }
  });

  it("replaces the adults' question in the two-question variant", () => {
    const cfg = readConfig("two", opts());
    const slot = slotAt(T0, cfg);
    expect(slot.questions[1]).toBe(cfg.custom);
    expect(slot.questions[0]!.set).not.toBe("custom");
    expect(slot.questions[0]!.audience).not.toBe("adults");
  });

  it("keeps totals by wording, so an edited question starts afresh", () => {
    const q = readConfig("one", opts()).custom!;
    expect(readConfig("one", opts()).custom!.id).toBe(q.id);
    const edits = [{ ask: "Which snack is the best?" }, { a4: "Carrot" }, { p3: "apple" }];
    const ids = edits.map((e) => readConfig("one", opts(e)).custom!.id);
    expect(new Set([q.id, ...ids]).size).toBe(4);
    // A blank slot moved elsewhere makes no difference: only answers that show count.
    expect(readConfig("one", opts({ a2: "", a5: "" })).custom!.id).toBe(q.id);

    const kv = memoryKV();
    const tally = createTally(DAY);
    for (let i = 0; i < 3; i++) tally.vote(q.id, "panel-1", 2);
    saveDay(kv, "f~g", tally);
    // The same question after a reload carries on...
    const again = createTally(DAY);
    again.reset(DAY, loadDay(kv, "f~g", DAY));
    expect(again.sums(q.id)).toEqual([0, 0, 3]);
    // ...and an edited one has nothing yet.
    const edited = readConfig("one", opts({ a4: "Carrot" })).custom!;
    expect(again.sums(edited.id)).toEqual([0, 0, 0]);
  });
});

describe("a bank following its leader", () => {
  const leader = () => readConfig("one", opts());

  it("announces ids, an answer count and pictures, and never the wording", () => {
    const cfg = leader();
    const msg = planOf(slotAt(T0, cfg));
    expect(msg).toEqual({ q: [cfg.custom!.id], e: 0, c: { n: 3, p: ["apple", "", ""] } });
    const wire = JSON.stringify(msg);
    for (const words of ["Which snack is best?", "snack", "Apples", "Popcorn", "Carrots"])
      expect(wire).not.toContain(words);
    expect(decodePlan(JSON.parse(wire))).toEqual(msg);
    for (const bad of [
      { ...msg, c: { n: 3, p: ["apple", ""] } },
      { ...msg, c: { n: 7, p: Array.from({ length: 7 }, () => "") } },
      { ...msg, c: { n: 2, p: ["pizza", ""] } },
      { ...msg, c: { n: 2, p: ["Hello there", ""] } },
      { q: ["Bad id!"], e: 0 },
      { q: [], e: 0 },
    ])
      expect(decodePlan(bad), JSON.stringify(bad)).toBeNull();
  });

  it("shows the words only on a frame whose own options hold the same question", () => {
    const own = leader().custom!;
    const msg = decodePlan(JSON.parse(JSON.stringify(planOf(slotAt(T0, leader())))))!;
    const sameCfg = readConfig("one", opts());
    const same = followSlot(slotAt(T0, sameCfg), msg, T0, sameCfg.custom);
    expect(same.questions[0]!.text).toBe("Which snack is best?");
    expect(same.questions[0]!.answers.map((a) => a.label)).toEqual([
      "Apples",
      "Popcorn",
      "Carrots",
    ]);
    // A panel with no custom text, or with another custom question, follows the id and draws
    // only colours and pictures. Its votes still count for the screen's question.
    for (const cfg of [
      readConfig("one", cleanOptionValues({ set: "science" }, manifest.options)),
      readConfig("one", opts({ ask: "Which fruit is best?" })),
    ]) {
      const shown = followSlot(slotAt(T0, cfg), msg, T0, cfg.custom);
      const q = shown.questions[0]!;
      expect(q.id).toBe(own.id);
      expect(q.text).toBe("");
      expect(q.answers.map((a) => a.label)).toEqual(["", "", ""]);
      expect(q.answers.map((a) => a.pic)).toEqual(["apple", null, null]);
      expect(wordless(q)).toBe(true);
      expect(questionById(own.id)?.answers.length).toBe(3);
    }
    // The frame that set it keeps its words, whatever words-free copies were seen.
    expect(questionById(own.id)!.text).toBe("Which snack is best?");
  });

  it("follows the leader's rotation and its reveal", () => {
    const lead = readConfig(
      "one",
      cleanOptionValues({ set: "animals", rotate: 3 }, manifest.options),
    );
    const panel = readConfig(
      "one",
      cleanOptionValues({ set: "science", rotate: 7 }, manifest.options),
    );
    const k = Math.floor(T0 / (3 * MIN));
    const end = (k + 1) * 3 * MIN;
    const msg = decodePlan(planOf(slotAt(end - 10_000, lead)))!;
    const shown = followSlot(slotAt(end - 10_000, panel), msg, end - 10_000, null);
    expect(shown.questions[0]!.set).toBe("animals");
    expect(shown.reveal).toBe(false);
    expect(followSlot(slotAt(end - 3000, panel), msg, end - 3000, null).reveal).toBe(true);
    // A custom id with no shape can't be drawn, so the frame keeps its own question there.
    const bare = decodePlan({ q: ["custom-0"], e: 0 })!;
    expect(followSlot(slotAt(T0, panel), bare, T0, null).questions).toEqual(
      slotAt(T0, panel).questions,
    );
  });
});

describe("answers without pictures", () => {
  it("show their words large in the button, and in a badge on the screen", () => {
    const q = readConfig("one", opts()).custom!;
    for (const kind of ["panel", "screen"] as const) {
      const root = document.createElement("div");
      const { width: W, height: H } = VENUE_SIZE[kind];
      const layout = layoutFrame({
        kind,
        W,
        H,
        span: 1,
        adultTop: 0,
        childTop: H / 2,
        variant: "one",
        answers: [q.answers.length],
        inlets: [W / 2],
      });
      const view = createView({
        root,
        unit: () => 0.5,
        pixelRatio: () => 1,
        size: () => ({ width: W / 2, height: H / 2 }),
        venue: () => ({ W, H }),
      });
      const block = layout.blocks[0]!;
      view.build(
        [
          {
            block,
            question: q,
            chart: createChart({ tubes: block.tubes, n0: 3, liveCap: 8, gravity: 1000 }),
          },
        ],
        layout.pipes,
      );
      const spots =
        kind === "panel" ? root.querySelectorAll(".bp-btn") : root.querySelectorAll(".bp-label");
      expect(spots.length).toBe(3);
      const [apples, popcorn, carrots] = [...spots];
      expect(apples!.querySelector("svg")).not.toBeNull();
      for (const el of [popcorn!, carrots!]) {
        expect(el.querySelector(".bp-words")).not.toBeNull();
        // No picture, only the tick a quiz reveal would show.
        expect(el.querySelectorAll("svg").length).toBe(1);
      }
      expect(popcorn!.textContent).toContain("Popcorn");
      expect(
        Number.parseFloat((popcorn!.querySelector(".bp-words") as HTMLElement).style.fontSize),
      ).toBeGreaterThan(
        Number.parseFloat((apples!.querySelector(".bp-lbl") as HTMLElement).style.fontSize),
      );
      view.dispose();
    }
  });
});

describe("a custom question set on another frame", () => {
  it("draws colours and pictures with no words at all", () => {
    const q = blindQuestion("custom-test0", ["apple", null, "rocket"]);
    const root = document.createElement("div");
    const layout = layoutFrame({
      kind: "panel",
      W: 1080,
      H: 1920,
      span: 1,
      adultTop: 0,
      childTop: 960,
      variant: "one",
      answers: [3],
      feeder: true,
    });
    const view = createView({
      root,
      unit: () => 0.5,
      pixelRatio: () => 1,
      size: () => ({ width: 540, height: 960 }),
      venue: () => ({ W: 1080, H: 1920 }),
    });
    const block = layout.blocks[0]!;
    view.build(
      [{ block, question: q, chart: createChart({ tubes: [], n0: 3, liveCap: 8, gravity: 1000 }) }],
      layout.pipes,
    );
    expect(root.querySelector(".bp-text")).toBeNull();
    const buttons = [...root.querySelectorAll(".bp-btn")];
    expect(buttons.length).toBe(3);
    expect(buttons.map((b) => b.textContent)).toEqual(["", "", ""]);
    expect(buttons.map((b) => b.querySelectorAll("svg").length)).toEqual([2, 1, 2]);
    view.dispose();
  });
});
