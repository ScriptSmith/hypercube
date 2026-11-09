import { describe, expect, it } from "vitest";
import { layoutFrame, type Way } from "../../../src/apps/ballpit/layout";
import { filleted, pointAt } from "../../../src/apps/ballpit/pipes";
import {
  type Ball,
  buildRoute,
  createTransit,
  placeAt,
  type Profile,
  type Route,
  STEP_MS,
} from "../../../src/apps/ballpit/transit";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind } from "../../../src/core/types";

const layout = (kind: FrameKind, answers: number[], feeder = false) => {
  const size = VENUE_SIZE[kind];
  const H = size.height;
  const reach = DEFAULT_REACH[kind];
  return layoutFrame({
    kind,
    W: size.width,
    H,
    span: 1,
    adultTop: H * (1 - reach.adult),
    childTop: H * (1 - reach.child),
    variant: answers.length > 1 ? "two" : "one",
    answers,
    feeder,
    inlets:
      kind === "screen"
        ? Array.from({ length: 6 }, (_, k) => ((k + 0.5) * size.width) / 6)
        : undefined,
  });
};

const routeOf = (w: Way, p: Profile) => buildRoute(w.path, p, w.r, w.nodes);

let seed = 11;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

/** The closest any two balls came while both were moving, as a share of the touching distance. */
const closest = (balls: { route: Route; start: number }[]) => {
  let worst = Infinity;
  const p = { x: 0, y: 0 };
  const q = { x: 0, y: 0 };
  const t0 = Math.min(...balls.map((b) => b.start));
  const t1 = Math.max(...balls.map((b) => b.start + b.route.duration));
  for (let t = t0; t <= t1; t += STEP_MS / 2) {
    const live = balls.filter((b) => t >= b.start && t <= b.start + b.route.duration);
    for (let i = 0; i < live.length; i++) {
      placeAt(live[i]!.route, t - live[i]!.start, p);
      for (let j = i + 1; j < live.length; j++) {
        placeAt(live[j]!.route, t - live[j]!.start, q);
        const touch = live[i]!.route.r + live[j]!.route.r;
        worst = Math.min(worst, Math.hypot(p.x - q.x, p.y - q.y) / touch);
      }
    }
  }
  return worst;
};

/** Book balls with `launch` until `n` have gone or none fit, then check none ran into another. */
const crowd = (
  cap: number,
  n: number,
  gap: number,
  launch: (now: number) => { route: Route; at: number },
) => {
  let now = 0;
  const transit = createTransit(cap, () => now);
  const booked: { route: Route; start: number }[] = [];
  for (let k = 0; k < n; k++) {
    now += gap * (0.5 + rand());
    transit.due(now, () => {});
    const { route, at } = launch(now);
    const start = transit.plan(route, at, 1500);
    if (start === null) continue;
    expect(start).toBeGreaterThanOrEqual(at);
    if (
      transit.add(route, start, {
        block: 0,
        answer: 0,
        color: 0,
        tint: 0,
        ghost: false,
        lands: true,
      })
    )
      booked.push({ route, start });
  }
  return booked;
};

describe("pipes", () => {
  it("round each corner into a bend and keep the path smooth", () => {
    const path = filleted(
      [
        { x: 0, y: 1000 },
        { x: 0, y: 200 },
        { x: 300, y: 200 },
        { x: 300, y: 400 },
      ],
      100,
    );
    const p = { x: 0, y: 0, dx: 0, dy: 0 };
    expect(pointAt(path, 0, p)).toMatchObject({ x: 0, y: 1000, dx: 0, dy: -1 });
    pointAt(path, path.length, p);
    expect(p.x).toBeCloseTo(300);
    expect(p.y).toBeCloseTo(400);
    expect(p.dy).toBeCloseTo(1);
    // No jumps anywhere along it.
    const q = { x: 0, y: 0, dx: 0, dy: 0 };
    for (let s = 0; s < path.length; s += 2) {
      pointAt(path, s, p);
      pointAt(path, s + 2, q);
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThanOrEqual(2.001);
    }
    // Shorter than the corners it cut.
    expect(path.length).toBeLessThan(800 + 300 + 200);
  });
});

describe("balls in transit", () => {
  const profile: Profile = { pause: 0, v0: 0, v1: 2000, accel: 2000 / 0.12 };

  it("go hard from the button, then cruise to the outlet", () => {
    const l = layout("wall", [4]);
    const way = l.blocks[0]!.ways[1]!;
    const route = routeOf(way, profile);
    const p = { x: 0, y: 0 };
    expect(placeAt(route, 0, p)).toMatchObject(way.path.start);
    placeAt(route, route.duration, p);
    expect(p.x).toBeCloseTo(way.path.end.x, 0);
    expect(p.y).toBeCloseTo(way.path.end.y, 0);
    expect(route.duration).toBeGreaterThan(700);
    expect(route.duration).toBeLessThan(1600);
    expect(route.vEnd).toBeCloseTo(2000, -1);
    expect(route.exit.dy).toBeCloseTo(1);
  });

  it("share one pipe without running into each other", () => {
    const l = layout("wall", [4]);
    const route = routeOf(l.blocks[0]!.ways[2]!, profile);
    // Six presses a second, the most one button takes, for ten seconds.
    const booked = crowd(48, 60, 1000 / 6, (now) => ({ route, at: now }));
    expect(booked.length).toBeGreaterThan(40);
    const inFlight = Math.max(
      ...booked.map(
        (b) => booked.filter((c) => Math.abs(c.start - b.start) < route.duration).length,
      ),
    );
    expect(inFlight).toBeGreaterThanOrEqual(3);
    expect(closest(booked)).toBeGreaterThan(0.98);
  });

  it("merge from every button into a panel's riser without collisions", () => {
    const l = layout("panel", [4, 6], true);
    const p: Profile = { pause: 60, v0: 0, v1: 2380, accel: 23800 };
    const ways = l.blocks.flatMap((b) => b.ways).filter((w): w is Way => w !== null);
    expect(ways.length).toBe(10);
    const routes = ways.map((w) => routeOf(w, p));
    // A busy panel: six presses a second across its ten buttons, for twenty seconds.
    const booked = crowd(32, 120, 1000 / 6, (now) => ({
      route: routes[Math.floor(rand() * routes.length)]!,
      at: now,
    }));
    expect(booked.length).toBeGreaterThan(110);
    expect(closest(booked)).toBeGreaterThan(0.95);
  });

  it("cross the screen's network from any panel to any tube without collisions", () => {
    const l = layout("screen", [4, 6]);
    const net = l.network!;
    const p: Profile = { pause: 0, v0: 915, v1: 3000, accel: 25000 };
    // A crowd at every panel: twenty votes a second across the bank.
    const booked = crowd(96, 200, 1000 / 20, (now) => {
      const bi = rand() < 0.5 ? 0 : 1;
      const answers = l.blocks[bi]!.tubes.length;
      const way = net.way(Math.floor(rand() * 6), bi, Math.floor(rand() * answers))!;
      return { route: routeOf(way, p), at: now + 200 };
    });
    expect(booked.length).toBeGreaterThan(150);
    // Where a rising ball crosses the far lane at an angle, two balls may graze by a few px.
    expect(closest(booked)).toBeGreaterThan(0.85);
  });

  it("keep a fixed pool, and hand balls over when they arrive", () => {
    let now = 0;
    const transit = createTransit(4, () => now);
    const route = buildRoute(
      filleted(
        [
          { x: 0, y: 500 },
          { x: 0, y: 0 },
        ],
        0,
      ),
      profile,
      20,
    );
    const info = { block: 0, answer: 1, color: 1, tint: 0, ghost: true, lands: true };
    const got: Ball[] = [];
    for (let k = 0; k < 6; k++) {
      const s = transit.plan(route, now, 2000);
      if (k < 4) expect(transit.add(route, s ?? now, info)).not.toBeNull();
      else {
        expect(s).toBeNull();
        expect(transit.add(route, now, info)).toBeNull();
      }
    }
    expect(transit.count).toBe(4);
    now = 10_000;
    transit.due(now, (b) => got.push({ ...b }));
    expect(got.length).toBe(4);
    expect(got.every((b) => b.ghost && b.answer === 1)).toBe(true);
    expect(transit.count).toBe(0);
  });
});
