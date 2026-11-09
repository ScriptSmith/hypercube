import { describe, expect, it } from "vitest";
import { BALL_R, CLIMB_MS, DECK_MAX, DECK_POINTS, GIFTS } from "../../../src/apps/pinball/config";
import type { DeckBall } from "../../../src/apps/pinball/deck";
import { LOCK_SIZE, SAUCER_MS } from "../../../src/apps/pinball/deckparts";
import { exitU, returnU } from "../../../src/apps/pinball/layout";
import { DECK_GROW, MAX_GROW } from "../../../src/apps/pinball/wallgeo";
import { type BandRig, bandRig, WALL_H, WALL_W } from "./helpers";

/** A table's ball, free on the band, put at (x, y) moving (vx, vy). */
const place = (r: BandRig, h: number, x: number, y: number, vx = 0, vy = 0, id = 0): DeckBall => {
  const ref = id || 1000 + Math.floor(Math.random() * 1e6);
  r.up(h, ref);
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

/** Every table playing, so the deck drops in no balls of its own. */
const busy = (o: Parameters<typeof bandRig>[0] = {}) => {
  const r = bandRig(o);
  for (let h = 0; h < (o.tables ?? 5); h++) r.playing(h);
  return r;
};

const until = (r: BandRig, seconds: number, done: () => boolean) => {
  for (let t = 0; t < seconds; t += 1 / 120) {
    r.step(1 / 120);
    if (done()) return t;
  }
  return Infinity;
};

const stat = (r: BandRig, k: string) => r.deck.stats[k] ?? 0;

const WALLS = [
  { tables: 4 },
  { tables: 5 },
  { tables: 6 },
  // Reach lower and higher than the default, and a wall of another shape.
  { tables: 5, adult: 0.32 * WALL_H },
  { tables: 5, adult: 0.5 * WALL_H },
  { tables: 4, W: 4800, H: 2400 },
];

describe("pinball deck on a wall", () => {
  it("keeps each chute and hole right above its table's exit and return", () => {
    for (const o of WALLS) {
      const r = bandRig(o);
      const { layout } = r;
      for (const s of r.deck.geo.slots) {
        const t = layout.tables[s.h]!;
        const tw = 1080 * t.place.k;
        // Within a venue px.
        expect(Math.abs(s.chuteX * layout.f - (t.place.x + exitU(t.mirror) * tw))).toBeLessThan(1);
        expect(Math.abs(s.holeX * layout.f - (t.place.x + returnU(t.mirror) * tw))).toBeLessThan(1);
        // Its slot is its share of the width, and its target stands over it.
        expect(s.x1 - s.x0).toBeCloseTo(layout.deckW / layout.tables.length, 6);
        const g = r.deck.geo.targets[s.index]!;
        expect(Math.min(g.ax, g.bx)).toBeGreaterThan(s.x0);
        expect(Math.max(g.ax, g.bx)).toBeLessThan(s.x1);
      }
      // A deck ball is DECK_GROW table balls or more, and comes up the chute at a table ball's size.
      const grow = (r.deck.geo.R * layout.f) / (BALL_R * layout.k);
      expect(grow).toBeGreaterThanOrEqual(DECK_GROW - 1e-9);
      expect(grow).toBeLessThanOrEqual(MAX_GROW + 1e-9);
      r.up(2, 77);
      const b = r.deck.balls.find((x) => x.ref === 77)!;
      expect(b.r * layout.f).toBeCloseTo(BALL_R * layout.k, 6);
      // The band fills the wall above the tables.
      expect(layout.deckH * layout.f + 1920 * layout.k).toBeCloseTo(o.H ?? WALL_H, 6);
      expect(layout.deckW * layout.f).toBeCloseTo(o.W ?? WALL_W, 6);
    }
  });

  it("keeps the playfield inside the band, clear of the chutes, with room between pieces", () => {
    for (const o of WALLS) {
      const r = bandRig(o);
      const geo = r.deck.geo;
      const { W, H, R } = geo;
      const solid = r.deck.world.shapes.filter((s) => !geo.slotShapes.includes(s));
      for (const sh of solid) {
        expect(sh.x0, `${sh.tag} in from the left`).toBeGreaterThanOrEqual(-R);
        expect(sh.x1, `${sh.tag} in from the right`).toBeLessThanOrEqual(W + R);
        expect(sh.y0, `${sh.tag} below the top`).toBeGreaterThanOrEqual(-R);
        if (sh.x0 <= 0 || sh.x1 >= W) continue;
        expect(sh.y1, `${sh.tag} above the chutes`).toBeLessThan(geo.launchY - R);
      }
      // A ball fits between any two round pieces.
      const round = [...geo.pops, ...geo.mushrooms, geo.big, ...geo.cluster.bumpers];
      for (let i = 0; i < round.length; i++) {
        for (let j = i + 1; j < round.length; j++) {
          const a = round[i]!;
          const b = round[j]!;
          const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
          expect(gap, `${a.tag} ${a.index} and ${b.tag} ${b.index}`).toBeGreaterThan(2 * R);
        }
      }
      // Rides stay inside the band.
      for (const rail of geo.rails) {
        for (const p of rail.pts) {
          const at = `${rail.name} at ${Math.round(p.x)}, ${Math.round(p.y)} on ${JSON.stringify(o)}`;
          expect(p.x, at).toBeGreaterThan(0);
          expect(p.x, at).toBeLessThan(W);
          expect(p.y, at).toBeGreaterThan(0);
          expect(p.y, at).toBeLessThan(geo.launchY);
        }
      }
      expect(geo.nest.y + geo.R).toBeLessThan(geo.shuttle.y - geo.shuttle.bumper.r);
      void H;
    }
  });

  it("gets deck shots up into the band from every chute", () => {
    let reached = 0;
    let tries = 0;
    for (const o of WALLS.slice(0, 3)) {
      const r = busy(o);
      for (const s of r.deck.geo.slots) {
        let any = false;
        for (let k = 0; k < 3; k++) {
          const ref = 500 + s.index * 10 + k;
          r.up(s.h, ref);
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
          if (caught || best < r.deck.geo.launchY * 0.5 || !gone) {
            reached++;
            any = true;
          }
        }
        expect(any, `chute ${s.index} of ${o.tables}`).toBe(true);
      }
    }
    expect(reached / tries).toBeGreaterThan(0.8);
  });

  it("rolls a ball down the left gutter into the saucer, which kicks it out", () => {
    const r = busy();
    const g = r.deck.geo.gutters[0]!;
    const U = r.deck.geo.U;
    const b = place(r, 1, g[0]!.x + 3 * U, g[0]!.y - 4 * U);
    expect(until(r, 4, () => b.dev === "saucer0")).toBeLessThan(4);
    expect(until(r, (SAUCER_MS + 200) / 1000, () => b.phase === "free")).toBeLessThan(2);
  });

  it("rolls a ball out of the lock's mouth down the right gutter into the other saucer", () => {
    const r = busy();
    const o = r.deck.geo.lock.out;
    const b = place(r, 3, o.x, o.y, o.vx, o.vy);
    expect(until(r, 5, () => b.dev === "saucer1")).toBeLessThan(5);
  });

  it("sends a ball up the left orbit, along the top and into the lock", () => {
    const r = busy();
    const gate = r.deck.geo.rails[0]!.gate!;
    const b = place(r, 1, (gate.ax + gate.bx) / 2, gate.ay + 200, 0, -2600);
    expect(until(r, 0.3, () => b.phase === "rail")).toBeLessThan(0.3);
    expect(stat(r, "orbit")).toBe(1);
    expect(until(r, 8, () => b.dev === "lock")).toBeLessThan(8);
  });

  it("sends a ball round the right orbit onto the left gutter and into its saucer", () => {
    const r = busy();
    const gate = r.deck.geo.rails[1]!.gate!;
    const b = place(r, 3, (gate.ax + gate.bx) / 2, gate.ay + 200, 0, -2600);
    expect(until(r, 10, () => b.dev === "saucer0")).toBeLessThan(10);
    expect(stat(r, "orbit")).toBe(1);
  });

  it("takes a ball round the loop and lets it go straight up from its right side", () => {
    const r = busy();
    const gate = r.deck.geo.rails[2]!.gate!;
    const cx = (gate.ax + gate.bx) / 2;
    const cy = (gate.ay + gate.by) / 2;
    const b = place(r, 2, cx - 120, cy, 2600, -100);
    expect(until(r, 0.3, () => b.phase === "rail")).toBeLessThan(0.3);
    expect(stat(r, "loop")).toBe(1);
    expect(until(r, 4, () => b.phase === "free")).toBeLessThan(4);
    expect(b.x).toBeGreaterThan(r.deck.geo.cluster.x);
    expect(b.vy).toBeLessThan(-1000);
  });

  it("kicks a ball up from the scoop along its ramp and into the lock", () => {
    const r = busy();
    const v = r.deck.geo.vuk;
    const b = place(r, 2, v.x, v.y - 100, 0, 600);
    expect(until(r, 1, () => b.dev === "vuk")).toBeLessThan(1);
    expect(until(r, 8, () => b.dev === "lock")).toBeLessThan(8);
    expect(stat(r, "ramp")).toBe(1);
  });

  it("flings each magnet's catches at its targets in turn", () => {
    for (const o of WALLS) {
      for (const [i, wants] of [
        [0, ["orbit", "loop", "captive"]],
        [1, ["orbit", "big"]],
      ] as const) {
        const r = busy(o);
        const m = r.deck.geo.magnets[i]!;
        for (const want of wants) {
          const before = stat(r, want);
          const capY = r.deck.parts.captive.y;
          let top = Infinity;
          const b = place(r, 1, m.x, m.y - m.r * 0.5, 0, 400);
          expect(until(r, 0.3, () => b.dev === `magnet${i}`)).toBeLessThan(0.3);
          const took = until(r, 4, () => {
            top = Math.min(top, r.deck.parts.captive.y);
            if (want === "big" && stat(r, "cluster") + stat(r, "big") > 0) return true;
            return stat(r, want) > before || (want === "captive" && top < capY - r.deck.geo.U * 3);
          });
          expect(took, `magnet ${i} at ${want} on ${JSON.stringify(o)}`).toBeLessThan(4);
          r.step(2);
        }
      }
    }
  });

  it("scores the captive ball for the table whose ball knocked it up", () => {
    const r = busy();
    const c = r.deck.geo.captive;
    place(r, 1, c.rest.x, c.box.y1 + 160, 0, -2800);
    expect(until(r, 2, () => stat(r, "captive") > 0)).toBeLessThan(2);
    r.step(0.6);
    const mine = r.points.flatMap((p) => p.list.filter((x) => x[0] === 1).map((x) => x[1]));
    expect(mine.reduce((a, n) => a + n, 0)).toBeGreaterThanOrEqual(DECK_POINTS.captive);
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
  });

  it("tips the nest out to the playing tables and pays the shooters", () => {
    const r = bandRig();
    r.playing(1);
    r.playing(3);
    r.step(3);
    const nest = r.deck.parts.nest;
    for (let k = 0; k < 3; k++) {
      const b = place(r, k === 0 ? 1 : 3, nest.x + (k - 1) * 30, r.deck.geo.nest.y - 40, 0, 300);
      expect(
        until(r, 0.3, () => b.dev === "nest"),
        `ball ${k}`,
      ).toBeLessThan(0.3);
    }
    r.downs.length = 0;
    expect(until(r, 4, () => stat(r, "pour") > 0)).toBeLessThan(4);
    r.step(5);
    expect(r.downs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(r.downs.map((d) => d.slot.h))).toEqual(new Set([1, 3]));
  });

  it("pops a bubble with a table's ball and sends that table its gift", () => {
    const r = busy();
    r.step(1);
    const bubbles = r.deck.parts.bubbles;
    bubbles.clear();
    const s = r.deck.geo.slots[3]!;
    const bub = bubbles.spawn(s.holeX, "posts", 3, r.now)!;
    place(r, 3, bub.x, bub.y + 300, 0, -2500);
    expect(until(r, 1, () => stat(r, "bubble") > 0)).toBeLessThan(1);
    expect(r.gifts).toHaveLength(1);
    expect(r.gifts[0]!.slot).toBe(s);
    expect(GIFTS[r.gifts[0]!.m.k]).toBe("posts");
  });

  it("sends a fallen ball down to a playing table and rains on every playing table", () => {
    const r = busy();
    const a = place(r, 0, r.deck.geo.slots[4]!.holeX, r.deck.geo.holeY - 10, 0, 300);
    expect(until(r, 1, () => r.downs.some((d) => d.m.i === a.id))).toBeLessThan(1);
    expect(r.downs.find((d) => d.m.i === a.id)!.slot.h).toBe(4);
    r.downs.length = 0;
    r.deck.rain(r.now);
    r.step(3);
    expect(new Set(r.downs.map((d) => d.slot.h))).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it("keeps its balls within DECK_MAX and in bounds, and plays on by itself", () => {
    const r = busy();
    const geo = r.deck.geo;
    for (let i = 0; i < 120; i++) {
      r.up(i % 5, 2000 + i);
      r.step(0.1);
      const live = r.deck.balls.filter((b) => b.phase !== "guided" && b.phase !== "fall");
      expect(live.length).toBeLessThanOrEqual(DECK_MAX);
      expect(r.deck.balls.length).toBeLessThanOrEqual(DECK_MAX + 8);
      for (const b of live) {
        if (b.phase !== "free") continue;
        expect(b.x).toBeGreaterThan(0);
        expect(b.x).toBeLessThan(geo.W);
        expect(b.y).toBeGreaterThan(geo.ceiling);
      }
    }
    for (let t = 0; t < 60; t += 1) {
      r.step(1);
      expect(r.deck.balls.length).toBeLessThanOrEqual(DECK_MAX + 8);
    }
  });

  it("runs on its own with nobody playing, using its devices", () => {
    const r = bandRig();
    r.step(120);
    // No table has reported a game, so there is nobody to send a ball to.
    expect(r.downs).toHaveLength(0);
    expect(r.deck.balls.length).toBeLessThanOrEqual(12);
    const used = ["saucer", "magnet", "vuk", "lock", "orbit", "loop", "nest", "big", "pop"].filter(
      (k) => stat(r, k) > 0,
    );
    expect(used.length, JSON.stringify(r.deck.stats)).toBeGreaterThanOrEqual(4);
  });

  it("sends every ball that falls down to the attract tables below", () => {
    const r = bandRig();
    const fell = new Set<number>();
    for (let t = 0; t < 120; t += 1) {
      for (let h = 0; h < 5; h++) r.attract(h);
      if (t % 8 === 0) r.up(t % 5, 3000 + t);
      for (let k = 0; k < 120; k++) {
        r.step(1 / 120);
        for (const b of r.deck.balls) if (b.phase === "fall") fell.add(b.id);
      }
    }
    expect(fell.size).toBeGreaterThan(40);
    expect(r.downs).toHaveLength(fell.size);
    expect(new Set(r.downs.map((d) => d.slot.h))).toEqual(new Set([0, 1, 2, 3, 4]));
  });
});
