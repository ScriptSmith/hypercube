/**
 * A bot player for one table. It looks at the balls each update and decides which flippers to
 * hold and when to work the plunger; the frame turns those decisions into touches on the pads
 * (bots kept for testing) or straight into the table's controls (the faded attract bot, whose
 * station is idle and so covered by the platform's tap hint).
 *
 * The main flippers swing at any ball about to cross their sweep, a little late now and then,
 * and sometimes hold a slow ball in the cradle first. The upper left flipper waits until a ball
 * has rolled to its outer end, which is where a flip sends it up the deck lane; the upper right
 * one swings at anything, since its targets cover a wide angle.
 */
import type { FlipperName } from "./layout";
import type { Flipper } from "./physics";
import type { Table } from "./table";

export interface BotIntent {
  flippers: Record<FlipperName, boolean>;
  plunger: boolean;
}

export interface Bot {
  readonly intent: BotIntent;
  update(table: Table): void;
  reset(): void;
}

interface Aim {
  /** Range along the flipper, as fractions of its length, where this bot swings. */
  from: number;
  to: number;
}

const AIMS: Record<FlipperName, Aim> = {
  left: { from: 0.4, to: 1.12 },
  right: { from: 0.4, to: 1.12 },
  upLeft: { from: 0.74, to: 0.98 },
  upRight: { from: 0.3, to: 1.1 },
};

/** How far ahead a bot looks, seconds: about the time a flipper takes to swing. */
const LOOK = 0.03;

export const createBot = (random: () => number, skill = 0.9): Bot => {
  const intent: BotIntent = {
    flippers: { left: false, right: false, upLeft: false, upRight: false },
    plunger: false,
  };
  const state: Record<FlipperName, { at: number; until: number; quiet: number; cradle: boolean }> =
    {
      left: { at: Infinity, until: 0, quiet: 0, cradle: false },
      right: { at: Infinity, until: 0, quiet: 0, cradle: false },
      upLeft: { at: Infinity, until: 0, quiet: 0, cradle: false },
      upRight: { at: Infinity, until: 0, quiet: 0, cradle: false },
    };
  let plungeAt = Infinity;
  let releaseAt = Infinity;

  /** Where a ball sits relative to a flipper at rest: along it, and above it (towards its swing). */
  const frameOf = (f: Flipper, x: number, y: number) => {
    const dx = Math.cos(f.rest);
    const dy = Math.sin(f.rest);
    const rx = x - f.px;
    const ry = y - f.py;
    const along = rx * dx + ry * dy;
    // The swing side: the way the flipper turns from rest to up.
    const turn = Math.sign(f.up - f.rest) || 1;
    const across = (dx * ry - dy * rx) * turn;
    return { along, across };
  };

  const inSweep = (f: Flipper, aim: Aim, x: number, y: number, r: number) => {
    const { along, across } = frameOf(f, x, y);
    const k = along / f.len;
    if (k < aim.from || k > aim.to) return false;
    const sweep = Math.abs(f.up - f.rest);
    const top = r + f.r1 + Math.max(0, along) * Math.sin(sweep) * 0.85;
    return across > -r * 0.2 && across < top;
  };

  const update = (t: Table) => {
    const now = t.world.t;
    const balls = t.world.balls;
    for (const f of t.world.flippers) {
      const name = f.name as FlipperName;
      const s = state[name];
      if (now >= s.at) {
        s.at = Infinity;
        intent.flippers[name] = true;
      }
      if (intent.flippers[name] && now >= s.until && s.at === Infinity) {
        intent.flippers[name] = false;
        s.cradle = false;
        s.quiet = now + 0.12;
      }
      if (intent.flippers[name] || s.at !== Infinity || now < s.quiet) continue;
      const aim = AIMS[name];
      for (const b of balls) {
        const speed = Math.hypot(b.vx, b.vy);
        const px = b.x + b.vx * LOOK;
        const py = b.y + b.vy * LOOK + 0.5 * t.world.gravity * LOOK * LOOK;
        if (!inSweep(f, aim, px, py, b.r) && !inSweep(f, aim, b.x, b.y, b.r)) continue;
        // Balls already flying up and away are left alone.
        const { across } = frameOf(f, b.x, b.y);
        const away = frameOf(f, b.x + b.vx * 0.01, b.y + b.vy * 0.01).across - across;
        if (away > 6 && speed > 400) continue;
        if (random() > skill) {
          s.quiet = now + 0.35;
          break;
        }
        const lower = name === "left" || name === "right";
        if (lower && speed < 220 && random() < 0.3) {
          // Catch it in the cradle, then let it roll out and swing again.
          s.cradle = true;
          s.at = now;
          s.until = now + 0.7 + random() * 0.9;
        } else {
          s.at = now + random() * 0.03 * (2 - skill);
          s.until = s.at + 0.16 + random() * 0.14;
        }
        break;
      }
    }
    // Plunger: wait a moment, pull for a while, let go.
    if (t.waiting() && t.mode === "play") {
      if (plungeAt === Infinity && !intent.plunger) plungeAt = now + 0.4 + random() * 1.2;
      if (now >= plungeAt) {
        plungeAt = Infinity;
        intent.plunger = true;
        releaseAt = now + 0.2 + random() * 0.9;
      }
    } else {
      plungeAt = Infinity;
    }
    if (intent.plunger && now >= releaseAt) {
      intent.plunger = false;
      releaseAt = Infinity;
    }
  };

  return {
    intent,
    update,
    reset() {
      for (const k of Object.keys(intent.flippers) as FlipperName[]) {
        intent.flippers[k] = false;
        state[k].at = Infinity;
        state[k].until = 0;
        state[k].quiet = 0;
      }
      intent.plunger = false;
      plungeAt = Infinity;
      releaseAt = Infinity;
    },
  };
};

/** Apply a bot's intent straight to a table (the attract bot). */
export const applyIntent = (t: Table, intent: BotIntent, was: { plunger: boolean }) => {
  for (const [name, held] of Object.entries(intent.flippers) as [FlipperName, boolean][]) {
    t.setFlipper(name, held);
  }
  if (intent.plunger && !was.plunger) t.pressPlunger();
  if (!intent.plunger && was.plunger) t.releasePlunger();
  was.plunger = intent.plunger;
};
