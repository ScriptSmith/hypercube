/** Patches cleared today on this frame, for the row of flags in the sky. Bounded. */
const MAX = 60;

export interface Today {
  add(at: number): void;
  /** How many cleared on the same local day as `at`. */
  count(at: number): number;
}

const dayOf = (t: number) => {
  const d = new Date(t);
  return d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate();
};

export const createToday = (): Today => {
  const times: number[] = [];
  return {
    add(at) {
      times.push(at);
      if (times.length > MAX) times.shift();
    },
    count(at) {
      const d = dayOf(at);
      while (times.length > 0 && dayOf(times[0]!) !== d) times.shift();
      return times.length;
    },
  };
};
