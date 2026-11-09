// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { appsControl, optionControl } from "../../src/pages/sim/controls";

const APPS = [
  { id: "hockey", title: "Table Hockey" },
  { id: "tinyworld", title: "Tiny World" },
  { id: "idle", title: "Idle", hidden: true },
];

const boxes = (el: HTMLElement) => [...el.querySelectorAll<HTMLInputElement>("input")];

describe("appsControl", () => {
  it("lists visible apps, ticks the chosen ones and applies once when closed", () => {
    const changes: string[] = [];
    const el = appsControl(
      "Apps",
      "tinyworld",
      APPS,
      (v) => changes.push(v),
      new AbortController().signal,
    );
    expect(el.querySelector("summary")?.textContent).toBe("Apps: 1");
    expect(boxes(el).map((b) => b.checked)).toEqual([false, true]);

    const details = el as HTMLDetailsElement;
    details.open = true;
    for (const box of boxes(el)) {
      box.checked = !box.checked;
      box.dispatchEvent(new Event("change"));
    }
    expect(changes).toEqual([]);
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    expect(changes).toEqual(["hockey"]);
  });

  it("keeps a chosen hidden app and reads an empty set as every app", () => {
    const el = appsControl("Apps", "", APPS, () => {}, new AbortController().signal);
    expect(el.querySelector("summary")?.textContent).toBe("Apps: all");
    expect(boxes(el)).toHaveLength(2);
    const withHidden = appsControl("Apps", "idle", APPS, () => {}, new AbortController().signal);
    expect(boxes(withHidden)).toHaveLength(3);
  });
});

describe("optionControl", () => {
  it("shows a text option as a disabled field set in admin", () => {
    const changes: unknown[] = [];
    const el = optionControl(
      { type: "text", key: "ask", title: "Question text", maxLength: 80, default: "" },
      "",
      (v) => changes.push(v),
      new AbortController().signal,
    );
    const input = el.querySelector<HTMLInputElement>("input");
    expect(el.textContent).toContain("Question text");
    expect(input?.disabled).toBe(true);
    expect(input?.placeholder).toBe("Set in admin");
    expect(changes).toEqual([]);
  });
});
