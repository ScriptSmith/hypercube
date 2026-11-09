import type { AppManifest, OptionDef } from "../../core/types";

/** Longest operator message, in characters. */
export const MESSAGE_MAX = 120;
/** How many operator messages admin can set. */
export const MESSAGE_SLOTS = 3;

const MESSAGES: OptionDef[] = Array.from({ length: MESSAGE_SLOTS }, (_, i) => ({
  type: "text" as const,
  key: `message${i + 1}`,
  title: `Your message ${i + 1}`,
  maxLength: MESSAGE_MAX,
  default: "",
}));

const manifest: AppManifest = {
  id: "ticker",
  title: "Ticker Ring",
  category: "visual",
  blurb: "Rings of bright lettering crawl round the ball, so everyone round it can read them.",
  setups: [{ setup: "solo", kinds: ["sphere"] }],
  variants: [{ id: "ribbon", title: "Ribbon", blurb: "Lit letters crawling round dark bands." }],
  options: [
    {
      type: "enum",
      key: "rings",
      title: "Rings",
      values: [
        { id: "1", title: "One, below the middle" },
        { id: "2", title: "Two, for across the room and nearby" },
        { id: "3", title: "Three, with a small one underneath" },
      ],
      default: "2",
    },
    {
      type: "enum",
      key: "style",
      title: "Lettering",
      values: [
        { id: "amber", title: "Amber" },
        { id: "white", title: "White" },
        { id: "colour", title: "A colour for each message" },
      ],
      default: "amber",
    },
    {
      type: "enum",
      key: "list",
      title: "Messages",
      values: [
        { id: "general", title: "Welcomes, facts and the time" },
        { id: "welcome", title: "Short greetings only" },
        { id: "operator", title: "Your messages and the time" },
      ],
      default: "general",
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
    },
    ...MESSAGES,
  ],
  network: "none",
  thumb: { kind: "sphere", seconds: 4 },
};

export default manifest;
