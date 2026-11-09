import { describe, expect, it } from "vitest";
import { FALL_TAU, FLY_TAU, GAP_D, GRAVITY_D, MAX_QUEUE } from "../../../src/apps/recycling/config";
import { classFor, createFeed } from "../../../src/apps/recycling/feed";
import { ITEMS } from "../../../src/apps/recycling/items";
import { binOfKind } from "../../../src/apps/recycling/layout";
import { type Fall, fallAt, predictCrossing } from "../../../src/apps/recycling/physics";
import { createPicker } from "../../../src/apps/recycling/picker";
import { planCarry } from "../../../src/apps/recycling/plan";
import { createRng } from "../../../src/core/rng";
import { DT, dragTo, kindOf, onBelt, run, TOUCH_KINDS, worldOf } from "./helpers";

/** The sideways speed that makes a throw from (x, y) going up at `vy` cross height `y1` at `x1`. */
const aimAt = (x: number, y: number, vy: number, x1: number, y1: number, g: number) => {
  let lo = -5000;
  let hi = 5000;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const hit = predictCrossing(
      { x, y, vx: mid, vy },
      [{ x0: -1e5, x1: 1e5, y: y1 }],
      g,
      FLY_TAU,
      0,
    );
    if (!hit || hit.x < x1) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

describe("recycling world: the way in", () => {
  it("an item falls into the inlet, rides a tube and lands on its belt: tricky ones high, obvious ones low", () => {
    const w = worldOf("panel");
    const clock = { t: 1000 };
    const can = onBelt(w, 0, kindOf("can"), clock);
    expect(w.layout.belts[can.belt]!.speed).toBe("slow");
    const battery = onBelt(w, 0, kindOf("battery"), clock);
    expect(w.layout.belts[battery.belt]!.speed).toBe("fast");
    // It moves along at the belt's speed.
    const s0 = battery.s;
    run(w, 1, clock);
    expect(battery.s - s0).toBeGreaterThan(w.layout.d * 0.4);
  });

  it("on a wall, items come down the plant's cascade first", () => {
    const w = worldOf("wall");
    const clock = { t: 0 };
    const it = w.spawn(2, kindOf("apple"), clock.t)!;
    expect(it.state).toBe("chute");
    expect(run(w, 20, clock, () => it.state === "belt")).toBe(true);
    expect(it.line).toBe(2);
    expect(it.x).toBeGreaterThan(w.layout.lines[2]!.x0);
  });

  it("the two-bin variant sends items to either belt", () => {
    const w = worldOf("panel", { variant: "simple" });
    const clock = { t: 0 };
    const used = new Set<number>();
    for (let i = 0; i < 6; i++) {
      const it = onBelt(w, 0, kindOf(i % 2 ? "can" : "toy"), clock);
      used.add(it.belt);
    }
    expect(used.size).toBe(2);
  });

  it("items on a belt keep their spacing", () => {
    const w = worldOf("kiosk", { speed: 0.6 });
    const clock = { t: 0 };
    for (let i = 0; i < 8; i++) {
      w.spawn(0, kindOf("can"), clock.t);
      run(w, 0.5, clock);
    }
    run(w, 20, clock);
    const on = w.items.filter((it) => it.state === "belt").sort((a, b) => a.s - b.s);
    expect(on.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < on.length; i++) {
      expect(on[i]!.s - on[i - 1]!.s).toBeGreaterThanOrEqual(GAP_D * w.layout.d - 1e-6);
    }
  });

  it("an item from the screen comes in where its fall says, early or late", () => {
    const w = worldOf("panel");
    const L = w.layout;
    const clock = { t: 50_000 };
    w.step(DT, clock.t);
    const fall: Fall = {
      t0: clock.t,
      x0: L.lines[0]!.inlet.x,
      y0: -1400,
      vx0: 0,
      vy0: 90,
      g: GRAVITY_D * 150,
      tau: FALL_TAU,
    };
    const early = w.arrive(0, kindOf("can"), fall, 0, 1)!;
    expect(early.y).toBeLessThan(0);
    // Late: the message comes 1.6 s after the fall began, and the item is already well down.
    const late = w.arrive(0, kindOf("tin"), { ...fall, t0: clock.t - 1600 }, 0, 1)!;
    const want = fallAt({ ...fall, t0: clock.t - 1600 }, 1.6);
    expect(late.y).toBeCloseTo(want.y, 3);
    run(w, 0.5, clock);
    const at = fallAt(fall, (clock.t - fall.t0) / 1000);
    expect(early.y).toBeCloseTo(at.y, 3);
    expect(run(w, 5, clock, () => early.state !== "fall")).toBe(true);
    expect(early.state).toMatch(/queue|tube/);
  });
});

describe("recycling world: sorting", () => {
  for (const kind of TOUCH_KINDS) {
    it(`${kind}: dragging an item into its bin counts, and the bin fills`, () => {
      const w = worldOf(kind);
      const clock = { t: 0 };
      const it = onBelt(w, 0, kindOf("banana"), clock);
      const bin = binOfKind(w.layout, 0, "compost")!;
      const grabbed = w.grab(7, it.x, it.y, "person");
      expect(grabbed).toBe(it);
      dragTo(w, 7, planCarry(w.layout, { x: it.x, y: it.y }, bin), clock);
      run(w, 1, clock, () => !w.items.includes(it));
      w.release(7, 0, 0);
      run(w, 1, clock);
      expect(w.counts.right).toBe(1);
      expect(w.counts.people).toBe(1);
      expect(w.items.includes(it)).toBe(false);
      const state = w.bins.find((b) => b.slot === bin)!;
      expect(state.fill).toBe(1);
      expect(w.events.some((e) => e.type === "sorted" && e.right && e.bin === "compost")).toBe(
        true,
      );
    });
  }

  it("a wrong bin pushes the item back out onto the belt and the right bin's lid glows", () => {
    const w = worldOf("panel");
    const clock = { t: 0 };
    const it = onBelt(w, 0, kindOf("can"), clock);
    const wrong = binOfKind(w.layout, 0, "rubbish")!;
    w.grab(3, it.x, it.y, "person");
    dragTo(w, 3, planCarry(w.layout, { x: it.x, y: it.y }, wrong), clock);
    run(w, 1, clock, () => it.state !== "held");
    expect(it.state).toMatch(/sink|eject/);
    expect(w.counts.wrong).toBe(1);
    w.release(3, 0, 0);
    expect(run(w, 1, clock, () => it.state === "eject")).toBe(true);
    const right = w.bins.find((b) => b.slot.kind === "recycle" && b.slot.line === 0)!;
    expect(right.glow).toBeGreaterThan(0);
    expect(run(w, 4, clock, () => it.state === "belt")).toBe(true);
    expect(it.belt).toBe(wrong.belt);
    expect(w.bins.find((b) => b.slot === wrong)!.fill).toBe(0);
  });

  it("with hints off, no lid glows", () => {
    const w = worldOf("panel", { hints: false });
    const clock = { t: 0 };
    const it = onBelt(w, 0, kindOf("can"), clock);
    w.grab(3, it.x, it.y, "person");
    dragTo(
      w,
      3,
      planCarry(w.layout, { x: it.x, y: it.y }, binOfKind(w.layout, 0, "compost")!),
      clock,
    );
    run(w, 1, clock, () => it.state === "eject");
    expect(w.bins.every((b) => b.glow === 0)).toBe(true);
  });

  it("an item let go above a bin's mouth drops in, and one let go inside a bin counts", () => {
    const w = worldOf("kiosk");
    const clock = { t: 0 };
    const bin = binOfKind(w.layout, 0, "recycle")!;
    const a = onBelt(w, 0, kindOf("box"), clock);
    w.grab(1, a.x, a.y, "person");
    dragTo(
      w,
      1,
      [
        { x: a.x, y: a.y },
        { x: bin.x, y: bin.top - w.layout.d },
      ],
      clock,
    );
    run(w, 0.3, clock);
    w.release(1, 0, 0);
    expect(run(w, 2, clock, () => w.counts.right === 1)).toBe(true);
    // Dragged in through the side, below the rim, then let go.
    const b = onBelt(w, 0, kindOf("newspaper"), clock);
    w.grab(2, b.x, b.y, "person");
    const side = bin.x - bin.w / 2 - w.layout.d;
    dragTo(
      w,
      2,
      [
        { x: b.x, y: b.y },
        { x: side, y: b.y },
        { x: side, y: bin.top + w.layout.d },
        { x: bin.x, y: bin.top + w.layout.d },
      ],
      clock,
    );
    run(w, 0.4, clock);
    expect(b.state).toBe("held");
    w.release(2, 0, 0);
    expect(w.counts.right).toBe(2);
  });

  it("a thrown item flies into the bin it is heading for, with a little help", () => {
    for (const kind of TOUCH_KINDS) {
      const w = worldOf(kind);
      const L = w.layout;
      const clock = { t: 0 };
      const it = onBelt(w, 0, kindOf("apple"), clock);
      const bin = binOfKind(L, 0, "compost")!;
      w.grab(5, it.x, it.y, "person");
      run(w, 0.3, clock);
      // A lob that would clip the far rim without help.
      const g = GRAVITY_D * L.d;
      const tx = bin.x + (bin.mouth.x1 - bin.mouth.x0) * 0.45;
      const apex = Math.min(it.y, bin.top) - L.d * 1.2;
      const vy = -Math.sqrt(2 * g * (it.y - apex));
      const vx = aimAt(it.x, it.y, vy, tx, bin.top, g);
      const free = predictCrossing({ x: it.x, y: it.y, vx, vy }, [bin.mouth], g, FLY_TAU, 1e4)!;
      expect(free.x).toBeCloseTo(tx, 0);
      w.release(5, vx, vy);
      expect(
        run(w, 4, clock, () => it.state !== "fly"),
        kind,
      ).toBe(true);
      expect(w.counts.right, kind).toBe(1);
    }
  });

  it("something that misses every bin lands on the floor and comes back round", () => {
    const w = worldOf("panel");
    const clock = { t: 0 };
    const it = onBelt(w, 0, kindOf("can"), clock);
    w.grab(4, it.x, it.y, "person");
    // Hard against the left wall, straight down past the end of the bin row.
    dragTo(
      w,
      4,
      [
        { x: it.x, y: it.y },
        { x: w.layout.r, y: it.y },
      ],
      clock,
    );
    run(w, 0.3, clock);
    w.release(4, -3000, 3000);
    expect(run(w, 3, clock, () => it.state === "poof" || it.state === "sink")).toBe(true);
    if (it.state === "poof") {
      expect(w.counts.missed).toBe(1);
      expect(run(w, 6, clock, () => it.state === "belt")).toBe(true);
    }
  });

  it("a held item follows the finger softly and tilts as it swings", () => {
    const w = worldOf("panel");
    const clock = { t: 0 };
    const it = onBelt(w, 0, kindOf("milk"), clock);
    w.grab(9, it.x + 20, it.y, "person");
    w.move(9, it.x + 300, it.y - 100);
    clock.t += DT * 1000;
    w.step(DT, clock.t);
    expect(it.x).toBeLessThan(it.fx);
    run(w, 0.05, clock);
    expect(Math.abs(it.a)).toBeGreaterThan(0.02);
    run(w, 1, clock);
    expect(Math.hypot(it.x - (it.fx + it.ox), it.y - (it.fy + it.oy))).toBeLessThan(2);
  });
});

describe("recycling world: going round, filling up and staying bounded", () => {
  it("an item that rides off the end goes up the lift and comes round again", () => {
    const w = worldOf("panel", { speed: 4 });
    const clock = { t: 0 };
    const it = onBelt(w, 0, kindOf("leaves"), clock);
    expect(run(w, 30, clock, () => it.state === "lift")).toBe(true);
    expect(w.counts.missed).toBe(1);
    expect(w.events.some((e) => e.type === "missed")).toBe(true);
    expect(run(w, 30, clock, () => it.state === "belt")).toBe(true);
  });

  it("a full bin rises away, makes something and a fresh one comes up", () => {
    const w = worldOf("panel");
    const clock = { t: 0 };
    const bin = binOfKind(w.layout, 0, "recycle")!;
    const state = w.bins.find((b) => b.slot === bin)!;
    let n = 0;
    while (state.phase === "ready" && n < 30) {
      const it = onBelt(w, 0, kindOf(n % 3 === 0 ? "plasticBottle" : "can"), clock);
      w.grab(1, it.x, it.y, "bot");
      dragTo(w, 1, planCarry(w.layout, { x: it.x, y: it.y }, bin), clock);
      w.release(1, 0, 0);
      run(w, 1, clock);
      n++;
    }
    expect(n).toBe(bin.cap);
    expect(w.counts.full).toBe(1);
    const full = w.events.find((e) => e.type === "full");
    expect(full && full.type === "full" && full.rise.product).toBe("bike");
    expect(run(w, 5, clock, () => w.events.some((e) => e.type === "delivered"))).toBe(true);
    expect(run(w, 3, clock, () => state.phase === "ready")).toBe(true);
    expect(state.fill).toBe(0);
  });

  it("compost turns into trees and flowers, the drop-off box into lamps and rubbish into nothing", () => {
    const w = worldOf("kiosk");
    const clock = { t: 0 };
    const products: (string | null)[] = [];
    for (const [kind, item] of [
      ["compost", "apple"],
      ["compost", "banana"],
      ["dropoff", "battery"],
      ["rubbish", "toy"],
    ] as const) {
      const bin = binOfKind(w.layout, 0, kind)!;
      const state = w.bins.find((b) => b.slot === bin)!;
      run(w, 3, clock, () => state.phase === "ready");
      for (let i = 0; i < bin.cap; i++) {
        const it = onBelt(w, 0, kindOf(item), clock);
        w.grab(1, it.x, it.y, "bot");
        dragTo(w, 1, planCarry(w.layout, { x: it.x, y: it.y }, bin), clock);
        w.release(1, 0, 0);
        run(w, 0.6, clock);
      }
      const e = w.events.filter((x) => x.type === "full").pop();
      products.push(e && e.type === "full" ? e.rise.product : "none");
      w.events.length = 0;
    }
    expect(products).toEqual(["tree", "flowers", "lamp", null]);
  });

  it("never holds more items than its bound, and the funnel never queues more than its bound", () => {
    const w = worldOf("panel", { maxItems: 20, speed: 0.05 });
    const clock = { t: 0 };
    for (let i = 0; i < 60; i++) {
      w.spawn(0, i % ITEMS.length, clock.t);
      run(w, 0.2, clock);
      expect(w.items.length).toBeLessThanOrEqual(20);
      expect(w.items.filter((it) => it.state === "queue").length).toBeLessThanOrEqual(
        MAX_QUEUE + 1,
      );
    }
    expect(w.counts.refused).toBeGreaterThan(0);
  });

  it("let go of everything, and clear empties it all", () => {
    const w = worldOf("pair");
    const clock = { t: 0 };
    const a = onBelt(w, 0, kindOf("can"), clock);
    const b = onBelt(w, 1, kindOf("toy"), clock);
    w.grab(1, a.x, a.y, "person");
    w.grab(2, b.x, b.y, "person");
    w.dropHolds();
    expect(w.items.every((it) => it.state !== "held")).toBe(true);
    w.clear();
    expect(w.items.length).toBe(0);
    expect(w.rising.length).toBe(0);
  });

  it("runs for a long while with random hands and stays sound", () => {
    for (const kind of TOUCH_KINDS) {
      const w = worldOf(kind, { maxItems: kind === "wall" ? 60 : 20 });
      const rng = createRng(`soak:${kind}`);
      const clock = { t: 0 };
      let finger = 100;
      const held = new Map<number, number>();
      for (let step = 0; step < 60 * 60 * 4; step++) {
        if (step % 50 === 0)
          w.spawn(rng.int(w.layout.lines.length), rng.int(ITEMS.length), clock.t);
        if (step % 37 === 0) {
          const target = w.items.find((it) => it.state === "belt");
          if (target) {
            const f = finger++;
            if (w.grab(f, target.x, target.y, "bot")) held.set(f, step);
          }
        }
        for (const [f, at] of held) {
          const it = w.held(f);
          if (!it || step - at > 40) {
            w.release(f, rng.range(-2000, 2000), rng.range(-2500, 1500));
            held.delete(f);
          } else {
            w.move(f, it.fx + rng.range(-30, 30), it.fy + rng.range(-10, 40));
          }
        }
        clock.t += DT * 1000;
        w.step(DT, clock.t);
        w.events.length = 0;
        expect(w.items.length).toBeLessThanOrEqual(kind === "wall" ? 60 : 20);
      }
      for (const it of w.items) {
        expect(Number.isFinite(it.x) && Number.isFinite(it.y), kind).toBe(true);
        expect(it.y, kind).toBeLessThan(w.layout.height * 1.5);
      }
      expect(w.counts.right + w.counts.wrong, kind).toBeGreaterThan(20);
      expect(w.rising.length).toBeLessThanOrEqual(16);
    }
  });
});

describe("recycling feed", () => {
  it("keeps each line near its target, feeding the emptier belt", () => {
    for (const kind of TOUCH_KINDS) {
      const w = worldOf(kind, { maxItems: 60, speed: 0.3 });
      const feed = createFeed({
        world: w,
        picker: createPicker(createRng(4), "sort"),
        rng: createRng(5),
        interval: () => 1,
        target: () => 6,
      });
      const clock = { t: 0 };
      for (let i = 0; i < 60 * 60; i++) {
        clock.t += DT * 1000;
        feed.step(DT, clock.t);
        w.step(DT, clock.t);
        w.events.length = 0;
      }
      for (let line = 0; line < w.layout.lines.length; line++) {
        expect(w.load(line), `${kind} ${line}`).toBeGreaterThanOrEqual(5);
        expect(w.load(line), `${kind} ${line}`).toBeLessThanOrEqual(6);
        // Both belts of a two-belt line get items.
        const belts = new Set(
          w.items.filter((it) => it.line === line && it.state === "belt").map((it) => it.belt),
        );
        expect(belts.size, kind).toBe(w.layout.lines[line]!.belts.length);
      }
      expect(classFor(w, 0)).toMatch(/tricky|obvious|any/);
    }
  });
});
