/**
 * Placings. Both crash rules use one order: gliders that crossed the line, earliest first, then
 * the rest by distance. Under `tumble` that ranks anyone still flying at the end by how far they
 * got. Under `out` a crashed glider stops where it fell, so among gliders that started together
 * the last one flying has gone furthest and wins; a late joiner is ranked by distance like
 * everyone else. Ties go to the lower lane id so every frame agrees.
 */
export interface Entry {
  lane: number;
  /** Distance along the course, course px. */
  d: number;
  /** Race ms at the finish line, or null. */
  fin: number | null;
}

export const compareEntries = (a: Entry, b: Entry): number => {
  if (a.fin !== null || b.fin !== null) {
    if (a.fin === null) return 1;
    if (b.fin === null) return -1;
    if (a.fin !== b.fin) return a.fin - b.fin;
  } else if (a.d !== b.d) {
    return b.d - a.d;
  }
  return a.lane - b.lane;
};

/** Place (1, 2, 3 and so on) by lane id. */
export const placings = (entries: readonly Entry[]): Map<number, number> => {
  const sorted = [...entries].sort(compareEntries);
  const out = new Map<number, number>();
  sorted.forEach((e, i) => out.set(e.lane, i + 1));
  return out;
};

/** The place `lane` holds right now among `entries`, or null if it isn't among them. */
export const placeOf = (entries: readonly Entry[], lane: number): number | null => {
  const me = entries.find((e) => e.lane === lane);
  if (!me) return null;
  let place = 1;
  for (const e of entries) if (e !== me && compareEntries(e, me) < 0) place++;
  return place;
};
