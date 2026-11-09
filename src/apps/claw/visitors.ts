/**
 * Bots that play the wall like visitors, with synthetic touches on the buttons, so the controls
 * can be soaked and tested with nobody there. Each walks up to a cabinet that is playing itself,
 * presses an arrow to take it, plays a few rounds and leaves. It aims with the same player as
 * the self-playing machine (bot.ts), whose joystick it turns into presses on the arrows.
 *
 * Bots stay off any cabinet a person has touched lately, and leave one a person takes.
 */
import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import { type Bot, createBot } from "./bot";
import type { Controls, Machine } from "./machine";
import { STEP } from "./machine";
import { BOT_YIELD_S, type WallArcade } from "./wallarcade";
import type { Button } from "./walllayout";

export interface VisitorsOptions {
  input: Pick<Input, "inject">;
  arcade(): WallArcade;
  /** Stage px per venue px. */
  unit(): number;
  rng: Rng;
  count: number;
}

export interface VisitorView {
  cabinet: number | null;
  state: "away" | "play";
  rounds: number;
}

export interface Visitors {
  readonly list: readonly VisitorView[];
  update(): void;
  /** Everyone lets go and wanders off for a moment. */
  reset(): void;
  dispose(): void;
}

interface Visitor extends VisitorView {
  home: number;
  hand: BotHand;
  /** Arcade seconds when it next does something. */
  until: number;
  since: number;
  plan: number;
  counted: boolean;
  virtual: Controls;
  brain: Bot | null;
  arrow: BotTouch | null;
  arrowDir: -1 | 0 | 1;
  taps: { touch: BotTouch; until: number }[];
}

const MAX_TAPS = 4;

export const createVisitors = (o: VisitorsOptions): Visitors => {
  const { rng } = o;
  let brains = 0;
  const list: Visitor[] = Array.from({ length: Math.max(0, o.count) }, (_, i) => ({
    cabinet: null,
    state: "away" as const,
    rounds: 0,
    home: i,
    hand: createBotHand(o.input),
    until: rng.range(1, 4) + i * 2,
    since: 0,
    plan: 1,
    counted: false,
    virtual: { stick: 0, drop: false },
    brain: null,
    arrow: null,
    arrowDir: 0,
    taps: [],
  }));

  /** Somewhere on button `b` of cabinet `c`, stage px. */
  const spot = (c: number, b: Button) => {
    const cab = o.arcade().layout.cabinets[c]!;
    const p = cab.buttons[b];
    const u = o.unit();
    const a = rng.range(0, Math.PI * 2);
    const r = p.r * rng.range(0, 0.35);
    return { x: (p.x + r * Math.cos(a)) * u, y: (p.y + r * Math.sin(a)) * u };
  };

  const tap = (v: Visitor, b: Button, seconds: number) => {
    if (v.cabinet === null) return;
    const at = spot(v.cabinet, b);
    if (v.taps.length >= MAX_TAPS) v.taps.shift()?.touch.up();
    v.taps.push({ touch: v.hand.press(at.x, at.y), until: o.arcade().time + seconds });
  };

  const holdArrow = (v: Visitor, dir: -1 | 0 | 1) => {
    if (dir === v.arrowDir && (dir === 0 || v.arrow?.active)) return;
    v.arrow?.up();
    v.arrow = null;
    v.arrowDir = dir;
    if (dir !== 0 && v.cabinet !== null) {
      const at = spot(v.cabinet, dir < 0 ? "left" : "right");
      v.arrow = v.hand.press(at.x, at.y);
    }
  };

  const letGo = (v: Visitor) => {
    holdArrow(v, 0);
    for (const t of v.taps) t.touch.up();
    v.taps.length = 0;
  };

  const leave = (v: Visitor, minS: number, maxS: number) => {
    letGo(v);
    v.cabinet = null;
    v.state = "away";
    v.brain = null;
    v.until = o.arcade().time + rng.range(minS, maxS);
  };

  const taken = (c: number) => list.some((v) => v.cabinet === c);

  const arrive = (v: Visitor) => {
    const a = o.arcade();
    const t = a.time;
    const free = a.seats.filter(
      (s) =>
        s.player === "auto" &&
        s.queued === null &&
        t - s.lastPerson >= BOT_YIELD_S &&
        !taken(s.index),
    );
    if (!free.length) {
      v.until = t + rng.range(2, 5);
      return;
    }
    const home = free.find((s) => s.index === v.home % a.seats.length);
    const seat = home ?? rng.pick(free);
    v.cabinet = seat.index;
    v.state = "play";
    v.rounds = 0;
    v.plan = 1 + rng.int(3);
    v.counted = false;
    v.since = t;
    v.virtual = { stick: 0, drop: false };
    // Its own way of aiming, with the controls it reads kept apart from the machine's.
    const m = seat.machine;
    const view = Object.create(m, { controls: { value: v.virtual } }) as Machine;
    v.brain = createBot(view, rng.fork(`visitor-${brains++}`));
    tap(v, rng.next() < 0.5 ? "left" : "right", rng.range(0.15, 0.4));
  };

  const play = (v: Visitor) => {
    const a = o.arcade();
    const t = a.time;
    const seat = a.seats[v.cabinet ?? -1];
    if (!seat) {
      leave(v, 2, 6);
      return;
    }
    if (seat.player === "person" || seat.queued === "person" || t - seat.lastPerson < BOT_YIELD_S) {
      leave(v, BOT_YIELD_S, BOT_YIELD_S * 2);
      return;
    }
    const mine = seat.player === "bot";
    if (!mine && seat.queued !== "bot") {
      // The press didn't take, or the cabinet went back to playing itself.
      if (t - v.since > 3) leave(v, 3, 10);
      return;
    }
    const m = seat.machine;
    if (mine && m.phase === "play") {
      v.counted = false;
      v.brain?.update(STEP);
      holdArrow(v, v.virtual.stick);
      if (v.virtual.drop) {
        v.virtual.drop = false;
        holdArrow(v, 0);
        tap(v, "drop", rng.range(0.08, 0.2));
      }
      return;
    }
    holdArrow(v, 0);
    if (mine && m.phase === "idle" && seat.waiting) {
      if (!v.counted) {
        v.counted = true;
        v.rounds++;
        v.until = t + rng.range(1, 3.5);
      }
      if (v.rounds >= v.plan) leave(v, 6, 25);
      else if (t >= v.until) {
        v.counted = false;
        v.since = t;
        tap(v, rng.next() < 0.5 ? "left" : "right", rng.range(0.15, 0.35));
      }
    }
  };

  return {
    list,
    update() {
      const t = o.arcade().time;
      for (const v of list) {
        for (let i = v.taps.length - 1; i >= 0; i--) {
          const tp = v.taps[i]!;
          if (t >= tp.until || !tp.touch.active) {
            tp.touch.up();
            v.taps.splice(i, 1);
          }
        }
        if (v.state === "away") {
          if (t >= v.until) arrive(v);
        } else play(v);
      }
    },
    reset() {
      for (const v of list) leave(v, 2, 8);
    },
    dispose() {
      for (const v of list) {
        letGo(v);
        v.hand.dispose();
      }
    },
  };
};
