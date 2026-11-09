import type { SceneId } from "../show";
import { CITY } from "./city";
import { DESERT } from "./desert";
import { FOREST } from "./forest";
import { LIGHTHOUSE } from "./lighthouse";
import { PEAKS } from "./peaks";
import { SHIP } from "./ship";
import { WHALE } from "./whale";

export interface SceneLook {
  glsl: string;
  /** The glow inside the orb leans towards this while the vision shows (sRGB hex). */
  tint: string;
  /** The haze the vision is seen through. */
  mist: string;
}

export const LOOKS: Record<SceneId, SceneLook> = {
  ship: { glsl: SHIP, tint: "#8ea8e2", mist: "#1c2638" },
  peaks: { glsl: PEAKS, tint: "#4fd2a2", mist: "#14262a" },
  forest: { glsl: FOREST, tint: "#c0a0d8", mist: "#2a2030" },
  city: { glsl: CITY, tint: "#e0aa66", mist: "#2a2228" },
  desert: { glsl: DESERT, tint: "#9c8ad8", mist: "#1a1828" },
  whale: { glsl: WHALE, tint: "#f0ac8c", mist: "#3a2c34" },
  lighthouse: { glsl: LIGHTHOUSE, tint: "#e4c27c", mist: "#2a2c30" },
};
