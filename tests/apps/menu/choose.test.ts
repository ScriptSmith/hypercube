// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Offer } from "../../../src/apps/menu/catalog";
import { type ChooseState, createChoose } from "../../../src/apps/menu/choose";
import type { MenuFrame } from "../../../src/apps/menu/layout";
import { PALETTE } from "../../../src/core/ui";
import type { AppManifest } from "../../../src/core/types";

const FRAME: MenuFrame = {
  kind: "panel",
  width: 1080,
  height: 1920,
  unit: 1,
  reachTop: { adult: 0, child: 960 },
  seams: [],
};

const APP: AppManifest = {
  id: "race",
  title: "Race",
  category: "game",
  blurb: "",
  setups: [{ setup: "solo", kinds: ["panel"] }],
  network: "none",
  options: [
    { type: "text", key: "banner", title: "Banner", maxLength: 40, default: "", visitor: true },
    {
      type: "enum",
      key: "mode",
      title: "Mode",
      values: [
        { id: "calm", title: "Calm" },
        { id: "race", title: "Race" },
      ],
      default: "calm",
      visitor: true,
    },
    {
      type: "boolean",
      key: "boost",
      title: "Boost",
      default: false,
      visitor: true,
      when: { key: "mode", is: ["race"] },
    },
  ],
};

const OFFER: Offer = { app: APP, variant: null, key: APP.id };

const open = (initial?: ChooseState) => {
  const reshaped: ChooseState[] = [];
  const handle = createChoose({
    frame: FRAME,
    offer: OFFER,
    palette: PALETTE,
    initial,
    onPlay: () => {},
    onBack: () => {},
    onReshape: (s) => reshaped.push(s),
  });
  const labels = () => [...handle.el.querySelectorAll(".mn-olabel")].map((l) => l.textContent);
  const tap = (text: string) => {
    const el = [...handle.el.querySelectorAll<HTMLElement>(".mn-seg")].find(
      (s) => s.textContent === text,
    );
    const i = [...handle.el.querySelectorAll(".mn-t")].indexOf(el as Element);
    if (i < 0) throw new Error(`no segment ${text}`);
    handle.activate(i);
  };
  return { handle, labels, tap, reshaped };
};

describe("choose step", () => {
  it("never shows text, and asks for a new layout when a choice shows another option", () => {
    const first = open();
    expect(first.labels()).toEqual(["Mode"]);
    first.tap("Calm");
    expect(first.reshaped).toEqual([]);
    first.tap("Race");
    expect(first.reshaped).toEqual([{ variant: undefined, changes: { mode: "race" } }]);

    const again = open(first.reshaped[0]);
    expect(again.labels()).toEqual(["Mode", "Boost"]);
    again.tap("Calm");
    expect(again.reshaped).toHaveLength(1);
  });
});
