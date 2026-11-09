import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "chladni",
  title: "Chladni Plate",
  category: "visual",
  blurb:
    "Ring a sand-covered plate, move where it is shaken, stretch or damp it, and watch the sand find the still lines.",
  setups: [
    {
      setup: "solo",
      kinds: ["pair", "wall", "panel", "kiosk"],
      note: "Note keys low; a glide, a stretch slider, a damping slider and a drive point to move for adults above them; touch the plate to damp it.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each touch frame plays two notes of one big plate on the screen above, and can move its drive point, stretch it and damp it.",
    },
  ],
  variants: [
    { id: "square", title: "Square plate", blurb: "Stars, diamonds and crosses." },
    { id: "round", title: "Round plate", blurb: "Rings and spokes." },
  ],
  options: [
    {
      type: "number",
      key: "keys",
      title: "Note keys",
      min: 4,
      max: 10,
      step: 1,
      default: 6,
      visitor: true,
    },
    {
      type: "enum",
      key: "sand",
      title: "Sand",
      values: [
        { id: "sand", title: "Sand" },
        { id: "white", title: "White" },
        { id: "rainbow", title: "Rainbow" },
      ],
      default: "sand",
      visitor: true,
    },
    { type: "boolean", key: "glide", title: "Glide control for adults", default: true },
    { type: "boolean", key: "damp", title: "Touching the plate damps it", default: true },
    { type: "boolean", key: "puck", title: "Drive point that visitors move", default: true },
    { type: "boolean", key: "stretch", title: "Stretch slider (square plate)", default: true },
    { type: "boolean", key: "damping", title: "Damping slider", default: true },
    {
      type: "number",
      key: "plates",
      title: "Plates",
      min: 1,
      max: 2,
      step: 1,
      default: 1,
      kinds: ["wall"],
      visitor: true,
    },
  ],
  network: "optional",
  thumb: { kind: "screen", seconds: 9, looks: [{ variant: "round" }, { kind: "kiosk" }] },
};

export default manifest;
