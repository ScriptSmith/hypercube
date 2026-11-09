/**
 * The camera rule for every 3D view: a perspective camera straight in front of a flat field (a
 * table's playfield or the deck), with the field's plane mapped one to one onto its rectangle in
 * the frame. So the plane stays exactly where the 2D drawing has it (touches, pads, the grab, the
 * chutes and holes line up), and anything raised off it shows real depth: it grows a little and
 * slides out from the middle, as it would to someone standing in front.
 *
 * Scene coordinates are the field's own px with y flipped: x right, y up (scene y = -field y), z
 * towards the viewer. `fitStraight` aims a camera at a field point from `distance` px away and
 * sets an off-centre frustum so the plane rectangle `view` (field px) fills the viewport.
 */
import type { PerspectiveCamera } from "three";

export interface FieldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Put `cam` at (cx, cy) in field px, `distance` px in front of the plane, looking straight at it,
 * with a frustum whose plane cross-section is `view`. `offset` (scene px) moves the camera along
 * the scene's x, for a field placed apart from others in one scene.
 */
export const fitStraight = (
  cam: PerspectiveCamera,
  cx: number,
  cy: number,
  distance: number,
  view: FieldRect,
  o: { near?: number; far?: number; offset?: number; shake?: { x: number; y: number } } = {},
) => {
  const near = o.near ?? distance * 0.05;
  const far = o.far ?? distance * 1.6;
  const ox = o.offset ?? 0;
  const sx = o.shake?.x ?? 0;
  const sy = o.shake?.y ?? 0;
  cam.position.set(ox + cx + sx, -cy - sy, distance);
  cam.up.set(0, 1, 0);
  cam.lookAt(ox + cx + sx, -cy - sy, 0);
  cam.updateMatrixWorld(true);
  const k = near / distance;
  // A shake moves the camera, not the frustum, so the whole view slides a little.
  const left = (view.x0 - cx) * k;
  const right = (view.x1 - cx) * k;
  const top = (cy - view.y0) * k;
  const bottom = (cy - view.y1) * k;
  cam.near = near;
  cam.far = far;
  cam.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
};

/**
 * Where a point (x, y) at height z over the field appears on the plane, seen by a camera at
 * (cx, cy) `distance` in front: the parallax of anything raised.
 */
export const seenAt = (
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  distance: number,
): { x: number; y: number; k: number } => {
  const k = distance / Math.max(1e-6, distance - z);
  return { x: cx + (x - cx) * k, y: cy + (y - cy) * k, k };
};
