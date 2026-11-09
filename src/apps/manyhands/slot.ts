/**
 * One task slot. It deals tasks (never the same one twice in a row), hands the touches that
 * start in it to the task, and plays the task itself when nobody is: at full speed when it is a
 * bot's slot, slowly with a ghost hand otherwise (attract). A person's touch stops either at
 * once. When a task is done the slot reports who did it, pauses while its part leaves, then
 * slides the next task in.
 */
import type { Rng } from "../../core/types";
import { MADE_MS, NEXT_GAP_MS, PERSON_HOLD_MS, SLIDE_MS } from "./config";
import { createPlayer, type Player, type Sink } from "./gesture";
import type { SlotSpec } from "./layout";
import type { Task, TaskDef, TaskId } from "./tasks/common";
import { dealNext, taskById } from "./tasks/library";

export type Who = "person" | "bot" | "ghost";
export type SlotPhase = "play" | "made" | "slide";

export interface SlotDeps {
  spec: SlotSpec;
  defs: readonly TaskDef[];
  rng: Rng;
  color: string;
  /** Plays bots at full speed when nobody is using it. */
  bot: boolean;
  /** Turns slot-local task px into injected touches. */
  sink: Sink;
  onDone(who: Who): void;
}

export interface Slot {
  readonly spec: SlotSpec;
  readonly task: Task;
  readonly taskId: TaskId;
  readonly phase: SlotPhase;
  /** When the phase began, ms. */
  readonly phaseAt: number;
  /** Who is playing it now. */
  readonly who: Who;
  /** Last touch or finished task by a person or bot, ms. */
  readonly lastActive: number;
  readonly lastPerson: number;
  readonly player: Player;
  readonly made: number;
  /** Takes a touch that starts inside the task area. Coordinates are frame venue px. */
  down(id: number, x: number, y: number, synthetic: boolean, now: number): boolean;
  move(id: number, x: number, y: number): void;
  up(id: number): void;
  update(dt: number, now: number): void;
  /** Deal a new task now. `person` when someone asked for it. */
  deal(now: number, person?: boolean, id?: TaskId): void;
  /** Idle: forget the last person and deal a new task, so the ghost or bot takes over. */
  idle(now: number): void;
  /** Stop the bot or ghost and lift its fingers. */
  stopPlayer(): void;
  setBot(on: boolean): void;
  dispose(): void;
}

/** Bots pause this long between gestures; the ghost much longer, so it reads as a demonstration. */
const BOT_GAP: readonly [number, number] = [120, 320];
const GHOST_GAP: readonly [number, number] = [900, 1600];
/** The ghost rests this long after finishing a task before starting the next. */
const GHOST_REST_MS = 2600;
export const GHOST_PACE = 0.35;

export const createSlot = (d: SlotDeps): Slot => {
  const { spec, rng } = d;
  const t = spec.task;
  const owners = new Map<number, boolean>();
  let bot = d.bot;
  let def = dealNext(d.defs, null, rng);
  // Each dealt task gets its own stream, so the same task never comes back laid out the same.
  let dealt = 0;
  const make = (x: TaskDef) =>
    x.create({
      w: t.w,
      h: t.h,
      rng: rng.fork(`${x.id}:${dealt++}`),
      color: d.color,
      target: spec.target,
      coarse: spec.coarse,
    });
  let task = make(def);
  let phase: SlotPhase = "slide";
  let phaseAt = -SLIDE_MS;
  let lastPerson = Number.NEGATIVE_INFINITY;
  let lastActive = Number.NEGATIVE_INFINITY;
  let nextGesture = 0;
  let playing = false;
  let made = 0;
  let current: Who = bot ? "bot" : "ghost";
  const player = createPlayer(d.sink);

  const who = (now: number): Who =>
    now - lastPerson < PERSON_HOLD_MS ? "person" : bot ? "bot" : "ghost";

  const lift = () => {
    player.cancel();
    playing = false;
  };

  const deal = (now: number, id?: TaskId) => {
    lift();
    for (const p of owners.keys()) task.up(p);
    owners.clear();
    const forced = id ? taskById(id) : undefined;
    def = forced ?? dealNext(d.defs, def.id, rng);
    task = make(def);
    phase = "slide";
    phaseAt = now;
    nextGesture = now + SLIDE_MS + 200;
  };

  return {
    spec,
    get task() {
      return task;
    },
    get taskId() {
      return def.id;
    },
    get phase() {
      return phase;
    },
    get phaseAt() {
      return phaseAt;
    },
    get who() {
      return current;
    },
    get lastActive() {
      return lastActive;
    },
    get lastPerson() {
      return lastPerson;
    },
    get made() {
      return made;
    },
    player,
    down(id, x, y, synthetic, now) {
      if (x < t.x || x > t.x + t.w || y < t.y || y > t.y + t.h) return false;
      owners.set(id, synthetic);
      if (!synthetic) {
        lastPerson = now;
        lastActive = now;
        if (player.busy) lift();
      } else if (bot) {
        lastActive = now;
      }
      if (phase === "play") task.down(id, x - t.x, y - t.y);
      return true;
    },
    move(id, x, y) {
      if (!owners.has(id)) return;
      if (phase === "play") task.move(id, x - t.x, y - t.y);
    },
    up(id) {
      if (!owners.has(id)) return;
      owners.delete(id);
      task.up(id);
    },
    update(dt, now) {
      if (phase === "slide" && now - phaseAt >= SLIDE_MS) {
        phase = "play";
        phaseAt = now;
      }
      task.update(dt);
      if (phase === "play" && task.done) {
        const by = who(now);
        if (by !== "ghost") lastActive = now;
        lift();
        phase = "made";
        phaseAt = now;
        made++;
        d.onDone(by);
        nextGesture =
          now + MADE_MS + NEXT_GAP_MS + SLIDE_MS + (by === "ghost" ? GHOST_REST_MS : 300);
      }
      if (phase === "made" && now - phaseAt >= MADE_MS + NEXT_GAP_MS) {
        const keep = nextGesture;
        deal(now);
        nextGesture = Math.max(nextGesture, keep);
      }
      // Bots and the ghost.
      const by = who(now);
      current = by;
      if (by === "person") {
        if (player.busy) lift();
        return;
      }
      if (playing && !player.update(now)) {
        playing = false;
        const [a, b] = by === "bot" ? BOT_GAP : GHOST_GAP;
        nextGesture = now + rng.range(a, b);
      }
      if (!playing && phase === "play" && now >= nextGesture) {
        const g = task.bot(by === "bot" ? 1 : GHOST_PACE);
        if (g) {
          playing = true;
          player.start(g, now);
          player.update(now);
        } else {
          nextGesture = now + 80;
        }
      }
    },
    deal(now, person = false, id) {
      if (person) {
        lastPerson = now;
        lastActive = now;
      }
      deal(now, id);
    },
    idle(now) {
      lastPerson = Number.NEGATIVE_INFINITY;
      deal(now);
    },
    stopPlayer: lift,
    setBot(on) {
      bot = on;
    },
    dispose() {
      lift();
      owners.clear();
    },
  };
};
