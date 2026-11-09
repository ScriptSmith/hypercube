import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "logic",
  title: "Logic Lab",
  category: "visual",
  blurb:
    "Flip big switches to light lamps, then wire logic gates between them to run a machine up on the wall.",
  setups: [
    {
      setup: "solo",
      kinds: ["wall", "pair", "kiosk"],
      note: "One workbench on a pair or kiosk; one to three side by side on a wall.",
    },
  ],
  variants: [
    {
      id: "bench",
      title: "Free building",
      blurb: "A small working circuit to start from; add switches, lamps and gates as you like.",
    },
    {
      id: "goals",
      title: "Puzzle cards",
      blurb: "A card shows what the machine should do for each set of switches. Wire it up.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "gates",
      title: "Gates",
      values: [
        { id: "all", title: "NOT, AND, OR, XOR and blinker" },
        { id: "basic", title: "NOT, AND and OR" },
      ],
      default: "all",
      visitor: true,
    },
    {
      type: "enum",
      key: "machine",
      title: "Machine",
      values: [
        { id: "rotate", title: "Take turns" },
        { id: "lighthouse", title: "Lighthouse" },
        { id: "fountain", title: "Fountain" },
        { id: "windmill", title: "Windmill" },
        { id: "crossing", title: "Level crossing" },
        { id: "rocket", title: "Rocket" },
      ],
      default: "rotate",
      visitor: true,
    },
    {
      type: "number",
      key: "benches",
      title: "Benches",
      min: 1,
      max: 3,
      step: 1,
      default: 2,
      kinds: ["wall"],
      visitor: true,
    },
  ],
  network: "none",
};

export default manifest;
