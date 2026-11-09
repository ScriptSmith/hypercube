export interface Timers {
  after(ms: number, fn: () => void): () => void;
  every(ms: number, fn: () => void): () => void;
  /** Cancel everything this group started. */
  clear(): void;
}

/** A group of timers that can be cancelled together, so a role change can't leave any behind. */
export const createTimers = (): Timers => {
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  return {
    after(ms, fn) {
      const handle = setTimeout(() => {
        timeouts.delete(handle);
        fn();
      }, ms);
      timeouts.add(handle);
      return () => {
        clearTimeout(handle);
        timeouts.delete(handle);
      };
    },
    every(ms, fn) {
      const handle = setInterval(fn, ms);
      intervals.add(handle);
      return () => {
        clearInterval(handle);
        intervals.delete(handle);
      };
    },
    clear() {
      for (const handle of timeouts) clearTimeout(handle);
      for (const handle of intervals) clearInterval(handle);
      timeouts.clear();
      intervals.clear();
    },
  };
};

/** App callbacks must not break the network code, but their errors should still be seen. */
export const report = (err: unknown): void => {
  if (typeof reportError === "function") reportError(err);
  else console.error(err);
};

export const randomToken = (random: () => number, length: number): string => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
};
