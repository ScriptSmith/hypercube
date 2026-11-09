import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "recycling",
  title: "Recycling Rush",
  category: "game",
  blurb: "Grab rubbish off the belts and throw it in the right bin; full bins build a park.",
  setups: [
    {
      setup: "solo",
      kinds: ["wall", "panel", "pair", "kiosk"],
      note: "Three sorting lines on a wall; one on a panel or kiosk; two on a pair, working outward from the middle.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "The screen's plant drops rubbish into every frame below and builds the park from their full bins.",
    },
  ],
  variants: [
    {
      id: "sort",
      title: "Sort it",
      blurb: "Recycling, compost, rubbish and a drop-off box for batteries and phones.",
    },
    {
      id: "simple",
      title: "Two bins",
      blurb: "Recycling and rubbish only, with slower belts, for younger children.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "speed",
      title: "Speed",
      values: [
        { id: "normal", title: "Normal" },
        { id: "slow", title: "Slow" },
      ],
      default: "normal",
      visitor: true,
    },
    { type: "boolean", key: "hints", title: "Show the right bin after a miss", default: true },
  ],
  network: "optional",
  thumb: { kind: "kiosk", seconds: 8, looks: [{ kind: "screen" }] },
};

export default manifest;
