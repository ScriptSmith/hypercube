import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "petri",
  title: "Petri Dish",
  category: "visual",
  blurb:
    "Seed a living culture with gliders, slime mould spores or drops of reagent and watch it grow.",
  setups: [
    { setup: "solo", kinds: ["wall", "panel", "pair"] },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each touch frame is a dropper; flicked drops land in one round dish on the screen above.",
    },
  ],
  variants: [
    { id: "life", title: "Life", blurb: "Conway's Game of Life: gliders, spaceships and soups." },
    { id: "slime", title: "Slime mould", blurb: "Spores spread into networks that find food." },
    {
      id: "turing",
      title: "Reaction",
      blurb: "Drops of reagent grow into spots, coral and mazes.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "cell",
      title: "Life cell size (venue px)",
      values: [
        { id: "4", title: "4" },
        { id: "6", title: "6" },
        { id: "8", title: "8" },
      ],
      default: "6",
    },
    {
      type: "enum",
      key: "speed",
      title: "Speed",
      values: [
        { id: "slow", title: "Slow" },
        { id: "normal", title: "Normal" },
        { id: "fast", title: "Fast" },
      ],
      default: "normal",
      visitor: true,
    },
    {
      type: "number",
      key: "regions",
      title: "Regions (slime and reaction)",
      min: 1,
      max: 3,
      step: 1,
      default: 2,
      kinds: ["wall"],
      visitor: true,
    },
    {
      type: "boolean",
      key: "slices",
      title: "Each panel sets its slice of the dish",
      default: true,
      kinds: ["screen"],
    },
    { type: "boolean", key: "rain", title: "Reseed itself", default: true },
  ],
  network: "optional",
  thumb: { kind: "screen", variant: "slime", seconds: 8, looks: [{ variant: "turing" }] },
};

export default manifest;
