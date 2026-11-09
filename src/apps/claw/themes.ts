/** Each cabinet's colours, sign word and icon. Words are short and generic. */
export type Icon = "claw" | "star" | "heart" | "smile";

export interface Theme {
  word: string;
  icon: Icon;
  body: string;
  light: string;
  dark: string;
  trim: string;
  /** The sign's panel, top to bottom, and its lettering. */
  sign: readonly [string, string];
  ink: string;
  /** The wall inside the glass, top to bottom, and its pattern's colour. */
  backdrop: readonly [string, string];
  pattern: string;
  /** Lit bulbs, the LED strips and the joystick's knob. */
  bulb: string;
  led: string;
  knob: string;
}

export const THEMES: readonly Theme[] = [
  {
    word: "Prizes",
    icon: "claw",
    body: "#e2438f",
    light: "#ff8cc0",
    dark: "#8e1f55",
    trim: "#ffd27a",
    sign: ["#5a1a8c", "#c22d84"],
    ink: "#fff3c4",
    backdrop: ["#2a1250", "#4a1f6e"],
    pattern: "rgba(255,210,122,0.22)",
    bulb: "#ffe9a6",
    led: "#ff7ad1",
    knob: "#7a5cff",
  },
  {
    word: "Grab",
    icon: "star",
    body: "#14a6a8",
    light: "#5fe0dc",
    dark: "#0b5d66",
    trim: "#f4fbff",
    sign: ["#0b3d7a", "#1592b8"],
    ink: "#ffffff",
    backdrop: ["#0c2448", "#123c63"],
    pattern: "rgba(140,240,255,0.2)",
    bulb: "#dff8ff",
    led: "#5ff2ff",
    knob: "#ff6fb1",
  },
  {
    word: "Win",
    icon: "heart",
    body: "#7448d8",
    light: "#a989ff",
    dark: "#3b2280",
    trim: "#b8f26a",
    sign: ["#2b1366", "#6a3bd1"],
    ink: "#e9ffc9",
    backdrop: ["#13284a", "#1d4a5e"],
    pattern: "rgba(184,242,106,0.18)",
    bulb: "#f3ffd6",
    led: "#b8f26a",
    knob: "#ff9d3c",
  },
  {
    word: "Plush",
    icon: "smile",
    body: "#2f86e8",
    light: "#7bb8ff",
    dark: "#174a8f",
    trim: "#ffa34d",
    sign: ["#123a85", "#2c7fe0"],
    ink: "#fff1de",
    backdrop: ["#26124a", "#2d2f6e"],
    pattern: "rgba(255,163,77,0.2)",
    bulb: "#fff0d6",
    led: "#ffb66a",
    knob: "#3fd69a",
  },
];

export const themeOf = (i: number): Theme => THEMES[i % THEMES.length]!;
