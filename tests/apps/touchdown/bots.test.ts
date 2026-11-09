import { describe, expect, it } from "vitest";
import { botPads, createBots } from "../../../src/apps/touchdown/bots";
import { BOT_YIELD_MS } from "../../../src/apps/touchdown/config";
import { createCrew } from "../../../src/apps/touchdown/crew";
import type { Input } from "../../../src/core/types";
import { createRng } from "../../../src/core/rng";
import { config, crewOf, DT, layoutOf } from "./helpers";

/** An input that records injected touches. */
const fakeInput = () => {
  const down = new Map<number, { x: number; y: number }>();
  let next = 1;
  const input = {
    inject: {
      down(x: number, y: number) {
        const id = next++;
        down.set(id, { x, y });
        return id;
      },
      move() {},
      up(id: number) {
        down.delete(id);
      },
    },
  } as unknown as Input;
  return { input, down };
};

describe("touchdown bots", () => {
  it("work whole crews on a wall and single pads elsewhere", () => {
    const wall = layoutOf("wall", "duo", 3);
    const crews = wall.crews.map((spec) =>
      createCrew({ spec, layout: wall, config: config(), rng: createRng("w"), events: [] }),
    );
    expect(botPads(crews, 2, true).map((p) => p.crew)).toEqual([0, 0, 1, 1]);
    expect(botPads(crews, 0, true)).toEqual([]);
    const duo = [crewOf("pair").crew];
    expect(botPads(duo, 1, false).map((p) => p.role)).toEqual(["left"]);
    expect(botPads(duo, 2, false).map((p) => p.role)).toEqual(["left", "right"]);
    const crew = [crewOf("pair", "crew").crew];
    expect(botPads(crew, 1, false).map((p) => p.role)).toEqual(["main"]);
    expect(
      botPads(crew, 2, false)
        .map((p) => p.role)
        .sort(),
    ).toEqual(["main", "turnLeft", "turnRight"]);
  });

  it("press the pads the autopilot asks for, inside the pads, and yield to people", () => {
    const { crew } = crewOf("pair");
    const { input, down } = fakeInput();
    const pads = botPads([crew], 2, false);
    const unit = 0.5;
    const bots = createBots({ input, crews: [crew], pads, unit: () => unit });
    let pressed = 0;
    let now = 0;
    for (let i = 0; i < 20 * 120; i++) {
      crew.step(DT, now);
      bots.update(now);
      now += DT * 1000;
      pressed = Math.max(pressed, down.size);
      for (const p of down.values()) {
        const inside = pads.some(
          (pad) =>
            p.x >= pad.rect.x * unit &&
            p.x <= (pad.rect.x + pad.rect.width) * unit &&
            p.y >= pad.rect.y * unit &&
            p.y <= (pad.rect.y + pad.rect.height) * unit,
        );
        expect(inside).toBe(true);
      }
    }
    expect(pressed).toBeGreaterThan(0);
    expect(down.size).toBeLessThanOrEqual(2);
    // A person touches: the bots let go and stay off for a while.
    crew.touched(true, now);
    bots.update(now + 100);
    expect(down.size).toBe(0);
    for (let t = 200; t < BOT_YIELD_MS - 500; t += 500) {
      bots.update(now + t);
      expect(down.size).toBe(0);
    }
    bots.dispose();
    expect(down.size).toBe(0);
  });
});
