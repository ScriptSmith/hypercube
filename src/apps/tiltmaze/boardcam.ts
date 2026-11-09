/**
 * The camera on each board, with three.js maths only (no renderer), so tests and the screen above
 * a bank can run it: fixed, in front of and above the board at 60 degrees, fitted so the board at
 * any tilt and its collector fill the slot's focus rectangle, drawing into its lane.
 *
 * The collector is a little box behind the board's far rim that takes the ball from the goal; the
 * clear tube starts on its top. Where that top lands on the stage is where the tube rises from,
 * so a screen above a bank can work out where each frame's tube is from the frame's layout alone.
 */
import { PerspectiveCamera, Vector3 } from "three";
import type { Rect } from "../../core/types";
import { DEG } from "./config";
import { BOARD, type Orient, RIM } from "./maze";

export const ELEVATION = 58 * DEG;
export const CAMERA_DISTANCE = 1.5;
/** Tilt allowed for when fitting, a little over the largest. */
const TILT_ROOM = 13 * DEG;
export const BOARD_THICK = 0.03;
export const RIM_H = 0.022;
export const COLLECTOR = { gap: 0.012, d: 0.05, h: 0.05, w: 0.07 } as const;

/** Where the collector sits: x as a share of the board's width, and its top centre. */
export const collectorTop = (orient: Orient, along: number): Vector3 => {
  const { w, d } = BOARD[orient];
  return new Vector3(along * w, COLLECTOR.h, -(d / 2 + RIM + COLLECTOR.gap + COLLECTOR.d / 2));
};

const framePoints = (orient: Orient, along: number): Vector3[] => {
  const { w, d } = BOARD[orient];
  const hx = w / 2 + RIM;
  const hz = d / 2 + RIM;
  const lift = Math.hypot(hx, hz) * Math.sin(TILT_ROOM);
  const pts: Vector3[] = [];
  for (const x of [-hx, hx]) {
    for (const z of [-hz, hz]) {
      pts.push(new Vector3(x, RIM_H + lift, z), new Vector3(x, -BOARD_THICK - lift, z));
    }
  }
  const c = collectorTop(orient, along);
  const half = COLLECTOR.w / 2;
  pts.push(
    new Vector3(c.x - half, c.y, c.z - COLLECTOR.d / 2),
    new Vector3(c.x + half, c.y, c.z - COLLECTOR.d / 2),
  );
  return pts;
};

export interface Fit {
  /** Stage px per unit of tan: bigger means a bigger board. */
  k: number;
}

/** Aim and fit `cam` so the board fills `focus` (stage px), drawing into `lane`. */
export const fitBoardCamera = (
  cam: PerspectiveCamera,
  lane: Rect,
  focus: Rect,
  orient: Orient,
  along: number,
): Fit => {
  cam.position.set(0, Math.sin(ELEVATION) * CAMERA_DISTANCE, Math.cos(ELEVATION) * CAMERA_DISTANCE);
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const v = new Vector3();
  for (const p of framePoints(orient, along)) {
    v.copy(p).applyMatrix4(inv);
    const tx = v.x / -v.z;
    const ty = v.y / -v.z;
    x0 = Math.min(x0, tx);
    x1 = Math.max(x1, tx);
    y0 = Math.min(y0, ty);
    y1 = Math.max(y1, ty);
  }
  // Symmetric across, so the board's centre line is the focus's centre line.
  const ax = Math.max(Math.abs(x0), Math.abs(x1));
  const k = Math.min(focus.width / (2 * ax), focus.height / (y1 - y0)) * 0.98;
  const px = focus.x + focus.width / 2;
  const fcy = focus.y + focus.height / 2;
  const py = fcy + ((y0 + y1) / 2) * k;
  const halfW = Math.max(px - lane.x, lane.x + lane.width - px, 1);
  const halfH = Math.max(py - lane.y, lane.y + lane.height - py, 1);
  cam.fov = (2 * Math.atan(halfH / k) * 180) / Math.PI;
  cam.aspect = halfW / halfH;
  cam.setViewOffset(
    2 * halfW,
    2 * halfH,
    halfW - (px - lane.x),
    halfH - (py - lane.y),
    lane.width,
    lane.height,
  );
  cam.near = 0.2;
  cam.far = 5;
  cam.updateProjectionMatrix();
  return { k };
};

/** Stage px of a board-scene point, as `cam` (fitted to `lane`) draws it. */
export const toStage = (cam: PerspectiveCamera, lane: Rect, p: Vector3) => {
  const v = p.clone().project(cam);
  return {
    x: lane.x + ((v.x + 1) / 2) * lane.width,
    y: lane.y + ((1 - v.y) / 2) * lane.height,
  };
};

/** Stage px per metre at a board-scene point (for sizing things to match across scenes). */
export const pxPerMetre = (cam: PerspectiveCamera, fit: Fit, p: Vector3) => {
  const v = p.clone().applyMatrix4(cam.matrixWorldInverse);
  return fit.k / Math.max(1e-6, -v.z);
};

/** Where the tube leaves a board's collector, stage px. */
export const collectorStage = (
  lane: Rect,
  focus: Rect,
  orient: Orient,
  along: number,
): { x: number; y: number } => {
  const cam = new PerspectiveCamera();
  fitBoardCamera(cam, lane, focus, orient, along);
  return toStage(cam, lane, collectorTop(orient, along));
};

/** How big the board comes out in `focus` for each shape, to pick the better one. */
export const fitScale = (focus: Rect, orient: Orient): number => {
  const cam = new PerspectiveCamera();
  return fitBoardCamera(cam, focus, focus, orient, 0).k;
};
