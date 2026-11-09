import { describe, expect, it } from "vitest";
import type { Prop, World } from "../../../src/apps/beachball/wallphysics";
import { EMPTY_BUCKET, PROP_SCALE, PROP_SPECS } from "../../../src/apps/beachball/wallprops";
import {
  createSand,
  FLING_AFTER,
  MAX_CASTLES,
  MAX_MOUNDS,
  mouthOf,
  type Sand,
  SHOVEL_WAIT,
  SPADE_LOAD,
  STAND,
} from "../../../src/apps/beachball/wallsand";
import { createRng } from "../../../src/core/rng";
import { beach, DT, pointOf, prop } from "./beach";

const fx = () => {
  const out = { lumps: 0, puffs: 0 };
  return {
    out,
    lumps: () => void out.lumps++,
    puff: () => void out.puffs++,
  };
};

/** A wall with its bucket's sand, stepped together as the app does. */
const sandy = (o: Parameters<typeof beach>[0] = {}) => {
  const { w, l } = beach({ net: false, ...o });
  const sand = createSand(createRng("sand"), l.floor);
  const bucket = prop(w, "bucket");
  const spade = prop(w, "spade");
  const effects = fx();
  const step = (seconds: number, each?: () => void) => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      each?.();
      w.step(DT);
      sand.step(DT, w, bucket, spade, effects);
    }
  };
  return { w, l, sand, bucket, spade, effects, step };
};

/** Put a toy at x, `height` m over the sand, turned `a`, and let it fall. */
const drop = (w: World, p: Prop, x: number, height: number, a: number, spin = 0) => {
  w.placeProp(p.index, x);
  p.y += height;
  p.a = a;
  p.cs = Math.cos(a);
  p.sn = Math.sin(a);
  w.kickProp(p.index, 0, 0, spin);
};

const active = (s: Sand) => s.mounds.filter((m) => m.active);

describe("the bucket's sand", () => {
  it("is packed full to start with, heavy", () => {
    const { sand, bucket } = sandy();
    expect(sand.fill).toBe(1);
    expect(bucket.spec).toBe(PROP_SPECS.bucket);
    expect(EMPTY_BUCKET.mass).toBeLessThan(PROP_SPECS.bucket.mass / 2);
    expect(EMPTY_BUCKET.bounce).toBeGreaterThan(PROP_SPECS.bucket.bounce);
  });

  it("turned over on the sand, leaves a castle under it that shows once the bucket is off", () => {
    const { w, sand, bucket, step } = sandy();
    drop(w, bucket, bucket.x, 0.3, Math.PI - 0.04);
    step(1.5);
    expect(sand.stats.castles).toBe(1);
    expect(sand.fill).toBe(0);
    expect(bucket.spec).toBe(EMPTY_BUCKET);
    const castle = active(sand)[0]!;
    expect(castle.castle).toBe(true);
    expect(castle.hidden).toBe(true);
    expect(sand.covered).toBe(true);
    // Knocked off it, the bucket shows the castle standing in its shape.
    w.kickProp(bucket.index, -2.2, 4, 4);
    step(2);
    expect(castle.hidden).toBe(false);
    expect(castle.phase).toBe("stand");
    expect(castle.shape).toBe(1);
    // It stands a while, crumbles into a heap, and fades into the beach.
    step(STAND[1] + 3);
    expect(castle.shape).toBe(0);
    step(30);
    expect(castle.active).toBe(false);
  });

  it("on its side, slumps out of its mouth into a heap", () => {
    const { w, sand, bucket, step } = sandy();
    drop(w, bucket, bucket.x, 0.05, Math.PI / 2);
    step(2);
    expect(sand.stats.slumps).toBe(1);
    const heap = active(sand)[0]!;
    expect(heap.castle).toBe(false);
    // Beside its mouth, which faces left when it lies turned a quarter anticlockwise.
    expect(heap.x).toBeLessThan(bucket.x);
  });

  it("held or flying mouth down for a moment, drops lumps that land in a heap", () => {
    const { w, sand, bucket, effects, step } = sandy();
    drop(w, bucket, bucket.x, 2.6, Math.PI);
    step(FLING_AFTER + 0.05);
    expect(sand.stats.flings).toBe(1);
    expect(effects.out.lumps).toBeGreaterThan(0);
    step(2);
    expect(active(sand).some((m) => !m.castle)).toBe(true);
  });

  it("empty, pops higher when tapped", () => {
    const top = (empty: boolean) => {
      const { w, sand, bucket, step } = sandy();
      if (empty) sand.spill(w, bucket, fx());
      step(3);
      const y0 = bucket.y;
      w.placeProp(bucket.index, bucket.x);
      step(0.5);
      w.down(1, bucket.x - 0.1, bucket.y);
      w.up(1);
      let most = 0;
      step(1.5, () => (most = Math.max(most, bucket.y - y0)));
      return most;
    };
    expect(top(true)).toBeGreaterThan(top(false) * 1.2);
  });

  it("empty and standing upright a while, is shovelled full by an unseen spade", () => {
    const { w, l, sand, bucket, step } = sandy();
    sand.spill(w, bucket, fx());
    w.placeProp(bucket.index, l.props[1]!);
    step(SHOVEL_WAIT + 4);
    expect(sand.stats.shovels).toBe(1);
    expect(sand.fill).toBe(1);
    expect(sand.stats.refills).toBe(1);
    expect(bucket.spec).toBe(PROP_SPECS.bucket);
  });

  it("swept through a heap, scoops it up full", () => {
    const { w, l, sand, bucket, step } = sandy();
    drop(w, bucket, bucket.x, 0.05, Math.PI / 2);
    step(2);
    const heap = active(sand)[0]!;
    w.placeProp(bucket.index, heap.x + 1.2);
    step(0.6);
    // Held by its rim, brought down low and dragged along the sand through the heap.
    let x = bucket.x;
    let y = bucket.y + 0.25;
    w.down(1, x, y);
    step(0.4, () => {
      y += (l.floor + 0.3 - y) * 0.1;
      w.move(1, x, y, 0, 0);
    });
    step(1.4, () => {
      x -= 0.02;
      w.move(1, x, y, -2.4, 0);
    });
    w.up(1);
    expect(sand.stats.scoops).toBe(1);
    expect(sand.fill).toBe(1);
  });

  it("knocked by a ball, a castle comes down at once", () => {
    const { w, sand, bucket, step } = sandy({ balls: 1 });
    drop(w, bucket, bucket.x, 0.3, Math.PI);
    step(1.5);
    w.kickProp(bucket.index, 1.5, 3.6, -5);
    step(2.5);
    const castle = active(sand).find((m) => m.castle)!;
    expect(castle.hidden).toBe(false);
    w.place(0, castle.x - 1.6);
    w.kick(0, 3, 0.01, [0, 0, -3 / w.balls[0]!.r]);
    step(1.5);
    expect(sand.stats.knocks).toBeGreaterThanOrEqual(1);
    expect(castle.phase === "heap" || castle.phase === "crumble" || !castle.active).toBe(true);
    // A finger knocks one down too.
    expect(sand.touch(-5, 0, fx())).toBe(false);
  });

  it("keeps to its pools through an hour of spills", () => {
    const { w, l, sand, bucket, step } = sandy();
    const rng = createRng("spills");
    let most = 0;
    let castles = 0;
    for (let i = 0; i < 180; i++) {
      if (sand.fill < 0.5) {
        // Stood upright, the unseen spade fills it again.
        w.placeProp(bucket.index, rng.range(1, l.width - 1));
        step(SHOVEL_WAIT + 3.5);
      }
      const r = rng.next();
      const x = rng.range(1, l.width - 1);
      if (r < 0.3) drop(w, bucket, x, 0.3, Math.PI);
      else if (r < 0.6) drop(w, bucket, x, 0.05, Math.PI / 2);
      else w.kickProp(bucket.index, rng.range(-3, 3), rng.range(3, 7), rng.range(-9, 9));
      step(10, () => {
        most = Math.max(most, active(sand).length);
        castles = Math.max(
          castles,
          sand.mounds.filter((m) => m.active && m.castle && m.phase === "stand").length,
        );
      });
    }
    expect(most).toBeLessThanOrEqual(MAX_MOUNDS);
    expect(castles).toBeLessThanOrEqual(MAX_CASTLES);
    expect(sand.stats.castles + sand.stats.slumps + sand.stats.flings).toBeGreaterThan(50);
    sand.reset(w, bucket, null);
    expect(active(sand)).toHaveLength(0);
    expect(sand.fill).toBe(1);
  }, 60_000);
});

describe("the spade", () => {
  /** Carry the spade by its handle's end to over the bucket, and lower it in. */
  const carryIn = (s: ReturnType<typeof sandy>) => {
    const { w, spade, bucket, step } = s;
    const grip = pointOf(spade, 0.68 * PROP_SCALE);
    let x = grip.x;
    let y = grip.y;
    w.down(1, x, y);
    const to = (tx: number, ty: number, seconds: number) => {
      const n = Math.round(seconds / DT);
      const dx = (tx - x) / n;
      const dy = (ty - y) / n;
      step(seconds, () => {
        x += dx;
        y += dy;
        w.move(1, x, y, dx / DT, dy / DT);
      });
    };
    const m = mouthOf(bucket);
    to(x, m.y + 1.6, 0.6);
    to(m.x, m.y + 1.6, 1.4);
    to(m.x, m.y + 1.6, 1);
    to(m.x, m.y + 0.95, 0.8);
    w.up(1);
    step(0.3);
  };

  it("lowered blade first into the bucket, stands in it and rides with it", () => {
    const s = sandy();
    carryIn(s);
    expect(s.sand.stowed).toBe(true);
    expect(s.sand.stats.stows).toBe(1);
    expect(s.spade.off).toBe(true);
    // The bucket carried along takes the spade with it.
    const dx = s.spade.x - s.bucket.x;
    s.w.kickProp(s.bucket.index, 0.8, 0, 0);
    s.step(0.4);
    expect(s.spade.x - s.bucket.x).toBeCloseTo(dx, 1);
    // A finger on its handle pulls it out.
    const handle = pointOf(s.spade, 0.66 * PROP_SCALE);
    expect(s.sand.handleDistance(s.spade, handle.x, handle.y)).toBeLessThan(0.05);
    s.sand.pullSpade(s.w, s.spade);
    expect(s.w.down(2, handle.x, handle.y)).toBe("grab");
    expect(s.spade.holder).toBe(2);
  });

  it("falls out when the bucket tips over", () => {
    const s = sandy();
    carryIn(s);
    s.w.kickProp(s.bucket.index, 1.5, 4, 8);
    s.step(1);
    expect(s.sand.stowed).toBe(false);
    expect(s.spade.off).toBe(false);
    s.step(5);
    expect(s.spade.asleep).toBe(true);
  });

  it("picks up sand dragged through it, and pours it into the bucket held over it", () => {
    const s = sandy();
    s.sand.spill(s.w, s.bucket, fx());
    s.w.placeProp(s.bucket.index, s.bucket.x);
    s.step(2);
    // Held by the handle, its blade dragged along the sand.
    const grip = pointOf(s.spade, 0.68 * PROP_SCALE);
    let x = grip.x;
    let y = grip.y;
    s.w.down(1, x, y);
    s.step(1, () => {
      x -= 0.012;
      s.w.move(1, x, y, -1.4, 0);
    });
    expect(s.sand.stats.digs).toBe(1);
    expect(s.sand.load).toBe(1);
    s.w.up(1);
    s.step(1);
    // Carried over the bucket's mouth, the sand pours in.
    const was = s.sand.fill;
    carryIn(s);
    expect(s.sand.stats.pours).toBe(1);
    expect(s.sand.fill).toBeCloseTo(was + SPADE_LOAD, 6);
    expect(s.sand.load).toBe(0);
  });

  it("flicked while loaded, throws its sand onto the beach in a heap", () => {
    const s = sandy();
    const before = active(s.sand).length;
    const grip = pointOf(s.spade, 0.68 * PROP_SCALE);
    let x = grip.x;
    const y = grip.y;
    s.w.down(1, x, y);
    s.step(1, () => {
      x += 0.012;
      s.w.move(1, x, y, 1.4, 0);
    });
    s.w.up(1);
    expect(s.sand.load).toBe(1);
    s.w.kickProp(s.spade.index, 2, 5, 14);
    s.step(3);
    expect(s.sand.stats.throws).toBe(1);
    expect(s.sand.load).toBe(0);
    expect(active(s.sand).length).toBeGreaterThan(before);
  });

  it("is put back empty and out of the bucket by a reset", () => {
    const s = sandy();
    carryIn(s);
    s.sand.reset(s.w, s.bucket, s.spade);
    expect(s.sand.stowed).toBe(false);
    expect(s.spade.off).toBe(false);
    expect(s.sand.load).toBe(0);
    expect(s.sand.fill).toBe(1);
  });
});
