import { afterEach, describe, expect, it, vi } from "vitest";
import { createLoop } from "../src/core/loop";

describe("createLoop", () => {
  afterEach(() => vi.unstubAllGlobals());

  const frames = () => {
    const queue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queue.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    return (at: number) => queue.shift()?.(at);
  };

  it("doesn't stall when the first frame's timestamp predates start", () => {
    const frame = frames();
    let steps = 0;
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    const loop = createLoop({ hz: 60, update: () => steps++ });
    loop.start();
    frame(4_000);
    frame(4_000 + 1000 / 60 + 1);
    expect(steps).toBe(1);
    loop.stop();
  });

  it("caps a long stall", () => {
    const frame = frames();
    let steps = 0;
    vi.spyOn(performance, "now").mockReturnValue(0);
    const loop = createLoop({ hz: 60, update: () => steps++ });
    loop.start();
    frame(5_000);
    expect(steps).toBe(15);
    loop.stop();
  });
});
