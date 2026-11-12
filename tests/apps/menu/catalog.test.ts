import { describe, expect, it } from "vitest";
import { offers, parseEntries, runsSolo, withPresets } from "../../../src/apps/menu/catalog";
import { defaultOptions } from "../../../src/apps/menu/choices";
import menu from "../../../src/apps/menu/manifest";
import { optionShown } from "../../../src/core/options";
import type { AppManifest, FrameKind, SetupSupport } from "../../../src/core/types";

const TOUCH: FrameKind[] = ["panel", "pair", "wall", "kiosk"];

const app = (
  id: string,
  over: Partial<AppManifest> = {},
  setups: SetupSupport[] = [{ setup: "solo", kinds: TOUCH }],
): AppManifest => ({
  id,
  title: id.charAt(0).toUpperCase() + id.slice(1),
  category: "game",
  blurb: "",
  setups,
  network: "none",
  ...over,
});

const ALL: AppManifest[] = [
  app("zebra", {
    variants: [
      { id: "plain", title: "Plain" },
      { id: "stripes", title: "Stripes" },
      { id: "secret", title: "Secret", visitor: false },
    ],
  }),
  app("apple"),
  app("sand", { category: "visual" }, [{ setup: "solo", kinds: ["wall", "panel"] }]),
  app("checks", { category: "tool", network: "optional" }),
  app("blank", { category: "tool", hidden: true }),
  app("online", { network: "required" }),
  app("banked", {}, [{ setup: "bank", kinds: ["panel", "screen"] }]),
  app("stationed", {}, [{ setup: "solo", kinds: ["panel"], roles: ["station"] }]),
  app("optional", { network: "optional" }, [
    { setup: "versus", kinds: ["wall"] },
    { setup: "solo", kinds: ["kiosk"] },
  ]),
  menu,
];

const keys = (list: { key: string }[]) => list.map((o) => o.key);

describe("parseEntries", () => {
  it("splits a comma list into apps and presets, in order, without repeats", () => {
    expect(parseEntries(" b, a,,b ,c:x, c, c:x ,c:y")).toEqual([
      { id: "b", variant: null },
      { id: "a", variant: null },
      { id: "c", variant: "x" },
      { id: "c", variant: null },
      { id: "c", variant: "y" },
    ]);
  });

  it("drops malformed entries", () => {
    expect(parseEntries("a:b:c,:x,y:,Up,ok")).toEqual([{ id: "ok", variant: null }]);
  });

  it("treats anything but a string as empty", () => {
    expect(parseEntries(undefined)).toEqual([]);
    expect(parseEntries("")).toEqual([]);
    expect(parseEntries(3)).toEqual([]);
    expect(parseEntries(true)).toEqual([]);
  });
});

describe("runsSolo", () => {
  it("needs a solo setup on the kind, a solo role if roles are listed, and no required network", () => {
    const find = (id: string) => ALL.find((a) => a.id === id)!;
    expect(runsSolo(find("apple"), "wall")).toBe(true);
    expect(runsSolo(find("sand"), "kiosk")).toBe(false);
    expect(runsSolo(find("online"), "panel")).toBe(false);
    expect(runsSolo(find("banked"), "panel")).toBe(false);
    expect(runsSolo(find("stationed"), "panel")).toBe(false);
    expect(runsSolo(find("optional"), "wall")).toBe(false);
    expect(runsSolo(find("optional"), "kiosk")).toBe(true);
  });
});

describe("offers", () => {
  const plain = (ids: string[]) => ids.map((id) => ({ id, variant: null }));

  it("offers every visible app that runs solo on the kind, games first, then by title", () => {
    expect(keys(offers(ALL, "panel", [], "menu"))).toEqual(["apple", "zebra", "sand", "checks"]);
    expect(keys(offers(ALL, "kiosk", [], "menu"))).toEqual([
      "apple",
      "optional",
      "zebra",
      "checks",
    ]);
    for (const o of offers(ALL, "panel", [], "menu")) expect(o.variant).toBeNull();
  });

  it("filters by kind", () => {
    expect(keys(offers(ALL, "pair", [], "menu"))).not.toContain("sand");
    expect(keys(offers(ALL, "wall", [], "menu"))).toContain("sand");
    expect(offers(ALL, "screen", [], "menu")).toEqual([]);
  });

  it("leaves out hidden apps, apps that need the network, other setups and the picker", () => {
    for (const kind of TOUCH) {
      const got = keys(offers(ALL, kind, [], "menu"));
      for (const id of ["blank", "online", "banked", "stationed", "menu"]) {
        expect(got, `${kind} ${id}`).not.toContain(id);
      }
    }
  });

  it("can leave tools out of the default list, but not out of an explicit one", () => {
    expect(keys(offers(ALL, "panel", [], "menu", false))).toEqual(["apple", "zebra", "sand"]);
    expect(keys(offers(ALL, "panel", plain(["checks", "zebra"]), "menu", false))).toEqual([
      "checks",
      "zebra",
    ]);
  });

  it("keeps an explicit list in its order and allows hidden apps on it", () => {
    expect(keys(offers(ALL, "panel", plain(["checks", "blank", "zebra"]), "menu"))).toEqual([
      "checks",
      "blank",
      "zebra",
    ]);
  });

  it("ignores unknown ids, unsuitable apps, repeats and the picker on an explicit list", () => {
    const list = plain(["nosuch", "zebra", "online", "sand", "banked", "menu", "zebra"]);
    expect(keys(offers(ALL, "kiosk", list, "menu"))).toEqual(["zebra"]);
    expect(keys(offers(ALL, "wall", list, "menu"))).toEqual(["zebra", "sand"]);
  });

  it("makes each preset its own tile with its variant, beside the plain app", () => {
    const list = parseEntries("zebra:stripes,zebra,zebra:secret,apple");
    const got = offers(ALL, "panel", list, "menu");
    expect(keys(got)).toEqual(["zebra:stripes", "zebra", "zebra:secret", "apple"]);
    expect(got[0]!.variant?.title).toBe("Stripes");
    expect(got[1]!.variant).toBeNull();
    // The operator may preset a variant that visitors aren't offered.
    expect(got[2]!.variant?.id).toBe("secret");
  });

  it("drops presets of unknown variants or of apps without variants", () => {
    const list = parseEntries("zebra:nosuch,apple:plain,nosuch:plain,zebra:plain");
    expect(keys(offers(ALL, "panel", list, "menu"))).toEqual(["zebra:plain"]);
  });

  it("drops presets of apps that can't run here", () => {
    const list = parseEntries("online:plain,sand,zebra:stripes");
    expect(keys(offers(ALL, "kiosk", list, "menu"))).toEqual(["zebra:stripes"]);
  });

  it("falls back to every suitable app when nothing on the list can run here", () => {
    expect(keys(offers(ALL, "panel", parseEntries("nosuch,online,menu,apple:x"), "menu"))).toEqual(
      keys(offers(ALL, "panel", [], "menu")),
    );
  });
});

describe("menu manifest", () => {
  it("is a visible tool for solo touch frames and spheres with an apps option and no network", () => {
    expect(menu.id).toBe("menu");
    expect(menu.category).toBe("tool");
    expect(menu.hidden).toBeFalsy();
    expect(menu.network).toBe("none");
    expect(menu.setups).toEqual([{ setup: "solo", kinds: [...TOUCH, "sphere"] }]);
    expect(menu.options?.[0]).toEqual({
      type: "apps",
      key: "apps",
      title: "Apps to offer",
      default: [],
    });
  });

  it("changes app by itself only when asked, and shows the timings only then", () => {
    const opt = (key: string) => menu.options?.find((o) => o.key === key);
    expect(opt("cycle")).toMatchObject({ type: "boolean", default: false });
    for (const key of ["every", "wait"]) {
      expect(opt(key)).toMatchObject({ type: "number", when: { key: "cycle", is: [true] } });
    }
    expect(opt("every")).toMatchObject({ min: 1 });
  });

  it("offers on a sphere only what it can use: the list and the timing", () => {
    const shown = (menu.options ?? [])
      .filter((o) => optionShown(o, menu.options, { cycle: true }, "sphere"))
      .map((o) => o.key);
    expect(shown).toEqual(["apps", "cycle", "every"]);
  });

  it("hides the Home choice once the picker itself is hidden", () => {
    const shownOn = (values: Record<string, boolean>) =>
      (menu.options ?? [])
        .filter((o) => optionShown(o, menu.options, values, "panel"))
        .map((o) => o.key);
    expect(shownOn({})).toEqual(["apps", "cycle", "nopicker", "nohome"]);
    expect(shownOn({ nopicker: true })).toEqual(["apps", "cycle", "nopicker"]);
  });
});

describe("withPresets", () => {
  const glass = app("glass", {
    options: [
      { type: "number", key: "hour", title: "Hour", min: 0, max: 23, step: 1, default: 17 },
      { type: "boolean", key: "show", title: "Show", default: true },
      { type: "text", key: "message", title: "Message", maxLength: 40, default: "" },
      { type: "apps", key: "apps", title: "Apps", default: [] },
      {
        type: "enum",
        key: "sand",
        title: "Sand",
        values: [
          { id: "gold", title: "Gold" },
          { id: "white", title: "White" },
        ],
        default: "gold",
      },
    ],
  });

  it("makes the operator's values the defaults a launch starts from", () => {
    const preset = withPresets(glass, {
      hour: 9,
      show: false,
      message: "Goodbye",
      apps: "a,b",
      sand: "white",
    });
    expect(defaultOptions(preset)).toEqual({
      hour: 9,
      show: false,
      message: "Goodbye",
      apps: "a,b",
      sand: "white",
    });
    expect(defaultOptions(glass).hour).toBe(17);
  });

  it("leaves an app with no presets, or values of the wrong type, as it is", () => {
    expect(withPresets(glass, {})).toBe(glass);
    expect(defaultOptions(withPresets(glass, { hour: "9", show: 1 }))).toEqual(
      defaultOptions(glass),
    );
  });
});
