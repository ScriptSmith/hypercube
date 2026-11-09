/**
 * The detector's face, flat on the poster: the curved strip unrolled (true to its shape, a long
 * thin band) or the flat plate, with the angles its edges see and the spots that land on it.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { COLOR } from "../../config";
import { roundRect } from "../../controls";
import { glow, label, line } from "../../draw";
import type { Rect } from "../../layout";
import { type Detector, detectorHeight, detectorWidth } from "../../machine";
import type { FaceRing } from "../../machine3d";

export interface FaceSpot {
  fu: number;
  fv: number;
  /** 0 to 1: a fresh flash is 1, a trail fades towards 0. */
  level: number;
}

/** Where the face goes in `r`: its rect, and the 2θ of its left and right edges. */
export const faceRect = (
  r: Rect,
  det: Detector,
  arm: number,
  size: number,
): { face: Rect; from: number; to: number } => {
  const padX = r.width * 0.05;
  const scaleH = size * 1.9;
  if (det.kind === "strip") {
    const span = detectorWidth(det);
    const w = r.width - 2 * padX;
    const arc = (det.distance * span * Math.PI) / 180;
    const h = Math.max(16, (w * detectorHeight(det)) / arc);
    const y = r.y + (r.height - scaleH - h) / 2;
    return {
      face: { x: r.x + padX, y, width: w, height: h },
      from: arm - span / 2,
      to: arm + span / 2,
    };
  }
  const H = detectorHeight(det);
  const W = detectorWidth(det);
  const h = r.height - scaleH - size;
  const w = (h * W) / H;
  const half = (Math.atan(W / 2 / det.distance) * 180) / Math.PI;
  return {
    face: { x: r.x + (r.width - w) / 2, y: r.y + size * 0.5, width: w, height: h },
    from: arm - half,
    to: arm + half,
  };
};

export const drawFace = (
  g: CanvasRenderingContext2D,
  r: Rect,
  o: {
    det: Detector;
    arm: number;
    spots: readonly FaceSpot[];
    rings: readonly FaceRing[];
    size: number;
    /** Radius of a fresh flash's glow; its trail glows smaller. Default from the face's width. */
    glow?: number;
  },
): Rect => {
  const { face, from, to } = faceRect(r, o.det, o.arm, o.size);
  g.save();
  roundRect(g, face, Math.min(8, face.height / 2));
  g.fillStyle = withAlpha(COLOR.real, 0.12);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = withAlpha(COLOR.real, 0.8);
  g.stroke();
  g.restore();
  const X = (fu: number) => face.x + (fu + 0.5) * face.width;
  // Up the face is +z, towards the room: drawn upwards.
  const Y = (fv: number) => face.y + (0.5 - fv) * face.height;
  // Angles along the bottom edge.
  const y0 = face.y + face.height + o.size * 0.4;
  // As many angle labels as fit at about three and a half of their sizes apart.
  const room = Math.max(1, face.width / (o.size * 3.4));
  const step = [5, 10, 20, 30, 45, 90].find((st) => (to - from) / st <= room) ?? 90;
  for (let a = Math.ceil(from / step) * step; a <= to + 1e-6; a += step) {
    const x = face.x + ((a - from) / (to - from)) * face.width;
    line(g, x, face.y + face.height, x, y0, withAlpha(COLOR.ink, 0.35), 2);
    label(g, `${Math.round(a)}°`, x, y0 + o.size * 0.6, {
      size: o.size * 0.8,
      color: COLOR.muted,
      weight: 600,
    });
  }
  g.save();
  g.lineWidth = 4;
  g.strokeStyle = COLOR.recip;
  for (const ring of o.rings) {
    g.globalAlpha = 0.4 + 0.6 * Math.min(1, ring.height / 60);
    for (const run of ring.runs) {
      g.beginPath();
      run.forEach((p, i) => (i === 0 ? g.moveTo(X(p.fu), Y(p.fv)) : g.lineTo(X(p.fu), Y(p.fv))));
      g.stroke();
    }
  }
  g.restore();
  const big = o.glow ?? Math.max(18, Math.min(60, face.width * 0.035));
  for (const s of o.spots) {
    if (s.level <= 0.01) continue;
    glow(g, X(s.fu), Y(s.fv), big * (0.4 + 0.6 * s.level), COLOR.recip, Math.min(1, s.level * 1.3));
    // A fresh flash gets a wide halo too, so it reads across the room.
    if (s.level > 0.5) glow(g, X(s.fu), Y(s.fv), big * 1.7, COLOR.recip, 0.45 * s.level);
  }
  // A firm dot at each spot, so where it landed stays clear inside the glow.
  for (const s of o.spots) {
    if (s.level <= 0.01) continue;
    g.save();
    g.globalAlpha = Math.min(1, s.level * 2);
    g.fillStyle = s.level > 0.9 ? "#ffffff" : COLOR.recip;
    g.beginPath();
    g.arc(X(s.fu), Y(s.fv), Math.max(5, big * 0.09), 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  return face;
};

/**
 * The machine from the side, for a big picture: the beam in from the left, the sample, the arm
 * and the detector (the strip's arc round the sample, or the plate at the arm's end), every point
 * on or near the sphere as a magenta ray from the sample, glowing where it lands.
 */
export const drawSide = (
  g: CanvasRenderingContext2D,
  r: Rect,
  o: {
    det: Detector;
    arm: number;
    omega: number;
    lit: readonly { psi: number; hit: unknown; strength: number }[];
  },
): void => {
  const s = Math.min(r.width, r.height);
  const cx = r.x + r.width * 0.42;
  const cy = r.y + r.height * 0.64;
  const R = s * 0.42;
  const DEGR = Math.PI / 180;
  const P = (deg: number, rad: number) => ({
    x: cx + rad * Math.cos(deg * DEGR),
    y: cy - rad * Math.sin(deg * DEGR),
  });
  // The beam, and its carrying on past the sample.
  line(g, r.x + s * 0.04, cy, cx, cy, COLOR.beam, Math.max(6, s * 0.012));
  line(g, cx, cy, r.x + r.width - s * 0.04, cy, withAlpha(COLOR.beam, 0.3), Math.max(4, s * 0.008));
  // The detector.
  g.save();
  g.lineCap = "round";
  g.strokeStyle = withAlpha(COLOR.real, 0.85);
  g.lineWidth = Math.max(10, s * 0.022);
  g.beginPath();
  if (o.det.kind === "strip") {
    const half = detectorWidth(o.det) / 2;
    g.arc(cx, cy, R, -(o.arm + half) * DEGR, -(o.arm - half) * DEGR);
  } else {
    const half = (Math.atan(detectorWidth(o.det) / 2 / o.det.distance) * 180) / Math.PI;
    const a = P(o.arm - half, R);
    const b = P(o.arm + half, R);
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
  }
  g.stroke();
  g.restore();
  // The arm.
  const end = P(o.arm, R * 0.96);
  line(g, cx, cy, end.x, end.y, withAlpha(COLOR.muted, 0.7), Math.max(6, s * 0.01), [
    s * 0.02,
    s * 0.015,
  ]);
  // Rays: bright where they land on the detector, faint where they miss it.
  for (const l of o.lit) {
    const a = l.strength * (l.hit ? 1 : 0.35);
    const tip = P(l.psi, R);
    g.save();
    g.globalAlpha = Math.min(1, a);
    line(g, cx, cy, tip.x, tip.y, COLOR.scattered, Math.max(4, s * 0.008));
    g.restore();
    if (l.hit)
      glow(
        g,
        tip.x,
        tip.y,
        s * (0.05 + 0.06 * l.strength),
        COLOR.recip,
        Math.min(1, l.strength * 1.3),
      );
  }
  // The sample on its turn.
  const w = s * 0.06;
  const c = Math.cos(o.omega * DEGR);
  const sn = Math.sin(o.omega * DEGR);
  line(g, cx - c * w, cy + sn * w, cx + c * w, cy - sn * w, COLOR.real, Math.max(10, s * 0.02));
};
