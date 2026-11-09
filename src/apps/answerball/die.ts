/**
 * The twenty-sided die that floats behind the window: a regular icosahedron with its vertices on
 * a unit sphere, in its own frame. Each face has an outward normal and two directions in its
 * plane for the text printed on it: `up` from the face's centre towards one corner, and `right`,
 * as someone looking at the face from outside sees them. Face coordinates are in units of the
 * face's circumradius, so its corners are at (0, 1) and (±√3/2, -1/2).
 */
import type { Mat3, Vec3 } from "../../core/sphere";

const PHI = (1 + Math.sqrt(5)) / 2;

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Edge length of an icosahedron with circumradius 1. */
export const EDGE = 4 / Math.sqrt(10 + 2 * Math.sqrt(5));
/** Distance from the centre to each face. */
export const INRADIUS = (EDGE * (3 * Math.sqrt(3) + Math.sqrt(15))) / 12;
/** Circumradius of one face. */
export const FACE_RADIUS = EDGE / Math.sqrt(3);

export interface Face {
  normal: Vec3;
  up: Vec3;
  right: Vec3;
  /** Corner indices into `VERTICES`, the first being the one `up` points at. */
  corners: [number, number, number];
}

const rawVertices: Vec3[] = [];
for (const a of [-1, 1]) {
  for (const b of [-PHI, PHI]) {
    rawVertices.push([0, a, b], [a, b, 0], [b, 0, a]);
  }
}

export const VERTICES: readonly Vec3[] = rawVertices.map(norm);

const buildFaces = (): Face[] => {
  const n = VERTICES.length;
  const close = (i: number, j: number) =>
    Math.abs(Math.hypot(...sub(VERTICES[i]!, VERTICES[j]!)) - EDGE) < 1e-6;
  const out: Face[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!close(i, j)) continue;
      for (let k = j + 1; k < n; k++) {
        if (!close(i, k) || !close(j, k)) continue;
        const a = VERTICES[i]!;
        const b = VERTICES[j]!;
        const c = VERTICES[k]!;
        const normal = norm([a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]);
        // The text points at the corner highest in the die's frame, so faces read in a pattern
        // rather than at random when the die turns.
        const corners = [i, j, k].sort((p, q) => VERTICES[q]![1] - VERTICES[p]![1] || p - q) as [
          number,
          number,
          number,
        ];
        const top = VERTICES[corners[0]]!;
        const up = norm(
          sub(top, [
            normal[0] * dot(top, normal),
            normal[1] * dot(top, normal),
            normal[2] * dot(top, normal),
          ]),
        );
        const right = cross(up, normal);
        out.push({ normal, up, right, corners });
      }
    }
  }
  // A fixed order: round the die from top to bottom.
  return out.sort(
    (p, q) =>
      q.normal[1] - p.normal[1] ||
      Math.atan2(p.normal[0], p.normal[2]) - Math.atan2(q.normal[0], q.normal[2]),
  );
};

export const FACES: readonly Face[] = buildFaces();

/** The three faces sharing an edge with each face. */
export const NEIGHBOURS: readonly (readonly number[])[] = FACES.map((f, i) =>
  FACES.flatMap((g, j) =>
    j !== i && g.corners.filter((c) => f.corners.includes(c)).length === 2 ? [j] : [],
  ),
);

/**
 * The die's orientation (die frame to window frame) that puts `face` against the glass, its text
 * up at `angle` radians anticlockwise from the window's up, as seen from outside. The window
 * frame has x to the right and y up for someone outside, and z out through the glass.
 */
export const facePose = (face: number, angle: number): Mat3 => {
  const f = FACES[face]!;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const right: Vec3 = [c, s, 0];
  const up: Vec3 = [-s, c, 0];
  const out: Vec3 = [0, 0, 1];
  // M = [right up out] * [f.right f.up f.normal]^T, row by row.
  const row = (r: number): Vec3 => {
    const a = right[r]!;
    const b = up[r]!;
    const d = out[r]!;
    return [
      a * f.right[0] + b * f.up[0] + d * f.normal[0],
      a * f.right[1] + b * f.up[1] + d * f.normal[1],
      a * f.right[2] + b * f.up[2] + d * f.normal[2],
    ];
  };
  return [...row(0), ...row(1), ...row(2)] as unknown as Mat3;
};
