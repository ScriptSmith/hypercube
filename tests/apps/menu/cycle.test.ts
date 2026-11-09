import { describe, expect, it } from "vitest";
import { type Deck, markRan, peekNext } from "../../../src/apps/menu/cycle";
import { createRng } from "../../../src/core/rng";

const draw = (keys: string[], deck: Deck, random: () => number): string => {
  const key = peekNext(keys, deck, random);
  if (key === null) throw new Error("nothing offered");
  markRan(deck, key);
  return key;
};

describe("picker cycle deck", () => {
  it("shows every offer once per round, never the same one twice running", () => {
    const keys = ["a", "b", "c", "d", "e"];
    const rng = createRng("deck");
    const deck: Deck = { left: [], last: null };
    const seen: string[] = [];
    for (let i = 0; i < keys.length * 40; i++) seen.push(draw(keys, deck, () => rng.next()));
    for (let r = 0; r < 40; r++) {
      expect(seen.slice(r * 5, r * 5 + 5).sort()).toEqual(keys);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it("peeking doesn't use an offer up", () => {
    const deck: Deck = { left: [], last: null };
    const random = () => 0.5;
    const first = peekNext(["a", "b", "c"], deck, random);
    expect(peekNext(["a", "b", "c"], deck, random)).toBe(first);
  });

  it("skips what a visitor just chose", () => {
    const deck: Deck = { left: ["a", "b", "c"], last: null };
    markRan(deck, "a");
    expect(peekNext(["a", "b", "c"], deck, Math.random)).toBe("b");
    markRan(deck, "c");
    expect(peekNext(["a", "b", "c"], deck, Math.random)).toBe("b");
  });

  it("follows a changed list", () => {
    const deck: Deck = { left: ["a", "b"], last: null };
    expect(peekNext(["b", "c"], deck, () => 0)).toBe("b");
    markRan(deck, "b");
    expect(peekNext(["b", "c"], deck, () => 0)).toBe("c");
  });

  it("repeats a lone offer and offers nothing from an empty list", () => {
    const deck: Deck = { left: [], last: null };
    expect(draw(["a"], deck, Math.random)).toBe("a");
    expect(draw(["a"], deck, Math.random)).toBe("a");
    expect(peekNext([], deck, Math.random)).toBeNull();
  });
});
