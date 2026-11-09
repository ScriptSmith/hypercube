// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInput, type InputHandle } from "../../src/core/input";
import { createUi, ICON_NAMES, iconSvg, isIconName, type UiHandle } from "../../src/core/ui";
import { firePointer, makeRoot, panelFrame, useFakeClock } from "../input/dom";

let root: HTMLElement;
let ui: UiHandle;
let input: InputHandle;

beforeEach(() => {
  useFakeClock();
  root = makeRoot({ width: 1080, height: 1920 });
  input = createInput(root);
  ui = createUi(root, () => panelFrame({ unit: 0.5 }));
});

afterEach(() => {
  ui.dispose();
  input.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});

const rect = { x: 100, y: 100, width: 300, height: 300 };

describe("button", () => {
  it("fires on touch and keeps the press from the app's input", () => {
    const onPress = vi.fn();
    const appDown = vi.fn();
    input.on("down", appDown);
    const el = ui.button({ icon: "play", rect, onPress });
    firePointer(el, "pointerdown", { pointerId: 1 });
    firePointer(el, "pointerup", { pointerId: 1 });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(appDown).not.toHaveBeenCalled();
    expect(el.querySelector("svg")).not.toBeNull();
    expect(el.style.left).toBe("100px");
  });

  it("needs the full hold time, shown by a ring", () => {
    const onPress = vi.fn();
    const el = ui.button({ icon: "reset", rect, hold: 1000, onPress });
    expect(el.querySelectorAll("svg rect")).toHaveLength(2);

    firePointer(el, "pointerdown", { pointerId: 1 });
    vi.advanceTimersByTime(700);
    firePointer(el, "pointerup", { pointerId: 1 });
    vi.advanceTimersByTime(1000);
    expect(onPress).not.toHaveBeenCalled();

    firePointer(el, "pointerdown", { pointerId: 2 });
    vi.advanceTimersByTime(1000);
    expect(onPress).toHaveBeenCalledTimes(1);
    firePointer(el, "pointerup", { pointerId: 2 });
  });

  it("keeps holding while any finger stays on it", () => {
    const onPress = vi.fn();
    const el = ui.button({ label: "Go", rect, hold: 1000, onPress });
    firePointer(el, "pointerdown", { pointerId: 1 });
    firePointer(el, "pointerdown", { pointerId: 2 });
    vi.advanceTimersByTime(300);
    firePointer(el, "pointerup", { pointerId: 1 });
    vi.advanceTimersByTime(800);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(el.textContent).toBe("Go");
  });

  it("does nothing once its element is removed", () => {
    const onPress = vi.fn();
    const el = ui.button({ rect, hold: 500, onPress });
    firePointer(el, "pointerdown", { pointerId: 1 });
    el.remove();
    vi.advanceTimersByTime(600);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("label, toast and countdown", () => {
  it("sizes labels in venue px", () => {
    const el = ui.label("Hi", { x: 50, y: 60, size: 100 });
    expect(el.style.fontSize).toBe("50px");
    expect(el.textContent).toBe("Hi");
  });

  it("keeps at most three toasts and clears them", () => {
    for (let i = 0; i < 5; i++) ui.toast(`t${i}`, 1000);
    const texts = () =>
      [...root.querySelectorAll(".hc-ui > div")].map((e) => e.textContent).filter(Boolean);
    expect(texts()).toEqual(["t2", "t3", "t4"]);
    vi.advanceTimersByTime(1100);
    expect(texts()).toEqual([]);
  });

  it("counts down 3, 2, 1 and then resolves", async () => {
    const done = vi.fn();
    void ui.countdown(3).then(done);
    const shown = () => root.querySelector(".hc-anim-pop")?.textContent;
    expect(shown()).toBe("3");
    await vi.advanceTimersByTimeAsync(1000);
    expect(shown()).toBe("2");
    await vi.advanceTimersByTimeAsync(1000);
    expect(shown()).toBe("1");
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toHaveBeenCalled();
    expect(shown()).toBeUndefined();
  });

  it("resolves a zero countdown at once", async () => {
    await expect(ui.countdown(0)).resolves.toBeUndefined();
  });
});

describe("icons", () => {
  it("has the set apps need, as currentColor SVG", () => {
    for (const name of ["up", "down", "check", "reset", "play", "hand", "touch", "close"]) {
      expect(isIconName(name)).toBe(true);
    }
    expect(isIconName("toString")).toBe(false);
    for (const name of ICON_NAMES) {
      const svg = iconSvg(name, 40);
      expect(svg).toMatch(/^<svg viewBox="0 0 100 100" width="40px"/);
      expect(svg).toContain("currentColor");
    }
  });
});
