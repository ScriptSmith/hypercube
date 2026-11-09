/**
 * Pictograms for the condition tiles and buttons, our own simple drawings in a 100 x 100 box:
 * the eye from the side with its focus point, a lens, an optic disc, cones. Strokes use
 * currentColor so a tile can tint them.
 */
import type { ConditionId } from "./captions";

const svg = (body: string) =>
  `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" fill="none" ` +
  `stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** An eye from the side, `len` long, with light focusing at `focus` (x). */
const sideEye = (len: number, focus: number) => {
  const x0 = 50 - len / 2;
  const x1 = 50 + len / 2;
  return (
    `<ellipse cx="50" cy="50" rx="${len / 2}" ry="30"/>` +
    `<path d="M${x0 + 4} 36 Q${x0 - 6} 50 ${x0 + 4} 64" />` +
    `<path d="M8 40 L${focus} 50 M8 60 L${focus} 50" stroke-width="4" opacity="0.8"/>` +
    `<circle cx="${focus}" cy="50" r="5" fill="currentColor" stroke="none"/>` +
    `<path d="M${x1 - 2} 42 L${x1 - 2} 58" stroke-width="4" opacity="0.6"/>`
  );
};

export const CONDITION_ICONS: Record<ConditionId, string> = {
  typical: svg(sideEye(60, 78)),
  myopia: svg(sideEye(74, 66)),
  hyperopia: svg(sideEye(48, 88)),
  astigmatism: svg(
    `<ellipse cx="50" cy="50" rx="38" ry="24"/><path d="M50 20 L50 80 M16 50 L84 50" stroke-width="4" opacity="0.7"/>`,
  ),
  presbyopia: svg(
    `<circle cx="28" cy="58" r="16"/><circle cx="72" cy="58" r="16"/><path d="M44 56 Q50 50 56 56 M12 52 L4 40 M88 52 L96 40"/>`,
  ),
  cataract: svg(
    `<ellipse cx="50" cy="50" rx="20" ry="36"/><ellipse cx="50" cy="50" rx="11" ry="20" fill="currentColor" opacity="0.45" stroke="none"/>`,
  ),
  glaucoma: svg(
    `<circle cx="50" cy="50" r="34"/><circle cx="50" cy="50" r="22" fill="currentColor" opacity="0.35" stroke="none"/><path d="M50 16 L50 4 M24 26 L14 16 M76 26 L86 16" stroke-width="4"/>`,
  ),
  amd: svg(
    `<circle cx="50" cy="50" r="36"/><circle cx="50" cy="50" r="12"/>` +
      [
        [40, 34],
        [62, 40],
        [36, 60],
        [60, 64],
        [52, 28],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="currentColor" stroke="none"/>`)
        .join(""),
  ),
  diabetic: svg(
    `<path d="M20 50 Q40 46 50 30 Q56 20 70 16 M50 30 Q60 40 82 38 M20 50 Q40 56 52 72 Q58 82 74 86 M52 72 Q64 62 84 66" stroke-width="5"/>` +
      `<circle cx="64" cy="50" r="4" fill="currentColor" stroke="none"/><circle cx="40" cy="70" r="4" fill="currentColor" stroke="none"/>`,
  ),
  keratoconus: svg(
    `<path d="M70 12 Q30 30 22 50 Q30 60 34 84" /><path d="M70 12 Q44 28 38 46 Q26 62 36 86" opacity="0.5"/>`,
  ),
  cvd: svg(
    `<circle cx="30" cy="40" r="14"/><circle cx="70" cy="40" r="14"/><circle cx="50" cy="72" r="14" fill="currentColor" opacity="0.4" stroke="none"/><circle cx="50" cy="72" r="14"/>`,
  ),
};

export const ICONS = {
  near: svg(`<path d="M14 30 L50 40 L86 30 L86 74 L50 84 L14 74 Z"/><path d="M50 40 L50 84"/>`),
  far: svg(`<path d="M6 80 L36 36 L54 60 L68 44 L94 80 Z"/><circle cx="74" cy="22" r="8"/>`),
  glasses: svg(
    `<circle cx="28" cy="56" r="17"/><circle cx="72" cy="56" r="17"/><path d="M45 54 Q50 49 55 54 M11 52 L4 38 M89 52 L96 38"/>`,
  ),
  contact: svg(`<path d="M14 62 Q50 22 86 62" /><path d="M22 64 Q50 36 78 64" opacity="0.5"/>`),
  next: svg(`<path d="M36 18 L70 50 L36 82"/>`),
  prev: svg(`<path d="M64 18 L30 50 L64 82"/>`),
  more: svg(
    `<circle cx="22" cy="50" r="6" fill="currentColor"/><circle cx="50" cy="50" r="6" fill="currentColor"/><circle cx="78" cy="50" r="6" fill="currentColor"/>`,
  ),
  lens: svg(`<ellipse cx="50" cy="50" rx="16" ry="36"/>`),
  hand:
    `<svg viewBox="0 0 100 120" width="100%" height="100%" aria-hidden="true">` +
    `<path d="M40 8 C46 8 48 12 48 18 L48 52 L52 52 L52 40 C52 34 62 34 62 40 L62 54 L66 54 L66 46 C66 40 76 40 76 46 L76 58 L80 58 L80 54 C80 48 90 48 90 54 L90 84 C90 102 78 114 62 114 L52 114 C42 114 36 110 30 102 L12 78 C8 72 14 64 22 70 L32 80 L32 18 C32 12 34 8 40 8 Z" ` +
    `fill="rgba(255,255,255,0.88)" stroke="rgba(20,30,50,0.7)" stroke-width="4"/></svg>`,
} as const;
