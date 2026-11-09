import { describe, expect, it } from "vitest";
import {
  CLIMB_MS,
  DECK_GUIDE_MS,
  DECK_MAX,
  MAX_IN_PLAY,
  RAIN_STEP,
} from "../../../src/apps/pinball/config";
import { type Deck, type DeckBall, slotInfos } from "../../../src/apps/pinball/deck";
import { exitU, returnU } from "../../../src/apps/pinball/layout";
import type { UpMsg } from "../../../src/apps/pinball/wire";
import { bankFraction } from "../../../src/core/layout";
import { DECK_H as H, DECK_W as W, type DeckRig, deckRig, DT, panels } from "./helpers";

/** Put a free ball into hole `i` on the next update. */
const dropInto = (deck: Deck, b: DeckBall, i: number) => {
  const s = deck.geo.slots[i]!;
  b.x = s.holeX;
  b.y = deck.geo.holeY + deck.geo.R;
  b.vx = 0;
  b.vy = 100;
};

const freeBall = (r: DeckRig, pos: number, i = 1) => {
  r.up(pos, i);
  r.step((CLIMB_MS + 400) / 1000);
  const b = r.deck.balls.find((x) => x.ref === i && x.from === `p${pos}`)!;
  expect(b.phase).toBe("free");
  return b;
};

describe("pinball deck", () => {
  it("lays out one slot per table, panels or pairs", () => {
    expect(slotInfos(8, panels(8))).toHaveLength(8);
    const pairs = Array.from({ length: 4 }, (_, pos) => ({
      frame: `q${pos}`,
      pos,
      kind: "pair",
      span: 2,
    }));
    const infos = slotInfos(4, pairs);
    expect(infos).toHaveLength(8);
    expect(infos[3]).toEqual({ frame: "q1", pos: 1, h: 1, n: 2 });
    // Positions nobody reported yet look like their neighbours.
    expect(slotInfos(4, pairs.slice(0, 2))).toHaveLength(8);
    expect(slotInfos(3, [])).toHaveLength(3);
  });

  it("puts each chute and hole right above the table's exit and return", () => {
    const pairs = Array.from({ length: 4 }, (_, pos) => ({
      frame: `q${pos}`,
      pos,
      kind: "pair",
      span: 2,
    }));
    const r = deckRig({ count: 4, frames: pairs });
    for (const s of r.deck.geo.slots) {
      const mirror = s.h === 0;
      expect(s.chuteX).toBeCloseTo(W * bankFraction(s.pos, (s.h + exitU(mirror)) / 2, 4), 6);
      expect(s.holeX).toBeCloseTo(W * bankFraction(s.pos, (s.h + returnU(mirror)) / 2, 4), 6);
    }
    // A ball from the second table of pair 3 comes up its chute.
    const m: UpMsg = { i: 4, p: 3, h: 1, n: 2, u: exitU(false), vx: 0, vy: -2000, c: 1, t: r.now };
    r.deck.up(m, "q3", r.now, r.local);
    const slot = r.deck.geo.slots.find((s) => s.frame === "q3" && s.h === 1)!;
    expect(r.deck.arrivals[0]!.x).toBeCloseTo(slot.chuteX, 6);
  });

  it("brings a deck shot up its chute when it leaves the table, fast-forwarding late ones", () => {
    const r = deckRig();
    r.up(2, 1);
    const b = r.deck.balls[0]!;
    expect(b.phase).toBe("chute");
    expect(r.deck.arrivals[0]!.late).toBeCloseTo(-CLIMB_MS, 0);
    // It waits below the bottom edge until the table's climb is over.
    r.step((CLIMB_MS - 50) / 1000);
    expect(b.y).toBeGreaterThan(H);
    r.step(0.1);
    expect(b.y).toBeLessThan(H);
    expect(b.r).toBeLessThan(r.deck.geo.R);
    r.step(0.4);
    expect(b.phase).toBe("free");
    expect(b.vy).toBeLessThan(-H * 0.6);
    expect(b.r).toBe(r.deck.geo.R);
    // A message that arrives a second late launches the ball at once.
    r.up(5, 2, r.now - 1000);
    const late = r.deck.balls.find((x) => x.ref === 2)!;
    r.step(DT);
    expect(late.phase).toBe("free");
  });

  it("sends a ball to the playing table under its hole, else the nearest, else back to its owner", () => {
    const r = deckRig();
    r.playing(2);
    r.playing(4);
    r.playing(7);
    const a = freeBall(r, 2, 1);
    dropInto(r.deck, a, 4);
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(4);
    const b = freeBall(r, 2, 2);
    dropInto(r.deck, b, 6);
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(7);
    r.playing(4, false);
    r.playing(7, false);
    const c = freeBall(r, 2, 3);
    dropInto(r.deck, c, 7);
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(2);
    // The message says when the ball reaches the table's top edge.
    const last = r.downs.at(-1)!;
    expect(last.m.t).toBeGreaterThan(r.now - 100);
  });

  it("sends an attract table's ball to the table under the hole it falls into", () => {
    const r = deckRig();
    r.playing(4);
    r.attract(2);
    r.attract(6);
    const a = freeBall(r, 2, 1);
    dropInto(r.deck, a, 4);
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(4);
    const b = freeBall(r, 2, 2);
    dropInto(r.deck, b, 6);
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(6);
    // Table 7 has no game on, so the nearest table that has one takes it.
    const c = freeBall(r, 2, 3);
    dropInto(r.deck, c, 7);
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(6);
  });

  it("sends nothing to a table with no game on, and drains only when no table has one", () => {
    const r = deckRig();
    r.playing(2);
    // Table 3's game is over: it is still there but takes no balls.
    r.playing(3, false);
    const a = freeBall(r, 2, 1);
    dropInto(r.deck, a, 3);
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(2);
    r.playing(2, false);
    const n = r.downs.length;
    const b = freeBall(r, 2, 2);
    dropInto(r.deck, b, 2);
    r.step(DT * 2);
    expect(b.phase).toBe("fall");
    expect(r.downs).toHaveLength(n);
  });

  it("sends a ball to the table under its hole when every table is full", () => {
    const r = deckRig({ count: 4, frames: panels(4) });
    for (let pos = 0; pos < 4; pos++) r.attract(pos, MAX_IN_PLAY);
    const a = freeBall(r, 1, 1);
    dropInto(r.deck, a, 3);
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(3);
  });

  it("skips a table that already has MAX_IN_PLAY balls in play", () => {
    const r = deckRig();
    r.playing(1);
    r.playing(4, true, MAX_IN_PLAY);
    r.playing(5, true, 1);
    const a = freeBall(r, 1, 1);
    dropInto(r.deck, a, 4);
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(5);
  });

  it("returns every ball to its owner with rain off", () => {
    const r = deckRig({ rain: false });
    r.playing(2);
    r.playing(4);
    const a = freeBall(r, 2, 1);
    dropInto(r.deck, a, 4);
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(2);
  });

  it("keeps at most DECK_MAX balls in flight", () => {
    const r = deckRig();
    for (let i = 0; i < 40; i++) {
      r.up(i % 8, 100 + i);
      r.step(0.05);
      const flying = r.deck.balls.filter((b) => b.phase === "chute" || b.phase === "free").length;
      expect(flying).toBeLessThanOrEqual(DECK_MAX);
    }
    expect(r.deck.balls.length).toBeLessThanOrEqual(DECK_MAX + 8);
  });

  it("guides a ball down after DECK_GUIDE_MS", () => {
    const r = deckRig();
    r.playing(3);
    const b = freeBall(r, 3, 1);
    // Keep it up in the air, moving about so it never counts as stuck, and out of every device.
    let held = 0;
    let k = 0;
    while (b.phase === "free" && held < 30) {
      // The table reports in as it would while playing.
      if (k % 30 === 0) r.playing(3);
      b.x = W * (k++ % 2 === 0 ? 0.3 : 0.7);
      b.y = H * 0.3;
      b.vx = 0;
      b.vy = 0;
      r.step(0.1);
      held += 0.1;
    }
    expect(held * 1000).toBeGreaterThanOrEqual(DECK_GUIDE_MS - 500);
    expect(b.phase).toBe("guided");
    r.step(3);
    expect(r.downs.some((d) => d.m.i === b.id)).toBe(true);
  });

  it("drops a bonus ball into every playing table when the total passes a step", () => {
    const r = deckRig();
    r.playing(1);
    r.playing(7);
    r.deck.total = RAIN_STEP + 5;
    r.step(DT);
    expect(r.deck.balls.filter((b) => b.rain)).toHaveLength(2);
    r.step(3);
    expect(r.downs.map((d) => d.slot.pos).sort()).toEqual([1, 7]);
  });

  it("re-sends a ball whose table went before it arrived", () => {
    const r = deckRig();
    r.playing(2);
    r.playing(4);
    r.playing(5);
    const a = freeBall(r, 2, 1);
    dropInto(r.deck, a, 4);
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(4);
    const frames = panels(8).filter((f) => f.pos !== 4);
    r.deck.setSlots(slotInfos(8, frames), new Set(frames.map((f) => f.frame)));
    r.step(DT * 2);
    expect(r.downs.at(-1)?.slot.pos).toBe(5);
  });

  it("batches deck points for the tables whose balls scored them", () => {
    const r = deckRig();
    const b = freeBall(r, 2, 1);
    // Straight onto a bumper.
    const bumper = r.deck.geo.pops[0]!;
    b.x = bumper.x;
    b.y = bumper.y - bumper.r - b.r - 10;
    b.vx = 0;
    b.vy = 1500;
    r.step(0.8);
    expect(r.deck.total).toBeGreaterThan(0);
    const mine = r.points.filter((p) => p.frame === "p2");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0]!.list[0]![0]).toBe(0);
  });

  it("drops balls in by itself when no tables are there", () => {
    const r = deckRig({ frames: [] });
    r.step(8);
    expect(r.deck.balls.length).toBeGreaterThan(1);
    expect(r.deck.balls.length).toBeLessThanOrEqual(12);
    expect(r.downs).toHaveLength(0);
  });

  it("sends its own balls down to the tables too", () => {
    const r = deckRig();
    const fell = new Set<number>();
    let own = 0;
    for (let t = 0; t < 45; t += 1) {
      // Nothing comes up for a while, so the deck adds a few balls of its own.
      for (let pos = 0; pos < 10; pos++) r.playing(pos);
      for (let k = 0; k < 120; k++) {
        r.step(DT);
        for (const b of r.deck.balls) {
          if (b.phase !== "fall" || fell.has(b.id)) continue;
          fell.add(b.id);
          if (!b.owner) own++;
        }
      }
    }
    expect(own).toBeGreaterThan(0);
    expect(r.downs).toHaveLength(fell.size);
  });
});
