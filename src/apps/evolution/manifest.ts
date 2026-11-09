import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "evolution",
  title: "Evolution",
  category: "visual",
  blurb:
    "Catch the fish you can see. The hidden ones live to breed, and their family tree grows above the pond.",
  setups: [
    {
      setup: "solo",
      kinds: ["wall", "panel", "pair"],
      note: "Ponds low with floor buttons above them; the family tree of every fish fills the top.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each panel (or half pair) is an island pond; the screen shows the whole bank's family tree.",
    },
  ],
  variants: [
    {
      id: "pond",
      title: "Heron pond",
      blurb: "Children are the herons; adults change the pond floor.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "herons",
      title: "Automatic herons",
      values: [
        { id: "off", title: "Off" },
        { id: "few", title: "A few" },
        { id: "many", title: "Many" },
      ],
      default: "few",
      visitor: true,
    },
    {
      type: "enum",
      key: "mutation",
      title: "Changes in the young",
      values: [
        { id: "small", title: "Small" },
        { id: "big", title: "Big" },
      ],
      default: "small",
      visitor: true,
    },
    {
      type: "number",
      key: "ponds",
      title: "Ponds",
      min: 1,
      max: 4,
      step: 1,
      default: 3,
      kinds: ["wall"],
      visitor: true,
    },
    { type: "boolean", key: "tree", title: "Family tree", default: true },
  ],
  network: "optional",
  thumb: { kind: "wall", seconds: 45 },
};

export default manifest;
