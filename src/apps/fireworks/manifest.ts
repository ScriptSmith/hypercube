import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "fireworks",
  title: "Fireworks",
  category: "visual",
  blurb: "Build a firework shell, send it up and watch it burst in the sky above.",
  setups: [
    { setup: "solo", kinds: ["wall", "panel", "pair"] },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each panel is a launch pad; shells climb off the top and burst on the screen.",
    },
    {
      setup: "corner",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Two banks share one sky; shells and bursts cross the corner.",
    },
  ],
  variants: [
    {
      id: "build",
      title: "Build",
      blurb: "Pick a colour, a shape and a size, then send the shell up.",
    },
    {
      id: "flick",
      title: "Flick",
      blurb: "Drag up and let go: the direction aims and the length sets the height.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "recipe",
      title: "Recipe",
      values: [
        { id: "full", title: "Colour, shape and size" },
        { id: "colour", title: "Colour only" },
      ],
      default: "full",
      visitor: true,
      kinds: ["panel", "pair", "wall"],
    },
    {
      type: "boolean",
      key: "aim",
      title: "Aim handle",
      default: true,
      visitor: true,
      kinds: ["panel", "pair", "wall"],
    },
    { type: "boolean", key: "volley", title: "Volleys", default: true },
    { type: "boolean", key: "pictograms", title: "Picture shells", default: true, visitor: true },
    {
      type: "number",
      key: "show",
      title: "Seconds before the show",
      min: 10,
      max: 120,
      step: 10,
      default: 30,
    },
    {
      type: "enum",
      key: "pads",
      title: "Launch pads",
      values: [
        { id: "6", title: "6" },
        { id: "8", title: "8" },
      ],
      default: "8",
      kinds: ["wall"],
      visitor: true,
    },
  ],
  network: "optional",
  thumb: { kind: "screen", seconds: 10 },
};

export default manifest;
