/**
 * Rounds and the lobby, the same for a local arena (its own stations) and a bank's screen
 * (stations on the panels below). The host says who holds each slot; the match does the rest.
 *
 *   lobby -> countdown -> play -> over -> lobby ...
 *
 * The first person to press Start opens a LOBBY_MS lobby; each later joiner adds
 * LOBBY_EXTRA_MS, up to LOBBY_MAX_MS from when it opened. Then a countdown, then play. With
 * nobody seated the lobby is a short pause and the round is an attract round: bots only, slow,
 * and cut short the moment someone joins. Players stay seated from round to round until their
 * station ends, and bots top each round up to `fill` lines.
 */
import type { Rng } from "../../core/types";
import { type Arena, type Line, placings, type Start } from "./arena";
import { type Brain, createBrain, think, thinkGrid } from "./bot";
import {
  BOT_LOBBY_MS,
  type Config,
  COUNTDOWN_MS,
  INTERRUPT_MS,
  LOBBY_EXTRA_MS,
  LOBBY_MAX_MS,
  LOBBY_MS,
  MAX_LINES,
  MIN_LINES,
  OVER_MS,
  SPEED_FACTOR,
} from "./config";

export type Phase = "lobby" | "countdown" | "play" | "over";

export interface Lobby {
  opened: number;
  until: number;
  joiners: number;
}

export const openLobby = (now: number): Lobby => ({
  opened: now,
  until: now + LOBBY_MS,
  joiners: 0,
});

/** Someone else joined: a little longer, but never more than LOBBY_MAX_MS in all. */
export const joinLobby = (l: Lobby): Lobby => ({
  opened: l.opened,
  joiners: l.joiners + 1,
  until: Math.min(l.opened + LOBBY_MAX_MS, l.until + LOBBY_EXTRA_MS),
});

/** Once every person in a round is out, the bots get this long to settle it. */
export const SETTLE_MS = 3000;
/**
 * A player whose station drops out briefly (a network hiccup on a bank) takes their line back
 * from the bot if they return within this long.
 */
export const RECLAIM_MS = 6000;
/** A round with nobody left in it ends after this long. */
export const DESERTED_MS = 2000;

export interface Slot {
  /** Station index on a local frame, `pos * 4 + station` on a bank screen. */
  key: number;
  start: Start;
  /** Palette index of the line's colour. */
  color: number;
  /** Head style: 0 solid, 1 hollow, 2 ringed. Lines past the eighth share colours. */
  style: number;
  /** A start for bots only, with no station under it. */
  virtual: boolean;
}

export type SeatKind = "human" | "bot";

export interface MatchHost {
  /** Who holds a slot's station: a person, a bot taking a person's place (tests), or nobody. */
  seat(key: number): SeatKind | null;
  /** A person's steering: -1, 0 or 1. */
  dir(key: number): number;
  /**
   * Grid: the next direction pressed at a slot's station (0 right, 1 down, 2 left, 3 up) that
   * the match has not had yet, or -1. Each press is handed over once.
   */
  press?(key: number): number;
  /**
   * Work a seated bot's controls; returns the steering they produce. On the grid `dir` is the
   * direction to press, or -1 for none, and the presses come back through `press`.
   */
  drive?(key: number, dir: number): number;
  /** After every phase change. */
  changed?(): void;
}

export interface Runner {
  key: number;
  slot: Slot;
  line: Line;
  /** A person, a seated bot (tests) or a bot filling in. People who leave become bots. */
  mode: "human" | "seated" | "bot";
  /** Who held the line when the round started. */
  readonly owner: "human" | "seated" | "bot";
  /** Clock ms when the owner left, for taking the line back. */
  left: number;
  readonly brain: Brain;
}

export interface Match {
  readonly phase: Phase;
  /** Clock ms when the phase began, and when it ends (the time limit while playing). */
  readonly since: number;
  readonly until: number;
  /** The round being played or just played had nobody in it. */
  readonly attract: boolean;
  /** Rounds started, attract ones included. */
  readonly round: number;
  /** Rounds with people in them that finished. */
  readonly played: number;
  readonly runners: readonly Runner[];
  readonly arena: Arena;
  readonly slots: readonly Slot[];
  /** Each runner's placing once a round is over; null while playing or after a cut-short round. */
  readonly places: readonly number[] | null;
  /** Runner indexes in the order they went out. */
  readonly outs: readonly number[];
  /** People seated now. */
  readonly humans: number;
  /** Bots seated now (tests). */
  readonly seatedBots: number;
  /** Whether a slot is seated by a person waiting for the next round. */
  waiting(key: number): boolean;
  tick(now: number): void;
  /** Wipe the arena and go back to the lobby. */
  reset(now: number): void;
  /** Go straight to the countdown if people are waiting in the lobby. */
  hurry(now: number): void;
  /** Change the slots (a bank's shape changed); takes effect from the next round. */
  setSlots(slots: readonly Slot[]): void;
}

export interface MatchOptions {
  cfg: Config;
  arena: Arena;
  slots: readonly Slot[];
  rng: Rng;
  host: MatchHost;
  /** Clock ms now. */
  now: number;
  /** Delay before the first round. Default BOT_LOBBY_MS. */
  firstDelay?: number;
}

/** Arenas at least this big (in square units, a wall or a screen) get a busier attract round. */
const BIG_ARENA = 6_000_000;

/** Lines in a round with nobody seated, for an arena with `stations` station slots. */
export const attractLines = (stations: number, area = 0): number =>
  Math.min(8, Math.max(area >= BIG_ARENA ? 5 : 3, Math.ceil(stations * 0.6)));

/** How many lines a round needs. */
export const linesFor = (
  cfg: Config,
  humans: number,
  seated: number,
  stations: number,
  area = 0,
): number => {
  if (humans === 0) return Math.max(seated, attractLines(stations, area));
  return Math.max(seated, cfg.fill, cfg.variant === "trails" ? MIN_LINES : 1);
};

/**
 * Up to `n` slots for bots: free stations first, each as far as possible from the lines
 * already placed, then the bot-only starts.
 */
export const pickBotSlots = (
  slots: readonly Slot[],
  used: ReadonlySet<number>,
  n: number,
): Slot[] => {
  const placed = slots.filter((s) => used.has(s.key));
  const out: Slot[] = [];
  for (const virtual of [false, true]) {
    const free = slots.filter((s) => s.virtual === virtual && !used.has(s.key));
    while (out.length < n && free.length > 0) {
      let best = 0;
      let bestD = -1;
      free.forEach((s, i) => {
        let d = Infinity;
        for (const p of [...placed, ...out]) {
          d = Math.min(d, Math.hypot(p.start.x - s.start.x, p.start.y - s.start.y));
        }
        if (d > bestD + 1e-6) {
          bestD = d;
          best = i;
        }
      });
      out.push(free.splice(best, 1)[0]!);
    }
  }
  return out;
};

/** Presses taken from one station in one tick, at most. */
const PRESSES_PER_TICK = 4;

export const createMatch = (opts: MatchOptions): Match => {
  const { cfg, arena, rng, host } = opts;
  const onGrid = arena.variant === "grid";
  let slots = opts.slots;
  let pendingSlots: readonly Slot[] | null = null;
  let phase: Phase = "lobby";
  let since = opts.now;
  let until = opts.now + (opts.firstDelay ?? BOT_LOBBY_MS);
  let lobby: Lobby | null = null;
  let attract = true;
  let round = 0;
  let played = 0;
  let runners: Runner[] = [];
  let places: number[] | null = null;
  const outs: number[] = [];
  let humans = 0;
  let seatedBots = 0;
  let prevHumans = new Set<number>();
  let nowHumans = new Set<number>();
  /** Clock ms when the last person in this round went out. */
  let lastHumanOut = Infinity;
  /** Clock ms since when no person has held a line in this round. */
  let emptySince = Infinity;
  let lastNow = opts.now;

  arena.hooks.out = (line) => {
    // Snakes come back, so only trails have an order of going out.
    if (arena.variant !== "trails") return;
    if (outs.length < MAX_LINES) outs.push(line.id);
    const r = runners[line.id];
    if (r?.mode === "human" && !runners.some((o) => o.mode === "human" && o.line.alive)) {
      lastHumanOut = lastNow;
    }
  };

  const set = (next: Phase, now: number, end: number) => {
    phase = next;
    since = now;
    until = end;
    host.changed?.();
  };

  const toLobby = (now: number) => {
    if (pendingSlots) {
      slots = pendingSlots;
      pendingSlots = null;
    }
    arena.clear();
    runners = [];
    places = null;
    outs.length = 0;
    lobby = humans > 0 ? openLobby(now) : null;
    set("lobby", now, lobby ? lobby.until : now + BOT_LOBBY_MS);
  };

  const startRound = (now: number) => {
    if (pendingSlots) {
      slots = pendingSlots;
      pendingSlots = null;
    }
    const seated = slots.filter((s) => !s.virtual && host.seat(s.key) !== null);
    const stations = slots.filter((s) => !s.virtual).length;
    const area = arena.width * arena.height;
    const want = Math.min(
      slots.length,
      MAX_LINES,
      linesFor(cfg, humans, seated.length, stations, area),
    );
    const bots = pickBotSlots(slots, new Set(seated.map((s) => s.key)), want - seated.length);
    const chosen = [...seated, ...bots].sort((a, b) => a.key - b.key);
    attract = humans === 0;
    const factor = humans + seatedBots === 0 ? SPEED_FACTOR.slow : SPEED_FACTOR[cfg.speed];
    arena.start(
      chosen.map((s) => s.start),
      factor,
    );
    runners = chosen.map((slot, i) => {
      const seat = slot.virtual ? null : host.seat(slot.key);
      const mode = seat === "human" ? "human" : seat === "bot" ? "seated" : "bot";
      return {
        key: slot.key,
        slot,
        line: arena.lines[i]!,
        mode,
        owner: mode,
        left: -Infinity,
        brain: createBrain(),
      };
    });
    places = null;
    outs.length = 0;
    lastHumanOut = Infinity;
    emptySince = Infinity;
    round++;
    set("play", now, now + cfg.roundMs);
  };

  const endRound = (now: number, cut: boolean) => {
    places = cut ? null : placings(arena.lines, arena.variant);
    if (!cut && !attract) played++;
    for (const r of runners) if (r.mode === "seated") host.drive?.(r.key, onGrid ? -1 : 0);
    set("over", now, now + (cut ? INTERRUPT_MS : OVER_MS));
  };

  /** Hand a station's presses to its line (dropped while the line is out). */
  const feed = (key: number, line: Line | null) => {
    if (!host.press) return;
    for (let k = 0; k < PRESSES_PER_TICK; k++) {
      const d = host.press(key);
      if (d < 0) return;
      if (line) arena.press(line, d);
    }
  };

  const steerGrid = (r: Runner) => {
    const l = r.line;
    if (r.mode === "human") {
      feed(r.key, l);
      return;
    }
    if (r.mode === "seated" && host.drive) {
      host.drive(r.key, l.alive ? thinkGrid(arena, l, r.brain, rng) : -1);
      feed(r.key, l);
      return;
    }
    if (!l.alive) return;
    const want = thinkGrid(arena, l, r.brain, rng);
    if (want >= 0) arena.press(l, want);
  };

  const steer = (now: number) => {
    for (const r of runners) {
      const seat = r.slot.virtual ? null : host.seat(r.key);
      // Someone who leaves mid-round hands their line to a bot, unless they're soon back.
      if ((r.mode === "human" && seat !== "human") || (r.mode === "seated" && seat !== "bot")) {
        r.mode = "bot";
        r.left = now;
      } else if (r.mode === "bot" && r.owner !== "bot" && now - r.left < RECLAIM_MS) {
        if (seat === (r.owner === "human" ? "human" : "bot")) r.mode = r.owner;
      }
      if (onGrid) {
        steerGrid(r);
        continue;
      }
      if (!r.line.alive) {
        if (r.mode === "seated") host.drive?.(r.key, 0);
        continue;
      }
      if (r.mode === "human") {
        r.line.dir = host.dir(r.key);
        continue;
      }
      const want = think(arena, r.line, r.brain, rng);
      r.line.dir = r.mode === "seated" && host.drive ? host.drive(r.key, want) : want;
    }
  };

  /** Presses made where no line of theirs is running are dropped, so none turn up late. */
  const drop = () => {
    if (!onGrid || !host.press) return;
    for (const s of slots) {
      if (s.virtual) continue;
      let steering = false;
      if (phase === "play") {
        for (const r of runners) if (r.key === s.key && r.mode !== "bot") steering = true;
      }
      if (!steering) feed(s.key, null);
    }
  };

  const scan = () => {
    const next = prevHumans;
    next.clear();
    let bots = 0;
    for (const s of slots) {
      if (s.virtual) continue;
      const seat = host.seat(s.key);
      if (seat === "human") next.add(s.key);
      else if (seat === "bot") bots++;
    }
    prevHumans = nowHumans;
    nowHumans = next;
    humans = next.size;
    seatedBots = bots;
  };

  const match: Match = {
    get phase() {
      return phase;
    },
    get since() {
      return since;
    },
    get until() {
      return until;
    },
    get attract() {
      return attract;
    },
    get round() {
      return round;
    },
    get played() {
      return played;
    },
    get runners() {
      return runners;
    },
    arena,
    get slots() {
      return slots;
    },
    get places() {
      return places;
    },
    outs,
    get humans() {
      return humans;
    },
    get seatedBots() {
      return seatedBots;
    },

    waiting(key) {
      if (!nowHumans.has(key) || (phase !== "play" && phase !== "over")) return false;
      return attract || !runners.some((r) => r.key === key && r.mode === "human");
    },

    tick(now) {
      lastNow = now;
      scan();
      let joined = 0;
      for (const k of nowHumans) if (!prevHumans.has(k)) joined++;
      switch (phase) {
        case "lobby":
          if (humans > 0) {
            if (!lobby) {
              lobby = openLobby(now);
              joined--;
            }
            for (; joined > 0; joined--) lobby = joinLobby(lobby);
            if (until !== lobby.until) {
              until = lobby.until;
              host.changed?.();
            }
            if (now >= until) set("countdown", now, now + COUNTDOWN_MS);
          } else {
            if (lobby) {
              lobby = null;
              set("lobby", now, now + BOT_LOBBY_MS);
            }
            if (now >= until) startRound(now);
          }
          break;
        case "countdown":
          if (humans === 0) {
            lobby = null;
            set("lobby", now, now + BOT_LOBBY_MS);
          } else if (now >= until) startRound(now);
          break;
        case "play": {
          if (attract && humans > 0) {
            endRound(now, true);
            break;
          }
          steer(now);
          arena.step();
          if (runners.some((r) => r.mode === "human")) emptySince = Infinity;
          else emptySince = Math.min(emptySince, now);
          const timeUp = arena.time * 1000 >= cfg.roundMs;
          const settled = !attract && now - lastHumanOut >= SETTLE_MS;
          const deserted = !attract && now - emptySince >= DESERTED_MS;
          if (arena.finished() || timeUp || settled || deserted) endRound(now, deserted);
          break;
        }
        case "over":
          if (now >= until) toLobby(now);
          break;
      }
      drop();
    },

    reset(now) {
      scan();
      lobby = null;
      attract = true;
      toLobby(now);
    },

    hurry(now) {
      scan();
      if (phase !== "lobby" || humans === 0) return;
      lobby = openLobby(now);
      set("countdown", now, now + COUNTDOWN_MS);
    },

    setSlots(next) {
      if (phase === "play" || phase === "over") pendingSlots = next;
      else slots = next;
    },
  };
  return match;
};
