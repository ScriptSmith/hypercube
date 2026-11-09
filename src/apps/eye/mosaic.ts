/**
 * The magnified mosaic of rods and cones, drawn with Canvas2D for the inset.
 *
 * - fovea: cones packed tightly with no rods in the middle, rods appearing round it.
 * - retina: further out, many small rods between fewer, larger cones.
 * - disc: the mosaic stopping at the optic disc, where there are no rods or cones.
 * - Colour vision deficiency changes one cone type's pigment colour towards another's and
 *   leaves every cone in place: no holes (Machado 2009's replacement model).
 *
 * S cones are a few per cent of the cones (Kolb, Photoreceptors); the L to M mix varies a lot
 * between people, so an even mix is drawn.
 */
import type { CvdType } from "./colour";

export type MosaicMode = "fovea" | "retina" | "disc";

export const CONE = { L: "#e0705a", M: "#6cbf6a", S: "#5a86e0" } as const;
export const ROD = "#b9bfcc";

const stream = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
};

export const drawMosaic = (
  g: CanvasRenderingContext2D,
  size: number,
  mode: MosaicMode,
  cvd: { type: CvdType; strength: number } | null,
): void => {
  g.clearRect(0, 0, size, size);
  g.fillStyle = "#1a1220";
  g.fillRect(0, 0, size, size);
  const rnd = stream(mode === "fovea" ? 3 : mode === "retina" ? 5 : 9);
  // One cone type's pigment shifts towards the other's: M towards L for deutan, L towards M for
  // protan. The cell stays where it is.
  const shifted = (type: "L" | "M"): string => {
    if (!cvd) return CONE[type];
    const from = CONE[type];
    const to = type === "M" ? CONE.L : CONE.M;
    const k = Math.max(0, Math.min(1, cvd.strength));
    const mix = (a: string, b: string) => {
      const pa = Number.parseInt(a.slice(1), 16);
      const pb = Number.parseInt(b.slice(1), 16);
      const ch = (sh: number) =>
        Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k)
          .toString(16)
          .padStart(2, "0");
      return `#${ch(16)}${ch(8)}${ch(0)}`;
    };
    return (cvd.type === "deutan" && type === "M") || (cvd.type === "protan" && type === "L")
      ? mix(from, to)
      : from;
  };
  const cone = size / 18;
  const c = size / 2;
  const discX = size * 0.78;
  const discR = size * 0.42;
  for (let row = -1; row * cone * 0.87 < size + cone; row++) {
    for (let col = -1; col * cone < size + cone; col++) {
      const x = col * cone + (row % 2 ? cone / 2 : 0);
      const y = row * cone * 0.87;
      if (mode === "disc" && Math.hypot(x - discX, y - c) < discR) continue;
      const r = Math.hypot(x - c, y - c) / (size / 2);
      // Cones thin out and grow from the middle of the fovea outwards; rods fill in between.
      const coneHere = mode === "fovea" ? r < 0.55 || rnd() < 0.5 - r * 0.3 : rnd() < 0.18;
      if (coneHere) {
        const t = rnd();
        const type = t < 0.05 ? "S" : t < 0.52 ? "L" : "M";
        g.fillStyle = type === "S" ? CONE.S : shifted(type);
        const rr = mode === "fovea" ? cone * (0.34 + 0.12 * r) : cone * 0.48;
        g.beginPath();
        g.arc(x + (rnd() - 0.5) * cone * 0.08, y, rr, 0, Math.PI * 2);
        g.fill();
      } else if (mode !== "fovea" || r > 0.55) {
        g.fillStyle = ROD;
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          g.arc(
            x + (rnd() - 0.5) * cone * 0.7,
            y + (rnd() - 0.5) * cone * 0.6,
            cone * 0.16,
            0,
            Math.PI * 2,
          );
          g.fill();
        }
      }
    }
  }
  if (mode === "disc") {
    g.fillStyle = "#f2dfc0";
    g.beginPath();
    g.arc(discX, c, discR, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff8ea";
    g.beginPath();
    g.arc(discX + size * 0.03, c, discR * 0.4, 0, Math.PI * 2);
    g.fill();
  }
};
