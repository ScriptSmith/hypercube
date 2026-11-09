/**
 * Windows onto one 3D scene. Every frame of a setup is a rectangle on a wall of the venue, and
 * each one renders the shared scene with an off-axis camera from one shared eye point, so the
 * scene carries on behind the bezels between panels, from the panels into the screen above them,
 * and round the corner where two zones meet. The pictures line up across frames for any eye;
 * where the eye is only changes how natural the scene looks from elsewhere in the room.
 *
 * Venue space is in metres with y up and the floor at y = 0. A bank, or a frame on its own,
 * hangs on the plane z = 0, centred on x = 0 and facing +z, where visitors stand. In a corner,
 * side 0's wall runs along z = 0 and ends at the corner at x = 0 (its frames have x < 0), and
 * side 1's wall runs from the corner along +z on the plane x = 0, facing -x. The two sides of a
 * versus setup are separate spaces, each laid out as if it were alone.
 *
 * Sizes come from the venue profile, so a screen must know how many panels its bank's frames
 * span (see `PlaceOptions.span`).
 */
import type { PerspectiveCamera } from "three";
import type { FrameInfo, FrameKind, SetupInfo } from "./types";
import { activeVenue, type VenueProfile, displayFor } from "./venue";

export type Vec3 = readonly [number, number, number];

/** A rectangle in venue space: a display, or the part of one that a frame's stage covers. */
export interface Surface {
  /** Bottom-left corner. */
  origin: Vec3;
  /** Unit vector along the width, left to right as seen from the room. */
  right: Vec3;
  /** Unit vector up the surface. */
  up: Vec3;
  /** Unit vector out of the surface, towards the room. */
  normal: Vec3;
  /** Metres. */
  width: number;
  height: number;
}

export interface PlaceOptions {
  venue?: VenueProfile;
  /**
   * Panels in each touch frame of a bank. Touch frames know their own; a screen can't, so pass
   * the `span` its peers advertise (absent means 1). Without it a screen assumes its bank fills
   * the venue's bank: `maxMerge` when `count` frames of that many panels make `bankCount`
   * panels, otherwise 1.
   */
  span?: number;
}

/** Adult eye height, metres. */
export const EYE_HEIGHT_M = 1.6;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const UP: Vec3 = [0, 1, 0];
/** Facing the room from z = 0 (a bank, a solo frame, a corner's side 0). */
const FRONT = { right: [1, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
/** A corner's side 1, on the plane x = 0. */
const SIDE = { right: [0, 0, 1] as Vec3, normal: [-1, 0, 0] as Vec3 };

/** The bank's frames, left to right, and the screen above them, on one wall. */
export interface BankLayout {
  frames: Surface[];
  screen: Surface;
}

const touchSpan = (kind: FrameKind, span: number | undefined): number =>
  kind === "pair" ? Math.max(2, span ?? 2) : 1;

/** Panels per touch frame, as a frame of `kind` in `setup` sees it. */
const spanFor = (
  frame: { kind: FrameKind; span?: number },
  setup: SetupInfo,
  opts: PlaceOptions,
) => {
  const venue = opts.venue ?? activeVenue();
  if (frame.kind !== "screen") return touchSpan(frame.kind, frame.span);
  if (opts.span) return Math.max(1, Math.round(opts.span));
  const n = Math.max(1, setup.count);
  return n * venue.maxMerge === venue.bankCount ? venue.maxMerge : 1;
};

const bankWidth = (count: number, span: number, venue: VenueProfile): number => {
  const panels = Math.max(1, count) * Math.max(1, span);
  return panels * venue.panel.widthM + (panels - 1) * venue.bezelM;
};

/**
 * Lay out a bank of `count` touch frames of `span` panels on one wall. `side` places it in a
 * corner (0 to the left of the corner, 1 to its right); null centres it on x = 0.
 */
export const bankLayout = (
  count: number,
  span: number,
  side: 0 | 1 | null = null,
  venue: VenueProfile = activeVenue(),
): BankLayout => {
  const n = Math.max(1, Math.round(count));
  const s = Math.max(1, Math.round(span));
  const width = bankWidth(n, s, venue);
  const face = side === 1 ? SIDE : FRONT;
  // Where the bank's left edge is along the wall, measured along `face.right`.
  const start = side === null ? -width / 2 : side === 0 ? -width : 0;
  const at = (along: number, y: number): Vec3 => add(scale(face.right, along), [0, y, 0]);
  const display = s > 1 ? displayFor("pair", s, venue) : venue.panel;
  const pitch = display.widthM + venue.bezelM;
  const frames = Array.from({ length: n }, (_, i) => ({
    origin: at(start + i * pitch, display.bottomM),
    right: face.right,
    up: UP,
    normal: face.normal,
    width: display.widthM,
    height: display.heightM,
  }));
  // The screen spans the bank exactly; its height follows its pixel aspect.
  const sh = (width * venue.screen.height) / venue.screen.width;
  const screen = {
    origin: at(start, venue.screen.bottomM),
    right: face.right,
    up: UP,
    normal: face.normal,
    width,
    height: sh,
  };
  return { frames, screen };
};

const cornerSide = (setup: SetupInfo): 0 | 1 | null =>
  setup.name === "corner" ? (setup.side === 1 ? 1 : 0) : null;

/** The whole display a frame shows, in venue space (not yet trimmed to its stage). */
export const displaySurface = (
  frame: { kind: FrameKind; span?: number },
  setup: SetupInfo,
  opts: PlaceOptions = {},
): Surface => {
  const venue = opts.venue ?? activeVenue();
  const side = cornerSide(setup);
  if (setup.name === "bank" || setup.name === "corner") {
    const bank = bankLayout(setup.count, spanFor(frame, setup, opts), side, venue);
    if (frame.kind === "screen") return bank.screen;
    const pos = clamp(Math.round(setup.pos), 0, bank.frames.length - 1);
    const f = bank.frames[pos];
    if (f && (frame.kind === "panel" || frame.kind === "pair")) return f;
  }
  const d = displayFor(frame.kind, frame.span ?? 1, venue);
  return {
    origin: [-d.widthM / 2, d.bottomM, 0],
    right: FRONT.right,
    up: UP,
    normal: FRONT.normal,
    width: d.widthM,
    height: d.heightM,
  };
};

/**
 * The part of the venue this frame's stage covers. Normally that is its whole display; a stage
 * of a different shape (a resized window, `fit`) keeps the display's metres per venue pixel and
 * its centre, so the scene is never stretched.
 */
export const surfaceOf = (frame: FrameInfo, setup: SetupInfo, opts: PlaceOptions = {}): Surface => {
  const d = displaySurface(frame, setup, opts);
  const unit = frame.unit > 0 ? frame.unit : 1;
  const width = (frame.width / unit) * (d.width / frame.venueWidth);
  const height = (frame.height / unit) * (d.height / frame.venueHeight);
  const centre = add(add(d.origin, scale(d.right, d.width / 2)), scale(d.up, d.height / 2));
  return {
    ...d,
    origin: sub(sub(centre, scale(d.right, width / 2)), scale(d.up, height / 2)),
    width,
    height,
  };
};

/**
 * A shared eye for the setup, the same on every frame of it: adult eye height, in front of the
 * middle of the frames (or of the corner), far enough back to take them all in.
 */
export const defaultEye = (
  frame: { kind: FrameKind; span?: number },
  setup: SetupInfo,
  opts: PlaceOptions = {},
): Vec3 => {
  const venue = opts.venue ?? activeVenue();
  if (setup.name === "bank" || setup.name === "corner") {
    const width = bankWidth(setup.count, spanFor(frame, setup, opts), venue);
    if (setup.name === "corner") {
      const d = clamp(0.5 * width, 2, 6);
      return [-d, EYE_HEIGHT_M, d];
    }
    return [0, EYE_HEIGHT_M, clamp(0.75 * width, 2, 8)];
  }
  const d = displaySurface(frame, setup, opts);
  return [0, EYE_HEIGHT_M, clamp(1.5 * d.width, 1.5, 8)];
};

/** A frame's camera: the eye looking through its surface as through a window. */
export interface WindowView {
  readonly eye: Vec3;
  /** The camera looks along -back, with `up` up and `right` to the right: the surface's axes. */
  readonly right: Vec3;
  readonly up: Vec3;
  readonly back: Vec3;
  /** Edges of the surface on the plane one metre in front of the eye (glFrustum's at near = 1). */
  readonly frustum: { left: number; right: number; bottom: number; top: number };
  /** Metres from the eye to the surface's plane. */
  readonly distance: number;
  /** Column-major projection matrix, WebGL clip space (z from -1 to 1). */
  projection(near: number, far: number): Float32Array;
  /** Column-major camera-to-world matrix. */
  world(): Float32Array;
  /** Column-major world-to-camera matrix. */
  view(): Float32Array;
  /** Stage CSS px of a point in venue space, and its depth in metres, or null behind the eye. */
  toStage(p: Vec3): { x: number; y: number; depth: number } | null;
  /** The ray from the eye through a stage point (CSS px), for picking. `dir` is a unit vector. */
  ray(x: number, y: number): { origin: Vec3; dir: Vec3 };
}

/** The view through `surface` from `eye` onto a stage of `stage` CSS px. */
export const windowView = (
  surface: Surface,
  eye: Vec3,
  stage: { width: number; height: number },
): WindowView => {
  const vr = normalize(surface.right);
  const vu = normalize(surface.up);
  const vn = normalize(surface.normal);
  const va = sub(surface.origin, eye);
  // An eye on or behind the surface has no sensible view; keep it just in front.
  const d = Math.max(1e-3, -dot(va, vn));
  const l = dot(vr, va) / d;
  const r = l + surface.width / d;
  const b = dot(vu, va) / d;
  const t = b + surface.height / d;
  const sw = Math.max(1, stage.width);
  const sh = Math.max(1, stage.height);
  return {
    eye,
    right: vr,
    up: vu,
    back: vn,
    frustum: { left: l, right: r, bottom: b, top: t },
    distance: d,
    projection(near, far) {
      const m = new Float32Array(16);
      m[0] = 2 / (r - l);
      m[5] = 2 / (t - b);
      m[8] = (r + l) / (r - l);
      m[9] = (t + b) / (t - b);
      m[10] = -(far + near) / (far - near);
      m[11] = -1;
      m[14] = (-2 * far * near) / (far - near);
      return m;
    },
    world() {
      // Columns: the camera's axes, then the eye.
      const m = new Float32Array(16);
      m.set(vr, 0);
      m.set(vu, 4);
      m.set(vn, 8);
      m.set(eye, 12);
      m[15] = 1;
      return m;
    },
    view() {
      // The inverse of `world()`: the transposed rotation, then the eye moved to the origin.
      const m = new Float32Array(16);
      for (let i = 0; i < 3; i++) {
        m[i * 4] = vr[i] ?? 0;
        m[i * 4 + 1] = vu[i] ?? 0;
        m[i * 4 + 2] = vn[i] ?? 0;
      }
      m[12] = -dot(vr, eye);
      m[13] = -dot(vu, eye);
      m[14] = -dot(vn, eye);
      m[15] = 1;
      return m;
    },
    toStage(p) {
      const q = sub(p, eye);
      const depth = -dot(q, vn);
      if (depth <= 1e-6) return null;
      const u = (dot(q, vr) / depth - l) / (r - l);
      const v = (dot(q, vu) / depth - b) / (t - b);
      return { x: u * sw, y: (1 - v) * sh, depth };
    },
    ray(x, y) {
      const along = (x / sw) * surface.width;
      const upward = (1 - y / sh) * surface.height;
      const p = add(add(surface.origin, scale(vr, along)), scale(vu, upward));
      return { origin: eye, dir: normalize(sub(p, eye)) };
    },
  };
};

/** This frame's window view, from `eye` or the setup's default eye. */
export const frameView = (
  frame: FrameInfo,
  setup: SetupInfo,
  opts: PlaceOptions & { eye?: Vec3 } = {},
): WindowView =>
  windowView(surfaceOf(frame, setup, opts), opts.eye ?? defaultEye(frame, setup, opts), frame);

/**
 * Point a three.js camera along a window view. Its projection is set here, so never call
 * `updateProjectionMatrix()` on it afterwards; call this again on resize instead.
 */
export const applyToCamera = (
  view: WindowView,
  camera: PerspectiveCamera,
  near: number,
  far: number,
): void => {
  camera.near = near;
  camera.far = far;
  camera.matrix.fromArray(view.world());
  camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
  camera.updateMatrixWorld(true);
  camera.projectionMatrix.fromArray(view.projection(near, far));
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
};
