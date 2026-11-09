import { dot, stroke, type Icon } from "../icons";

/** Original silhouettes for the food web, drawn from basic shapes in a 64 by 64 box. */
const shark: Icon = (bg) =>
  `<path d="M5 38 C22 26 40 30 46 33 L58 22 L54 38 L58 52 L44 42 C28 48 14 44 5 38Z" fill="#fff"/>` +
  `<path d="M24 31 L32 14 L37 33Z" fill="#fff"/>` +
  dot(14, 36, 1.8, bg);

export const FOODWEB_ICONS = {
  phytoplankton: (bg: string) =>
    dot(23, 27, 6, "#fff") +
    dot(39, 22, 4.5, "#fff") +
    dot(34, 38, 8, "#fff") +
    dot(47, 36, 4, "#fff") +
    dot(21, 41, 3.5, "#fff") +
    dot(34, 38, 3, bg),
  zooplankton: (bg: string) =>
    `<ellipse cx="32" cy="35" rx="8" ry="12" fill="#fff"/>` +
    dot(32, 30, 2.5, bg) +
    stroke("M28 24 C22 16 16 14 12 16", 2.2) +
    stroke("M36 24 C42 16 48 14 52 16", 2.2) +
    stroke("M24 33 L16 36 M24 40 L17 45 M40 33 L48 36 M40 40 L47 45", 2.2),
  seagrass: () =>
    `<path d="M18 52 C16 38 20 26 16 14 C25 25 28 38 26 52Z" fill="#fff"/>` +
    `<path d="M29 52 C28 36 32 22 32 10 C38 22 39 38 37 52Z" fill="#fff"/>` +
    `<path d="M40 52 C40 40 44 30 48 20 C51 32 50 44 48 52Z" fill="#fff"/>`,
  seaweed: () =>
    stroke("M32 54 C26 44 38 38 32 28 C28 22 34 16 32 10", 3.2) +
    `<ellipse cx="24" cy="44" rx="6" ry="3" transform="rotate(-35 24 44)" fill="#fff"/>` +
    `<ellipse cx="40" cy="36" rx="6" ry="3" transform="rotate(35 40 36)" fill="#fff"/>` +
    `<ellipse cx="25" cy="28" rx="6" ry="3" transform="rotate(-35 25 28)" fill="#fff"/>` +
    `<ellipse cx="38" cy="18" rx="5" ry="2.6" transform="rotate(35 38 18)" fill="#fff"/>`,
  clam: (bg: string) =>
    `<path d="M10 42 A22 22 0 0 1 54 42 Z" fill="#fff"/>` +
    stroke("M32 42 L32 24 M32 42 L20 28 M32 42 L44 28 M32 42 L14 36 M32 42 L50 36", 2, bg) +
    `<path d="M14 46 H50 L46 52 H18Z" fill="#fff"/>`,
  prawn: (bg: string) =>
    stroke("M44 18 C26 14 16 28 22 40 C26 47 36 48 42 44", 7) +
    `<path d="M40 40 L52 36 L50 50 Z" fill="#fff"/>` +
    stroke("M46 18 C50 12 54 12 56 14 M44 22 C50 20 54 22 56 26", 1.8) +
    dot(40, 20, 1.8, bg),
  sardine: (bg: string) =>
    `<ellipse cx="29" cy="32" rx="19" ry="7.5" fill="#fff"/>` +
    `<path d="M45 32 L58 22 L58 42Z" fill="#fff"/>` +
    dot(17, 30, 1.8, bg) +
    stroke("M27 25 L31 19 L35 25", 2),
  parrotfish: (bg: string) =>
    `<ellipse cx="28" cy="32" rx="18" ry="12" fill="#fff"/>` +
    `<path d="M44 32 L57 22 L57 42Z" fill="#fff"/>` +
    `<path d="M20 21 C26 12 36 14 40 22Z" fill="#fff"/>` +
    dot(17, 29, 2.2, bg) +
    stroke("M11 35 L14 35", 2, bg),
  crab: (bg: string) =>
    `<ellipse cx="32" cy="38" rx="14" ry="10" fill="#fff"/>` +
    stroke("M20 34 L12 24 M44 34 L52 24", 3) +
    dot(11, 21, 5, "#fff") +
    dot(53, 21, 5, "#fff") +
    stroke("M19 42 L10 48 M21 46 L14 54 M45 42 L54 48 M43 46 L50 54", 2.5) +
    dot(27, 34, 1.8, bg) +
    dot(37, 34, 1.8, bg),
  squid: (bg: string) =>
    `<path d="M32 8 C42 18 42 32 38 38 L26 38 C22 32 22 18 32 8Z" fill="#fff"/>` +
    dot(28, 33, 1.8, bg) +
    dot(36, 33, 1.8, bg) +
    stroke("M27 40 C25 46 27 50 25 56 M32 40 L32 56 M37 40 C39 46 37 50 39 56", 2.6),
  octopus: (bg: string) =>
    dot(32, 26, 13, "#fff") +
    dot(27, 26, 2.2, bg) +
    dot(37, 26, 2.2, bg) +
    stroke(
      "M22 36 C16 44 22 50 16 54 M27 38 C25 46 30 50 27 56 M37 38 C39 46 34 50 37 56 M42 36 C48 44 42 50 48 54",
      3.2,
    ),
  trout: (bg: string) =>
    `<ellipse cx="28" cy="32" rx="20" ry="10" fill="#fff"/>` +
    `<path d="M45 32 L58 21 L58 43Z" fill="#fff"/>` +
    `<path d="M18 22 C26 14 36 15 40 23Z" fill="#fff"/>` +
    dot(14, 30, 2, bg) +
    dot(26, 30, 1.6, bg) +
    dot(33, 34, 1.6, bg) +
    dot(22, 36, 1.6, bg),
  ray: (bg: string) =>
    `<path d="M32 16 C38 24 52 28 58 36 C46 34 38 36 32 44 C26 36 18 34 6 36 C12 28 26 24 32 16Z" fill="#fff"/>` +
    stroke("M32 44 L32 58", 2.4) +
    dot(27, 26, 1.6, bg) +
    dot(37, 26, 1.6, bg),
  dugong: (bg: string) =>
    `<path d="M8 36 C10 22 34 18 46 28 L56 22 L54 34 L58 44 L46 38 C34 48 12 48 8 36Z" fill="#fff"/>` +
    `<path d="M14 40 L20 38 L22 48 Z" fill="#fff"/>` +
    dot(15, 32, 1.8, bg),
  turtle: (bg: string) =>
    `<ellipse cx="32" cy="34" rx="14" ry="11" fill="#fff"/>` +
    `<ellipse cx="13" cy="30" rx="6" ry="3" transform="rotate(-30 13 30)" fill="#fff"/>` +
    `<ellipse cx="51" cy="30" rx="6" ry="3" transform="rotate(30 51 30)" fill="#fff"/>` +
    `<ellipse cx="17" cy="46" rx="5" ry="3" transform="rotate(30 17 46)" fill="#fff"/>` +
    `<ellipse cx="47" cy="46" rx="5" ry="3" transform="rotate(-30 47 46)" fill="#fff"/>` +
    dot(32, 19, 5, "#fff") +
    stroke("M32 25 V43 M22 30 L42 38 M42 30 L22 38", 1.6, bg),
  bird: () =>
    `<path d="M6 32 C16 16 26 20 32 30 C38 20 48 16 58 32 C48 28 40 30 32 42 C24 30 16 28 6 32Z" fill="#fff"/>`,
  dolphin: (bg: string) =>
    `<path d="M6 26 C14 22 20 26 30 22 C40 18 50 22 56 14 C56 24 54 34 44 40 C34 46 24 44 16 38 L8 44 L10 34 C8 32 6 30 6 26Z" fill="#fff"/>` +
    `<path d="M28 22 L34 10 L38 22Z" fill="#fff"/>` +
    dot(12, 27, 1.5, bg),
  shark,
  tigershark: (bg: string) =>
    shark(bg) + stroke("M26 36 L26 42 M31 35 L31 43 M36 35 L36 42 M41 36 L41 40", 1.8, bg),
} satisfies Record<string, Icon>;
