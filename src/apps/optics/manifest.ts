import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "optics",
  title: "Light Bench",
  category: "visual",
  blurb:
    "Place mirrors, prisms and lenses and turn them to steer beams of light into the crystals.",
  setups: [
    { setup: "solo", kinds: ["wall", "pair", "panel", "kiosk"] },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "One long bench along the row; light passes from panel to panel and up to crystals on the screen.",
    },
  ],
  variants: [
    {
      id: "puzzle",
      title: "Puzzles",
      blurb: "Light every crystal to finish a puzzle; each one is a little harder.",
    },
    {
      id: "sandbox",
      title: "Free play",
      blurb: "Every piece to play with, crystals of every colour, and lamps to move.",
    },
  ],
  options: [
    {
      type: "boolean",
      key: "colour",
      title: "Prisms and colours",
      default: true,
      visitor: true,
    },
    {
      type: "enum",
      key: "start",
      title: "Start at",
      values: [
        { id: "easy", title: "Easy" },
        { id: "medium", title: "Medium" },
      ],
      default: "easy",
      visitor: true,
    },
    {
      type: "number",
      key: "benches",
      title: "Benches",
      min: 1,
      max: 3,
      step: 1,
      default: 2,
      kinds: ["wall"],
      visitor: true,
    },
  ],
  network: "optional",
  thumb: { kind: "kiosk", seconds: 18 },
};

export default manifest;
