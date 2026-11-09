import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "trig",
  title: "Unit Circle",
  category: "visual",
  blurb: "Turn a point round a circle and watch sin, cos and tan grow out of it.",
  setups: [
    {
      setup: "solo",
      kinds: ["panel", "pair", "wall", "kiosk", "screen"],
      note: "The circle with its triangle and the waves beside it; a screen alone runs the walk-through.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Every frame turns its own angle; the screen shows them all on one circle and a wave of beads.",
    },
  ],
  variants: [
    {
      id: "explore",
      title: "Explore",
      blurb: "Everything at once; turn the angle and watch.",
    },
    {
      id: "steps",
      title: "Step by step",
      blurb: "Back and Next build the picture one part at a time.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "units",
      title: "Angles in",
      values: [
        { id: "both", title: "Degrees and radians" },
        { id: "deg", title: "Degrees" },
        { id: "rad", title: "Radians" },
      ],
      default: "both",
      visitor: true,
    },
    { type: "boolean", key: "tan", title: "Show tan", default: true, visitor: true },
    { type: "boolean", key: "snap", title: "Snap to special angles", default: true },
  ],
  network: "optional",
  thumb: { kind: "kiosk", seconds: 6 },
};

export default manifest;
