/**
 * A touch frame's stations: the platform stations (no calibration: the pads are in everyone's
 * reach), their turn or direction pads, and the bots that tests seat with `bots=`. Seated means ready or
 * playing. Someone who presses Start while a round is under way is moved to playing at once, so
 * the long play timeout keeps their seat while they wait for the next round.
 */
import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { AppContext, Station, StationSet } from "../../core/types";
import { PLAY_TIMEOUT_MS } from "./config";
import type { FrameLayout } from "./layout";
import type { SeatKind } from "./match";
import { createPads, type Pads } from "./pads";

/** Test bots wait this long after their station empties before taking it again. */
export const TEST_RECLAIM_MS = 8000;
/** ...and this long after the page starts, so the first round has them. */
const FIRST_CLAIM_MS = 200;

export interface Seating {
  readonly list: readonly Station[];
  readonly pads: Pads;
  seat(j: number): SeatKind | null;
  dir(j: number): number;
  /** Direction pads: the next press not yet taken, or -1 (see Pads). */
  press(j: number): number;
  /**
   * Press a seated bot's pads for `dir`; returns the steering the pads now give. With direction
   * pads `dir` is the direction to press (-1 for none) and the press comes back from `press`.
   */
  drive(j: number, dir: number): number;
  startReady(): void;
  /** Test bots take their stations. `local` is performance.now(). */
  tick(local: number): void;
  endAll(): void;
  on(event: "ready" | "start" | "end", cb: (j: number) => void): () => void;
  dispose(): void;
}

export interface SeatingOptions {
  ctx: AppContext;
  layout: FrameLayout;
  /** Palette index of each station's colour. */
  colors: readonly number[];
  /** True while a round is under way, so a new player is started at once and waits. */
  midRound(): boolean;
  testBots: number;
}

export const createSeating = (opts: SeatingOptions): Seating => {
  const { ctx, layout } = opts;
  const u = ctx.frame.unit;
  const players = ctx.ui.palette.players;
  const set: StationSet = ctx.stations.define(
    layout.stations.map((s, j) => ({
      id: `tangle-${j}`,
      rect: {
        x: s.rect.x * u,
        y: s.rect.y * u,
        width: s.rect.width * u,
        height: s.rect.height * u,
      },
      calibrate: false,
      color: players[(opts.colors[j] ?? j) % players.length],
      resetCorner: s.resetCorner,
      playTimeout: PLAY_TIMEOUT_MS,
    })),
  );
  const list = set.list;
  const index = new Map(list.map((s, j) => [s, j]));
  const pads = createPads({
    input: ctx.input,
    stations: () => layout.stations,
    unit: () => ctx.frame.unit,
    live: (j) => list[j]?.state === "playing",
  });
  const hand: BotHand = createBotHand(ctx.input);
  const touches: (BotTouch | null)[] = list.map(() => null);
  const pressed = new Int8Array(list.length);
  const idleSince = new Float64Array(list.length).fill(-Infinity);
  const test = new Uint8Array(list.length);
  const started = performance.now();
  const listeners = {
    ready: new Set<(j: number) => void>(),
    start: new Set<(j: number) => void>(),
    end: new Set<(j: number) => void>(),
  };

  const emit = (event: keyof typeof listeners, s: Station) => {
    const j = index.get(s);
    if (j === undefined) return;
    for (const cb of listeners[event]) cb(j);
  };

  const release = (j: number) => {
    touches[j]?.up();
    touches[j] = null;
    pressed[j] = 0;
  };

  const offs = [
    set.on("ready", (s) => {
      if (opts.midRound()) set.startReady();
      emit("ready", s);
    }),
    set.on("start", (s) => emit("start", s)),
    set.on("end", (s) => {
      const j = index.get(s);
      if (j !== undefined) {
        release(j);
        test[j] = 0;
        idleSince[j] = performance.now();
      }
      emit("end", s);
    }),
  ];

  const seat = (j: number): SeatKind | null => {
    const s = list[j];
    if (!s || (s.state !== "ready" && s.state !== "playing")) return null;
    return s.bot ? "bot" : "human";
  };

  return {
    list,
    pads,
    seat,
    dir: (j) => pads.dir(j),
    press: (j) => pads.take(j),

    drive(j, dir) {
      const s = list[j];
      const st = layout.stations[j];
      if (!s || !st || s.state !== "playing" || !s.bot) {
        release(j);
        return 0;
      }
      if (st.kind === "aim") {
        // A tap on each new direction; the finger rests on the pad until the next one.
        if (dir >= 0 && dir < st.pads.length && (pressed[j] !== dir || !touches[j]?.active)) {
          release(j);
          const pad = st.pads[dir]!;
          touches[j] = hand.press((pad.x + pad.width / 2) * u, (pad.y + pad.height / 2) * u);
          pressed[j] = dir;
        }
        return 0;
      }
      if (pressed[j] !== dir || (dir !== 0 && !touches[j]?.active)) {
        release(j);
        if (dir !== 0) {
          const pad = st.pads[dir < 0 ? 0 : 1]!;
          touches[j] = hand.press((pad.x + pad.width / 2) * u, (pad.y + pad.height / 2) * u);
        }
        pressed[j] = dir;
      }
      return pads.dir(j);
    },

    startReady: () => set.startReady(),

    tick(local) {
      if (opts.testBots <= 0 || local - started < FIRST_CLAIM_MS) return;
      let have = 0;
      for (let j = 0; j < list.length; j++) if (test[j] && seat(j) === "bot") have++;
      // From the right, leaving the left stations for people.
      for (let j = list.length - 1; j >= 0 && have < opts.testBots; j--) {
        const s = list[j]!;
        if (s.state !== "idle" || local - idleSince[j]! < TEST_RECLAIM_MS) continue;
        test[j] = 1;
        s.claimForBot();
        have++;
      }
    },

    endAll() {
      for (const s of list) if (s.state !== "idle") s.end();
    },

    on(event, cb) {
      listeners[event].add(cb);
      return () => listeners[event].delete(cb);
    },

    dispose() {
      for (const off of offs) off();
      hand.dispose();
      pads.dispose();
      set.dispose();
      for (const l of Object.values(listeners)) l.clear();
    },
  };
};
