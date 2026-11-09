// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { LandingConfig } from "../../src/pages/landing/config";
import { diagramSvg } from "../../src/pages/landing/diagram";
import { buildUrls, planSetup } from "../../src/pages/landing/urls";
import { config, PLAY, sparkVisual } from "./fixtures";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Frame rectangles from the diagram, grouped by the key of the URL they belong to. */
const boxes = (cfg: LandingConfig): Map<string, Box[]> => {
  const entries = buildUrls(cfg, sparkVisual, { playBase: PLAY, ak: null });
  const svg = diagramSvg(planSetup(cfg, sparkVisual), entries, cfg);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const out = new Map<string, Box[]>();
  for (const g of doc.querySelectorAll("g.f")) {
    const r = g.querySelector("rect.f-body");
    const key = g.getAttribute("data-key") ?? "";
    const box = {
      x: Number(r?.getAttribute("x")),
      y: Number(r?.getAttribute("y")),
      w: Number(r?.getAttribute("width")),
      h: Number(r?.getAttribute("height")),
    };
    out.set(key, [...(out.get(key) ?? []), box]);
  }
  return out;
};

const expectScreenOverBank = (screen: Box[] | undefined, bank: Box[] | undefined) => {
  expect(screen).toHaveLength(1);
  const s = screen?.[0] as Box;
  const left = Math.min(...(bank ?? []).map((b) => b.x));
  const right = Math.max(...(bank ?? []).map((b) => b.x + b.w));
  expect(s.x).toBeCloseTo(left, 0);
  expect(s.x + s.w).toBeCloseTo(right, 0);
  expect(s.y + s.h).toBeLessThan(Math.min(...(bank ?? []).map((b) => b.y)));
};

describe("layout diagram", () => {
  it("draws a bank's screen above it at the same width", () => {
    const panels = boxes(config(sparkVisual, { setup: "bank" }));
    expect(panels.get("all-station")).toHaveLength(6);
    expectScreenOverBank(panels.get("all-screen"), panels.get("all-station"));

    const pairs = boxes(config(sparkVisual, { setup: "bank", kind: "pair" }));
    expect(pairs.get("all-station")).toHaveLength(3);
    expectScreenOverBank(pairs.get("all-screen"), pairs.get("all-station"));
  });

  it("draws each corner screen over its own bank", () => {
    const corner = boxes(config(sparkVisual, { setup: "corner" }));
    expectScreenOverBank(corner.get("left-screen"), corner.get("left-station"));
    expectScreenOverBank(corner.get("right-screen"), corner.get("right-station"));
  });

  it("keeps the same geometry when each frame has its own URL", () => {
    const manual = boxes(config(sparkVisual, { setup: "bank", identity: "manual", count: 4 }));
    const stations = [...manual].filter(([k]) => k.startsWith("panel-")).flatMap(([, b]) => b);
    expect(stations).toHaveLength(4);
    expectScreenOverBank(manual.get("screen"), stations);
  });
});

describe("layout diagram and venue values", () => {
  it("draws as many frames as the bank holds, with a seam per merged panel", () => {
    const cfg = config(sparkVisual, { setup: "bank", kind: "pair", count: 7, identity: "manual" });
    const entries = buildUrls(cfg, sparkVisual, { playBase: PLAY, ak: null });
    const svg = diagramSvg(planSetup(cfg, sparkVisual), entries, cfg);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const stations = [...doc.querySelectorAll("g.f")].filter((g) =>
      g.getAttribute("data-key")?.startsWith("pair-"),
    );
    expect(stations).toHaveLength(7);
    for (const g of stations) expect(g.querySelectorAll("line.f-seam")).toHaveLength(cfg.span - 1);
    const big = config(sparkVisual, { setup: "bank", count: 20 });
    expect(boxes(big).get("all-station")).toHaveLength(20);
    expectScreenOverBank(boxes(big).get("all-screen"), boxes(big).get("all-station"));
  });
});
