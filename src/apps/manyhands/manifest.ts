import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "manyhands",
  title: "Many Hands",
  category: "game",
  blurb: "Quick tasks on every panel make parts for one big build that always gets finished.",
  setups: [
    {
      setup: "solo",
      kinds: ["wall", "panel", "pair"],
      note: "Workstations of quick tasks; the frame's own build fills the top.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each panel (or each half of a pair) is a workstation; parts fly up to the build on the screen.",
    },
  ],
  variants: [
    {
      id: "mixed",
      title: "Mixed",
      blurb: "Children's tasks low, grown-ups' tasks higher up.",
    },
    {
      id: "simple",
      title: "Simple",
      blurb: "Children's tasks in every slot, for young groups.",
    },
  ],
  options: [
    {
      type: "number",
      key: "round",
      title: "Seconds per build",
      min: 60,
      max: 300,
      step: 30,
      default: 150,
    },
    {
      type: "enum",
      key: "theme",
      title: "Build",
      values: [
        { id: "rotate", title: "Take turns" },
        { id: "rocket", title: "Rocket" },
        { id: "treehouse", title: "Treehouse" },
        { id: "lighthouse", title: "Lighthouse" },
        { id: "robot", title: "Robot" },
        { id: "sandcastle", title: "Sandcastle" },
      ],
      default: "rotate",
      visitor: true,
    },
    {
      type: "enum",
      key: "slots",
      title: "Task slots",
      values: [
        { id: "both", title: "Low and high" },
        { id: "low", title: "Low only" },
      ],
      default: "both",
      kinds: ["panel", "pair", "wall"],
    },
    {
      type: "number",
      key: "stations",
      title: "Workstations",
      min: 4,
      max: 8,
      step: 1,
      default: 6,
      kinds: ["wall"],
      visitor: true,
    },
  ],
  network: "optional",
  thumb: { kind: "wall", seconds: 25, looks: [{ kind: "screen" }] },
};

export default manifest;
