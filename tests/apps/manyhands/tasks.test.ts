import { describe, expect, it } from "vitest";
import { TASKS } from "../../../src/apps/manyhands/tasks/library";
import { runBot, slotSizes } from "./helpers";

describe("every task completes under its bot routine", () => {
  for (const size of slotSizes()) {
    for (const def of TASKS) {
      // Adult slots also get children's tasks in the simple variant.
      if (size.band === "low" && def.band === "high") continue;
      it(`${def.id} in ${size.label}`, () => {
        for (const seed of ["a", "b", "c"]) {
          const bot = runBot(def, size.env, { seed, draw: seed === "a" });
          expect(bot.task.done, `${seed} done`).toBe(true);
          expect(bot.task.progress).toBeCloseTo(1, 5);
          expect(bot.seconds).toBeLessThan(20);
          const ghost = runBot(def, size.env, { seed, pace: 0.35, gap: 1200 });
          expect(ghost.task.done, `${seed} ghost done`).toBe(true);
          expect(ghost.seconds).toBeLessThan(60);
        }
      });
    }
  }
});
