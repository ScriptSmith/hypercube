import { describe, expect, it } from "vitest";
import { GIFT_S, GIFTS, POINTS, TABLE_H } from "../../../src/apps/pinball/config";
import { decodeGift, encodeGift, TOPIC } from "../../../src/apps/pinball/wire";
import { createDownlink, createUplink } from "../../../src/apps/pinball/link";
import { createBus, emptyTable, rig } from "./helpers";

/** A table playing a person's game, with a gift due `ms` from now. */
const gifted = (kind: (typeof GIFTS)[number], o: Parameters<typeof rig>[0] = {}, ms = 300) => {
  const r = rig(o);
  r.table.start("human");
  r.step(0.2);
  expect(r.table.gift(kind, r.now + ms, r.now)).toBe(true);
  return r;
};

/** Hit the first pop bumper squarely and return the points it gave. */
const bumperPoints = (r: ReturnType<typeof rig>) => {
  const bumper = r.table.layout.shapes.find((s) => s.tag === "bumper" && s.kind === "circle");
  if (!bumper || bumper.kind !== "circle") throw new Error("no bumper");
  r.table.world.balls.length = 0;
  r.table.world.gravity = 0;
  const before = r.table.score;
  r.table.place(bumper.x, bumper.y + bumper.r + 60, 0, -900);
  r.step(0.05);
  r.table.world.balls.length = 0;
  return r.table.score - before;
};

describe("pinball gifts on a table", () => {
  it("comes down the return tube at its time, then takes effect", () => {
    const r = gifted("double", {}, 400);
    r.step(0.2);
    expect(r.table.tubes.some((t) => t.gift === "double")).toBe(false);
    r.step(0.3);
    expect(r.table.tubes.some((t) => t.gift === "double")).toBe(true);
    // A gift in the tube is not a ball in play.
    expect(r.table.inPlay()).toBe(1);
    r.step(0.6);
    expect(r.table.gifts.map((g) => g.kind)).toEqual(["double"]);
  });

  it("shield: saves a drained ball for its time", () => {
    const r = gifted("shield");
    r.step(1.5);
    expect(r.table.saveLeft()).toBeGreaterThan(GIFT_S.shield - 1.5);
    const b = r.table.world.balls[0]!;
    b.x = 500;
    b.y = TABLE_H - 10;
    b.vy = 600;
    r.step(0.5);
    expect(r.table.left).toBe(r.cfg.balls);
  });

  it("posts: closes the outlanes for its time, then opens them again", () => {
    const r = gifted("posts");
    expect(r.table.layout.posts.every((p) => !p.on)).toBe(true);
    r.step(1.5);
    expect(r.table.layout.posts.every((p) => p.on)).toBe(true);
    r.step(GIFT_S.posts);
    expect(r.table.layout.posts.every((p) => !p.on)).toBe(true);
    expect(r.table.gifts).toHaveLength(0);
  });

  it("double: doubles the table's scoring for its time", () => {
    const r = gifted("double");
    r.step(1.5);
    expect(bumperPoints(r)).toBe(POINTS.bumper * 2);
    r.step(GIFT_S.double);
    expect(bumperPoints(r)).toBe(POINTS.bumper);
  });

  it("extra: sends one more ball into play if there is room", () => {
    const r = emptyTable();
    r.table.place(500, 900, 0, 0);
    r.table.world.gravity = 0;
    expect(r.table.gift("extra", r.now + 200, r.now)).toBe(true);
    expect(r.table.inPlay()).toBe(2);
    r.step(1.2);
    expect(r.table.world.balls).toHaveLength(2);
    expect(r.table.world.balls.some((b) => b.bonus)).toBe(true);
  });

  it("extends a gift it already has, and holds only a few on their way", () => {
    const r = gifted("double");
    r.step(5);
    const until = r.table.gifts[0]!.until;
    r.table.gift("double", r.now, r.now);
    r.step(1);
    expect(r.table.gifts).toHaveLength(1);
    expect(r.table.gifts[0]!.until).toBeGreaterThan(until + 4);
    const ok = Array.from({ length: 8 }, () => r.table.gift("posts", r.now + 5000, r.now));
    expect(ok.filter(Boolean).length).toBeLessThanOrEqual(4);
  });

  it("takes no gifts while nobody is playing, and a new game starts without any", () => {
    const r = rig();
    expect(r.table.ctrl).toBe("attract");
    expect(r.table.gift("shield", r.now, r.now)).toBe(false);
    const g = gifted("posts");
    g.step(1.5);
    expect(g.table.gifts).toHaveLength(1);
    g.table.start("human");
    expect(g.table.gifts).toHaveLength(0);
    expect(g.table.layout.posts.every((p) => !p.on)).toBe(true);
  });
});

describe("pinball gift messages", () => {
  it("round-trip, and drop anything out of range", () => {
    expect(decodeGift(structuredClone(encodeGift({ h: 1, k: 3, t: 12.6 })))).toEqual({
      h: 1,
      k: 3,
      t: 13,
    });
    for (const bad of [
      { h: 1, k: GIFTS.length, t: 1 },
      { h: -1, k: 0, t: 1 },
      { h: 0, k: 1.5, t: 1 },
      { h: 0, k: 0, t: "soon" },
      null,
      [1, 2, 3],
    ]) {
      expect(decodeGift(bad)).toBeNull();
    }
  });

  it("are taken only from the screen", () => {
    let t = 10_000;
    const bus = createBus();
    const screenCh = bus.join({ frame: "s", kind: "screen", role: "screen" });
    const tableCh = bus.join({ frame: "p0", kind: "panel", role: "station", pos: 0 });
    const got: number[] = [];
    const down = createDownlink(
      screenCh,
      { now: () => t, clock: () => t },
      {
        up: () => {},
        score: () => {},
      },
    );
    createUplink(tableCh, () => t, {
      down: () => {},
      pts: () => {},
      gift: (m) => got.push(m.k),
    });
    down.tick();
    const other = bus.join({ frame: "x", role: "station", pos: 1 });
    other.send(TOPIC.gift, { h: 0, k: 1, t }, "p0");
    expect(got).toEqual([]);
    down.gift("p0", { h: 0, k: 2, t });
    expect(got).toEqual([2]);
    t += 1;
  });
});
