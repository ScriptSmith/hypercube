import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "tangle",
  title: "Tangle",
  category: "game",
  blurb: "Steer a glowing line and stay off every trail. The last line moving wins.",
  setups: [
    { setup: "solo", kinds: ["panel", "pair", "wall"] },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each panel is a steering pad; the lines race on the screen above.",
    },
  ],
  variants: [
    { id: "trails", title: "Trails", blurb: "Touch a trail and you are out." },
    { id: "snake", title: "Snake", blurb: "Eat the dots to grow. Crash and you start again." },
    {
      id: "grid",
      title: "Grid snake",
      blurb: "Eat the dots to grow. Tap an arrow to go that way.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "speed",
      title: "Speed",
      values: [
        { id: "slow", title: "Slow" },
        { id: "normal", title: "Normal" },
        { id: "fast", title: "Fast" },
      ],
      default: "normal",
      visitor: true,
    },
    {
      type: "number",
      key: "round",
      title: "Round length (seconds)",
      min: 30,
      max: 90,
      step: 15,
      default: 60,
    },
    { type: "boolean", key: "gaps", title: "Gaps in trails", default: true, visitor: true },
    {
      type: "enum",
      key: "trail",
      title: "Trails",
      values: [
        { id: "round", title: "Last the round" },
        { id: "fade", title: "Fade away" },
      ],
      default: "round",
      visitor: true,
    },
    {
      type: "enum",
      key: "edges",
      title: "Edges",
      values: [
        { id: "wrap", title: "Pass through" },
        { id: "solid", title: "Solid" },
      ],
      default: "wrap",
      visitor: true,
    },
    {
      type: "number",
      key: "fill",
      title: "Lines per round, with bots",
      min: 0,
      max: 4,
      step: 1,
      default: 2,
    },
    {
      type: "enum",
      key: "stations",
      title: "Players",
      values: [
        { id: "4", title: "4" },
        { id: "6", title: "6" },
        { id: "8", title: "8" },
      ],
      default: "8",
      kinds: ["wall"],
      visitor: true,
    },
    {
      type: "enum",
      key: "perFrame",
      title: "Stations per panel",
      values: [
        { id: "1", title: "1" },
        { id: "2", title: "2, low and high" },
      ],
      default: "1",
      kinds: ["panel", "pair", "screen"],
    },
  ],
  network: "optional",
  stations: true,
};

export default manifest;
