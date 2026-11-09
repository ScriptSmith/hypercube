import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "hockey",
  title: "Table Hockey",
  category: "game",
  blurb: "Knock pucks into the other side's goal with a mallet that follows your finger.",
  setups: [
    { setup: "solo", kinds: ["panel", "pair", "wall", "kiosk"] },
    {
      setup: "versus",
      kinds: ["wall", "pair"],
      note: "Each frame holds one end of a long table; pucks slide from one to the other.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each touch frame plays its own table; the screen above shows every game.",
    },
  ],
  variants: [
    { id: "hockey", title: "Hockey", blurb: "Round mallets, slot goals." },
    { id: "paddles", title: "Paddles", blurb: "Paddles slide along your own edge." },
    {
      id: "defence",
      title: "Defence",
      blurb: "Guard your goal on the bottom line together and light the targets up high.",
    },
  ],
  options: [
    {
      type: "number",
      key: "pucks",
      title: "Pucks",
      min: 1,
      max: 3,
      step: 1,
      default: 2,
      visitor: true,
    },
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
      key: "target",
      title: "Goals to win",
      values: [
        { id: "3", title: "3" },
        { id: "5", title: "5" },
        { id: "7", title: "7" },
      ],
      default: "7",
      visitor: true,
    },
    {
      type: "boolean",
      key: "childLane",
      title: "Child lane",
      default: false,
      visitor: true,
      kinds: ["wall"],
    },
    {
      type: "enum",
      key: "layout",
      title: "Table",
      values: [
        { id: "tables", title: "Several tables" },
        { id: "long", title: "One long table" },
      ],
      default: "tables",
      visitor: true,
      kinds: ["wall"],
    },
    {
      type: "number",
      key: "players",
      title: "Players per side",
      min: 1,
      max: 4,
      step: 1,
      default: 3,
      visitor: true,
      kinds: ["wall", "pair"],
    },
  ],
  network: "optional",
  stations: true,
};

export default manifest;
