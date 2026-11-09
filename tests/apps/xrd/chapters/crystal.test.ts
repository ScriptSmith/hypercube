import { describe, expect, it } from "vitest";
import crystal, {
  decode,
  encode,
  START,
  STATE_RANGES,
} from "../../../../src/apps/xrd/chapters/crystal";
import {
  apply,
  between,
  blockOf,
  cubicD,
  dot,
  edgeOn,
  familyOf,
  type Hkl,
  isCubic,
  type Mat3,
  MAX_PLANES,
  TILES,
  tileOf,
  turnOf,
} from "../../../../src/apps/xrd/chapters/crystal/model";
import { TileRow } from "../../../../src/apps/xrd/chapters/crystal/tiles";
import { sliceOfBox } from "../../../../src/apps/xrd/chapters/crystal/icon";
import type { ChapterEnv } from "../../../../src/apps/xrd/chapter";
import { readConfig } from "../../../../src/apps/xrd/config";
import { CRYSTALS, dSpacing, type Vec3 } from "../../../../src/apps/xrd/crystals";
import { createLink } from "../../../../src/apps/xrd/formula";
import { type CardSpec, layoutFrame, withSplit } from "../../../../src/apps/xrd/layout";
import type { Rng } from "../../../../src/core/types";
import { VENUE_SIZE } from "../../../../src/core/frame";

const rng = (): Rng => {
  const r: Rng = {
    next: () => 0.5,
    int: (n) => Math.floor(n / 2),
    range: (lo, hi) => (lo + hi) / 2,
    pick: (items) => items[0]!,
    fork: () => r,
  };
  return r;
};

const envWith = (onEarn: () => void): ChapterEnv => ({
  id: "crystal",
  kind: "panel",
  config: readConfig({}),
  rng: rng(),
  engine: () => {
    throw new Error("no engine here");
  },
  layer3d: () => {
    throw new Error("no 3D here");
  },
  maps: { canvas: () => null, ready: () => false, draw: () => null, dispose() {} },
  link: createLink(),
  earn: onEarn,
  now: () => 0,
});

const card = (kind: "panel" | "pair" | "wall" | "kiosk", i = 0) => {
  const sizes = {
    panel: [1080, 1920],
    pair: [2160, 1920],
    wall: [VENUE_SIZE.wall.width, VENUE_SIZE.wall.height],
    kiosk: [1920, 1080],
  };
  const cards: Record<string, CardSpec[]> = {
    panel: [{ bottom: "tabs", tabs: 11 }],
    pair: [
      { bottom: "tabs", tabs: 6 },
      { bottom: "tabs", tabs: 5 },
    ],
    wall: Array.from({ length: 6 }, () => ({ bottom: "none" as const })),
    kiosk: [{ bottom: "tabs", tabs: 11 }],
  };
  const [width, height] = sizes[kind];
  const f = layoutFrame({
    kind,
    width: width!,
    height: height!,
    reachTop: { adult: kind === "wall" ? 1336 : 0, child: kind === "wall" ? 1822 : height! / 2 },
    cards: cards[kind]!,
    maths: true,
  });
  return withSplit(f.cards[i]!, crystal.split ?? 0.5);
};

const isRotation = (m: Mat3) => {
  const r: Vec3[] = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) expect(dot(r[i]!, r[j]!)).toBeCloseTo(i === j ? 1 : 0, 9);
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  expect(det).toBeCloseTo(1, 9);
};

/** Published spacings, Å: salt, foil and diamond from NBS Circular 539, the rest from cells. */
const PUBLISHED: Record<string, Record<string, number>> = {
  salt: { "2,0,0": 2.82, "2,2,0": 1.994, "2,2,2": 1.628 },
  foil: { "1,1,1": 2.338, "2,0,0": 2.025, "2,2,0": 1.432 },
  diamond: { "1,1,1": 2.059, "2,2,0": 1.261, "4,0,0": 0.892 },
  lead: { "0,0,2": 3.356, "1,0,0": 2.134, "1,1,0": 1.232 },
  ice: { "0,0,2": 3.673, "1,0,0": 3.902, "1,1,0": 2.253 },
  sand: { "1,0,1": 3.343, "1,0,0": 4.255, "0,0,3": 1.802 },
};

describe("chapter 3's crystals", () => {
  it("shows each crystal's families with their published gaps", () => {
    for (const t of TILES) {
      for (const hkl of t.families) {
        const f = familyOf(t, hkl);
        expect(f.d, `${t.id} ${hkl}`).toBeCloseTo(PUBLISHED[t.id]![hkl.join(",")]!, 2);
        expect(f.d).toBeCloseTo(dSpacing(CRYSTALS[t.crystal].cell, ...hkl), 12);
      }
    }
  });

  it("gives d = a / √(h² + k² + l²) for the cubic crystals", () => {
    expect(TILES.filter(isCubic).map((t) => t.id)).toEqual(["salt", "foil", "diamond"]);
    for (const t of TILES.filter(isCubic)) {
      const a = CRYSTALS[t.crystal].cell.a;
      for (const hkl of t.families) expect(familyOf(t, hkl).d).toBeCloseTo(cubicD(a, hkl), 12);
    }
    // Aluminium's (1 1 1) from the running example's a = 4.05 Å: 2.338 Å.
    expect(cubicD(4.05, [1, 1, 1])).toBeCloseTo(2.338, 3);
  });

  it("stacks the layers exactly d apart, each cut flat to the block", () => {
    for (const t of TILES) {
      for (const hkl of t.families) {
        const f = familyOf(t, hkl);
        expect(f.planes.length).toBeGreaterThanOrEqual(2);
        expect(f.planes.length).toBeLessThanOrEqual(MAX_PLANES);
        for (let i = 1; i < f.levels.length; i++)
          expect(f.levels[i]! - f.levels[i - 1]!).toBeCloseTo(f.d, 9);
        f.planes.forEach((poly, i) => {
          expect(poly.length).toBeGreaterThanOrEqual(3);
          for (const p of poly) expect(dot(p, f.normal)).toBeCloseTo(f.levels[i]!, 6);
        });
      }
    }
  });

  it("lays the layers through the atoms of the layered crystals", () => {
    const onLayers = (id: Parameters<typeof tileOf>[0], hkl: Hkl, tol: number) => {
      const t = tileOf(id);
      const f = familyOf(t, hkl);
      for (const a of blockOf(t).atoms) {
        // On one of the family's layers, drawn or not (a block's corner atom may lie on a layer
        // that only touches the block).
        const k = (dot(a.p, f.normal) - f.levels[0]!) / f.d;
        const off = Math.abs(k - Math.round(k)) * f.d;
        const h = dot(a.p, f.normal);
        expect(off, `${id} ${hkl} atom at ${h.toFixed(3)}`).toBeLessThan(tol);
      }
    };
    onLayers("salt", [2, 0, 0], 1e-6);
    onLayers("foil", [1, 1, 1], 1e-6);
    onLayers("diamond", [2, 2, 0], 1e-6);
    onLayers("lead", [0, 0, 2], 1e-6);
    onLayers("ice", [1, 1, 0], 1e-6);
  });

  it("looks along the layers edge on, and turns there by the shortest way", () => {
    for (const t of TILES) {
      for (const hkl of t.families) {
        const f = familyOf(t, hkl);
        expect(dot(f.along, f.normal)).toBeCloseTo(0, 9);
        const m = edgeOn(f);
        isRotation(m);
        const up = apply(m, f.normal);
        expect(up[1]).toBeCloseTo(1, 9);
        // Edge on, every layer is a level line: all its corners share one height on screen.
        for (const poly of f.planes) {
          const ys = poly.map((p) => apply(m, p)[1]);
          for (const y of ys) expect(y).toBeCloseTo(ys[0]!, 6);
        }
      }
    }
    const a = turnOf(30, 18);
    const b = edgeOn(familyOf(TILES[0]!, TILES[0]!.families[0]!));
    isRotation(a);
    expect(between(a, b, 0)).toEqual(a);
    expect(between(a, b, 1)).toEqual(b);
    isRotation(between(a, b, 0.4));
  });

  it("joins atoms as the crystals bond, and keeps the blocks small", () => {
    const most = (id: Parameters<typeof tileOf>[0]) => {
      const b = blockOf(tileOf(id));
      const n = new Map<number, number>();
      for (const [i, j] of b.bonds) {
        n.set(i, (n.get(i) ?? 0) + 1);
        n.set(j, (n.get(j) ?? 0) + 1);
      }
      return Math.max(...n.values());
    };
    expect(most("salt")).toBe(6);
    expect(most("diamond")).toBe(4);
    expect(most("lead")).toBe(3);
    expect(most("ice")).toBe(4);
    expect(most("sand")).toBe(4);
    expect(blockOf(tileOf("foil")).bonds.length).toBe(0);
    for (const t of TILES) {
      const b = blockOf(t);
      expect(b.atoms.length).toBeLessThan(800);
      expect(b.cell.length).toBe(12);
    }
  });

  it("shows its tiles at least a target wide on every kind, three at a time where six don't fit", () => {
    for (const [kind, i] of [
      ["panel", 0],
      ["pair", 0],
      ["pair", 1],
      ["wall", 0],
      ["kiosk", 0],
    ] as const) {
      const l = card(kind, i);
      const row = new TileRow(
        { id: "tiles", rect: l.child, band: "child", value: 0, target: l.target, size: 30 },
        TILES.map((t) => t.id),
        () => {},
      );
      // A pair's half is too narrow for six, and so is a column of the default wall.
      expect(row.paged).toBe(kind === "pair" || kind === "wall");
      for (const c of row.cells()) {
        expect(Math.min(c.rect.width, c.rect.height), `${kind} ${i}`).toBeGreaterThanOrEqual(
          l.target - 0.5,
        );
      }
    }
    const l = card("pair", 1);
    const picked: number[] = [];
    const row = new TileRow(
      { id: "tiles", rect: l.child, band: "child", value: 0, target: l.target, size: 30 },
      TILES.map((t) => t.id),
      (i) => picked.push(i),
    );
    const turn = row.cells().find((c) => c.tile < 0)!;
    const tap = (x: number, y: number) => {
      row.begin({ id: 1, x, y, synthetic: false, time: 0 });
      row.end({ id: 1, x, y, synthetic: false, time: 50 });
    };
    tap(turn.rect.x + 10, turn.rect.y + 10);
    expect(row.page).toBe(1);
    const ice = row.cells().find((c) => c.tile === 4)!;
    tap(ice.rect.x + 10, ice.rect.y + 10);
    expect(picked).toEqual([4]);
  });

  it("shows its So line once a family of planes is shown", () => {
    let earned = 0;
    const ch = crystal.create(envWith(() => earned++));
    ch.layout(card("panel"));
    ch.update(1 / 60, 0);
    expect(earned).toBe(0);
    const layers = ch.controls.find((c) => c.id === "layers")!;
    const g = layers.gesture(0)!;
    layers.begin({ id: 2, x: g.path[0]!.x, y: g.path[0]!.y, synthetic: false, time: 0 });
    ch.update(1 / 60, 16);
    expect(earned).toBeGreaterThan(0);
    expect(decode(ch.state()).family).toBe(1);
    // A tap on the 3D crystal shows the next family; a drag turns it instead.
    const turn = ch.controls.find((c) => c.id === "turn")!;
    const mid = { x: turn.rect.x + turn.rect.width / 2, y: turn.rect.y + turn.rect.height / 2 };
    turn.begin({ id: 3, ...mid, synthetic: false, time: 100 });
    turn.end({ id: 3, ...mid, synthetic: false, time: 200 }, false);
    expect(decode(ch.state()).family).toBe(2);
    const yaw = decode(ch.state()).yaw;
    turn.begin({ id: 4, ...mid, synthetic: false, time: 300 });
    turn.move({ id: 4, x: mid.x + 100, y: mid.y, synthetic: false, time: 320 });
    turn.end({ id: 4, x: mid.x + 100, y: mid.y, synthetic: false, time: 340 }, false);
    expect(decode(ch.state()).family).toBe(2);
    expect(decode(ch.state()).yaw).not.toBe(yaw);
    ch.reset();
    expect(ch.state()).toEqual(encode(START));
  });

  it("shows a picked crystal's first family once its zoom ends, so a child's tap earns the So line", () => {
    let earned = 0;
    const away: boolean[] = [];
    const ch = crystal.create({ ...envWith(() => earned++), away: (a) => away.push(a) });
    ch.layout(card("panel"));
    const tiles = ch.controls.find((c) => c.id === "tiles")!;
    const g = tiles.gesture(3)!;
    tiles.begin({ id: 6, x: g.path[0]!.x, y: g.path[0]!.y, synthetic: false, time: 0 });
    // Through the zoom: no layers yet, and the So line about layers would be dimmed.
    for (let i = 0; i < 200; i++) ch.update(1 / 60, i * 16);
    expect(decode(ch.state()).family).toBe(0);
    expect(earned).toBe(0);
    expect(away[away.length - 1]).toBe(true);
    for (let i = 0; i < 120; i++) ch.update(1 / 60, 3200 + i * 16);
    expect(decode(ch.state()).family).toBe(1);
    expect(earned).toBeGreaterThan(0);
    expect(away[away.length - 1]).toBe(false);
    // The one Layers button steps through every family, then back to none.
    const layers = ch.controls.find((c) => c.id === "layers")!;
    const n = TILES[3]!.families.length;
    for (let k = 0; k < n; k++) {
      const p = layers.gesture()!.path[0]!;
      layers.begin({ id: 10 + k, ...p, synthetic: false, time: 5000 + k });
      layers.end({ id: 10 + k, ...p, synthetic: false, time: 5000 + k }, false);
    }
    expect(decode(ch.state()).family).toBe(0);
    ch.update(1 / 60, 6000);
    expect(away[away.length - 1]).toBe(true);
  });

  it("cuts a box into the slices its Layers pictogram draws", () => {
    // Flat layers cut a square, layers across a corner a hexagon through the middle.
    expect(sliceOfBox([0, 1, 0], 0)).toHaveLength(4);
    const r3 = 1 / Math.sqrt(3);
    expect(sliceOfBox([r3, r3, r3], 0)).toHaveLength(6);
    expect(sliceOfBox([r3, r3, r3], 0.55 * Math.sqrt(3))).toHaveLength(3);
    const r2 = 1 / Math.sqrt(2);
    expect(sliceOfBox([r2, r2, 0], 0)).toHaveLength(4);
    // Every corner of a slice lies on its plane and inside the box.
    for (const p of sliceOfBox([r3, r3, r3], 0.4)) {
      expect(dot([r3, r3, r3], p)).toBeCloseTo(0.4, 9);
      for (const x of p) expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(sliceOfBox([0, 1, 0], 2)).toEqual([]);
  });

  it("zooms from the grain when a crystal is picked, and drives the machine's sample", () => {
    const ch = crystal.create(envWith(() => {}));
    ch.layout(card("panel"));
    const tiles = ch.controls.find((c) => c.id === "tiles")!;
    const g = tiles.gesture(2)!;
    tiles.begin({ id: 5, x: g.path[0]!.x, y: g.path[0]!.y, synthetic: false, time: 0 });
    const s = decode(ch.state());
    expect(s.tile).toBe(2);
    expect(s.zoom).toBe(0);
    for (let i = 0; i < 300; i++) ch.update(1 / 60, i * 16);
    expect(decode(ch.state()).zoom).toBe(1);
    expect(crystal.drive!(ch.state()).sample).toEqual({ crystal: "diamond", form: "single" });
  });

  it("packs its state for the screen within its ranges", () => {
    const states = [START, { tile: 5, family: 3, yaw: 250, pitch: 80, zoom: 0.5, edge: 1 }];
    for (const s of states) {
      const v = encode(s);
      v.forEach((x, i) => {
        expect(x).toBeGreaterThanOrEqual(STATE_RANGES[i]![0]);
        expect(x).toBeLessThanOrEqual(STATE_RANGES[i]![1]);
      });
    }
    expect(decode(encode(states[1]!))).toEqual({
      tile: 5,
      family: 3,
      yaw: -110,
      pitch: 80,
      zoom: 0.5,
      edge: 1,
    });
    for (let t = 0; t < 60; t += 0.7) {
      const v = crystal.play!(t);
      v.forEach((x, i) => {
        expect(x).toBeGreaterThanOrEqual(STATE_RANGES[i]![0]);
        expect(x).toBeLessThanOrEqual(STATE_RANGES[i]![1]);
      });
    }
  });
});
