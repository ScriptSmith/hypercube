/**
 * The general flash rule for public displays, for checking the ball: a flash is a pair of
 * opposing changes in relative luminance of 0.1 or more where the darker side is below 0.8, and
 * no area larger than a small patch may flash more than three times in any second. The unit
 * tests apply it to the light model and the debug hook's `measure` to the drawn picture.
 */

/** Frames at which a luminance series changes by `step` or more, in alternate directions. */
export const transitions = (series: ArrayLike<number>, step = 0.1): number[] => {
  const out: number[] = [];
  let lo = series[0] ?? 0;
  let hi = lo;
  let trend = 0;
  for (let f = 1; f < series.length; f++) {
    const y = series[f]!;
    if (trend >= 0) {
      if (y > hi) hi = y;
      if (hi - y >= step && y < 0.8) {
        out.push(f);
        trend = -1;
        lo = y;
        continue;
      }
    }
    if (trend <= 0) {
      if (y < lo) lo = y;
      if (y - lo >= step && lo < 0.8) {
        out.push(f);
        trend = 1;
        hi = y;
      }
    }
  }
  return out;
};

/** Most flashes (pairs of opposing changes) in any one second of a series sampled at `hz`. */
export const maxFlashesPerSecond = (series: ArrayLike<number>, hz: number, step = 0.1): number => {
  const times = transitions(series, step);
  let most = 0;
  let start = 0;
  for (let end = 0; end < times.length; end++) {
    while (times[end]! - times[start]! >= hz) start++;
    most = Math.max(most, Math.floor((end - start + 1) / 2));
  }
  return most;
};
