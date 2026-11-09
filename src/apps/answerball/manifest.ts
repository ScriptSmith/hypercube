import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "answerball",
  title: "Answer Ball",
  category: "visual",
  blurb:
    "A giant answer ball: it rocks, and in its windows a die rises out of dark liquid with an answer. On a wall, touch a ball to shake it.",
  setups: [
    {
      setup: "solo",
      kinds: ["sphere"],
      note: "Six windows round the ball, alternately high and low, and one underneath answer a row at a time. It runs by itself.",
    },
    {
      setup: "solo",
      kinds: ["wall"],
      note: "Three balls in a row; touch one to shake it and it answers. With nobody about they shake themselves.",
    },
  ],
  variants: [
    {
      id: "ball",
      title: "Answer ball",
      blurb:
        "Dark plastic with windows; in each, a twenty-sided die in dark liquid shows one of 20 answers.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "colours",
      title: "Colours",
      values: [
        { id: "night", title: "Night" },
        { id: "violet", title: "Violet" },
        { id: "teal", title: "Teal" },
      ],
      default: "night",
      visitor: true,
    },
    {
      type: "enum",
      key: "balls",
      title: "Balls",
      kinds: ["wall"],
      values: [
        { id: "3", title: "Three" },
        { id: "2", title: "Two" },
        { id: "1", title: "One" },
      ],
      default: "3",
      visitor: true,
    },
    {
      type: "enum",
      key: "windows",
      title: "Windows",
      kinds: ["sphere"],
      values: [
        { id: "six", title: "Six round the ball, high and low" },
        { id: "three", title: "Three round the ball" },
        { id: "one", title: "One, turning to face each side" },
      ],
      default: "six",
    },
    {
      type: "boolean",
      key: "under",
      title: "A window underneath as well",
      kinds: ["sphere"],
      default: true,
      when: { key: "windows", is: ["six"] },
    },
    { type: "boolean", key: "prompt", title: '"Ask a question" before each answer', default: true },
    {
      type: "enum",
      key: "pace",
      title: "Pace",
      values: [
        { id: "calm", title: "About 17 s an answer" },
        { id: "lively", title: "About 10 s an answer" },
      ],
      default: "calm",
    },
  ],
  network: "none",
  // The low row's first answers hold from the start; a screenshot can take seconds to land.
  thumb: {
    kind: "sphere",
    seconds: 0,
    looks: [
      { options: { colours: "violet" } },
      { kind: "wall", seconds: 2 },
      { kind: "wall", options: { colours: "teal" }, seconds: 2 },
    ],
  },
};

export default manifest;
