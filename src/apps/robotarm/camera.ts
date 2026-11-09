/**
 * Camera framing and the bank lift's beam, with three.js maths only (no renderer), so tests can
 * run it.
 *
 * Framing: the camera looks at the bench from its orbit angles and is fitted so the bench and the
 * arm's usual reach fill the lane's focus rectangle, centred across and down against the
 * controls, using a view offset.
 *
 * The beam: a strip of light standing on the lift that always faces the camera at the lift's own
 * depth. It is therefore exactly upright and evenly wide on the frame, whatever the view, and
 * it is cut to end exactly at the frame's top edge. Where it leaves, and how wide it is, are what
 * the screen above needs to carry it on (link.ts).
 */
import { type PerspectiveCamera, Vector3 } from "three";
import type { Rect } from "../../core/types";
import { BENCH_BACK, BENCH_DEPTH, BENCH_R, type Lift } from "./bench";

export const CAMERA_DISTANCE = 15;
/** The camera looks here. */
const LOOK = new Vector3(0, 0.8, 0.9);
/** Half the beam's width, world units. */
export const BEAM_R = 0.36;

/** Points the camera must keep in view: the bench, its bins and a working height above it. */
const makeFramePoints = (): Vector3[] => {
  const pts: Vector3[] = [];
  for (let a = 0; a <= 180; a += 15) {
    const t = (a * Math.PI) / 180;
    const x = Math.cos(t) * (BENCH_R + 0.05);
    const z = Math.sin(t) * (BENCH_R + 0.05);
    pts.push(new Vector3(x, 0.05, z), new Vector3(x, -BENCH_DEPTH - 0.05, z));
  }
  for (const x of [-BENCH_R, BENCH_R]) {
    pts.push(new Vector3(x, 0.05, -BENCH_BACK), new Vector3(x, -BENCH_DEPTH, -BENCH_BACK));
  }
  // The arm's usual working height: up over its base and out over the front of the bench.
  pts.push(
    new Vector3(0, 3, 0),
    new Vector3(0, 2.6, 1.4),
    new Vector3(-1.2, 2.5, 0.4),
    new Vector3(1.2, 2.5, 0.4),
  );
  return pts;
};

const FRAME_POINTS = makeFramePoints();

/**
 * Point the camera from its orbit angles (degrees) so the frame points fill the focus rectangle
 * (stage px), drawing into the lane. Refitted at every angle, so a turned view still shows the
 * whole bench.
 */
export const frameCamera = (
  cam: PerspectiveCamera,
  lane: Rect,
  focus: Rect,
  azimuth: number,
  elevation: number,
) => {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  cam.position.set(
    LOOK.x + Math.sin(az) * Math.cos(el) * CAMERA_DISTANCE,
    LOOK.y + Math.sin(el) * CAMERA_DISTANCE,
    LOOK.z + Math.cos(az) * Math.cos(el) * CAMERA_DISTANCE,
  );
  cam.lookAt(LOOK);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const v = new Vector3();
  for (const p of FRAME_POINTS) {
    v.copy(p).applyMatrix4(inv);
    const tx = v.x / -v.z;
    const ty = v.y / -v.z;
    x0 = Math.min(x0, tx);
    x1 = Math.max(x1, tx);
    y0 = Math.min(y0, ty);
    y1 = Math.max(y1, ty);
  }
  // Stage px per unit of tan: the largest that fits the box in the focus rectangle.
  const k = Math.min(focus.width / (x1 - x0), focus.height / (y1 - y0)) * 0.97;
  // Centred across, and down against the controls, leaving the sky above for the arm to rise.
  const fcx = focus.x + focus.width / 2;
  const fcy = focus.y + focus.height - ((y1 - y0) * k) / 2;
  // Where the optical axis lands on the stage.
  const px = fcx - ((x0 + x1) / 2) * k;
  const py = fcy + ((y0 + y1) / 2) * k;
  const halfW = Math.max(px - lane.x, lane.x + lane.width - px, 1);
  const halfH = Math.max(py - lane.y, lane.y + lane.height - py, 1);
  const fullW = 2 * halfW;
  const fullH = 2 * halfH;
  cam.fov = (2 * Math.atan(halfH / k) * 180) / Math.PI;
  cam.aspect = fullW / fullH;
  cam.setViewOffset(
    fullW,
    fullH,
    halfW - (px - lane.x),
    halfH - (py - lane.y),
    lane.width,
    lane.height,
  );
  cam.updateProjectionMatrix();
};

/** A world point to stage px, with its depth in normalised device units. */
export const toStage = (cam: PerspectiveCamera, lane: Rect, p: Vector3) => {
  const v = p.clone().project(cam);
  return {
    x: lane.x + ((v.x + 1) / 2) * lane.width,
    y: lane.y + ((1 - v.y) / 2) * lane.height,
    z: v.z,
  };
};

/** The world point under stage px (x, y) at normalised depth `z`. */
export const fromStage = (cam: PerspectiveCamera, lane: Rect, x: number, y: number, z: number) =>
  new Vector3(
    ((x - lane.x) / lane.width) * 2 - 1,
    1 - ((y - lane.y) / lane.height) * 2,
    z,
  ).unproject(cam);

export interface BeamExit {
  /** Where the beam's centre leaves the frame's top edge, and its width, as shares of the frame's width. */
  u: number;
  w: number;
  /** Whether the beam shows on this frame at all (its lift is on the frame). */
  visible: boolean;
  /** The beam's foot on the lift and its end on the top edge, world units. */
  base: Vector3;
  top: Vector3;
  /** Its length, world units: how far a piece rises before it leaves the frame. */
  length: number;
}

/** Where the lift's beam meets the top edge of a frame `frameWidth` stage px wide. */
export const beamExit = (
  cam: PerspectiveCamera,
  lane: Rect,
  frameWidth: number,
  lift: Lift,
): BeamExit => {
  const base = new Vector3(lift.x, lift.top, lift.z);
  const foot = toStage(cam, lane, base);
  const top = fromStage(cam, lane, foot.x, lane.y, foot.z);
  const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(BEAM_R);
  const a = toStage(cam, lane, base.clone().add(right));
  const b = toStage(cam, lane, base.clone().sub(right));
  const wPx = Math.abs(a.x - b.x);
  const visible =
    foot.z > -1 &&
    foot.z < 1 &&
    foot.y > lane.y &&
    foot.x - wPx / 2 >= lane.x &&
    foot.x + wPx / 2 <= lane.x + lane.width;
  const width = Math.max(1, frameWidth);
  return {
    u: Math.min(1, Math.max(0, foot.x / width)),
    w: visible ? wPx / width : 0,
    visible,
    base,
    top,
    length: top.distanceTo(base),
  };
};
