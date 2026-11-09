import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "airflow",
  title: "Airflow",
  category: "visual",
  blurb:
    "Put a wing, a car or a bird in a stream of smoke, turn it and change the wind, and watch the air part, swirl and shed eddies.",
  setups: [
    {
      setup: "solo",
      kinds: ["wall", "kiosk", "panel", "pair"],
      note: "Shapes on stings with handles low and angle knobs above; wind and view controls; hands in the stream are obstacles too.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each panel is an updraft with a shape in it; the screen carries every panel's plume on upwards.",
    },
  ],
  variants: [
    { id: "shapes", title: "Shapes", blurb: "Shapes on stings, and hands in the stream." },
    { id: "hands", title: "Hands", blurb: "No shapes: every hand in the stream leaves a wake." },
  ],
  options: [
    {
      type: "enum",
      key: "wind",
      title: "Starting wind",
      values: [
        { id: "gentle", title: "Gentle" },
        { id: "steady", title: "Steady" },
        { id: "strong", title: "Strong" },
      ],
      default: "steady",
      visitor: true,
    },
    {
      type: "enum",
      key: "view",
      title: "View",
      values: [
        { id: "smoke", title: "Smoke" },
        { id: "speed", title: "Speed" },
        { id: "swirl", title: "Swirl" },
      ],
      default: "smoke",
      visitor: true,
    },
    {
      type: "number",
      key: "shapes",
      title: "Shapes",
      min: 1,
      max: 4,
      step: 1,
      default: 3,
      kinds: ["wall"],
      visitor: true,
    },
    { type: "boolean", key: "arrows", title: "Lift and drag arrows", default: true },
  ],
  network: "optional",
  thumb: {
    kind: "wall",
    seconds: 14,
    looks: [{ options: { view: "speed" } }, { options: { view: "swirl" } }],
  },
};

export default manifest;
