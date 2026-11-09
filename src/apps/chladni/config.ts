import type { FrameKind, OptionValues } from "../../core/types";
import type { PlateShape } from "./modes";

export type SandTint = "sand" | "white" | "rainbow";

export interface ChladniConfig {
  shape: PlateShape;
  /** Note keys on a solo frame. */
  keys: number;
  sand: SandTint;
  glide: boolean;
  damp: boolean;
  /** A puck that moves the drive point (else it stays at its home). */
  puck: boolean;
  /** The stretch slider (square plate only). */
  stretch: boolean;
  /** The damping slider. */
  damping: boolean;
  /** Plates on a wall; 1 elsewhere. */
  plates: number;
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const whole = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(hi, Math.max(lo, Math.round(v)))
    : fallback;

export const readConfig = (
  variant: string,
  options: OptionValues,
  kind: FrameKind,
): ChladniConfig => ({
  shape: variant === "round" ? "round" : "square",
  keys: whole(options.keys, 4, 10, 6),
  sand: pick(options.sand, ["sand", "white", "rainbow"], "sand"),
  glide: options.glide !== false,
  damp: options.damp !== false,
  puck: options.puck !== false,
  stretch: options.stretch !== false && variant !== "round",
  damping: options.damping !== false,
  plates: kind === "wall" ? whole(options.plates, 1, 2, 1) : 1,
});

export const tintIndex = (t: SandTint): 0 | 1 | 2 => (t === "white" ? 1 : t === "rainbow" ? 2 : 0);
