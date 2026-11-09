/**
 * Shapes of the eye for the 3D model, in mm, as profiles about the optical axis: x along the
 * axis from the corneal apex (light travels towards +x), ρ the distance from it. Sizes: a globe
 * about 24 mm across (Bekerman et al. 2014), the cornea 11.7 mm across (Sridhar 2018), scleral
 * thickness 0.5 mm at the front, 0.42 mm at the equator and 0.9 mm at the back, thinning behind
 * the equator in long eyes (Vurgese et al. 2012), the choroid about 0.34 mm under the fovea
 * (Eslava et al. 2024), the retina about 0.1 to 0.32 mm (Kolb, Webvision), the ora serrata
 * about 5 mm in front of the equator (EyeWiki), the macula about 5 mm and the fovea 1.5 mm
 * across (Kolb, Webvision), the optic disc 1.86 by 1.75 mm (Kolb, Webvision) about 15 degrees
 * to the nose side and the nerve 4.5 mm thick (Ominde et al. 2024).
 */
import type { LensShape } from "./optics";

export type P = [number, number];

export const CORNEA_RADIUS = 11.7 / 2;
export const GLOBE_RADIUS = 12;
/** Disc centre from the fovea along the back wall, mm (about 15 degrees, 4.5 mm). */
export const DISC_ARC = 4.3;
export const DISC_RADIUS = 0.9;
export const NERVE_RADIUS = 2.25;
export const MACULA_RADIUS = 2.5;
export const FOVEA_RADIUS = 0.75;

export interface Shell {
  outer: P[];
  inner: P[];
}

export interface Globe {
  /** Axial length: corneal apex to the inner retina at the back. */
  L: number;
  sclera: Shell;
  choroid: Shell;
  retina: Shell;
  /** Where the cornea meets the sclera. */
  limbus: P;
  /** The front edge of the retina and choroid. */
  ora: P;
  equator: P;
  /** The disc's centre on the inner retina, and the inward normal there (both [x, ρ]). */
  disc: { at: P; normal: P };
  /** Where the nerve leaves the outer sclera, and the outward normal. */
  nerve: { at: P; normal: P };
  /** Outer surface radius at axial position x (for placing muscles), 0 beyond the ends. */
  outerAt(x: number): number;
}

const SAMPLES = 64;

/** Scleral thickness along the wall, from the limbus (s = 0) to the back (s = 1). */
const scleraThickness = (s: number, L: number): number => {
  const back = Math.max(0.45, 0.9 - 0.15 * Math.max(0, L - 24.2));
  if (s < 0.45) return 0.5 + (0.42 - 0.5) * (s / 0.45);
  return 0.42 + (back - 0.42) * ((s - 0.45) / 0.55) ** 1.5;
};

const choroidThickness = (L: number) => Math.max(0.15, 0.34 - 0.05 * Math.max(0, L - 24.2));

/** The retina, thinnest in the foveal pit. `fromPole` is the distance along the wall, mm. */
const retinaThickness = (fromPole: number) =>
  fromPole < FOVEA_RADIUS ? 0.12 + 0.12 * (fromPole / FOVEA_RADIUS) ** 2 : 0.24;

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const norm = (a: P): P => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};

/** The outer surface of the globe for axial length L, front (limbus) to back. */
export const globe = (L: number): Globe => {
  // Inner retina at the pole sits at L; the wall's layers stack outwards from there.
  const back = retinaThickness(0) + choroidThickness(L) + scleraThickness(1, L);
  const pole = L + back;
  const xEq = 0.5 * pole + 0.4;
  const R = GLOBE_RADIUS;
  const limbusX = corneaSag(CORNEA_RADIUS, 7.8);
  const limbus: P = [limbusX, CORNEA_RADIUS];
  const aLim = Math.asin(CORNEA_RADIUS / R);
  const bFront = (xEq - limbusX) / Math.cos(aLim);
  const bBack = pole - xEq;
  const outer: P[] = [];
  const normals: P[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const a = aLim + ((Math.PI - aLim) * i) / SAMPLES;
    const b = a < Math.PI / 2 ? bFront : bBack;
    outer.push([xEq - b * Math.cos(a), R * Math.sin(a)]);
    normals.push(norm([-R * Math.cos(a), b * Math.sin(a)]));
  }
  // Arc length from the pole, for the fovea and disc.
  const fromPole: number[] = Array.from({ length: outer.length }, () => 0);
  for (let i = outer.length - 2; i >= 0; i--) {
    const d = sub(outer[i]!, outer[i + 1]!);
    fromPole[i] = fromPole[i + 1]! + Math.hypot(d[0], d[1]);
  }
  const offset = (p: P, n: P, t: number): P => [p[0] - n[0] * t, p[1] - n[1] * t];
  const scleraIn: P[] = outer.map((p, i) =>
    offset(p, normals[i]!, scleraThickness(i / SAMPLES, L)),
  );
  const choroidIn: P[] = scleraIn.map((p, i) => offset(p, normals[i]!, choroidThickness(L)));
  const retinaIn: P[] = choroidIn.map((p, i) =>
    offset(p, normals[i]!, retinaThickness(fromPole[i]! * (L / pole))),
  );
  // Put the inner retina's pole exactly at L (the layers above were measured on the outer wall).
  const shift = L - retinaIn[retinaIn.length - 1]![0];
  for (const p of retinaIn) p[0] += shift * Math.max(0, (p[0] - xEq) / (pole - xEq));
  const oraX = xEq - 5;
  let oraI = 0;
  while (oraI < outer.length - 1 && outer[oraI]![0] < oraX) oraI++;
  const slice = (pts: P[]) => pts.slice(oraI);
  // The disc, DISC_ARC along the inner retina from the pole.
  let di = retinaIn.length - 1;
  let acc = 0;
  while (di > 0 && acc < DISC_ARC) {
    const d = sub(retinaIn[di - 1]!, retinaIn[di]!);
    acc += Math.hypot(d[0], d[1]);
    di--;
  }
  const n = normals[di]!;
  const outerAt = (x: number) => {
    if (x < outer[0]![0] || x > pole) return 0;
    for (let i = 1; i < outer.length; i++) {
      const p = outer[i]!;
      if (p[0] >= x) {
        const q = outer[i - 1]!;
        const t = (x - q[0]) / Math.max(1e-6, p[0] - q[0]);
        return q[1] + (p[1] - q[1]) * t;
      }
    }
    return 0;
  };
  return {
    L,
    sclera: { outer, inner: scleraIn },
    choroid: { outer: slice(scleraIn), inner: slice(choroidIn) },
    retina: { outer: slice(choroidIn), inner: slice(retinaIn) },
    limbus,
    ora: outer[oraI]!,
    equator: [xEq, R],
    disc: { at: retinaIn[di]!, normal: [-n[0], -n[1]] },
    nerve: { at: outer[di]!, normal: n },
    outerAt,
  };
};

/** Sag of a sphere of radius r at height ρ (ρ clamped inside the sphere). */
export const corneaSag = (rho: number, r: number): number => {
  const p = Math.min(Math.abs(rho), Math.abs(r) * 0.999);
  return Math.abs(r) - Math.sqrt(r * r - p * p);
};

export interface LensProfile {
  /** Front surface from the axis to the equator. */
  front: P[];
  /** Back surface from the equator to the axis. */
  back: P[];
  equator: P;
  frontX: number;
  backX: number;
}

/** The crystalline lens for a Navarro shape, front vertex at `frontX`. */
export const lensProfile = (shape: LensShape, frontX: number, n = 24): LensProfile => {
  const backX = frontX + shape.thickness;
  const r3 = shape.r3;
  const r4 = Math.abs(shape.r4);
  const xf = (rho: number) => frontX + corneaSag(rho, r3);
  const xb = (rho: number) => backX - corneaSag(rho, r4);
  // The equator is where the two surfaces meet.
  let lo = 0;
  let hi = Math.min(r3, r4) * 0.999;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (xf(mid) < xb(mid)) lo = mid;
    else hi = mid;
  }
  const re = Math.min(lo, 5.2);
  const front: P[] = [];
  const back: P[] = [];
  for (let i = 0; i <= n; i++) {
    const rho = (re * i) / n;
    front.push([xf(rho), rho]);
  }
  for (let i = n; i >= 0; i--) {
    const rho = (re * i) / n;
    back.push([xb(rho), rho]);
  }
  const ex = (xf(re) + xb(re)) / 2;
  front[front.length - 1] = [ex, re];
  back[0] = [ex, re];
  return { front, back, equator: [ex, re], frontX, backX };
};
