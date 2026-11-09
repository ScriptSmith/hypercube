// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountLanding } from "../../src/pages/landing/app";
import { createTour } from "../../src/pages/landing/tour";
import { pickerApp, puckGame, sparkVisual, stationTool } from "./fixtures";

const apps = [puckGame, sparkVisual, stationTool, pickerApp];

const waitFor = async (check: () => boolean, ms = 4000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

const title = () => document.querySelector(".tour-title")?.textContent ?? null;
const next = () => document.querySelector<HTMLButtonElement>(".tour-tip .btn-primary")!.click();

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  history.replaceState(null, "", "/hypercube/");
});

afterEach(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  document.body.replaceChildren();
});

describe("guide", () => {
  it("starts by itself on a first visit, on the gallery's first card", async () => {
    mountLanding(document.body, apps);
    await waitFor(() => title() === "Pick an app");
    expect(document.querySelector(".tour-count")?.textContent).toBe("1 of 17");
    expect(document.querySelector<HTMLElement>(".tour-spot")?.hidden).toBe(false);
  });

  it("stays out of the way once something is saved, until Guide is pressed", async () => {
    localStorage.setItem("hc:landing", JSON.stringify({ app: "sparks" }));
    mountLanding(document.body, apps);
    await new Promise((r) => setTimeout(r, 100));
    expect(title()).toBeNull();
    [...document.querySelectorAll<HTMLButtonElement>("button.nav-link")]
      .find((b) => b.textContent === "Guide")!
      .click();
    await waitFor(() => title() === "Pick an app");
    expect(location.hash).toBe("");
  });

  it("moves on when a card is picked, and skips sections the app doesn't have", async () => {
    mountLanding(document.body, apps);
    await waitFor(() => title() === "Pick an app");
    location.hash = "#/sparks";
    await waitFor(() => title() === "The app");
    next();
    // Sparks has no options, so the guide goes straight to the setup.
    await waitFor(() => title() === "Where it runs");
    expect(document.querySelector(".tour-count")?.textContent).toBe("4 of 17");
  });

  it("opens the Simulator tab from its step and points at the simulator", async () => {
    mountLanding(document.body, apps);
    await waitFor(() => title() === "Pick an app");
    next();
    await waitFor(() => title() === "The app");
    for (const t of [
      "Options",
      "Where it runs",
      "The frames",
      "The room",
      "Admin PIN",
      "The URLs",
    ]) {
      next();
      await waitFor(() => title() === t);
    }
    next();
    await waitFor(() => title() === "Try it first");
    document.querySelector<HTMLButtonElement>("#out-tab-sim")!.click();
    await waitFor(() => title() === "The simulator");
    expect(location.hash).toMatch(/\/sim$/);
    // None of the showcase's apps are in this gallery, so it goes straight to the last of it.
    next();
    await waitFor(() => title() === "Your settings again");
    next();
    await waitFor(() => title() === "Admin");
    next();
    await waitFor(() => title() === "That's it");
    next();
    expect(document.querySelector(".tour-tip")).toBeNull();
  });

  it("goes back without finding the earlier step already done", async () => {
    mountLanding(document.body, apps);
    await waitFor(() => title() === "Pick an app");
    next();
    await waitFor(() => title() === "The app");
    document.querySelector<HTMLButtonElement>(".tour-tip .btn-quiet")!.click();
    await waitFor(() => title() === "Pick an app");
    await new Promise((r) => setTimeout(r, 400));
    expect(title()).toBe("Pick an app");
    expect(location.hash).toBe("");
  });

  it("shows other apps and setups, then puts the operator's own back", async () => {
    const showcase = [
      { ...sparkVisual, id: "fireworks" },
      { ...sparkVisual, id: "robotarm" },
      { ...sparkVisual, id: "tinyworld" },
      { ...puckGame, id: "hockey" },
    ];
    localStorage.setItem(
      "hc:landing",
      JSON.stringify({ app: "sparks", setup: "solo", kind: "wall", room: "k3j9x2mq7a" }),
    );
    history.replaceState(null, "", "/hypercube/#/sparks");
    mountLanding(document.body, [...apps, ...showcase]);
    const appNow = () => document.querySelector<HTMLSelectElement>("#app-select")?.value;
    const setupNow = () =>
      [...document.querySelectorAll<HTMLInputElement>("input[data-focus^='setup:']")].find(
        (i) => i.checked,
      )?.value;
    [...document.querySelectorAll<HTMLButtonElement>("button.nav-link")]
      .find((b) => b.textContent === "Guide")!
      .click();
    await waitFor(() => title() === "Pick an app");
    next();
    for (const t of [
      "The app",
      "Where it runs",
      "The frames",
      "The room",
      "Admin PIN",
      "The URLs",
    ]) {
      await waitFor(() => title() === t);
      next();
    }
    await waitFor(() => title() === "Try it first");
    next();
    await waitFor(() => title() === "The simulator");
    next();
    await waitFor(() => title() === "A row of panels");
    expect([appNow(), setupNow()]).toEqual(["fireworks", "bank"]);
    expect(location.hash).toBe("#/fireworks/sim");
    next();
    await waitFor(() => title() === "Merged pairs");
    expect(appNow()).toBe("robotarm");
    next();
    await waitFor(() => title() === "A touch wall");
    next();
    await waitFor(() => title() === "Two walls");
    expect([appNow(), setupNow()]).toEqual(["hockey", "versus"]);
    next();
    await waitFor(() => title() === "Your settings again");
    expect([appNow(), setupNow()]).toEqual(["sparks", "solo"]);
    expect(document.querySelector<HTMLInputElement>('input[data-focus="room"]')?.value).toBe(
      "k3j9x2mq7a",
    );

    // Closing the guide part way through the showcase also puts them back.
    document.querySelector<HTMLButtonElement>(".tour-tip .btn-quiet")!.click();
    await waitFor(() => title() === "Two walls");
    expect(appNow()).toBe("hockey");
    document.querySelector<HTMLButtonElement>(".tour-close")!.click();
    expect([appNow(), setupNow()]).toEqual(["sparks", "solo"]);
  });

  it("ends on Escape or the close button, leaving nothing behind", async () => {
    const target = document.body.appendChild(document.createElement("div"));
    const tour = createTour([
      { target: () => target, title: "One", text: "First." },
      { target: () => target, title: "Two", text: "Second." },
    ]);
    tour.start();
    await waitFor(() => title() === "One");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(tour.open).toBe(false);
    expect(document.querySelector(".tour-tip, .tour-spot")).toBeNull();
    tour.start();
    await waitFor(() => title() === "One");
    document.querySelector<HTMLButtonElement>(".tour-close")!.click();
    expect(tour.open).toBe(false);
  });
});
