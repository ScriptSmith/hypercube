/**
 * Space's painted art: a starfield with nebulae for the playfield and the deck, and the
 * textures its models wear (banded planets, cratered moons, the black hole's swirl). All drawn
 * here from seeded noise, so every table and deck looks the same each time.
 */
import { withAlpha } from "../../../../core/ui/palette";

/** A small seeded stream, so the stars are the same on every run. */
export const stream = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/** Deep space over (0, 0)-(w, h): nebula clouds, faint and bright stars, a few with spikes. */
export const paintSpace = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  o: { stars?: number; scale?: number } = {},
) => {
  const rnd = stream(seed);
  const k = o.scale ?? 1;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#050819");
  grad.addColorStop(0.5, "#0a0f2e");
  grad.addColorStop(1, "#04050f");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.save();
  g.globalCompositeOperation = "lighter";
  const clouds = ["#5b2a86", "#1f4f9e", "#0f7a8a", "#8a2f6b", "#2b3fa8"];
  for (let i = 0; i < 9; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (0.18 + rnd() * 0.3) * Math.max(w, h * 0.6);
    const c = clouds[i % clouds.length]!;
    const neb = g.createRadialGradient(x, y, 0, x, y, r);
    neb.addColorStop(0, withAlpha(c, 0.22));
    neb.addColorStop(0.45, withAlpha(c, 0.1));
    neb.addColorStop(1, withAlpha(c, 0));
    g.fillStyle = neb;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();
  const n = o.stars ?? Math.round((w * h) / 900);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const b = rnd();
    const r = (b > 0.985 ? 3.2 : b > 0.93 ? 2 : 1.1) * k;
    g.fillStyle = b > 0.7 ? "#ffffff" : b > 0.4 ? "#cfe0ff" : "#9fb4ff";
    g.globalAlpha = 0.35 + 0.65 * rnd();
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    if (b > 0.985) {
      // A bright star's spikes.
      g.globalAlpha = 0.5;
      g.strokeStyle = "#e8f1ff";
      g.lineWidth = 1.2 * k;
      g.beginPath();
      g.moveTo(x - r * 5, y);
      g.lineTo(x + r * 5, y);
      g.moveTo(x, y - r * 5);
      g.lineTo(x, y + r * 5);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
};

/** A neon ring of dashes, as an insert under a toy. */
export const neonRing = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  width: number,
  dash = 0,
) => {
  g.save();
  g.strokeStyle = withAlpha(color, 0.25);
  g.lineWidth = width * 3;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = withAlpha(color, 0.85);
  g.lineWidth = width;
  if (dash > 0) g.setLineDash([dash, dash * 0.8]);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.restore();
};

/** A neon chevron at (x, y) pointing along angle `a` (radians, y down). */
export const neonArrow = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  a: number,
  size: number,
  color: string,
) => {
  g.save();
  g.translate(x, y);
  g.rotate(a + Math.PI / 2);
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.7, size * 0.5);
  g.lineTo(0, size * 0.15);
  g.lineTo(-size * 0.7, size * 0.5);
  g.closePath();
  g.fillStyle = withAlpha(color, 0.18);
  g.fill();
  g.strokeStyle = withAlpha(color, 0.8);
  g.lineWidth = size * 0.1;
  g.stroke();
  g.restore();
};

/** A gas giant's bands, wrapped round a sphere (u across, v down). */
export const paintPlanet = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  hues: string[],
  seed: number,
) => {
  const rnd = stream(seed);
  let y = 0;
  while (y < h) {
    const bh = h * (0.04 + rnd() * 0.1);
    g.fillStyle = hues[Math.floor(rnd() * hues.length)]!;
    g.fillRect(0, y, w, bh + 1);
    y += bh;
  }
  // Soft streaks along the bands, and a storm.
  for (let i = 0; i < 60; i++) {
    g.fillStyle = withAlpha(rnd() > 0.5 ? "#ffffff" : "#000000", 0.06 + rnd() * 0.06);
    const yy = rnd() * h;
    g.fillRect(rnd() * w, yy, w * (0.2 + rnd() * 0.5), h * 0.012);
  }
  const sx = w * 0.62;
  const sy = h * 0.62;
  const storm = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.08);
  storm.addColorStop(0, withAlpha("#ffffff", 0.45));
  storm.addColorStop(1, withAlpha("#ffffff", 0));
  g.fillStyle = storm;
  g.beginPath();
  g.ellipse(sx, sy, h * 0.14, h * 0.07, 0, 0, Math.PI * 2);
  g.fill();
};

/** A grey moon with craters. */
export const paintMoon = (g: CanvasRenderingContext2D, w: number, h: number, seed: number) => {
  const rnd = stream(seed);
  g.fillStyle = "#9aa0ad";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (0.01 + rnd() * 0.05) * h;
    g.fillStyle = withAlpha("#4a4f5c", 0.5);
    g.beginPath();
    g.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = withAlpha("#d8dce6", 0.35);
    g.beginPath();
    g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.9, r * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  }
};

/** A black hole's accretion disc seen from above: bright inner spiral arms fading outwards. */
export const paintSwirl = (
  g: CanvasRenderingContext2D,
  size: number,
  inner: string,
  outer: string,
) => {
  const c = size / 2;
  g.clearRect(0, 0, size, size);
  const glow = g.createRadialGradient(c, c, c * 0.25, c, c, c);
  glow.addColorStop(0, withAlpha(inner, 0.95));
  glow.addColorStop(0.45, withAlpha(outer, 0.5));
  glow.addColorStop(1, withAlpha(outer, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  g.save();
  g.translate(c, c);
  g.globalCompositeOperation = "lighter";
  for (let arm = 0; arm < 4; arm++) {
    g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const a = arm * (Math.PI / 2) + t * Math.PI * 1.6;
      const r = c * (0.28 + t * 0.68);
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.strokeStyle = withAlpha(inner, 0.55);
    g.lineWidth = size * 0.035;
    g.stroke();
  }
  g.restore();
  // The horizon: black in the middle, edged with light.
  const hole = g.createRadialGradient(c, c, 0, c, c, c * 0.3);
  hole.addColorStop(0, "#000000");
  hole.addColorStop(0.82, "#000000");
  hole.addColorStop(0.9, withAlpha("#ffffff", 0.9));
  hole.addColorStop(1, withAlpha(inner, 0));
  g.fillStyle = hole;
  g.beginPath();
  g.arc(c, c, c * 0.3, 0, Math.PI * 2);
  g.fill();
};

/** A crater for the deck's saucers: a rocky rim round a dark floor. */
export const paintCrater = (g: CanvasRenderingContext2D, size: number, glow: string) => {
  const c = size / 2;
  const rim = g.createRadialGradient(c, c, c * 0.45, c, c, c);
  rim.addColorStop(0, "#0b0b10");
  rim.addColorStop(0.55, "#24252e");
  rim.addColorStop(0.75, "#8d8f9c");
  rim.addColorStop(0.9, "#4a4c57");
  rim.addColorStop(1, "rgba(30,30,40,0)");
  g.fillStyle = rim;
  g.fillRect(0, 0, size, size);
  const in1 = g.createRadialGradient(c, c, 0, c, c, c * 0.5);
  in1.addColorStop(0, withAlpha(glow, 0.35));
  in1.addColorStop(1, withAlpha(glow, 0));
  g.fillStyle = in1;
  g.fillRect(0, 0, size, size);
};
