import { describe, expect, it } from "vitest";
import { glazeThickness } from "../../../src/apps/cake/glaze";
import { CRUMB, lookOf, MILK_CHOCOLATE, type Rgb } from "../../../src/apps/cake/looks";
import {
  type PieceKind,
  type PieceSet,
  piecesGlsl,
  piecesOnBall,
  PUDDING_PIECES,
  RAY_START,
  reachLimit,
  reachOf,
  ROCKY_PIECES,
  SHAPE,
} from "../../../src/apps/cake/pieces";
import { sphereInfo } from "../../../src/core/sphere";

const luma = (c: readonly number[]) => 0.3 * c[0]! + 0.55 * c[1]! + 0.15 * c[2]!;
/** The default 4 m ball's radius in metres, for sizes on it; they scale with the ball. */
const RADIUS = sphereInfo().radius;

const kindsOf = (set: PieceSet): PieceKind[] => {
  const out: PieceKind[] = [];
  for (const l of set.layers) for (const [k] of l.kinds) if (!out.includes(k)) out.push(k);
  return out;
};
const names = (set: PieceSet) => new Set(kindsOf(set).map((k) => k.name));
/** Longest and shortest size of a kind on the ball, metres, in each layer it is in. */
const sizesOnBall = (set: PieceSet, k: PieceKind) =>
  set.layers
    .filter((l) => l.kinds.some(([x]) => x === k))
    .map((l) => {
      const longest = (2 * Math.max(...k.size) * RADIUS) / l.freq;
      return [longest * (1 - k.shrink), longest] as const;
    });
const isRed = (c: Rgb) => c[0] > 0.3 && c[0] > 10 * c[1];
const isGreen = (c: Rgb) => c[1] > c[0] && c[1] > 2 * c[2];
const isPink = (c: Rgb) => c[0] > 0.5 && c[2] > c[1] && c[0] > 1.8 * c[1];
const isWhite = (c: Rgb) => Math.min(...c) > 0.5;

describe("pieces in the cakes", () => {
  for (const [name, set] of [
    ["pudding", PUDDING_PIECES],
    ["rocky road", ROCKY_PIECES],
  ] as const) {
    it(`keeps every ${name} piece where the bake's eight nearest cells find it`, () => {
      for (const layer of set.layers) {
        const limit = reachLimit(layer);
        for (const [k, w] of layer.kinds) {
          expect(w).toBeGreaterThan(0);
          // The piece and the cake climbing round its foot.
          expect(reachOf(k) + set.fillet[1]).toBeLessThanOrEqual(limit);
          // The ray through a point starts below the deepest piece.
          expect(layer.depth[0] - reachOf(k)).toBeGreaterThan(-RAY_START);
          expect(k.shrink).toBeGreaterThanOrEqual(0);
          expect(k.shrink).toBeLessThan(1);
          expect(k.coat[0]).toBeLessThanOrEqual(k.coat[1]);
        }
        expect(layer.depth[0]).toBeLessThan(0);
        expect(layer.depth[1]).toBeGreaterThan(layer.depth[0]);
        expect(layer.density).toBeGreaterThan(0);
        expect(layer.density).toBeLessThanOrEqual(1);
      }
    });

    it(`gives every ${name} piece a colour no brighter than the icing, and a size that reads from the floor`, () => {
      const icing = lookOf("pudding", "icing").glaze;
      for (const k of kindsOf(set)) {
        expect(k.colours.length).toBeGreaterThan(0);
        for (const c of [...k.colours, k.second]) {
          for (const v of c) expect(v).toBeGreaterThanOrEqual(0);
          expect(luma(c)).toBeLessThanOrEqual(luma(icing) + 1e-9);
        }
        for (const [least, most] of sizesOnBall(set, k)) {
          expect(least, k.name).toBeGreaterThan(0.048);
          expect(most, k.name).toBeLessThan(0.68);
        }
      }
    });
  }

  it("packs the pudding with fruit and nuts of many colours and shapes", () => {
    expect(names(PUDDING_PIECES)).toEqual(
      new Set([
        "raisin",
        "sultana",
        "currant",
        "date",
        "glacé cherry",
        "candied peel",
        "almond sliver",
        "almond half",
      ]),
    );
    const kinds = kindsOf(PUDDING_PIECES);
    const colours = kinds.flatMap((k) => k.colours);
    expect(colours.some(isRed)).toBe(true);
    expect(colours.some(isGreen)).toBe(true);
    // Orange peel and yellow-green citron.
    const peel = kinds.find((k) => k.name === "candied peel")!;
    expect(peel.colours.some((c) => c[0] > 2.5 * c[1] && c[1] > 2 * c[2])).toBe(true);
    expect(peel.colours.some((c) => c[1] > 0.8 * c[0] && c[1] > 4 * c[2])).toBe(true);
    // Round, egg-shaped, halved, cubed and slivered pieces.
    expect(new Set(kinds.map((k) => k.shape))).toEqual(new Set([SHAPE.egg, SHAPE.half, SHAPE.box]));
    expect(PUDDING_PIECES.layers.map(piecesOnBall).reduce((a, b) => a + b)).toBeGreaterThan(2000);
    // Currants small, cherries large, as on a real pudding scaled to the ball.
    const currant = kinds.find((k) => k.name === "currant")!;
    const cherry = kinds.find((k) => k.name === "glacé cherry")!;
    const most = (k: PieceKind) => Math.max(...sizesOnBall(PUDDING_PIECES, k).map(([, m]) => m));
    expect(most(currant)).toBeLessThan(0.15);
    expect(most(cherry)).toBeGreaterThan(0.28);
  });

  it("gives the pudding a reddish mahogany crumb rather than grey-brown", () => {
    for (const c of [CRUMB.dark, CRUMB.light]) {
      expect(c[0] / c[1]).toBeGreaterThan(3.5);
      expect(c[1]).toBeGreaterThan(c[2]);
    }
  });

  it("packs the rocky road with marshmallows, peanuts, cherries, coconut and jelly", () => {
    expect(names(ROCKY_PIECES)).toEqual(
      new Set([
        "marshmallow",
        "round marshmallow",
        "mini marshmallow",
        "peanut",
        "peanut half",
        "glacé cherry",
        "coconut flake",
        "jelly cube",
      ]),
    );
    const kinds = kindsOf(ROCKY_PIECES);
    const marsh = kinds.filter((k) => k.name.includes("marshmallow"));
    for (const k of marsh) {
      expect(k.colours.some(isPink)).toBe(true);
      expect(k.colours.some(isWhite)).toBe(true);
      // Soft and matte.
      expect(k.gloss).toBeLessThan(0.3);
    }
    const peanut = kinds.find((k) => k.name === "peanut")!;
    // Tan, with a papery red-brown skin on some.
    expect(peanut.colours.every((c) => c[0] > c[1] && c[1] > c[2])).toBe(true);
    expect(luma(peanut.second)).toBeLessThan(0.5 * Math.min(...peanut.colours.map(luma)));
    expect(kinds.find((k) => k.name === "peanut half")!.shape).toBe(SHAPE.half);
    // Peanuts about half a marshmallow's length.
    const longest = (name: string) =>
      Math.max(
        ...sizesOnBall(
          ROCKY_PIECES,
          kinds.find((k) => k.name === name)!,
        ).map(([, m]) => m),
      );
    expect(longest("peanut")).toBeLessThan(0.4);
    expect(longest("marshmallow")).toBeGreaterThan(0.52);
    expect(kinds.find((k) => k.name === "glacé cherry")!.colours.every(isRed)).toBe(true);
    // Big pieces first: the largest layer is all marshmallows, and pieces stand proud.
    expect(ROCKY_PIECES.layers[0]!.kinds.every(([k]) => k.name.includes("marshmallow"))).toBe(true);
    expect(ROCKY_PIECES.relief).toBeGreaterThan(PUDDING_PIECES.relief);
    expect(ROCKY_PIECES.layers.map(piecesOnBall).reduce((a, b) => a + b)).toBeGreaterThan(900);
  });

  it("pours dark chocolate over the rocky road, darker than the set chocolate under it", () => {
    const rocky = lookOf("rocky", "icing");
    expect(rocky.kind).toBe("chocolate");
    expect(rocky.holly).toBe(false);
    expect(luma(rocky.glaze)).toBeLessThan(luma(MILK_CHOCOLATE.dark));
    expect(glazeThickness(rocky.kind)).toBeGreaterThan(0.5);
    // Pieces push through it where it is thin; the other cakes' glazes lie over a smooth skin.
    expect(rocky.poke).toBeGreaterThan(0);
    expect(lookOf("chocolate", "icing").poke).toBe(0);
    expect(lookOf("pudding", "icing").poke).toBe(0);
  });

  it("writes GLSL with each kind and layer once, and nothing undefined", () => {
    for (const set of [PUDDING_PIECES, ROCKY_PIECES]) {
      const glsl = piecesGlsl(set);
      expect(glsl).not.toMatch(/undefined|NaN/);
      expect(glsl.match(/if \(kind == \d+\)/g)?.length).toBe(kindsOf(set).length);
      expect(glsl).toContain(`const int LAYERS = ${set.layers.length};`);
      expect(glsl).toContain("void pieces(vec3 d, inout Hit best)");
    }
  });
});
