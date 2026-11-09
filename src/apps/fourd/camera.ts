/**
 * Framing a view's camera, with three.js maths only (no renderer), so tests can run it.
 *
 * The camera orbits the origin at a fixed distance from its azimuth and elevation, and is fitted
 * so a set of points fills the view's focus rectangle, drawing into its lane with a view offset.
 * The points are rings round the upright axis, so the fit doesn't change as the view spins.
 */
import { type PerspectiveCamera, Vector3 } from "three";
import type { Rect } from "../../core/types";

export const CAMERA_DISTANCE = 8;

/** Points round the upright axis: `rings` of [y, radius]. */
export const ringPoints = (
  rings: readonly (readonly [number, number])[],
  steps = 24,
): Vector3[] => {
  const out: Vector3[] = [];
  for (const [y, r] of rings) {
    if (r === 0) {
      out.push(new Vector3(0, y, 0));
      continue;
    }
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      out.push(new Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
  }
  return out;
};

/** Points on a sphere of radius r about `y`. */
export const spherePoints = (r: number, y = 0): Vector3[] =>
  ringPoints([
    [y + r, 0],
    [y + r * 0.7, r * 0.714],
    [y + r * 0.35, r * 0.937],
    [y, r],
    [y - r * 0.35, r * 0.937],
    [y - r * 0.7, r * 0.714],
    [y - r, 0],
  ]);

const v = new Vector3();

/** Aim and fit `cam` (angles in degrees, rectangles in stage px). */
export const frameCamera = (
  cam: PerspectiveCamera,
  lane: Rect,
  focus: Rect,
  azimuth: number,
  elevation: number,
  points: readonly Vector3[],
  distance = CAMERA_DISTANCE,
): void => {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  cam.position.set(
    Math.sin(az) * Math.cos(el) * distance,
    Math.sin(el) * distance,
    Math.cos(az) * Math.cos(el) * distance,
  );
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    v.copy(p).applyMatrix4(inv);
    const depth = Math.max(0.1, -v.z);
    const tx = v.x / depth;
    const ty = v.y / depth;
    x0 = Math.min(x0, tx);
    x1 = Math.max(x1, tx);
    y0 = Math.min(y0, ty);
    y1 = Math.max(y1, ty);
  }
  if (!(x1 > x0) || !(y1 > y0)) {
    x0 = -1;
    x1 = 1;
    y0 = -1;
    y1 = 1;
  }
  // Stage px per unit of tan: the largest that fits the box in the focus rectangle.
  const k = Math.max(1e-6, Math.min(focus.width / (x1 - x0), focus.height / (y1 - y0)));
  const fcx = focus.x + focus.width / 2;
  const fcy = focus.y + focus.height / 2;
  // Where the optical axis lands on the stage.
  const px = fcx - ((x0 + x1) / 2) * k;
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
  cam.updateProjectionMatrix();
};

/** A world point to stage px. */
export const toStage = (
  cam: PerspectiveCamera,
  lane: Rect,
  p: Vector3,
): { x: number; y: number; z: number } => {
  v.copy(p).project(cam);
  return {
    x: lane.x + ((v.x + 1) / 2) * lane.width,
    y: lane.y + ((1 - v.y) / 2) * lane.height,
    z: v.z,
  };
};
