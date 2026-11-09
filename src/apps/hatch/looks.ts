/**
 * Colours: each kind of shell, the chick's down wet and dry, and the candling glow. Hex values
 * are sRGB as a painter would pick them; `three`'s Color turns them into the linear values the
 * shaders use.
 */
import type { ShellKind } from "./show";

export interface ShellLook {
  base: string;
  mottle: string;
  speck: string;
  fleck: string;
  mottleAmt: number;
  /** Share of grid cells holding a speckle. */
  speckAmt: number;
  /** Speckle grid cells per unit of direction: higher is smaller speckles. */
  speckScale: number;
  speckSize: number;
  /** Pale flecks over the colour, as on many brown shells. */
  fleckAmt: number;
  /** How much the speckles crowd towards the blunt end. */
  capBias: number;
  grain: number;
  /** How much of a candling lamp's light gets through: dark shells hide more. */
  glow: number;
  /** The colour of a broken edge and the inside. */
  lip: string;
}

export const SHELLS: Record<ShellKind, ShellLook> = {
  white: {
    base: "#ebe6dc",
    mottle: "#dcd5c7",
    speck: "#d2c9b8",
    fleck: "#f4f1ea",
    mottleAmt: 0.45,
    speckAmt: 0.04,
    speckScale: 18,
    speckSize: 0.25,
    fleckAmt: 0,
    capBias: 0,
    grain: 0.06,
    glow: 1,
    lip: "#f2efe8",
  },
  cream: {
    base: "#e9d9bd",
    mottle: "#dbc8a6",
    speck: "#cbb28c",
    fleck: "#f2e8d5",
    mottleAmt: 0.55,
    speckAmt: 0.07,
    speckScale: 20,
    speckSize: 0.24,
    fleckAmt: 0.05,
    capBias: 0.2,
    grain: 0.07,
    glow: 0.92,
    lip: "#f1ece2",
  },
  brown: {
    base: "#b47e57",
    mottle: "#a06a45",
    speck: "#7a4a2f",
    fleck: "#d6b596",
    mottleAmt: 0.65,
    speckAmt: 0.14,
    speckScale: 18,
    speckSize: 0.26,
    fleckAmt: 0.22,
    capBias: 0.3,
    grain: 0.08,
    glow: 0.72,
    lip: "#efe6da",
  },
  speckled: {
    base: "#c6936d",
    mottle: "#b6825d",
    speck: "#5c311d",
    fleck: "#e0c3a7",
    mottleAmt: 0.6,
    speckAmt: 0.42,
    speckScale: 13,
    speckSize: 0.34,
    fleckAmt: 0.08,
    capBias: 0.6,
    grain: 0.08,
    glow: 0.66,
    lip: "#efe5d8",
  },
  dark: {
    base: "#7c4c32",
    mottle: "#6a3f29",
    speck: "#3e1f13",
    fleck: "#a27358",
    mottleAmt: 0.6,
    speckAmt: 0.3,
    speckScale: 15,
    speckSize: 0.3,
    fleckAmt: 0.12,
    capBias: 0.4,
    grain: 0.09,
    glow: 0.48,
    lip: "#e9ddcf",
  },
  blue: {
    base: "#bdd6cf",
    mottle: "#a9c6bf",
    speck: "#9bb7af",
    fleck: "#d8e8e3",
    mottleAmt: 0.5,
    speckAmt: 0.04,
    speckScale: 20,
    speckSize: 0.22,
    fleckAmt: 0.05,
    capBias: 0,
    grain: 0.06,
    glow: 0.88,
    lip: "#bcd8d1",
  },
  olive: {
    base: "#9b9f6d",
    mottle: "#8b8f5e",
    speck: "#6c6c44",
    fleck: "#bcbf95",
    mottleAmt: 0.55,
    speckAmt: 0.12,
    speckScale: 16,
    speckSize: 0.26,
    fleckAmt: 0.06,
    capBias: 0.2,
    grain: 0.07,
    glow: 0.66,
    lip: "#b9d2c8",
  },
};

/** Down colours, dry and just hatched (wet down is darker and duller). */
export const DOWNS: readonly { dry: string; wet: string }[] = [
  { dry: "#ffe27a", wet: "#c99e3a" },
  { dry: "#ffd75e", wet: "#c39532" },
  { dry: "#f9d88c", wet: "#c09a52" },
  { dry: "#ffeb9a", wet: "#cdac4c" },
];

export const GLOW = "#ff9a3a";
export const GLOW_AIR = "#ffd27a";
