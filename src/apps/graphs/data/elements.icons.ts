import { dot, stroke, type Icon } from "../icons";

/** A chemical symbol in bold, centred in the 64 by 64 box. */
const symbol =
  (text: string, size = 30): Icon =>
  () =>
    `<text x="32" y="${32 + size * 0.36}" font-family="sans-serif" font-weight="bold" font-size="${size}" text-anchor="middle" fill="#fff">${text}</text>`;

export const ELEMENTS_ICONS = {
  h: symbol("H", 34),
  c: symbol("C", 34),
  n: symbol("N", 34),
  o: symbol("O", 34),
  na: symbol("Na", 30),
  cl: symbol("Cl", 30),
  ca: symbol("Ca", 30),
  fe: symbol("Fe", 30),
  si: symbol("Si", 30),
  s: symbol("S", 34),
  al: symbol("Al", 30),
  mg: symbol("Mg", 28),
  k: symbol("K", 34),

  water: () =>
    `<path d="M32 8 C42 22 50 30 50 40 A18 18 0 0 1 14 40 C14 30 22 22 32 8Z" fill="#fff"/>`,
  salt: (bg) =>
    `<path d="M22 22 H42 L46 54 H18Z" fill="#fff"/>` +
    `<rect x="20" y="12" width="24" height="10" rx="5" fill="#fff"/>` +
    dot(28, 16, 1.6, bg) +
    dot(36, 16, 1.6, bg) +
    dot(32, 19, 1.6, bg) +
    stroke("M24 34 H40", 2, bg),
  co2: () =>
    `<path d="M18 46 A10 10 0 0 1 20 26 A14 14 0 0 1 46 24 A11 11 0 0 1 48 46Z" fill="#fff"/>`,
  methane: (bg) =>
    `<path d="M32 6 C40 18 48 26 48 38 A16 16 0 0 1 16 38 C16 30 20 26 24 20 C25 26 28 28 30 28 C28 20 28 12 32 6Z" fill="#fff"/>` +
    `<path d="M32 58 C27 58 24 54 24 50 C24 44 30 42 32 36 C34 42 40 44 40 50 C40 54 37 58 32 58Z" fill="${bg}"/>`,
  ammonia: (bg) =>
    `<path d="M22 12 H42 V20 H38 V28 L48 50 Q50 56 44 56 H20 Q14 56 16 50 L26 28 V20 H22Z" fill="#fff"/>` +
    stroke("M20 44 H44", 2.4, bg) +
    dot(30, 36, 2, bg),
  soda: (bg) =>
    `<rect x="14" y="30" width="36" height="22" rx="4" fill="#fff"/>` +
    `<path d="M10 30 L18 14 H46 L54 30Z" fill="#fff"/>` +
    dot(26, 41, 3, bg) +
    dot(36, 46, 2.4, bg) +
    dot(40, 38, 2, bg),
  limestone: (bg) =>
    `<path d="M8 50 L16 22 L34 14 L50 22 L56 50Z" fill="#fff"/>` +
    stroke("M16 22 L26 34 L34 14 M26 34 L30 50 M50 22 L40 36", 2, bg),
  rust: (bg) =>
    `<circle cx="32" cy="14" r="8" fill="#fff"/>` +
    `<rect x="29" y="18" width="6" height="34" fill="#fff"/>` +
    `<path d="M29 52 L32 60 L35 52Z" fill="#fff"/>` +
    dot(32, 14, 3, bg) +
    dot(31, 32, 1.8, bg) +
    dot(33.5, 40, 1.8, bg),
  sand: (bg) =>
    `<path d="M4 54 C14 40 24 32 32 12 C40 32 50 40 60 54Z" fill="#fff"/>` +
    dot(22, 48, 1.8, bg) +
    dot(32, 44, 1.8, bg) +
    dot(40, 50, 1.8, bg) +
    dot(30, 32, 1.8, bg),
  sugar: (bg) =>
    `<path d="M10 28 L32 18 L54 28 L32 38Z" fill="#fff"/>` +
    `<path d="M10 32 L30 42 V58 L10 48Z" fill="#fff"/>` +
    `<path d="M54 32 L34 42 V58 L54 48Z" fill="#fff"/>` +
    stroke("M32 18 V38", 1.6, bg),
  vinegar: (bg) =>
    `<rect x="27" y="6" width="10" height="10" fill="#fff"/>` +
    `<path d="M27 16 C18 24 18 30 18 36 V54 Q18 58 22 58 H42 Q46 58 46 54 V36 C46 30 46 24 37 16Z" fill="#fff"/>` +
    stroke("M18 42 H46", 2.4, bg),
  peroxide: (bg) =>
    `<path d="M32 6 C40 18 46 24 46 34 A14 14 0 0 1 18 34 C18 24 24 18 32 6Z" fill="#fff"/>` +
    stroke("M32 34 L32 52 M23 43 H41", 3.6) +
    dot(32, 24, 3, bg),
  laughing: (bg) =>
    `<circle cx="32" cy="32" r="24" fill="#fff"/>` +
    dot(23, 26, 3, bg) +
    dot(41, 26, 3, bg) +
    `<path d="M18 36 Q32 56 46 36Z" fill="${bg}"/>`,
  epsom: (bg) =>
    `<rect x="10" y="30" width="44" height="22" rx="5" fill="#fff"/>` +
    stroke("M18 24 C14 18 22 16 18 10 M30 24 C26 18 34 16 30 10 M42 24 C38 18 46 16 42 10", 2.4) +
    stroke("M16 41 H48", 2, bg),
  sapphire: (bg) =>
    `<path d="M20 10 H44 L58 26 L32 58 L6 26Z" fill="#fff"/>` +
    stroke("M6 26 H58 M20 10 L26 26 L32 58 M44 10 L38 26 L32 58 M26 26 L32 10 L38 26", 1.8, bg),
  stomach: (bg) =>
    `<path d="M26 10 C26 20 18 22 16 32 C14 44 24 56 38 54 C50 52 52 40 46 32 C42 26 38 24 38 18 V10Z" fill="#fff"/>` +
    dot(30, 42, 3, bg) +
    dot(40, 40, 2.4, bg),
  potash: (bg) =>
    `<path d="M32 58 V30 M32 40 C20 40 14 32 14 22 C26 22 32 28 32 40 M32 34 C42 34 50 28 50 16 C38 16 32 24 32 34" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    dot(32, 58, 0.1, bg),
} satisfies Record<string, Icon>;
