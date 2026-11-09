/**
 * What each condition does to a simulated view beyond defocus, and the blur kernels for an eye.
 * Pure, so tests can check it. Kernels come from the optics (kernel.ts); the effects are:
 *
 * - Cataract: straylight from the age norm log(s) = 0.9 + log(1 + (age/65)^4) up towards
 *   posterior subcapsular values (1.48 ± 0.34), both from Gholami 2017. The scattered share of
 *   light grows with 10^(log s - norm), a young eye scattering almost 10 % (Gholami 2017). Also
 *   a little blur, a fade towards grey ("less colourful") and at most a slight warm tint.
 * - Keratoconus: the comet comes from the kernel; a little glare (light sensitivity).
 * - Glaucoma and macular degeneration: strength and mode for the view's soft patches.
 * - Diabetic retinopathy: central blur that comes and goes, and floaters only while the line
 *   that describes them shows.
 * - Colour vision deficiency: the colour matrix (colour.ts).
 */
import { cvdMatrix } from "./colour";
import { type Kernel, kernelFor, tapsFor } from "./kernel";
import { type Derived, type EyeState, LAYER_IDS, type LayerId } from "./model";
import { type Effects, NO_EFFECTS } from "./sight";

/** Straylight norm for clear lenses, log10 s (Gholami 2017, quoting van den Berg). */
export const straylightNorm = (age: number): number => 0.9 + Math.log10(1 + (age / 65) ** 4);
/** The worst straylight shown: posterior subcapsular mean plus one SD (Gholami 2017). */
export const STRAY_MAX = 1.48 + 0.34;
/** Share of light a young eye scatters (Gholami 2017: "almost 10%"). */
export const YOUNG_SCATTER = 0.1;

export const cataractStraylight = (age: number, strength: number): number => {
  const norm = straylightNorm(age);
  return norm + Math.max(0, Math.min(1, strength)) * Math.max(0, STRAY_MAX - norm);
};

/** Extra share of light scattered into a veil, beyond what the same eye would scatter clear. */
export const veilShare = (age: number, strength: number): number => {
  const d = cataractStraylight(age, strength) - straylightNorm(age);
  return Math.min(0.45, Math.max(0, YOUNG_SCATTER * (10 ** d - 1)));
};

/** Diabetic retinopathy's blur that comes and goes, over about nine seconds. */
export const drBlur = (strength: number, time: number): number =>
  strength * (0.55 + 0.45 * Math.sin((2 * Math.PI * time) / 9));

/** The example the macular degeneration view shows, changing every six seconds. */
export const amdExample = (time: number): number => Math.floor(Math.max(0, time) / 6) % 3;

export const effectsFor = (
  s: EyeState,
  time: number,
  opts: { floaters: boolean; typical?: boolean },
): Effects => {
  if (opts.typical) return NO_EFFECTS;
  const k = Math.max(0, Math.min(1, s.strength));
  switch (s.condition) {
    case "cataract": {
      if (s.correction === "newLens") return NO_EFFECTS;
      return {
        ...NO_EFFECTS,
        veil: veilShare(s.age, k),
        halo: k,
        haze: 0.04 + 0.22 * k,
        fade: 0.22 * k,
        tint: [1, 1 - 0.03 * k, 1 - 0.08 * k],
      };
    }
    case "keratoconus":
      return { ...NO_EFFECTS, veil: 0.05 * k, halo: 0.4 * k };
    case "glaucoma":
      return { ...NO_EFFECTS, glaucoma: k, glaucomaMap: s.toggle };
    case "amd":
      return { ...NO_EFFECTS, amd: k, amdMode: amdExample(time) };
    case "diabetic":
      return { ...NO_EFFECTS, dr: drBlur(k, time), floaters: opts.floaters ? k : 0 };
    case "cvd":
      return { ...NO_EFFECTS, cvd: cvdMatrix(s.toggle === 1 ? "protan" : "deutan", k) };
    default:
      return NO_EFFECTS;
  }
};

/**
 * Each layer's kernel for a view `widthPx` wide showing `fov` degrees: fewer taps when the
 * kernel is under a few pixels.
 */
export const kernelsFor = (d: Derived, widthPx: number, fov: number): [Kernel, Kernel, Kernel] => {
  const pxPerDeg = widthPx / fov;
  const one = (id: LayerId): Kernel => {
    const f = d.layers[id].defocus;
    const full = kernelFor(f.h, f.v, d.pupil, d.coma, 64);
    return kernelFor(f.h, f.v, d.pupil, d.coma, tapsFor(Math.max(full.rx, full.ry) * 2 * pxPerDeg));
  };
  const [far, mid, near] = LAYER_IDS.map(one) as [Kernel, Kernel, Kernel];
  return [far, mid, near];
};

/** A key for a set of kernels, so a view re-blurs only when they change by a quarter pixel. */
export const kernelKey = (ks: readonly Kernel[], widthPx: number, fov: number): string => {
  const q = (v: number) => Math.round(((v * widthPx) / fov) * 4);
  return ks.map((k) => `${k.count}:${q(k.rx)}:${q(k.ry)}:${q(k.taps[1] ?? 0)}`).join("|");
};
