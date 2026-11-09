import type { OptionValues } from "../../core/types";
import { SCENES } from "./scenes";

export interface Config {
  /** The scene to start with (an index into SCENES). */
  scene: number;
  /** Slingshots along a wall. */
  pads: 4 | 6 | 8;
  /** Ribbon length in steps. */
  ribbonSteps: number;
  blackhole: boolean;
  /** Start (and return after idle) with true sizes. */
  trueSizes: boolean;
}

/** The ribbon's length: long is five seconds of flight, short half that. */
export const RIBBON_STEPS = { long: 600, short: 300 } as const;

export const readConfig = (o: OptionValues): Config => ({
  scene: Math.max(0, SCENES.indexOf(String(o.scene) as (typeof SCENES)[number])),
  pads: o.pads === "4" ? 4 : o.pads === "8" ? 8 : 6,
  ribbonSteps: o.ribbon === "short" ? RIBBON_STEPS.short : RIBBON_STEPS.long,
  blackhole: o.blackhole !== false,
  trueSizes: o.truesizes === true,
});
