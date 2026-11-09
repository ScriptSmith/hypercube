/**
 * Which race a touch frame is on and what phase it is in, from one of two sources:
 *
 * - `lone`: a solo frame, or a bank frame with no peers. Races follow the clock's cadence
 *   (race.ts), idle lanes fly attract bots, and rivals fill the field.
 * - `attract`: a bank with nobody joined. Idle lanes fly faded bots on the same cadence, so the
 *   screen above shows them racing.
 * - `bank`: someone has joined, so the frame follows the leader's heat (lobby.ts). Only joined
 *   lanes fly.
 */
import { COUNTDOWN_MS, type FlapConfig } from "./config";
import { type Heat, LOBBY_MS } from "./lobby";
import { courseLabel, raceAt } from "./race";

export type Play = "lone" | "attract" | "bank";
export type LocalPhase = "countdown" | "racing" | "results" | "lobby";

export interface Plan {
  play: Play;
  k: number;
  /** Course label (course.ts). */
  label: string;
  phase: LocalPhase;
  /** Clock ms the race starts and its time limit. */
  start: number;
  end: number;
  /** Clock ms the next race starts; during a bank race, the latest it can. */
  next: number;
  /** Clock ms the wait for `next` began, for timer rings. */
  from: number;
  /** The racers, once the leader has started the race. */
  racers: ReadonlySet<number> | null;
}

export interface PlanInput {
  /** Clock ms. */
  now: number;
  cfg: Pick<FlapConfig, "race">;
  solo: boolean;
  lone: boolean;
  heat: Heat | null;
  /** A lane on this frame has joined. */
  joined: boolean;
  /** The race this frame is on, kept while it waits for the leader to open a lobby. */
  current: { k: number; label: string } | null;
}

export const bankLabel = (k: number): string => `race-${k}`;

export const planFor = (i: PlanInput): Plan => {
  const raceMs = i.cfg.race * 1000;
  const h = i.heat;
  if (i.lone || !h || h.phase === "attract") {
    const r = raceAt(i.now, i.cfg);
    const cadence: Plan = {
      play: i.lone ? "lone" : "attract",
      k: r.k,
      label: courseLabel(r, i.solo),
      phase: r.phase,
      start: r.start,
      end: r.end,
      next: r.next,
      from: r.phase === "countdown" ? r.at : r.start,
      racers: null,
    };
    if (i.lone || !i.joined) return cadence;
    // Joined here before the leader has opened its lobby: the bots leave at once.
    const start = i.now + LOBBY_MS + COUNTDOWN_MS;
    return {
      play: "bank",
      k: i.current?.k ?? cadence.k,
      label: i.current?.label ?? cadence.label,
      phase: "lobby",
      start,
      end: start + raceMs,
      next: start,
      from: i.now,
      racers: null,
    };
  }
  const base = { play: "bank" as const, k: h.k, label: bankLabel(h.k) };
  switch (h.phase) {
    case "lobby": {
      const start = h.until + COUNTDOWN_MS;
      return {
        ...base,
        phase: "lobby",
        start,
        end: start + raceMs,
        next: start,
        from: h.opened,
        racers: null,
      };
    }
    case "countdown":
      return {
        ...base,
        // The leader's word that racing has begun follows; the clock says so first.
        phase: i.now < h.until ? "countdown" : "racing",
        start: h.until,
        end: h.until + raceMs,
        next: h.until,
        from: h.since,
        racers: null,
      };
    case "racing":
      return {
        ...base,
        phase: i.now < h.until ? "racing" : "results",
        start: h.since,
        end: h.until,
        next: h.until + LOBBY_MS + COUNTDOWN_MS,
        from: h.since,
        racers: new Set(h.lanes),
      };
  }
};
