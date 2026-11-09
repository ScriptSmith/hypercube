import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import type { Vec3 } from "../../../src/core/sphere";
import type { AppContext, FrameInfo, SetupInfo } from "../../../src/core/types";
import { angle, bearing, elevation } from "../../../src/apps/gaze/geom";
import { createMotion } from "../../../src/apps/gaze/motion";
import { WALL_EYE, WALL_LOOK, wallLayout, wallLimit } from "../../../src/apps/gaze/wall";
import {
  createWallCrowd,
  SQUEEZE,
  squeeze,
  TOUCHER,
  type WallCrowd,
} from "../../../src/apps/gaze/wallcrowd";
import { MAX_PEOPLE } from "../../../src/apps/gaze/crowd";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { DEFAULT_VENUE } from "../../../src/core/venue";

const DEG = Math.PI / 180;
const STEP = 1 / 60;

const WALL = VENUE_SIZE.wall;
const REACH = DEFAULT_REACH.wall;

const frame = (over: Partial<FrameInfo> = {}): FrameInfo => ({
  kind: "wall",
  venueWidth: WALL.width,
  venueHeight: WALL.height,
  width: 1600,
  height: 600,
  unit: 1600 / WALL.width,
  pixelRatio: 1,
  touch: true,
  reach: REACH,
  reachTop: { adult: 600 * (1 - REACH.adult), child: 600 * (1 - REACH.child) },
  seams: [],
  ...over,
});
const setup: SetupInfo = { name: "solo", role: "solo", pos: 0, count: 1, group: "g", side: 0 };
const ctx = { frame: frame(), setup } as Pick<AppContext, "frame" | "setup">;

const rig = (seed = "wall") => {
  const layout = wallLayout(ctx);
  let crowd: WallCrowd | null = null;
  const motion = createMotion({
    rng: createRng(seed),
    sphere: {
      radius: layout.ball.radius,
      centreY: layout.ball.centre[1],
      cover: { top: Math.PI / 2, bottom: -Math.PI / 2 },
      view: { top: Math.PI / 2, bottom: -Math.PI / 2 },
    },
    space: {
      limit: wallLimit,
      crowd: (r) => {
        crowd = createWallCrowd(r, layout.room);
        return crowd;
      },
      focus: (c) => crowd?.focus(c) ?? null,
    },
  });
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      motion.step(STEP);
      each?.();
    }
  };
  return { motion, crowd: crowd as unknown as WallCrowd, layout, run };
};

describe("gaze on a wall: layout", () => {
  it("puts the eye in the middle of the wall, most of its height across", () => {
    const l = wallLayout(ctx);
    expect(l.ball.centre[0]).toBeCloseTo(0, 6);
    const { bottomM, heightM, widthM } = DEFAULT_VENUE.wall;
    expect(l.ball.centre[1]).toBeCloseTo(bottomM + heightM / 2, 6);
    expect(l.ball.radius * 2).toBeCloseTo(WALL_EYE.diameter * heightM, 6);
    expect(l.room.left).toBeCloseTo(-widthM / 2, 6);
    expect(l.room.right).toBeCloseTo(widthM / 2, 6);
    expect(l.lamp[1]).toBeGreaterThan(l.ball.centre[1]);
    expect(l.lamp[2]).toBeGreaterThan(0);
  });

  it("keeps the eye's size and place when the stage changes shape", () => {
    const wide = wallLayout({
      frame: frame({ width: 1600, height: 900, unit: 1600 / WALL.width }),
      setup,
    });
    const l = wallLayout(ctx);
    expect(wide.ball.radius).toBeCloseTo(l.ball.radius, 6);
    expect(wide.ball.centre[1]).toBeCloseTo(l.ball.centre[1], 6);
  });
});

describe("gaze on a wall: where it can look", () => {
  it("squeezes directions towards straight out without changing small ones much", () => {
    const small = squeeze([Math.sin(10 * DEG), 0, Math.cos(10 * DEG)]);
    expect(angle(small, [0, 0, 1]) / DEG).toBeCloseTo(10, 0);
    let last = 0;
    for (let a = 1; a <= 179; a += 2) {
      const d = squeeze([Math.sin(a * DEG) * 0.6, Math.sin(a * DEG) * 0.8, Math.cos(a * DEG)]);
      const off = angle(d, [0, 0, 1]);
      expect(off).toBeLessThan(SQUEEZE + 1e-9);
      expect(off).toBeGreaterThanOrEqual(last);
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 9);
      last = off;
    }
  });

  it("keeps every look out into the room, within reach of a real eye", () => {
    for (let e = -90; e <= 90; e += 7) {
      for (let b = -180; b <= 180; b += 11) {
        const c = Math.cos(e * DEG);
        const d = wallLimit([c * Math.sin(b * DEG), Math.sin(e * DEG), c * Math.cos(b * DEG)]);
        expect(angle(d, [0, 0, 1])).toBeLessThan(WALL_LOOK.off + 1e-6);
        expect(elevation(d)).toBeLessThanOrEqual(WALL_LOOK.high + 1e-6);
        expect(elevation(d)).toBeGreaterThanOrEqual(WALL_LOOK.low - 1e-6);
      }
    }
    const inside: Vec3 = [0.2, -0.1, Math.sqrt(1 - 0.05)];
    expect(wallLimit(inside)).toBe(inside);
  });

  it("turns to touches anywhere on the wall in proportion to where they are", () => {
    const room = wallLayout(ctx).room;
    const c = createWallCrowd(createRng("anywhere"), room);
    const look = (x: number, y: number, id: number) => {
      const p = c.touchDown(id, x, y).person;
      const d = c.direction(p);
      c.touchUp(id);
      c.release();
      for (let i = 0; i < 120; i++) c.step(STEP);
      return { bearing: bearing(d) / DEG, elevation: elevation(d) / DEG };
    };
    const across = [-6, -3, -1, 0, 1, 3, 6].map((x, i) => look(x, room.centre[1], 10 + i));
    for (let i = 1; i < across.length; i++) {
      expect(across[i]!.bearing).toBeGreaterThan(across[i - 1]!.bearing + 3);
    }
    expect(Math.abs(across[3]!.bearing)).toBeLessThan(1);
    const heights = [0.3, 1, 2, room.centre[1], 3.5, 4.8].map((y, i) => look(0.5, y, 30 + i));
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!.elevation).toBeGreaterThan(heights[i - 1]!.elevation + 3);
    }
    // Above the eye it looks up, below it down, by about as much.
    expect(heights[5]!.elevation).toBeGreaterThan(20);
    expect(heights[0]!.elevation).toBeLessThan(-20);
  });
});

describe("gaze on a wall: people touching", () => {
  const room = wallLayout(ctx).room;

  it("stands someone at a touch and treats nearby fingers as their other hand", () => {
    const c = createWallCrowd(createRng("a"), room);
    const a = c.touchDown(1, -4, 1.2);
    expect(a.fresh).toBe(true);
    expect(a.person.x).toBeCloseTo(-4, 6);
    expect(a.person.z).toBeCloseTo(TOUCHER.out, 6);
    expect(a.person.eye).toBeCloseTo(1.2, 6);
    const b = c.touchDown(2, -3.6, 1.0);
    expect(b.person).toBe(a.person);
    expect(b.fresh).toBe(false);
    const d = c.touchDown(3, 3, 0.5);
    expect(d.person).not.toBe(a.person);
    expect(c.touchers.length).toBe(2);
    // The latest draws the eye most.
    c.step(STEP);
    expect(d.person.pull).toBe(TOUCHER.latestPull);
    expect(a.person.pull).toBe(TOUCHER.otherPull);
  });

  it("follows a moving finger and lets people go a while after they let go", () => {
    const c = createWallCrowd(createRng("b"), room);
    const { person } = c.touchDown(7, 0, 1.4);
    for (let i = 0; i < 60; i++) {
      c.touchMove(7, i * 0.02, 1.4);
      c.step(STEP);
    }
    expect(person.x).toBeCloseTo(59 * 0.02, 6);
    expect(person.vx).toBeGreaterThan(0.8);
    c.touchUp(7);
    c.step(STEP);
    expect(c.touchers.length).toBe(0);
    expect(person.pull).toBeGreaterThan(1);
    for (let i = 0; i < 6 * 60; i++) c.step(STEP);
    expect(person.pull).toBeUndefined();
    expect(person.leaving).toBe(true);
  });

  it("keeps the places to look at round a touch close to it", () => {
    const c = createWallCrowd(createRng("c"), room);
    const { person } = c.touchDown(1, 3, 0.9);
    c.touchDown(2, 3.4, 1.3);
    const eyes = c.direction(person, "eyes");
    expect(bearing(eyes)).toBeGreaterThan(0);
    for (const part of ["mouth", "chest", "leftHand", "rightHand", "feet"] as const) {
      expect(angle(eyes, c.direction(person, part)) / DEG).toBeLessThan(12);
    }
    // The right hand is the touch further right.
    expect(bearing(c.direction(person, "rightHand"))).toBeGreaterThan(
      bearing(c.direction(person, "leftHand")),
    );
  });

  it("never holds more people than it can, however many touch", () => {
    const c = createWallCrowd(createRng("d"), room);
    for (let i = 0; i < 200; i++) {
      c.touchDown(i, -6 + (i % 13), 1);
      if (i % 3 === 0) c.touchUp(i - 1);
      c.step(STEP);
    }
    expect(c.people.length).toBeLessThanOrEqual(MAX_PEOPLE);
    expect(c.touchers.length).toBeLessThanOrEqual(TOUCHER.most);
    c.release();
    for (let i = 0; i < 60; i++) c.step(STEP);
    expect(c.touchers.length).toBe(0);
  });

  it("keeps its imagined crowd in front of the wall for hours", () => {
    const c = createWallCrowd(createRng("e"), room);
    let most = 0;
    for (let i = 0; i < 3 * 3600 * 10; i++) {
      c.step(0.1);
      most = Math.max(most, c.people.length);
      if (i % 600 === 0) {
        for (const p of c.people) {
          expect(p.z).toBeGreaterThan(0.3);
          expect(p.z).toBeLessThan(room.depth + 1);
          expect(Math.abs(p.x)).toBeLessThan(room.right + 2);
        }
      }
    }
    expect(most).toBeGreaterThan(3);
    expect(most).toBeLessThanOrEqual(MAX_PEOPLE);
  });
});

describe("gaze on a wall: the eye turns to touches", () => {
  it("turns to someone touching within a moment, and to the next", () => {
    const { motion, crowd, run } = rig();
    run(8);
    const left = crowd.touchDown(1, -6, 1.1).person;
    motion.attend(left.id, { delay: 0.2 });
    run(0.7);
    expect(motion.target).toBe(left.id);
    expect(bearing(motion.gaze) / DEG).toBeLessThan(-30);
    const right = crowd.touchDown(2, 5, 0.6).person;
    motion.attend(right.id, { delay: 0.2 });
    // Over 50 degrees, so it goes in steps.
    run(1.3);
    expect(motion.target).toBe(right.id);
    expect(bearing(motion.gaze) / DEG).toBeGreaterThan(30);
    expect(motion.stats.attends).toBe(2);
  });

  it("looks mostly at people touching while they touch", () => {
    const { motion, crowd, run } = rig("b");
    run(5);
    const a = crowd.touchDown(1, -3, 1.2).person;
    const b = crowd.touchDown(2, 3.5, 1.2).person;
    let on = 0;
    let total = 0;
    run(40, () => {
      total++;
      if (motion.target === a.id || motion.target === b.id) on++;
    });
    expect(on / total).toBeGreaterThan(0.6);
    expect(motion.stats.focuses).toBeGreaterThan(5);
  });

  it("follows a finger sliding along the wall", () => {
    const { motion, crowd, run } = rig("c");
    run(5);
    const p = crowd.touchDown(1, -4, 1.3).person;
    motion.attend(p.id, { delay: 0.15 });
    run(0.8);
    const start = bearing(motion.gaze);
    let x = -4;
    run(2.5, () => {
      x += 1.6 * STEP;
      crowd.touchMove(1, x, 1.3);
    });
    expect(bearing(motion.gaze)).toBeGreaterThan(start + 15 * DEG);
    expect(motion.stats.pursuits + motion.stats.catchUps).toBeGreaterThan(0);
  });

  it("darts up and away first when the eye itself is touched", () => {
    const { motion, crowd, run } = rig("d");
    run(5);
    const p = crowd.touchDown(1, 0.3, 1.2).person;
    const before = elevation(motion.gaze);
    motion.attend(p.id, { delay: 0.05, flinch: true });
    let highest = -Infinity;
    run(0.3, () => {
      highest = Math.max(highest, elevation(motion.gaze));
    });
    expect(highest).toBeGreaterThan(before + 8 * DEG);
    run(1);
    expect(motion.target).toBe(p.id);
  });

  it("never looks into the wall, whatever people do, over twenty minutes", () => {
    const { motion, crowd, run } = rig("e");
    const rng = createRng("touches");
    let id = 0;
    for (let s = 0; s < 20 * 60; s += 2) {
      if (rng.next() < 0.4) {
        const p = crowd.touchDown(++id, rng.range(-6.6, 6.6), rng.range(0.2, 2.3)).person;
        if (rng.next() < 0.5) motion.attend(p.id, { delay: 0.2, flinch: rng.next() < 0.2 });
      }
      if (rng.next() < 0.5) crowd.touchUp(id - rng.int(3));
      run(2, () => {
        expect(angle(motion.gaze, [0, 0, 1])).toBeLessThan(WALL_LOOK.off + 1e-6);
      });
    }
    expect(crowd.people.length).toBeLessThanOrEqual(MAX_PEOPLE);
  }, 60_000);
});
