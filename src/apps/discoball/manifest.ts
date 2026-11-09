import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "discoball",
  title: "Disco Ball",
  category: "visual",
  blurb: "The ball becomes a mirror ball, turning slowly and sparkling with spotlights.",
  setups: [{ setup: "solo", kinds: ["sphere"] }],
  variants: [{ id: "mirror", title: "Mirror ball", blurb: "Square mirrors catching spotlights." }],
  options: [
    {
      type: "enum",
      key: "lights",
      title: "Lights",
      values: [
        { id: "party", title: "Party colours" },
        { id: "white", title: "Silver and white" },
      ],
      default: "party",
    },
    {
      type: "enum",
      key: "spin",
      title: "Spin",
      values: [
        { id: "slow", title: "Slow" },
        { id: "medium", title: "Medium" },
      ],
      default: "slow",
    },
  ],
  network: "none",
  thumb: { kind: "sphere", seconds: 4 },
};

export default manifest;
