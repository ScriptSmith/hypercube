/**
 * Glass coordinates: metres on the plane of a frame's display, as venue space has them on the
 * wall (x along it, y up; see src/core/view3d.ts). Every frame of a bank and its screen hang on
 * one wall and share one eye, so a glass point means the same place in the room on each of them.
 * The marble run is laid out in glass metres and placed behind the glass along the eye's rays,
 * which is how a tube rising out of a frame's top edge carries straight on up the screen above.
 */
import { Vector3 } from "three";
import type { FrameInfo, SetupInfo } from "../../core/types";
import {
  bankLayout,
  defaultEye,
  frameView,
  type PlaceOptions,
  type Surface,
  surfaceOf,
  type Vec3,
  type WindowView,
} from "../../core/view3d";
import { activeVenue } from "../../core/venue";
import { nominalLayout } from "./layout";

/** Depth behind the glass of the tubes, and of the rails and jar (in front of the tubes). */
export const Z_TUBE = -0.3;
export const Z_RAIL = -0.12;
/**
 * On a screen the rails and jar stand well in front of the wall: balls keep their size and look
 * bigger as they pop out of the tubes towards the room, so the run reads from across it.
 */
export const Z_SCREEN_RAIL = 1.8;

export interface Glass {
  readonly surface: Surface;
  readonly eye: Vec3;
  readonly view: WindowView;
  /** Glass metres per venue px. */
  readonly mPerPx: number;
  /** Venue px on the stage to glass metres. */
  toGlass(vx: number, vy: number): { x: number; y: number };
  /** Glass metres to venue px on the stage. */
  toVenue(gx: number, gy: number): { x: number; y: number };
  /** Where a glass point lands at depth `z` (negative behind the glass), in venue space. */
  world(gx: number, gy: number, z: number, out: Vector3): Vector3;
  /** How much bigger a thing at depth `z` must be to look its glass size. */
  scaleAt(z: number): number;
  /** The glass height of the frame's top edge. */
  readonly top: number;
}

export const createGlass = (frame: FrameInfo, setup: SetupInfo, opts: PlaceOptions = {}): Glass => {
  const surface = surfaceOf(frame, setup, opts);
  const eye = defaultEye(frame, setup, opts);
  const view = frameView(frame, setup, { ...opts, eye });
  const vw = frame.width / Math.max(1e-9, frame.unit);
  const vh = frame.height / Math.max(1e-9, frame.unit);
  const [ox, oy, oz] = surface.origin;
  const [rx, ry, rz] = surface.right;
  const [ux, uy, uz] = surface.up;
  const [nx, ny, nz] = surface.normal;
  const d = Math.max(1e-6, (eye[0] - ox) * nx + (eye[1] - oy) * ny + (eye[2] - oz) * nz);
  const along = (gx: number, gy: number) => ({
    a: (gx - ox) * rx + (gy - oy) * ry - oz * rz,
    b: (gx - ox) * ux + (gy - oy) * uy - oz * uz,
  });
  return {
    surface,
    eye,
    view,
    mPerPx: surface.width / vw,
    toGlass(vx, vy) {
      // Frames on a front wall have right = +x and up = +y, so glass x and y are venue x and y.
      return {
        x: ox + rx * (vx / vw) * surface.width + ux * (1 - vy / vh) * surface.height,
        y: oy + ry * (vx / vw) * surface.width + uy * (1 - vy / vh) * surface.height,
      };
    },
    toVenue(gx, gy) {
      const { a, b } = along(gx, gy);
      return { x: (a / surface.width) * vw, y: (1 - b / surface.height) * vh };
    },
    world(gx, gy, z, out) {
      const { a, b } = along(gx, gy);
      const px = ox + rx * a + ux * b;
      const py = oy + ry * a + uy * b;
      const pz = oz + rz * a + uz * b;
      const t = (d - z) / d;
      return out.set(
        eye[0] + (px - eye[0]) * t,
        eye[1] + (py - eye[1]) * t,
        eye[2] + (pz - eye[2]) * t,
      );
    },
    scaleAt(z) {
      return (d - z) / d;
    },
    top: oy + uy * surface.height,
  };
};

/** One touch frame below a screen, as the screen knows it from the roster. */
export interface Column {
  pos: number;
  kind: "panel" | "pair";
  /** Boards on it: 1, or 2 on a pair side by side; 1 on a pair together. */
  boards: number;
}

/**
 * Glass x of every tube rising from a bank's frames, and the glass height of their top edges, as
 * the screen above them works it out: from each frame's nominal layout and its place in the bank.
 */
export const bankTubes = (
  columns: readonly Column[],
  count: number,
  span: number,
): { pos: number; board: number; x: number }[] => {
  const bank = bankLayout(count, span, null, activeVenue());
  const out: { pos: number; board: number; x: number }[] = [];
  for (const c of columns) {
    const f = bank.frames[c.pos];
    if (!f) continue;
    const layout = nominalLayout(c.kind, {
      span: c.kind === "pair" ? Math.max(2, span) : 1,
      together: c.kind === "pair" && c.boards === 1,
    });
    layout.boards.forEach((b, i) => {
      out.push({ pos: c.pos, board: i, x: f.origin[0] + (b.tube.x / layout.width) * f.width });
    });
  }
  return out;
};

/** Glass height of a bank's touch frames' top edge. */
export const bankEdge = (): number => {
  const panel = activeVenue().panel;
  return panel.bottomM + panel.heightM;
};
