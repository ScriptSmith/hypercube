/**
 * Bots hold and release the pads with injected touches, following the autopilot, so they take
 * the same path as fingers. A bot leaves its crew alone for a while after a person touches one
 * of its pads, and lets go between runs.
 */
import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input } from "../../core/types";
import { BOT_YIELD_MS } from "./config";
import type { Crew } from "./crew";
import type { PadRole, PadSpec } from "./layout";
import { pulse } from "./pilot";

export interface BotsDeps {
  input: Input;
  crews: readonly Crew[];
  /** The pads each bot works, by crew. */
  pads: readonly PadSpec[];
  /** Stage px per venue px. */
  unit(): number;
}

export interface Bots {
  update(now: number): void;
  release(): void;
  dispose(): void;
}

/** Seconds between a bot's looks at its pads. */
const LOOK_MS = 60;

interface Finger {
  pad: PadSpec;
  touch: BotTouch | null;
}

const wanted = (role: PadRole, cmd: NonNullable<ReturnType<Crew["advice"]>>, t: number) => {
  switch (role) {
    case "left":
      return pulse(cmd.left, t);
    case "right":
      return pulse(cmd.right, t);
    case "main":
      return pulse(cmd.main, t);
    case "turnLeft":
      return cmd.turn < 0 && pulse(-cmd.turn, t);
    case "turnRight":
      return cmd.turn > 0 && pulse(cmd.turn, t);
  }
};

/** Which pads get bots: `count` crews on a wall, else `count` pads of the one crew. */
export const botPads = (crews: readonly Crew[], count: number, wall: boolean): PadSpec[] => {
  if (count <= 0) return [];
  if (wall) return crews.slice(0, count).flatMap((c) => c.spec.pads);
  const pads = crews[0]?.spec.pads ?? [];
  const order: PadRole[] = ["left", "main", "right", "turnLeft", "turnRight"];
  const sorted = [...pads].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  // Crew variant: the second bot is the adult on both turn pads.
  if (count >= 2) return sorted;
  return sorted.slice(0, 1);
};

export const createBots = (d: BotsDeps): Bots => {
  const hands = new Map<number, BotHand>();
  const fingers: Finger[] = d.pads.map((pad) => ({ pad, touch: null }));
  for (const f of fingers) {
    if (!hands.has(f.pad.crew)) hands.set(f.pad.crew, createBotHand(d.input));
  }
  let lookAt = 0;
  let disposed = false;

  const lift = (f: Finger) => {
    f.touch?.up();
    f.touch = null;
  };

  return {
    update(now) {
      if (disposed || now < lookAt) return;
      lookAt = now + LOOK_MS;
      const u = d.unit();
      for (const f of fingers) {
        const crew = d.crews[f.pad.crew];
        const hand = hands.get(f.pad.crew);
        if (!crew || !hand) continue;
        if (now - crew.lastHuman < BOT_YIELD_MS) {
          lift(f);
          continue;
        }
        const cmd = crew.advice();
        const on = cmd !== null && wanted(f.pad.role, cmd, crew.runT);
        if (f.touch && !f.touch.active) f.touch = null;
        if (on && !f.touch) {
          const r = f.pad.rect;
          const x = (r.x + r.width * (0.4 + Math.random() * 0.2)) * u;
          const y = (r.y + r.height * (0.4 + Math.random() * 0.2)) * u;
          f.touch = hand.press(x, y);
        } else if (!on && f.touch) lift(f);
      }
    },
    release() {
      for (const f of fingers) lift(f);
      for (const h of hands.values()) h.release();
    },
    dispose() {
      disposed = true;
      for (const f of fingers) lift(f);
      for (const h of hands.values()) h.dispose();
      hands.clear();
    },
  };
};
