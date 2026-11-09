// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { AppManifest } from "../../src/core/types";
import { mountLanding } from "../../src/pages/landing/app";
import { normalizeConfig } from "../../src/pages/landing/config";
import { buildUrls, simUrl } from "../../src/pages/landing/urls";
import { config, PLAY, ROOM, sparkVisual } from "./fixtures";

const inputs = { playBase: PLAY, ak: null };

/** A poll whose own question and answers are operator text, shown once "Your own" is picked. */
const poll: AppManifest = {
  ...sparkVisual,
  id: "poll",
  title: "Poll",
  options: [
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
    {
      type: "text",
      key: "ask",
      title: "Question text",
      maxLength: 80,
      default: "",
      when: { key: "question", is: ["custom"] },
    },
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
    { type: "text", key: "note", title: "Note", maxLength: 40, default: "Hi" },
    {
      type: "boolean",
      key: "stars",
      title: "Stars",
      default: true,
      kinds: ["screen"],
      when: { key: "question", is: ["custom"] },
    },
  ],
};

const params = (url: string | undefined) => new URLSearchParams(url?.slice(url.indexOf("?")) ?? "");
const optionKeys = (url: string | undefined) =>
  [...params(url).keys()].filter((k) => k.startsWith("o."));

describe("text options in the landing panel", () => {
  it("never write text into a frame or sim URL, whatever the config holds", () => {
    const base = config(poll, { setup: "bank", options: { question: "custom" } });
    const cfg = { ...base, options: { ...base.options, ask: "Click here", note: "Hello" } };
    const urls = buildUrls(cfg, poll, inputs);
    expect(urls.length).toBeGreaterThan(1);
    for (const u of urls) {
      expect(u.url).not.toContain("o.ask");
      expect(u.url).not.toContain("o.note");
      expect(u.url).not.toContain("Click");
    }
    const sim = simUrl(cfg, poll, "https://example.org/sim/");
    expect(sim).not.toContain("o.ask");
    expect(sim).not.toContain("o.note");
  });

  it("never keeps saved text", () => {
    const cfg = normalizeConfig(
      { app: "poll", room: ROOM, options: { question: "custom", ask: "Saved text", note: "Yo" } },
      poll,
      () => "unused-room",
    );
    expect(cfg.options).toMatchObject({ question: "custom", ask: "", note: "Hi" });
  });

  it("writes an option hidden by its condition into no URL", () => {
    const [station, screen] = buildUrls(config(poll, { setup: "bank" }), poll, inputs);
    expect(optionKeys(station?.url)).toEqual(["o.question"]);
    expect(optionKeys(screen?.url)).toEqual(["o.question"]);
    const custom = config(poll, { setup: "bank", options: { question: "custom", answers: 3 } });
    const [s2, top] = buildUrls(custom, poll, inputs);
    expect(optionKeys(s2?.url)).toEqual(["o.question", "o.answers"]);
    expect(optionKeys(top?.url)).toEqual(["o.question", "o.answers", "o.stars"]);
    expect(params(s2?.url).get("o.answers")).toBe("3");
  });
});

describe("text options on the page", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    history.replaceState(null, "", "/hypercube/#/poll");
  });

  const shown = () => [
    ...new Set(
      [...document.querySelectorAll<HTMLElement>("[data-focus^='o.']")].map(
        (e) => e.dataset.focus?.split(":")[0],
      ),
    ),
  ];
  const textInput = (key: string) =>
    document.querySelector<HTMLInputElement>(`input[type="text"][data-focus="o.${key}"]`);

  it("shows text as a disabled row set in admin, and follows conditions", () => {
    mountLanding(document.body, [poll]);
    expect(shown()).toEqual(["o.question", "o.note"]);
    const note = textInput("note");
    expect(note?.disabled).toBe(true);
    expect(note?.placeholder).toBe("Set in admin");
    expect(note?.value).toBe("");

    const custom = document.querySelector<HTMLInputElement>(
      "input[data-focus='o.question:custom']",
    );
    if (!custom) throw new Error("no question choice");
    custom.checked = true;
    custom.dispatchEvent(new Event("change", { bubbles: true }));
    expect(shown()).toEqual(["o.question", "o.ask", "o.answers", "o.note", "o.stars"]);
    expect(textInput("ask")?.disabled).toBe(true);
    const urls = [...document.querySelectorAll<HTMLTextAreaElement>(".url textarea")].map(
      (t) => t.value,
    );
    expect(urls.join("\n")).toContain("o.question=custom");
    expect(urls.join("\n")).not.toContain("o.ask");
  });
});
