import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "kites",
  title: "Kites",
  category: "visual",
  blurb: "Hold a spool to send a kite climbing, or steer a stunt kite through rings on the breeze.",
  setups: [
    {
      setup: "solo",
      kinds: ["wall", "panel", "pair"],
      note: "Each patch of park has a spool low and a stunt bar higher; kites fly in the sky above.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Strings leave the top of each panel and the kites fly on the screen above.",
    },
  ],
  variants: [
    {
      id: "duo",
      title: "Spool and stunt kite",
      blurb: "A spool low for children and a two-handled stunt kite higher up.",
    },
    {
      id: "single",
      title: "One kite",
      blurb: "One kite per patch on a bigger spool, for busy days and young crowds.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "wind",
      title: "Wind",
      values: [
        { id: "gentle", title: "Gentle" },
        { id: "breezy", title: "Breezy" },
        { id: "gusty", title: "Gusty" },
        { id: "live", title: "Real wind" },
      ],
      default: "breezy",
      visitor: true,
    },
    {
      type: "number",
      key: "lat",
      title: "Latitude",
      min: -90,
      max: 90,
      step: 0.01,
      default: -27.47,
      when: { key: "wind", is: ["live"] },
    },
    {
      type: "number",
      key: "lon",
      title: "Longitude",
      min: -180,
      max: 180,
      step: 0.01,
      default: 153.03,
      when: { key: "wind", is: ["live"] },
    },
    { type: "boolean", key: "rings", title: "Rings", default: true, visitor: true },
    { type: "boolean", key: "tangles", title: "Tangles", default: true, visitor: true },
    {
      type: "number",
      key: "flyers",
      title: "Flyers",
      min: 4,
      max: 8,
      step: 1,
      default: 6,
      kinds: ["wall"],
      visitor: true,
    },
  ],
  network: "optional",
  thumb: { kind: "screen", seconds: 10 },
};

export default manifest;
