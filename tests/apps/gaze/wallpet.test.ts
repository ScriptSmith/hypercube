import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import type { Input } from "../../../src/core/types";
import { DEFAULT_VENUE } from "../../../src/core/venue";
import { WALL_LOOK } from "../../../src/apps/gaze/wall";
import { BOT_STROKE, createWallBots } from "../../../src/apps/gaze/wallbots";
import { BLISS, blissPose, createPetting, PET, type Petting } from "../../../src/apps/gaze/wallpet";

const STEP = 1 / 60;

/** Run `seconds`, calling `each` with the time before every step; returns the most content. */
const run = (pet: Petting, seconds: number, each?: (t: number) => void, from = 0) => {
  let most = 0;
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    each?.(from + i * STEP);
    pet.step(STEP);
    most = Math.max(most, pet.content);
  }
  return most;
};

/** A finger at `x`, `y` + `dy` sweeping `amp` metres either side, `period` seconds there and back. */
const sweep =
  (pet: Petting, id: number, amp: number, period: number, counts = true) =>
  (t: number) =>
    pet.move(id, 2 + amp * Math.sin((2 * Math.PI * t) / period), 1, counts);

describe("gaze on a wall: stroking", () => {
  it("isn't stroked by taps, a finger held still or a quick flick", () => {
    const pet = createPetting();
    // Taps, one after another.
    for (let i = 0; i < 20; i++) {
      pet.down(i, 1 + 0.3 * i, 1);
      run(pet, 0.25);
      pet.up(i);
      run(pet, 0.3);
    }
    expect(pet.content).toBe(0);
    // A finger held still for ten seconds on a touch frame that jitters by a centimetre.
    const rng = createRng("jitter");
    pet.down(100, 3, 1);
    expect(run(pet, 10, () => pet.move(100, 3 + rng.range(-0.01, 0.01), 1, true))).toBe(0);
    pet.up(100);
    // A flick: a metre in a third of a second.
    pet.down(101, 1, 1);
    expect(run(pet, 0.35, (t) => pet.move(101, 1 + 3 * t, 1, true))).toBe(0);
    pet.up(101);
    expect(run(pet, 3)).toBe(0);
    expect(pet.episodes).toBe(0);
  });

  it("grows content over a couple of seconds of stroking back and forth", () => {
    const pet = createPetting();
    pet.down(1, 2, 1);
    let started = -1;
    let full = -1;
    run(pet, 6, (t) => {
      sweep(pet, 1, 0.3, 1.1)(t);
      if (started < 0 && pet.content > 0) started = t;
      if (full < 0 && pet.content >= 1) full = t;
    });
    expect(pet.stroking).toBe(true);
    // Not for a tap's length, but within a second or so.
    expect(started).toBeGreaterThan(0.5);
    expect(started).toBeLessThan(1.5);
    expect(full - started).toBeGreaterThan(1.5);
    expect(full).toBeLessThan(4.5);
    expect(pet.episodes).toBe(1);
  });

  it("counts a finger drawn along the wall, or strokes the same way with lifts between", () => {
    const along = createPetting();
    along.down(1, 1, 1);
    expect(run(along, 2.5, (t) => along.move(1, 1 + 0.8 * t, 1, true))).toBeGreaterThan(0.5);

    // Half a metre in half a second, lift, back to the start, again, as people pet a cat.
    const again = createPetting();
    let id = 10;
    for (let k = 0; k < 6; k++) {
      again.down(id, 2, 1);
      run(again, 0.5, (t) => again.move(id, 2 + 1.0 * (t - k * 0.8), 1, true), k * 0.8);
      again.up(id);
      run(again, 0.3);
      id++;
    }
    expect(again.content).toBeGreaterThan(0.5);
  });

  it("counts a stroke in full on a slow page, whose moves come a frame's worth at a time", () => {
    const pet = createPetting();
    pet.down(1, 2, 1);
    // Four frames a second, fifteen fixed steps each, the moves all arriving between frames.
    for (let frame = 0; frame < 16; frame++) {
      const t = frame / 4;
      for (let k = 1; k <= 4; k++)
        pet.move(1, 2 + 0.3 * Math.sin((2 * Math.PI * (t + k / 16)) / 1.1), 1, true);
      run(pet, 0.25);
    }
    expect(pet.content).toBeGreaterThan(0.5);
  });

  it("doesn't count a finger moving over the open eye", () => {
    const pet = createPetting();
    pet.down(1, 2, 1);
    expect(run(pet, 6, sweep(pet, 1, 0.3, 1.1, false))).toBe(0);
  });

  it("lingers a moment after the stroking stops, then comes back", () => {
    const pet = createPetting();
    pet.down(1, 2, 1);
    run(pet, 5, sweep(pet, 1, 0.3, 1.1));
    pet.up(1);
    expect(pet.content).toBe(1);
    // It counts as stroked for a lift's length, then lingers.
    run(pet, PET.gap + PET.linger * 0.8);
    expect(pet.content).toBeGreaterThan(0.95);
    run(pet, PET.fall + 0.4);
    expect(pet.content).toBe(0);
    expect(pet.stroking).toBe(false);
  });

  it("is startled out at once by a touch on the eye, and needs stroking again", () => {
    const pet = createPetting();
    pet.down(1, 2, 1);
    const stroke = sweep(pet, 1, 0.3, 1.1);
    run(pet, 5, stroke);
    pet.startle();
    run(pet, PET.startle + 0.02, stroke, 5);
    expect(pet.content).toBe(0);
    // Still stroking: it comes back, but only after another stretch of it.
    let back = -1;
    run(
      pet,
      4,
      (t) => {
        stroke(t);
        if (back < 0 && pet.content > 0) back = t - 5.2;
      },
      5.2,
    );
    expect(back).toBeGreaterThan(0.4);
    expect(pet.content).toBeGreaterThan(0.5);
  });

  it("stays content while someone else taps, peeking at newcomers from under its lids", () => {
    const pet = createPetting();
    pet.newcomer();
    expect(pet.peek).toBe(0);
    pet.down(1, 2, 1);
    const stroke = sweep(pet, 1, 0.3, 1.1);
    run(pet, 5, stroke);
    let most = 0;
    let least = 1;
    let t = 5;
    for (let k = 0; k < 4; k++) {
      pet.down(50 + k, 8, 1);
      pet.newcomer();
      run(
        pet,
        0.3,
        (s) => {
          stroke(s);
          most = Math.max(most, pet.peek);
        },
        t,
      );
      pet.up(50 + k);
      run(
        pet,
        2.2,
        (s) => {
          stroke(s);
          least = Math.min(least, pet.content);
        },
        t + 0.3,
      );
      t += 2.5;
    }
    expect(most).toBe(1);
    expect(pet.peek).toBe(0);
    expect(least).toBe(1);
  });

  it("keeps track of a bounded number of fingers and forgets them all on release", () => {
    const pet = createPetting();
    for (let i = 0; i < 500; i++) {
      pet.down(i, i * 0.01, 1);
      pet.step(STEP);
    }
    expect(pet.fingers).toBe(PET.pointers);
    pet.release();
    expect(pet.fingers).toBe(0);
    expect(pet.content).toBe(0);
  });

  it("rolls up within what the eye can turn to, swaying slowly", () => {
    let low = Infinity;
    let high = -Infinity;
    let side = 0;
    for (let t = 0; t < 120; t += 0.1) {
      const p = blissPose(t);
      low = Math.min(low, p.elevation);
      high = Math.max(high, p.elevation);
      side = Math.max(side, Math.abs(p.bearing));
    }
    expect(low).toBeGreaterThan(BLISS.up - BLISS.bob - 1e-9);
    expect(high).toBeLessThan(WALL_LOOK.high);
    expect(side).toBeLessThan(WALL_LOOK.off / 2);
    expect(side).toBeGreaterThan(BLISS.sway * 0.9);
  });
});

describe("gaze on a wall: bots stroke now and then", () => {
  const stage = { width: 1600, height: 600 };
  const ball = { x: 800, y: 300, r: 120 };
  const metres = DEFAULT_VENUE.wall.widthM / stage.width;

  interface Path {
    x: number;
    dir: number;
    reversals: number;
    nearest: number;
  }

  const rig = (seed: string) => {
    const pet = createPetting();
    const live = new Map<number, Path>();
    const paths: Path[] = [];
    let next = 1;
    const off = (x: number, y: number) => Math.hypot(x - ball.x, y - ball.y);
    const input: Pick<Input, "inject"> = {
      inject: {
        down: (x: number, y: number) => {
          const id = next++;
          live.set(id, { x, dir: 0, reversals: 0, nearest: off(x, y) });
          pet.down(id, x * metres, y * metres);
          return id;
        },
        move: (id: number, x: number, y: number) => {
          const p = live.get(id)!;
          const dir = Math.sign(x - p.x);
          if (dir !== 0 && p.dir !== 0 && dir !== p.dir) p.reversals++;
          if (dir !== 0) p.dir = dir;
          p.x = x;
          p.nearest = Math.min(p.nearest, off(x, y));
          pet.move(id, x * metres, y * metres, off(x, y) >= ball.r);
        },
        up: (id: number) => {
          paths.push(live.get(id)!);
          live.delete(id);
          pet.up(id);
        },
      } as Input["inject"],
    };
    const bots = createWallBots(input, 3, createRng(seed), {
      stage: () => stage,
      reach: () => ({ adult: 330, child: 450 }),
      ball: () => ball,
    });
    return { pet, bots, paths };
  };

  it("strokes the wall beside the eye every so often, so the eye shows it alone", () => {
    for (const seed of ["a", "b", "c"]) {
      const { pet, bots, paths } = rig(seed);
      for (let i = 0; i < 10 * 60 * 60; i++) {
        bots.update(STEP, true);
        pet.step(STEP);
      }
      // About one stroke a minute or two from three visitors, each lasting seconds, and every
      // finger that went back and forth kept off the eye.
      const strokes = paths.filter((p) => p.reversals >= 3);
      expect(strokes.length).toBeGreaterThanOrEqual(4);
      for (const p of strokes) expect(p.nearest).toBeGreaterThan(ball.r);
      expect(pet.episodes).toBeGreaterThanOrEqual(strokes.length);
      expect(pet.episodes).toBeLessThan(60);
      bots.dispose();
    }
    expect(BOT_STROKE.hold[0]).toBeGreaterThan(PET.sustain + PET.rise / 2);
  });
});
