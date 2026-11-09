import { describe, expect, it } from "vitest";
import { E } from "../../../src/apps/tinyworld/elements";
import {
  createGadgets,
  type GadgetSizes,
  type GadgetZone,
} from "../../../src/apps/tinyworld/gadgets";

const BOUNDS = { x: 0, y: 0, width: 5760, height: 2160 };
const SIZES: GadgetSizes = {
  jetWidth: 84,
  jetTop: 216,
  fanReach: 900,
  fanHeight: 200,
  heatRadius: 190,
};
const make = () => createGadgets({ cap: 4, gap: 160, bounds: BOUNDS, spoutMs: 60_000 });

describe("tinyworld gadgets", () => {
  it("caps the world and recycles the oldest", () => {
    const g = make();
    for (let i = 0; i < 7; i++) g.place("heater", 600 + i * 600, 2000, E.WATER, i);
    expect(g.list).toHaveLength(4);
    expect(g.list[0]!.x).toBe(600 + 3 * 600);
  });

  it("replaces a gadget dropped on top of another, so they never crowd", () => {
    const g = make();
    g.place("fan", 2000, 2000, E.WATER, 0);
    const { removed } = g.place("cooler", 2050, 2000, E.WATER, 1);
    expect(removed.map((r) => r.kind)).toEqual(["fan"]);
    expect(g.list.map((r) => r.kind)).toEqual(["cooler"]);
  });

  it("lifts above a geyser up to the jet top, and blows a fan's way, which a tap turns round", () => {
    const g = make();
    g.place("geyser", 1500, 2000, E.WATER, 0);
    const fan = g.place("fan", 4000, 1900, E.WATER, 1).gadget;
    const zones: GadgetZone[] = [];
    expect(g.zones(SIZES, zones)).toBe(2);
    const lift = zones.find((z) => z.kind === "lift")!;
    expect(lift.box.y).toBeLessThanOrEqual(216);
    expect(lift.box.y + lift.box.height).toBeGreaterThan(2000);
    expect(lift.box.x).toBeLessThan(1500);
    expect(lift.box.x + lift.box.width).toBeGreaterThan(1500);
    // Placed on the right half, the fan blows towards the middle.
    expect(zones.find((z) => z.kind !== "lift")!.kind).toBe("left");
    g.flip(fan.id);
    g.zones(SIZES, zones);
    expect(zones.find((z) => z.kind !== "lift")!.kind).toBe("right");
  });

  it("stops a spout after its minute, and only pours flowing media", () => {
    const g = make();
    const s = g.place("spout", 3000, 1800, E.STONE, 0).gadget;
    expect(s.element).toBe(E.WATER);
    g.expire(59_000);
    expect(g.list).toHaveLength(1);
    g.expire(61_000);
    expect(g.list).toHaveLength(0);
  });

  it("finds a gadget under a finger and keeps placements inside the world", () => {
    const g = make();
    const h = g.place("heater", -500, 9999, E.WATER, 0).gadget;
    expect(h.x).toBeGreaterThanOrEqual(0);
    expect(h.y).toBeLessThanOrEqual(2160);
    expect(g.at(h.x + 30, h.y, 70)?.id).toBe(h.id);
    expect(g.at(h.x + 300, h.y, 70)).toBeNull();
    g.remove(h.id);
    expect(g.list).toHaveLength(0);
  });
});
