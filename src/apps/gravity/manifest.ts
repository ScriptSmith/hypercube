import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "gravity",
  title: "Gravity Sandbox",
  category: "visual",
  blurb:
    "Fling rocks, planets, gas giants and stars into a universe where everything pulls on everything else.",
  setups: [
    { setup: "solo", kinds: ["wall", "panel", "pair", "kiosk"] },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each touch frame has a slingshot; bodies climb off its top into the universe on the screen.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "scene",
      title: "First scene",
      values: [
        { id: "solar", title: "Solar system" },
        { id: "binary", title: "Binary star" },
        { id: "rings", title: "Ringed giant" },
        { id: "cluster", title: "Star cluster" },
        { id: "galaxies", title: "Galaxies" },
      ],
      default: "solar",
      visitor: true,
    },
    {
      type: "enum",
      key: "pads",
      title: "Slingshots",
      values: [
        { id: "4", title: "4" },
        { id: "6", title: "6" },
        { id: "8", title: "8" },
      ],
      default: "6",
      visitor: true,
      kinds: ["wall"],
    },
    {
      type: "enum",
      key: "ribbon",
      title: "Path guide",
      values: [
        { id: "long", title: "Long" },
        { id: "short", title: "Short" },
      ],
      default: "long",
    },
    { type: "boolean", key: "blackhole", title: "Black holes", default: true },
    { type: "boolean", key: "truesizes", title: "Start with true sizes", default: false },
  ],
  network: "optional",
  thumb: {
    kind: "kiosk",
    seconds: 10,
    looks: [{ options: { scene: "rings" } }, { options: { scene: "galaxies" } }],
  },
};

export default manifest;
