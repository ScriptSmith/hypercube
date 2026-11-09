import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "touchdown",
  title: "Touchdown",
  category: "game",
  blurb: "Two people, one engine each: work together to set a little spacecraft down on a pad.",
  setups: [
    {
      setup: "solo",
      kinds: ["pair", "kiosk", "wall", "panel"],
      note: "One craft per crew; each crew holds a pad at each side.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each frame flies its own craft; the screen above shows every craft over its frame.",
    },
  ],
  variants: [
    {
      id: "duo",
      title: "Two engines",
      blurb: "One engine each, left and right. Both together lift straight up.",
    },
    {
      id: "crew",
      title: "Pilot and steerer",
      blurb: "A low pad fires the main engine; two higher pads turn the craft.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "assist",
      title: "Helper",
      values: [
        { id: "off", title: "Off" },
        { id: "gentle", title: "Gentle" },
        { id: "strong", title: "Strong" },
      ],
      default: "gentle",
      visitor: true,
    },
    { type: "boolean", key: "fuel", title: "Fuel gauge", default: true },
    {
      type: "enum",
      key: "wind",
      title: "Wind",
      values: [
        { id: "calm", title: "Calm" },
        { id: "breezy", title: "Breezy" },
        { id: "gusty", title: "Gusty" },
      ],
      default: "calm",
      visitor: true,
    },
    {
      type: "number",
      key: "crews",
      title: "Crews",
      min: 1,
      max: 3,
      step: 1,
      default: 2,
      kinds: ["wall"],
      visitor: true,
    },
  ],
  network: "optional",
  thumb: { kind: "kiosk", seconds: 10 },
};

export default manifest;
