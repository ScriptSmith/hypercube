import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "fishbowl",
  title: "Fish Bowl",
  category: "visual",
  blurb:
    "A planted tank of fish, shrimp and snails behind the wall's glass, or the ball as a glass bowl of water with funny fish that come up to the glass.",
  setups: [
    {
      setup: "solo",
      kinds: ["sphere"],
      note: "The bowl is inside the ball, seen through the glass from all round and underneath.",
    },
    {
      setup: "solo",
      kinds: ["wall"],
      note: "The wall is the front glass of a big tank. Tap the glass and the fish start; hold to sprinkle food.",
    },
  ],
  variants: [
    {
      id: "community",
      title: "Community tank",
      blurb: "Neon tetras, harlequins, angelfish, gouramis, catfish, shrimp and snails.",
    },
    {
      id: "bowl",
      title: "Goldfish bowl",
      blurb: "Goldfish, a shoal, a catfish, a puffer and a snail.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "fish",
      title: "Fish",
      values: [
        { id: "few", title: "A few" },
        { id: "many", title: "Many" },
      ],
      default: "few",
      visitor: true,
    },
    { type: "boolean", key: "feeding", title: "Feeding time every few minutes", default: true },
  ],
  network: "none",
  thumb: {
    kind: "sphere",
    variant: "bowl",
    seconds: 6,
    looks: [{ kind: "wall", variant: "community" }],
  },
};

export default manifest;
