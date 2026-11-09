import { describe, expect, it } from "vitest";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import {
  boxToPad,
  createControls,
  padBox,
  padToBox,
  type Who,
} from "../../../src/apps/skyline/controls";
import { layoutFor } from "../../../src/apps/skyline/layout";

/** The default wall, with the tops of adult and child reach on it. */
const WALL = {
  width: VENUE_SIZE.wall.width,
  height: VENUE_SIZE.wall.height,
  reachTop: {
    adult: VENUE_SIZE.wall.height * (1 - DEFAULT_REACH.wall.adult),
    child: VENUE_SIZE.wall.height * (1 - DEFAULT_REACH.wall.child),
  },
};

const wall = layoutFor({
  kind: "wall",
  ...WALL,
  seams: [],
  cranes: 3,
  variant: "build",
});

const recorder = () => {
  const log: string[] = [];
  const aims: { crane: number; x: number; y: number; who: Who }[] = [];
  return {
    log,
    aims,
    ev: {
      aim: (crane: number, x: number, y: number, who: Who) => {
        aims.push({ crane, x, y, who });
        log.push(`aim ${crane}`);
      },
      lift: (crane: number, who: Who) => log.push(`lift ${crane} ${who}`),
      release: (crane: number, who: Who) => log.push(`release ${crane} ${who}`),
      send: (crane: number, kind: number, who: Who) => log.push(`send ${crane} ${kind} ${who}`),
    },
  };
};

describe("skyline controls", () => {
  it("maps the pad's corners to the box, y up, and clamps outside", () => {
    const pad = wall.cranes[1]!.pad;
    const b = padBox(pad);
    expect(padToBox(pad, b.x, b.y)).toEqual({ x: 0, y: 1 });
    expect(padToBox(pad, b.x + b.width, b.y + b.height)).toEqual({ x: 1, y: 0 });
    expect(padToBox(pad, pad.x - 30, pad.y + pad.height + 30)).toEqual({ x: 0, y: 0 });
    const p = boxToPad(pad, 0.25, 0.75);
    const back = padToBox(pad, p.x, p.y);
    expect(back.x).toBeCloseTo(0.25, 9);
    expect(back.y).toBeCloseTo(0.75, 9);
  });

  it("aims while a finger drags on a pad; the latest finger wins; lifting tells", () => {
    const r = recorder();
    const c = createControls(wall, r.ev);
    const pad = wall.cranes[2]!.pad;
    expect(c.down(1, pad.x + 100, pad.y + 100, "person", 0)).toBe(true);
    expect(c.holder(2)).toBe(1);
    c.move(1, pad.x + 200, pad.y + 150);
    expect(r.aims.at(-1)!.crane).toBe(2);
    expect(r.aims.at(-1)!.x).toBeGreaterThan(r.aims[0]!.x);
    expect(r.aims.at(-1)!.y).toBeLessThan(r.aims[0]!.y);
    // A second finger takes the pad; the first one's moves no longer count.
    c.down(2, pad.x + pad.width - 50, pad.y + 50, "bot", 10);
    expect(c.holder(2)).toBe(2);
    const n = r.aims.length;
    c.move(1, pad.x + 10, pad.y + 10);
    expect(r.aims.length).toBe(n);
    c.up(2);
    expect(r.log.at(-1)).toBe("lift 2 bot");
    expect(c.holder(2)).toBeNull();
  });

  it("presses release and block buttons, with a little slop, and nothing between them", () => {
    const r = recorder();
    const c = createControls(wall, r.ev);
    const crane = wall.cranes[0]!;
    c.down(5, crane.release.x + crane.release.r + 10, crane.release.y, "person", 100);
    expect(r.log.at(-1)).toBe("release 0 person");
    expect(c.releasedAt.get(0)).toBe(100);
    const b = crane.buttons[2]!;
    c.down(6, b.rect.x - 5, b.rect.y + 20, "person", 200);
    expect(r.log.at(-1)).toBe(`send 0 ${b.kind} person`);
    expect(c.pressed.get(`0:${b.kind}`)).toBe(200);
    // The sky is not a control.
    expect(c.down(7, 100, 100, "person", 300)).toBe(false);
  });
});
