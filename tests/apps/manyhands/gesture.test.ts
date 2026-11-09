import { describe, expect, it } from "vitest";
import {
  chain,
  createPlayer,
  drag,
  follow,
  hold,
  pause,
  tap,
} from "../../../src/apps/manyhands/gesture";

const recorder = () => {
  const log: string[] = [];
  let id = 0;
  return {
    log,
    sink: {
      down: (x: number, y: number) => {
        log.push(`down ${++id} ${Math.round(x)},${Math.round(y)}`);
        return id;
      },
      move: (i: number, x: number, y: number) =>
        log.push(`move ${i} ${Math.round(x)},${Math.round(y)}`),
      up: (i: number) => log.push(`up ${i}`),
    },
  };
};

describe("gesture player", () => {
  it("taps down then up", () => {
    const r = recorder();
    const p = createPlayer(r.sink);
    p.start(tap({ x: 5, y: 6 }, 80), 0);
    expect(p.update(0)).toBe(true);
    expect(p.update(50)).toBe(true);
    expect(p.update(100)).toBe(false);
    expect(r.log).toEqual(["down 1 5,6", "up 1"]);
  });

  it("holds two fingers together", () => {
    const r = recorder();
    const p = createPlayer(r.sink);
    p.start(
      hold(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        200,
      ),
      0,
    );
    p.update(0);
    p.update(250);
    expect(r.log).toEqual(["down 1 0,0", "down 2 10,0", "up 1", "up 2"]);
  });

  it("drags along a path at an even speed", () => {
    const r = recorder();
    const p = createPlayer(r.sink);
    p.start(
      drag(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        100,
        0,
      ),
      0,
    );
    for (let t = 0; t <= 130; t += 25) p.update(t);
    expect(r.log[0]).toBe("down 1 0,0");
    expect(r.log).toContain("move 1 50,0");
    expect(r.log.at(-2)).toBe("move 1 100,0");
    expect(r.log.at(-1)).toBe("up 1");
  });

  it("follows a moving target at a capped speed and lifts when it is gone", () => {
    const r = recorder();
    const p = createPlayer(r.sink);
    let target: { x: number; y: number } | null = { x: 1000, y: 0 };
    p.start(
      follow({ x: 0, y: 0 }, () => target, 1000),
      0,
    );
    p.update(0);
    p.update(100);
    expect(r.log.at(-1)).toBe("move 1 100,0");
    target = null;
    p.update(200);
    expect(r.log.at(-1)).toBe("up 1");
    expect(p.busy).toBe(false);
  });

  it("cancel lifts every finger", () => {
    const r = recorder();
    const p = createPlayer(r.sink);
    p.start(chain([pause(50), hold([{ x: 1, y: 1 }], 1000)]), 0);
    p.update(0);
    p.update(60);
    p.cancel();
    expect(r.log).toEqual(["down 1 1,1", "up 1"]);
    expect(p.fingers.every((f) => f === null)).toBe(true);
  });
});
