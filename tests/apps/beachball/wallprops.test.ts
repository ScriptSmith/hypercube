import { describe, expect, it } from "vitest";
import { isRed, isYellow } from "../../../src/apps/beachball/palettes";
import { pxPerM, wallLayout } from "../../../src/apps/beachball/walllayout";
import { netScene } from "../../../src/apps/beachball/wallnet";
import {
  createWorld,
  GRAB,
  MAX_PROP_SPEED,
  netFlight,
  type Prop,
  type World,
} from "../../../src/apps/beachball/wallphysics";
import {
  extentAt,
  PROP_KINDS,
  PROP_PAINT,
  PROP_SPECS,
  type PropKind,
} from "../../../src/apps/beachball/wallprops";
import { SUN } from "../../../src/apps/beachball/wallshade";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { createRng } from "../../../src/core/rng";

const DT = 1 / 120;
const WALL = VENUE_SIZE.wall;
const REACH = DEFAULT_REACH.wall;
const fits = PROP_KINDS.map((k) => {
  const e = extentAt(PROP_SPECS[k], PROP_SPECS[k].rest);
  return { left: e.left, right: e.right };
});

const beach = (balls = 2, net = true, seed = "toys", toys = true) => {
  const l = wallLayout(WALL.width, WALL.height, REACH, balls, { net, props: toys ? fits : [] });
  const w = createWorld(
    createRng(seed),
    balls,
    l.radius,
    { width: l.width, height: l.height, floor: l.floor },
    l.rest,
    {
      props: toys ? PROP_KINDS.map((kind, i) => ({ kind, x: l.props[i]! })) : [],
      net: l.net,
    },
  );
  return { l, w };
};

const run = (w: World, seconds: number, each?: () => void) => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    each?.();
    w.step(DT);
  }
};

const prop = (w: World, kind: PropKind) => w.props.find((p) => p.kind === kind)!;

const discs = (p: Prop) =>
  p.spec.discs.map((d) => ({
    x: p.x + Math.cos(p.a) * d.x - Math.sin(p.a) * d.y,
    y: p.y + Math.sin(p.a) * d.x + Math.cos(p.a) * d.y,
    r: d.r,
  }));

const lowest = (p: Prop) => Math.min(...discs(p).map((d) => d.y - d.r));

/** How far each pair of things overlaps at worst, metres. */
const worstOverlap = (w: World) => {
  let worst = 0;
  const all = [
    ...w.balls.map((b) => [{ x: b.x, y: b.y, r: b.r }]),
    ...w.props.map((p) => discs(p)),
  ];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      for (const a of all[i]!) {
        for (const b of all[j]!)
          worst = Math.max(worst, a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
  }
  return worst;
};

/** How far anything reaches into the net, metres. */
const intoNet = (w: World) => {
  const n = w.net;
  let worst = 0;
  let who = "";
  if (!n) return { worst, who };
  const check = (x: number, y: number, r: number, name: string) => {
    const qy = Math.min(n.top, Math.max(w.bounds.floor, y));
    const d = r + n.radius - Math.hypot(x - n.x, y - qy);
    if (d > worst) {
      worst = d;
      who = name;
    }
  };
  for (const b of w.balls) check(b.x, b.y, b.r, `ball ${b.index}`);
  for (const p of w.props) {
    for (const d of discs(p))
      check(d.x, d.y, d.r, `${p.kind} ${p.vx.toFixed(1)},${p.vy.toFixed(1)}`);
  }
  return { worst, who };
};

const inBounds = (w: World) => {
  for (const b of w.balls) {
    expect(b.x - b.r).toBeGreaterThanOrEqual(-1e-6);
    expect(b.x + b.r).toBeLessThanOrEqual(w.bounds.width + 1e-6);
    expect(b.y - b.r).toBeGreaterThanOrEqual(w.bounds.floor - 1e-6);
  }
  for (const p of w.props) {
    // Sand and sides give a little for a moment under a hard knock.
    for (const d of discs(p)) {
      expect(d.x - d.r).toBeGreaterThan(-0.05);
      expect(d.x + d.r).toBeLessThan(w.bounds.width + 0.05);
      expect(d.y - d.r).toBeGreaterThan(w.bounds.floor - 0.05);
      expect(d.y + d.r).toBeLessThan(w.bounds.height + 0.05);
    }
  }
};

describe("beach toys", () => {
  it("are large targets, centred on their mass, and never red or yellow", () => {
    for (const kind of PROP_KINDS) {
      const s = PROP_SPECS[kind];
      const e = extentAt(s, s.rest);
      // With the grab margin each one is at least 120 venue px across and high.
      expect((e.right - e.left + 2 * GRAB) * pxPerM()).toBeGreaterThan(120);
      expect((e.top - e.bottom + 2 * GRAB) * pxPerM()).toBeGreaterThan(120);
      expect(e.left).toBeLessThan(0);
      expect(e.right).toBeGreaterThan(0);
      expect(s.mass).toBeGreaterThan(0);
      expect(s.inertia).toBeGreaterThan(0);
    }
    for (const hex of Object.values(PROP_PAINT)) {
      expect(isRed(hex), hex).toBe(false);
      expect(isYellow(hex), hex).toBe(false);
    }
  });

  it("are put out along the sand, clear of the balls, the net and each other", () => {
    for (const n of [1, 2, 3]) {
      for (const net of [true, false]) {
        const { l, w } = beach(n, net);
        const spans = w.props.map((p) => {
          const e = extentAt(p.spec, p.a);
          return [p.x + e.left, p.x + e.right] as const;
        });
        spans.sort((a, b) => a[0] - b[0]);
        for (let i = 0; i < spans.length; i++) {
          expect(spans[i]![0]).toBeGreaterThan(0.1);
          expect(spans[i]![1]).toBeLessThan(l.width - 0.1);
          if (i > 0) expect(spans[i]![0]).toBeGreaterThan(spans[i - 1]![1] + 0.1);
          for (const x of l.rest) {
            expect(spans[i]![1] < x - l.radius - 0.2 || spans[i]![0] > x + l.radius + 0.2).toBe(
              true,
            );
          }
          if (l.net) {
            expect(spans[i]![1] < l.net.x - 0.3 || spans[i]![0] > l.net.x + 0.3).toBe(true);
          }
        }
        for (const p of w.props) {
          expect(lowest(p)).toBeCloseTo(l.floor, 3);
          // Every toy sits within a child's reach.
          expect(p.y + extentAt(p.spec, p.a).top).toBeLessThan(l.childTop);
        }
        if (l.net) {
          for (const x of l.rest) expect(Math.abs(x - l.net.x)).toBeGreaterThan(l.radius + 0.5);
        }
      }
    }
  });

  it("settle on the sand within a few seconds of a drop, upright or on a side", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const { w, l } = beach(2, true, seed);
      const rng = createRng(seed);
      for (const p of w.props) {
        p.y = rng.range(1.5, 3);
        p.a = rng.range(-Math.PI, Math.PI);
        p.w = rng.range(-6, 6);
        p.vx = rng.range(-1, 1);
        w.kickProp(p.index, p.vx, 0, p.w);
      }
      run(w, 5);
      for (const p of w.props) {
        expect(p.asleep, `${seed} ${p.kind}`).toBe(true);
        expect(p.grounded, `${seed} ${p.kind}`).toBe(true);
        expect(lowest(p)).toBeGreaterThan(l.floor - 0.02);
        expect(lowest(p)).toBeLessThan(l.floor + 0.02);
      }
      inBounds(w);
      expect(worstOverlap(w)).toBeLessThan(0.02);
    }
  });

  it("are carried by the point a finger holds, hanging from it", () => {
    const { w } = beach();
    const b = prop(w, "bucket");
    const e = extentAt(b.spec, b.a);
    // Take it by the left of its rim and lift it clear of the sand.
    const gx = b.x + e.left + 0.03;
    const gy = b.y + e.top - 0.03;
    expect(w.down(1, gx, gy)).toBe("grab");
    expect(b.holder).toBe(1);
    const fx = gx + 0.5;
    const fy = gy + 1;
    let i = 0;
    run(w, 3, () => {
      const u = Math.min(1, ++i / 60);
      w.move(1, gx + 0.5 * u, gy + u, u < 1 ? 1 : 0, u < 1 ? 2 : 0);
    });
    // The grip stays at the finger and the bucket hangs from it, tipped well over.
    expect(Math.abs(b.x - fx)).toBeLessThan(0.1);
    expect(b.y).toBeLessThan(fy - 0.25);
    expect(Math.abs(b.a)).toBeGreaterThan(0.5);
    // It swings on when the finger stops after moving sideways.
    run(w, 0.25, () => w.move(1, fx + 0.8, fy, 3.2, 0));
    let swing = 0;
    run(w, 1, () => {
      w.move(1, fx + 0.8, fy, 0, 0);
      swing = Math.max(swing, Math.abs(b.w));
    });
    expect(swing).toBeGreaterThan(1);
    expect(w.up(1)).toBe("drop");
    run(w, 4);
    expect(b.grounded).toBe(true);
  });

  it("fly when flicked", () => {
    const { w, l } = beach();
    const s = prop(w, "bottle");
    expect(w.down(1, s.x, s.y)).toBe("grab");
    for (let i = 1; i <= 12; i++) {
      w.move(1, s.x + i * 0.04, s.y + i * 0.06, 4.5, 6.5);
      w.step(DT);
    }
    expect(w.up(1)).toBe("throw");
    expect(s.vy).toBeGreaterThan(5);
    let top = 0;
    run(w, 1.2, () => (top = Math.max(top, s.y)));
    expect(top).toBeGreaterThan(l.childTop);
    run(w, 5);
    expect(s.grounded).toBe(true);
    expect(w.drain().some((e) => e.kind === "throw" && e.prop === s.index)).toBe(true);
  });

  it("pop up and flip over when tapped", () => {
    for (const kind of PROP_KINDS) {
      const { w } = beach();
      const p = prop(w, kind);
      const y0 = p.y;
      const e = extentAt(p.spec, p.a);
      expect(w.down(1, p.x + e.left * 0.5, p.y)).toBe("grab");
      expect(w.up(1)).toBe("tap");
      let top = 0;
      let turned = 0;
      let last = p.a;
      run(w, 4, () => {
        top = Math.max(top, p.y);
        let d = p.a - last;
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        turned += d;
        last = p.a;
      });
      expect(top - y0, kind).toBeGreaterThan(0.25);
      expect(Math.abs(turned), kind).toBeGreaterThan(1);
      expect(p.grounded, kind).toBe(true);
    }
  });

  it("are batted by a swipe that sweeps into them", () => {
    const { w } = beach();
    const h = prop(w, "sunnies");
    const x0 = h.x;
    w.down(1, h.x - 0.7, h.y);
    for (let i = 1; i <= 16; i++) {
      w.move(1, h.x - 0.7 + i * 0.08, h.y + i * 0.01, 9.6, 1.2);
      w.step(DT);
    }
    w.up(1);
    expect(w.drain().some((e) => e.kind === "bat" && e.prop === h.index)).toBe(true);
    run(w, 0.4);
    expect(h.x - x0).toBeGreaterThan(0.4);
  });

  it("are knocked about by balls, and wake to it", () => {
    const { w } = beach();
    const b = w.balls[1]!;
    const bucket = prop(w, "bucket");
    expect(bucket.asleep).toBe(true);
    const x0 = bucket.x;
    b.x = bucket.x - 1.6;
    w.kick(1, 6, 1);
    run(w, 1.5);
    expect(Math.abs(bucket.x - x0)).toBeGreaterThan(0.05);
    run(w, 6);
    expect(worstOverlap(w)).toBeLessThan(0.02);
  });

  it("never stay perched up high, on a ball or on the net", () => {
    const { w, l } = beach();
    const ball = w.balls[0]!;
    const bucket = prop(w, "bucket");
    // A bucket balanced on top of a resting ball.
    bucket.x = ball.x;
    bucket.a = 0;
    bucket.y = ball.y + ball.r - extentAt(bucket.spec, 0).bottom + 0.01;
    w.kickProp(bucket.index, 0, 0, 0);
    // A hat dropped dead on top of the net.
    const hat = prop(w, "hat");
    hat.x = l.net!.x;
    hat.a = 0;
    hat.y = l.net!.top + 0.3;
    w.kickProp(hat.index, 0, 0, 0);
    run(w, 8);
    for (const p of [bucket, hat]) {
      expect(p.asleep, p.kind).toBe(true);
      expect(lowest(p), p.kind).toBeLessThan(l.floor + 0.5);
      expect(Math.abs(p.x - l.net!.x), p.kind).toBeGreaterThan(0.1);
    }
  });

  it("put back where they started", () => {
    const { w, l } = beach();
    for (const p of w.props) w.kickProp(p.index, 3, 6, 5, 4);
    run(w, 3);
    w.props.forEach((p, i) => w.placeProp(i, l.props[i]!));
    w.props.forEach((p, i) => {
      expect(p.x).toBeCloseTo(l.props[i]!, 6);
      expect(p.a).toBe(p.spec.rest);
      expect(p.asleep).toBe(true);
      expect(lowest(p)).toBeCloseTo(l.floor, 3);
    });
  });

  it("stay in bounds, apart and out of the net through an hour of kicks and swipes", () => {
    const rng = createRng("hour");
    const { w, l } = beach(3);
    const seconds = 3600;
    let worstNet = 0;
    let worstAt = "";
    let crossings = 0;
    const sides = [...w.balls, ...w.props].map((b) => (b.x < w.net!.x ? -1 : 1));
    let worstPair = 0;
    let id = 10;
    let next = 0;
    let t = 0;
    while (t < seconds) {
      if (t >= next && t < seconds - 30) {
        next = t + rng.range(1.5, 4);
        const r = rng.next();
        if (r < 0.3) {
          const k = rng.int(w.props.length);
          w.kickProp(
            k,
            rng.range(-MAX_PROP_SPEED, MAX_PROP_SPEED),
            rng.range(-4, 12),
            rng.range(-20, 20),
          );
        } else if (r < 0.45) {
          w.kick(rng.int(3), rng.range(-12, 12), rng.range(-4, 12), [
            rng.range(-9, 9),
            0,
            rng.range(-9, 9),
          ]);
        } else {
          // A fast swipe, or a grab, a drag and a throw, somewhere along the wall.
          const f = id++;
          let x = rng.range(0.2, l.width - 0.2);
          let y = rng.range(l.floor + 0.05, l.adultTop);
          const dx = rng.range(-0.15, 0.15);
          const dy = rng.range(-0.05, 0.12);
          w.down(f, x, y);
          for (let s = 0; s < 14; s++) {
            x += dx;
            y += dy;
            w.move(f, x, y, dx / DT, dy / DT);
            w.step(DT);
            t += DT;
          }
          w.up(f);
        }
      }
      w.step(DT);
      t += DT;
      const into = intoNet(w);
      if (into.worst > worstNet) {
        worstNet = into.worst;
        worstAt = `${t.toFixed(2)} ${into.who}`;
      }
      // Below the net's top a centre never changes sides: things cross only over it.
      const n = w.net!;
      [...w.balls, ...w.props].forEach((b, i) => {
        const side = b.x < n.x ? -1 : 1;
        if (b.y >= n.top) sides[i] = side;
        else if (side !== sides[i]) crossings++;
      });
      if (Math.round(t / DT) % 60 === 0) {
        worstPair = Math.max(worstPair, worstOverlap(w));
        inBounds(w);
      }
    }
    inBounds(w);
    // A finger can squeeze something against the net for a moment, but nothing goes through.
    expect(worstNet, worstAt).toBeLessThan(0.1);
    expect(crossings).toBe(0);
    expect(worstPair).toBeLessThan(0.08);
    // Everything has come to rest on the sand, or low on something else on it.
    for (const p of w.props) {
      expect(p.asleep, p.kind).toBe(true);
      expect(lowest(p), p.kind).toBeLessThan(l.floor + 0.5);
    }
    for (const b of w.balls) expect(b.y - b.r).toBeLessThan(l.floor + 0.3);
  }, 120_000);
});

describe("the net", () => {
  it("stands well within an adult's reach, above a resting ball", () => {
    const l = wallLayout(WALL.width, WALL.height, REACH, 2, { net: true });
    const n = l.net!;
    expect(n.x).toBeCloseTo(l.width / 2, 6);
    expect(n.top).toBeLessThan(0.85 * l.adultTop);
    expect(n.top).toBeGreaterThan(l.floor + 2 * l.radius + 0.2);
    expect(n.bottom).toBeLessThan(n.top - 0.5);
    for (const reach of [
      { adult: 0.35, child: 0.2 },
      { adult: 0.6, child: 0.3 },
    ]) {
      const m = wallLayout(WALL.width, WALL.height, reach, 2, { net: true });
      expect(m.net!.top).toBeLessThan(m.adultTop);
    }
    // One ball goes on the left, two either side, three two and one.
    expect(wallLayout(WALL.width, WALL.height, REACH, 1, { net: true }).rest[0]).toBeLessThan(n.x);
    const three = wallLayout(WALL.width, WALL.height, REACH, 3, { net: true }).rest;
    expect(three.filter((x) => x < n.x)).toHaveLength(2);
  });

  it("is drawn standing on the sand short of the wash, its shadow beside it", () => {
    const l = wallLayout(WALL.width, WALL.height, REACH, 2, { net: true });
    const s = netScene(l.net!, l.floor, l.horizon, l.shore, l.width, SUN);
    expect(s.length).toBeGreaterThan(1.5);
    const far = s.fz + s.uz * s.length;
    // The wash runs up to about where the sand drawn 0.32 m below the shore line is.
    const washY = l.shore - 0.32;
    const wash = (washY * 3) / (l.horizon - washY);
    expect(far).toBeLessThan(wash);
    expect(s.top).toBeGreaterThan(s.bottom);
    expect(s.box[0]).toBeLessThan(l.width / 2);
    expect(s.box[2]).toBeGreaterThan(l.width / 2);
    expect(s.box[3]).toBeLessThan(l.horizon + 0.2);
    expect(s.shade[0]).toBeLessThanOrEqual(s.fx);
  });

  it("stops a ball, softly in the mesh, and lets it drop on its own side", () => {
    const { w, l } = beach(2, true);
    const b = w.balls[0]!;
    b.x = l.net!.x - 1.5;
    b.y = (l.net!.top + l.net!.bottom) / 2;
    b.grounded = false;
    w.kick(0, 8, 0);
    let fastest = 0;
    let after = false;
    run(w, 3, () => {
      if (b.x > l.net!.x - b.r - l.net!.radius - 0.01) after = true;
      if (after) fastest = Math.max(fastest, Math.abs(b.vx));
      expect(b.x).toBeLessThan(l.net!.x);
    });
    // The mesh takes most of its speed.
    expect(fastest).toBeLessThan(2.5);
    run(w, 4);
    expect(b.grounded).toBe(true);
    expect(b.x).toBeLessThan(l.net!.x);
  });

  it("lets nothing rest on its top", () => {
    // Without toys, which a ball rolling off could come to rest on instead of the sand.
    const { w, l } = beach(2, true, "toys", false);
    const b = w.balls[0]!;
    b.x = l.net!.x;
    b.y = l.net!.top + b.r + 0.3;
    b.grounded = false;
    w.kick(0, 0, 0);
    run(w, 6);
    expect(b.grounded).toBe(true);
    expect(Math.abs(b.x - l.net!.x)).toBeGreaterThan(b.r);
  });

  it("is cleared by a ball tossed hard enough", () => {
    const { w, l } = beach(2, true, "over", false);
    const n = l.net!;
    const b = w.balls[0]!;
    const f = netFlight(n, l.floor, b.x, b.y, 4.5, 8, b.r);
    expect(f.clear).toBeGreaterThan(0);
    expect(f.land).toBeGreaterThan(n.x);
    w.kick(0, 4.5, 8);
    run(w, 6);
    expect(b.x).toBeGreaterThan(n.x);
  });

  it("is cleared by a ball a finger swipes up through from under it", () => {
    // A ball on the sand can only be struck low, so it is popped up first, as people do.
    const { w, l } = beach(2, true, "over", false);
    const n = l.net!;
    const c = w.balls[1]!;
    w.place(1, n.x + 1.5);
    c.y = 1.5;
    c.grounded = false;
    const sx = c.x + 0.4;
    const sy = c.y - 0.75;
    expect(w.down(1, sx, sy)).toBe("none");
    for (let i = 1; i <= 10; i++) {
      w.move(1, sx - i * 0.04, sy + i * 0.12, -4.8, 14.4);
      w.step(DT);
    }
    expect(w.drain().some((e) => e.kind === "bat" && e.ball === 1)).toBe(true);
    w.up(1);
    run(w, 6);
    expect(c.x).toBeLessThan(n.x);
    expect(c.grounded).toBe(true);
  });

  it("keeps held things on their side and makes the finger let go", () => {
    const { w, l } = beach(2, true);
    const n = l.net!;
    const b = w.balls[0]!;
    w.place(0, n.x - 1);
    w.down(1, b.x, b.y);
    for (let i = 1; i <= 120; i++) {
      w.move(1, n.x - 1 + i * 0.02, b.y, 2.4, 0);
      w.step(DT);
      expect(b.x).toBeLessThan(n.x);
    }
    expect(b.holder).toBe(null);
    const s = prop(w, "spade");
    const side = Math.sign(s.x - n.x);
    w.down(2, s.x, s.y);
    for (let i = 1; i <= 150; i++) {
      w.move(2, s.x - side * i * 0.03, s.y + 0.1, -side * 3.6, 0);
      w.step(DT);
    }
    expect(Math.sign(s.x - n.x)).toBe(side);
    expect(s.holder).toBe(null);
    w.up(2);
  });
});
