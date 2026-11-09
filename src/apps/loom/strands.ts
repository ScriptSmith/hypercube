/**
 * A frame's own harmonics and the fingers on their controls. Pure.
 *
 * A finger anywhere on a slider's track sets the amplitude to where it is, and follows it. A
 * finger on a dial turns the phase one to one with its angle round the dial's centre, only the
 * change counting, so it can take the dial anywhere. A second finger on a control takes it
 * over. A harmonic is live while a finger is on it and for a while after (AUTO_MS in `match`,
 * FREE_LIVE_MS in `free`); otherwise it is auto and shows what the frame in charge says.
 *
 * With hints on, letting go close to the hint settles onto it, like a detent.
 */
import { AUTO_MS, FREE_LIVE_MS, type Variant } from "./config";
import { controlAt, type Layout, sliderValue } from "./layout";
import { phaseDelta, termError, type Term, wrapPhase } from "./series";

export interface Strand {
  index: number;
  k: number;
  amp: number;
  phase: number;
  /** Fingers on its controls. */
  held: number;
  /** ms of the last touch, by anyone, and by a person. */
  lastTouch: number;
  lastPerson: number;
  live: boolean;
  /** Where it is settling to after a release near the hint. */
  settle: Term | null;
}

interface Hold {
  strand: number;
  type: "slider" | "dial";
  /** Last finger angle round the dial, or null near its centre. */
  angle: number | null;
  person: boolean;
}

/** Letting go within this of the hint settles onto it, in slider units. */
export const SETTLE_AMP = 0.09;
export const SETTLE_TERM = 0.2;
/** Settling time constant, seconds. */
const SETTLE_S = 0.12;

export interface Strands {
  readonly list: Strand[];
  readonly holds: ReadonlyMap<number, Hold>;
  setLayout(l: Layout): void;
  /** A finger down at venue (x, y). Returns true when it landed on a control. */
  down(id: number, x: number, y: number, person: boolean, now: number): boolean;
  move(id: number, x: number, y: number, now: number): void;
  up(id: number, now: number, hint?: (i: number) => Term | null): void;
  /** Update live flags and settling. */
  step(dt: number, now: number): void;
  /** Let one harmonic go (its reset), or every one: it is auto at once. */
  release(i: number | null): void;
  clear(): void;
}

export const createStrands = (layout: Layout, variant: Variant): Strands => {
  let l = layout;
  const list: Strand[] = l.strands.map((s) => ({
    index: s.index,
    k: s.k,
    amp: 0,
    phase: 0,
    held: 0,
    lastTouch: Number.NEGATIVE_INFINITY,
    lastPerson: Number.NEGATIVE_INFINITY,
    live: false,
    settle: null,
  }));
  const holds = new Map<number, Hold>();
  const liveMs = variant === "free" ? FREE_LIVE_MS : AUTO_MS;

  const angleOf = (i: number, x: number, y: number): number | null => {
    const d = l.strands[i]?.dial;
    if (!d) return null;
    const dx = x - d.x;
    const dy = y - d.y;
    // Too near the centre, the angle jumps about.
    if (Math.hypot(dx, dy) < d.r * 0.22) return null;
    return Math.atan2(dy, dx);
  };

  const touch = (s: Strand, person: boolean, now: number) => {
    s.lastTouch = now;
    if (person) s.lastPerson = now;
    s.live = true;
    s.settle = null;
  };

  const apply = (h: Hold, x: number, y: number, now: number) => {
    const s = list[h.strand];
    const spec = l.strands[h.strand];
    if (!s || !spec) return;
    touch(s, h.person, now);
    if (h.type === "slider") {
      s.amp = sliderValue(spec.slider, y);
      return;
    }
    const a = angleOf(h.strand, x, y);
    if (a !== null && h.angle !== null) s.phase = wrapPhase(s.phase + phaseDelta(h.angle, a));
    if (a !== null) h.angle = a;
  };

  return {
    list,
    holds,
    setLayout(next) {
      l = next;
      holds.clear();
      for (const s of list) s.held = 0;
    },
    down(id, x, y, person, now) {
      const hit = controlAt(l, x, y);
      if (!hit) return false;
      // A second finger on a control takes it over.
      for (const [other, h] of holds) {
        if (h.strand === hit.strand && h.type === hit.type) {
          holds.delete(other);
          const s = list[h.strand];
          if (s) s.held = Math.max(0, s.held - 1);
        }
      }
      const h: Hold = {
        strand: hit.strand,
        type: hit.type,
        angle: angleOf(hit.strand, x, y),
        person,
      };
      holds.set(id, h);
      const s = list[hit.strand];
      if (s) s.held++;
      apply(h, x, y, now);
      return true;
    },
    move(id, x, y, now) {
      const h = holds.get(id);
      if (h) apply(h, x, y, now);
    },
    up(id, now, hint) {
      const h = holds.get(id);
      if (!h) return;
      holds.delete(id);
      const s = list[h.strand];
      if (!s) return;
      s.held = Math.max(0, s.held - 1);
      touch(s, h.person, now);
      const goal = hint?.(h.strand);
      if (!goal) return;
      // Settle onto the hint like a detent when close.
      if (h.type === "slider" && Math.abs(s.amp - goal.amp) <= SETTLE_AMP) {
        s.settle = { amp: goal.amp, phase: s.phase };
      } else if (h.type === "dial") {
        // Measured as the chord the turn makes at this amplitude (at least a quarter).
        const a = Math.max(s.amp, 0.25);
        const near = termError({ amp: a, phase: s.phase }, { amp: a, phase: goal.phase });
        if (near <= SETTLE_TERM) s.settle = { amp: s.amp, phase: goal.phase };
      }
    },
    step(dt, now) {
      const k = 1 - Math.exp(-dt / SETTLE_S);
      for (const s of list) {
        s.live = s.held > 0 || now - s.lastTouch < liveMs;
        if (s.settle && s.held === 0) {
          s.amp += (s.settle.amp - s.amp) * k;
          s.phase = wrapPhase(s.phase + phaseDelta(s.phase, s.settle.phase) * k);
          if (
            Math.abs(s.amp - s.settle.amp) < 1e-4 &&
            Math.abs(phaseDelta(s.phase, s.settle.phase)) < 1e-4
          ) {
            s.amp = s.settle.amp;
            s.phase = s.settle.phase;
            s.settle = null;
          }
        }
      }
    },
    release(i) {
      for (const [id, h] of holds) if (i === null || h.strand === i) holds.delete(id);
      for (const s of list) {
        if (i !== null && s.index !== i) continue;
        s.held = 0;
        s.lastTouch = Number.NEGATIVE_INFINITY;
        s.live = false;
        s.settle = null;
      }
    },
    clear() {
      holds.clear();
      for (const s of list) s.held = 0;
    },
  };
};
