/**
 * What the caption says while someone is using the controls: the fact the state shows best.
 * The tour has captions of its own. Pure.
 */
import { dateOf, nearestSyzygy, norm180, isEclipse, moonLatitude, MOON_INCL } from "./astro";
import type { Variant } from "./config";
import type { Global, Sky } from "./sky";

const near = (lambda: number, at: number, within: number) =>
  Math.abs(norm180(lambda - at)) < within;

export const contextCaption = (
  variant: Variant,
  s: Sky,
  g: Global,
  lat: number,
  incl: number,
): string => {
  if (variant === "moon") {
    for (const kind of ["new", "full"] as const) {
      const at = nearestSyzygy(g.t, kind);
      if (Math.abs(at - g.t) > 1.6) continue;
      const solar = kind === "new";
      if (isEclipse(at, solar ? "solar" : "lunar", incl)) {
        return solar
          ? "Sun, Moon and Earth in line: an eclipse of the Sun"
          : "Sun, Earth and Moon in line: an eclipse of the Moon";
      }
      const above = moonLatitude(at, incl) > 0;
      if (incl < MOON_INCL * 0.5) continue;
      return solar
        ? `The Moon's shadow passes ${above ? "above" : "below"} the Earth`
        : `The Moon passes ${above ? "above" : "below"} the Earth's shadow`;
    }
    if (s.flat) return "A flat orbit would bring an eclipse every new and full Moon";
    const e = g.moon.elong;
    const left = lat < 0 ? "left" : "right";
    const right = lat < 0 ? "right" : "left";
    if (e < 22 || e > 338) return "New Moon: its lit half faces away from us";
    if (e < 158) return `Growing, it is lit on the ${left}`;
    if (e < 202) return "Full Moon: we see all of the lit half";
    return `Shrinking, it is lit on the ${right}`;
  }
  if (s.tilt < 1) return "No tilt, no seasons: 12 h days everywhere";
  if (s.tilt > 80) return "On its side: months of day, then months of night";
  const l = g.lambda;
  if (near(l, 270, 8)) return "Summer in Brisbane: long days, Sun high";
  if (near(l, 90, 8)) return "Winter in Brisbane: short days, Sun low";
  if (near(l, 0, 4) || near(l, 180, 4)) return "Equinox: 12 h days everywhere";
  const d = dateOf(g.t);
  if ((d.month === 11 && d.day >= 26) || (d.month === 0 && d.day <= 16)) {
    return "Nearest the Sun in January: Brisbane's summer";
  }
  if ((d.month === 5 && d.day >= 26) || (d.month === 6 && d.day <= 16)) {
    return "Farthest from the Sun in July: Brisbane's winter";
  }
  return "The axis always points the same way";
};
