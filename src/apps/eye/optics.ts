/**
 * The schematic eye and the relations the exhibit computes. No rendering here, so tests can
 * check it.
 *
 * - A paraxial four-surface eye with Le Grand's numbers (Greivenkamp 2019), with Navarro's
 *   accommodation equations integrated from Le Grand's unaccommodated values, and the axial
 *   length and anterior corneal radius free.
 * - Refraction R: the vergence at the cornea, in dioptres, that the relaxed eye focuses on the
 *   retina; negative is short sight.
 * - Objective accommodation by age, Anderson 2008; never Hofstetter's push-up curves.
 * - Far and near points and corrections (Greivenkamp 2019), the blur disc (Strasburger 2018)
 *   and the pupil (Watson and Yellott, as restated by Zandi 2020).
 *
 * Distances are millimetres unless a name says otherwise; vergences and powers are dioptres.
 */

/** Le Grand's full theoretical eye, unaccommodated (after Greivenkamp 2019). */
export const LE_GRAND = {
  /** Anterior and posterior cornea, anterior and posterior lens radii. */
  r1: 7.8,
  r2: 6.5,
  r3: 10.2,
  r4: -6.0,
  /** Index after each surface: cornea, aqueous, lens, vitreous. */
  n1: 1.3771,
  n2: 1.3374,
  n3: 1.42,
  n4: 1.336,
  /** Corneal thickness, anterior chamber depth (from the posterior cornea), lens thickness. */
  t1: 0.55,
  t2: 3.05,
  t3: 4.0,
} as const;

/** Lens shape for a Navarro accommodation parameter `a` (integrated rates). */
export interface LensShape {
  /** Anterior chamber depth from the posterior cornea. */
  acd: number;
  thickness: number;
  r3: number;
  r4: number;
  index: number;
}

export const navarro = (a: number): LensShape => {
  const k = Math.log(Math.max(0, a) + 1);
  const p = Math.max(0, a);
  return {
    acd: LE_GRAND.t2 - 0.05 * k,
    thickness: LE_GRAND.t3 + 0.1 * k,
    r3: LE_GRAND.r3 - 1.75 * k,
    r4: LE_GRAND.r4 + 0.23 * k,
    index: LE_GRAND.n3 + 0.00009 * (10 * p + p * p),
  };
};

export interface Surface {
  /** Power, dioptres. */
  power: number;
  /** Distance to the next surface, mm (0 after the last). */
  gap: number;
  /** Index after the surface. */
  index: number;
  /** Position of the vertex from the corneal apex, mm. */
  at: number;
  radius: number;
}

/** The four refracting surfaces for anterior corneal radius `r1` and Navarro parameter `a`. */
export const surfaces = (r1: number, a = 0): Surface[] => {
  const lens = navarro(a);
  const { n1, n2, n4, r2, t1 } = LE_GRAND;
  const n3 = lens.index;
  const p = (n: number, np: number, r: number) => ((np - n) / r) * 1000;
  return [
    { power: p(1, n1, r1), gap: t1, index: n1, at: 0, radius: r1 },
    { power: p(n1, n2, r2), gap: lens.acd, index: n2, at: t1, radius: r2 },
    {
      power: p(n2, n3, lens.r3),
      gap: lens.thickness,
      index: n3,
      at: t1 + lens.acd,
      radius: lens.r3,
    },
    {
      power: p(n3, n4, lens.r4),
      gap: 0,
      index: n4,
      at: t1 + lens.acd + lens.thickness,
      radius: lens.r4,
    },
  ];
};

/** Vergence after transferring `gap` mm through index `n`: V / (1 - (d/n) V). */
const transfer = (v: number, gap: number, n: number) => v / (1 - (gap / 1000 / n) * v);
const untransfer = (v: number, gap: number, n: number) => v / (1 + (gap / 1000 / n) * v);

/**
 * Where light arriving at the cornea with vergence `v0` focuses, in mm from the corneal apex.
 * Infinity when the light leaves the last surface parallel; negative values are virtual.
 */
export const focusAt = (v0: number, r1: number, a = 0): number => {
  const s = surfaces(r1, a);
  let v = v0;
  for (let i = 0; i < s.length; i++) {
    const surf = s[i]!;
    v += surf.power;
    if (i < s.length - 1) v = transfer(v, surf.gap, surf.index);
  }
  const last = s[s.length - 1]!;
  if (Math.abs(v) < 1e-9) return Number.POSITIVE_INFINITY;
  return last.at + (LE_GRAND.n4 / v) * 1000;
};

/** Refraction at the cornea for axial length `L` (mm), corneal radius `r1` and Navarro `a`. */
export const refraction = (L: number, r1: number, a = 0): number => {
  const s = surfaces(r1, a);
  const last = s[s.length - 1]!;
  const vitreous = (L - last.at) / 1000;
  let v = LE_GRAND.n4 / vitreous;
  for (let i = s.length - 1; i >= 0; i--) {
    const surf = s[i]!;
    v -= surf.power;
    if (i > 0) {
      const prev = s[i - 1]!;
      v = untransfer(v, prev.gap, prev.index);
    }
  }
  return v;
};

/** Equivalent power of the whole eye, dioptres (Le Grand: 59.9). */
export const eyePower = (r1: number, a = 0): number => {
  const s = surfaces(r1, a);
  // A paraxial ray in at height 1, parallel to the axis: power = -(n'u') / y at the start.
  let y = 1;
  let nu = 0;
  for (let i = 0; i < s.length; i++) {
    const surf = s[i]!;
    nu -= y * surf.power;
    if (i < s.length - 1) y += (surf.gap / 1000) * (nu / surf.index);
  }
  return -nu;
};

/** Equivalent power of the lens in situ (thick lens), dioptres (Le Grand: 21.78). */
export const lensPower = (a = 0): number => {
  const s = surfaces(LE_GRAND.r1, a);
  const p3 = s[2]!.power;
  const p4 = s[3]!.power;
  return p3 + p4 - (s[2]!.gap / 1000 / s[2]!.index) * p3 * p4;
};

/** Axial length that focuses distant light on the retina for this cornea (Le Grand: 24.197). */
export const emmetropicLength = (r1 = LE_GRAND.r1): number => focusAt(0, r1, 0);

/** Axial length giving refraction `R` with corneal radius `r1`, by bisection. */
export const lengthFor = (R: number, r1 = LE_GRAND.r1): number => {
  let lo = 15;
  let hi = 35;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    // Refraction falls as the eye lengthens.
    if (refraction(mid, r1) > R) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/** Anterior corneal radius giving refraction `R` at axial length `L`, by bisection. */
export const radiusFor = (R: number, L: number): number => {
  let lo = 5;
  let hi = 12;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    // A flatter cornea (larger radius) is more long-sighted.
    if (refraction(L, mid) < R) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/** Real accommodation, dioptres at the cornea, for Navarro parameter `a`. */
export const accommodationOf = (a: number, L: number, r1: number): number =>
  refraction(L, r1, 0) - refraction(L, r1, a);

/** The Navarro parameter that gives `dioptres` of real accommodation, by bisection. */
export const paramFor = (dioptres: number, L: number, r1: number): number => {
  if (dioptres <= 0) return 0;
  let lo = 0;
  let hi = 20;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (accommodationOf(mid, L, r1) < dioptres) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/** Objective accommodative amplitude by age, Anderson 2008. */
export const amplitude = (age: number): number =>
  7.083 / (1 + Math.exp(0.2031 * (age - 36.2) - 0.6109));

/** Far point distance in metres: -1/R for R < 0, Infinity otherwise (virtual). */
export const farPoint = (R: number): number => (R < 0 ? -1 / R : Number.POSITIVE_INFINITY);

/** Near point distance in metres: 1/(A - R) when A > R, else Infinity. */
export const nearPoint = (R: number, A: number): number =>
  A > R ? 1 / (A - R) : Number.POSITIVE_INFINITY;

/** Spectacle power for ocular refraction K at vertex distance d metres: K / (1 + dK). */
export const spectaclePower = (K: number, d = 0.012): number => K / (1 + d * K);

/** Ocular refraction for spectacle power F at vertex distance d metres: F / (1 - dF). */
export const ocularPower = (F: number, d = 0.012): number => F / (1 - d * F);

/** Blur disc for defocus `dioptres` and entrance pupil `pupilMm`, degrees (Strasburger 2018). */
export const discDeg = (dioptres: number, pupilMm: number): number =>
  0.057 * pupilMm * Math.abs(dioptres);

/** Best-focus kernel, about 1 arcmin. */
export const BEST_FOCUS_DEG = 1 / 60;
/** Below this defocus the disc blends towards the best-focus kernel. */
export const BLEND_D = 0.3;

/**
 * Blur diameter in degrees, the geometric disc above about 0.3 D blending below it to a small
 * fixed best-focus kernel rather than pretending a perfect eye is perfectly sharp.
 */
export const blurDeg = (dioptres: number, pupilMm: number): number => {
  const d = Math.abs(dioptres);
  const at = Math.max(BEST_FOCUS_DEG, discDeg(BLEND_D, pupilMm));
  if (d >= BLEND_D) return Math.max(BEST_FOCUS_DEG, discDeg(d, pupilMm));
  return BEST_FOCUS_DEG + (at - BEST_FOCUS_DEG) * (d / BLEND_D);
};

/**
 * The defocus that, put through the plain disc formula, gives `blurDeg`'s diameter, with the
 * sign of `dioptres`. Kernels built from wavefronts use it so their defocus blends the same way.
 */
export const effectiveDefocus = (dioptres: number, pupilMm: number): number => {
  const sign = dioptres < 0 ? -1 : 1;
  return (sign * blurDeg(dioptres, pupilMm)) / (0.057 * Math.max(0.1, pupilMm));
};

/** Area of a circular field `deg` across, square degrees. The pupil's default is 60 degrees. */
export const fieldArea = (deg: number): number => Math.PI * (deg / 2) ** 2;

/**
 * Pupil diameter, mm, from Watson and Yellott's unified formula as restated by Zandi 2020:
 * luminance in cd/m², field area in deg², both eyes (e = 1). The age term was fitted to adults,
 * so children use the 20-year value.
 */
export const pupilDiameter = (
  luminance: number,
  age: number,
  area = fieldArea(60),
  eyes: 1 | 2 = 2,
): number => {
  const e = eyes === 2 ? 1 : 0.1;
  const F = Math.max(0, luminance) * area * e;
  const x = (F / 846) ** 0.41;
  const sd = 7.75 - (5.75 * x) / (x + 2);
  const y = Math.max(20, age);
  return sd + (y - 28.58) * (0.02132 - 0.009562 * sd);
};

/** Paraxial ray through the eye, for drawing: height (mm) at each surface and at the end plane. */
export interface RayPath {
  /** [x mm from the corneal apex, height mm] from the start plane to the end plane. */
  points: [number, number][];
}

/**
 * Trace a paraxial ray that starts at plane `x0` (mm, negative is in front of the eye) with
 * height `y0` (mm) and slope `u0` (height per mm, in air), through `extra` thin lenses in front
 * of the eye (power dioptres at position mm) and the eye's four surfaces, ending at plane `x1`.
 * Surfaces bend the ray at their vertex planes (paraxial), which keeps every ray of a bundle
 * meeting at the computed focus.
 */
export const traceRay = (
  y0: number,
  u0: number,
  x0: number,
  x1: number,
  r1: number,
  a: number,
  extra: readonly { at: number; power: number }[] = [],
  /** Extra power on this ray at the anterior cornea, dioptres (irregular corneas). */
  cornealExtra = 0,
): RayPath => {
  const s = surfaces(r1, a);
  const bends: { at: number; power: number; index: number }[] = [
    ...extra.map((e) => ({ at: e.at, power: e.power, index: 1 })),
    ...s.map((surf, i) => ({
      at: surf.at,
      power: surf.power + (i === 0 ? cornealExtra : 0),
      index: surf.index,
    })),
  ].sort((p, q) => p.at - q.at);
  const points: [number, number][] = [[x0, y0]];
  let x = x0;
  let y = y0;
  let n = 1;
  // Reduced slope n·u, with u in mm per mm.
  let nu = u0;
  for (const b of bends) {
    if (b.at < x0 || b.at > x1) continue;
    y += (b.at - x) * (nu / n);
    x = b.at;
    points.push([x, y]);
    // n'u' = nu - y P, with y in metres and u dimensionless: mm cancel against m by 1e-3.
    nu -= y * b.power * 1e-3;
    n = b.index;
  }
  y += (x1 - x) * (nu / n);
  points.push([x1, y]);
  return { points };
};
