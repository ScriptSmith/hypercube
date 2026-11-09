import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "pinball",
  title: "Pinball",
  category: "game",
  blurb:
    "Flippers low for children, flippers high for grown-ups, and deck shots fly up to the screen.",
  setups: [
    { setup: "solo", kinds: ["panel", "pair"] },
    {
      setup: "solo",
      kinds: ["wall"],
      note: "A row of tables, with the upper deck across the top of the wall.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "Each panel is a table. Deck shots fly up to an upper deck on the screen and rain back down.",
    },
  ],
  variants: [
    { id: "classic", title: "Classic", blurb: "A few balls a game, with a short ball save." },
    {
      id: "space",
      title: "Space",
      blurb: "A 3D table with a rocket to launch, a planet with moons and a black hole.",
    },
    {
      id: "reef",
      title: "Reef",
      blurb:
        "A 3D table under the sea, with pufferfish, a giant clam, a turtle ramp and a current.",
    },
    {
      id: "volcano",
      title: "Volcano",
      blurb: "A 3D table on a volcano, with a lava ramp, a friendly dinosaur and eggs to hatch.",
    },
    {
      id: "fair",
      title: "Fun fair",
      blurb: "A 3D table at a fair at night, with a Ferris wheel, a carousel, bells and a cannon.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "balls",
      title: "Balls per game",
      values: [
        { id: "3", title: "3" },
        { id: "5", title: "5" },
      ],
      default: "3",
      visitor: true,
      kinds: ["panel", "pair", "wall"],
    },
    {
      type: "enum",
      key: "tables",
      title: "Tables",
      values: [
        { id: "4", title: "4" },
        { id: "5", title: "5" },
        { id: "6", title: "6" },
      ],
      default: "5",
      kinds: ["wall"],
      visitor: true,
    },
    { type: "boolean", key: "deck", title: "Upper deck", default: true },
    { type: "boolean", key: "rain", title: "Deck balls land on any table", default: true },
    {
      type: "boolean",
      key: "grab",
      title: "Pick up balls",
      default: false,
      kinds: ["panel", "pair", "wall"],
      visitor: true,
    },
  ],
  network: "optional",
  stations: true,
  thumb: {
    kind: "pair",
    seconds: 8,
    looks: [{ variant: "reef" }, { variant: "volcano" }, { kind: "wall", variant: "fair" }],
  },
};

export default manifest;
