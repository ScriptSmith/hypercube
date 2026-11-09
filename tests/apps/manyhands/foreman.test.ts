import { describe, expect, it } from "vitest";
import {
  assignOrders,
  filledCount,
  isComplete,
  needOf,
  newBuild,
  pickSlot,
} from "../../../src/apps/manyhands/build";
import { ALIVE_MS, FINISH_MS, HELPER_FLY_MS } from "../../../src/apps/manyhands/config";
import { createForeman, type Delivery, partsFor } from "../../../src/apps/manyhands/foreman";
import { coverOf } from "./helpers";

const STEP = 50;

const run = (f: ReturnType<typeof createForeman>, from: number, to: number, cover = coverOf(4)) => {
  for (let t = from; t <= to; t += STEP) f.update(t, cover);
};

const part = (kind: number, at: number, over: Partial<Delivery> = {}): Delivery => ({
  kind,
  maker: "person",
  color: 2,
  column: 0,
  departAt: at,
  arriveAt: at + 900,
  sx: 0.5,
  sy: 1,
  ...over,
});

describe("build sizes", () => {
  it("is about four parts per active slot, from 12 to 48", () => {
    expect(partsFor(0)).toBe(12);
    expect(partsFor(2)).toBe(12);
    expect(partsFor(5)).toBe(20);
    expect(partsFor(10)).toBe(40);
    expect(partsFor(30)).toBe(48);
  });

  it("sizes each new build from the slots active when it starts", () => {
    const f = createForeman({ round: 60, theme: "rocket", now: 0, cover: coverOf(4, [], 0) });
    expect(f.build.slots).toHaveLength(12);
    f.finish(0);
    run(f, 0, 2000, coverOf(4, [], 9));
    expect(f.build.phase).toBe("alive");
    run(f, 2000, 2000 + ALIVE_MS + 100, coverOf(4, [], 9));
    expect(f.build.slots).toHaveLength(36);
  });
});

describe("a build always completes", () => {
  it("with nobody playing: slow helpers, then the rest in the last 5 s", () => {
    const round = 150;
    const f = createForeman({ round, theme: "treehouse", now: 0, cover: coverOf(4) });
    const n = f.build.slots.length;
    run(f, 0, round * 1000 - FINISH_MS - 100);
    const before = filledCount(f.build);
    // Helpers worked slowly but left most of it for the end.
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(n);
    run(f, round * 1000 - FINISH_MS, round * 1000);
    expect(isComplete(f.build)).toBe(true);
    expect(f.build.phase).toBe("alive");
    expect(f.build.early).toBe(false);
    expect(f.trophies).toBe(0);
    expect(f.build.slots.every((s) => s.maker === "helper")).toBe(true);
    expect(f.totals.helper).toBe(n);
  });

  it("with some parts from people, helpers fill only what is missing", () => {
    const f = createForeman({ round: 60, theme: "robot", now: 0, cover: coverOf(2, [0, 1]) });
    for (let i = 0; i < 5; i++) f.deliver(part(i % 4, i * 1000), i * 1000);
    run(f, 0, 60_000, coverOf(2, [0, 1]));
    expect(isComplete(f.build)).toBe(true);
    expect(f.build.slots.filter((s) => s.maker === "person")).toHaveLength(5);
    expect(f.totals.person).toBe(5);
  });

  it("finishing early earns a trophy and a fresh build after the celebration", () => {
    const f = createForeman({ round: 150, theme: "rotate", now: 0, cover: coverOf(1, [0]) });
    expect(f.build.theme).toBe("rocket");
    const n = f.build.slots.length;
    for (let i = 0; i < n; i++) f.deliver(part(f.orders[0] ?? 0, i * 100), i * 100);
    run(f, 0, n * 100 + 1000, coverOf(1, [0]));
    expect(f.build.phase).toBe("alive");
    expect(f.build.early).toBe(true);
    expect(f.trophies).toBe(1);
    const id = f.build.id;
    const t = n * 100 + 1000;
    run(f, t, t + ALIVE_MS + 100, coverOf(1, [0]));
    expect(f.build.id).toBe(id + 1);
    expect(f.build.theme).toBe("treehouse");
    expect(f.build.phase).toBe("building");
    f.clearTrophies();
    expect(f.trophies).toBe(0);
  });

  it("parts that arrive while a build is alive go into the next one", () => {
    const f = createForeman({ round: 60, theme: "rocket", now: 0, cover: coverOf(1) });
    expect(f.build.theme).toBe("rocket");
    f.finish(0);
    run(f, 0, 2000, coverOf(1));
    expect(f.build.phase).toBe("alive");
    expect(f.deliver(part(1, 2000, { color: 4 }), 2000)).toBe(-1);
    expect(f.deliver(part(0, 2100, { maker: "bot" }), 2100)).toBe(-1);
    expect(f.carried).toBe(2);
    run(f, 2000, 2000 + ALIVE_MS + 1000, coverOf(1));
    expect(f.carried).toBe(0);
    expect(f.build.slots.filter((s) => s.maker === "person" && s.color === 4)).toHaveLength(1);
    expect(f.build.slots.filter((s) => s.maker === "bot")).toHaveLength(1);
  });

  it("admin next finishes the build within a couple of seconds", () => {
    const f = createForeman({ round: 300, theme: "lighthouse", now: 0, cover: coverOf(3) });
    run(f, 0, 5000, coverOf(3));
    f.finish(5000);
    run(f, 5000, 5000 + 1500 + HELPER_FLY_MS, coverOf(3));
    expect(f.build.phase).toBe("alive");
    expect(f.build.early).toBe(false);
  });

  it("a person's part in the last stretch takes over from a helper", () => {
    const f = createForeman({ round: 60, theme: "sandcastle", now: 0, cover: coverOf(2) });
    run(f, 0, 60_000 - FINISH_MS + 100, coverOf(2));
    expect(needOf(f.build).every((k) => k === 0)).toBe(true);
    const t = 60_000 - FINISH_MS + 200;
    const i = f.deliver(part(0, t), t);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(f.build.slots[i]!.maker).toBe("person");
    run(f, t, 60_000, coverOf(2));
    expect(isComplete(f.build)).toBe(true);
  });

  it("helpers leave worked columns' kinds to the people making them", () => {
    const f = createForeman({
      round: 60,
      theme: "rocket",
      now: 0,
      cover: coverOf(4, [0, 1, 2, 3]),
    });
    // Every column worked: no slow helpers at all before the last stretch.
    run(f, 0, 60_000 - FINISH_MS - 100, coverOf(4, [0, 1, 2, 3]));
    expect(filledCount(f.build)).toBe(0);
  });
});

describe("orders", () => {
  it("spread the kinds over the columns in proportion to need", () => {
    const o = assignOrders([], 10, [24, 4, 4, 4]);
    expect(o).toHaveLength(10);
    for (let k = 0; k < 4; k++)
      expect(o.filter((x) => x === k).length, `kind ${k}`).toBeGreaterThan(0);
    expect(o.filter((x) => x === 0).length).toBeGreaterThanOrEqual(5);
    // Neighbours mostly differ.
    let same = 0;
    for (let i = 1; i < o.length; i++) if (o[i] === o[i - 1]) same++;
    expect(same).toBeLessThanOrEqual(4);
  });

  it("change only when a kind is full", () => {
    const o = assignOrders([], 6, [10, 3, 3, 3]);
    const next = assignOrders(o, 6, [8, 0, 2, 3]);
    for (let c = 0; c < 6; c++) {
      if (o[c] === 1) expect(next[c]).not.toBe(1);
      else expect(next[c]).toBe(o[c]);
    }
  });

  it("cover every column even with one kind left", () => {
    expect(assignOrders([], 4, [0, 0, 2, 0])).toEqual([2, 2, 2, 2]);
    expect(assignOrders([], 0, [1, 1])).toEqual([]);
  });

  it("follow the foreman's build as kinds fill", () => {
    const f = createForeman({
      round: 150,
      theme: "lighthouse",
      now: 0,
      cover: coverOf(5, [0, 1, 2, 3, 4]),
    });
    const cover = coverOf(5, [0, 1, 2, 3, 4]);
    let t = 0;
    for (let i = 0; i < 40 && f.build.phase !== "alive"; i++) {
      const c = i % 5;
      const kind = f.orders[c]!;
      expect(kind).toBeGreaterThanOrEqual(0);
      f.deliver(part(kind, t, { column: c }), t);
      t += 200;
      f.update(t, cover);
      const need = needOf(f.build);
      // No column is left making a kind that is full while others are open.
      if (need.some((k) => k > 0))
        for (const k of f.orders) expect(need[k], `t ${t}`).toBeGreaterThan(0);
    }
  });

  it("a part of a full kind fills the neediest kind instead", () => {
    const b = newBuild(1, "rocket", 12, 0, 60_000);
    for (const s of b.slots) if (s.kind === 2) s.state = "filled";
    const i = pickSlot(b, 2);
    expect(b.slots[i]!.kind).not.toBe(2);
    expect(b.slots[i]!.kind).toBe(0);
  });
});
