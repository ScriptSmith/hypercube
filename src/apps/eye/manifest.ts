import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "eye",
  title: "Eye Lab",
  category: "visual",
  blurb:
    "Change an eye's length, curve, age and light, see where light focuses and how a scene looks through it.",
  setups: [
    {
      setup: "solo",
      kinds: ["panel", "pair", "wall", "kiosk", "screen"],
      note: "The cut-away eye, its view of a scene and the controls; a screen alone shows a gallery of conditions.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each frame is its own eye; the screen shows the scene through every frame's eye, one column above each.",
    },
  ],
  variants: [
    {
      id: "real",
      title: "Realistic",
      blurb: "An eye that looks like a real one, opening into a cut-away to show the inside.",
    },
    {
      id: "diagram",
      title: "Diagram",
      blurb: "A schematic cut-away eye, always open, like a textbook diagram.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "scene",
      title: "Light at the start",
      values: [
        { id: "day", title: "Day" },
        { id: "night", title: "Night" },
      ],
      default: "day",
    },
    { type: "boolean", key: "numbers", title: "Numbers beside the sliders", default: true },
    { type: "boolean", key: "extras", title: "Optional caption lines", default: false },
    {
      type: "number",
      key: "fov",
      title: "View width (degrees)",
      min: 20,
      max: 60,
      step: 5,
      default: 40,
    },
  ],
  network: "optional",
  thumb: { kind: "kiosk", seconds: 7, looks: [{ variant: "diagram" }, { kind: "screen" }] },
};

export default manifest;
