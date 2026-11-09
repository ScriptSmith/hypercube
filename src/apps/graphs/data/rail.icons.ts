import { dot, stroke, type Icon } from "../icons";

/** Original icons for the rail map, drawn from basic shapes in a 64 by 64 box. */
export const RAIL_ICONS: Record<string, Icon> = {
  // A train seen from the front: body, windscreen, two lamps and two rails.
  train: (bg: string) =>
    `<rect x="16" y="10" width="32" height="38" rx="9" fill="#fff"/>` +
    `<rect x="21" y="16" width="22" height="13" rx="3" fill="${bg}"/>` +
    dot(24, 38, 3.2, bg) +
    dot(40, 38, 3.2, bg) +
    stroke("M20 56 L26 49 M44 56 L38 49", 3.4) +
    stroke("M28 44 H36", 2.4, bg),
  // Two tracks crossing inside a ring, for stations where lines meet.
  interchange: (bg: string) =>
    `<circle cx="32" cy="32" r="21" fill="none" stroke="#fff" stroke-width="4"/>` +
    stroke("M18 46 L46 18", 6) +
    stroke("M18 18 L46 46", 6) +
    dot(32, 32, 5, bg) +
    dot(32, 32, 2.6, "#fff"),
};
