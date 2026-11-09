import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { buildPlayfield } from "../../../src/apps/pinball/deckgeo";
import {
  createBubbles,
  createLock,
  createMagnet,
  createNest,
  createSaucer,
  createUpKicker,
  type DeckBall,
  LOCK_MS,
  LOCK_SIZE,
  MAGNET_MS,
  NEST_MS,
  NEST_TIP_MS,
  type Release,
  SAUCER_MS,
  VUK_MS,
} from "../../../src/apps/pinball/deckparts";
import { makeBall } from "../../../src/apps/pinball/physics";

const W = VENUE_SIZE.screen.width;
const H = VENUE_SIZE.screen.height;
const pf = buildPlayfield(W, H);

let ids = 1;
const ballAt = (x: number, y: number, vx = 0, vy = 0): DeckBall => {
  const b = makeBall(ids++, x, y, 30) as DeckBall;
  b.vx = vx;
  b.vy = vy;
  b.phase = "free";
  b.dev = "";
  b.rail = -1;
  return b;
};

/** Run a device from `t0` for `ms`, collecting what it lets go. */
const run = (d: { update(now: number, out: Release[]): void }, t0: number, ms: number) => {
  const out: Release[] = [];
  for (let t = t0; t <= t0 + ms; t += 1000 / 120) d.update(t, out);
  return out;
};

describe("pinball deck devices", () => {
  it("saucer: takes a slow ball, holds it in the middle, kicks it out, then rests", () => {
    const spec = pf.saucers[0]!;
    const s = createSaucer(spec, "saucer0");
    const fast = ballAt(spec.x, spec.y, 0, 4000);
    expect(s.wants(fast, 0)).toBe(false);
    const b = ballAt(spec.x + spec.r * 0.5, spec.y, 600, 200);
    expect(s.wants(b, 0)).toBe(true);
    s.take(b, 0);
    expect(b.phase).toBe("held");
    expect(s.wants(ballAt(spec.x, spec.y), 10)).toBe(false);
    expect(run(s, 0, SAUCER_MS - 50)).toHaveLength(0);
    expect(Math.hypot(b.x - spec.x, b.y - spec.y)).toBeLessThan(1);
    const out = run(s, SAUCER_MS - 40, 100);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ball: b, vx: spec.kick.vx, vy: spec.kick.vy });
    expect(s.held).toHaveLength(0);
    // It doesn't take another straight away, so the one it kicked can get clear.
    expect(s.wants(ballAt(spec.x, spec.y), SAUCER_MS + 100)).toBe(false);
    expect(s.wants(ballAt(spec.x, spec.y), SAUCER_MS + 2000)).toBe(true);
  });

  it("magnet: catches a passing ball, pulls it in, flings it at each target in turn", () => {
    const spec = pf.magnets[1]!;
    const m = createMagnet(spec, "magnet1");
    const flings: Release[] = [];
    let t = 0;
    for (let k = 0; k < 4; k++) {
      const b = ballAt(spec.x + spec.r * 0.8, spec.y, -2500, 1500);
      expect(m.wants(b, t)).toBe(true);
      m.take(b, t);
      expect(m.held).toEqual([b]);
      expect(run(m, t, 300)).toHaveLength(0);
      expect(Math.hypot(b.x - spec.x, b.y - spec.y)).toBeLessThan(spec.r * 0.1);
      const out = run(m, t + 300, MAGNET_MS);
      expect(out).toHaveLength(1);
      flings.push(out[0]!);
      t += MAGNET_MS + 2000;
    }
    const aims = spec.aims;
    flings.forEach((f, i) => {
      expect(f).toMatchObject({ vx: aims[i % aims.length]!.vx, vy: aims[i % aims.length]!.vy });
    });
    expect(m.flung).toBe(4);
  });

  it("up-kicker: takes a falling ball and sends it up its ramp", () => {
    const v = createUpKicker(pf.vuk);
    expect(v.wants(ballAt(pf.vuk.x, pf.vuk.y, 0, -2000), 0)).toBe(false);
    const b = ballAt(pf.vuk.x, pf.vuk.y - 10, 50, 800);
    expect(v.wants(b, 0)).toBe(true);
    v.take(b, 0);
    expect(run(v, 0, VUK_MS - 50)).toHaveLength(0);
    const out = run(v, VUK_MS - 40, 100);
    expect(out).toEqual([{ ball: b, rail: pf.vuk.rail, why: "vuk" }]);
    expect(pf.rails[pf.vuk.rail]!.name).toBe("vuk");
  });

  it("lock: fills up, then lets every ball go together as a multiball", () => {
    const l = createLock(pf.lock);
    const m = pf.lock.mouth;
    const held: DeckBall[] = [];
    for (let i = 0; i < LOCK_SIZE; i++) {
      const b = ballAt(m.x, m.y, 0, 300);
      expect(l.wants(b, i * 500)).toBe(true);
      l.take(b, i * 500);
      held.push(b);
      if (i < LOCK_SIZE - 1) expect(run(l, i * 500, 400)).toHaveLength(0);
    }
    expect(l.wants(ballAt(m.x, m.y), 1100)).toBe(false);
    const out = run(l, 1000, 2000);
    expect(out.map((r) => r.ball)).toEqual(held);
    expect(out.every((r) => r.why === "multiball")).toBe(true);
    expect(l.held).toHaveLength(0);
    // Back to taking balls once it has rested.
    expect(l.wants(ballAt(m.x, m.y), 5000)).toBe(true);
  });

  it("lock: lets a lone ball go after LOCK_MS", () => {
    const l = createLock(pf.lock);
    const b = ballAt(pf.lock.mouth.x, pf.lock.mouth.y);
    l.take(b, 0);
    expect(run(l, 0, LOCK_MS - 100)).toHaveLength(0);
    const out = run(l, LOCK_MS - 90, 1000);
    expect(out).toHaveLength(1);
    expect(out[0]!.why).toBe("lock");
    // Held balls sit in its tube, below the mouth.
    expect(pf.lock.stack[0]!.y).toBeGreaterThan(pf.lock.mouth.y);
  });

  it("nest: catches falling balls in its cups and tips them out when full", () => {
    const n = createNest(pf.nest, pf.U);
    n.aimAt(W / 2, 3);
    run(n, 0, 100);
    expect(n.cups).toBe(3);
    const y = pf.nest.y - 10;
    // Rising balls pass through it.
    expect(n.wants(ballAt(n.x, y, 0, -2000), 200)).toBe(false);
    const balls = [-1, 0, 1].map((k) => ballAt(n.x + k * pf.U, y, 0, 600));
    balls.slice(0, 2).forEach((b) => {
      expect(n.wants(b, 200)).toBe(true);
      n.take(b, 200);
    });
    expect(run(n, 200, 1000)).toHaveLength(0);
    expect(n.cupBalls.filter(Boolean)).toHaveLength(2);
    n.take(balls[2]!, 1300);
    // Full: it tips and pours them all.
    const out = run(n, 1300, NEST_TIP_MS + 200);
    expect(out).toHaveLength(3);
    expect(out.every((r) => "pour" in r)).toBe(true);
    expect(n.held).toHaveLength(0);
    expect(n.tilt(1300 + NEST_TIP_MS + 2000)).toBe(0);
  });

  it("nest: tips by itself NEST_MS after its first ball, and follows the playing tables", () => {
    const n = createNest(pf.nest, pf.U);
    n.aimAt(W / 2, 6);
    run(n, 0, 50);
    expect(n.cups).toBe(6);
    const b = ballAt(n.x, pf.nest.y - 10, 0, 500);
    n.take(b, 100);
    expect(run(n, 100, NEST_MS - 200)).toHaveLength(0);
    expect(run(n, NEST_MS - 90, NEST_TIP_MS + 300)).toHaveLength(1);
    // It glides towards where it is sent, within its track, and changes cups only when empty.
    n.aimAt(0, 2);
    run(n, NEST_MS + 1000, 20_000);
    expect(n.x).toBeCloseTo(pf.nest.minX, 0);
    expect(n.cups).toBe(3);
  });

  it("bubbles: at most three rise at once, pop on touch and drift off the top", () => {
    const bs = createBubbles(pf.bubbles, H);
    for (let i = 0; i < 5; i++) bs.spawn(1000 + i * 400, "shield", i, 0);
    expect(bs.live()).toBe(3);
    const first = bs.list[0]!;
    bs.update(1000, 1);
    expect(first.y).toBeLessThan(pf.bubbles.y0);
    const b = ballAt(first.x, first.y + pf.bubbles.r + 20);
    expect(bs.hit(b, 1000)).toBe(first);
    expect(bs.hit(b, 1000)).toBeNull();
    expect(bs.live()).toBe(2);
    // The popped one shows its ring briefly, then is gone; the rest rise off the top.
    for (let t = 1000; t < 60_000; t += 100) bs.update(t, 0.1);
    expect(bs.list).toHaveLength(0);
  });

  it("every device lets go at once when told to", () => {
    const now = 0;
    const devices = [
      createSaucer(pf.saucers[0]!, "s"),
      createMagnet(pf.magnets[0]!, "m"),
      createUpKicker(pf.vuk),
      createLock(pf.lock),
      createNest(pf.nest, pf.U),
    ];
    for (const d of devices) {
      const b = ballAt(0, 0);
      d.take(b, now);
      expect(d.held).toContain(b);
      expect(d.drop(b, now)).toBe(true);
      expect(d.held).not.toContain(b);
      expect(d.drop(b, now)).toBe(false);
    }
  });
});
