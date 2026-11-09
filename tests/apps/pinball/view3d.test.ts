import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { BALL_R, TABLE_H, TABLE_W, THEMES } from "../../../src/apps/pinball/config";
import { buildTable } from "../../../src/apps/pinball/layout";
import { THEME_LOOKS } from "../../../src/apps/pinball/themes/looks";
import { fitStraight, seenAt } from "../../../src/apps/pinball/view3d/camera";
import { PLAIN_COLORS, plainDeck } from "../../../src/apps/pinball/view3d/deckparts3d";
import { TABLE_DISTANCE, TUBE_Z, tubeHeight } from "../../../src/apps/pinball/view3d/tableview3d";

/** Field (x, y, z) to normalised device coordinates through `cam`. */
const ndc = (cam: PerspectiveCamera, x: number, y: number, z = 0, offset = 0) => {
  const v = new Vector3(x + offset, -y, z).project(cam);
  return { x: v.x, y: v.y };
};

describe("pinball 3D views", () => {
  it("maps the playfield's plane one to one onto the table's viewport", () => {
    const cam = new PerspectiveCamera();
    fitStraight(
      cam,
      TABLE_W / 2,
      TABLE_H / 2,
      TABLE_DISTANCE,
      {
        x0: 0,
        y0: 0,
        x1: TABLE_W,
        y1: TABLE_H,
      },
      { offset: 16000, near: 40, far: TABLE_DISTANCE + 900 },
    );
    for (const [x, y] of [
      [0, 0],
      [TABLE_W, TABLE_H],
      [322, 0],
      [555, 0],
      [800, 1500],
    ] as const) {
      const p = ndc(cam, x, y, 0, 16000);
      expect(p.x).toBeCloseTo((x / TABLE_W) * 2 - 1, 6);
      expect(p.y).toBeCloseTo(1 - (y / TABLE_H) * 2, 6);
    }
    // Something raised slides out from the middle, as seenAt says.
    const raised = ndc(cam, 900, 300, 80, 16000);
    const s = seenAt(900, 300, 80, TABLE_W / 2, TABLE_H / 2, TABLE_DISTANCE);
    expect(raised.x).toBeCloseTo((s.x / TABLE_W) * 2 - 1, 6);
    expect(raised.y).toBeCloseTo(1 - (s.y / TABLE_H) * 2, 6);
    expect(s.x).toBeGreaterThan(900);
    expect(s.y).toBeLessThan(300);
  });

  it("keeps the table's plane in place inside a wider cell, with the camera on the table", () => {
    const cam = new PerspectiveCamera();
    const view = { x0: -400, y0: 0, x1: TABLE_W + 400, y1: TABLE_H };
    fitStraight(cam, TABLE_W / 2, TABLE_H / 2, TABLE_DISTANCE, view);
    const w = view.x1 - view.x0;
    for (const x of [0, TABLE_W]) {
      expect(ndc(cam, x, 0).x).toBeCloseTo(((x - view.x0) / w) * 2 - 1, 6);
    }
    // Straight in front: the table's middle is the camera's.
    const c = new Vector3(TABLE_W / 2, -TABLE_H / 2, 500).project(cam);
    expect(c.x).toBeCloseTo(0, 6);
  });

  it("brings a ball in a tube down to the plane where it crosses the top edge", () => {
    for (const mirror of [false, true]) {
      const L = buildTable({ mirror });
      for (const pts of [L.exitTube, L.returnTube]) {
        const top = pts.find((p) => p.y < 0)!;
        expect(tubeHeight(pts, top.x, 0)).toBe(0);
        expect(tubeHeight(pts, top.x, -10)).toBe(0);
      }
      const start = L.exitTube[0]!;
      expect(tubeHeight(L.exitTube, start.x, start.y)).toBeCloseTo(BALL_R, 6);
      expect(tubeHeight(L.orbitTube, L.orbitTube[2]!.x, L.orbitTube[2]!.y)).toBe(TUBE_Z);
    }
  });

  it("maps a deck's plane onto its region, so chutes stay over their tables", () => {
    const cam = new PerspectiveCamera();
    const W = VENUE_SIZE.screen.width;
    const H = VENUE_SIZE.screen.height;
    const d = 1.15 * Math.max(W, H);
    fitStraight(
      cam,
      W / 2,
      H / 2,
      d,
      { x0: 0, y0: 0, x1: W, y1: H },
      { near: d * 0.3, far: d * 1.2 },
    );
    for (const x of [0, 421.2, 2106, 4000]) {
      const p = ndc(cam, x, H);
      expect(p.x).toBeCloseTo((x / W) * 2 - 1, 6);
      expect(p.y).toBeCloseTo(-1, 6);
    }
  });

  it("has a look for every theme, with every colour a part needs", () => {
    for (const t of THEMES) {
      const look = THEME_LOOKS[t];
      expect(look.id).toBe(t);
      for (const v of Object.values(look.palette)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof look.table).toBe("function");
    }
    // The plain deck has a piece for everything a skin can give.
    expect(Object.keys(plainDeck).sort()).toEqual(
      [
        "big",
        "captive",
        "chute",
        "cluster",
        "hole",
        "lock",
        "magnet",
        "mushrooms",
        "nest",
        "pops",
        "rail",
        "saucer",
        "scoop",
        "shuttle",
        "sling",
        "spinner",
        "stars",
        "target",
        "walls",
      ].sort(),
    );
    expect(Object.keys(PLAIN_COLORS).length).toBeGreaterThan(10);
  });
});
