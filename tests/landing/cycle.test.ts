// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppManifest } from "../../src/core/types";
import { createCycler, crossFade, HOLD_MS, previewAt } from "../../src/pages/landing/cycle";
import { createGallery, lookStems } from "../../src/pages/landing/gallery";

describe("previewAt", () => {
  it("starts every tile on its first preview and leaves single previews alone", () => {
    for (let tile = 0; tile < 20; tile++) expect(previewAt(0, tile, 3)).toBe(0);
    expect(previewAt(1e9, 4, 1)).toBe(0);
  });

  it("then shows each preview in turn for a hold", () => {
    const first = (tile: number) => {
      let t = 0;
      while (previewAt(t, tile, 3) === 0) t += 10;
      return t;
    };
    const t = first(5);
    expect(t).toBeGreaterThanOrEqual(HOLD_MS / 2);
    expect(t).toBeLessThan(HOLD_MS * 1.5);
    expect(previewAt(t + 10, 5, 3)).toBe(1);
    expect(previewAt(t + HOLD_MS + 10, 5, 3)).toBe(2);
    expect(previewAt(t + 2 * HOLD_MS + 10, 5, 3)).toBe(0);
    expect(previewAt(t + 3 * HOLD_MS + 10, 5, 3)).toBe(1);
  });

  it("staggers tiles side by side", () => {
    const changes = Array.from({ length: 12 }, (_, tile) => {
      let t = 0;
      while (previewAt(t, tile, 2) === 0) t += 10;
      return t % HOLD_MS;
    }).sort((a, b) => a - b);
    const gaps = changes.slice(1).map((t, i) => t - changes[i]!);
    expect(Math.min(...gaps)).toBeGreaterThan(HOLD_MS / 40);
  });
});

describe("crossFade", () => {
  const looks = () => [0, 1, 2].map(() => document.createElement("img"));
  const state = (imgs: HTMLElement[]) => imgs.map((img) => img.className);

  it("fades a look in over the one before, then back out to the first", () => {
    const imgs = looks();
    crossFade(imgs, 0, 1);
    expect(state(imgs)).toEqual(["is-in", "", ""]);
    crossFade(imgs, 1, 2);
    expect(state(imgs)).toEqual(["is-under", "is-in", ""]);
    crossFade(imgs, 2, 3);
    expect(state(imgs)).toEqual(["", "is-under", "is-in"]);
    crossFade(imgs, 3, 0);
    expect(state(imgs)).toEqual(["", "", "is-out"]);
    crossFade(imgs, 0, 1);
    expect(state(imgs)).toEqual(["is-in", "", ""]);
  });
});

describe("createCycler", () => {
  let observed: Element[];
  let notify: (target: Element, near: boolean) => void;
  let reduce: boolean;
  let clock: number;

  beforeEach(() => {
    vi.useFakeTimers();
    observed = [];
    reduce = false;
    clock = 0;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          notify = (target, near) =>
            cb(
              [{ target, isIntersecting: near } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            );
        }
        observe(el: Element) {
          observed.push(el);
        }
      },
    );
    vi.stubGlobal("matchMedia", () => ({ matches: reduce, addEventListener() {} }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const tile = () => {
    const art = document.createElement("div");
    const cycler = createCycler(() => clock);
    cycler.add(art, ["./thumbs/demo.a.png", "./thumbs/demo.b.png"], 0);
    return art;
  };
  const looks = (art: HTMLElement) => [...art.querySelectorAll<HTMLImageElement>("img.look")];
  const advance = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };

  it("loads each further look a turn before it shows, once the tile comes near", () => {
    const art = tile();
    const sources = () => looks(art).map((img) => img.getAttribute("src"));
    expect(observed).toEqual([art]);
    expect(looks(art)).toHaveLength(0);
    notify(art, true);
    expect(sources()).toEqual(["./thumbs/demo.a.png", null]);
    looks(art)[0]!.dispatchEvent(new Event("load"));
    advance(HOLD_MS * 0.6);
    expect(sources()).toEqual(["./thumbs/demo.a.png", "./thumbs/demo.b.png"]);
  });

  it("changes to a look once it has loaded, and holds still off screen", () => {
    const art = tile();
    const shown = () => looks(art).map((img) => img.className.replace("look", "").trim());
    notify(art, true);
    // Tile 0 first changes half a hold after it came near.
    advance(HOLD_MS * 0.6);
    expect(shown()).toEqual(["", ""]);
    for (const img of looks(art)) img.dispatchEvent(new Event("load"));
    advance(250);
    expect(shown()).toEqual(["is-in", ""]);
    notify(art, false);
    advance(HOLD_MS);
    expect(shown()).toEqual(["is-in", ""]);
    notify(art, true);
    advance(250);
    expect(shown()).toEqual(["is-under", "is-in"]);
  });

  it("drops a look that fails to load", () => {
    const art = tile();
    notify(art, true);
    looks(art)[0]!.dispatchEvent(new Event("error"));
    expect(looks(art)).toHaveLength(1);
    advance(HOLD_MS * 0.6);
    expect(looks(art).map((img) => img.getAttribute("src"))).toEqual(["./thumbs/demo.b.png"]);
  });

  it("keeps the first picture and loads nothing with reduced motion", () => {
    reduce = true;
    const art = tile();
    notify(art, true);
    advance(HOLD_MS * 4);
    expect(looks(art)).toHaveLength(0);
  });

  it("does nothing where IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const art = tile();
    expect(looks(art)).toHaveLength(0);
  });
});

describe("gallery looks", () => {
  const app: AppManifest = {
    id: "demo",
    title: "Demo",
    category: "visual",
    blurb: "A demo.",
    setups: [{ setup: "solo", kinds: ["sphere", "wall"] }],
    network: "none",
    thumb: { kind: "sphere", looks: [{ kind: "wall" }, { options: { colour: "teal" } }] },
  };

  it("lists the looks that have a screenshot, after the first", () => {
    expect(lookStems(app, new Set(["demo", "demo.wall", "demo.colour-teal"]))).toEqual([
      "demo.wall",
      "demo.colour-teal",
    ]);
    expect(lookStems(app, new Set(["demo", "demo.colour-teal"]))).toEqual(["demo.colour-teal"]);
    expect(lookStems(app, new Set(["demo.wall"]))).toEqual([]);
  });

  it("observes only the tiles that have looks", () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe(el: Element) {
          observed.push(el);
        }
      },
    );
    try {
      const plain = { ...app, id: "plain", thumb: undefined };
      createGallery([app, plain], {
        configureHref: () => "#",
        thumbs: new Set(["demo", "demo.wall", "plain"]),
      });
      expect(observed).toHaveLength(1);
      expect(observed[0]!.closest("a")?.dataset.app).toBe("demo");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
