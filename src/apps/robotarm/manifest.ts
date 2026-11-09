import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "robotarm",
  title: "Robot Arm",
  category: "visual",
  blurb: "Turn one dial per joint to swing a six-axis arm, grab a block and put it down.",
  setups: [
    {
      setup: "solo",
      kinds: ["panel", "pair", "wall", "kiosk"],
      note: "One arm per frame; two or three side by side on a wall. A pair shares one arm between its halves.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each frame keeps its own arm, with a lift that sends pieces up; the screen builds one big picture from every frame's pieces.",
    },
  ],
  variants: [
    {
      id: "tidy",
      title: "Tidy up",
      blurb: "Put each block and ball in the bin of its colour.",
    },
    {
      id: "stack",
      title: "Stack",
      blurb: "Stack blocks on the pad up to the hoop.",
    },
  ],
  options: [
    {
      type: "number",
      key: "arms",
      title: "Arms",
      min: 1,
      max: 3,
      step: 1,
      default: 2,
      kinds: ["wall"],
      visitor: true,
    },
    {
      type: "enum",
      key: "speed",
      title: "Joint speed",
      values: [
        { id: "normal", title: "Normal" },
        { id: "slow", title: "Slow" },
      ],
      default: "normal",
      visitor: true,
    },
    { type: "boolean", key: "guides", title: "Guides", default: true },
  ],
  network: "optional",
  thumb: { kind: "kiosk", seconds: 8, looks: [{ kind: "screen" }] },
};

export default manifest;
