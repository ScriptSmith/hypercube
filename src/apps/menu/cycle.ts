/** The offers still to come in this round, and the one that ran last. */
export interface Deck {
  left: string[];
  last: string | null;
}

const shuffle = <T>(items: T[], random: () => number): T[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = items[i] as T;
    items[i] = items[j] as T;
    items[j] = t;
  }
  return items;
};

/**
 * The offer the picker starts next when it changes app by itself, without taking it from the
 * deck: every key once in a random order before any comes round again, and never the one that
 * ran last twice in a row. Keys no longer offered drop out; new ones join the next round.
 */
export const peekNext = (
  keys: readonly string[],
  deck: Deck,
  random: () => number,
): string | null => {
  if (keys.length === 0) return null;
  const offered = new Set(keys);
  deck.left = deck.left.filter((k) => offered.has(k));
  if (deck.left.length === 0) {
    deck.left = shuffle([...offered], random);
    const first = deck.left[0];
    if (deck.left.length > 1 && first === deck.last) deck.left.push(deck.left.shift() as string);
  }
  return deck.left[0] ?? null;
};

/** Record that `key` started, whether the picker chose it or a visitor did. */
export const markRan = (deck: Deck, key: string): void => {
  deck.left = deck.left.filter((k) => k !== key);
  deck.last = key;
};
