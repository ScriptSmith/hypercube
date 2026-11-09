/**
 * Iris colours. An iris's colour is melanin in its front layer and stroma over a dark back
 * layer: a lot of it gives brown, a little gives blue or grey by scattering in the stroma, and
 * in between, with some yellow pigment, hazel and green. Brown irises look
 * velvety, with dense pigment hiding the fibres; light ones show their fibres and crypts.
 * Colours are sRGB here and linear once loaded.
 */
import type { Rng } from "../../core/types";

export const IRIS_COLOURS = ["brown", "hazel", "green", "blue", "grey"] as const;
export type IrisColour = (typeof IRIS_COLOURS)[number];

export interface IrisLook {
  /** Stroma between the fibres. */
  base: string;
  /** Fibres and the lighter tissue on top. */
  fibre: string;
  /** The pupillary zone inside the collarette, often a different shade. */
  centre: string;
  /** Inside crypts and furrows, the deeper layers. */
  deep: string;
  /** The dark ring at the iris's edge. */
  ring: string;
  /** How much the fibres stand out, 0 to 1. */
  contrast: number;
  /** How open and dark the crypts are, 0 to 1. */
  crypts: number;
  /** Freckles, 0 to 1. */
  freckles: number;
}

export const LOOKS: Record<IrisColour, IrisLook> = {
  // Close-up photographs: amber in good light, chocolate in dim light; dense pigment hides
  // most of the fibres but not the crypts.
  brown: {
    base: "#3a2416",
    fibre: "#7d5233",
    centre: "#4a2a16",
    deep: "#1a0e08",
    ring: "#120a06",
    contrast: 0.45,
    crypts: 0.75,
    freckles: 0.6,
  },
  hazel: {
    base: "#564a2c",
    fibre: "#a08e56",
    centre: "#7e4a1c",
    deep: "#241a0c",
    ring: "#18140c",
    contrast: 0.6,
    crypts: 0.6,
    freckles: 0.5,
  },
  // Olive and yellow-green, with amber gathered at the collarette.
  green: {
    base: "#4a5332",
    fibre: "#9ca468",
    centre: "#8c662a",
    deep: "#1c2210",
    ring: "#151a0f",
    contrast: 0.7,
    crypts: 0.6,
    freckles: 0.45,
  },
  // Pale slate rather than navy: whitish fibres over a thin, scattering stroma, often with tan
  // round the pupil.
  blue: {
    base: "#4c6178",
    fibre: "#aebdca",
    centre: "#8e8264",
    deep: "#1e2a38",
    ring: "#18202a",
    contrast: 0.8,
    crypts: 0.55,
    freckles: 0.35,
  },
  grey: {
    base: "#566068",
    fibre: "#b9bfc2",
    centre: "#8a8472",
    deep: "#22272c",
    ring: "#181c20",
    contrast: 0.8,
    crypts: 0.55,
    freckles: 0.35,
  },
};

export const IRIS_OPTIONS = [...IRIS_COLOURS, "changes"] as const;
export type IrisOption = (typeof IRIS_OPTIONS)[number];

/** The colour on show and the one it blends towards, for the `changes` option. */
export interface ColourSchedule {
  readonly from: IrisColour;
  readonly to: IrisColour;
  /** 0 shows `from`, 1 shows `to`. */
  readonly mix: number;
  step(dt: number): void;
  set(option: IrisOption): void;
}

/** Seconds a colour shows before the next blend starts, and how long the blend takes. */
export const HOLD = { min: 150, max: 300 };
export const BLEND = 40;

export const createColourSchedule = (rng: Rng, option: IrisOption): ColourSchedule => {
  let mode = option;
  let from: IrisColour = option === "changes" ? rng.pick(IRIS_COLOURS) : option;
  let to = from;
  let mix = 1;
  let hold = rng.range(HOLD.min, HOLD.max);
  return {
    get from() {
      return from;
    },
    get to() {
      return to;
    },
    get mix() {
      return mix;
    },
    step(dt) {
      if (mix < 1) {
        mix = Math.min(1, mix + dt / BLEND);
        return;
      }
      if (mode !== "changes") return;
      hold -= dt;
      if (hold > 0) return;
      from = to;
      const others = IRIS_COLOURS.filter((c) => c !== from);
      to = rng.pick(others);
      mix = 0;
      hold = rng.range(HOLD.min, HOLD.max);
    },
    set(option) {
      mode = option;
      if (option === "changes") return;
      // Blend to a colour admin picks rather than jump.
      if (option === to && mix >= 1) return;
      from = mix >= 0.5 ? to : from;
      to = option;
      mix = from === to ? 1 : 0;
    },
  };
};
