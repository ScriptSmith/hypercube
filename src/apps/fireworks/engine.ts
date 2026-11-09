/**
 * The records one frame draws: a ring of shell slots and a ring of burst slots. Each update turns
 * shells whose burst time has passed into bursts (so a burst always starts at its own time, however
 * late the frame gets to it) and frees what has finished.
 */
import {
  type Burst,
  burstDone,
  createPool,
  enforceBudget,
  fillBurst,
  newBurst,
  newShell,
  type Pool,
  type Shell,
  shellDone,
} from "./records";

export interface EngineOptions {
  shells: number;
  bursts: number;
  /** Bursts allowed at once before the oldest end early. */
  budget: number;
  /** A shell has just burst on this frame. */
  onBurst?(shell: Shell, burst: Burst): void;
}

export interface Engine {
  readonly shells: Pool<Shell>;
  readonly bursts: Pool<Burst>;
  addShell(fill: (s: Shell) => void): Shell;
  addBurst(fill: (b: Burst) => void): Burst;
  update(now: number): void;
  /** Bursts that ended early because the budget was full, since start. */
  readonly ended: number;
  clear(): void;
}

/** A shell found this late after its burst time is dropped rather than burst. */
const STALE_BURST_MS = 3500;

export const createEngine = (opts: EngineOptions): Engine => {
  const shells = createPool(opts.shells, newShell);
  const bursts = createPool(opts.bursts, newBurst);
  let ended = 0;

  const reset = (s: Shell) => {
    s.burst = false;
    s.shared = false;
    s.ghost = false;
    s.boost = 1;
    s.volley = 0;
    s.frame = null;
    s.pad = 0;
    s.exitU = 0.5;
  };

  return {
    shells,
    bursts,
    addShell(fill) {
      const s = shells.alloc();
      reset(s);
      fill(s);
      return s;
    },
    addBurst(fill) {
      const b = bursts.alloc();
      b.endAt = Infinity;
      fill(b);
      return b;
    },
    update(now) {
      for (const s of shells.slots) {
        if (!s.live) continue;
        if (!s.burst && now >= s.tb) {
          s.burst = true;
          if (!s.ghost && now - s.tb < STALE_BURST_MS) {
            const b = bursts.alloc();
            fillBurst(b, s);
            opts.onBurst?.(s, b);
          }
        }
        if (shellDone(s, now)) shells.free(s);
      }
      for (const b of bursts.slots) if (b.live && burstDone(b, now)) bursts.free(b);
      ended += enforceBudget(bursts, opts.budget, now);
    },
    get ended() {
      return ended;
    },
    clear() {
      shells.clear();
      bursts.clear();
    },
  };
};
