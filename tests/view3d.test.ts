import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../src/core/frame";
import type { FrameInfo, FrameKind, SetupInfo } from "../src/core/types";
import { DEFAULT_VENUE } from "../src/core/venue";
import {
  type Vec3,
  applyToCamera,
  bankLayout,
  defaultEye,
  displaySurface,
  frameView,
  surfaceOf,
  windowView,
} from "../src/core/view3d";

/** A frame whose stage is `scale` CSS px per venue px, optionally of another size. */
const frameOf = (kind: FrameKind, scale = 0.25, stage?: [number, number]): FrameInfo => {
  const { width: vw, height: vh } = VENUE_SIZE[kind];
  const [w, h] = stage ?? [vw * scale, vh * scale];
  return {
    kind,
    span: kind === "pair" ? 2 : 1,
    venueWidth: vw,
    venueHeight: vh,
    width: w,
    height: h,
    unit: Math.min(w / vw, h / vh),
    pixelRatio: 1,
    touch: kind !== "screen",
    reach: { adult: 1, child: 0.5 },
    reachTop: { adult: 0, child: h / 2 },
    seams: [],
  };
};

const setupOf = (over: Partial<SetupInfo>): SetupInfo => ({
  name: "bank",
  role: "station",
  pos: 0,
  count: 6,
  group: "main",
  side: 0,
  ...over,
});

/** Where on the surface's plane a stage point lies, in venue space. */
const onSurface = (f: FrameInfo, s: SetupInfo, x: number, y: number): Vec3 => {
  const surf = surfaceOf(f, s);
  const a = (x / f.width) * surf.width;
  const b = (1 - y / f.height) * surf.height;
  return [
    surf.origin[0] + surf.right[0] * a + surf.up[0] * b,
    surf.origin[1] + surf.right[1] * a + surf.up[1] * b,
    surf.origin[2] + surf.right[2] * a + surf.up[2] * b,
  ];
};

const expectVec = (a: Vec3, b: Vec3, digits = 6) => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i] ?? NaN, digits);
};

describe("bank layout", () => {
  it("centres six panels and puts the screen exactly over them", () => {
    const { frames, screen } = bankLayout(6, 1);
    const width = 6 * DEFAULT_VENUE.panel.widthM + 5 * DEFAULT_VENUE.bezelM;
    expect(frames).toHaveLength(6);
    expect(frames[0]?.origin[0]).toBeCloseTo(-width / 2);
    const last = frames[5];
    expect((last?.origin[0] ?? 0) + (last?.width ?? 0)).toBeCloseTo(width / 2);
    expect(screen.origin[0]).toBeCloseTo(-width / 2);
    expect(screen.width).toBeCloseTo(width);
    expect(screen.height).toBeCloseTo(
      (width * DEFAULT_VENUE.screen.height) / DEFAULT_VENUE.screen.width,
    );
    expect(screen.origin[1]).toBe(DEFAULT_VENUE.screen.bottomM);
    expect(frames[3]?.origin[1]).toBe(DEFAULT_VENUE.panel.bottomM);
  });

  it("gives three pairs the same width as six panels", () => {
    const pairs = bankLayout(3, 2);
    const panels = bankLayout(6, 1);
    expect(pairs.screen.width).toBeCloseTo(panels.screen.width);
    expect(pairs.frames[1]?.origin[0]).toBeCloseTo(panels.frames[2]?.origin[0] ?? NaN);
  });

  it("puts a corner's two sides on walls meeting at the corner", () => {
    const a = bankLayout(6, 1, 0);
    const b = bankLayout(6, 1, 1);
    const lastA = a.frames[5];
    expect((lastA?.origin[0] ?? 1) + (lastA?.width ?? 0)).toBeCloseTo(0);
    expect(a.frames[0]?.normal).toEqual([0, 0, 1]);
    expectVec(b.frames[0]?.origin ?? [9, 9, 9], [0, DEFAULT_VENUE.panel.bottomM, 0]);
    expect(b.frames[0]?.right).toEqual([0, 0, 1]);
    expect(b.frames[0]?.normal).toEqual([-1, 0, 0]);
  });
});

describe("frame surfaces", () => {
  it("place a bank frame by its position", () => {
    const s = displaySurface({ kind: "panel" }, setupOf({ pos: 4 }));
    expect(s).toEqual(bankLayout(6, 1).frames[4]);
  });

  it("let a screen work out its bank's panels", () => {
    const screen = { kind: "screen" as const };
    const pairs = displaySurface(screen, setupOf({ role: "screen", count: 3 }));
    const panels = displaySurface(screen, setupOf({ role: "screen", count: 6 }));
    expect(pairs.width).toBeCloseTo(panels.width);
    const four = displaySurface(screen, setupOf({ role: "screen", count: 4 }));
    expect(four.width).toBeCloseTo(bankLayout(4, 1).screen.width);
    const told = displaySurface(screen, setupOf({ role: "screen", count: 4 }), { span: 2 });
    expect(told.width).toBeCloseTo(bankLayout(4, 2).screen.width);
  });

  it("centre a frame on its own", () => {
    const s = displaySurface({ kind: "wall" }, setupOf({ name: "solo", role: "solo", count: 1 }));
    expect(s.origin[0]).toBeCloseTo(-DEFAULT_VENUE.wall.widthM / 2);
    expect(s.width).toBe(DEFAULT_VENUE.wall.widthM);
  });

  it("cover the display when the stage has its shape", () => {
    const setup = setupOf({ pos: 2 });
    expect(surfaceOf(frameOf("panel"), setup)).toEqual(displaySurface({ kind: "panel" }, setup));
  });

  it("keep metres per pixel and the centre on a stage of another shape", () => {
    const setup = setupOf({ pos: 2 });
    const d = displaySurface({ kind: "panel" }, setup);
    const s = surfaceOf(frameOf("panel", 1, [540, 1200]), setup);
    expect(s.width).toBeCloseTo(d.width);
    expect(s.height).toBeCloseTo((d.height * 1200) / 960);
    expect(s.origin[0]).toBeCloseTo(d.origin[0]);
    expect(s.origin[1] + s.height / 2).toBeCloseTo(d.origin[1] + d.height / 2);
  });
});

describe("window views", () => {
  it("share one eye across a bank and its screen", () => {
    const eye = defaultEye({ kind: "panel" }, setupOf({ pos: 0 }));
    expect(defaultEye({ kind: "panel" }, setupOf({ pos: 5 }))).toEqual(eye);
    expect(defaultEye({ kind: "screen" }, setupOf({ role: "screen" }))).toEqual(eye);
    expect(defaultEye({ kind: "pair", span: 2 }, setupOf({ count: 3 }))).toEqual(eye);
    expect(eye[2]).toBeGreaterThan(2);
  });

  it("show a point on the wall where it is, whatever the eye", () => {
    const f = frameOf("panel");
    const setup = setupOf({ pos: 4 });
    const surf = surfaceOf(f, setup);
    const p: Vec3 = [surf.origin[0] + 0.2, surf.origin[1] + 0.9, 0];
    for (const eye of [
      [0, 1.6, 4],
      [-3, 0.5, 1],
      [5, 3, 9],
    ] as Vec3[]) {
      const at = windowView(surf, eye, f).toStage(p);
      expect(at?.x).toBeCloseTo((0.2 / surf.width) * f.width);
      expect(at?.y).toBeCloseTo((1 - 0.9 / surf.height) * f.height);
    }
  });

  it("carry a scene on behind the bezel between two panels", () => {
    const f = frameOf("panel");
    const left = setupOf({ pos: 3 });
    const right = setupOf({ pos: 4 });
    // A point a metre behind the wall, seen just right of panel 3's edge from the shared eye.
    const p: Vec3 = [frameView(f, left).eye[0] - 0.5, 1.3, -1];
    const a = frameView(f, left).toStage(p);
    const b = frameView(f, right).toStage(p);
    expect(a && b).toBeTruthy();
    if (!a || !b) return;
    expectVec(onSurface(f, left, a.x, a.y), onSurface(f, right, b.x, b.y));
    expect(a.depth).toBeCloseTo(b.depth);
  });

  it("carry a scene from the panels into the screen above", () => {
    const panel = frameOf("panel");
    const screen = frameOf("screen", 0.1);
    const ps = setupOf({ pos: 5 });
    const ss = setupOf({ role: "screen" });
    const p: Vec3 = [0.4, 2.5, -2];
    const a = frameView(panel, ps).toStage(p);
    const b = frameView(screen, ss).toStage(p);
    if (!a || !b) throw new Error("behind the eye");
    expectVec(onSurface(panel, ps, a.x, a.y), onSurface(screen, ss, b.x, b.y));
  });

  it("join the two screens of a corner along the corner", () => {
    const screen = frameOf("screen", 0.1);
    const a = setupOf({ name: "corner", role: "screen", side: 0 });
    const b = setupOf({ name: "corner", role: "screen", side: 1 });
    const eye = defaultEye({ kind: "screen" }, a);
    expect(defaultEye({ kind: "screen" }, b)).toEqual(eye);
    // A point beyond the corner, straight behind a point on the corner line from the eye.
    const c: Vec3 = [0, 5, 0];
    const p: Vec3 = [
      eye[0] + (c[0] - eye[0]) * 3,
      eye[1] + (c[1] - eye[1]) * 3,
      eye[2] + (c[2] - eye[2]) * 3,
    ];
    const sa = frameView(screen, a).toStage(p);
    const sb = frameView(screen, b).toStage(p);
    if (!sa || !sb) throw new Error("behind the eye");
    expect(sa.x).toBeCloseTo(screen.width);
    expect(sb.x).toBeCloseTo(0);
    expect(sa.y).toBeCloseTo(sb.y);
  });

  it("agree with their own matrices", () => {
    const f = frameOf("pair");
    const view = frameView(f, setupOf({ pos: 1, count: 3 }));
    const proj = view.projection(0.1, 50);
    const m = view.view();
    const p: Vec3 = [0.7, 1.9, -3];
    const c = [0, 1, 2].map(
      (r) =>
        (m[r] ?? 0) * p[0] + (m[r + 4] ?? 0) * p[1] + (m[r + 8] ?? 0) * p[2] + (m[r + 12] ?? 0),
    );
    const [cx = 0, cy = 0, cz = 0] = c;
    const clipX = (proj[0] ?? 0) * cx + (proj[8] ?? 0) * cz;
    const clipY = (proj[5] ?? 0) * cy + (proj[9] ?? 0) * cz;
    const w = -cz;
    const at = view.toStage(p);
    expect(at?.x).toBeCloseTo(((clipX / w + 1) / 2) * f.width, 4);
    expect(at?.y).toBeCloseTo(((1 - clipY / w) / 2) * f.height, 4);
    const world = view.world();
    expect(world[12]).toBeCloseTo(view.eye[0]);
    expect(world[14]).toBeCloseTo(view.eye[2]);
  });

  it("cast rays back through the stage", () => {
    const f = frameOf("kiosk");
    const view = frameView(f, setupOf({ name: "solo", role: "solo", count: 1 }));
    const { origin, dir } = view.ray(300, 120);
    const p: Vec3 = [origin[0] + dir[0] * 7, origin[1] + dir[1] * 7, origin[2] + dir[2] * 7];
    const at = view.toStage(p);
    expect(at?.x).toBeCloseTo(300);
    expect(at?.y).toBeCloseTo(120);
    expect(view.toStage([0, 1.6, 50])).toBeNull();
  });

  it("drive a three.js camera to the same picture", () => {
    const f = frameOf("panel");
    const view = frameView(f, setupOf({ pos: 5 }));
    const cam = new PerspectiveCamera();
    applyToCamera(view, cam, 0.05, 100);
    const p: Vec3 = [1.2, 1.1, -0.6];
    const ndc = new Vector3(...p).project(cam);
    const at = view.toStage(p);
    expect(at?.x).toBeCloseTo(((ndc.x + 1) / 2) * f.width, 3);
    expect(at?.y).toBeCloseTo(((1 - ndc.y) / 2) * f.height, 3);
    expect(cam.position.z).toBeCloseTo(view.eye[2]);
  });
});
