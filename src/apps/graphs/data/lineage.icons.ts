import { dot, stroke, type Icon } from "../icons";

/** Original symbols for the teacher and student graph, drawn from basic shapes in a 64 by 64 box. */
const W = "#fff";

export const LINEAGE_ICONS: Record<string, Icon> = {
  sigma: () => stroke("M46 14 H18 L34 32 L18 50 H46", 5),
  top: (bg) =>
    `<ellipse cx="32" cy="24" rx="19" ry="6" fill="${W}"/>` +
    `<path d="M15 28 L32 54 L49 28 Z" fill="${W}"/>` +
    stroke("M32 18 V8", 3) +
    stroke("M24 33 L40 33", 2.2, bg),
  matrix: () =>
    stroke("M22 12 H14 V52 H22", 4) +
    stroke("M42 12 H50 V52 H42", 4) +
    dot(26, 24, 3.4, W) +
    dot(38, 24, 3.4, W) +
    dot(26, 40, 3.4, W) +
    dot(38, 40, 3.4, W),
  primes: (bg) =>
    [14, 32, 50]
      .flatMap((y, r) =>
        [14, 32, 50].map((x, c) => {
          const big = (r * 3 + c) % 2 === 0;
          return big ? dot(x, y, 6.5, W) : dot(x, y, 2.6, W);
        }),
      )
      .join("") + dot(32, 32, 2.4, bg),
  steps: () => stroke("M10 52 H24 V38 H38 V24 H52 V10", 5) + dot(10, 52, 3, W) + dot(52, 10, 3, W),
  symmetry: () =>
    `<path d="M26 14 L10 50 H26Z" fill="${W}"/>` +
    `<path d="M38 14 L54 50 H38Z" fill="none" stroke="${W}" stroke-width="3" stroke-linejoin="round"/>` +
    stroke("M32 8 V56", 2.6) +
    dot(32, 32, 3, W),
  curvesteps: () =>
    stroke("M10 50 C24 50 40 40 54 14", 2.6) +
    stroke("M10 50 L22 49 L22 46 L34 42 L34 37 L44 30 L44 24 L54 14", 4),
  lines: () =>
    stroke("M12 52 L52 12 M12 52 L52 28 M12 52 L52 44 M12 52 L36 8 M12 52 L20 8", 3) +
    stroke("M20 8 C30 36 44 44 52 44", 2.4),
  bottle: (bg) =>
    stroke("M32 12 C40 12 44 22 38 32", 5) +
    `<circle cx="28" cy="42" r="15" fill="none" stroke="${W}" stroke-width="5"/>` +
    stroke("M38 32 C36 36 34 38 30 40", 5) +
    dot(28, 42, 4, bg),
  globe: () =>
    `<circle cx="32" cy="32" r="21" fill="none" stroke="${W}" stroke-width="3.6"/>` +
    `<ellipse cx="32" cy="32" rx="9" ry="21" fill="none" stroke="${W}" stroke-width="3"/>` +
    stroke("M11 32 H53", 3) +
    stroke("M32 11 L48 44 L18 44 Z", 2.4),
  pi: () =>
    stroke("M12 20 H52", 5) + stroke("M22 20 V50", 5) + stroke("M42 20 C42 38 40 48 47 50", 5),
  list: () =>
    [14, 28, 42].map((y) => dot(14, y + 4, 3.2, W) + stroke(`M24 ${y + 4} H52`, 4)).join("") +
    stroke("M44 8 V12", 3),
  cycle: () =>
    stroke("M48 24 A18 18 0 1 0 50 36", 4.4) +
    `<path d="M40 18 L52 22 L46 32Z" fill="${W}"/>` +
    dot(32, 32, 4, W),
  bell: () =>
    stroke("M8 50 C18 50 22 14 32 14 C42 14 46 50 56 50", 4.4) +
    stroke("M8 56 H56", 2.4) +
    stroke("M32 14 V50", 2.4),
  shell: () =>
    `<circle cx="32" cy="32" r="22" fill="none" stroke="${W}" stroke-width="3"/>` +
    `<circle cx="32" cy="32" r="12" fill="none" stroke="${W}" stroke-width="3"/>` +
    dot(32, 10, 4, W) +
    dot(54, 32, 4, W) +
    dot(20, 42, 3.4, W) +
    dot(32, 32, 4, W),
  nucleus: () =>
    dot(26, 28, 8, W) +
    dot(40, 26, 8, W) +
    dot(33, 40, 8, W) +
    dot(22, 44, 6, W) +
    dot(44, 42, 6, W),
  photon: () =>
    stroke("M8 32 C14 14 20 14 24 32 C28 50 34 50 38 32 C42 14 48 14 52 32", 3.6) +
    `<path d="M50 24 L60 32 L50 40Z" fill="${W}"/>`,
  box: () =>
    `<rect x="12" y="12" width="40" height="40" rx="4" fill="none" stroke="${W}" stroke-width="3.6"/>` +
    dot(22, 22, 3.4, W) +
    dot(40, 20, 3.4, W) +
    dot(30, 36, 3.4, W) +
    dot(44, 40, 3.4, W) +
    dot(20, 44, 3.4, W),
  pair: (bg) =>
    `<circle cx="22" cy="32" r="12" fill="${W}"/>` +
    `<circle cx="44" cy="32" r="12" fill="none" stroke="${W}" stroke-width="3.6"/>` +
    stroke("M16 32 H28 M22 26 V38", 3, bg) +
    stroke("M38 32 H50", 3.4),
  galaxy: () =>
    stroke("M32 32 C32 22 44 20 50 28 C58 40 42 54 28 50 C12 46 8 26 20 16", 3.8) +
    dot(32, 32, 5, W),
  blackhole: (bg) =>
    `<circle cx="32" cy="32" r="22" fill="none" stroke="${W}" stroke-width="3.4"/>` +
    `<circle cx="32" cy="32" r="12" fill="${bg}" stroke="${W}" stroke-width="3"/>` +
    stroke("M32 4 V10 M32 54 V60 M4 32 H10 M54 32 H60", 3),
  hr: () =>
    stroke("M10 10 V54 H54", 3) +
    dot(18, 18, 3.4, W) +
    dot(26, 26, 3.4, W) +
    dot(32, 30, 3.4, W) +
    dot(38, 36, 3.4, W) +
    dot(46, 44, 3.4, W) +
    dot(46, 24, 5, W) +
    dot(22, 44, 2.6, W),
  cluster: () =>
    [
      [32, 32],
      [24, 26],
      [40, 26],
      [24, 40],
      [40, 40],
      [32, 20],
      [32, 44],
      [18, 33],
      [46, 33],
      [28, 33],
      [36, 33],
      [32, 27],
      [32, 38],
    ]
      .map(([x, y]) => dot(x!, y!, 3.4, W))
      .join("") + `<circle cx="32" cy="32" r="24" fill="none" stroke="${W}" stroke-width="2.4"/>`,
  atom1: () =>
    dot(32, 32, 6, W) +
    `<ellipse cx="32" cy="32" rx="23" ry="11" fill="none" stroke="${W}" stroke-width="3"/>` +
    dot(52, 38, 4, W),
  lightcurve: () =>
    stroke("M8 50 H56", 2.4) +
    stroke("M8 44 L16 16 L22 44 L30 44 L38 16 L44 44 L52 44", 3.6) +
    dot(16, 16, 3.6, W) +
    dot(38, 16, 3.6, W),
  chain: () =>
    stroke("M12 44 L24 24 L36 44 L48 20", 3) +
    dot(12, 44, 6, W) +
    dot(24, 24, 6, W) +
    dot(36, 44, 6, W) +
    dot(48, 20, 6, W) +
    dot(54, 38, 4, W),
  chromosome: (bg) =>
    `<rect x="22" y="12" width="9" height="40" rx="4.5" fill="${W}"/>` +
    `<rect x="33" y="12" width="9" height="40" rx="4.5" fill="${W}"/>` +
    dot(32, 32, 5, bg) +
    dot(26, 12, 4.4, W) +
    dot(38, 12, 4.4, W) +
    dot(26, 52, 4.4, W) +
    dot(38, 52, 4.4, W),
  helix: () =>
    stroke("M18 10 C18 24 46 24 46 38 C46 48 38 52 34 54", 3.6) +
    stroke("M46 10 C46 24 18 24 18 38 C18 48 26 52 30 54", 3.6) +
    stroke("M23 18 H41 M24 31 H40 M24 44 H40", 2.4),
};
