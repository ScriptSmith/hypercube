/**
 * The screen's share of the races, without the drawing: it leads the bank's heat while it is
 * present (heats.ts), keeps the board of every lane below it, and follows the same plan as the
 * touch frames (plan.ts). It flies nothing of its own.
 */
import type { Channel } from "../../core/types";
import { type Board, createBoard } from "./board";
import type { FlapConfig } from "./config";
import { createHeats, type Heats } from "./heats";
import { type LocalPhase, type Play, type Plan, planFor } from "./plan";
import { raceAt } from "./race";
import type { Fly } from "./wire";

export interface HostDeps {
  net: Channel;
  /** Clock ms. */
  now(): number;
  /** Local monotonic ms. */
  local(): number;
  cfg: Pick<FlapConfig, "race">;
  /** Every `fly` that arrives. */
  onFly?(fly: Fly, from: string): void;
  /** A new race number (and course). */
  onRace?(plan: Plan): void;
  /** Attract gave way to a bank race, or the other way round. */
  onPlay?(play: Play, was: Play): void;
}

export interface Host {
  readonly board: Board;
  readonly heats: Heats;
  readonly plan: Plan;
  readonly phase: LocalPhase;
  /** Race ms now. */
  raceT(): number;
  tick(): void;
  dispose(): void;
}

export const createHost = (deps: HostDeps): Host => {
  const { net, cfg } = deps;
  const board = createBoard({
    net,
    local: deps.local,
    onFly(fly, from) {
      if (fly.heat) heats.offer(fly.heat);
      deps.onFly?.(fly, from);
    },
  });
  const heats = createHeats({
    net,
    now: deps.now,
    local: deps.local,
    raceMs: cfg.race * 1000,
    joined: () => board.joined(),
    done: (ids) => board.done(ids),
    attractK: () => raceAt(deps.now(), cfg).k,
    racing: (rk) =>
      board.k === rk
        ? [...board.lanes.values()].filter((l) => l.ctrl !== "attract").map((l) => l.id)
        : [],
    onEnd: (h) => board.decide(h.lanes),
  });
  const planNow = () =>
    planFor({
      now: deps.now(),
      cfg,
      solo: false,
      lone: false,
      heat: heats.heat,
      joined: false,
      current: null,
    });
  let plan = planNow();
  let phase: LocalPhase = plan.phase;
  let k = -1;

  return {
    board,
    heats,
    get plan() {
      return plan;
    },
    get phase() {
      return phase;
    },
    raceT: () => deps.now() - plan.start,
    tick() {
      heats.tick();
      const was = plan.play;
      plan = planNow();
      if (plan.play !== was) deps.onPlay?.(plan.play, was);
      if (plan.k !== k) {
        k = plan.k;
        board.race(k);
        deps.onRace?.(plan);
      }
      const bank = plan.play === "bank";
      // A cadence race ends early once nobody is flying.
      phase = !bank && plan.phase === "racing" && board.ended ? "results" : plan.phase;
      board.tick(phase, !bank);
    },
    dispose() {
      heats.dispose();
      board.dispose();
    },
  };
};
