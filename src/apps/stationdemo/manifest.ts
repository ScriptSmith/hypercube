import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "stationdemo",
  title: "Station demo",
  category: "tool",
  blurb: "Try the player station flow: touch, set your reach, start, play and reset.",
  setups: [{ setup: "solo", kinds: ["panel", "pair", "wall", "kiosk"] }],
  options: [
    {
      type: "number",
      key: "count",
      title: "Stations on a wall",
      min: 4,
      max: 6,
      step: 1,
      default: 6,
    },
  ],
  network: "none",
  stations: true,
  hidden: true,
};

export default manifest;
