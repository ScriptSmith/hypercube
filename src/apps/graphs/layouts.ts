/**
 * The arrangements a visitor can cycle through. The first is the graph's own, hand-placed
 * picture; the others hand the nodes to one of the viewer's layout algorithms, which moves them
 * from where they were.
 */
export interface LayoutChoice {
  id: string;
  /** What the toast says. Short and plain. */
  name: string;
  /** The viewer's layout id, or null for the hand-placed picture. */
  viewer: "force" | "forceatlas2" | "circle" | "grid" | "radial" | "hierarchy" | null;
}

export const LAYOUT_CHOICES: readonly LayoutChoice[] = [
  { id: "original", name: "Original", viewer: null },
  { id: "force", name: "Springs", viewer: "force" },
  { id: "spread", name: "Spread out", viewer: "forceatlas2" },
  { id: "circle", name: "Circle", viewer: "circle" },
  { id: "grid", name: "Grid", viewer: "grid" },
  { id: "rings", name: "Rings", viewer: "radial" },
  { id: "tree", name: "Tree", viewer: "hierarchy" },
];

export const layoutById = (id: string): LayoutChoice =>
  LAYOUT_CHOICES.find((l) => l.id === id) ?? LAYOUT_CHOICES[0]!;

/** The button's picture: nodes joined by lines, drawn in the button's colour. */
export const LAYOUT_ICON =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M6 7 L17 5 M6 7 L8 18 M17 5 L19 16 M8 18 L19 16 M6 7 L19 16"/>' +
  '<circle cx="6" cy="7" r="2.6" fill="currentColor"/><circle cx="17" cy="5" r="2.6" fill="currentColor"/>' +
  '<circle cx="8" cy="18" r="2.6" fill="currentColor"/><circle cx="19" cy="16" r="2.6" fill="currentColor"/></svg>';
