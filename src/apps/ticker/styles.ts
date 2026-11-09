/**
 * The looks. Canvas colours are sRGB strings; the background's are linear, for its shader. No
 * red anywhere: it would be the colour of a warning, and saturated red flicker is what the
 * photosensitivity guidance warns about.
 */
export type StyleId = "amber" | "white" | "colour";

export interface Style {
  /** The dark band behind the letters. */
  band: string;
  /** A thin line along the band's edges. */
  rim: string;
  /** LEDs that are off. */
  unlit: string;
  /** Lettering, one per line in turn. */
  letters: readonly string[];
  /** The star between lines. */
  star: string;
  /** How strong the soft glow round lit dots is, 0 to 1. */
  glow: number;
  /** Chaser lamps, lit and resting. */
  lampOn: string;
  lampOff: string;
  /** New words appear out of this light. */
  printer: string;
  /** Background waves (linear): a deep base and two tints the waves move between. */
  base: [number, number, number];
  tintA: [number, number, number];
  tintB: [number, number, number];
}

export const STYLES: Record<StyleId, Style> = {
  amber: {
    band: "#080503",
    rim: "#3a2408",
    unlit: "rgba(120,72,20,0.22)",
    letters: ["#ffb03a"],
    star: "#ffe08a",
    glow: 0.55,
    lampOn: "#ffd27a",
    lampOff: "#4a2e0c",
    printer: "#ffe9b8",
    base: [0.002, 0.0015, 0.004],
    tintA: [0.018, 0.006, 0.03],
    tintB: [0.03, 0.012, 0.004],
  },
  white: {
    band: "#050608",
    rim: "#2a3040",
    unlit: "rgba(110,120,140,0.2)",
    letters: ["#f4f1ea"],
    star: "#bcd6ff",
    glow: 0.4,
    lampOn: "#e8f0ff",
    lampOff: "#262c38",
    printer: "#ffffff",
    base: [0.0015, 0.002, 0.004],
    tintA: [0.006, 0.014, 0.032],
    tintB: [0.012, 0.012, 0.024],
  },
  colour: {
    band: "#050508",
    rim: "#2c2440",
    unlit: "rgba(110,100,140,0.2)",
    letters: ["#ffb03a", "#6cf2f0", "#b4f06a", "#ff8cd2", "#b9a0ff", "#7cc4ff"],
    star: "#fff1b0",
    glow: 0.5,
    lampOn: "#fff1c8",
    lampOff: "#2e2a3c",
    printer: "#ffffff",
    base: [0.0015, 0.0015, 0.004],
    tintA: [0.004, 0.02, 0.026],
    tintB: [0.022, 0.006, 0.03],
  },
};

export const styleOf = (id: unknown): Style =>
  typeof id === "string" && id in STYLES ? STYLES[id as StyleId] : STYLES.amber;
