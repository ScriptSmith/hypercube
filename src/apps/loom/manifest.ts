import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "loom",
  title: "Fourier Loom",
  category: "visual",
  blurb: "Each slider and dial sets one sine wave; together they weave any shape.",
  setups: [
    {
      setup: "solo",
      kinds: ["panel", "pair", "wall", "kiosk", "screen"],
      note: "Several harmonics on one frame with the picture above; a screen alone runs the attract show.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each panel is one harmonic, its thread rising up the screen, which sums them all.",
    },
  ],
  variants: [
    {
      id: "match",
      title: "Match the wave",
      blurb: "Set every harmonic to make the shape on the screen.",
    },
    {
      id: "free",
      title: "Free weave",
      blurb: "No target: make any shape you like.",
    },
  ],
  options: [
    { type: "boolean", key: "hints", title: "Hint notches", default: true },
    {
      type: "number",
      key: "harmonics",
      title: "Harmonics",
      min: 6,
      max: 10,
      step: 2,
      default: 10,
      kinds: ["wall"],
      visitor: true,
    },
    {
      type: "enum",
      key: "speed",
      title: "Speed",
      values: [
        { id: "normal", title: "Normal" },
        { id: "slow", title: "Slow" },
      ],
      default: "normal",
      visitor: true,
    },
  ],
  network: "optional",
  thumb: { kind: "wall", seconds: 24 },
};

export default manifest;
