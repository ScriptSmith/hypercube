import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "traffic",
  title: "Traffic",
  category: "visual",
  blurb: "Touch a car to brake it and watch the jam you made travel backwards round the ring.",
  setups: [
    {
      setup: "solo",
      kinds: ["wall", "panel", "pair"],
      note: "A ring road low down with the jams' time-space diagram above it.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "One ring road through every panel; the screen draws its time-space diagram.",
    },
    {
      setup: "versus",
      kinds: ["wall"],
      note: "Two identical rings; throw slowdowns at the other wall and keep your own flowing.",
    },
  ],
  variants: [
    {
      id: "ring",
      title: "Ring road",
      blurb: "One lane of human drivers; enough of them jam on their own.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "cars",
      title: "Cars",
      values: [
        { id: "few", title: "Few" },
        { id: "some", title: "Some" },
        { id: "many", title: "Many" },
      ],
      default: "many",
    },
    {
      type: "enum",
      key: "smart",
      title: "Smart cars",
      values: [
        { id: "none", title: "None" },
        { id: "few", title: "1 in 10" },
        { id: "some", title: "1 in 4" },
        { id: "half", title: "Half" },
      ],
      default: "none",
      visitor: true,
    },
    {
      type: "enum",
      key: "limit",
      title: "Speed limit",
      values: [
        { id: "slow", title: "30" },
        { id: "medium", title: "50" },
        { id: "fast", title: "70" },
      ],
      default: "medium",
    },
    { type: "boolean", key: "noise", title: "Drivers wobble", default: true },
    {
      type: "enum",
      key: "road",
      title: "Road",
      values: [
        { id: "straight", title: "Straight road" },
        { id: "circle", title: "Circle" },
      ],
      default: "straight",
      visitor: true,
      // A lone pair keeps its loop, and bank stretches stay straight.
      kinds: ["wall", "panel", "screen"],
    },
  ],
  network: "optional",
  thumb: { kind: "wall", seconds: 40 },
};

export default manifest;
