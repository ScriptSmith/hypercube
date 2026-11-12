import { describe, expect, it } from "vitest";
import {
  BROW,
  browEnd,
  EYE,
  faceFrame,
  fingertips,
  fromPlane,
  HAND,
  handDistance,
  handDistanceAt,
  handPose,
  MOUTH,
  offAxis,
  SALUTE_ANGLE,
  toPlane,
  type Vec2,
} from "../../../src/apps/salute/face";
import { apply3, DEG, direction, type Mat3, type Vec3 } from "../../../src/core/sphere";

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Largest difference between m times its transpose and the identity, and the determinant. */
const orthoError = (m: Mat3) => {
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += m[i * 3 + k]! * m[j * 3 + k]!;
      worst = Math.max(worst, Math.abs(s - (i === j ? 1 : 0)));
    }
  }
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  return { worst, det };
};

const expectVec = (got: Vec3, want: Vec3, digits = 9) => {
  for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i]!, digits);
};

describe("the face plane", () => {
  it("goes to the ball and back", () => {
    for (const q of [
      [0, 0],
      [0.3, 0.09],
      [-0.9, 0.2],
      [1.4, -1.1],
    ] as Vec2[]) {
      const p = fromPlane(q);
      expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1, 12);
      const back = toPlane(p);
      expect(back[0]).toBeCloseTo(q[0], 12);
      expect(back[1]).toBeCloseTo(q[1], 12);
    }
    expectVec(fromPlane([0, 0]), [0, 0, 1]);
    // Two units out is a quarter of the way round, at the edge of the face's own half.
    expect(offAxis([2, 0])).toBeCloseTo(Math.PI / 2, 12);
    // Near the middle a unit is a radian.
    expect(offAxis([0.01, 0])).toBeCloseTo(0.01, 6);
  });

  it("keeps a circle a circle on the ball", () => {
    // A circle on a ball lies in a flat plane, so every point of the ring is in the plane
    // through its first three.
    const c: Vec2 = [-0.5, 0.3];
    const r = 0.2;
    const ring = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return fromPlane([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    });
    const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const u = sub(ring[1]!, ring[0]!);
    const v = sub(ring[2]!, ring[0]!);
    const n: Vec3 = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]);
    for (const p of ring) {
      const d = sub(p, ring[0]!);
      expect(Math.abs(d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) / len).toBeLessThan(1e-12);
    }
  });
});

describe("the face's axes", () => {
  it("is a proper rotation for any bearing, pitch, roll and aim", () => {
    for (const [b, p, r] of [
      [0, 0, 0],
      [1.2, -0.4, 0.1],
      [-3, -Math.PI / 2, 0],
      [2.5, 0.05, -0.06],
    ] as const) {
      for (const aim of [undefined, [-0.16, 0], [-0.16, 0.06]] as (Vec2 | undefined)[]) {
        const e = orthoError(faceFrame(b, p, r, aim));
        expect(e.worst).toBeLessThan(1e-12);
        expect(e.det).toBeCloseTo(1, 12);
      }
    }
  });

  it("points the middle of the face along the bearing and pitch", () => {
    const bearing = 70 * DEG;
    const pitch = -25 * DEG;
    const m = faceFrame(bearing, pitch);
    expectVec(apply3(m, direction(pitch, bearing)), [0, 0, 1]);
    // Further round to the right of someone looking at the ball is the plane's positive x, and
    // higher on the ball is its positive y.
    expect(toPlane(apply3(m, direction(pitch, bearing + 0.2)))[0]).toBeGreaterThan(0.1);
    expect(toPlane(apply3(m, direction(pitch + 0.2, bearing)))[1]).toBeCloseTo(0.2, 2);
    expect(toPlane(apply3(m, direction(pitch + 0.2, bearing)))[0]).toBeCloseTo(0, 9);
  });

  it("faces straight down in a bow, the top of the head towards the bearing", () => {
    const m = faceFrame(40 * DEG, -Math.PI / 2);
    expectVec(apply3(m, [0, -1, 0]), [0, 0, 1]);
    expectVec(apply3(m, direction(0, 40 * DEG)), [0, 1, 0]);
  });

  it("rolls about the way it faces, and aims a chosen point at the people", () => {
    const bearing = -1;
    const pitch = -0.3;
    const rolled = faceFrame(bearing, pitch, 0.1);
    expectVec(apply3(rolled, direction(pitch, bearing)), [0, 0, 1]);
    const up = toPlane(apply3(rolled, direction(pitch + 0.2, bearing)));
    // A positive roll tips the top of the head towards the face's own right.
    expect(Math.atan2(up[0], up[1])).toBeCloseTo(0.1, 2);

    const aim: Vec2 = [-0.16, 0.06];
    const aimed = faceFrame(bearing, pitch, 0, aim);
    const seen = toPlane(apply3(aimed, direction(pitch, bearing)));
    expect(seen[0]).toBeCloseTo(aim[0], 9);
    expect(seen[1]).toBeCloseTo(aim[1], 9);
    // Aiming leaves the head upright: what is above the aimed point is still above it.
    const above = toPlane(apply3(aimed, direction(pitch + 0.1, bearing)));
    expect(above[1]).toBeGreaterThan(aim[1] + 0.08);
    expect(Math.abs(above[0] - aim[0])).toBeLessThan(0.02);
  });
});

describe("the face's layout", () => {
  it("keeps the eyes, brows and mouth within the part of the face people see head on", () => {
    const points: Vec2[] = [
      [EYE.x + EYE.rx, EYE.y],
      [EYE.x, EYE.y + EYE.ry],
      [BROW.outer[0] + BROW.half, BROW.outer[1] + BROW.lift + BROW.half],
      [MOUTH.wide, MOUTH.y],
      [0, MOUTH.y - MOUTH.depth],
    ];
    for (const q of points) expect(offAxis(q) / DEG).toBeLessThan(36);
  });

  it("has brows above the eyes and a mouth below them", () => {
    expect(BROW.inner[1] - BROW.half).toBeGreaterThan(EYE.y + EYE.ry);
    expect(MOUTH.y + MOUTH.half).toBeLessThan(EYE.y - EYE.ry);
    expect(BROW.outer[0]).toBeGreaterThan(BROW.inner[0]);
  });
});

describe("the hand", () => {
  it("is out of sight at rest and full size well before the brow", () => {
    expect(handPose(0).scale).toBe(0);
    expect(handDistanceAt([0, 0], handPose(0))).toBe(Infinity);
    expect(handPose(0.5).scale).toBe(1);
    expect(handPose(1).scale).toBe(1);
    let last = 0;
    for (let r = 0; r <= 1; r += 0.02) {
      const s = handPose(r).scale;
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });

  it("brings its fingertips to the outer end of the brow on the face's right", () => {
    for (const lift of [0, 0.5, 1]) {
      const pose = handPose(1, lift);
      const end = browEnd(lift);
      expect(end[0]).toBeLessThan(0);
      const tips = fingertips(pose);
      expect(dist(tips, end)).toBeLessThan(0.04);
      // Just outside the brow's end, not over it.
      expect(tips[0]).toBeLessThan(end[0]);
      expect(pose.angle).toBeCloseTo(SALUTE_ANGLE, 12);
      // The fingertips are on the hand's outline.
      expect(Math.abs(handDistanceAt(tips, pose))).toBeLessThan(1e-9);
    }
  });

  it("slopes up to the brow from a wrist lower and further out, thumb underneath", () => {
    const pose = handPose(1, 1);
    const tips = fingertips(pose);
    const wrist: Vec2 = [
      pose.x - Math.cos(pose.angle) * HAND.halfLength,
      pose.y - Math.sin(pose.angle) * HAND.halfLength,
    ];
    expect(wrist[0]).toBeLessThan(tips[0] - 0.4);
    expect(wrist[1]).toBeLessThan(tips[1] - 0.3);
    // The thumb's end, in the hand's own coordinates, lies below the hand on the face.
    const c = Math.cos(pose.angle);
    const s = Math.sin(pose.angle);
    const [tx, ty] = HAND.thumbTo;
    const thumb: Vec2 = [pose.x + tx * c - ty * s, pose.y + tx * s + ty * c];
    expect(thumb[1]).toBeLessThan(pose.y);
    expect(handDistanceAt(thumb, pose)).toBeLessThan(0);
  });

  it("stays clear of the eyes and mouth all the way up, and within sight at the brow", () => {
    const eye: Vec2 = [-EYE.x, EYE.y];
    for (let r = 0.02; r <= 1.07; r += 0.01) {
      const pose = handPose(r, r);
      expect(handDistanceAt(eye, pose), `eye at ${r}`).toBeGreaterThan(EYE.rx * 0.6);
      expect(handDistanceAt([-MOUTH.wide, MOUTH.y], pose), `mouth at ${r}`).toBeGreaterThan(0.1);
    }
    // Every part of the saluting hand is on the half of the ball the face is on.
    const pose = handPose(1, 1);
    const c = Math.cos(pose.angle);
    const s = Math.sin(pose.angle);
    for (const [hx, hy] of [
      [-HAND.halfLength, HAND.halfWidth],
      [-HAND.halfLength, -HAND.halfWidth],
      HAND.thumbTo,
    ] as Vec2[]) {
      const q: Vec2 = [pose.x + hx * c - hy * s, pose.y + hx * s + hy * c];
      expect(offAxis(q) / DEG).toBeLessThan(70);
    }
  });

  it("is a flat slab with a shallow arc of fingertips and a thumb on one side", () => {
    expect(handDistance(0, 0)).toBeLessThan(-0.1);
    expect(handDistance(HAND.halfLength, 0)).toBeCloseTo(0, 12);
    expect(handDistance(-HAND.halfLength, 0)).toBeCloseTo(0, 12);
    expect(handDistance(0, HAND.halfWidth)).toBeCloseTo(0, 12);
    // The fingertips' corners are cut back by the arc.
    expect(handDistance(HAND.halfLength - 0.02, HAND.halfWidth - 0.02)).toBeGreaterThan(0);
    // The thumb sticks out on the negative side only.
    expect(handDistance(HAND.thumbTo[0], -HAND.halfWidth - 0.05)).toBeLessThan(0);
    expect(handDistance(HAND.thumbTo[0], HAND.halfWidth + 0.05)).toBeGreaterThan(0);
  });
});
