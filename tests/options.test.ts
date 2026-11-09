import { describe, expect, it } from "vitest";
import { cleanOptionValues, cutText, optionDefault, optionShown } from "../src/core/options";
import { listApps } from "../src/core/registry";
import type { FrameKind, OptionDef, OptionValue } from "../src/core/types";

/** Shaped like a poll with curated questions and an operator-written one. */
const POLL: OptionDef[] = [
  {
    type: "enum",
    key: "question",
    title: "Question",
    values: [
      { id: "pets", title: "Pets" },
      { id: "custom", title: "Your own" },
    ],
    default: "pets",
  },
  { type: "text", key: "ask", title: "Question text", maxLength: 20, default: "" },
  { type: "text", key: "a1", title: "Answer 1", maxLength: 8, default: "Yes" },
  { type: "number", key: "rotate", title: "Minutes", min: 2, max: 30, step: 2, default: 4 },
  { type: "number", key: "res", title: "Res", min: 0.25, max: 2, step: 0.25, default: 1 },
  { type: "boolean", key: "marks", title: "Marks", default: true },
  { type: "apps", key: "pool", title: "Pool", default: ["diag", "idle"] },
];

describe("cleanOptionValues", () => {
  it("fills every option with its default when nothing is given", () => {
    expect(cleanOptionValues(undefined, POLL)).toEqual({
      question: "pets",
      ask: "",
      a1: "Yes",
      rotate: 4,
      res: 1,
      marks: true,
      pool: "diag,idle",
    });
    expect(cleanOptionValues({}, undefined)).toEqual({});
  });

  it("keeps valid values and drops keys the schema doesn't have", () => {
    const out = cleanOptionValues(
      {
        question: "custom",
        ask: "Best pet?",
        a1: "Cat",
        rotate: 10,
        res: 0.5,
        marks: false,
        pool: "diag,menu:play",
        extra: "hello",
      },
      POLL,
    );
    expect(out).toEqual({
      question: "custom",
      ask: "Best pet?",
      a1: "Cat",
      rotate: 10,
      res: 0.5,
      marks: false,
      pool: "diag,menu:play",
    });
  });

  it("falls back to defaults for values of the wrong type or outside an enum", () => {
    const out = cleanOptionValues(
      { question: "nope", ask: 5, a1: null, rotate: "10", res: Number.NaN, marks: "true", pool: 3 },
      POLL,
    );
    expect(out).toEqual({
      question: "pets",
      ask: "",
      a1: "Yes",
      rotate: 4,
      res: 1,
      marks: true,
      pool: "diag,idle",
    });
  });

  it("clamps numbers to the range and snaps them to the step", () => {
    const at = (rotate: number, res: number) => cleanOptionValues({ rotate, res }, POLL);
    expect(at(99, 9)).toMatchObject({ rotate: 30, res: 2 });
    expect(at(-5, 0)).toMatchObject({ rotate: 2, res: 0.25 });
    expect(at(5, 0.6)).toMatchObject({ rotate: 6, res: 0.5 });
    expect(at(29.5, 1.3)).toMatchObject({ rotate: 30, res: 1.25 });
    // A range whose top isn't on the step stays inside it.
    const odd: OptionDef = {
      type: "number",
      key: "n",
      title: "N",
      min: 1,
      max: 6,
      step: 2,
      default: 1,
    };
    expect(cleanOptionValues({ n: 6 }, [odd]).n).toBe(5);
  });

  it("keeps only id-shaped app tokens, without repeats", () => {
    expect(cleanOptionValues({ pool: " diag ,Bad Id,diag,x:y:z,idle:" }, POLL).pool).toBe("diag");
  });

  it("makes text printable, trims it and cuts it to its maximum", () => {
    const text = (ask: unknown, a1?: unknown) => cleanOptionValues({ ask, a1 }, POLL);
    expect(text("  Which\tpet\nis best?\u0000 ").ask).toBe("Which pet is best?");
    expect(text("x".repeat(500)).ask).toBe("x".repeat(20));
    expect(text("Which one is the best?").ask).toBe("Which one is the bes");
    // Cutting never leaves a trailing space or half a surrogate pair.
    expect(text(`${"x".repeat(19)}\u{1F431}`).ask).toBe("x".repeat(19));
    expect(text(`${"x".repeat(18)}\u{1F431}`).ask).toBe(`${"x".repeat(18)}\u{1F431}`);
    expect(text("Which pet is  best").ask).toBe("Which pet is  best");
    expect(text(undefined, "1234567 9").a1).toBe("1234567");
  });

  it("uses the default for empty or blank text", () => {
    expect(cleanOptionValues({ a1: "" }, POLL).a1).toBe("Yes");
    expect(cleanOptionValues({ a1: " \u0007\t " }, POLL).a1).toBe("Yes");
  });
});

describe("every registered app", () => {
  it("has option defaults that cleaning keeps as they are", () => {
    const apps = listApps();
    expect(apps.length).toBeGreaterThan(5);
    const changed: string[] = [];
    for (const app of apps) {
      const defs = app.options ?? [];
      const defaults = Object.fromEntries(defs.map((d) => [d.key, optionDefault(d)]));
      const clean = cleanOptionValues(defaults, defs);
      for (const d of defs) {
        if (clean[d.key] !== defaults[d.key]) changed.push(`${app.id}.${d.key}`);
      }
    }
    expect(changed).toEqual([]);
  });
});

describe("cutText", () => {
  it("returns printable text no longer than the limit", () => {
    expect(cutText("ab\u0085cd", 10)).toBe("ab cd");
    expect(cutText("abc", 0)).toBe("");
    expect(cutText("abc", -3)).toBe("");
  });
});

describe("optionShown", () => {
  const defs: OptionDef[] = [
    ...POLL,
    {
      type: "number",
      key: "answers",
      title: "Answers",
      min: 2,
      max: 4,
      step: 1,
      default: 2,
      when: { key: "question", is: ["custom"] },
    },
    {
      type: "text",
      key: "a3",
      title: "Answer 3",
      maxLength: 8,
      default: "",
      when: { key: "answers", is: [3, 4] },
    },
    {
      type: "boolean",
      key: "lane",
      title: "Child lane",
      default: false,
      kinds: ["wall"],
    },
    {
      type: "boolean",
      key: "wide",
      title: "Wide lane",
      default: false,
      kinds: ["wall", "pair"],
      when: { key: "lane", is: [true] },
    },
  ];
  const find = (key: string) => defs.find((d) => d.key === key) as OptionDef;
  const shown = (
    key: string,
    values: Record<string, OptionValue>,
    kinds?: FrameKind | FrameKind[] | null,
  ) => optionShown(find(key), defs, values, kinds);

  it("shows an option with no conditions everywhere", () => {
    expect(shown("question", {})).toBe(true);
    expect(shown("question", {}, "screen")).toBe(true);
  });

  it("follows the other option's value, counting a missing one as its default", () => {
    expect(shown("answers", {})).toBe(false);
    expect(shown("answers", { question: "custom" })).toBe(true);
    expect(shown("answers", { question: "pets" })).toBe(false);
  });

  it("hides an option whose condition depends on a hidden option", () => {
    expect(shown("a3", { question: "custom", answers: 3 })).toBe(true);
    expect(shown("a3", { question: "custom", answers: 2 })).toBe(false);
    // `answers` is 4, but it is hidden, so its dependants are too.
    expect(shown("a3", { question: "pets", answers: 4 })).toBe(false);
  });

  it("combines kinds and when", () => {
    expect(shown("lane", {}, "wall")).toBe(true);
    expect(shown("lane", {}, "panel")).toBe(false);
    expect(shown("wide", { lane: true }, "wall")).toBe(true);
    expect(shown("wide", { lane: false }, "wall")).toBe(false);
    // Wide applies to pairs, but the lane it depends on is wall-only.
    expect(shown("wide", { lane: true }, "pair")).toBe(false);
    expect(shown("wide", { lane: true }, ["pair", "wall"])).toBe(true);
    expect(shown("wide", { lane: true }, "panel")).toBe(false);
    // Unknown kinds hide nothing.
    expect(shown("wide", { lane: true }, [])).toBe(true);
    expect(shown("wide", { lane: true }, null)).toBe(true);
    expect(shown("wide", { lane: true })).toBe(true);
  });

  it("never shows options in a loop or depending on an unknown option", () => {
    const loop: OptionDef[] = [
      { type: "boolean", key: "x", title: "X", default: true, when: { key: "y", is: [true] } },
      { type: "boolean", key: "y", title: "Y", default: true, when: { key: "x", is: [true] } },
      { type: "boolean", key: "z", title: "Z", default: true, when: { key: "gone", is: [true] } },
    ];
    expect(optionShown(loop[0] as OptionDef, loop, {})).toBe(false);
    expect(optionShown(loop[2] as OptionDef, loop, {})).toBe(false);
    expect(optionShown(loop[2] as OptionDef, loop, { gone: true })).toBe(true);
  });
});
