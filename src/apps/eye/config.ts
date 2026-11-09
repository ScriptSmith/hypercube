import type { OptionValues } from "../../core/types";
import { lightFor } from "./model";

export interface Config {
  /** Show the optional and advice-like caption lines. */
  extras: boolean;
  /** Dioptres and millimetres beside the sliders. */
  numbers: boolean;
  /** The light slider's starting place: daylight indoors or a dim evening. */
  light: number;
  /** The simulated view's horizontal field of view, degrees, fixed so blur sizes are honest. */
  fov: number;
}

export const DAY_CD = 300;
export const NIGHT_CD = 1;

export const readConfig = (o: OptionValues): Config => {
  const fov = typeof o.fov === "number" && Number.isFinite(o.fov) ? o.fov : 40;
  return {
    extras: o.extras === true,
    numbers: o.numbers !== false,
    light: lightFor(o.scene === "night" ? NIGHT_CD : DAY_CD),
    fov: Math.min(60, Math.max(20, fov)),
  };
};

export const HZ = 30;

export const BACKGROUND =
  "radial-gradient(ellipse 90% 80% at 30% 35%, #142038 0%, #0a1020 55%, #05070d 100%)";

export const INK = "#eef2f8";
export const MUTED = "#9aa6bd";
export const ACCENT = "#ffd23a";
export const PANEL = "rgba(12,18,32,0.86)";
export const EDGE = "rgba(150,175,220,0.28)";

/** A person's touch keeps bots standing back this long. */
export const BOT_YIELD_MS = 30_000;
