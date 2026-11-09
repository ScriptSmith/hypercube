// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { AppManifest } from "../../src/core/types";
import { mountLanding } from "../../src/pages/landing/app";
import { buildUrls, simUrl } from "../../src/pages/landing/urls";
import { config, PLAY, puckGame, sparkVisual } from "./fixtures";

const inputs = { playBase: PLAY, ak: null };

/** Like hockey: `lane` is wall-only and `players` applies to walls and pairs. */
const kindGame: AppManifest = {
  ...puckGame,
  id: "kindy",
  options: [
    { type: "boolean", key: "lane", title: "Child lane", default: false, kinds: ["wall"] },
    {
      type: "number",
      key: "players",
      title: "Players",
      min: 2,
      max: 6,
      step: 1,
      default: 2,
      kinds: ["wall", "pair"],
    },
    { type: "boolean", key: "fast", title: "Fast", default: false },
  ],
};

/** A bank app with one option that only the screen above uses. */
const screenOption: AppManifest = {
  ...sparkVisual,
  id: "skyshow",
  options: [
    { type: "boolean", key: "stars", title: "Stars", default: true, kinds: ["screen"] },
    { type: "boolean", key: "trail", title: "Trail", default: true, kinds: ["panel", "pair"] },
  ],
};

const optionKeys = (url: string | undefined) =>
  [...new URLSearchParams(url?.slice(url.indexOf("?"))).keys()].filter((k) => k.startsWith("o."));

describe("options limited to frame kinds", () => {
  it("writes an option only into URLs for the kinds it applies to", () => {
    const at = (kind: "pair" | "wall" | "kiosk") =>
      optionKeys(buildUrls(config(kindGame, { kind }), kindGame, inputs)[0]?.url);
    expect(at("wall")).toEqual(["o.lane", "o.players", "o.fast"]);
    expect(at("pair")).toEqual(["o.players", "o.fast"]);
    expect(at("kiosk")).toEqual(["o.fast"]);
  });

  it("judges each frame of a bank by its own kind", () => {
    const cfg = config(screenOption, { setup: "bank" });
    const [stations, screen] = buildUrls(cfg, screenOption, inputs);
    expect(optionKeys(stations?.url)).toEqual(["o.trail"]);
    expect(optionKeys(screen?.url)).toEqual(["o.stars"]);
    const sim = simUrl(cfg, screenOption, "https://example.org/sim/");
    expect(sim).toContain("o.stars=1");
    expect(sim).toContain("o.trail=1");
    const noScreen = simUrl({ ...cfg, screen: false }, screenOption, "https://example.org/sim/");
    expect(noScreen).not.toContain("o.stars");
  });
});

describe("options panel", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  it("hides options that don't apply to the chosen kind", () => {
    history.replaceState(null, "", "/hypercube/#/kindy");
    mountLanding(document.body, [kindGame]);
    const shown = () =>
      [...document.querySelectorAll<HTMLElement>("[data-focus^='o.']")].map(
        (e) => e.dataset.focus?.split(":")[0],
      );
    const pick = (id: string) => {
      const input = [...document.querySelectorAll<HTMLInputElement>("input[data-focus]")].find(
        (i) => i.dataset.focus === `kind:${id}`,
      );
      if (!input) throw new Error(`no kind ${id}`);
      input.checked = true;
      input.dispatchEvent(new Event("change"));
    };
    pick("wall");
    expect(new Set(shown())).toEqual(new Set(["o.lane", "o.players", "o.fast"]));
    pick("kiosk");
    expect(new Set(shown())).toEqual(new Set(["o.fast"]));
  });
});
