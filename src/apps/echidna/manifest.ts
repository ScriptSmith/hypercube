import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "echidna",
  title: "Sleeping Echidna",
  category: "visual",
  blurb:
    "The whole ball is an echidna curled up asleep, breathing slowly and twitching now and then.",
  setups: [{ setup: "solo", kinds: ["sphere"] }],
  variants: [{ id: "asleep", title: "Asleep", blurb: "Curled up, breathing and dreaming." }],
  options: [
    { key: "stirs", title: "Twitches and stirs", type: "boolean", default: true },
    {
      key: "pace",
      title: "Pace",
      type: "enum",
      values: [
        { id: "sleepy", title: "Sleepy" },
        { id: "restless", title: "Restless" },
      ],
      default: "sleepy",
    },
  ],
  network: "none",
  thumb: { kind: "sphere", seconds: 4 },
};

export default manifest;
