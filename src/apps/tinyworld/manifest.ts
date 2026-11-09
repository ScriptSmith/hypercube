import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "tinyworld",
  title: "Tiny World",
  category: "visual",
  blurb:
    "Pour sand, water, seeds, fire and lava from your fingertips and watch them fall, flow and grow.",
  setups: [
    { setup: "solo", kinds: ["wall", "panel", "pair"] },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      note: "Each frame runs its own world; geysers throw matter up onto the screen above.",
    },
  ],
  variants: [
    { id: "sandbox", title: "Sandbox", blurb: "Free play with about ten elements." },
    {
      id: "delta",
      title: "Delta",
      blurb: "A river runs to the sea; move barriers to shape channels and islands.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "palette",
      title: "Palette",
      values: [
        { id: "full", title: "Full set" },
        { id: "child", title: "Child set only" },
      ],
      default: "full",
      visitor: true,
      // The screen above a bank has no palette.
      kinds: ["wall", "panel", "pair"],
    },
    {
      type: "boolean",
      key: "weather",
      title: "Weather",
      default: true,
      visitor: true,
      // The screen above a bank always has its sky.
      kinds: ["wall", "panel", "pair"],
    },
    {
      type: "enum",
      key: "cell",
      title: "Cell size (venue px)",
      values: [
        { id: "auto", title: "Auto (3 on a wall, 4 on panels)" },
        { id: "2", title: "2" },
        { id: "3", title: "3" },
        { id: "4", title: "4" },
      ],
      default: "auto",
    },
  ],
  network: "optional",
};

export default manifest;
