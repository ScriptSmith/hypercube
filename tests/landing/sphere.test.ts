// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeFrame } from "../../src/core/frame";
import { parseParams } from "../../src/core/params";
import type { AppManifest } from "../../src/core/types";
import { DEFAULT_VENUE } from "../../src/core/venue";
import { mountLanding } from "../../src/pages/landing/app";
import { kindGlyph } from "../../src/pages/landing/art";
import { kindChoices, supportFor, touchKind } from "../../src/pages/landing/config";
import { diagramSvg } from "../../src/pages/landing/diagram";
import { buildUrls, planSetup, previewUrl, simPreset, simUrl } from "../../src/pages/landing/urls";
import { config, PLAY } from "./fixtures";

/** A tool that runs on a wall or a sphere alone, and in a bank that lists a sphere by mistake. */
const globeTool: AppManifest = {
  id: "globes",
  title: "Globes",
  category: "tool",
  blurb: "Checks for a ball.",
  setups: [
    { setup: "solo", kinds: ["sphere", "wall"] },
    { setup: "bank", kinds: ["sphere", "panel", "screen"] },
  ],
  network: "optional",
};

const inputs = { playBase: PLAY, ak: null };
const search = (url: string) => url.slice(url.indexOf("?"));
const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");
const sphereConfig = (patch = {}) => config(globeTool, { kind: "sphere", ...patch });

describe("sphere kind in the configuration", () => {
  it("is offered last, and only for a solo setup", () => {
    expect(kindChoices(supportFor(globeTool, "solo")!)).toEqual(["wall", "sphere"]);
    expect(kindChoices(supportFor(globeTool, "bank")!)).toEqual(["panel"]);
    expect(config(globeTool, { setup: "bank", kind: "sphere" }).kind).toBe("panel");
    expect(touchKind("sphere")).toBe(false);
    expect(touchKind("screen")).toBe(false);
    expect(touchKind("wall")).toBe(true);
  });

  it("writes one solo URL with kind=sphere and no span or reach", () => {
    const cfg = sphereConfig({ reachOverride: true, reach: { adult: 0.5, child: 0.3 } });
    const entries = buildUrls(cfg, globeTool, inputs);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect([entry?.label, entry?.note, entry?.role, entry?.kind]).toEqual([
      "Sphere",
      "the one sphere it runs on",
      "solo",
      "sphere",
    ]);
    const q = new URLSearchParams(search(entry?.url ?? ""));
    expect([q.get("setup"), q.get("role"), q.get("kind")]).toEqual(["solo", "solo", "sphere"]);
    expect(q.has("span")).toBe(false);
    expect(q.has("reach")).toBe(false);
    expect([q.get("w"), q.get("h")]).toEqual(["{w}", "{h}"]);
  });

  it("runs as a sphere once the host fills in the URL", () => {
    const url = buildUrls(sphereConfig({ identity: "manual" }), globeTool, inputs)[0]?.url ?? "";
    const params = parseParams(search(url));
    expect(params.kind).toBe("sphere");
    const frame = computeFrame("sphere", { width: 1960, height: 980 }, params);
    expect(frame.touch).toBe(false);
    expect(frame.sphere?.radius).toBeCloseTo(DEFAULT_VENUE.sphere.diameterM / 2, 9);
  });

  it("previews the ball at the feed's size and opens the sphere preset in the simulator", () => {
    const cfg = sphereConfig();
    const { width, height } = DEFAULT_VENUE.sphere;
    const preview = parseParams(search(previewUrl(buildUrls(cfg, globeTool, inputs)) ?? ""));
    expect(preview).toMatchObject({ kind: "sphere", preview: true, fit: { width, height } });
    expect(preview.look).toBe("globe");
    expect(simPreset("solo", "sphere")).toBe("sphere");
    expect(simUrl(cfg, globeTool, "https://x.org/sim/")).toBe(
      "https://x.org/sim/?preset=sphere&app=globes",
    );
  });
});

describe("sphere drawings", () => {
  it("draws the glyph as a ball, as wide as it is tall", () => {
    const svg = parse(kindGlyph("sphere", 12)).documentElement;
    expect(svg.getAttribute("width")).toBe("12");
    expect(svg.getAttribute("height")).toBe("12");
    expect(svg.querySelector("circle")).not.toBeNull();
    expect(svg.querySelector("rect")).toBeNull();
  });

  it("draws the diagram to scale: a ball on a line from the ceiling, over an adult", () => {
    const cfg = sphereConfig();
    const entries = buildUrls(cfg, globeTool, inputs);
    const doc = parse(diagramSvg(planSetup(cfg, globeTool), entries, cfg));
    expect(doc.querySelector("parsererror")).toBeNull();
    const g = doc.querySelector("g.f");
    expect(g?.getAttribute("data-key")).toBe(entries[0]?.key);
    expect(doc.querySelector("rect.f-body")).toBeNull();
    const ball = g?.querySelector("circle.f-body");
    const hang = g?.querySelector("line.f-hang");
    const num = (el: Element | null | undefined, name: string) => Number(el?.getAttribute(name));
    const r = num(ball, "r");
    const cy = num(ball, "cy");
    expect(num(hang, "y1")).toBeLessThan(1);
    expect(num(hang, "y2")).toBeCloseTo(cy - r, 0);

    const [ceiling, floor] = [...doc.querySelectorAll("line.room")].map((l) => num(l, "y1"));
    const { diameterM, bottomM } = DEFAULT_VENUE.sphere;
    const pxPerM = (2 * r) / diameterM;
    expect((floor! - (cy + r)) / pxPerM).toBeCloseTo(bottomM, 1);
    expect(ceiling).toBeLessThan(cy - r);
    const person = doc.querySelector("g.person rect");
    expect(person).not.toBeNull();
    // The adult stands under the ball with room to spare.
    expect(num(person, "y")).toBeGreaterThan(cy + r);
  });
});

describe("sphere on the page", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    history.replaceState(null, "", "/hypercube/#/globes");
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("picks the sphere, writes its URL and draws the ball without reach controls", () => {
    mountLanding(document.body, [globeTool]);
    const pick = (focus: string) => {
      const input = document.querySelector<HTMLInputElement>(`input[data-focus="${focus}"]`);
      if (!input) throw new Error(`no ${focus}`);
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    pick("kind:wall");
    expect(document.querySelector("[data-focus='reachOverride']")).not.toBeNull();
    pick("kind:sphere");
    const urls = [...document.querySelectorAll<HTMLTextAreaElement>(".url textarea")];
    expect(urls).toHaveLength(1);
    expect(urls[0]?.value).toContain("&kind=sphere&");
    expect(document.querySelector("[data-focus='reachOverride']")).toBeNull();
    expect(document.querySelector(".diagram circle.f-body")).not.toBeNull();
    expect(document.querySelector(".diagram-wrap figcaption")?.textContent).toBe(
      "To scale, with an adult underneath.",
    );
    const sim = document.querySelector<HTMLAnchorElement>(".out-links a")?.href;
    expect(sim).toMatch(/\/sim\/\?preset=sphere&app=globes$/);
  });
});

describe("a setup listed once per group of kinds", () => {
  const split: AppManifest = {
    id: "split",
    title: "Split",
    category: "visual",
    blurb: "A sphere piece that also runs on a wall.",
    setups: [
      { setup: "solo", kinds: ["sphere"], note: "Round the ball." },
      { setup: "solo", kinds: ["wall"], note: "Along the wall." },
      { setup: "bank", kinds: ["panel", "screen"], roles: ["station", "screen"] },
    ],
    network: "none",
  };

  it("offers the kinds of every entry, with the note for the chosen kind", () => {
    expect(kindChoices(supportFor(split, "solo")!)).toEqual(["wall", "sphere"]);
    expect(supportFor(split, "solo", "wall")?.note).toBe("Along the wall.");
    expect(supportFor(split, "solo", "sphere")?.note).toBe("Round the ball.");
    expect(config(split, { kind: "wall" }).kind).toBe("wall");
    expect(config(split, { kind: "sphere" }).kind).toBe("sphere");
    expect(supportFor(split, "bank")).toBe(split.setups[2]);
  });
});
