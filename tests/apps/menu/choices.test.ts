import { describe, expect, it } from "vitest";
import type { Offer } from "../../../src/apps/menu/catalog";
import {
  canStep,
  controlFor,
  shownKeys,
  defaultOptions,
  isValid,
  launchArgs,
  mergeOptions,
  needsChoice,
  startVariant,
  stepValue,
  valueLabel,
  variantChoices,
  type VisitorOption,
  visitorOptions,
  visitorVariants,
} from "../../../src/apps/menu/choices";
import type { AppManifest, OptionDef } from "../../../src/core/types";

/** Shaped like a game with variants, visitor options and operator options. */
const GAME: AppManifest = {
  id: "game",
  title: "Game",
  category: "game",
  blurb: "",
  setups: [{ setup: "solo", kinds: ["panel"] }],
  network: "none",
  variants: [
    { id: "classic", title: "Classic", blurb: "The usual." },
    { id: "paddles", title: "Paddles" },
    { id: "defence", title: "Defence" },
    { id: "test", title: "Test", visitor: false },
  ],
  options: [
    {
      type: "number",
      key: "pucks",
      title: "Pucks",
      min: 1,
      max: 3,
      step: 1,
      default: 2,
      visitor: true,
    },
    {
      type: "enum",
      key: "speed",
      title: "Speed",
      values: [
        { id: "slow", title: "Slow" },
        { id: "normal", title: "Normal" },
        { id: "fast", title: "Fast" },
      ],
      default: "normal",
      visitor: true,
    },
    { type: "boolean", key: "lane", title: "Lane", default: false },
    { type: "boolean", key: "music", title: "Lights", default: true, visitor: true },
    { type: "number", key: "cell", title: "Cell", min: 1, max: 9, step: 1, default: 3 },
    { type: "apps", key: "pool", title: "Pool", default: ["a", "b"], visitor: true },
    {
      type: "enum",
      key: "table",
      title: "Table",
      values: [
        { id: "many", title: "Several" },
        { id: "long", title: "One long" },
      ],
      default: "many",
      visitor: true,
      kinds: ["wall"],
    },
  ],
};

const PLAIN: AppManifest = { ...GAME, id: "plain", variants: undefined, options: undefined };
const ONE_VARIANT: AppManifest = {
  ...GAME,
  id: "one",
  variants: [
    { id: "hidden", title: "Hidden", visitor: false },
    { id: "only", title: "Only" },
  ],
  options: [{ type: "boolean", key: "lane", title: "Lane", default: false }],
};

const offer = (app: AppManifest, variant?: string): Offer => {
  const v = variant ? (app.variants?.find((x) => x.id === variant) ?? null) : null;
  return { app, variant: v, key: v ? `${app.id}:${v.id}` : app.id };
};

const def = (key: string): VisitorOption =>
  GAME.options!.find((o) => o.key === key) as VisitorOption;

describe("what the picker offers", () => {
  it("offers variants unless marked otherwise", () => {
    expect(visitorVariants(GAME).map((v) => v.id)).toEqual(["classic", "paddles", "defence"]);
    expect(visitorVariants(PLAIN)).toEqual([]);
  });

  it("offers only options marked for visitors, and never app lists", () => {
    expect(visitorOptions(GAME).map((o) => o.key)).toEqual(["pucks", "speed", "music", "table"]);
    expect(visitorOptions(PLAIN)).toEqual([]);
  });

  it("offers an option only on the frame kinds it lists", () => {
    expect(visitorOptions(GAME, "panel").map((o) => o.key)).toEqual(["pucks", "speed", "music"]);
    expect(visitorOptions(GAME, "wall").map((o) => o.key)).toEqual([
      "pucks",
      "speed",
      "music",
      "table",
    ]);
    const wallOnly: AppManifest = { ...ONE_VARIANT, options: [GAME.options![6]!] };
    expect(needsChoice(offer(wallOnly), "wall")).toBe(true);
    expect(needsChoice(offer(wallOnly), "panel")).toBe(false);
  });

  it("asks for a variant only when there are two or more and no preset", () => {
    expect(variantChoices(offer(GAME))).toHaveLength(3);
    expect(variantChoices(offer(GAME, "defence"))).toEqual([]);
    expect(variantChoices(offer(ONE_VARIANT))).toEqual([]);
  });

  it("opens the choose step only when there is something to choose", () => {
    expect(needsChoice(offer(GAME), "panel")).toBe(true);
    // A preset still asks for the visitor options.
    expect(needsChoice(offer(GAME, "defence"), "panel")).toBe(true);
    expect(needsChoice(offer(PLAIN), "panel")).toBe(false);
    expect(needsChoice(offer(ONE_VARIANT), "panel")).toBe(false);
    expect(needsChoice(offer(ONE_VARIANT, "hidden"), "panel")).toBe(false);
  });

  it("starts from the preset, else the first variant offered to visitors", () => {
    expect(startVariant(offer(GAME))).toBe("classic");
    expect(startVariant(offer(GAME, "test"))).toBe("test");
    expect(startVariant(offer(ONE_VARIANT))).toBe("only");
    expect(startVariant(offer(PLAIN))).toBeUndefined();
  });
});

describe("controls", () => {
  it("shows short enums and small number ranges as segments", () => {
    expect(controlFor(def("speed"))).toEqual({
      kind: "segments",
      values: [
        { value: "slow", label: "Slow" },
        { value: "normal", label: "Normal" },
        { value: "fast", label: "Fast" },
      ],
    });
    expect(controlFor(def("pucks"))).toEqual({
      kind: "segments",
      values: [1, 2, 3].map((v) => ({ value: v, label: String(v) })),
    });
    const quarters: VisitorOption = {
      type: "number",
      key: "q",
      title: "Q",
      min: 0,
      max: 1,
      step: 0.25,
      default: 0.5,
    };
    const c = controlFor(quarters);
    expect(c.kind === "segments" && c.values.map((v) => v.value)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("uses a stepper for long enums and wide ranges, and a toggle for booleans", () => {
    expect(controlFor({ ...def("cell"), visitor: true } as VisitorOption)).toEqual({
      kind: "stepper",
    });
    const many: VisitorOption = {
      type: "enum",
      key: "e",
      title: "E",
      values: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, title: id })),
      default: "a",
    };
    expect(controlFor(many)).toEqual({ kind: "stepper" });
    expect(controlFor(def("music"))).toEqual({ kind: "toggle" });
  });

  it("steps within range and through enum lists", () => {
    expect(stepValue(def("pucks"), 2, 1)).toBe(3);
    expect(stepValue(def("pucks"), 3, 1)).toBe(3);
    expect(stepValue(def("pucks"), 1, -1)).toBe(1);
    expect(canStep(def("pucks"), 3, 1)).toBe(false);
    expect(canStep(def("pucks"), 3, -1)).toBe(true);
    expect(stepValue(def("speed"), "normal", 1)).toBe("fast");
    expect(stepValue(def("speed"), "slow", -1)).toBe("slow");
    expect(stepValue(def("music"), true, 1)).toBe(false);
  });

  it("labels values as the visitor sees them", () => {
    expect(valueLabel(def("speed"), "fast")).toBe("Fast");
    expect(valueLabel(def("pucks"), 3)).toBe("3");
    expect(valueLabel(def("music"), true)).toBe("On");
  });
});

describe("option values", () => {
  it("defaults every option, joining app lists as the URL would", () => {
    expect(defaultOptions(GAME)).toEqual({
      pucks: 2,
      speed: "normal",
      lane: false,
      music: true,
      cell: 3,
      pool: "a,b",
      table: "many",
    });
    expect(defaultOptions(PLAIN)).toEqual({});
  });

  it("checks values against their schema", () => {
    const opts = GAME.options as OptionDef[];
    const by = (k: string) => opts.find((o) => o.key === k)!;
    expect(isValid(by("pucks"), 3)).toBe(true);
    expect(isValid(by("pucks"), 4)).toBe(false);
    expect(isValid(by("pucks"), 1.5)).toBe(false);
    expect(isValid(by("pucks"), "2")).toBe(false);
    expect(isValid(by("speed"), "fast")).toBe(true);
    expect(isValid(by("speed"), "warp")).toBe(false);
    expect(isValid(by("music"), false)).toBe(true);
    expect(isValid(by("music"), 0)).toBe(false);
  });

  it("merges valid visitor changes over the defaults and ignores everything else", () => {
    expect(
      mergeOptions(GAME, {
        pucks: 3,
        speed: "warp",
        lane: true,
        cell: 9,
        music: false,
        pool: "x",
        stray: 1,
      }),
    ).toEqual({
      pucks: 3,
      speed: "normal",
      lane: false,
      music: false,
      cell: 3,
      pool: "a,b",
      table: "many",
    });
  });

  it("applies a kind-limited option only on its kinds, keeping its default elsewhere", () => {
    expect(mergeOptions(GAME, { table: "long" }, "wall").table).toBe("long");
    expect(mergeOptions(GAME, { table: "long" }, "panel").table).toBe("many");
  });
});

describe("launchArgs", () => {
  it("sends the chosen variant and the full option set", () => {
    expect(launchArgs(offer(GAME), "defence", { pucks: 3 })).toEqual({
      variant: "defence",
      options: {
        pucks: 3,
        speed: "normal",
        lane: false,
        music: true,
        cell: 3,
        pool: "a,b",
        table: "many",
      },
    });
    expect(launchArgs(offer(GAME), "classic", { table: "long" }, "wall").options.table).toBe(
      "long",
    );
  });

  it("falls back to the start variant when the choice isn't offered", () => {
    expect(launchArgs(offer(GAME), "test", {}).variant).toBe("classic");
    expect(launchArgs(offer(GAME), undefined, {}).variant).toBe("classic");
  });

  it("keeps a preset's variant", () => {
    expect(launchArgs(offer(GAME, "test"), "classic", { speed: "fast" })).toEqual({
      variant: "test",
      options: {
        pucks: 2,
        speed: "fast",
        lane: false,
        music: true,
        cell: 3,
        pool: "a,b",
        table: "many",
      },
    });
  });

  it("leaves the variant out for apps without variants", () => {
    expect(launchArgs(offer(PLAIN), "x", {})).toEqual({ options: {} });
  });
});

/** Operator text marked for visitors by mistake, and options that follow another's value. */
const POLL: AppManifest = {
  ...GAME,
  id: "poll",
  variants: undefined,
  options: [
    { type: "text", key: "ask", title: "Question", maxLength: 40, default: "", visitor: true },
    {
      type: "enum",
      key: "mode",
      title: "Mode",
      values: [
        { id: "calm", title: "Calm" },
        { id: "race", title: "Race" },
      ],
      default: "calm",
      visitor: true,
    },
    {
      type: "number",
      key: "laps",
      title: "Laps",
      min: 1,
      max: 3,
      step: 1,
      default: 1,
      visitor: true,
      when: { key: "mode", is: ["race"] },
    },
    {
      type: "boolean",
      key: "solo",
      title: "Solo",
      default: false,
      visitor: true,
      when: { key: "hidden", is: [true] },
    },
    { type: "boolean", key: "hidden", title: "Hidden", default: false },
  ],
};

describe("text and conditional options in the picker", () => {
  it("never offers operator text to visitors", () => {
    expect(visitorOptions(POLL).map((o) => o.key)).toEqual(["mode", "laps", "solo"]);
    expect(visitorOptions(POLL, "panel", defaultOptions(POLL)).map((o) => o.key)).toEqual(["mode"]);
    expect(isValid(POLL.options![0]!, "Hello")).toBe(false);
  });

  it("shows an option only while its condition holds", () => {
    const race = { ...defaultOptions(POLL), mode: "race" };
    expect(shownKeys(POLL, "panel", race)).toBe("mode,laps");
    expect(shownKeys(POLL, "panel", defaultOptions(POLL))).toBe("mode");
    // An operator option can enable a visitor one.
    expect(shownKeys(POLL, "panel", { ...race, hidden: true })).toBe("mode,laps,solo");
  });

  it("asks only when something is shown at the start", () => {
    const hiddenOnly: AppManifest = { ...POLL, options: POLL.options!.slice(3) };
    expect(needsChoice(offer(hiddenOnly), "panel")).toBe(false);
    expect(needsChoice(offer(POLL), "panel")).toBe(true);
  });

  it("launches with text at its default, whatever the changes say", () => {
    const args = launchArgs(offer(POLL), undefined, { ask: "Hi", mode: "race", laps: 3 }, "panel");
    expect(args.options).toEqual({ ask: "", mode: "race", laps: 3, solo: false, hidden: false });
  });
});
