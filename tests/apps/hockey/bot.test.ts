import { describe, expect, it } from "vitest";
import { createBot, driveBot, reflect, SKILLS, setSkill } from "../../../src/apps/hockey/bot";
import {
  createMallet,
  createPuck,
  laneParams,
  malletZone,
  placePuck,
} from "../../../src/apps/hockey/physics";
import { createRng } from "../../../src/core/rng";

const lane = laneParams({
  length: 1600,
  width: 1000,
  ends: [
    { kind: "goal", side: 0 },
    { kind: "goal", side: 1 },
  ],
  variant: "hockey",
  speed: 1,
  child: false,
});

const keeper = () =>
  createMallet(0, 0, malletZone(lane, { x0: 0, y0: 0, x1: 800, y1: 1000 }, 0), lane.maxMallet);

describe("bots", () => {
  it("folds positions back between walls", () => {
    expect(reflect(150, 0, 100)).toBe(50);
    expect(reflect(-30, 0, 100)).toBe(30);
    expect(reflect(250, 0, 100)).toBe(50);
    expect(reflect(40, 0, 100)).toBe(40);
  });

  it("moves to block a puck heading for its goal, near where it will cross", () => {
    const m = keeper();
    const bot = createBot(createRng("block"), { ...SKILLS.match, error: 0 });
    setSkill(bot, { ...SKILLS.match, error: 0 }, m, lane);
    const p = createPuck(0);
    placePuck(p, 900, 300, -lane.maxPuck * 0.6, lane.maxPuck * 0.1);
    driveBot(bot, lane, m, [p], 0);
    expect(m.tx).toBeLessThan(250);
    const t = (p.x - m.tx) / -p.vx;
    expect(Math.abs(m.ty - (p.y + p.vy * t))).toBeLessThan(lane.malletR);
  });

  it("lines up behind a loose puck in its half and strikes towards the far goal", () => {
    const m = keeper();
    m.x = 150;
    m.y = 500;
    const bot = createBot(createRng("strike"), { ...SKILLS.match, error: 0 });
    const p = createPuck(0);
    placePuck(p, 500, 500);
    driveBot(bot, lane, m, [p], 0);
    // The plan sits on the goal side of the puck, then pushes through it.
    expect(m.tx).toBeLessThan(p.x);
    m.x = m.tx;
    m.y = m.ty;
    driveBot(bot, lane, m, [p], 1);
    expect(m.tx).toBeGreaterThan(p.x);
  });

  it("leaves a puck tucked into a corner alone", () => {
    const m = keeper();
    const bot = createBot(createRng("corner"), SKILLS.match);
    const p = createPuck(0);
    placePuck(p, lane.puckR + 5, lane.puckR + 5);
    driveBot(bot, lane, m, [p], 0);
    expect(Math.hypot(m.tx - p.x, m.ty - p.y)).toBeGreaterThan(lane.malletR * 2);
  });

  it("thinks only as often as its reaction time allows", () => {
    const m = keeper();
    const bot = createBot(createRng("slow"), SKILLS.match);
    const p = createPuck(0);
    placePuck(p, 900, 300, -800, 0);
    driveBot(bot, lane, m, [p], 0);
    const first = { x: m.tx, y: m.ty };
    p.y = 800;
    driveBot(bot, lane, m, [p], 0.05);
    expect({ x: m.tx, y: m.ty }).toEqual(first);
    driveBot(bot, lane, m, [p], 1);
    expect(m.ty).not.toBe(first.y);
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const m = keeper();
      const bot = createBot(createRng("same"), SKILLS.match);
      const p = createPuck(0);
      placePuck(p, 900, 300, -800, 200);
      const out: number[] = [];
      for (let t = 0; t < 3; t += 0.1) {
        driveBot(bot, lane, m, [p], t);
        out.push(m.tx, m.ty);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it("caps a bot's mallet below a person's", () => {
    const m = keeper();
    setSkill(createBot(createRng("cap")), SKILLS.match, m, lane);
    expect(m.cap).toBeLessThan(lane.maxMallet);
  });
});
