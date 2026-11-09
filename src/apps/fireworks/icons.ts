/**
 * Button icons on a 100 x 100 grid. Shapes are drawn as dotted outlines, the way the bursts
 * draw them in the sky, so the button shows what will happen.
 */
import { COLORS, MIXED, SHAPE, type ShapeId } from "./recipe";

const dots = (pts: [number, number][], r: number, fill: string) =>
  pts
    .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}"/>`)
    .join("");

const ring = (n: number, radius: number, cx = 50, cy = 50, phase = 0): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
  });

/** Points along a closed curve given by `f(t)` for t in [0, 1), evenly by parameter. */
const along = (n: number, f: (t: number) => [number, number]): [number, number][] =>
  Array.from({ length: n }, (_, i) => f(i / n));

const heartPt = (t: number): [number, number] => {
  const a = t * Math.PI * 2;
  const x = 16 * Math.sin(a) ** 3;
  const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
  return [50 + x * 2.3, 47 - y * 2.3];
};

const starPt = (t: number): [number, number] => {
  const e = t * 10;
  const i = Math.floor(e);
  const f = e - i;
  const a0 = -Math.PI / 2 + i * (Math.PI / 5);
  const a1 = a0 + Math.PI / 5;
  const r0 = i % 2 === 0 ? 40 : 17;
  const r1 = i % 2 === 0 ? 17 : 40;
  const x = Math.cos(a0) * r0 * (1 - f) + Math.cos(a1) * r1 * f;
  const y = Math.sin(a0) * r0 * (1 - f) + Math.sin(a1) * r1 * f;
  return [50 + x, 53 + y];
};

const flowerPt = (t: number): [number, number] => {
  const a = t * Math.PI;
  const r = Math.cos(5 * a) * 40;
  return [50 + r * Math.cos(a + Math.PI / 2), 50 - r * Math.sin(a + Math.PI / 2)];
};

export const shapeIcon = (shape: ShapeId, color: string): string => {
  const c = color;
  let body = "";
  switch (shape) {
    case SHAPE.peony:
      body =
        dots(ring(12, 38), 5.5, c) +
        dots(ring(8, 22, 50, 50, 0.4), 4.5, c) +
        dots([[50, 50]], 5, "#fff");
      break;
    case SHAPE.ring:
      body = dots(ring(16, 36), 5, c);
      break;
    case SHAPE.willow:
      body = Array.from({ length: 7 }, (_, i) => {
        const a = -Math.PI + (i / 6) * Math.PI;
        const x1 = 50 + Math.cos(a) * 30;
        const y1 = 40 + Math.sin(a) * 20;
        const x2 = 50 + Math.cos(a) * 40;
        return `<path d="M50 40 Q${x1.toFixed(1)} ${y1.toFixed(1)} ${x2.toFixed(1)} 88" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 8"/>`;
      }).join("");
      break;
    case SHAPE.palm:
      body = Array.from({ length: 6 }, (_, i) => {
        const a = -Math.PI / 2 + ((i - 2.5) / 6) * Math.PI * 1.7;
        const x = 50 + Math.cos(a) * 40;
        const y = 52 + Math.sin(a) * 34;
        return `<path d="M50 52 Q${(50 + Math.cos(a) * 28).toFixed(1)} ${(46 + Math.sin(a) * 34).toFixed(1)} ${x.toFixed(1)} ${(y + 14).toFixed(1)}" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>`;
      }).join("");
      break;
    case SHAPE.crossette:
      body = [0, 1, 2, 3]
        .map((i) => {
          const a = Math.PI / 4 + (i * Math.PI) / 2;
          const x = 50 + Math.cos(a) * 26;
          const y = 50 + Math.sin(a) * 26;
          const tips = [-0.7, 0.7]
            .map((d) => {
              const b = a + d;
              return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + Math.cos(b) * 16).toFixed(1)}" y2="${(y + Math.sin(b) * 16).toFixed(1)}"/>`;
            })
            .join("");
          return `<line x1="50" y1="50" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>${tips}`;
        })
        .join("");
      body = `<g stroke="${c}" stroke-width="6" stroke-linecap="round">${body}</g>`;
      break;
    case SHAPE.heart:
      body = dots(along(26, heartPt), 4.5, c);
      break;
    case SHAPE.star:
      body = dots(along(30, starPt), 4.2, c);
      break;
    case SHAPE.smiley:
      body =
        dots(ring(22, 38), 4.2, c) +
        dots(
          [
            [36, 40],
            [64, 40],
          ],
          6,
          c,
        ) +
        dots(
          Array.from({ length: 7 }, (_, i) => {
            const a = Math.PI * 0.2 + (i / 6) * Math.PI * 0.6;
            return [50 + Math.cos(a) * 22, 50 + Math.sin(a) * 22] as [number, number];
          }),
          4.2,
          c,
        );
      break;
    case SHAPE.flower:
      body = dots(along(30, flowerPt), 4.2, c) + dots([[50, 50]], 7, "#fff");
      break;
    default:
      body = dots(ring(12, 36), 5, c);
  }
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">${body}</svg>`;
};

/** A disc of the colour, ringed by the choices with the current one larger. */
export const colorIcon = (color: number): string => {
  const fill =
    color >= MIXED
      ? COLORS.map((c, i) => {
          const a0 = (i / COLORS.length) * Math.PI * 2 - Math.PI / 2;
          const a1 = ((i + 1) / COLORS.length) * Math.PI * 2 - Math.PI / 2;
          const p = (a: number) =>
            `${(50 + Math.cos(a) * 30).toFixed(2)} ${(50 + Math.sin(a) * 30).toFixed(2)}`;
          return `<path d="M50 50 L${p(a0)} A30 30 0 0 1 ${p(a1)} Z" fill="${c.hex}"/>`;
        }).join("")
      : `<circle cx="50" cy="50" r="30" fill="${COLORS[color]?.hex ?? "#fff"}"/>`;
  const choices = Array.from({ length: COLORS.length + 1 }, (_, i) => {
    const a = -Math.PI / 2 + (i / (COLORS.length + 1)) * Math.PI * 2;
    const x = 50 + Math.cos(a) * 43;
    const y = 50 + Math.sin(a) * 43;
    const hex = i >= COLORS.length ? "#ffffff" : (COLORS[i]?.hex ?? "#fff");
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === color ? 6.5 : 3.2}" fill="${hex}" opacity="${i === color ? 1 : 0.55}"/>`;
  }).join("");
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">${fill}${choices}</svg>`;
};

/** How high: three steps, the chosen one and those below it lit. */
export const sizeIcon = (size: number, color: string): string => {
  const level = size < 0.25 ? 0 : size < 0.75 ? 1 : 2;
  const steps = [0, 1, 2]
    .map((i) => {
      const y = 76 - i * 26;
      const r = 8 + i * 3.5;
      const on = i <= level;
      return `<circle cx="50" cy="${y}" r="${r}" fill="${on ? color : "none"}" stroke="${color}" stroke-width="3.5" opacity="${on ? 1 : 0.45}"/>`;
    })
    .join("");
  const burst = dots(ring(8, 9 + level * 4, 50, 76 - level * 26), 2.4, "#fff");
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">${steps}${level === 2 ? burst : ""}</svg>`;
};

/** The mortar tube, drawn upright with its base at the bottom centre. */
export const tubeSvg = (color: string, id: string): string =>
  `<svg viewBox="0 0 60 140" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">` +
  `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#1a2133"/><stop offset="0.45" stop-color="#5b6680"/><stop offset="1" stop-color="#151b29"/></linearGradient></defs>` +
  `<rect x="6" y="8" width="48" height="128" rx="6" fill="url(#${id})" stroke="#8b97b3" stroke-width="2"/>` +
  `<rect x="2" y="2" width="56" height="14" rx="5" fill="#2a3247" stroke="#a8b3cc" stroke-width="2"/>` +
  `<rect x="10" y="60" width="40" height="7" rx="3" fill="${color}" opacity="0.9"/>` +
  `<rect x="10" y="104" width="40" height="7" rx="3" fill="${color}" opacity="0.6"/>` +
  `</svg>`;

/** An upward chevron over the tube, for attract. */
export const upArrow = (color: string): string =>
  `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">` +
  `<path d="M22 62 L50 34 L78 62" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</svg>`;
