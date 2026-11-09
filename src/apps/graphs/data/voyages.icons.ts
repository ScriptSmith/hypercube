import { dot, stroke, type Icon } from "../icons";

/** Original silhouettes for the voyages map, drawn from basic shapes in a 64 by 64 box. */
export const VOYAGES_ICONS: Record<string, Icon> = {
  ship: () =>
    `<path d="M8 41 H56 L47 53 H17Z" fill="#fff"/>` +
    stroke("M32 8 V41", 2.6) +
    `<path d="M35 10 L53 37 H35Z" fill="#fff"/>` +
    `<path d="M29 17 L14 37 H29Z" fill="#fff"/>`,
  anchor: () =>
    `<circle cx="32" cy="14" r="5" fill="none" stroke="#fff" stroke-width="3.4"/>` +
    stroke("M32 19 V52", 3.6) +
    stroke("M22 27 H42", 3.6) +
    stroke("M11 38 C13 51 25 56 32 51 C39 56 51 51 53 38", 3.6),
  island: () =>
    `<path d="M6 52 C14 40 26 38 32 42 C38 38 50 40 58 52Z" fill="#fff"/>` +
    stroke("M33 42 C36 33 35 26 30 19", 3) +
    stroke("M30 19 C23 14 16 17 13 24", 3) +
    stroke("M30 19 C27 11 20 10 15 13", 3) +
    stroke("M30 19 C34 11 42 11 47 15", 3) +
    stroke("M30 19 C38 19 44 24 46 31", 3),
  headland: (bg) =>
    `<path d="M6 54 V42 C14 40 18 28 28 24 C36 20 42 25 44 33 L58 38 V54Z" fill="#fff"/>` +
    stroke("M12 48 C18 45 22 51 28 48 C34 45 38 51 44 48 C50 45 54 49 56 48", 2.2, bg),
  compass: (bg) =>
    `<path d="M32 6 L38 26 L58 32 L38 38 L32 58 L26 38 L6 32 L26 26Z" fill="#fff"/>` +
    dot(32, 32, 4, bg),
};
