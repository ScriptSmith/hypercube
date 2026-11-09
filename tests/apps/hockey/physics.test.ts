import { describe, expect, it } from "vitest";
import {
  createMallet,
  createPuck,
  type End,
  glide,
  type LaneEvent,
  type LaneParams,
  laneParams,
  malletZone,
  placePuck,
  stepLane,
  substepsFor,
} from "../../../src/apps/hockey/physics";
import type { Variant } from "../../../src/apps/hockey/config";

const DT = 1 / 120;
const GOALS: readonly [End, End] = [
  { kind: "goal", side: 0 },
  { kind: "goal", side: 1 },
];

const lane = (variant: Variant = "hockey", ends: readonly [End, End] = GOALS): LaneParams =>
  laneParams({ length: 1600, width: 1000, ends, variant, speed: 1, child: false });

const halves = (l: LaneParams) => [
  createMallet(
    0,
    0,
    malletZone(l, { x0: 0, y0: 0, x1: l.length / 2, y1: l.width }, 0),
    l.maxMallet,
  ),
  createMallet(
    1,
    1,
    malletZone(l, { x0: l.length / 2, y0: 0, x1: l.length, y1: l.width }, 1),
    l.maxMallet,
  ),
];

const run = (
  l: LaneParams,
  pucks: ReturnType<typeof createPuck>[],
  mallets: ReturnType<typeof createMallet>[],
  steps: number,
  each?: (events: LaneEvent[]) => void,
) => {
  const events: LaneEvent[] = [];
  for (let i = 0; i < steps; i++) {
    events.length = 0;
    stepLane(l, pucks, mallets, DT, events);
    each?.(events);
  }
};

describe("hockey physics", () => {
  it("stops a puck at full speed on a still mallet instead of tunnelling", () => {
    const l = lane();
    const [, m] = halves(l);
    m!.x = m!.tx = 1200;
    m!.y = m!.ty = 500;
    const p = createPuck(0);
    // Ten times the cap: the cap applies first, and sub-steps must still catch the mallet.
    placePuck(p, 300, 500, l.maxPuck * 10, 0);
    let maxX = 0;
    let hits = 0;
    run(l, [p], [m!], 120, (events) => {
      maxX = Math.max(maxX, p.x);
      hits += events.filter((e) => e.type === "hit").length;
    });
    expect(hits).toBeGreaterThan(0);
    expect(maxX).toBeLessThan(1200 - l.malletR);
    expect(p.vx).toBeLessThan(0);
  });

  it("catches a still puck with a mallet swept across it in one step", () => {
    const l = lane();
    const [m] = halves(l);
    m!.x = m!.zone.x0;
    m!.y = m!.ty = 500;
    m!.tx = m!.zone.x1;
    const p = createPuck(0);
    placePuck(p, 420, 500);
    run(l, [p], [m!], 30);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.x).toBeGreaterThan(m!.x);
  });

  it("uses enough sub-steps for the fastest pair", () => {
    const l = lane();
    const [m] = halves(l);
    m!.vx = l.maxMallet;
    const p = createPuck(0);
    placePuck(p, 100, 100, -l.maxPuck, 0);
    const n = substepsFor(l, [p], [m!], DT);
    expect(((l.maxMallet + l.maxPuck) * DT) / n).toBeLessThanOrEqual(l.puckR * 0.35 + 1e-9);
  });

  it("scores through the mouth and bounces off the end wall beside it", () => {
    const l = lane();
    const inGoal = createPuck(0);
    placePuck(inGoal, 300, l.width / 2, -1500, 0);
    const goals: LaneEvent[] = [];
    run(l, [inGoal], [], 60, (events) => goals.push(...events.filter((e) => e.type === "goal")));
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ type: "goal", end: 0 });
    expect(inGoal.live).toBe(false);

    const wide = createPuck(1);
    placePuck(wide, 300, 80, -1500, 0);
    run(l, [wide], [], 60, (events) => {
      expect(events.some((e) => e.type === "goal")).toBe(false);
    });
    expect(wide.live).toBe(true);
    expect(wide.vx).toBeGreaterThan(0);
  });

  it("caps puck speed", () => {
    const l = lane();
    const p = createPuck(0);
    placePuck(p, 800, 500, 99_999, 99_999);
    run(l, [p], [], 1);
    expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(l.maxPuck + 1e-6);
  });

  it("keeps a puck inside the lane when a mallet pins it to a wall", () => {
    const l = lane();
    const [m] = halves(l);
    const p = createPuck(0);
    placePuck(p, 400, l.puckR + 5);
    m!.x = 400;
    m!.y = 300;
    m!.tx = 400;
    m!.ty = -500;
    run(l, [p], [m!], 120);
    expect(p.y).toBeGreaterThanOrEqual(l.puckR - 1e-6);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(Math.hypot(p.x - m!.x, p.y - m!.y)).toBeGreaterThan(l.malletR + l.puckR - 1);
  });

  it("nudges a puck that stalls", () => {
    const l = lane();
    const p = createPuck(0);
    placePuck(p, 800, 500);
    run(l, [p], [], 120);
    expect(Math.hypot(p.vx, p.vy)).toBe(0);
    run(l, [p], [], 120);
    expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(0);
  });

  it("sends pucks out through an open end", () => {
    const l = lane("hockey", [GOALS[0], { kind: "open", side: 1 }]);
    const p = createPuck(0);
    placePuck(p, 1400, 200, 1500, 0);
    const exits: LaneEvent[] = [];
    run(l, [p], [], 60, (events) => exits.push(...events.filter((e) => e.type === "exit")));
    expect(exits).toEqual([expect.objectContaining({ type: "exit", end: 1 })]);
  });

  it("hands a puck over as its edge reaches a versus open end, and lets one in from beyond it", () => {
    const l = lane("hockey", [GOALS[0], { kind: "open", side: 1, leaveAt: -1 }]);
    const r = l.puckR;
    const out = createPuck(0);
    placePuck(out, 1400, 200, 1500, 0);
    let left = -1;
    run(l, [out], [], 60, (events) => {
      if (left < 0 && events.some((e) => e.type === "exit")) left = out.x;
    });
    expect(left).toBeGreaterThanOrEqual(l.length - r);
    expect(left).toBeLessThan(l.length - r + 1500 * DT);
    // Coming in from just outside the end, it stays.
    const inc = createPuck(1);
    placePuck(inc, l.length + r * 0.9, 500, -900, 0);
    const exits: LaneEvent[] = [];
    run(l, [inc], [], 30, (events) => exits.push(...events.filter((e) => e.type === "exit")));
    expect(exits).toEqual([]);
    expect(inc.live).toBe(true);
    expect(inc.x).toBeLessThan(l.length - r);
  });

  it("glides a crossing puck off the side rims", () => {
    const l = lane();
    const r = l.puckR;
    expect(glide(l, 500, 100, 1).y).toBeCloseTo(600);
    const bounced = glide(l, l.width - r - 10, 100, 0.5);
    expect(bounced.y).toBeCloseTo(l.width - r - 40);
    expect(bounced.vy).toBe(-100);
    expect(glide(l, 500, 100, -1).y).toBeCloseTo(400);
  });

  it("is deterministic", () => {
    const play = () => {
      const l = lane();
      const ms = halves(l);
      const pucks = [createPuck(0), createPuck(1)];
      placePuck(pucks[0]!, 500, 300, 900, 400);
      placePuck(pucks[1]!, 1100, 700, -700, -500);
      run(l, pucks, ms, 600, () => {
        ms[0]!.tx = pucks[0]!.x;
        ms[0]!.ty = pucks[0]!.y;
        ms[1]!.tx = pucks[1]!.x;
        ms[1]!.ty = pucks[1]!.y;
      });
      return JSON.stringify(pucks.map((p) => [p.x, p.y, p.vx, p.vy, p.live]));
    };
    expect(play()).toBe(play());
  });
});

describe("paddles physics", () => {
  const ball = (l: LaneParams, y: number) => {
    const p = createPuck(0);
    placePuck(p, l.length / 2, y, -l.baseBall, 0);
    return p;
  };

  it("returns a centred hit straight and an edge hit at an angle", () => {
    const l = lane("paddles");
    const [m] = halves(l);
    m!.y = m!.ty = 500;
    const centre = ball(l, 500);
    run(l, [centre], [m!], 120);
    expect(centre.vx).toBeGreaterThan(0);
    expect(Math.abs(centre.vy)).toBeLessThan(Math.abs(centre.vx) * 0.05);

    const edge = ball(l, 500 + l.paddleHalf * 0.9);
    m!.x = m!.zone.x0;
    run(l, [edge], [m!], 120);
    expect(edge.vx).toBeGreaterThan(0);
    expect(edge.vy).toBeGreaterThan(edge.vx * 0.5);
  });

  it("speeds the ball up a little on each hit, up to the cap", () => {
    const l = lane("paddles");
    const [m] = halves(l);
    m!.y = m!.ty = 500;
    const p = ball(l, 500);
    run(l, [p], [m!], 120);
    expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(l.baseBall);
    expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(l.maxPuck);
  });

  it("lets a ball moving away pass through the back of a paddle", () => {
    const l = lane("paddles");
    const [m] = halves(l);
    m!.y = m!.ty = 500;
    const p = createPuck(0);
    placePuck(p, m!.x - l.paddleR - l.puckR - 20, 500, l.baseBall, 0);
    run(l, [p], [m!], 30);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.x).toBeGreaterThan(m!.x);
  });

  it("scores across the whole end", () => {
    const l = lane("paddles");
    const p = createPuck(0);
    placePuck(p, 300, 60, -l.baseBall * 1.5, 0);
    const goals: LaneEvent[] = [];
    run(l, [p], [], 120, (events) => goals.push(...events.filter((e) => e.type === "goal")));
    expect(goals).toHaveLength(1);
  });
});
