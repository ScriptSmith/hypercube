import { createMotion, type MotionEvent, type Pace } from "../../../src/apps/gaze/motion";
import { createRng } from "../../../src/core/rng";
import { sphereInfo } from "../../../src/core/sphere";

export const STEP = 1 / 60;

/** A motion model with its events recorded. */
export const rig = (seed = "gaze", pace: Pace = "furtive", upper = true) => {
  const events: MotionEvent[] = [];
  const motion = createMotion({
    rng: createRng(seed),
    sphere: sphereInfo(),
    pace,
    upper,
    onEvent: (e) => events.push(e),
  });
  const run = (seconds: number, each?: () => void) => {
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      motion.step(STEP);
      each?.();
    }
  };
  return { motion, events, run };
};
