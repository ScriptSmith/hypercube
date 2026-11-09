import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "cake",
  title: "Cake",
  category: "visual",
  blurb:
    "The whole ball is a round cake under a glossy glaze: a Christmas pudding or one of four others.",
  setups: [
    {
      setup: "solo",
      kinds: ["sphere"],
      note: "The whole ball is the cake and its glaze. It runs by itself.",
    },
  ],
  variants: [
    {
      id: "pudding",
      title: "Christmas pudding",
      blurb: "A dark, fruity, cloth-boiled pudding under white icing, with holly on top.",
    },
    {
      id: "chocolate",
      title: "Chocolate cake",
      blurb: "Chocolate sponge under a dark, glossy ganache with chocolate sprinkles.",
    },
    {
      id: "strawberry",
      title: "Strawberry cake",
      blurb: "Golden vanilla sponge under pink strawberry icing with rainbow sprinkles.",
    },
    {
      id: "galaxy",
      title: "Galaxy dome",
      blurb: "A mousse dome in a glossy marbled glaze of blue, purple and pink, with star specks.",
    },
    {
      id: "rocky",
      title: "Rocky road",
      blurb:
        "Milk chocolate packed with marshmallows, peanuts and cherries, under a pour of dark chocolate.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "drips",
      title: "Glaze",
      values: [
        { id: "none", title: "Smooth cap" },
        { id: "set", title: "Set drips" },
        { id: "runs", title: "Runs, no drops" },
        { id: "drops", title: "Runs and drops" },
      ],
      default: "none",
    },
    {
      type: "enum",
      key: "pace",
      title: "Pace",
      values: [
        { id: "slow", title: "Slow" },
        { id: "lively", title: "Lively" },
      ],
      default: "slow",
      when: { key: "drips", is: ["runs", "drops"] },
    },
    { type: "boolean", key: "turn", title: "Turn slowly", default: true },
    {
      type: "enum",
      key: "glaze",
      title: "Pudding's topping",
      values: [
        { id: "icing", title: "White icing" },
        { id: "custard", title: "Custard" },
      ],
      default: "icing",
    },
  ],
  network: "none",
  thumb: {
    kind: "sphere",
    seconds: 6,
    looks: [{ variant: "galaxy" }, { variant: "strawberry" }, { variant: "rocky" }],
  },
};

export default manifest;
