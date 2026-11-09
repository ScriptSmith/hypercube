import { describe, expect, it } from "vitest";
import { createBot } from "../../../src/apps/loom/bots";
import { createConductor } from "../../../src/apps/loom/conductor";
import type { Variant } from "../../../src/apps/loom/config";
import type { Term } from "../../../src/apps/loom/series";
import { createStrands } from "../../../src/apps/loom/strands";
import { createRng } from "../../../src/core/rng";
import type { FrameKind } from "../../../src/core/types";
import { DT, layoutOf } from "./helpers";

/** A solo frame with a bot on every harmonic, run like frame.ts runs it, without a browser. */
const rig = (kind: FrameKind, variant: Variant, bots = 99) => {
  const layout = layoutOf(kind);
  const strands = createStrands(layout, variant);
  const conductor = createConductor({ n: layout.strands.length, variant, rng: createRng("c") });
  let now = 0;
  let next = 1;
  const input = {
    inject: {
      down: (x: number, y: number) => {
        const id = next++;
        strands.down(id, x, y, false, now);
        return id;
      },
      move: (id: number, x: number, y: number) => strands.move(id, x, y, now),
      up: (id: number) => strands.up(id, now, (i) => conductor.target()?.terms[i] ?? null),
    },
  };
  const shown = (j: number): Term => {
    const s = strands.list[j]!;
    return s.live ? { amp: s.amp, phase: s.phase } : conductor.values[j]!;
  };
  const list = strands.list.slice(0, bots).map((s, j) =>
    createBot({
      input,
      strand: s,
      layout: () => layout,
      unit: () => 1,
      rng: createRng(`bot${j}`),
      hint: () => conductor.target()?.terms[j] ?? null,
      value: () => shown(j),
      free: variant === "free",
    }),
  );
  let liveTicks = 0;
  let ticks = 0;
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      now += DT * 1000;
      strands.step(DT, now);
      strands.list.forEach((s, j) => {
        if (s.live) conductor.setLive(j, s.amp, s.phase);
        else conductor.setAuto(j);
      });
      conductor.step(DT);
      strands.list.forEach((s, j) => {
        if (s.live) return;
        s.amp = conductor.values[j]!.amp;
        s.phase = conductor.values[j]!.phase;
      });
      for (const b of list) b.update(DT, now);
      ticks++;
      if (strands.list.every((s) => s.live)) liveTicks++;
    }
  };
  return { layout, strands, conductor, bots: list, run, liveShare: () => liveTicks / ticks };
};

describe("loom bots", () => {
  for (const kind of ["panel", "kiosk", "wall"] as const) {
    it(`match targets by dragging sliders and dials on a solo ${kind}`, () => {
      const r = rig(kind, "match");
      r.run(150);
      // The bots kept every harmonic live, so the matches are theirs, not auto easing's.
      expect(r.liveShare()).toBeGreaterThan(0.85);
      expect(r.conductor.peopleMatches).toBeGreaterThanOrEqual(2);
      expect(r.bots.every((b) => b.moves > 3)).toBe(true);
      expect(r.strands.holds.size).toBeLessThanOrEqual(r.bots.length);
    });
  }

  it("set values at random in free play, and weave a band after half a minute", () => {
    const r = rig("panel", "free");
    r.run(70);
    expect(r.conductor.cloth.woven).toBeGreaterThanOrEqual(1);
    expect(r.strands.list.some((s) => s.amp > 0.05)).toBe(true);
  });

  it("stand back for a while after a person touches their harmonic", () => {
    const r = rig("panel", "match", 1);
    r.run(5);
    const before = r.bots[0]!.moves;
    const s = r.strands.list[0]!;
    s.lastPerson = 5000;
    r.run(15);
    expect(r.bots[0]!.moves).toBe(before);
    r.run(15);
    expect(r.bots[0]!.moves).toBeGreaterThan(before);
  });
});
