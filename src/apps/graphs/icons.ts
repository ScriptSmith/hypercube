/**
 * Original icons for graph nodes: a white silhouette on a coloured disc, drawn from basic
 * shapes. They are inline SVG so a graph carries them with it and nothing is fetched. Each
 * graph keeps its own set (`data/<id>.icons.ts`) built from these helpers.
 */

/** Draws shapes in a 64 by 64 box. `bg` is the disc colour, for cutting eyes and marks out. */
export type Icon = (bg: string) => string;

export const stroke = (d: string, w: number, color = "#fff") =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

export const dot = (x: number, y: number, r: number, fill: string) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;

/** The icon as SVG markup, on a disc of `bg` (#rrggbb). */
export function iconSvg(icon: Icon, bg: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="32" fill="${bg}"/>` +
    `<g transform="translate(32 32) scale(0.86) translate(-32 -32)">${icon(bg)}</g></svg>`
  );
}
