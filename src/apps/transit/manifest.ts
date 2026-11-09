import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "transit",
  title: "Brisbane Transit",
  category: "visual",
  blurb:
    "Every bus, train and ferry in inner Brisbane moving on a live map. Light up a mode, follow a route, or drag and zoom the map.",
  setups: [
    {
      setup: "solo",
      kinds: ["wall", "kiosk", "screen"],
      note: "Mode buttons low and route buttons above on a wall, a button strip on a kiosk, the map alone on a screen. Visitors drag the map and zoom with buttons; it tours again 30 s after they leave it. Kiosks and walls in one group share a feed, and a kiosk's route shows on the wall.",
    },
  ],
  variants: [
    {
      id: "live",
      title: "Live",
      blurb: "Today's vehicles from the public feed, or a recording while it is unavailable.",
    },
    {
      id: "replay",
      title: "Replay",
      blurb: "A recorded stretch of vehicle positions, played in a loop.",
      visitor: false,
    },
  ],
  options: [
    {
      type: "number",
      key: "tour",
      title: "Seconds per view",
      min: 20,
      max: 300,
      step: 10,
      default: 60,
    },
    {
      type: "enum",
      key: "view",
      title: "View",
      values: [
        { id: "tour", title: "Tour the views" },
        { id: "city", title: "City and river" },
        { id: "river", title: "The whole river" },
        { id: "network", title: "Whole network" },
        { id: "north", title: "North" },
        { id: "south", title: "South" },
      ],
      default: "tour",
    },
    { type: "boolean", key: "trails", title: "Trails", default: true, visitor: true },
    {
      type: "boolean",
      key: "follow",
      title: "Follow vehicles now and then",
      default: true,
      kinds: ["screen"],
    },
  ],
  network: "optional",
  thumb: { kind: "kiosk", variant: "replay", seconds: 8 },
};

export default manifest;
