import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "claw",
  title: "Claw Machine",
  category: "visual",
  blurb:
    "Claw machines that play themselves round the ball, or stand in a row on a wall for anyone to have a go.",
  setups: [
    {
      setup: "solo",
      kinds: ["sphere"],
      note: "Cabinets round the middle of the ball, the heap of won prizes at the bottom. It runs by itself.",
    },
    {
      setup: "solo",
      kinds: ["wall"],
      note: "A row of cabinets with buttons low enough for a child. Ones nobody is using play themselves.",
    },
  ],
  variants: [
    {
      id: "arcade",
      title: "Arcade",
      blurb:
        "Claws drop, grab, wobble and usually let go; now and then a prize goes down the chute.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "machines",
      title: "Machines",
      values: [
        { id: "4", title: "Four round the ball" },
        { id: "3", title: "Three, a little wider" },
      ],
      default: "4",
      kinds: ["sphere"],
    },
    {
      type: "enum",
      key: "cabinets",
      title: "Machines",
      values: [
        { id: "2", title: "Two" },
        { id: "3", title: "Three" },
        { id: "4", title: "Four" },
      ],
      default: "3",
      kinds: ["wall"],
      visitor: true,
    },
    {
      type: "enum",
      key: "luck",
      title: "Luck",
      values: [
        { id: "fair", title: "Fair" },
        { id: "generous", title: "Generous" },
      ],
      default: "fair",
      visitor: true,
    },
  ],
  network: "none",
  thumb: { kind: "sphere", seconds: 10, looks: [{ kind: "wall" }] },
};

export default manifest;
