// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeVenue, DEFAULT_VENUE, setActiveVenue } from "../../src/core/venue";
import { mountLanding } from "../../src/pages/landing/app";
import { createGallery } from "../../src/pages/landing/gallery";
import { pickerApp, puckGame, ROOM, sparkVisual, stationTool } from "./fixtures";

const apps = [puckGame, sparkVisual, stationTool];

const urls = () =>
  [...document.querySelectorAll<HTMLTextAreaElement>(".url textarea")].map((t) => t.value);

const choose = (name: string, id: string) => {
  const input = [...document.querySelectorAll<HTMLInputElement>("input[data-focus]")].find(
    (i) => i.dataset.focus === `${name}:${id}`,
  );
  if (!input) throw new Error(`no choice ${name}:${id}`);
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const field = (name: string) =>
  [...document.querySelectorAll<HTMLInputElement>("input[data-focus]")].find(
    (i) => i.dataset.focus === name,
  );

const waitFor = async (check: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  history.replaceState(null, "", "/hypercube/");
});

afterEach(() => {
  document.body.replaceChildren();
  setActiveVenue(DEFAULT_VENUE);
});

describe("landing page", () => {
  it("shows only visible apps in the gallery, with art and setups", () => {
    mountLanding(document.body, apps);
    const cards = [...document.querySelectorAll<HTMLAnchorElement>("a.card")];
    expect(cards.map((c) => c.dataset.app)).toEqual(["pucks", "sparks"]);
    expect(cards[0]?.getAttribute("href")).toBe("#/pucks");
    expect(cards[0]?.querySelector(".art svg")).not.toBeNull();
    expect(cards[0]?.querySelector(".art img")).toBeNull();
    expect(cards[0]?.querySelectorAll(".chip")).toHaveLength(2);
  });

  it("lays a screenshot over the art only when one exists", () => {
    const gallery = createGallery(apps, { configureHref: () => "#", thumbs: new Set(["sparks"]) });
    const imgs = [...gallery.el.querySelectorAll<HTMLImageElement>(".art img")];
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["./thumbs/sparks.png"]);
  });

  it("opens the panel from the hash and builds URLs from the page location", () => {
    history.replaceState(null, "", "/hypercube/#/sparks");
    mountLanding(document.body, apps);
    expect(document.querySelector<HTMLElement>(".gallery")?.hidden).toBe(true);
    const [url] = urls();
    expect(url).toMatch(/^http:\/\/localhost(:\d+)?\/hypercube\/play\/\?app=sparks&setup=bank/);
    const sim = document.querySelector<HTMLAnchorElement>(".out-links a")?.href;
    expect(sim).toMatch(/\/hypercube\/sim\/\?preset=bank&count=6&span=1&app=sparks$/);
  });

  it("takes a number option in a box, kept in range and on its step", () => {
    history.replaceState(null, "", "/hypercube/#/pucks");
    mountLanding(document.body, apps);
    const speed = field("o.speed");
    if (!speed) throw new Error("no speed box");
    expect(speed.type).toBe("number");
    expect(speed.value).toBe("1");
    expect(urls()[0]).toContain("o.speed=1&");
    const type = (text: string) => {
      speed.value = text;
      speed.dispatchEvent(new Event("input", { bubbles: true }));
    };
    type("1.5");
    // Typing doesn't rebuild the form, so the box keeps focus.
    expect(field("o.speed")).toBe(speed);
    expect(urls()[0]).toContain("o.speed=1.5&");
    type("1.234");
    expect(urls()[0]).toContain("o.speed=1.2&");
    // Half-typed or out of range: the last good value stands, and leaving the box shows it.
    type("9");
    expect(urls()[0]).toContain("o.speed=2&");
    type("");
    expect(urls()[0]).toContain("o.speed=2&");
    speed.dispatchEvent(new Event("change", { bubbles: true }));
    expect(speed.value).toBe("2");
  });

  it("switches to manual identity and back", () => {
    history.replaceState(null, "", "/hypercube/#/sparks");
    mountLanding(document.body, apps);
    expect(urls()).toHaveLength(2);
    choose("identity", "manual");
    expect(urls()).toHaveLength(7);
    choose("identity", "placeholders");
    expect(urls()).toHaveLength(2);
  });

  it("adds the admin key for a valid PIN and keeps the PIN out of the configuration", async () => {
    history.replaceState(null, "", "/hypercube/#/pucks");
    mountLanding(document.body, apps);
    const pin = document.querySelector<HTMLInputElement>("input.pin");
    if (!pin) throw new Error("no PIN field");
    pin.value = "48x21";
    pin.dispatchEvent(new Event("input"));
    expect(pin.value).toBe("4821");
    expect(urls()[0]).not.toMatch(/[?&](ak|pv)=/);
    const key = field("ak")?.value ?? "";
    expect(key).toMatch(/^[\w-]{22}$/);
    await waitFor(() => /[?&]pv=/.test(urls()[0] ?? ""));
    expect(urls()[0]).toContain(`&ak=${key}&pv=`);
    expect(document.querySelector(".badge")?.textContent).toBe("Admin on");
    const admin = [...document.querySelectorAll<HTMLAnchorElement>(".out-links a")].at(-1)?.href;
    expect(admin).toMatch(/\/admin\/\?room=[a-z2-9]{10}&ak=[\w-]{22}&pv=[\w-]{22}&peer=public$/);
    const stored = localStorage.getItem("hc:landing") ?? "";
    expect(stored).not.toContain("4821");
    expect(stored).toContain(`"ak":"${key}"`);
    expect(stored).not.toMatch(/"pv"/);
    expect(localStorage.getItem("hc:credentials")).toContain("4821");

    // A new room comes with a new key, and the PIN check is made again for it.
    const newRoom = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "New room",
    );
    newRoom?.click();
    const nextKey = field("ak")?.value ?? "";
    expect(nextKey).not.toBe(key);
    await waitFor(() => (urls()[0] ?? "").includes(`&ak=${nextKey}&pv=`));
  });

  it("uses the signalling secret in URLs and remembers it apart from the configuration", () => {
    history.replaceState(null, "", "/hypercube/#/pucks");
    mountLanding(document.body, apps);
    choose("signalling", "custom");
    const address = field("peer");
    const secret = field("secret");
    if (!address || !secret) throw new Error("no server fields");
    expect(secret.type).toBe("password");
    address.value = "wss://sig.example.org/hc";
    address.dispatchEvent(new Event("input"));
    secret.value = "hush-hush";
    secret.dispatchEvent(new Event("input"));
    expect(urls()[0]).toContain("peer=wss://sig.example.org/hc%3Fkey%3Dhush-hush");
    const stored = localStorage.getItem("hc:landing") ?? "";
    expect(stored).toContain("wss://sig.example.org/hc");
    expect(stored).not.toContain("hush-hush");
    expect(localStorage.getItem("hc:credentials")).toContain("hush-hush");

    // A reload brings the secret back for the same address.
    document.body.replaceChildren();
    mountLanding(document.body, apps);
    expect(field("secret")?.value).toBe("hush-hush");
    expect(urls()[0]).toContain("%3Fkey%3Dhush-hush");
  });

  it("remembers the PIN after a reload", async () => {
    history.replaceState(null, "", "/hypercube/#/pucks");
    mountLanding(document.body, apps);
    const pin = document.querySelector<HTMLInputElement>("input.pin");
    if (!pin) throw new Error("no PIN field");
    pin.value = "4821";
    pin.dispatchEvent(new Event("input"));
    document.body.replaceChildren();
    mountLanding(document.body, apps);
    expect(document.querySelector<HTMLInputElement>("input.pin")?.value).toBe("4821");
    await waitFor(() => /[?&]pv=/.test(urls()[0] ?? ""));

    // Clearing the field forgets it.
    const again = document.querySelector<HTMLInputElement>("input.pin")!;
    again.value = "";
    again.dispatchEvent(new Event("input"));
    expect(localStorage.getItem("hc:credentials")).toBeNull();
  });

  it("lists gallery apps for an apps option, marking the ones that don't fit", () => {
    history.replaceState(null, "", "/hypercube/#/picker");
    mountLanding(document.body, [pickerApp, ...apps]);
    const checks = [...document.querySelectorAll<HTMLInputElement>(".app-checks input")];
    // Hidden apps and the picker itself are left out; pucks has no panel setup.
    expect(checks.map((c) => c.dataset.focus)).toEqual(["o.apps:pucks", "o.apps:sparks"]);
    expect(checks.map((c) => c.disabled)).toEqual([true, false]);
    expect(document.querySelector(".apps-summary")?.textContent).toContain("All suitable apps (1)");
    expect(urls()[0]).toContain("&o.apps=&");
    choose("o.apps", "sparks");
    expect(urls()[0]).toContain("&o.apps=sparks&");
    expect(document.querySelector(".apps-summary")?.textContent).toContain(
      "1 tile from 1 suitable app.",
    );
  });

  it("adds variant presets under an app, written in gallery order", () => {
    history.replaceState(null, "", "/hypercube/#/picker");
    mountLanding(document.body, [pickerApp, ...apps]);
    choose("kind", "wall");
    const toggle = document.querySelector<HTMLButtonElement>(".variants-toggle");
    expect(toggle?.textContent).toBe("1 variant");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(field("o.apps:pucks:paddles")).toBeUndefined();
    toggle?.click();
    expect(field("o.apps:pucks:paddles")).toBeDefined();
    // Ticked out of order on purpose: entries come out in gallery order, app before preset.
    choose("o.apps", "sparks");
    choose("o.apps", "pucks:paddles");
    choose("o.apps", "pucks");
    expect(urls()[0]).toContain("&o.apps=pucks,pucks:paddles,sparks&");
    expect(document.querySelector(".apps-summary")?.textContent).toContain(
      "3 tiles from 2 suitable apps",
    );
    const after = document.querySelector(".variants-toggle");
    expect(after?.textContent).toBe("1 variant");
    expect(after?.classList.contains("has-ticked")).toBe(true);
    expect(after?.getAttribute("aria-label")).toBe("Puck Table variants, 1 ticked");
    const unticked = field("o.apps:pucks");
    if (!unticked) throw new Error("no pucks box");
    unticked.checked = false;
    unticked.dispatchEvent(new Event("change"));
    expect(urls()[0]).toContain("&o.apps=pucks:paddles,sparks&");
  });

  it("remembers the last configuration", () => {
    history.replaceState(null, "", "/hypercube/#/sparks");
    mountLanding(document.body, apps);
    choose("identity", "manual");
    const room = document.querySelector<HTMLInputElement>("input.mono")?.value;
    document.body.replaceChildren();
    history.replaceState(null, "", "/hypercube/");
    mountLanding(document.body, apps);
    const select = document.querySelector<HTMLSelectElement>("#app-select");
    expect(select?.value).toBe("sparks");
    expect(document.querySelector<HTMLInputElement>("input.mono")?.value).toBe(room);
    expect(urls()).toHaveLength(7);
  });

  it("survives storage that throws", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      history.replaceState(null, "", "/hypercube/#/pucks");
      expect(() => mountLanding(document.body, apps)).not.toThrow();
      choose("setup", "versus");
      expect(urls()).toHaveLength(4);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("uses a room by default and hides the PIN only when standalone", () => {
    history.replaceState(null, "", "/hypercube/#/sparks");
    mountLanding(document.body, apps);
    expect(urls().every((u) => /[?&]room=/.test(u))).toBe(true);
    expect(document.querySelector("input.pin")).not.toBeNull();
    const standalone = [...document.querySelectorAll<HTMLInputElement>("input.switch")].find(
      (i) => i.dataset.focus === "standalone",
    );
    if (!standalone) throw new Error("no standalone switch");
    standalone.checked = true;
    standalone.dispatchEvent(new Event("change"));
    expect(document.querySelector("input.pin")).toBeNull();
    expect(urls().some((u) => /[?&](room|ak|pv|peer)=/.test(u))).toBe(false);
    expect(document.querySelector(".badge")?.textContent).toBe("Standalone");
  });

  it("takes the operator's venue profile, remembers it and puts it in every URL", () => {
    history.replaceState(null, "", "/hypercube/#/sparks");
    mountLanding(document.body, apps);
    expect(urls().some((u) => u.includes("venue="))).toBe(false);
    const venue = field("venue");
    if (!venue) throw new Error("no venue field");
    venue.value = " wall:7680x2880:16x6:0.1, bank:4,nonsense:1 ";
    venue.dispatchEvent(new Event("input"));
    expect(urls().every((u) => u.includes("&venue=bank:4,wall:7680x2880:16x6:0.1&"))).toBe(true);
    const sim = document.querySelector<HTMLAnchorElement>(".out-links a")?.href ?? "";
    expect(sim).toContain("?preset=bank&venue=bank:4,wall:7680x2880:16x6:0.1&");
    expect(document.querySelector(".field-error:not([hidden])")?.textContent).toBe(
      "Not understood: nonsense:1",
    );
    expect(localStorage.getItem("hc:venue")).toBe("bank:4,wall:7680x2880:16x6:0.1");
    expect(activeVenue().bankCount).toBe(4);

    // Done typing: the field shows the tidy form, and new setups start from the venue's bank.
    venue.dispatchEvent(new Event("change"));
    expect(field("venue")?.value).toBe("bank:4,wall:7680x2880:16x6:0.1");
    choose("setup", "corner");
    expect(document.querySelector<HTMLAnchorElement>(".out-links a")?.href).toContain(
      "&count=4&span=1&",
    );

    field("venue")!.value = "";
    field("venue")!.dispatchEvent(new Event("input"));
    expect(urls().some((u) => u.includes("venue="))).toBe(false);
    expect(localStorage.getItem("hc:venue")).toBeNull();
  });

  it("starts from a remembered venue profile, with Advanced open to show it", () => {
    localStorage.setItem("hc:venue", "kiosk:1280x800");
    history.replaceState(null, "", "/hypercube/#/sparks");
    mountLanding(document.body, apps);
    expect(field("venue")?.value).toBe("kiosk:1280x800:1.1x0.62:0.8");
    expect(document.querySelector<HTMLDetailsElement>("details.advanced")?.open).toBe(true);
    expect(urls()[0]).toContain("&venue=kiosk:1280x800:1.1x0.62:0.8&");
  });

  it("blocks copying while the room token is invalid", () => {
    localStorage.setItem("hc:landing", JSON.stringify({ app: "pucks", room: ROOM }));
    history.replaceState(null, "", "/hypercube/#/pucks");
    mountLanding(document.body, apps);
    const room = document.querySelector<HTMLInputElement>("input.mono");
    if (!room) throw new Error("no room field");
    expect(room.value).toBe(ROOM);
    room.value = "no";
    room.dispatchEvent(new Event("input"));
    expect(document.querySelector<HTMLElement>(".out-errors")?.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>("button.copy")?.disabled).toBe(true);
  });
});
