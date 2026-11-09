import { dot, stroke, type Icon } from "../icons";

/** Original silhouettes for the internet graph, drawn from basic shapes in a 64 by 64 box. */
const rack = (bg: string, units: number) => {
  let s = "";
  for (let i = 0; i < units; i++) {
    const y = 12 + i * (40 / units);
    const h = 40 / units - 3;
    s +=
      `<rect x="14" y="${y}" width="36" height="${h}" rx="2.5" fill="#fff"/>` +
      dot(20, y + h / 2, 1.8, bg);
  }
  return s;
};

export const INTERNET_ICONS: Record<string, Icon> = {
  phone: (bg) =>
    `<rect x="20" y="8" width="24" height="48" rx="5" fill="#fff"/>` +
    `<rect x="23.5" y="14" width="17" height="30" rx="1.5" fill="${bg}"/>` +
    dot(32, 50, 2.2, bg),
  laptop: (bg) =>
    `<rect x="14" y="14" width="36" height="26" rx="3" fill="#fff"/>` +
    `<rect x="18" y="18" width="28" height="18" rx="1" fill="${bg}"/>` +
    `<path d="M6 44 H58 L53 52 H11Z" fill="#fff"/>`,
  tablet: (bg) =>
    `<rect x="12" y="10" width="40" height="44" rx="5" fill="#fff"/>` +
    `<rect x="16" y="15" width="32" height="32" rx="1.5" fill="${bg}"/>` +
    dot(32, 51, 1.8, bg),
  console: (bg) =>
    `<path d="M16 20 H48 C56 20 60 30 58 40 C57 46 52 48 48 44 L44 40 H20 L16 44 C12 48 7 46 6 40 C4 30 8 20 16 20Z" fill="#fff"/>` +
    stroke("M18 26 V34 M14 30 H22", 2.6, bg) +
    dot(43, 27, 2.4, bg) +
    dot(49, 32, 2.4, bg),
  tv: (bg) =>
    `<rect x="8" y="12" width="48" height="32" rx="3" fill="#fff"/>` +
    `<rect x="12" y="16" width="40" height="24" rx="1" fill="${bg}"/>` +
    stroke("M22 54 L26 44 M42 54 L38 44", 3),
  router: (bg) =>
    `<rect x="8" y="40" width="48" height="14" rx="4" fill="#fff"/>` +
    dot(16, 47, 2, bg) +
    dot(23, 47, 2, bg) +
    stroke("M18 40 L14 22 M46 40 L50 22", 3.2) +
    stroke("M26 24 C30 18 34 18 38 24", 2.6) +
    stroke("M21 17 C28 8 36 8 43 17", 2.6),
  tower: () =>
    stroke("M32 22 L22 56 M32 22 L42 56 M26 42 H38 M24 50 H40", 3.2) +
    dot(32, 20, 4, "#fff") +
    stroke("M23 13 C19 18 19 24 23 29 M41 13 C45 18 45 24 41 29", 2.6) +
    stroke("M17 8 C10 16 10 26 17 34 M47 8 C54 16 54 26 47 34", 2.6),
  cabinet: (bg) =>
    `<rect x="14" y="10" width="36" height="44" rx="3" fill="#fff"/>` +
    stroke("M32 12 V52", 2, bg) +
    dot(27, 32, 2, bg) +
    dot(37, 32, 2, bg) +
    stroke("M18 58 H46", 3),
  exchange: (bg) =>
    `<path d="M32 8 L58 22 H6Z" fill="#fff"/>` +
    `<rect x="12" y="26" width="8" height="24" fill="#fff"/>` +
    `<rect x="28" y="26" width="8" height="24" fill="#fff"/>` +
    `<rect x="44" y="26" width="8" height="24" fill="#fff"/>` +
    `<rect x="6" y="52" width="52" height="5" rx="1.5" fill="#fff"/>` +
    dot(32, 17, 2.2, bg),
  network: () =>
    stroke("M32 14 L14 32 M32 14 L50 32 M14 32 L32 50 M50 32 L32 50 M14 32 H50 M32 14 V50", 2.4) +
    dot(32, 14, 6, "#fff") +
    dot(14, 32, 6, "#fff") +
    dot(50, 32, 6, "#fff") +
    dot(32, 50, 6, "#fff"),
  dns: (bg) =>
    dot(27, 27, 14, "#fff") +
    dot(27, 27, 8.5, bg) +
    stroke("M37 37 L52 52", 6) +
    stroke("M22 27 H32 M27 22 V32", 2.4),
  exchangeHub: (bg) =>
    dot(32, 32, 9, "#fff") +
    dot(32, 32, 3.5, bg) +
    stroke(
      "M32 23 V10 M32 41 V54 M23 32 H10 M41 32 H54 M26 26 L15 15 M38 38 L49 49 M38 26 L49 15 M26 38 L15 49",
      2.6,
    ) +
    dot(32, 9, 4.5, "#fff") +
    dot(32, 55, 4.5, "#fff") +
    dot(9, 32, 4.5, "#fff") +
    dot(55, 32, 4.5, "#fff"),
  cable: () =>
    stroke("M6 44 C16 24 24 24 32 36 C40 48 48 48 58 22", 5) +
    dot(6, 44, 5, "#fff") +
    dot(58, 22, 5, "#fff"),
  undersea: () =>
    stroke("M6 16 C16 10 24 22 34 16 C44 10 52 22 58 16", 2.4) +
    stroke("M6 28 C16 22 24 34 34 28 C44 22 52 34 58 28", 2.4) +
    stroke("M8 52 C20 40 30 54 40 46 C48 40 52 44 56 40", 4.5) +
    dot(8, 52, 4, "#fff") +
    dot(56, 40, 4, "#fff"),
  cloud: () =>
    `<path d="M18 48 C8 48 6 36 14 33 C13 22 26 16 33 24 C38 16 52 20 50 32 C58 33 58 48 48 48Z" fill="#fff"/>`,
  cache: (bg) =>
    `<path d="M16 34 C8 34 7 24 14 22 C14 14 24 10 29 16 C34 10 45 14 44 23 C50 24 50 34 43 34Z" fill="#fff"/>` +
    `<rect x="26" y="40" width="26" height="14" rx="3" fill="#fff"/>` +
    dot(32, 47, 1.8, bg) +
    stroke("M14 46 H22 M14 52 H22", 2.4),
  datacentre: (bg) =>
    rack(bg, 3)
      .replace(/x="14"/g, 'x="8"')
      .replace(/width="36"/g, 'width="22"')
      .replace(/cx="20"/g, 'cx="13"') +
    `<g transform="translate(26 0)">${rack(bg, 3)
      .replace(/x="14"/g, 'x="8"')
      .replace(/width="36"/g, 'width="22"')
      .replace(/cx="20"/g, 'cx="13"')}</g>`,
  server: (bg) => rack(bg, 3),
  database: (bg) =>
    `<path d="M12 16 V48 C12 55 52 55 52 48 V16Z" fill="#fff"/>` +
    `<ellipse cx="32" cy="16" rx="20" ry="7" fill="#fff"/>` +
    stroke("M12 28 C12 35 52 35 52 28 M12 40 C12 47 52 47 52 40", 2.2, bg),
};
