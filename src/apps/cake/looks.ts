/**
 * The cakes: what each one's skin is, its glaze's colour, translucency, gloss and runniness,
 * and what sits on top. Colours are linear.
 */
import type { GlazeKind } from "./glaze";

export type CakeId = "pudding" | "chocolate" | "strawberry" | "galaxy" | "rocky";
export const CAKES: readonly CakeId[] = ["pudding", "chocolate", "strawberry", "galaxy", "rocky"];
export type Rgb = readonly [number, number, number];

/** What the skin bake draws. */
export const BODY = {
  pudding: 0,
  chocolateSponge: 1,
  vanillaSponge: 2,
  glazedMousse: 3,
  rockyRoad: 4,
} as const;
/** What sits in the glaze on top. */
export const TOPPING = { none: 0, chocolate: 1, rainbow: 2 } as const;

export interface CakeLook {
  body: number;
  /** How the glaze flows. */
  kind: GlazeKind;
  glaze: Rgb;
  /** Tint of a thin layer of glaze over the cake. */
  thin: Rgb;
  /** How opaque the glaze is per unit of thickness, when old and when fresh. */
  opacity: readonly [number, number];
  /** Strength of the glaze's mirror reflections. */
  gloss: number;
  /** Colour the glaze from the marbling bake rather than `glaze`. */
  marble: boolean;
  topping: number;
  holly: boolean;
  /** How far pieces standing out of the cake push through glaze that is thin over them. */
  poke: number;
  /** How much the glaze's surface follows the lumps of the cake under it. */
  drape: number;
  /** How strongly the skin's lumps are shaded by the light above whoever looks. */
  relief: number;
}

const ICING: Rgb = [0.68, 0.64, 0.55];
const SMOOTH = { poke: 0, drape: 0.03, relief: 0 };
const CUSTARD: Rgb = [0.86, 0.64, 0.22];

export const lookOf = (cake: CakeId, puddingGlaze: "icing" | "custard"): CakeLook => {
  switch (cake) {
    case "chocolate":
      return {
        body: BODY.chocolateSponge,
        kind: "ganache",
        glaze: [0.024, 0.01, 0.0055],
        thin: [1.3, 1, 0.8],
        opacity: [2.2, 5],
        gloss: 1.25,
        marble: false,
        topping: TOPPING.chocolate,
        holly: false,
        ...SMOOTH,
      };
    case "strawberry":
      return {
        body: BODY.vanillaSponge,
        kind: "pink",
        glaze: [0.78, 0.27, 0.36],
        thin: [1, 0.85, 0.85],
        opacity: [0.9, 3],
        gloss: 1.1,
        marble: false,
        topping: TOPPING.rainbow,
        holly: false,
        ...SMOOTH,
      };
    case "galaxy":
      return {
        body: BODY.glazedMousse,
        kind: "mirror",
        glaze: [0.1, 0.07, 0.3],
        thin: [0.85, 0.85, 1],
        opacity: [1.4, 3.2],
        gloss: 1.25,
        marble: true,
        topping: TOPPING.none,
        holly: false,
        ...SMOOTH,
      };
    case "rocky":
      // A pour of melted dark chocolate over set milk chocolate: darker and glossier than the
      // cake, the pieces under it pushing through where it runs thin.
      return {
        body: BODY.rockyRoad,
        kind: "chocolate",
        glaze: [0.045, 0.016, 0.007],
        thin: [1.5, 1.1, 0.9],
        opacity: [2.4, 5.5],
        gloss: 0.85,
        marble: false,
        topping: TOPPING.none,
        holly: false,
        poke: 0.5,
        drape: 0.5,
        relief: 0.6,
      };
    default:
      return {
        body: BODY.pudding,
        kind: puddingGlaze === "custard" ? "custard" : "icing",
        glaze: puddingGlaze === "custard" ? CUSTARD : ICING,
        // Icing goes grey over the dark pudding; custard stays warm.
        thin: puddingGlaze === "custard" ? [1, 0.94, 0.8] : [0.82, 0.88, 0.96],
        opacity: [0.7, 2.6],
        gloss: 1,
        marble: false,
        topping: TOPPING.none,
        holly: true,
        ...SMOOTH,
        relief: 0.6,
      };
  }
};

/** The pudding's crumb, from its darkest to where light catches it: a reddish mahogany. */
export const CRUMB = { dark: [0.03, 0.0065, 0.0028], light: [0.12, 0.028, 0.009] } as const;
/** The rocky road's set milk chocolate. */
export const MILK_CHOCOLATE = { dark: [0.085, 0.03, 0.012], light: [0.14, 0.055, 0.022] } as const;

/** Chocolate sprinkles: dark and milk chocolate. */
export const CHOCOLATE_SPRINKLES: readonly Rgb[] = [
  [0.012, 0.005, 0.003],
  [0.02, 0.008, 0.004],
  [0.05, 0.021, 0.01],
];

/** Rainbow sprinkles. */
export const RAINBOW_SPRINKLES: readonly Rgb[] = [
  [0.55, 0.03, 0.03],
  [0.62, 0.2, 0.02],
  [0.66, 0.5, 0.04],
  [0.07, 0.36, 0.06],
  [0.04, 0.13, 0.52],
  [0.22, 0.05, 0.38],
  [0.62, 0.6, 0.56],
  [0.72, 0.18, 0.34],
];
