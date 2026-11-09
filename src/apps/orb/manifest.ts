import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "orb",
  title: "Vision Orb",
  category: "visual",
  blurb:
    "The ball becomes a dark glass orb full of swirling smoke, where now and then a faraway place clears and fades.",
  setups: [{ setup: "solo", kinds: ["sphere"] }],
  variants: [{ id: "orb", title: "Vision orb", blurb: "Smoke in glass, and visions in the mist." }],
  options: [
    {
      type: "enum",
      key: "visions",
      title: "Visions",
      values: [
        { id: "often", title: "Often (about every minute)" },
        { id: "rarely", title: "Rarely (every few minutes)" },
      ],
      default: "often",
    },
    {
      type: "enum",
      key: "glow",
      title: "Glow",
      values: [
        { id: "cool", title: "Cool blues and violets" },
        { id: "warm", title: "Warm golds and roses" },
      ],
      default: "cool",
    },
  ],
  network: "none",
  thumb: { kind: "sphere", seconds: 6 },
};

export default manifest;
