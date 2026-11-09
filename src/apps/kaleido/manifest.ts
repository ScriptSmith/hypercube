import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "kaleido",
  title: "Ink Mural",
  category: "visual",
  blurb:
    "Pour warm ink that billows up the wall and settles into a layer for each hour, or steer a kaleidoscope with your hands.",
  setups: [
    { setup: "solo", kinds: ["wall", "panel", "pair"] },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each touch frame pours ink that rises off its top and carries on up the screen, which keeps the day's layers.",
    },
  ],
  variants: [
    {
      id: "strata",
      title: "Ink mural",
      blurb: "Warm ink rises and settles into a layer for each hour of the day.",
    },
    {
      id: "kaleido",
      title: "Kaleidoscope",
      blurb: "Hands steer a mirrored fractal that fills the wall.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "colours",
      title: "Colours",
      values: [
        { id: "time", title: "Time of day" },
        { id: "rainbow", title: "Rainbow" },
      ],
      default: "time",
      visitor: true,
    },
    { type: "boolean", key: "strata", title: "Hourly layers (ink mural)", default: true },
    {
      type: "enum",
      key: "mirrors",
      title: "Mirrors (kaleidoscope)",
      values: [
        { id: "6", title: "6" },
        { id: "8", title: "8" },
        { id: "12", title: "12" },
      ],
      default: "6",
      visitor: true,
    },
  ],
  network: "optional",
  thumb: {
    kind: "wall",
    variant: "kaleido",
    seconds: 6,
    looks: [{ kind: "pair", variant: "strata", seconds: 10 }],
  },
};

export default manifest;
