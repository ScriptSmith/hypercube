import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "skyline",
  title: "Crane Skyline",
  category: "game",
  blurb: "Send blocks to the yard and swing them up with a tower crane to build a skyline.",
  setups: [
    {
      setup: "solo",
      kinds: ["panel", "pair", "wall", "kiosk", "screen"],
      note: "Two or three cranes on a wall, one per half of a pair, one on a panel or kiosk. A screen alone builds by itself.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "The screen holds a crane above every panel; each frame below sends blocks up its lift and drives its crane.",
    },
  ],
  variants: [
    {
      id: "build",
      title: "Build the city",
      blurb: "Fill each building's outline, floor by floor.",
    },
    { id: "tall", title: "Tallest tower", blurb: "Stack one tower as high as it will go." },
  ],
  options: [
    {
      type: "number",
      key: "cranes",
      title: "Cranes",
      min: 2,
      max: 3,
      step: 1,
      default: 3,
      kinds: ["wall"],
      visitor: true,
    },
    {
      type: "enum",
      key: "wind",
      title: "Wind",
      values: [
        { id: "off", title: "Off" },
        { id: "light", title: "Light gusts" },
      ],
      default: "off",
      visitor: true,
    },
    { type: "boolean", key: "assist", title: "Helper", default: true, visitor: true },
  ],
  network: "optional",
  thumb: { kind: "wall", seconds: 12, looks: [{ kind: "screen" }] },
};

export default manifest;
