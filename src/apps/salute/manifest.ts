import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "salute",
  title: "Salute",
  category: "visual",
  blurb: "The ball is a friendly face that turns to each side of the room and salutes.",
  setups: [{ setup: "solo", kinds: ["sphere"] }],
  options: [
    {
      type: "boolean",
      key: "hold",
      title: "Hold the salute and keep turning",
      default: false,
    },
    {
      type: "enum",
      key: "pace",
      title: "Pace",
      values: [
        { id: "formal", title: "Formal" },
        { id: "relaxed", title: "Relaxed" },
      ],
      default: "formal",
      visitor: true,
    },
    {
      type: "enum",
      key: "colour",
      title: "Colour",
      values: [
        { id: "yellow", title: "Yellow" },
        { id: "blue", title: "Blue" },
        { id: "green", title: "Green" },
      ],
      default: "yellow",
      visitor: true,
    },
  ],
  network: "none",
  thumb: { kind: "sphere", seconds: 2, looks: [{ options: { colour: "blue" } }] },
};

export default manifest;
