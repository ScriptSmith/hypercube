import { dot, stroke, type Icon } from "../icons";

/** Original drawings for the solar system, from basic shapes in a 64 by 64 box. */
const ball = (r = 20) => dot(32, 32, r, "#fff");

const craters = (bg: string, spots: [number, number, number][]) =>
  spots.map(([x, y, r]) => dot(x, y, r, bg)).join("");

const bands = (bg: string) =>
  stroke("M14 24 H50", 3.2, bg) + stroke("M12 33 H52", 3.2, bg) + stroke("M14 42 H50", 3.2, bg);

const ringed = (bg: string, r: number) =>
  ball(r) +
  `<ellipse cx="32" cy="34" rx="29" ry="8" transform="rotate(-18 32 34)" fill="none" stroke="${bg}" stroke-width="6"/>` +
  `<ellipse cx="32" cy="34" rx="29" ry="8" transform="rotate(-18 32 34)" fill="none" stroke="#fff" stroke-width="3"/>`;

const lumpy = (bg: string, spots: [number, number, number][]) =>
  `<path d="M12 34 C10 22 22 14 34 15 C47 14 54 24 52 36 C50 48 38 52 28 50 C18 50 13 43 12 34Z" fill="#fff"/>` +
  craters(bg, spots);

export const SOLAR_ICONS = {
  sun: () => {
    let rays = "";
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const p = (r: number) => `${(32 + c * r).toFixed(1)} ${(32 + s * r).toFixed(1)}`;
      rays += stroke(`M${p(21)} L${p(29)}`, 3.4);
    }
    return rays + ball(14);
  },
  mercury: (bg: string) =>
    ball(17) +
    craters(bg, [
      [26, 26, 4],
      [40, 33, 3.4],
      [28, 41, 3],
      [38, 22, 2],
    ]),
  venus: (bg: string) =>
    ball() +
    stroke("M14 26 C22 20 28 32 36 26 C42 22 46 26 50 24", 3, bg) +
    stroke("M12 36 C20 30 28 42 36 36 C44 30 48 38 52 34", 3, bg) +
    stroke("M16 45 C24 40 30 49 38 44 C43 41 46 44 48 43", 3, bg),
  earth: (bg: string) =>
    ball() +
    `<path d="M20 20 C28 16 34 20 32 26 C30 32 22 30 20 36 C16 30 16 24 20 20Z" fill="${bg}"/>` +
    `<path d="M38 34 C46 32 50 38 46 46 C42 50 38 44 36 40Z" fill="${bg}"/>`,
  mars: (bg: string) =>
    ball(18) +
    craters(bg, [
      [24, 34, 4],
      [38, 40, 3],
      [40, 26, 2.6],
    ]) +
    `<path d="M24 17 C30 14 36 14 42 17 C38 20 28 20 24 17Z" fill="${bg}"/>`,
  jupiter: (bg: string) =>
    ball(24) + bands(bg) + `<ellipse cx="38" cy="38" rx="4.5" ry="3" fill="${bg}"/>`,
  saturn: (bg: string) => ringed(bg, 15),
  uranus: (bg: string) =>
    ball(15) +
    `<ellipse cx="32" cy="32" rx="4" ry="29" transform="rotate(8 32 32)" fill="none" stroke="${bg}" stroke-width="5"/>` +
    `<ellipse cx="32" cy="32" rx="4" ry="29" transform="rotate(8 32 32)" fill="none" stroke="#fff" stroke-width="2.4"/>`,
  neptune: (bg: string) =>
    ball(20) +
    stroke("M16 28 C24 24 30 30 38 26 C44 24 46 26 49 25", 3, bg) +
    stroke("M16 40 C24 36 30 42 38 38", 3, bg) +
    `<ellipse cx="36" cy="33" rx="4" ry="2.6" fill="${bg}"/>`,
  ceres: (bg: string) =>
    ball(14) +
    craters(bg, [
      [28, 28, 3],
      [37, 36, 3.6],
    ]) +
    dot(50, 14, 2.4, "#fff") +
    dot(14, 50, 2, "#fff") +
    dot(52, 48, 1.8, "#fff"),
  pluto: (bg: string) =>
    ball(13) +
    `<path d="M24 28 C30 24 36 27 34 33 C32 38 25 36 24 28Z" fill="${bg}"/>` +
    stroke("M32 6 A26 26 0 0 1 58 32", 2.4) +
    dot(58, 32, 2.6, "#fff"),
  moon: (bg: string) =>
    ball(18) +
    craters(bg, [
      [25, 27, 4.4],
      [39, 24, 2.6],
      [38, 38, 5],
      [25, 41, 2.6],
    ]),
  phobos: (bg: string) =>
    lumpy(bg, [
      [26, 30, 4],
      [40, 36, 3],
    ]),
  deimos: (bg: string) =>
    lumpy(bg, [
      [32, 28, 2.4],
      [38, 40, 2],
    ]),
  io: (bg: string) =>
    ball(19) +
    dot(26, 28, 3.6, bg) +
    dot(40, 24, 2.4, bg) +
    dot(38, 40, 4.2, bg) +
    dot(24, 42, 2.4, bg),
  europa: (bg: string) =>
    ball(19) +
    stroke("M16 26 L30 32 L46 24", 2, bg) +
    stroke("M18 42 L32 34 L48 44", 2, bg) +
    stroke("M32 14 L30 32 L34 50", 2, bg),
  ganymede: (bg: string) =>
    ball(21) +
    craters(bg, [
      [24, 26, 5],
      [40, 36, 6],
      [26, 42, 3],
    ]) +
    stroke("M30 14 C36 24 34 30 40 22", 2, bg),
  callisto: (bg: string) =>
    ball(19) +
    craters(bg, [
      [24, 24, 2.6],
      [36, 22, 2],
      [42, 32, 3.4],
      [28, 34, 3],
      [34, 44, 2.6],
      [22, 42, 2],
    ]),
  titan: (bg: string) =>
    `<circle cx="32" cy="32" r="25" fill="none" stroke="#fff" stroke-width="2.6" stroke-dasharray="3 4"/>` +
    ball(17) +
    stroke("M18 29 C26 25 36 33 46 28", 2.6, bg) +
    stroke("M18 38 C26 34 36 42 46 37", 2.6, bg),
  enceladus: (bg: string) =>
    `<circle cx="32" cy="40" r="15" fill="#fff"/>` +
    dot(26, 42, 2.4, bg) +
    stroke("M22 18 L26 26 M32 12 L32 24 M42 18 L38 26", 3) +
    dot(22, 15, 1.8, "#fff") +
    dot(32, 9, 1.8, "#fff") +
    dot(42, 15, 1.8, "#fff"),
  rhea: (bg: string) =>
    ball(18) +
    craters(bg, [
      [26, 26, 3],
      [38, 30, 4],
      [28, 40, 2.4],
      [40, 42, 2],
    ]) +
    stroke("M16 34 C24 40 34 40 46 32", 1.8, bg),
  titania: (bg: string) =>
    ball(18) +
    craters(bg, [
      [30, 28, 2.8],
      [40, 38, 3.2],
      [24, 40, 2],
    ]) +
    stroke("M20 22 C30 30 40 26 46 20", 2, bg),
  miranda: (bg: string) =>
    lumpy(bg, []) +
    stroke("M20 28 L32 24 L44 30", 2.2, bg) +
    stroke("M22 40 L34 36 L46 40", 2.2, bg) +
    dot(28, 33, 2, bg),
  triton: (bg: string) =>
    ball(18) +
    `<path d="M14 22 C20 14 38 14 46 20 C38 18 24 20 14 22Z" fill="${bg}"/>` +
    dot(34, 34, 2.4, bg) +
    dot(26, 38, 2, bg) +
    dot(40, 42, 2, bg) +
    stroke("M44 28 L52 22 M48 36 L56 32", 2) +
    stroke("M8 44 C14 50 20 52 26 52", 2),
  charon: (bg: string) =>
    ball(15) +
    `<path d="M20 22 C26 14 40 14 46 22 C38 20 28 20 20 22Z" fill="${bg}"/>` +
    craters(bg, [[34, 38, 2.6]]),
} satisfies Record<string, Icon>;
