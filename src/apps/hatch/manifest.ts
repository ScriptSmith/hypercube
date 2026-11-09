import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "hatch",
  title: "Hatching Egg",
  category: "visual",
  blurb:
    "The ball is a hen's egg: it rocks, cracks round and opens, and a fluffy chick looks about.",
  setups: [
    {
      setup: "solo",
      kinds: ["sphere"],
      note: "The whole ball is the egg, then the chick. It runs by itself.",
    },
  ],
  variants: [
    {
      id: "hatch",
      title: "Hatch",
      blurb: "An egg rocks, pips, zips round and opens, then a chick dries off and looks about.",
    },
    {
      id: "candling",
      title: "Candling",
      blurb:
        "The egg glows over a lamp and the chick grows inside through 21 days, then it hatches.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "shell",
      title: "Shell",
      values: [
        { id: "mixed", title: "A different one each egg" },
        { id: "brown", title: "Brown" },
        { id: "white", title: "White" },
        { id: "speckled", title: "Speckled" },
        { id: "blue", title: "Blue" },
      ],
      default: "mixed",
    },
    {
      type: "enum",
      key: "pace",
      title: "Pace",
      values: [
        { id: "normal", title: "About 6 minutes an egg" },
        { id: "quick", title: "About 3 minutes an egg" },
      ],
      default: "normal",
    },
  ],
  network: "none",
  thumb: { kind: "sphere", seconds: 15, looks: [{ variant: "candling" }] },
};

export default manifest;
