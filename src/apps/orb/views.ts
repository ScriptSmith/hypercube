/**
 * Who the orb is drawn for. Positions are in ball units: the orb's centre at the origin, radius
 * 1, y up, longitude 0 towards +z, as in `core/sphere`.
 *
 * As in `SectorViews`, each point of the glass shows the smoke as seen by whichever of a few
 * viewers sees that point most squarely, blended where two meet: six people standing round the
 * orb a sixth of a turn apart, someone underneath, and one overhead for the cap nobody sees.
 * (With only three round it, the glass between them near the top is seen edge on, and the smoke
 * there comes out thin.)
 * A viewer standing near one of them sees true depth. (Tracing each point from someone at its
 * own bearing instead would smear the smoke round the orb in bands, because every ray would then
 * pass the axis.) The viewers drift slowly round, so the joins never stay in one place.
 *
 * Every other viewer round the orb, a third of a turn apart, and the one underneath also see a
 * vision when one shows, in a round window through the orb's centre that faces them. While it
 * shows they take a little more of the glass from their neighbours, so the window is never cut,
 * and the smoke between the windows hides their edges.
 */
import type { Vec3 } from "../../core/sphere";
import type { SphereInfo } from "../../core/types";

/** Viewers round the orb with windows; as many again stand between them without. */
export const AROUND = 3;
/** Everyone: those round the orb, underneath and overhead. */
export const VIEWERS = 2 * AROUND + 2;
export const EYE_M = 1.6;
/** Viewers round the orb stand this many radii from the spot under its centre. */
export const DISTANCE_R = 4;
/** The overhead viewer, radii above the centre. */
export const ABOVE_R = 4;
/** One underneath when nobody can stand there, radii below the centre. */
export const VIRTUAL_BELOW_R = 1.5;
/** How much more squarely a viewer with a window counts while a vision shows, at most. */
export const WINDOW_BIAS = 0.2;
/** The window's radius, ball units, out to where the smoke has closed over it. */
export const WINDOW_R = 0.74;
/** How sharply one view gives way to the next where they meet. */
export const SHARPNESS = 18;
/** Views weighing less than this at a point are left out there. */
export const MIN_WEIGHT = 0.02;
/** How fast the viewers drift round, radians a second: once round in about 26 minutes. */
export const BEARING_RATE = 0.004;
/**
 * The picture seen from underneath turns this many times faster, once in about five minutes, so
 * it comes upright in turn for everyone standing under the orb whichever way they face.
 */
export const BELOW_TURN = 5;

export interface Viewer {
  eye: Vec3;
  /** From the centre towards the eye. */
  normal: Vec3;
  /** The picture's right and up in the window, which lies across the centre facing the eye. */
  right: Vec3;
  up: Vec3;
  /** Whether a vision shows to this viewer. */
  window: boolean;
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Eye height in ball units. */
export const eyeY = (s: SphereInfo): number => (EYE_M - s.centreY) / s.radius;

/** Whether the orb hangs high enough for someone to stand underneath and look up into it. */
export const hasBelow = (s: SphereInfo): boolean => s.centreY - s.radius > EYE_M + 0.3;

/** Which way the first viewer round the orb stands at `t` seconds. */
export const bearingAt = (t: number): number => (t * BEARING_RATE) % (2 * Math.PI);

/**
 * The viewers when the first one round the orb stands at longitude `bearing`: the three with
 * windows, the one underneath, the three between those round about, then the one overhead. The
 * first three or four have windows (four when someone can stand underneath).
 */
export const viewersFor = (s: SphereInfo, bearing: number): Viewer[] => {
  const h = eyeY(s);
  const ring = (a: number, window: boolean): Viewer => {
    const eye: Vec3 = [DISTANCE_R * Math.sin(a), h, DISTANCE_R * Math.cos(a)];
    const normal = norm(eye);
    const right = norm(cross([0, 1, 0], normal));
    return { eye, normal, right, up: cross(normal, right), window };
  };
  const step = (2 * Math.PI) / AROUND;
  const out: Viewer[] = [];
  for (let i = 0; i < AROUND; i++) out.push(ring(bearing + i * step, true));
  const below = hasBelow(s);
  const turn = bearing * BELOW_TURN;
  const right: Vec3 = [Math.cos(turn), 0, -Math.sin(turn)];
  const down: Vec3 = [0, -1, 0];
  out.push({
    eye: [0, below ? h : -VIRTUAL_BELOW_R, 0],
    normal: down,
    right,
    up: cross(down, right),
    window: below,
  });
  for (let i = 0; i < AROUND; i++) out.push(ring(bearing + (i + 0.5) * step, false));
  const upward: Vec3 = [0, 1, 0];
  out.push({
    eye: [0, ABOVE_R, 0],
    normal: upward,
    right,
    up: cross(upward, right),
    window: false,
  });
  return out;
};

/** How squarely the viewer at `eye` sees the surface point `n`: 1 face on, 0 edge on. */
export const facing = (n: Vec3, eye: Vec3): number =>
  dot(n, norm([eye[0] - n[0], eye[1] - n[1], eye[2] - n[2]]));

/**
 * Where the line from `v`'s eye through surface point `n` crosses the window, in window radii
 * (the picture's right and up), or null when the point is on the far side for that viewer.
 */
export const windowPoint = (v: Viewer, n: Vec3): [number, number] | null => {
  const d = norm([n[0] - v.eye[0], n[1] - v.eye[1], n[2] - v.eye[2]]);
  const across = dot(v.normal, d);
  if (across >= -1e-6) return null;
  const s = -dot(v.normal, n) / across;
  if (s < 0) return null;
  const hit: Vec3 = [n[0] + d[0] * s, n[1] + d[1] * s, n[2] + d[2] * s];
  return [dot(hit, v.right) / WINDOW_R, dot(hit, v.up) / WINDOW_R];
};

/**
 * Each viewer's share of surface point `n`, as the shaders weigh them, summing to 1; `part` is
 * how far a vision has opened.
 */
export const viewWeights = (vs: readonly Viewer[], n: Vec3, part = 0): number[] => {
  const f = vs.map((v) => facing(n, v.eye) + (v.window ? WINDOW_BIAS * part : 0));
  const best = Math.max(...f);
  const e = f.map((x) => {
    const w = Math.exp(SHARPNESS * (x - best));
    return w < MIN_WEIGHT ? 0 : w;
  });
  const total = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / total);
};
