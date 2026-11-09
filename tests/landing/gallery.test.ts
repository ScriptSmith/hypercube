// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppManifest } from "../../src/core/types";
import { mountLanding } from "../../src/pages/landing/app";
import { appKinds, cleanFilters, createGallery } from "../../src/pages/landing/gallery";
import { pickerApp, puckGame, sparkVisual, stationTool } from "./fixtures";

const ball: AppManifest = {
  id: "ball",
  title: "Ball",
  category: "visual",
  blurb: "A ball.",
  setups: [{ setup: "solo", kinds: ["sphere"] }],
  network: "none",
};

const apps = [puckGame, sparkVisual, stationTool, pickerApp, ball];

const mount = () => {
  const gallery = createGallery(apps, { configureHref: () => "#" });
  document.body.append(gallery.el);
  return gallery.el;
};

const shown = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLLIElement>(".cards > li")]
    .filter((li) => !li.hidden)
    .map((li) => li.querySelector<HTMLAnchorElement>("a.card")?.dataset.app);

const pick = (root: HTMLElement, group: string, value: string) => {
  const input = root.querySelector<HTMLInputElement>(`input[name="${group}"][value="${value}"]`);
  if (!input) throw new Error(`no ${group} ${value}`);
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  history.replaceState(null, "", "/hypercube/");
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("gallery display filter", () => {
  it("lists the kinds an app runs on, in order", () => {
    expect(appKinds(puckGame)).toEqual(["pair", "wall", "kiosk", "screen"]);
    expect(appKinds(ball)).toEqual(["sphere"]);
  });

  it("offers only displays some visible app runs on, with counts", () => {
    const root = mount();
    const kinds = [...root.querySelectorAll<HTMLInputElement>('input[name="kind"]')].map(
      (i) => i.value,
    );
    expect(kinds).toEqual(["all", "panel", "pair", "wall", "kiosk", "screen", "sphere"]);
    const label = root.querySelector('input[name="kind"][value="sphere"]')?.parentElement;
    expect(label?.textContent).toMatch(/Sphere\s*1/);
    expect(label?.querySelector("svg.glyph")).not.toBeNull();
  });

  it("shows only apps for the chosen display, combined with the category", () => {
    const root = mount();
    expect(shown(root)).toEqual(["pucks", "sparks", "picker", "ball"]);
    pick(root, "kind", "sphere");
    expect(shown(root)).toEqual(["ball"]);
    pick(root, "kind", "kiosk");
    expect(shown(root)).toEqual(["pucks", "picker"]);
    pick(root, "category", "game");
    expect(shown(root)).toEqual(["pucks"]);
    pick(root, "kind", "all");
    pick(root, "category", "all");
    expect(shown(root)).toHaveLength(4);
  });

  it("says so when no app matches both", () => {
    const root = mount();
    const empty = root.querySelector<HTMLElement>(".filter-empty");
    expect(empty?.hidden).toBe(true);
    pick(root, "kind", "sphere");
    pick(root, "category", "game");
    expect(shown(root)).toEqual([]);
    expect(empty?.hidden).toBe(false);
  });

  it("remembers the filters, and drops a display no app runs on", () => {
    let root = mount();
    pick(root, "kind", "sphere");
    document.body.replaceChildren();
    root = mount();
    expect(shown(root)).toEqual(["ball"]);
    expect(root.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value).toBe(
      "sphere",
    );

    document.body.replaceChildren();
    const gallery = createGallery([puckGame, sparkVisual], { configureHref: () => "#" });
    document.body.append(gallery.el);
    expect(shown(gallery.el)).toEqual(["pucks", "sparks"]);
  });

  it("starts from given filters over remembered ones, and reports every change", () => {
    let root = mount();
    pick(root, "category", "tool");
    document.body.replaceChildren();
    const seen: string[] = [];
    const gallery = createGallery(apps, {
      configureHref: () => "#",
      filters: { category: "all", kind: "sphere" },
      onFilter: (f) => seen.push(`${f.category}/${f.kind}`),
    });
    root = gallery.el;
    document.body.append(root);
    expect(shown(root)).toEqual(["ball"]);
    pick(root, "category", "visual");
    expect(seen).toEqual(["all/sphere", "visual/sphere"]);
  });

  it("ignores filters it doesn't know", () => {
    expect(cleanFilters({ category: "game", kind: "sphere" })).toEqual({
      category: "game",
      kind: "sphere",
    });
    expect(cleanFilters({ category: "toys", kind: 3 })).toEqual({ category: "all", kind: "all" });
  });
});

describe("gallery filters in the page address", () => {
  const cards = () =>
    [...document.querySelectorAll<HTMLLIElement>(".cards > li")]
      .filter((li) => !li.hidden)
      .map((li) => li.querySelector<HTMLAnchorElement>("a.card")?.dataset.app);

  it("opens a shared link filtered, over what this browser remembers", () => {
    localStorage.setItem("hc:gallery", JSON.stringify({ category: "tool", kind: "panel" }));
    history.replaceState(null, "", "/hypercube/?kind=kiosk");
    mountLanding(document.body, apps);
    expect(cards()).toEqual(["pucks", "picker"]);
    expect(location.search).toBe("?kind=kiosk");
  });

  it("writes the filters into the address, keeping the rest of it", () => {
    history.replaceState(null, "", "/hypercube/?x=1");
    mountLanding(document.body, apps);
    const root = document.body;
    pick(root, "kind", "kiosk");
    pick(root, "category", "game");
    expect(location.pathname).toBe("/hypercube/");
    expect(new URLSearchParams(location.search).get("kind")).toBe("kiosk");
    expect(new URLSearchParams(location.search).get("category")).toBe("game");
    expect(new URLSearchParams(location.search).get("x")).toBe("1");
    pick(root, "kind", "all");
    pick(root, "category", "all");
    expect(location.search).toBe("?x=1");
  });

  it("keeps the filters while an app is open and on the way back", () => {
    history.replaceState(null, "", "/hypercube/?kind=sphere");
    mountLanding(document.body, apps);
    location.hash = "#/ball";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(location.search).toBe("?kind=sphere");
    location.hash = "#";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(location.search).toBe("?kind=sphere");
    expect(cards()).toEqual(["ball"]);
  });
});
