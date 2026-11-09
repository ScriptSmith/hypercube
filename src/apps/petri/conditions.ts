import { conditionAt, type Slice } from "./dish";
import { CONDITION_COLUMNS } from "./gpu/culture";
import { defaultPreset, type Family, SLIME_PRESETS, TURING_PRESETS } from "./stamps";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Mix two hues (0 to 1, wrapping) the short way round. */
export const mixHue = (a: number, b: number, t: number): number => {
  let d = b - a;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return (((a + d * t) % 1) + 1) % 1;
};

/**
 * Per-column parameters for a culture's condition texture: CONDITION_COLUMNS columns by two rows
 * of RGBA. `toSlice` maps a fraction across the world to a fraction across the slices (the dish
 * is narrower than the bank above which its slices are laid out).
 */
export const buildConditions = (
  family: Family,
  slices: readonly Slice[],
  blend: number,
  toSlice: (f: number) => number = (f) => f,
  out: Float32Array = new Float32Array(CONDITION_COLUMNS * 2 * 4),
): Float32Array => {
  const fallback = defaultPreset(family);
  const row = CONDITION_COLUMNS * 4;
  for (let i = 0; i < CONDITION_COLUMNS; i++) {
    const f = toSlice((i + 0.5) / CONDITION_COLUMNS);
    const { a, b, t } = conditionAt(f, slices, blend, fallback);
    const o = i * 4;
    if (family === "slime") {
      const pa = (SLIME_PRESETS[a] ?? SLIME_PRESETS[fallback]!).params;
      const pb = (SLIME_PRESETS[b] ?? SLIME_PRESETS[fallback]!).params;
      out[o] = lerp(pa.sensorAngle, pb.sensorAngle, t);
      out[o + 1] = lerp(pa.turnAngle, pb.turnAngle, t);
      out[o + 2] = lerp(pa.sensorDist, pb.sensorDist, t);
      out[o + 3] = lerp(pa.step, pb.step, t);
      out[row + o] = lerp(pa.deposit, pb.deposit, t);
      out[row + o + 1] = lerp(pa.decay, pb.decay, t);
      out[row + o + 2] = 0;
      out[row + o + 3] = 0;
    } else {
      const pa = (TURING_PRESETS[a] ?? TURING_PRESETS[fallback]!).params;
      const pb = (TURING_PRESETS[b] ?? TURING_PRESETS[fallback]!).params;
      out[o] = lerp(pa.feed, pb.feed, t);
      out[o + 1] = lerp(pa.kill, pb.kill, t);
      out[o + 2] = mixHue(pa.hue, pb.hue, t);
      out[o + 3] = 0;
      out[row + o] = 0;
      out[row + o + 1] = 0;
      out[row + o + 2] = 0;
      out[row + o + 3] = 0;
    }
  }
  return out;
};
