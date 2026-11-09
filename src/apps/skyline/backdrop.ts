/** Stars and a hazy distant city behind the cranes: made once per size, redrawn as night falls. */
import { type G, mix, rgba } from "./art";

interface FarBuilding {
  x: number;
  w: number;
  h: number;
  windows: { x: number; y: number }[];
}

export interface Backdrop {
  stars: { x: number; y: number; r: number }[];
  far: FarBuilding[];
  ground: number;
}

/** `share` is how much of the sky the distant city may fill; `scale` sizes its pieces. */
export const makeBackdrop = (
  width: number,
  ground: number,
  share: number,
  scale: number,
  rand: () => number,
): Backdrop => {
  const stars = Array.from(
    { length: Math.min(400, Math.round((width * ground) / 60_000) + 20) },
    () => ({
      x: rand() * width,
      y: rand() * ground * 0.8,
      r: (1.5 + rand() * 2.5) * scale,
    }),
  );
  const far: FarBuilding[] = [];
  let x = -rand() * 80 * scale;
  const maxH = ground * share;
  while (x < width && far.length < 200) {
    const w = (60 + rand() * 160) * scale;
    const h = maxH * (0.25 + rand() * 0.75);
    const windows: { x: number; y: number }[] = [];
    const step = 26 * scale;
    for (let wy = 18 * scale; wy < h - 10 * scale && windows.length < 60; wy += step) {
      for (let wx = 10 * scale; wx < w - 10 * scale; wx += 22 * scale) {
        if (rand() < 0.35) windows.push({ x: wx, y: wy });
      }
    }
    far.push({ x, w, h, windows });
    x += w + rand() * 24 * scale;
  }
  return { stars, far, ground };
};

export const drawBackdrop = (g: G, b: Backdrop, night: number, scale: number) => {
  if (night > 0.05) {
    g.fillStyle = rgba("#ffffff", 0.75 * night);
    for (const s of b.stars) {
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Hazy and low in contrast, so the cranes' own buildings stand out.
  g.fillStyle = mix("#4d6c98", "#121a30", night);
  g.globalAlpha = 0.32;
  for (const f of b.far) g.fillRect(f.x, b.ground - f.h, f.w, f.h);
  if (night > 0.2) {
    g.globalAlpha = 0.4 * night;
    g.fillStyle = "#ffd88a";
    for (const f of b.far) {
      for (const w of f.windows) g.fillRect(f.x + w.x, b.ground - f.h + w.y, 7 * scale, 9 * scale);
    }
  }
  g.globalAlpha = 1;
};
