import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "tiltmaze",
  title: "Tilt Maze",
  category: "game",
  blurb:
    "Tip a wooden maze with a big pad and roll the ball into the goal; finished balls shoot up into a marble run.",
  setups: [
    {
      setup: "solo",
      kinds: ["panel", "pair", "wall", "kiosk", "screen"],
      note: "A board with its pad and a jar above; two boards on a pair, 2 to 4 on a wall. A screen alone runs the marble run.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Every frame plays its own boards; finished balls rise out of each frame into one marble run and jar on the screen.",
    },
  ],
  variants: [
    { id: "maze", title: "Maze", blurb: "Roll the ball through the maze into the goal." },
    {
      id: "holes",
      title: "Holes",
      blurb: "Holes on the way swallow the ball, which comes back at the start.",
    },
  ],
  options: [
    {
      type: "number",
      key: "boards",
      title: "Boards",
      min: 2,
      max: 4,
      step: 1,
      default: 3,
      kinds: ["wall"],
      visitor: true,
    },
    {
      type: "enum",
      key: "pair",
      title: "On a pair",
      values: [
        { id: "side", title: "Side by side" },
        { id: "together", title: "Together" },
      ],
      default: "side",
      kinds: ["pair"],
      visitor: true,
    },
    {
      type: "enum",
      key: "speed",
      title: "Speed",
      values: [
        { id: "gentle", title: "Gentle" },
        { id: "lively", title: "Lively" },
      ],
      default: "gentle",
      visitor: true,
    },
    {
      type: "number",
      key: "jar",
      title: "Balls to fill the jar",
      min: 10,
      max: 40,
      step: 1,
      default: 20,
    },
  ],
  network: "optional",
  thumb: { kind: "kiosk", seconds: 10 },
};

export default manifest;
