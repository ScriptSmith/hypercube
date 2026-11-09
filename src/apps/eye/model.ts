/**
 * One eye's state (what visitors set) and what follows from it through the optics: refraction,
 * accommodation, pupil, corrections and each scene layer's defocus. Pure, so tests can check it.
 */
import type { ConditionId, CorrectionId } from "./captions";
import {
  amplitude,
  lengthFor,
  LE_GRAND,
  paramFor,
  pupilDiameter,
  refraction,
  spectaclePower,
} from "./optics";

export type Looking = "near" | "far";
export type Correction = "none" | "glasses" | "contact" | "reading" | "newLens" | "hardLens";

export interface EyeState {
  condition: ConditionId;
  /** Axial length, mm. */
  length: number;
  /** Anterior corneal radius in the horizontal meridian, mm. */
  radius: number;
  age: number;
  /** Light slider, 0 (dim) to 1 (bright sun), on a log scale of luminance. */
  light: number;
  looking: Looking;
  correction: Correction;
  /** The condition's own strength, 0 to 1 (astigmatism, cataract, glaucoma and so on). */
  strength: number;
  /** Glaucoma: 0 what the person may notice, 1 what an eye test maps. Colour: 0 deutan, 1 protan. */
  toggle: 0 | 1;
}

export const RANGE = {
  length: [21, 27],
  radius: [7.2, 8.4],
  age: [5, 75],
  light: [0, 1],
  strength: [0, 1],
} as const;

/** Luminance at the ends of the light slider, cd/m²: a dim night to daylight outdoors. */
export const LUMINANCE = { dim: 0.01, bright: 3000 } as const;
/** Below this the scene is the night picture, with lamps lit. */
export const NIGHT_BELOW = 3;

/** Distances of the scene's layers, metres: a book, a room, a view out of a window. */
export const LAYERS = { near: 0.3, mid: 2.5, far: 60 } as const;
export type LayerId = keyof typeof LAYERS;
export const LAYER_IDS: readonly LayerId[] = ["far", "mid", "near"];

/** Spectacle vertex distance, metres. */
export const VERTEX_M = 0.012;
/** Real lenses come in quarter-dioptre steps. */
export const LENS_STEP = 0.25;

export const luminanceOf = (light: number): number => {
  const k = Math.min(1, Math.max(0, light));
  return (
    10 **
    (Math.log10(LUMINANCE.dim) + k * (Math.log10(LUMINANCE.bright) - Math.log10(LUMINANCE.dim)))
  );
};

export const lightFor = (luminance: number): number =>
  (Math.log10(luminance) - Math.log10(LUMINANCE.dim)) /
  (Math.log10(LUMINANCE.bright) - Math.log10(LUMINANCE.dim));

const TYPICAL_LENGTH = lengthFor(0, LE_GRAND.r1);

/** Each condition's starting state; the typical eye has no refractive error. */
export const defaultState = (condition: ConditionId, light = lightFor(300)): EyeState => {
  const base: EyeState = {
    condition,
    length: TYPICAL_LENGTH,
    radius: LE_GRAND.r1,
    age: 30,
    light,
    looking: "far",
    correction: "none",
    strength: 0.6,
    toggle: 0,
  };
  switch (condition) {
    case "myopia":
      return { ...base, length: lengthFor(-3), age: 15 };
    case "hyperopia":
      return { ...base, length: lengthFor(3), age: 35, looking: "near" };
    case "astigmatism":
      return { ...base, strength: 0.5 };
    case "presbyopia":
      return { ...base, age: 60, looking: "near" };
    case "cataract":
      return { ...base, age: 70 };
    case "glaucoma":
      return { ...base, age: 65 };
    case "amd":
      return { ...base, age: 75, looking: "near" };
    case "diabetic":
      return { ...base, age: 50 };
    case "keratoconus":
      return { ...base, age: 22, strength: 0.7 };
    case "cvd":
      return { ...base, age: 12, strength: 0.7 };
    default:
      return base;
  }
};

/** The corrections a condition offers, in button order. */
export const correctionsFor = (c: ConditionId): readonly Correction[] => {
  switch (c) {
    case "typical":
    case "myopia":
    case "hyperopia":
    case "astigmatism":
      return ["glasses", "contact"];
    case "presbyopia":
      return ["reading"];
    case "cataract":
      return ["newLens"];
    case "keratoconus":
      return ["hardLens"];
    default:
      return [];
  }
};

/** Conditions with a two-way toggle instead of corrections. */
export const togglesFor = (c: ConditionId): readonly [string, string] | null =>
  c === "glaucoma"
    ? ["What they notice", "Eye test map"]
    : c === "cvd"
      ? ["Deutan", "Protan"]
      : null;

/** Conditions whose strength slider shows. */
export const hasStrength = (c: ConditionId): boolean =>
  c === "astigmatism" ||
  c === "cataract" ||
  c === "glaucoma" ||
  c === "amd" ||
  c === "diabetic" ||
  c === "keratoconus" ||
  c === "cvd";

/** How much steeper the vertical meridian is at full astigmatism strength, mm of radius. */
export const ASTIG_MAX_DR = 0.6;
/** Keratoconus at full strength: cylinder (D) and vertical coma (µm over a 5 mm pupil). */
export const CONE = { cylinder: 3, coma: 1.2, pupil: 5 } as const;
/** A rigid lens keeps about a tenth of the corneal astigmatism and 35 % of the higher-order
 * aberrations, with their direction reversed (Swartz 2025). */
export const HARD_LENS = { cylinder: 0.1, coma: -0.35 } as const;

export interface MeridianPair {
  /** Horizontal meridian. */
  h: number;
  /** Vertical meridian. */
  v: number;
}

export interface LayerFocus {
  id: LayerId;
  /** Metres. */
  z: number;
  /** Defocus in each meridian, dioptres: negative when light focuses in front of the retina. */
  defocus: MeridianPair;
}

export interface Derived {
  /** Refraction at the cornea, relaxed, per meridian. */
  refraction: MeridianPair;
  /** Spherical equivalent of the refraction. */
  se: number;
  /** What remains after the correction, per meridian. */
  residual: MeridianPair;
  amplitude: number;
  /** Accommodation in use, dioptres. */
  accommodation: number;
  /** Navarro parameter for that accommodation, for drawing the lens. */
  param: number;
  luminance: number;
  night: boolean;
  pupil: number;
  /** The correcting lens's power per meridian, rounded to quarter dioptres; null without one. */
  lens: { kind: Correction; power: MeridianPair } | null;
  /** Vergence arriving at the cornea from the looked-at layer, per meridian. */
  target: MeridianPair;
  layers: Record<LayerId, LayerFocus>;
  /** Vertical coma, µm at the current pupil (keratoconus), signed: positive trails downward. */
  coma: number;
  /** Corneal radius in the vertical meridian, mm. */
  radiusV: number;
}

const round = (v: number, step = LENS_STEP) => Math.round(v / step) * step;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Vergence at the cornea from an object `z` metres away, through a lens of power F. */
const throughLens = (z: number, kind: Correction, F: number): number => {
  if (kind === "glasses" || kind === "reading") {
    const v = -1 / Math.max(0.05, z - VERTEX_M) + F;
    return v / (1 - VERTEX_M * v);
  }
  if (kind === "contact" || kind === "hardLens") return -1 / z + F;
  return -1 / z;
};

export const derive = (s: EyeState): Derived => {
  const cond = s.condition;
  const astig = cond === "astigmatism" ? ASTIG_MAX_DR * clamp(s.strength, 0, 1) : 0;
  const radiusV = s.radius - astig;
  const newLens = cond === "cataract" && s.correction === "newLens";
  const hard = cond === "keratoconus" && s.correction === "hardLens";
  // An artificial lens is chosen to focus distant light on the retina; it cannot accommodate.
  const rh = newLens ? 0 : refraction(s.length, s.radius);
  let rv = newLens ? 0 : refraction(s.length, radiusV);
  if (cond === "keratoconus") {
    const cyl = CONE.cylinder * clamp(s.strength, 0, 1);
    rv = rh - cyl;
  }
  const amp = newLens ? 0 : amplitude(s.age);

  let lens: Derived["lens"] = null;
  const kind = s.correction;
  if (kind === "glasses" && correctionsFor(cond).includes("glasses")) {
    lens = { kind, power: { h: round(spectaclePower(rh)), v: round(spectaclePower(rv)) } };
  } else if (kind === "contact" && correctionsFor(cond).includes("contact")) {
    lens = { kind, power: { h: round(rh), v: round(rv) } };
  } else if (kind === "hardLens" && hard) {
    // The tear layer under the rigid lens fills in most of the cone's astigmatism.
    const keep = HARD_LENS.cylinder;
    const ph = round(rh);
    lens = { kind, power: { h: ph, v: ph } };
    rv = rh - (rh - rv) * keep;
  } else if (kind === "reading" && correctionsFor(cond).includes("reading")) {
    lens = { kind, power: { h: readingAdd(rh, rv, amp), v: readingAdd(rh, rv, amp) } };
  }
  const se = (rh + rv) / 2;

  const zOf = (id: LayerId) => LAYERS[id];
  const vergence = (z: number): MeridianPair => ({
    h: throughLens(z, lens?.kind ?? "none", lens?.power.h ?? 0),
    v: throughLens(z, lens?.kind ?? "none", lens?.power.v ?? 0),
  });
  const residual: MeridianPair = {
    h: rh - vergence(LAYERS.far * 1e6).h,
    v: rv - vergence(LAYERS.far * 1e6).v,
  };
  const target = vergence(zOf(s.looking === "near" ? "near" : "far"));
  // The eye puts the middle of its focus (the spherical equivalent) on what it looks at.
  const want = se - (target.h + target.v) / 2;
  const acc = clamp(want, 0, amp);
  const layers = {} as Record<LayerId, LayerFocus>;
  for (const id of LAYER_IDS) {
    const v = vergence(zOf(id));
    layers[id] = { id, z: zOf(id), defocus: { h: rh - acc - v.h, v: rv - acc - v.v } };
  }
  const lum = luminanceOf(s.light);
  const pupil = pupilDiameter(lum, s.age);
  let coma = 0;
  if (cond === "keratoconus") {
    coma = CONE.coma * clamp(s.strength, 0, 1) * (pupil / CONE.pupil) ** 3;
    if (hard) coma *= HARD_LENS.coma;
  }
  return {
    refraction: { h: rh, v: rv },
    se,
    residual,
    amplitude: amp,
    accommodation: acc,
    param: newLens ? 0 : paramFor(acc, s.length, s.radius),
    luminance: lum,
    night: lum < NIGHT_BELOW,
    pupil,
    lens,
    target,
    layers,
    coma,
    radiusV,
  };
};

/**
 * Reading glasses: the plus power that lets the eye bring the book into focus with the
 * accommodation it has, rounded up to a quarter dioptre and kept between +0.75 and +3.50 D
 * (typical reading powers are +1.00 to +3.00 D, Greivenkamp 2019).
 */
export const readingAdd = (rh: number, rv: number, amp: number): number => {
  const se = (rh + rv) / 2;
  let lo = -2;
  let hi = 6;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    // Vergence through the lens rises with its power; find where it meets the eye's nearest focus.
    if (se - amp - throughLens(LAYERS.near, "reading", mid) > 0) lo = mid;
    else hi = mid;
  }
  return clamp(Math.ceil(hi / LENS_STEP - 1e-9) * LENS_STEP, 0.75, 3.5);
};

/** Glasses power for display: one number, or the two meridians when they differ. */
export const lensText = (p: MeridianPair): string => {
  const f = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;
  return Math.abs(p.h - p.v) < 0.01 ? `${f(p.h)} D` : `${f(p.h)} / ${f(p.v)} D`;
};

/** Which correction caption applies to a lens, or null. */
export const correctionCaptionId = (s: EyeState): CorrectionId | null => {
  if (s.correction === "glasses") return s.condition === "astigmatism" ? "astigmatism" : "glasses";
  if (s.correction === "contact") return s.condition === "astigmatism" ? "astigmatism" : "contact";
  return null;
};

/** The order conditions appear in on tiles and in a bank's starting gallery. */
export const CONDITION_ORDER: readonly ConditionId[] = [
  "typical",
  "myopia",
  "hyperopia",
  "astigmatism",
  "presbyopia",
  "cataract",
  "glaucoma",
  "amd",
  "diabetic",
  "keratoconus",
  "cvd",
];

/** A bank's untouched frames start on these (pos 0 typical, then the list). */
export const BANK_START: readonly ConditionId[] = [
  "typical",
  "myopia",
  "hyperopia",
  "astigmatism",
  "presbyopia",
  "cataract",
  "glaucoma",
  "amd",
  "cvd",
  "keratoconus",
];

export const bankStart = (pos: number): ConditionId =>
  BANK_START[((pos % BANK_START.length) + BANK_START.length) % BANK_START.length]!;
