/**
 * The wall's arcade without any drawing: a machine per cabinet as on the sphere, the player who
 * has its controls, and the hatch its wins drop into.
 *
 * Nobody at a cabinet: it plays itself (`auto`, the sphere's bot). A press on its controls takes
 * over at once between rounds or while the claw is being aimed (with the full time to aim), and
 * otherwise at the next round. After its player's round the machine waits for them; once they
 * have left it alone for a while it plays itself again. Bots (`bot`) press the controls like
 * people, but never take a cabinet from a person and never count where a person's go would.
 */
import type { Rng } from "../../core/types";
import { MIXES, RATES, type Luck } from "./arcade";
import { type Bot, createBot } from "./bot";
import { DESIGNS } from "./designs";
import { createMachine, type Machine, STEP } from "./machine";
import { createTray, type Tray } from "./tray";
import type { Button, WallLayout } from "./walllayout";

export type Player = "auto" | "bot" | "person";
export type Hand = Exclude<Player, "auto">;

/** Seconds to aim on the wall before the claw drops by itself. */
export const WALL_PLAY_S = 15;
/** Seconds a cabinet waits for its player to come back before it plays itself again. */
export const AWAY_S = 8;
/** Seconds bots stay off a cabinet after a person touched it. */
export const BOT_YIELD_S = 20;
/** A press on the drop button this soon after taking over doesn't drop the claw. */
const CLAIM_S = 0.25;

export interface Seat {
  readonly index: number;
  readonly machine: Machine;
  readonly tray: Tray;
  /** Who has the controls now. */
  readonly player: Player;
  /** Who has the next round, while the claw is busy with this one. */
  readonly queued: Hand | null;
  /** Who played the current (or the last) round. */
  readonly roundPlayer: Player;
  /** Between rounds, waiting for its player to come back. */
  readonly waiting: boolean;
  /** Arcade seconds of the last press on its controls, the last person's touch, and the last touch elsewhere on it. */
  readonly lastTouch: number;
  readonly lastPerson: number;
  readonly hintAt: number;
  /** When the current player took the controls. */
  readonly claimedAt: number;
  /** Which arrow its player holds: -1, 0 or 1. */
  readonly stick: -1 | 0 | 1;
  readonly personRounds: number;
  readonly personWins: number;
  readonly botRounds: number;
  readonly botWins: number;
}

export interface WallArcade {
  readonly layout: WallLayout;
  /** The same cabinets, drawn at another size. */
  relayout(l: WallLayout): void;
  /** Whether a finger is on button `button` of cabinet `cabinet` now. */
  pressed(cabinet: number, button: Button): boolean;
  readonly seats: readonly Seat[];
  readonly machines: readonly Machine[];
  readonly time: number;
  readonly wins: number;
  step(): void;
  /** A finger `id` pressed `button` on cabinet `cabinet`. */
  down(id: number, cabinet: number, button: Button, hand: Hand): void;
  /** Finger `id` slid onto another button, or off every button (null). */
  slide(id: number, to: { cabinet: number; button: Button } | null): void;
  up(id: number): void;
  /** A touch on cabinet `cabinet` away from its buttons. */
  poke(cabinet: number, hand: Hand): void;
  /** Every cabinet back to playing itself. */
  reset(): void;
  /** Drop a prize from cabinet `i`'s pile into its chute, for tests and e2e. */
  forceWin(i: number): boolean;
  dispose(): void;
}

export interface WallArcadeOptions {
  layout: WallLayout;
  rng: Rng;
  luck: Luck;
  start?: number;
}

interface Hold {
  cabinet: number;
  button: Button;
  hand: Hand;
  at: number;
}

interface SeatState {
  index: number;
  machine: Machine;
  tray: Tray;
  auto: Bot;
  player: Player;
  queued: Hand | null;
  roundPlayer: Player;
  round: number;
  phase: Machine["phase"];
  waiting: boolean;
  awaySince: number;
  lastTouch: number;
  lastPerson: number;
  hintAt: number;
  claimedAt: number;
  stick: -1 | 0 | 1;
  personRounds: number;
  personWins: number;
  botRounds: number;
  botWins: number;
}

const NEVER = Number.NEGATIVE_INFINITY;

export const createWallArcade = (o: WallArcadeOptions): WallArcade => {
  const { rng } = o;
  let layout = o.layout;
  const rate = RATES[o.luck];
  const cycle = 22;
  const n = layout.cabinets.length;
  const machines = layout.cabinets.map((c, i) =>
    createMachine({
      spec: { ...layout.play, chute: c.chute },
      rng: rng.fork(`machine-${i}`),
      rate,
      mix: MIXES[i % MIXES.length]!,
      delay: 1 + (i * cycle) / n + rng.range(0, 2),
      playLimit: WALL_PLAY_S,
    }),
  );
  for (const m of machines) m.fill();
  const seats: SeatState[] = machines.map((machine, i) => ({
    index: i,
    machine,
    tray: createTray(rng.fork(`tray-${i}`)),
    auto: createBot(machine, rng.fork(`bot-${i}`)),
    player: "auto",
    queued: null,
    roundPlayer: "auto",
    round: machine.round,
    phase: machine.phase,
    waiting: false,
    awaySince: NEVER,
    lastTouch: NEVER,
    lastPerson: NEVER,
    hintAt: NEVER,
    claimedAt: NEVER,
    stick: 0,
    personRounds: 0,
    personWins: 0,
    botRounds: 0,
    botWins: 0,
  }));
  seats.forEach((s, i) => {
    const r = rng.fork(`hatch-${i}`);
    const mix = MIXES[i % MIXES.length]!;
    s.tray.prefill(
      Array.from({ length: 1 + r.int(2) }, () => {
        const design = r.pick(mix);
        return { design, colour: r.int(DESIGNS[design].colourways.length) };
      }),
      o.start ?? 0,
    );
  });
  const holds = new Map<number, Hold>();
  let t = o.start ?? 0;
  let wins = 0;

  const setPlayer = (s: SeatState, p: Player) => {
    s.player = p;
    s.machine.hold = p !== "auto";
    if (p !== "auto") s.claimedAt = t;
  };

  /** `hand` takes cabinet `s`: now if it can, else at the next round. */
  const claim = (s: SeatState, hand: Hand) => {
    const m = s.machine;
    if (m.phase === "idle" || m.phase === "play") {
      m.start();
      setPlayer(s, hand);
      s.queued = null;
      s.waiting = false;
      // A round already under way changes hands: whoever finishes it played it.
      if (m.phase === "play") {
        s.roundPlayer = hand;
        if (hand === "person") s.personRounds++;
        else s.botRounds++;
      }
    } else if (s.queued !== "person") {
      s.queued = hand;
    }
  };

  const allowed = (s: SeatState, hand: Hand) =>
    hand === "person" ||
    (s.player !== "person" && s.queued !== "person" && t - s.lastPerson >= BOT_YIELD_S);

  const press = (s: SeatState, button: Button, hand: Hand) => {
    if (hand === "person") s.lastPerson = t;
    if (!allowed(s, hand)) return;
    s.lastTouch = t;
    const m = s.machine;
    if (s.player !== hand) {
      claim(s, hand);
      return;
    }
    s.waiting = false;
    if (m.phase === "idle") m.start();
    else if (button === "drop" && m.phase === "play" && t - s.claimedAt >= CLAIM_S) {
      m.controls.drop = true;
    }
  };

  /** The arrow the current player holds, the latest pressed winning. */
  const stickOf = (s: SeatState): -1 | 0 | 1 => {
    let best: Hold | null = null;
    for (const h of holds.values()) {
      if (h.cabinet !== s.index || h.hand !== s.player || h.button === "drop") continue;
      if (!best || h.at > best.at) best = h;
    }
    return best ? (best.button === "left" ? -1 : 1) : 0;
  };

  const stepSeat = (s: SeatState) => {
    const m = s.machine;
    const playing = s.player !== "auto";
    if (playing) {
      // Holding an arrow counts as being there.
      for (const h of holds.values()) {
        if (h.cabinet === s.index && h.hand === s.player) s.lastTouch = t;
      }
    }
    if (!playing) s.auto.update(STEP);
    else if (m.phase === "play") {
      s.stick = stickOf(s);
      m.controls.stick = s.stick;
    }
    if (!playing) s.stick = 0;
    for (const w of m.step(STEP)) {
      wins++;
      s.tray.add(w.prize, t);
      if (w.round === m.round && w.round >= 0) {
        if (s.roundPlayer === "person") s.personWins++;
        else if (s.roundPlayer === "bot") s.botWins++;
      }
    }
    if (m.round !== s.round) {
      s.round = m.round;
      s.roundPlayer = s.player;
      if (s.player === "person") s.personRounds++;
      else if (s.player === "bot") s.botRounds++;
    }
    if (m.phase === "idle" && s.phase !== "idle") {
      // A round ended.
      if (s.queued && t - s.lastTouch <= AWAY_S) {
        setPlayer(s, s.queued);
        s.queued = null;
        m.start();
      } else if (s.player !== "auto") {
        s.waiting = true;
        s.awaySince = t;
      }
      s.queued = null;
    }
    s.phase = m.phase;
    if (s.waiting && m.phase !== "idle") s.waiting = false;
    if (s.player !== "auto" && m.phase === "idle" && !s.waiting) {
      s.waiting = true;
      s.awaySince = t;
    }
    if (s.waiting && t - Math.max(s.awaySince, s.lastTouch) > AWAY_S) {
      s.waiting = false;
      setPlayer(s, "auto");
    }
    s.tray.step(t);
  };

  const view = (s: SeatState): Seat => s;

  return {
    get layout() {
      return layout;
    },
    relayout(l) {
      layout = l;
    },
    pressed(cabinet, button) {
      for (const h of holds.values()) if (h.cabinet === cabinet && h.button === button) return true;
      return false;
    },
    seats: seats.map(view),
    machines,
    get time() {
      return t;
    },
    get wins() {
      return wins;
    },
    step() {
      t += STEP;
      for (const s of seats) stepSeat(s);
    },
    down(id, cabinet, button, hand) {
      const s = seats[cabinet];
      if (!s) return;
      holds.set(id, { cabinet, button, hand, at: t });
      press(s, button, hand);
    },
    slide(id, to) {
      const h = holds.get(id);
      if (!h) return;
      if (!to) {
        holds.delete(id);
        return;
      }
      // Sliding between the arrows of one cabinet switches them; elsewhere it lets go.
      if (to.cabinet !== h.cabinet || to.button === "drop" || h.button === "drop") {
        if (to.cabinet !== h.cabinet || to.button !== h.button) holds.delete(id);
        return;
      }
      if (to.button !== h.button) {
        h.button = to.button;
        h.at = t;
      }
    },
    up(id) {
      holds.delete(id);
    },
    poke(cabinet, hand) {
      const s = seats[cabinet];
      if (!s) return;
      s.hintAt = t;
      if (hand === "person") s.lastPerson = t;
      if (s.player === hand) s.lastTouch = t;
    },
    reset() {
      holds.clear();
      for (const s of seats) {
        s.queued = null;
        s.waiting = false;
        s.lastPerson = NEVER;
        s.hintAt = NEVER;
        // Whatever this round wins now is nobody's.
        s.roundPlayer = "auto";
        setPlayer(s, "auto");
      }
    },
    forceWin(i) {
      const m = machines[i];
      if (!m) return false;
      const w = m.world;
      const p = w.prizes.find((q) => q.body.getPosition().y < w.spec.height);
      if (!p) return false;
      p.body.setTransform({ x: w.hole.centre, y: 1.05 }, 0);
      p.body.setLinearVelocity({ x: 0, y: 0 });
      p.body.setAngularVelocity(0);
      p.body.setAwake(true);
      return true;
    },
    dispose() {
      holds.clear();
      for (const m of machines) m.dispose();
    },
  };
};
