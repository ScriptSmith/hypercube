import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "fourd",
  title: "Fourth Dimension",
  category: "visual",
  blurb: "Push a 4D shape through our space and watch its slice grow, change and vanish.",
  setups: [
    {
      setup: "solo",
      kinds: ["panel", "pair", "wall", "kiosk", "screen"],
      note: "A pair puts a cube through a flat world beside the 4D shape; a wall shows the whole ladder from a square to the 4D shape; a screen alone plays the show.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "One shared 4D shape: every frame shows its own slice, and the screen shows the shadow with every slice in it.",
    },
  ],
  variants: [
    {
      id: "hyper",
      title: "Four dimensions",
      blurb: "A 4D shape through our space, with its shadow.",
    },
    {
      id: "flat",
      title: "Flat world",
      blurb: "A 3D shape through a flat world, for younger visitors.",
    },
  ],
  options: [
    {
      type: "boolean",
      key: "ladder",
      title: "Square, cube and 4D side by side",
      default: true,
      kinds: ["wall"],
    },
    { type: "boolean", key: "spin", title: "Slow turn of the view", default: true },
    { type: "boolean", key: "axes", title: "Axis names", default: true, visitor: true },
  ],
  network: "optional",
  thumb: { kind: "kiosk", seconds: 6 },
};

export default manifest;
