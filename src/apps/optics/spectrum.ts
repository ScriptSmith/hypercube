/**
 * Light as seven sample wavelengths, one bit each. A ray carries a bit mask of the wavelengths
 * it holds: white light is all seven, a laser is one, a filter keeps the bits of its band.
 * Crystals, filters and lasers use three broad bands so a child can match them by colour.
 */

/** Sample wavelengths in nm, red to violet. Bit i of a mask is WAVELENGTHS[i]. */
export const WAVELENGTHS = [650, 610, 580, 540, 495, 460, 420] as const;
export const BITS = WAVELENGTHS.length;
export const WHITE = (1 << BITS) - 1;

/** Drawing colour of each sample wavelength. */
export const WAVE_COLOURS = [
  "#ff3d3d",
  "#ff8c1a",
  "#ffe22e",
  "#4dff5c",
  "#2ee8ff",
  "#4a6bff",
  "#a64dff",
] as const;

/** RGB of each sample wavelength, for additive mixing. */
export const WAVE_RGB: readonly (readonly [number, number, number])[] = WAVE_COLOURS.map((c) => {
  const n = Number.parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
});

export type Band = "w" | "r" | "g" | "b";
export type ColourBand = Exclude<Band, "w">;
export const COLOUR_BANDS: readonly ColourBand[] = ["r", "g", "b"];

/** The wavelengths each colour band holds. */
export const BAND_BITS: Readonly<Record<ColourBand, number>> = {
  r: 0b0000011,
  g: 0b0011100,
  b: 0b1100000,
};

/** The single wavelength a laser of each band emits. */
export const LASER_BITS: Readonly<Record<ColourBand, number>> = {
  r: 0b0000001,
  g: 0b0001000,
  b: 0b0100000,
};

/** Display colour of crystals, filters and lasers of each band. */
export const BAND_COLOURS: Readonly<Record<Band, string>> = {
  w: "#f4f8ff",
  r: "#ff5a52",
  g: "#5dff7a",
  b: "#5a8cff",
};

export const popcount = (bits: number): number => {
  let n = 0;
  for (let b = bits; b; b &= b - 1) n++;
  return n;
};

/** Index of the lowest set bit, or -1. */
export const lowBit = (bits: number): number => {
  if (!bits) return -1;
  let i = 0;
  while (!(bits & (1 << i))) i++;
  return i;
};

/** The colour band a mask lies wholly inside, "w" for anything wider. */
export const bandOf = (bits: number): Band => {
  for (const b of COLOUR_BANDS) if (bits && (bits & ~BAND_BITS[b]) === 0) return b;
  return "w";
};

export type Glass = "flint" | "crown";

/**
 * Refractive index by Cauchy's formula, n = A + B / lambda^2 with lambda in micrometres.
 * Crown glass is about A = 1.50, B = 0.0042 um^2, which spreads white light by only a degree
 * or two in a prism. The prisms here use eight times that B so the rainbow fans out across a
 * panel (about 11 degrees from a 60 degree prism). Lenses use a fixed index of 1.5 and no
 * dispersion: real lenses fringe a little, but a white bundle should reach its focus white.
 */
export const CAUCHY_A = 1.5;
export const CAUCHY_B_REAL = 0.0042;
export const PRISM_B = CAUCHY_B_REAL * 8;
export const LENS_INDEX = 1.5;

export const indexOf = (glass: Glass, bit: number): number => {
  if (glass === "crown") return LENS_INDEX;
  const um = (WAVELENGTHS[bit] ?? 550) / 1000;
  return CAUCHY_A + PRISM_B / (um * um);
};

/** Whether light of mask `bits` splits into separate wavelengths in this glass. */
export const disperses = (glass: Glass): boolean => glass === "flint";

/**
 * How much a ray of `bits` at `level` lights a crystal of `band`. A white crystal takes any
 * light, weighted by the share of the spectrum the ray holds, so one wavelength of a rainbow
 * counts a seventh. A coloured crystal takes only light wholly inside its band.
 */
export const crystalShare = (band: Band, bits: number, level: number): number => {
  if (band === "w") return (level * popcount(bits)) / BITS;
  const bb = BAND_BITS[band];
  if (!bits || bits & ~bb) return 0;
  return (level * popcount(bits)) / popcount(bb);
};

/** CSS colour of a mask: the additive mix of its wavelengths, normalised to full brightness. */
export const maskColour = (bits: number): string => {
  if (bits === WHITE) return "#ffffff";
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < BITS; i++) {
    if (!(bits & (1 << i))) continue;
    const c = WAVE_RGB[i]!;
    r += c[0];
    g += c[1];
    b += c[2];
  }
  const m = Math.max(r, g, b, 1);
  const k = 255 / m;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
};
