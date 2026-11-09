import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "gaze",
  title: "Big Eye",
  category: "visual",
  blurb:
    "A realistic eye that darts glances round the room, at people below and level with it, and on a wall turns to whoever touches.",
  setups: [{ setup: "solo", kinds: ["sphere", "wall"] }],
  variants: [{ id: "eye", title: "Eye", blurb: "A human eye, true to proportion." }],
  options: [
    {
      type: "enum",
      key: "iris",
      title: "Iris colour",
      values: [
        { id: "brown", title: "Brown" },
        { id: "hazel", title: "Hazel" },
        { id: "green", title: "Green" },
        { id: "blue", title: "Blue" },
        { id: "grey", title: "Grey" },
        { id: "changes", title: "Changing" },
      ],
      default: "changes",
      visitor: true,
    },
    {
      type: "enum",
      key: "pace",
      title: "Pace",
      values: [
        { id: "furtive", title: "Furtive and darting" },
        { id: "calm", title: "Calm" },
      ],
      default: "furtive",
    },
    {
      type: "boolean",
      key: "upper",
      title: "People on the gallery, where the venue has one",
      kinds: ["sphere"],
      default: true,
    },
    {
      type: "boolean",
      key: "lids",
      title: "Eyelids",
      kinds: ["wall"],
      default: true,
      visitor: true,
    },
    {
      type: "boolean",
      key: "lashes",
      title: "Eyelashes",
      kinds: ["wall"],
      default: true,
      when: { key: "lids", is: [true] },
      visitor: true,
    },
    {
      type: "boolean",
      key: "shape",
      title: "Lids shaped as a real eye's, the outer corner higher",
      kinds: ["wall"],
      default: true,
      when: { key: "lids", is: [true] },
    },
    {
      type: "boolean",
      key: "tears",
      title: "Tear ducts, the pink inner corner and wet margins",
      kinds: ["wall"],
      default: true,
      when: { key: "lids", is: [true] },
    },
    {
      type: "enum",
      key: "wall",
      title: "Wall",
      kinds: ["wall"],
      values: [
        { id: "slate", title: "Dark slate" },
        { id: "skin", title: "Skin tones" },
      ],
      default: "slate",
      visitor: true,
    },
    {
      type: "boolean",
      key: "reflections",
      title: "Reflections of the room on the eye",
      default: true,
    },
    {
      type: "boolean",
      key: "depth",
      title: "Depth in the iris",
      default: true,
    },
  ],
  network: "none",
  thumb: {
    kind: "sphere",
    seconds: 2,
    looks: [{ kind: "wall" }, { kind: "wall", options: { wall: "skin" } }],
  },
};

export default manifest;
