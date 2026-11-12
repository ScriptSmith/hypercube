import type { AppManifest } from "../../core/types";

/** Longest operator line, in characters. */
export const TEXT_MAX = 120;

export const SANDS = ["golden", "white", "rose", "blue"] as const;
export type SandId = (typeof SANDS)[number];

const manifest: AppManifest = {
  id: "hourglass",
  title: "Hourglass",
  category: "visual",
  blurb:
    "The ball is a giant hourglass: its sand runs out at a time you set, with a countdown round its collar and your own message below.",
  setups: [
    {
      setup: "solo",
      kinds: ["sphere"],
      note: "The same picture from every side and from underneath. It follows the display's clock.",
    },
  ],
  // How the sand comes down the lower glass. The levels and the time are the same in each.
  variants: [
    {
      id: "streams",
      title: "Fine streams",
      blurb: "Five fine streams run down the glass, with a mound under each.",
    },
    {
      id: "trails",
      title: "Grains with trails",
      blurb: "Single grains slide down all round, each with a trail fading behind it.",
    },
    {
      id: "grains",
      title: "Scattered grains",
      blurb: "A rain of single grains, thicker near the collar.",
    },
    {
      id: "veil",
      title: "A thin veil",
      blurb: "A thin, streaked sheet of sand slides down all round.",
    },
    {
      id: "spiral",
      title: "Winding streams",
      blurb: "The streams wind round the ball on their way down.",
    },
  ],
  options: [
    {
      type: "number",
      key: "endhour",
      title: "Sand runs out at, hour",
      min: 0,
      max: 23,
      step: 1,
      default: 17,
    },
    {
      type: "number",
      key: "endminute",
      title: "Sand runs out at, minute",
      min: 0,
      max: 59,
      step: 1,
      default: 0,
    },
    {
      type: "number",
      key: "starthour",
      title: "Glass is turned at, hour",
      min: 0,
      max: 23,
      step: 1,
      default: 9,
    },
    {
      type: "number",
      key: "startminute",
      title: "Glass is turned at, minute",
      min: 0,
      max: 59,
      step: 1,
      default: 0,
    },
    { type: "boolean", key: "countdown", title: "Show the time left", default: true },
    {
      type: "enum",
      key: "sand",
      title: "Sand",
      visitor: true,
      values: [
        { id: "golden", title: "Golden" },
        { id: "white", title: "White" },
        { id: "rose", title: "Rose" },
        { id: "blue", title: "Blue" },
      ],
      default: "golden",
    },
    {
      type: "text",
      key: "message",
      title: "Your message, shown all day",
      maxLength: TEXT_MAX,
      default: "",
      url: true,
    },
    {
      type: "text",
      key: "ending",
      title: "Your line for when the sand has run out",
      maxLength: TEXT_MAX,
      default: "",
      url: true,
    },
  ],
  network: "none",
  // A run that fills the day from early morning, so a thumbnail made in working hours or in the
  // evening shows sand in both chambers.
  thumb: {
    kind: "sphere",
    seconds: 4,
    options: { starthour: 4, startminute: 0, endhour: 4, endminute: 0 },
  },
};

export default manifest;
