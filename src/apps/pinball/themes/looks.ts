/**
 * Every theme's look, by variant id: the 3D side of themes/index.ts, kept apart so the rules and
 * their tests never load three.js.
 */
import type { ThemeId } from "../config";
import type { ThemeLook } from "../view3d/look";
import fair from "./fair/look";
import reef from "./reef/look";
import space from "./space/look";
import volcano from "./volcano/look";

export const THEME_LOOKS: Record<ThemeId, ThemeLook> = { space, reef, volcano, fair };
