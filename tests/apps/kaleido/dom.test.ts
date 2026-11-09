// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createGhosts, MAX_GHOSTS } from "../../../src/apps/kaleido/ghosts";
import { createHourMarks } from "../../../src/apps/kaleido/labels";

const visible = (root: HTMLElement, selector: string) =>
  [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => el.style.display !== "none" && el.style.opacity !== "0",
  );

describe("ghost hands", () => {
  it("press where the attract pours, with the fingertip on the spot", () => {
    const root = document.createElement("div");
    const g = createGhosts(root, 160);
    g.show([{ x: 500, y: 1700 }], 0.5);
    const shown = visible(root, ".kl-ghosts > span");
    expect(shown).toHaveLength(1);
    // 160 venue px at half scale is 80 px; the fingertip sits 0.41 across and 0.03 down.
    expect(shown[0]!.style.width).toBe("80px");
    expect(shown[0]!.style.transform).toBe("translate(217.2px,847.6px)");
    g.show([], 0.5);
    expect(visible(root, ".kl-ghosts > span")).toHaveLength(0);
  });

  it("show at most MAX_GHOSTS and go away on dispose", () => {
    const root = document.createElement("div");
    const g = createGhosts(root, 160);
    g.show(
      Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 0 })),
      1,
    );
    expect(visible(root, ".kl-ghosts > span")).toHaveLength(MAX_GHOSTS);
    g.dispose();
    expect(root.querySelector(".kl-ghosts")).toBeNull();
  });
});

describe("hour marks", () => {
  it("label each band beside it, all at one size, and skip bands too thin to hold text", () => {
    const root = document.createElement("div");
    const m = createHourMarks(root, 34);
    m.show(
      [
        { hour: 9, top: 0, bottom: 60 },
        { hour: 10, top: 60, bottom: 70 },
        { hour: 13, top: 70, bottom: 110 },
      ],
      1,
      1,
    );
    const labels = visible(root, ".kl-hours > div");
    expect(labels.map((l) => l.textContent)).toEqual(["9 am", "1 pm"]);
    const sizes = new Set(labels.map((l) => l.style.fontSize));
    expect(sizes.size).toBe(1);
    // The thinnest labelled band is 40 px tall, so the text is at most 0.78 of that.
    expect(Number.parseFloat(labels[0]!.style.fontSize)).toBeCloseTo(40 * 0.78, 1);
    expect(labels[1]!.style.top).toBe("90px");
  });

  it("hide while the layers are hidden", () => {
    const root = document.createElement("div");
    const m = createHourMarks(root, 34);
    m.show([{ hour: 9, top: 0, bottom: 60 }], 1, 0);
    expect(visible(root, ".kl-hours > div")).toHaveLength(0);
    m.dispose();
    expect(root.querySelector(".kl-hours")).toBeNull();
  });
});
