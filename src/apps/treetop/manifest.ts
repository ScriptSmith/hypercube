import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "treetop",
  title: "Treetop Race",
  category: "game",
  blurb: "Tap to fly through the gaps and race everyone else on the same course.",
  setups: [
    {
      setup: "solo",
      kinds: ["panel", "pair", "wall"],
      note: "On a wall, lanes stand side by side within reach and the race shows above them.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Players who join race each other on the same course; the screen above shows the race.",
    },
  ],
  variants: [
    { id: "race", title: "Race", blurb: "Tap anywhere to fly. First across the line wins." },
    {
      id: "pads",
      title: "Low and high",
      blurb: "Two lanes on each panel: a low one for children and a faster high one for adults.",
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
      type: "enum",
      key: "gap",
      title: "Gaps",
      values: [
        { id: "wide", title: "Wide" },
        { id: "normal", title: "Normal" },
        { id: "narrow", title: "Narrow" },
      ],
      default: "normal",
      visitor: true,
    },
    {
      type: "number",
      key: "race",
      title: "Race length (seconds)",
      min: 30,
      max: 90,
      step: 15,
      default: 45,
    },
    {
      type: "number",
      key: "lanes",
      title: "Lanes",
      min: 4,
      max: 6,
      step: 2,
      default: 6,
      kinds: ["wall"],
      visitor: true,
    },
    {
      type: "boolean",
      key: "ghost",
      title: "Ghost of the best run",
      default: true,
      kinds: ["panel"],
    },
    {
      type: "enum",
      key: "flyer",
      title: "Flyer",
      values: [
        { id: "lorikeet", title: "Lorikeet" },
        { id: "glider", title: "Paper glider" },
      ],
      default: "lorikeet",
      visitor: true,
    },
    {
      type: "enum",
      key: "crash",
      title: "Crashes",
      values: [
        { id: "tumble", title: "Tumble and carry on" },
        { id: "out", title: "Out until the next race" },
      ],
      default: "tumble",
      visitor: true,
    },
  ],
  network: "optional",
  stations: true,
  thumb: { looks: [{ kind: "screen" }] },
};

export default manifest;
