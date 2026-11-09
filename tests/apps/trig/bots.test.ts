import { describe, expect, it } from "vitest";
import { createAngle } from "../../../src/apps/trig/angle";
import { BOT_YIELD_MS, createBot } from "../../../src/apps/trig/bots";
import type { Fn } from "../../../src/apps/trig/config";
import { createControls } from "../../../src/apps/trig/controls";
import { shortest, tourAngle } from "../../../src/apps/trig/maths";
import { createRng } from "../../../src/core/rng";
import type { FrameKind, Rect } from "../../../src/core/types";
import { DT, layoutOf, reachTop } from "./helpers";

const within = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** A frame's angle and controls driven by a bot's injected touches, as frame.ts wires them. */
const rig = (kind: FrameKind, steps = false, seed = "b") => {
  const layout = layoutOf(kind, { steps });
  let now = 0;
  let next = 1;
  const angle = createAngle(
    { snap: true, tour: tourAngle, holdMs: 15_000, easeMs: 2500, gotoMs: 350 },
    now,
  );
  const controls = createControls({ layout: () => layout, angle });
  const on: Record<Fn, boolean> = { sin: true, cos: true, tan: true };
  const downs: { x: number; y: number }[] = [];
  let stepPresses = 0;
  let lastPerson = Number.NEGATIVE_INFINITY;
  const input = {
    inject: {
      down: (x: number, y: number) => {
        const id = next++;
        downs.push({ x, y });
        // The UI kit's buttons take their presses before the app sees them.
        const t = layout.toggles.find((g) => within(g.rect, x, y));
        if (t) on[t.fn] = !on[t.fn];
        else if (
          (layout.next && within(layout.next, x, y)) ||
          (layout.back && within(layout.back, x, y))
        ) {
          stepPresses++;
        } else controls.down(id, x, y, now, false);
        return id;
      },
      move: (id: number, x: number, y: number) => {
        downs.push({ x, y });
        controls.move(id, x, y, now);
      },
      up: (id: number) => controls.up(id, now),
    },
  };
  const bot = createBot({
    input,
    layout: () => layout,
    pic: () => layout.pic,
    graphs: () => true,
    unit: () => 1,
    rng: createRng(seed),
    theta: () => angle.theta,
    reachTop: () => reachTop(kind).adult,
    lastPerson: () => lastPerson,
    toggles: () => (["sin", "cos", "tan"] as const).map((fn) => ({ fn, on: on[fn] })),
    steps,
  });
  let turned = 0;
  const run = (secs: number) => {
    for (let i = 0; i < Math.round(secs / DT); i++) {
      now += DT * 1000;
      const before = angle.theta;
      angle.step(now);
      bot.update(DT, now);
      if (angle.mode !== "tour") turned += Math.abs(shortest(before, angle.theta));
    }
  };
  return {
    bot,
    on,
    downs,
    run,
    angle,
    controls,
    get turned() {
      return turned;
    },
    get stepPresses() {
      return stepPresses;
    },
    get now() {
      return now;
    },
    person() {
      lastPerson = now;
    },
  };
};

describe("trig bots", () => {
  it.each(["panel", "pair", "kiosk", "wall"] as const)(
    "on a %s, drag the point, turn the ring and the wheel, flick, scrub, tap ticks and toggle",
    (kind) => {
      const r = rig(kind, false, `b-${kind}`);
      r.run(240);
      const m = r.bot.moves;
      expect(m.ring + m.point, "ring and point").toBeGreaterThan(5);
      expect(m.wheel, "wheel").toBeGreaterThan(3);
      expect(m.flick, "flick").toBeGreaterThan(1);
      expect(m.graph, "graph").toBeGreaterThan(2);
      expect(m.tick, "tick").toBeGreaterThan(0);
      expect(m.toggle, "toggle").toBeGreaterThan(0);
      expect(r.turned).toBeGreaterThan(20);
      // Whatever a bot switched off it switches on again soon.
      r.run(30);
      const offFor = { sin: 0, cos: 0, tan: 0 };
      for (let i = 0; i < 600; i++) {
        r.run(0.1);
        for (const fn of ["sin", "cos", "tan"] as const) if (!r.on[fn]) offFor[fn] += 0.1;
      }
      for (const fn of ["sin", "cos", "tan"] as const) expect(offFor[fn], fn).toBeLessThan(40);
    },
  );

  it("on a wall, touches only what an adult can reach", () => {
    const r = rig("wall", false, "reach");
    r.run(300);
    expect(r.downs.length).toBeGreaterThan(200);
    const top = reachTop("wall").adult;
    for (const d of r.downs) expect(d.y).toBeGreaterThanOrEqual(top);
  });

  it("presses Next and Back in steps", () => {
    const r = rig("panel", true, "steps");
    r.run(120);
    expect(r.stepPresses).toBeGreaterThan(3);
    expect(r.bot.moves.step).toBe(r.stepPresses);
  });

  it("stands back after a person touches, and comes back later", () => {
    const r = rig("panel", false, "yield");
    r.run(20);
    r.person();
    r.run(1);
    const before = r.downs.length;
    expect(r.controls.count).toBe(0);
    r.run(BOT_YIELD_MS / 1000 - 2);
    expect(r.downs.length).toBe(before);
    r.run(10);
    expect(r.downs.length).toBeGreaterThan(before);
  });
});
