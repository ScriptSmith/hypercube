import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "bluebottle",
  title: "Bluebottle Beach",
  category: "game",
  blurb:
    "Dig the sand together and work out where the bluebottles hide from the numbers, with no guessing needed.",
  setups: [
    { setup: "solo", kinds: ["wall", "panel", "pair"] },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "One long beach across the bank; the screen above shows the whole beach as a map.",
    },
  ],
  variants: [
    {
      id: "beach",
      title: "Beach",
      blurb: "Tap to dig, hold to plant a flag. A sting blows sand back over, and that's all.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "density",
      title: "Bluebottles",
      values: [
        { id: "easy", title: "A few" },
        { id: "normal", title: "Some" },
        { id: "hard", title: "Lots" },
      ],
      default: "normal",
      visitor: true,
    },
    {
      type: "enum",
      key: "counts",
      title: "Counts",
      values: [
        { id: "mixed", title: "Dots low, numbers high" },
        { id: "digits", title: "Numbers" },
        { id: "dots", title: "Dots" },
      ],
      default: "mixed",
    },
    { type: "boolean", key: "flags", title: "Hold to plant flags", default: true },
    {
      type: "enum",
      key: "sting",
      title: "Sting",
      values: [
        { id: "small", title: "Small" },
        { id: "big", title: "Big" },
      ],
      default: "small",
      visitor: true,
    },
  ],
  network: "optional",
  thumb: { kind: "wall", seconds: 8, looks: [{ kind: "screen" }] },
};

export default manifest;
