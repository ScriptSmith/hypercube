import { describe, expect, it } from "vitest";
import {
  CLIMB_MS,
  DECK_MAX,
  DECK_POINTS,
  GIFTS,
  RAIN_STEP,
} from "../../../src/apps/pinball/config";
import type { DeckBall } from "../../../src/apps/pinball/deck";
import { slotInfos } from "../../../src/apps/pinball/deck";
import { LOCK_SIZE, SAUCER_MS } from "../../../src/apps/pinball/deckparts";
import { exitU, returnU } from "../../../src/apps/pinball/layout";
import { bankFraction } from "../../../src/core/layout";
import { DECK_H as H, DECK_W as W, type DeckRig, deckRig, panels } from "./helpers";

/** A table's ball, free on the deck, put at (x, y) moving (vx, vy). */
const place = (r: DeckRig, pos: number, x: number, y: number, vx = 0, vy = 0, id = 0): DeckBall => {
  const ref = id || 1000 + Math.floor(Math.random() * 1e6);
  r.up(pos, ref);
  r.step((CLIMB_MS + 350) / 1000);
  const b = r.deck.balls.find((x) => x.ref === ref)!;
  b.x = x;
  b.px = x;
  b.y = y;
  b.py = y;
  b.vx = vx;
  b.vy = vy;
  b.qx = x;
  b.qy = y;
  b.qt = r.now;
  b.freeAt = r.now;
  return b;
};

/** Everyone playing, so the deck drops in no balls of its own. */
const busy = (o: Parameters<typeof deckRig>[0] = {}) => {
  const r = deckRig(o);
  for (let p = 0; p < (o.count ?? 8); p++) r.playing(p);
  return r;
};

/** Step until `done` or `seconds` pass; returns the seconds taken (Infinity if never). */
const until = (r: DeckRig, seconds: number, done: () => boolean) => {
  for (let t = 0; t < seconds; t += 1 / 120) {
    r.step(1 / 120);
    if (done()) return t;
  }
  return Infinity;
};

const stat = (r: DeckRig, k: string) => r.deck.stats[k] ?? 0;

describe("pinball deck in play", () => {
  it("keeps every chute and hole above its table, at every bank size", () => {
    const banks = [
      ...Array.from({ length: 8 }, (_, i) => ({ count: i + 1, kind: "panel", span: 1 })),
      ...Array.from({ length: 4 }, (_, i) => ({ count: i + 1, kind: "pair", span: 2 })),
    ];
    for (const b of banks) {
      const frames = Array.from({ length: b.count }, (_, pos) => ({
        frame: `f${pos}`,
        pos,
        kind: b.kind,
        span: b.span,
      }));
      const r = deckRig({ count: b.count, frames });
      const geo = r.deck.geo;
      expect(geo.slots).toHaveLength(b.count * b.span);
      for (const s of geo.slots) {
        const mirror = b.span === 2 && s.h === 0;
        const at = (u: number) => W * bankFraction(s.pos, (s.h + u) / b.span, b.count);
        expect(s.chuteX).toBeCloseTo(at(exitU(mirror)), 6);
        expect(s.holeX).toBeCloseTo(at(returnU(mirror)), 6);
        // The table's target is over its own part of the floor.
        const t = geo.targets[s.index]!;
        expect(Math.min(t.ax, t.bx)).toBeGreaterThan(s.x0);
        expect(Math.max(t.ax, t.bx)).toBeLessThan(s.x1);
      }
      // Nothing of the fixed playfield reaches down into the chutes and holes.
      for (const sh of r.deck.world.shapes) {
        if (geo.slotShapes.includes(sh)) continue;
        if (sh.x0 <= 0 || sh.x1 >= W) continue;
        expect(sh.y1, `${sh.tag} at ${b.count} ${b.kind}`).toBeLessThan(geo.launchY - geo.R);
      }
    }
  });

  it("gets deck shots up into the deck from every chute, at every bank size", () => {
    let reached = 0;
    let tries = 0;
    for (const count of [1, 2, 3, 4, 5, 6, 8]) {
      const r = busy({ count });
      for (const s of r.deck.geo.slots) {
        let any = false;
        for (let k = 0; k < 3; k++) {
          const ref = 500 + s.index * 10 + k;
          r.up(s.pos, ref);
          let best = Infinity;
          let caught = false;
          let gone = false;
          until(r, (CLIMB_MS + 1900) / 1000, () => {
            const b = r.deck.balls.find((x) => x.ref === ref);
            if (!b || b.phase === "fall" || b.phase === "guided") gone = true;
            else if (b.phase === "held" || b.phase === "rail") caught = true;
            else if (b.phase === "free") best = Math.min(best, b.y);
            return caught || gone;
          });
          tries++;
          // Up into the deck, caught by a device, or still in play among the pieces.
          if (caught || best < H * 0.55 || !gone) {
            reached++;
            any = true;
          }
        }
        expect(any, `chute ${s.index} of ${count}`).toBe(true);
      }
    }
    expect(reached / tries).toBeGreaterThan(0.8);
  });

  it("rolls a ball down the left gutter into the saucer, which kicks it out", () => {
    const r = busy();
    const g = r.deck.geo.gutters[0]!;
    const b = place(r, 2, g[0]!.x + 120, g[0]!.y - 140, 0, 0);
    expect(until(r, 3, () => b.dev === "saucer0")).toBeLessThan(3);
    expect(stat(r, "saucer")).toBe(1);
    expect(until(r, (SAUCER_MS + 200) / 1000, () => b.phase === "free")).toBeLessThan(2);
  });

  it("sends a ball up the left orbit, round the top and into the lock", () => {
    const r = busy();
    const gate = r.deck.geo.rails[0]!.gate!;
    const b = place(r, 2, (gate.ax + gate.bx) / 2, gate.ay + 200, 0, -2600);
    expect(until(r, 0.3, () => b.phase === "rail")).toBeLessThan(0.3);
    expect(stat(r, "orbit")).toBe(1);
    expect(until(r, 5, () => b.dev === "lock")).toBeLessThan(5);
  });

  it("sends a ball round the right orbit onto the left gutter and into its saucer", () => {
    const r = busy();
    const gate = r.deck.geo.rails[1]!.gate!;
    const b = place(r, 7, (gate.ax + gate.bx) / 2, gate.ay + 200, 0, -2600);
    expect(until(r, 8, () => b.dev === "saucer0")).toBeLessThan(8);
    expect(stat(r, "orbit")).toBe(1);
  });

  it("takes a ball round the loop and lets it go straight up from its right side", () => {
    const r = busy();
    const gate = r.deck.geo.rails[2]!.gate!;
    const cx = (gate.ax + gate.bx) / 2;
    const cy = (gate.ay + gate.by) / 2;
    const b = place(r, 4, cx - 120, cy, 2600, -100);
    expect(until(r, 0.3, () => b.phase === "rail")).toBeLessThan(0.3);
    expect(stat(r, "loop")).toBe(1);
    expect(until(r, 4, () => b.phase === "free")).toBeLessThan(4);
    expect(b.x).toBeGreaterThan(r.deck.geo.cluster.x);
    expect(b.vy).toBeLessThan(-1000);
  });

  it("kicks a ball up from the scoop along its ramp and into the lock", () => {
    const r = busy();
    const v = r.deck.geo.vuk;
    const b = place(r, 5, v.x, v.y - 100, 0, 600);
    expect(until(r, 1, () => b.dev === "vuk")).toBeLessThan(1);
    expect(until(r, 6, () => b.dev === "lock")).toBeLessThan(6);
    expect(stat(r, "ramp")).toBe(1);
  });

  it("flings each magnet's catches at its targets in turn: orbits, the loop and the captive ball", () => {
    for (const [i, wants] of [
      [0, ["orbit", "loop", "captive"]],
      [1, ["orbit", "big"]],
    ] as const) {
      const r = busy();
      const m = r.deck.geo.magnets[i]!;
      for (const want of wants) {
        const before = stat(r, want);
        const capY = r.deck.parts.captive.y;
        let top = Infinity;
        const b = place(r, 3, m.x, m.y - m.r * 0.5, 0, 400);
        expect(until(r, 0.3, () => b.dev === `magnet${i}`)).toBeLessThan(0.3);
        const took = until(r, 4, () => {
          top = Math.min(top, r.deck.parts.captive.y);
          if (want === "big" && stat(r, "cluster") > 0) return true;
          return stat(r, want) > before || (want === "captive" && top < capY - r.deck.geo.U * 3);
        });
        expect(took, `magnet ${i} at ${want}`).toBeLessThan(4);
        // Clear it away before the next one.
        r.step(2);
      }
    }
  });

  it("scores the captive ball for the table whose ball knocked it up", () => {
    const r = busy();
    const c = r.deck.geo.captive;
    place(r, 6, c.rest.x, c.box.y1 + 160, 0, -2800);
    expect(until(r, 2, () => stat(r, "captive") > 0)).toBeLessThan(2);
    r.step(0.6);
    const mine = r.points.filter((p) => p.frame === "p6").flatMap((p) => p.list.map((x) => x[1]));
    expect(mine.reduce((a, n) => a + n, 0)).toBeGreaterThanOrEqual(DECK_POINTS.captive);
    // It stays in its chamber.
    r.step(5);
    const cap = r.deck.parts.captive;
    expect(cap.y).toBeGreaterThan(c.box.y0);
    expect(cap.y).toBeLessThan(c.box.y1);
  });

  it("locks three balls and lets them all go as a multiball", () => {
    const r = busy();
    const m = r.deck.geo.lock.mouth;
    for (let k = 0; k < LOCK_SIZE; k++) {
      const b = place(r, k + 1, m.x, m.y - 40, 0, 200);
      expect(until(r, 0.5, () => b.dev === "lock")).toBeLessThan(0.5);
    }
    expect(until(r, 3, () => stat(r, "multiball") === LOCK_SIZE)).toBeLessThan(3);
    expect(r.deck.parts.lock.held).toHaveLength(0);
  });

  it("grows the big bumper as it is hit, and bursts it after its third level", () => {
    const r = busy();
    const big = r.deck.geo.big;
    const r0 = big.r;
    for (let k = 0; k < 18 && stat(r, "burst") === 0; k++) {
      place(r, 4, big.x, big.y - big.r - 80, 0, 900, 7000 + k);
      until(r, 0.4, () => (r.deck.stats.big ?? 0) > k);
      if (k === 6) expect(big.r).toBeGreaterThan(r0);
    }
    expect(stat(r, "burst")).toBe(1);
    expect(big.r).toBe(r0);
    expect(r.deck.parts.big.level).toBe(0);
  });

  it("tips the nest out to the playing tables, one more each, and pays the shooters", () => {
    const r = deckRig();
    r.playing(2);
    r.playing(5);
    r.step(3);
    const nest = r.deck.parts.nest;
    expect(nest.cups).toBe(3);
    // Over the middle of the playing tables, within its track.
    const span = (r.deck.geo.slots[2]!.x0 + r.deck.geo.slots[5]!.x1) / 2;
    expect(nest.x).toBeCloseTo(Math.max(r.deck.geo.nest.minX, span), 0);
    for (let k = 0; k < 3; k++) {
      const b = place(r, k === 0 ? 2 : 5, nest.x + (k - 1) * 30, r.deck.geo.nest.y - 40, 0, 300);
      expect(
        until(r, 0.3, () => b.dev === "nest"),
        `ball ${k}`,
      ).toBeLessThan(0.3);
    }
    r.downs.length = 0;
    expect(until(r, 4, () => stat(r, "pour") > 0)).toBeLessThan(4);
    r.step(4);
    expect(r.downs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(r.downs.map((d) => d.slot.pos))).toEqual(new Set([2, 5]));
    const paid = r.points.flatMap((p) => p.list.map((x) => x[1]));
    expect(Math.max(...paid)).toBeGreaterThanOrEqual(DECK_POINTS.nest);
  });

  it("sends a ball still in the nest to someone playing when its own table has gone", () => {
    const r = deckRig();
    r.playing(3);
    r.playing(4);
    r.step(3);
    const nest = r.deck.parts.nest;
    const b = place(r, 3, nest.x, r.deck.geo.nest.y - 40, 0, 300);
    expect(until(r, 0.3, () => b.dev === "nest")).toBeLessThan(0.3);
    const frames = panels(8).filter((f) => f.pos !== 3);
    r.deck.setSlots(slotInfos(8, frames), new Set(frames.map((f) => f.frame)));
    r.downs.length = 0;
    // Tipped by its timer: two cups stay empty. Table 4 keeps reporting that it is playing.
    for (let t = 0; t < 50; t += 2) {
      r.playing(4);
      r.step(2);
    }
    expect(r.downs.some((d) => d.m.i === b.id && d.slot.pos === 4)).toBe(true);
  });

  it("pops a bubble with a table's ball and sends that table its gift", () => {
    const r = busy();
    r.step(1);
    const bubbles = r.deck.parts.bubbles;
    bubbles.clear();
    const s = r.deck.geo.slots[6]!;
    const bub = bubbles.spawn(W / 2, "posts", 6, r.now)!;
    const b = place(r, 6, bub.x, bub.y + 300, 0, -2500);
    void b;
    expect(until(r, 1, () => stat(r, "bubble") > 0)).toBeLessThan(1);
    expect(r.gifts).toHaveLength(1);
    const g = r.gifts[0]!;
    expect(g.slot).toBe(s);
    expect(GIFTS[g.m.k]).toBe("posts");
    expect(g.m.t).toBeGreaterThan(r.now);
    // The icon rides down to the table's hole and off the bottom edge.
    expect(r.deck.parts.tokens).toHaveLength(1);
    r.step((g.m.t - r.now) / 1000 + 0.1);
    expect(r.deck.parts.tokens).toHaveLength(0);
  });

  it("sends a table the gift it popped, and none to a table nobody plays", () => {
    const r = busy();
    expect(r.deck.giveGift(r.deck.geo.slots[4]!, "shield", W / 2, H / 2, r.now)).toBe(true);
    expect(GIFTS[r.gifts[0]!.m.k]).toBe("shield");
    r.playing(7, false);
    expect(r.deck.giveGift(r.deck.geo.slots[7]!, "extra", W / 2, H / 2, r.now)).toBe(false);
    // Bubbles rise only above playing tables.
    r.step(20);
    for (const bub of r.deck.parts.bubbles.list) expect(bub.slot).not.toBe(7);
  });

  it("nudges a ball that has stopped, then guides it down", () => {
    const r = busy();
    const b = place(r, 3, W * 0.2, H * 0.3, 0, 0);
    const at = { x: b.x, y: b.y };
    let t = 0;
    while (b.phase === "free" && t < 12) {
      // Hold it where it is, as if wedged.
      b.x = at.x;
      b.y = at.y;
      b.vx = 0;
      b.vy = 0;
      r.step(0.1);
      t += 0.1;
    }
    expect(stat(r, "nudge")).toBe(2);
    expect(stat(r, "eject")).toBe(1);
    expect(t).toBeLessThan(9);
    expect(["guided", "fall"]).toContain(b.phase);
  });

  it("keeps held and riding balls within DECK_MAX, and every ball on the deck in bounds", () => {
    const r = busy();
    for (let i = 0; i < 120; i++) {
      r.up(i % 8, 2000 + i);
      r.step(0.1);
      const live = r.deck.balls.filter((b) => b.phase !== "guided" && b.phase !== "fall");
      expect(live.length).toBeLessThanOrEqual(DECK_MAX);
      expect(r.deck.balls.length).toBeLessThanOrEqual(DECK_MAX + 8);
      expect(r.deck.parts.bubbles.live()).toBeLessThanOrEqual(3);
      expect(r.deck.parts.tokens.length).toBeLessThanOrEqual(8);
      for (const b of live) {
        if (b.phase !== "free") continue;
        expect(b.x).toBeGreaterThan(0);
        expect(b.x).toBeLessThan(W);
        expect(b.y).toBeGreaterThan(H * 0.03);
      }
    }
    // Once the tables stop, the deck plays on by itself, still within its limits.
    for (let t = 0; t < 120; t += 1) {
      r.step(1);
      expect(r.deck.balls.length).toBeLessThanOrEqual(DECK_MAX + 8);
    }
  });

  it("runs on its own with no tables, using its devices, sending nothing down", () => {
    const r = deckRig({ frames: [] });
    r.step(90);
    expect(r.downs).toHaveLength(0);
    expect(r.gifts).toHaveLength(0);
    expect(r.deck.balls.length).toBeLessThanOrEqual(12);
    const used = ["saucer", "magnet", "vuk", "lock", "orbit", "loop", "nest", "big"].filter(
      (k) => stat(r, k) > 0,
    );
    expect(used.length).toBeGreaterThanOrEqual(4);
  });

  it("still rains every RAIN_STEP points", () => {
    const r = busy();
    r.deck.total = RAIN_STEP - 1;
    r.downs.length = 0;
    const b = place(r, 2, r.deck.geo.pops[0]!.x, r.deck.geo.pops[0]!.y - 200, 0, 1500);
    void b;
    r.step(3);
    expect(r.deck.total).toBeGreaterThanOrEqual(RAIN_STEP);
    expect(r.downs.length).toBeGreaterThanOrEqual(7);
  });
});
