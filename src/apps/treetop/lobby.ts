/**
 * Races on a bank wait for players. The leader (the screen, else the lowest-`pos` touch frame)
 * runs this machine and announces each phase with its times on the shared clock:
 *
 *   attract -> lobby -> countdown -> racing -> lobby -> countdown -> ... -> attract
 *
 * - attract: nobody has joined. Lanes fly faded bots on the clock's cadence (race.ts).
 * - lobby: the first lane to join opens it for LOBBY_MS, and each later joiner adds
 *   LOBBY_EXTRA_MS, up to LOBBY_MAX_MS from when it opened. A lobby that ends with nobody in it
 *   goes back to attract.
 * - countdown: a new race number, so every frame builds the same new course from it.
 * - racing: only the lanes joined when the countdown ends. It ends at the time limit, or as soon
 *   as every racer has finished, is out or has left. The next lobby opens at once with everyone
 *   still joined, and the results show while it runs.
 */
import { COUNTDOWN_MS } from "./config";

export type HeatPhase = "attract" | "lobby" | "countdown" | "racing";
export const HEAT_PHASES: readonly HeatPhase[] = ["attract", "lobby", "countdown", "racing"];

export const LOBBY_MS = 6000;
export const LOBBY_EXTRA_MS = 3000;
export const LOBBY_MAX_MS = 12_000;

export interface Heat {
  /** The race counting down or racing, or the one whose results show in a lobby. */
  k: number;
  phase: HeatPhase;
  /** Clock ms when the phase began. */
  since: number;
  /** Clock ms when it ends: the lobby closing, the race starting, or the race's time limit. */
  until: number;
  /** Clock ms the lobby opened. */
  opened: number;
  /** Sorted lane ids: joined so far in a lobby, joined now in a countdown, racing in a race. */
  lanes: number[];
}

export interface HeatInput {
  /** Clock ms. */
  now: number;
  /** Lanes joined across the bank. */
  joined: ReadonlySet<number>;
  /** Every one of `lanes` has finished, is out or has left. */
  done(lanes: readonly number[]): boolean;
  raceMs: number;
  /** The attract race on the clock's cadence, whose number a lobby opened from attract keeps. */
  attractK: number;
}

export const attractHeat = (k: number, at: number): Heat => {
  const now = Math.round(at);
  return { k, phase: "attract", since: now, until: now, opened: now, lanes: [] };
};

/** Race numbers only go up, and a new leader's can't repeat an earlier leader's. */
export const nextRaceNumber = (k: number, now: number): number =>
  Math.max(k + 1, Math.floor(now / 1000));

const sorted = (lanes: Iterable<number>): number[] => [...lanes].sort((a, b) => a - b);

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** A lobby opened at `now` by `n` lanes at once: the first opens it, the rest extend it. */
const openLobby = (k: number, now: number, lanes: number[]): Heat => ({
  k,
  phase: "lobby",
  since: now,
  opened: now,
  until: now + Math.min(LOBBY_MAX_MS, LOBBY_MS + LOBBY_EXTRA_MS * Math.max(0, lanes.length - 1)),
  lanes,
});

/** The heat after `input.now`. Returns `h` itself when nothing changed. */
export const stepHeat = (h: Heat, input: HeatInput): Heat => {
  const { joined } = input;
  // Whole ms, as the heat goes out on the wire, so the leader and its followers agree exactly.
  const now = Math.round(input.now);
  switch (h.phase) {
    case "attract":
      return joined.size > 0 ? openLobby(input.attractK, now, sorted(joined)) : h;
    case "lobby": {
      let next = h;
      const fresh = [...joined].filter((l) => !h.lanes.includes(l));
      if (fresh.length > 0) {
        if (h.lanes.length === 0) {
          // Results of a race nobody stayed for: the first joiner opens a full lobby.
          next = openLobby(h.k, now, sorted(fresh));
        } else {
          next = {
            ...h,
            until: Math.min(h.opened + LOBBY_MAX_MS, h.until + LOBBY_EXTRA_MS * fresh.length),
            lanes: sorted([...h.lanes, ...fresh]),
          };
        }
      }
      if (now < next.until) return next;
      if (joined.size === 0) return attractHeat(h.k, now);
      return {
        k: nextRaceNumber(h.k, now),
        phase: "countdown",
        since: now,
        until: now + COUNTDOWN_MS,
        opened: h.opened,
        lanes: sorted(joined),
      };
    }
    case "countdown": {
      const lanes = sorted(joined);
      if (now >= h.until) {
        if (lanes.length === 0) return attractHeat(h.k, now);
        return { ...h, phase: "racing", since: h.until, until: h.until + input.raceMs, lanes };
      }
      return same(lanes, h.lanes) ? h : { ...h, lanes };
    }
    case "racing":
      if (now < h.until && !input.done(h.lanes)) return h;
      return { ...openLobby(h.k, now, sorted(joined)), until: now + LOBBY_MS };
  }
};

/** Phases in the order they happen to one race number, for picking the newest of two views. */
export const heatOrder = (h: Heat): number => {
  const step = h.phase === "countdown" ? 1 : h.phase === "racing" ? 2 : h.phase === "lobby" ? 3 : 0;
  return h.k * 4 + step;
};
