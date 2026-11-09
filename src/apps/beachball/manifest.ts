import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "beachball",
  title: "Beach Ball",
  category: "visual",
  blurb:
    "A sphere becomes a lazily spinning beach ball; on a wall, bat and throw beach balls and toys round a beach with an umbrella and a crab.",
  setups: [
    { setup: "solo", kinds: ["sphere"] },
    { setup: "solo", kinds: ["wall"] },
  ],
  variants: [
    {
      id: "ball",
      title: "Beach ball",
      blurb: "Six gores, two caps and a valve.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "colours",
      title: "Colours",
      values: [
        { id: "classic", title: "Classic" },
        { id: "ocean", title: "Ocean" },
        { id: "sunset", title: "Sunset" },
      ],
      default: "classic",
    },
    {
      type: "enum",
      key: "pace",
      title: "Pace",
      kinds: ["sphere"],
      values: [
        { id: "lazy", title: "Lazy" },
        { id: "lively", title: "Lively" },
      ],
      default: "lazy",
    },
    {
      type: "boolean",
      key: "toss",
      title: "Tossed now and then",
      kinds: ["sphere"],
      default: true,
    },
    {
      type: "number",
      key: "balls",
      title: "Balls",
      kinds: ["wall"],
      visitor: true,
      min: 1,
      max: 3,
      step: 1,
      default: 2,
    },
    { type: "boolean", key: "props", title: "Beach toys", kinds: ["wall"], default: true },
    {
      type: "boolean",
      key: "net",
      title: "Volleyball net",
      kinds: ["wall"],
      default: true,
      visitor: true,
    },
    { type: "boolean", key: "umbrella", title: "Beach umbrella", kinds: ["wall"], default: true },
    { type: "boolean", key: "crab", title: "Crab", kinds: ["wall"], default: true },
    {
      type: "enum",
      key: "sky",
      title: "Time of day",
      kinds: ["wall"],
      values: [
        { id: "cycle", title: "Changing" },
        { id: "day", title: "Day" },
        { id: "sunset", title: "Sunset" },
        { id: "evening", title: "Evening" },
        { id: "sunrise", title: "Sunrise" },
      ],
      default: "cycle",
      visitor: true,
    },
    { type: "boolean", key: "extras", title: "Sand and water drops", default: true },
  ],
  network: "none",
  thumb: {
    kind: "sphere",
    seconds: 4,
    looks: [
      { options: { colours: "ocean" } },
      { kind: "wall" },
      { kind: "wall", options: { sky: "sunset" } },
    ],
  },
};

export default manifest;
