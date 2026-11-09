/**
 * A small inline-SVG icon set on a 100 x 100 grid, drawn in `currentColor` so the parent's
 * `color` tints it. Shapes are bold and simple so they read from across a room.
 */
export type IconName =
  | "up"
  | "down"
  | "updown"
  | "check"
  | "close"
  | "play"
  | "reset"
  | "touch"
  | "hand";

const stroke = (d: string, width = 11) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${width}" ` +
  `stroke-linecap="round" stroke-linejoin="round"/>`;

const SHAPES: Record<IconName, string> = {
  up: stroke("M50 84V20M24 44L50 18L76 44"),
  down: stroke("M50 16V80M24 56L50 82L76 56"),
  check: stroke("M20 53L41 74L81 30", 12),
  close: stroke("M27 27L73 73M73 27L27 73"),
  play:
    '<path d="M36 22L78 50L36 78Z" fill="currentColor" stroke="currentColor" ' +
    'stroke-width="8" stroke-linejoin="round"/>',
  reset:
    stroke("M78.19 39.74A30 30 0 1 1 60.26 21.81", 10) +
    '<path d="M75.3 27.3L56.8 31.2L63.7 12.4Z" fill="currentColor" stroke="currentColor" ' +
    'stroke-width="5" stroke-linejoin="round"/>',
  touch:
    '<circle cx="50" cy="50" r="13" fill="currentColor"/>' +
    '<circle cx="50" cy="50" r="27" fill="none" stroke="currentColor" stroke-width="6" opacity="0.7"/>' +
    '<circle cx="50" cy="50" r="41" fill="none" stroke="currentColor" stroke-width="5" opacity="0.4"/>',
  // Index finger up, the other three curled to knuckles, thumb out to the side.
  hand:
    '<g fill="currentColor">' +
    '<rect x="33" y="3" width="17" height="62" rx="8.5"/>' +
    '<rect x="53" y="44" width="14" height="26" rx="7"/>' +
    '<rect x="70" y="47" width="13" height="24" rx="6.5"/>' +
    '<rect x="86" y="51" width="11" height="22" rx="5.5"/>' +
    '<path d="M31 58H97V74C97 87 87 97 74 97H53C40 97 31 88 31 76Z"/>' +
    '<path d="M33 64L19 50" stroke="currentColor" stroke-width="15" stroke-linecap="round"/>' +
    "</g>",
  updown: stroke("M50 12V88M28 34L50 12L72 34M28 66L50 88L72 66"),
};

export const ICON_NAMES = Object.keys(SHAPES) as IconName[];

export const isIconName = (name: string): name is IconName => Object.hasOwn(SHAPES, name);

/** SVG markup for an icon. `size` is any CSS length; the default fills the parent. */
export const iconSvg = (name: IconName, size: string | number = "100%"): string => {
  const s = typeof size === "number" ? `${size}px` : size;
  return (
    `<svg viewBox="0 0 100 100" width="${s}" height="${s}" aria-hidden="true" ` +
    `style="display:block;overflow:visible">${SHAPES[name]}</svg>`
  );
};

/** An icon as a DOM element, tinted by `color` (defaults to the inherited colour). */
export const iconElement = (
  name: IconName,
  size: string | number = "100%",
  color?: string,
): HTMLElement => {
  const wrap = document.createElement("span");
  wrap.style.cssText = "display:inline-flex;align-items:center;justify-content:center;";
  if (color) wrap.style.color = color;
  wrap.innerHTML = iconSvg(name, size);
  return wrap;
};
