/**
 * Bots fly kites with injected touches on the same controls people use, following the autopilot:
 * a spool bot holds the button while the kite climbs and lets go while it drifts down, a stunt
 * bot holds both handles and moves them as the autopilot would. A bot leaves its kite alone for a
 * while after a person touches it.
 */
import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input } from "../../core/types";
import {
  spoolAutopilot,
  type SpoolPilot,
  spoolPilot,
  stuntAutopilot,
  type StuntPilot,
  stuntPilot,
} from "./autopilot";
import { BOT_YIELD_MS } from "./config";
import { type Patch, pulled } from "./patch";
import type { SkyFrame } from "./sky";

export interface BotKite {
  patch: number;
  kind: "spool" | "stunt";
}

/** Which kites get bots: the first `count` in patch order, spool before stunt. */
export const botKites = (patches: readonly Patch[], count: number): BotKite[] => {
  const all: BotKite[] = [];
  for (const p of patches) {
    all.push({ patch: p.spec.index, kind: "spool" });
    if (p.stunt) all.push({ patch: p.spec.index, kind: "stunt" });
  }
  return all.slice(0, Math.max(0, count));
};

export interface Bots {
  update(now: number, t: number, sky: SkyFrame): void;
  release(): void;
  dispose(): void;
  readonly fingers: number;
}

const LOOK_MS = 40;

interface Pilot {
  kite: BotKite;
  hand: BotHand;
  a: BotTouch | null;
  b: BotTouch | null;
  spool: SpoolPilot;
  stunt: StuntPilot;
}

export const createBots = (opts: {
  input: Input;
  patches: () => readonly Patch[];
  kites: readonly BotKite[];
  unit: () => number;
}): Bots => {
  const pilots: Pilot[] = opts.kites.map((kite) => ({
    kite,
    hand: createBotHand(opts.input),
    a: null,
    b: null,
    spool: spoolPilot(),
    stunt: stuntPilot(),
  }));
  let lookAt = 0;
  let last = 0;
  let disposed = false;

  const lift = (p: Pilot) => {
    p.a?.up();
    p.b?.up();
    p.a = null;
    p.b = null;
  };

  return {
    update(now, t, sky) {
      if (disposed || now < lookAt) return;
      const dt = last ? Math.min(0.2, (now - last) / 1000) : LOOK_MS / 1000;
      last = now;
      lookAt = now + LOOK_MS;
      const u = opts.unit();
      const patches = opts.patches();
      for (const p of pilots) {
        const patch = patches[p.kite.patch];
        if (!patch) continue;
        if (p.a && !p.a.active) p.a = null;
        if (p.b && !p.b.active) p.b = null;
        if (now - patch.human[p.kite.kind] < BOT_YIELD_MS) {
          lift(p);
          continue;
        }
        if (p.kite.kind === "spool") {
          const s = patch.button.spec;
          const hold = spoolAutopilot(patch.spool, t, patch.phase, sky.bounds.top, p.spool, dt);
          if (hold && !p.a) p.a = p.hand.press(s.x * u, s.y * u);
          else if (!hold && p.a) lift(p);
          continue;
        }
        const gl = patch.grips.left;
        const gr = patch.grips.right;
        if (!patch.stunt || !gl || !gr) continue;
        if (!p.a || !p.b) {
          // Take the handles where they are, so they don't jump.
          p.stunt.left = pulled(gl);
          p.stunt.right = pulled(gr);
        }
        const h = stuntAutopilot(patch.stunt, sky.window, t, patch.phase, p.stunt, dt);
        const ly = (gl.spec.restY + h.left * gl.spec.travel) * u;
        const ry = (gr.spec.restY + h.right * gr.spec.travel) * u;
        if (!p.a) p.a = p.hand.press(gl.spec.x * u, gl.y * u);
        else p.a.move(gl.spec.x * u, ly);
        if (!p.b) p.b = p.hand.press(gr.spec.x * u, gr.y * u);
        else p.b.move(gr.spec.x * u, ry);
      }
    },
    release() {
      for (const p of pilots) {
        lift(p);
        p.hand.release();
      }
    },
    dispose() {
      disposed = true;
      for (const p of pilots) {
        lift(p);
        p.hand.dispose();
      }
      pilots.length = 0;
    },
    get fingers() {
      let n = 0;
      for (const p of pilots) n += p.hand.touches;
      return n;
    },
  };
};
