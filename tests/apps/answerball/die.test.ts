import { describe, expect, it } from "vitest";
import {
  EDGE,
  FACE_RADIUS,
  FACES,
  facePose,
  INRADIUS,
  NEIGHBOURS,
  VERTICES,
} from "../../../src/apps/answerball/die";
import { rotationError } from "../../../src/apps/answerball/rotation";
import { apply3, type Vec3 } from "../../../src/core/sphere";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

describe("the die", () => {
  it("is a regular icosahedron", () => {
    expect(VERTICES.length).toBe(12);
    expect(FACES.length).toBe(20);
    for (const v of VERTICES) expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    for (const f of FACES) {
      expect(Math.hypot(...f.normal)).toBeCloseTo(1, 12);
      for (const c of f.corners) expect(dot(VERTICES[c]!, f.normal)).toBeCloseTo(INRADIUS, 12);
      const [a, b, c] = f.corners.map((i) => VERTICES[i]!) as [Vec3, Vec3, Vec3];
      for (const [p, q] of [
        [a, b],
        [b, c],
        [a, c],
      ] as const) {
        expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeCloseTo(EDGE, 12);
      }
    }
    // The faces' normals are all different: no face is counted twice.
    for (let i = 0; i < FACES.length; i++) {
      for (let j = i + 1; j < FACES.length; j++) {
        expect(dot(FACES[i]!.normal, FACES[j]!.normal)).toBeLessThan(0.99);
      }
    }
  });

  it("gives every face three edge neighbours, at the icosahedron's dihedral angle", () => {
    for (let i = 0; i < FACES.length; i++) {
      expect(NEIGHBOURS[i]!.length).toBe(3);
      for (const j of NEIGHBOURS[i]!) {
        expect(NEIGHBOURS[j]).toContain(i);
        // Neighbouring faces' normals are 41.8° apart (180° less the dihedral angle).
        const a = Math.acos(dot(FACES[i]!.normal, FACES[j]!.normal)) * (180 / Math.PI);
        expect(a).toBeCloseTo(41.81, 1);
      }
    }
  });

  it("points each face's text at a corner, reading the right way from outside", () => {
    for (const f of FACES) {
      expect(dot(f.up, f.normal)).toBeCloseTo(0, 12);
      expect(Math.hypot(...f.up)).toBeCloseTo(1, 12);
      // Right, up and out make a right-handed frame, as for someone facing the face.
      const out = cross(f.right, f.up);
      for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(f.normal[k]!, 12);
      const top = VERTICES[f.corners[0]]!;
      const centre: Vec3 = [f.normal[0] * INRADIUS, f.normal[1] * INRADIUS, f.normal[2] * INRADIUS];
      const toTop: Vec3 = [top[0] - centre[0], top[1] - centre[1], top[2] - centre[2]];
      expect(dot(toTop, f.up)).toBeCloseTo(FACE_RADIUS, 12);
      expect(dot(toTop, f.right)).toBeCloseTo(0, 12);
    }
  });

  it("brings any face to the glass with its text at any angle", () => {
    for (let i = 0; i < FACES.length; i++) {
      for (const angle of [0, 0.7, -2.4]) {
        const m = facePose(i, angle);
        expect(rotationError(m)).toBeLessThan(1e-12);
        const out = apply3(m, FACES[i]!.normal);
        expect(out[2]).toBeCloseTo(1, 12);
        const up = apply3(m, FACES[i]!.up);
        expect(up[0]).toBeCloseTo(-Math.sin(angle), 12);
        expect(up[1]).toBeCloseTo(Math.cos(angle), 12);
        // Nothing of the die is further out than the face against the glass.
        for (const v of VERTICES) expect(apply3(m, v)[2]).toBeLessThanOrEqual(INRADIUS + 1e-12);
      }
    }
  });
});
