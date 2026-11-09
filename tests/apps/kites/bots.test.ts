import { describe, expect, it } from "vitest";
import { venueFrame } from "./helpers";
import { botKites, createBots } from "../../../src/apps/kites/bots";
import { readConfig } from "../../../src/apps/kites/config";
import { WIND_SPEED } from "../../../src/apps/kites/kite";
import { type GripId, gripAt, type Layout, layoutFor } from "../../../src/apps/kites/layout";
import {
  createPatch,
  drag,
  grab,
  type Patch,
  release,
  stepPatch,
} from "../../../src/apps/kites/patch";
import { bankSky, localSky } from "../../../src/apps/kites/sky";
import { createWindField, WIND_PRESETS, windAt } from "../../../src/apps/kites/wind";
import type { Input } from "../../../src/core/types";

const patchesFor = (variant: "duo" | "single", flyers = 6) => {
  const l = layoutFor({
    kind: "wall",
    ...venueFrame("wall"),
    seams: [],
    variant,
    flyers,
  });
  const sky = localSky(l, null);
  return l.patches.map((s, i) => createPatch(s, s.index, sky, 1, i));
};

describe("bots", () => {
  it("take kites in patch order, spool before stunt", () => {
    expect(botKites(patchesFor("duo"), 3)).toEqual([
      { patch: 0, kind: "spool" },
      { patch: 0, kind: "stunt" },
      { patch: 1, kind: "spool" },
    ]);
    expect(botKites(patchesFor("single"), 3).map((b) => b.kind)).toEqual([
      "spool",
      "spool",
      "spool",
    ]);
    expect(botKites(patchesFor("duo", 4), 99)).toHaveLength(8);
    expect(botKites(patchesFor("duo"), 0)).toEqual([]);
  });
});

/** Injected touches reach the patches the way the app's pointer listeners pass them on. */
const fakeInput = (layout: Layout, patches: Patch[], now: () => number): Input => {
  let next = 1;
  const holds = new Map<number, { patch: number; grip: GripId }>();
  return {
    on: () => () => {},
    pointers: new Map(),
    inject: {
      down(x, y) {
        const id = next++;
        const hit = gripAt(layout, x, y);
        if (hit) {
          holds.set(id, hit);
          grab(patches[hit.patch]!, hit.grip, id, y, false, now());
        }
        return id;
      },
      move(id, _x, y) {
        const h = holds.get(id);
        if (h) drag(patches[h.patch]!, h.grip, id, y, now());
      },
      up(id) {
        const h = holds.get(id);
        holds.delete(id);
        if (h) release(patches[h.patch]!, h.grip, id);
      },
    },
  };
};

describe("bots on a bank panel", () => {
  it("hold the spool to climb and let go to sink, and move the handles smoothly", () => {
    const layout = layoutFor({
      kind: "panel",
      width: 1080,
      height: 1920,
      reachTop: venueFrame("panel").reachTop,
      seams: [],
      variant: "duo",
      flyers: 6,
    });
    const sky = bankSky(layout, { pos: 2, count: 3 });
    const patches = layout.patches.map((spec) => createPatch(spec, spec.index, sky, 1, 2));
    const p = patches[0]!;
    const field = createWindField(4, WIND_PRESETS.breezy);
    const DT = 1 / 120;
    let ms = 0;
    let t = 1_760_000_000;
    const wind = (x: number, y: number) => windAt(field, t, sky.fOf(x), y) * WIND_SPEED;
    const bots = createBots({
      input: fakeInput(layout, patches, () => ms),
      patches: () => patches,
      kites: botKites(patches, 2),
      unit: () => 1,
    });
    const spells: number[] = [];
    let pressedAt = -1;
    let climbs = 0;
    let yAtPress = 0;
    const handle: number[] = [];
    for (let i = 0; i < 60 / DT; i++) {
      bots.update(ms, t, sky);
      stepPatch(p, DT, t, ms, wind, sky);
      const held = p.button.pointer !== null;
      if (held && pressedAt < 0) {
        pressedAt = ms;
        yAtPress = p.spool.y;
      } else if (!held && pressedAt >= 0) {
        spells.push((ms - pressedAt) / 1000);
        if (p.spool.y > yAtPress + 0.15) climbs++;
        pressedAt = -1;
      }
      if (i % 2 === 0) handle.push(p.handles.left);
      ms += DT * 1000;
      t += DT;
    }
    expect(p.modes.spool).toBe("people");
    expect(p.modes.stunt).toBe("people");
    expect(p.counts.flown).toBe(0);
    expect(spells.length).toBeGreaterThanOrEqual(4);
    for (const s of spells) expect(s).toBeGreaterThan(0.75);
    expect(climbs).toBeGreaterThanOrEqual(spells.length - 1);
    // Turn-backs of the left handle by more than 3 % of its travel: well under the old 4 to 8 a
    // second.
    let turns = 0;
    let dir = 0;
    let hi = handle[0]!;
    let lo = hi;
    for (const h of handle) {
      if (dir === 0) {
        hi = Math.max(hi, h);
        lo = Math.min(lo, h);
        if (h < hi - 0.03) [dir, lo] = [-1, h];
        else if (h > lo + 0.03) [dir, hi] = [1, h];
      } else if (dir > 0) {
        if (h > hi) hi = h;
        else if (h < hi - 0.03) [turns, dir, lo] = [turns + 1, -1, h];
      } else if (h < lo) lo = h;
      else if (h > lo + 0.03) [turns, dir, hi] = [turns + 1, 1, h];
    }
    expect(turns / 60).toBeLessThan(1.5);
    bots.dispose();
    expect(p.button.pointer).toBeNull();
  });
});

describe("a person holding still", () => {
  it("keeps the spool for as long as they hold it, with bots about", () => {
    const layout = layoutFor({
      kind: "panel",
      width: 1080,
      height: 1920,
      reachTop: venueFrame("panel").reachTop,
      seams: [],
      variant: "duo",
      flyers: 6,
    });
    const sky = localSky(layout, null);
    const patches = layout.patches.map((spec) => createPatch(spec, spec.index, sky, 1, 2));
    const p = patches[0]!;
    const DT = 1 / 120;
    let ms = 0;
    const bots = createBots({
      input: fakeInput(layout, patches, () => ms),
      patches: () => patches,
      kites: botKites(patches, 2),
      unit: () => 1,
    });
    grab(p, "spool", 999, p.button.spec.y, true, 0);
    for (let i = 0; i < 40 / DT; i++) {
      bots.update(ms, ms / 1000, sky);
      stepPatch(p, DT, ms / 1000, ms, () => 0.6, sky);
      expect(p.button.pointer).toBe(999);
      ms += DT * 1000;
    }
    expect(p.modes.spool).toBe("people");
    expect(p.button.reeling).toBe(true);
    expect(ms - p.human.spool).toBeLessThan(100);
    bots.dispose();
  });
});

describe("options", () => {
  it("read with safe defaults", () => {
    expect(readConfig("x", {})).toEqual({
      variant: "duo",
      wind: "breezy",
      lat: -27.47,
      lon: 153.03,
      rings: true,
      tangles: true,
      flyers: 6,
    });
    const c = readConfig("single", {
      wind: "live",
      lat: 120,
      lon: -500,
      rings: false,
      flyers: 7.6,
    });
    expect(c.variant).toBe("single");
    expect(c.wind).toBe("live");
    expect(c.lat).toBe(90);
    expect(c.lon).toBe(-180);
    expect(c.rings).toBe(false);
    expect(c.flyers).toBe(8);
    expect(readConfig("duo", { wind: "hurricane" }).wind).toBe("breezy");
  });
});
