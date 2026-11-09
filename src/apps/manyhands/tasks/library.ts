/** Every task, and which band's slots each belongs in. Add new tasks here. */
import type { Rng } from "../../../core/types";
import type { Variant } from "../config";
import { CATCH } from "./catch";
import type { Band, TaskDef, TaskId } from "./common";
import { COUNT } from "./count";
import { CRANK } from "./crank";
import { GAUGE } from "./gauge";
import { HOLD } from "./hold";
import { PLUG } from "./plug";
import { POP } from "./pop";
import { PUMP } from "./pump";
import { REPEAT } from "./repeat";
import { SORT } from "./sort";

export const TASKS: readonly TaskDef[] = [
  POP,
  PUMP,
  HOLD,
  CATCH,
  SORT,
  CRANK,
  PLUG,
  REPEAT,
  GAUGE,
  COUNT,
];

export const taskById = (id: string): TaskDef | undefined => TASKS.find((t) => t.id === id);

/** The tasks a slot in `band` deals from. The simple variant deals children's tasks everywhere. */
export const tasksFor = (band: Band, variant: Variant): TaskDef[] =>
  TASKS.filter((t) => t.band === (variant === "simple" ? "low" : band));

/** The next task for a slot: any from its list but the one it just had. */
export const dealNext = (list: readonly TaskDef[], prev: TaskId | null, rng: Rng): TaskDef => {
  const choices = list.length > 1 ? list.filter((t) => t.id !== prev) : list;
  return rng.pick(choices.length > 0 ? choices : TASKS);
};
