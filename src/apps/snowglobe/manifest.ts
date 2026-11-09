import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "snowglobe",
  title: "Snow Globe",
  category: "visual",
  blurb:
    "The ball is a giant snow globe: a little winter scene inside, snow drifting down, and a shake every minute or two.",
  setups: [
    {
      setup: "solo",
      kinds: ["sphere"],
      note: "The scene is seen in true 3D from all round and from underneath. It runs by itself.",
    },
  ],
  variants: [
    {
      id: "globe",
      title: "Snow globe",
      blurb: "Snow settles, the globe is shaken, and now and then the scene inside changes.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "scene",
      title: "Scene",
      values: [
        { id: "changes", title: "A new one every few shakes" },
        { id: "cabin", title: "Log cabin" },
        { id: "lighthouse", title: "Lighthouse" },
        { id: "square", title: "Skating pond" },
        { id: "carousel", title: "Carousel" },
        { id: "snowman", title: "Snowman" },
        { id: "hut", title: "Mountain hut" },
      ],
      default: "changes",
    },
    {
      type: "enum",
      key: "shake",
      title: "Shakes",
      values: [
        { id: "often", title: "Every one to two minutes" },
        { id: "rarely", title: "Every three to five minutes" },
      ],
      default: "often",
    },
  ],
  network: "none",
  thumb: {
    kind: "sphere",
    seconds: 8,
    looks: [{ options: { scene: "lighthouse" } }, { options: { scene: "snowman" } }],
  },
};

export default manifest;
