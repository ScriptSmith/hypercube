import type { Rng } from "../../core/types";
import { type GlideScale, glideAt } from "./modes";

/**
 * The attract tune: a slow seeded sequence that holds each note about six seconds so its figure
 * forms, rests while the plate rings down, and now and then sweeps a glide needle through a
 * resonance instead. Every few steps it asks for fresh sand during a rest, so a long attract run
 * keeps starting figures from an even sprinkle.
 */
export interface TuneNote {
  /** The frame's key to light, or null where there are no keys (the screen). */
  key: number | null;
  mode: number;
}

export interface TuneStrip {
  strip: number;
  scale: GlideScale;
}

export interface TuneState {
  /** A key note now, or null. */
  note: TuneNote | null;
  /** A glide sweep now: which strip, where its needle is and the frequency there. */
  glide: { strip: number; t: number; freq: number } | null;
  /** True for one update when fresh sand should fall. */
  sprinkle: boolean;
}

export const NOTE_MS = 6000;
export const REST_MS = 2500;
const SWEEP_IN_MS = 3000;
const SWEEP_DWELL_MS = 4500;
const SWEEP_CHANCE = 0.25;
const SPRINKLE_EVERY = 5;

type Step =
  | { kind: "note"; note: TuneNote; start: number; end: number }
  | { kind: "sweep"; strip: TuneStrip; from: number; to: number; start: number; end: number }
  | { kind: "rest"; start: number; end: number };

export interface Tune {
  update(now: number): TuneState;
  /** Start again after `delay` ms (after a reset, so fresh sand settles first). */
  restart(now: number, delay?: number): void;
}

export const createTune = (
  rng: Rng,
  notes: readonly TuneNote[],
  strips: readonly TuneStrip[],
): Tune => {
  let step: Step = { kind: "rest", start: 0, end: 1500 };
  let count = 0;
  let last = -1;
  let pendingSprinkle = false;
  const idle: TuneState = { note: null, glide: null, sprinkle: false };

  const next = (now: number): Step => {
    if (step.kind !== "rest") {
      count++;
      if (count % SPRINKLE_EVERY === 0) pendingSprinkle = true;
      return { kind: "rest", start: now, end: now + REST_MS };
    }
    if (strips.length > 0 && rng.next() < SWEEP_CHANCE) {
      const strip = strips[rng.int(strips.length)]!;
      const marks = strip.scale.marks.filter((m): m is number => m !== null);
      const to = marks[rng.int(Math.max(1, marks.length))] ?? 0.5;
      // Start half a gap to one side, inside the strip, and glide onto the note.
      const gap = marks.length > 1 ? marks[1]! - marks[0]! : 0.4;
      const side = rng.next() < 0.5 ? -1 : 1;
      const from = Math.min(1, Math.max(0, to + side * gap * 0.6));
      return {
        kind: "sweep",
        strip,
        from,
        to,
        start: now,
        end: now + SWEEP_IN_MS + SWEEP_DWELL_MS,
      };
    }
    if (notes.length === 0) return { kind: "rest", start: now, end: now + REST_MS };
    let i = rng.int(notes.length);
    if (notes.length > 1 && i === last) i = (i + 1 + rng.int(notes.length - 1)) % notes.length;
    last = i;
    return { kind: "note", note: notes[i]!, start: now, end: now + NOTE_MS };
  };

  return {
    update(now) {
      let guard = 0;
      while (now >= step.end && guard++ < 4) step = next(Math.max(now, step.end - 1));
      if (now >= step.end) step = next(now);
      const sprinkle = pendingSprinkle && step.kind === "rest";
      if (sprinkle) pendingSprinkle = false;
      if (step.kind === "note") return { note: step.note, glide: null, sprinkle: false };
      if (step.kind === "sweep") {
        const k = Math.min(1, (now - step.start) / SWEEP_IN_MS);
        const e = k * k * (3 - 2 * k);
        const t = step.from + (step.to - step.from) * e;
        return {
          note: null,
          glide: { strip: step.strip.strip, t, freq: glideAt(step.strip.scale, t) },
          sprinkle: false,
        };
      }
      return sprinkle ? { ...idle, sprinkle: true } : idle;
    },
    restart(now, delay = 3000) {
      step = { kind: "rest", start: now, end: now + delay };
    },
  };
};
