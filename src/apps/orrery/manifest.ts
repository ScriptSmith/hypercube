import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "orrery",
  title: "Sun, Earth and Moon",
  category: "visual",
  blurb: "Carry the Earth round the Sun and watch the seasons, or the Moon round the Earth.",
  setups: [
    {
      setup: "solo",
      kinds: ["panel", "pair", "wall", "kiosk", "screen"],
      note: "The space view beside the view from the ground; a screen alone runs the tour.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "One shared date and tilt; each frame stands at its own latitude, pole to pole.",
    },
  ],
  variants: [
    { id: "seasons", title: "Seasons", blurb: "The tilted Earth goes round the Sun." },
    {
      id: "moon",
      title: "Moon phases",
      blurb: "The Moon goes round the Earth: phases and eclipses.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "compare",
      title: "Beside Brisbane",
      values: [
        { id: "london", title: "London" },
        { id: "singapore", title: "Singapore" },
        { id: "tromso", title: "Tromsø" },
        { id: "none", title: "Nowhere" },
      ],
      default: "london",
      visitor: true,
      kinds: ["wall"],
    },
    {
      type: "number",
      key: "tilt",
      title: "Starting tilt",
      min: 0,
      max: 90,
      step: 0.1,
      default: 23.4,
    },
    { type: "boolean", key: "labels", title: "Month and phase names", default: true },
  ],
  network: "optional",
  thumb: { kind: "kiosk", variant: "moon", seconds: 6, looks: [{ variant: "seasons" }] },
};

export default manifest;
