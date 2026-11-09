/**
 * The inside of the globe in design metres: a ball of radius `R`, centred on its centre, y up.
 * The whole interior is scaled to the real ball, so a bigger ball gets a bigger scene.
 *
 * Every scene stands on the same kind of mound: a snowy top dome over a steep rocky flank whose
 * foot rests on the bottom of the glass. Between the flank and the glass is a trough where loose
 * snow piles up against the glass, which is what people underneath see grow.
 */
export const R = 2.5;
/** Flakes keep this far inside the glass. */
export const GLASS_MARGIN = 0.035;

/** Where the foot meets the glass: 60° below the equator. */
export const FOOT_LAT = (-60 * Math.PI) / 180;
export const FOOT_Y = R * Math.sin(FOOT_LAT);
export const FOOT_RHO = R * Math.cos(FOOT_LAT);
/** The top edge of the flank, where the snowy top begins. */
export const RIM_Y = -1.62;
export const RIM_RHO = 1.5;
/** Height of the dome's middle above the rim, before a scene's own hills. */
export const DOME = 0.37;
export const TOP_Y = RIM_Y + DOME;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Radius of the glass at height `y`. */
export const glassRho = (y: number): number => Math.sqrt(Math.max(0, R * R - y * y));

/** Radius of the flank at height `y`, from the foot up to the rim; it leans out a little. */
export const flankRho = (y: number): number => {
  const s = clamp01((y - FOOT_Y) / (RIM_Y - FOOT_Y));
  return FOOT_RHO + (RIM_RHO - FOOT_RHO) * Math.pow(s, 0.7);
};

/** The plain dome's height at radius `rho` on the top. */
export const domeY = (rho: number): number =>
  RIM_Y + DOME * (1 - Math.pow(Math.min(1, rho / RIM_RHO), 2.5));

/** How much a scene's own hills count at radius `rho`: fully inside, none at the rim. */
export const hillWeight = (rho: number): number => smoothstep(RIM_RHO, RIM_RHO - 0.3, rho);

/** A scene's ground: the dome plus its hills, for radii up to the rim. */
export type Hills = (x: number, z: number) => number;

export const groundY = (hills: Hills, x: number, z: number): number => {
  const rho = Math.hypot(x, z);
  return domeY(rho) + hillWeight(rho) * hills(x, z);
};

/** Volume of the trough from the foot up to height `y`, per radian of azimuth (m³/rad). */
export const troughVolume = (y: number): number => {
  const top = Math.min(y, RIM_Y);
  if (top <= FOOT_Y) return 0;
  const steps = 48;
  const h = (top - FOOT_Y) / steps;
  let v = 0;
  for (let i = 0; i < steps; i++) {
    const yy = FOOT_Y + (i + 0.5) * h;
    const g = glassRho(yy);
    const f = flankRho(yy);
    v += 0.5 * Math.max(0, g * g - f * f) * h;
  }
  return v;
};
