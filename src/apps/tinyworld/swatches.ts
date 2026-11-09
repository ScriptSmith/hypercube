import type { PaletteSet, Variant } from "./config";
import { E, type ElementId, isFlowing } from "./elements";
import type { PieceKind } from "./pieces";

/** Things placed with a tap rather than poured: they do something rather than stand still. */
export type ToolKind = "geyser" | "fan" | "heater" | "cooler" | "spout" | "beetle";
export type PlaceKind = PieceKind | ToolKind;

export const TOOL_KINDS: readonly ToolKind[] = [
  "geyser",
  "fan",
  "heater",
  "cooler",
  "spout",
  "beetle",
];
export const isTool = (k: PlaceKind): k is ToolKind =>
  (TOOL_KINDS as readonly string[]).includes(k);

export type Choice = { type: "element"; element: ElementId } | { type: "place"; place: PlaceKind };

export interface SwatchDef {
  id: string;
  /** Shown under the icon and in the callout. Fixed strings only. */
  label: string;
  choice: Choice;
  /** Fire, lava and acid sit above children's reach. */
  danger: boolean;
  /** SVG markup on a 100 x 100 grid in `currentColor`. Details are holes or lighter layers. */
  glyph: string;
}

export interface PalettePage {
  id: string;
  label: string;
  glyph: string;
  swatches: SwatchDef[];
}

export interface PaletteSpec {
  /** Tabbed pages of safe things, within children's reach. */
  pages: PalettePage[];
  /** A fixed row above children's reach. Empty in the child set and the delta. */
  danger: SwatchDef[];
}

const g = (body: string) => `<g fill="currentColor">${body}</g>`;
const faint = (body: string) => `<g fill="currentColor" opacity="0.55">${body}</g>`;
const line = (d: string, w = 8) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
/** A shape with holes: every subpath after the first cuts out. */
const holes = (d: string) => `<path d="${d}" fill="currentColor" fill-rule="evenodd"/>`;
const drop = "M50 8C50 8 18 46 18 64a32 32 0 0 0 64 0C82 46 50 8 50 8Z";
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/** One style throughout: bold silhouettes, holes for detail, a lighter layer for depth. */
export const GLYPHS = {
  sand:
    g('<path d="M8 88c10-26 26-40 42-40s32 14 42 40z"/>') +
    faint(
      '<circle cx="34" cy="28" r="7"/><circle cx="52" cy="14" r="7"/><circle cx="66" cy="32" r="7"/>',
    ),
  water: holes(drop + circle(38, 64, 7)),
  seed:
    g('<path d="M46 90V52h8v38z"/><ellipse cx="50" cy="88" rx="16" ry="8"/>') +
    g('<path d="M50 60C32 60 18 48 18 28c18 0 32 12 32 32z"/>') +
    faint('<path d="M50 52c0-20 14-32 32-32 0 20-14 32-32 32z"/>'),
  snow:
    line("M50 10v80M15 30l70 40M15 70l70-40", 8) +
    line(
      "M38 16l12 12 12-12M38 84l12-12 12 12M14 44l16-2-6-14M86 56l-16 2 6 14M14 56l16 2-6 14M86 44l-16-2 6-14",
      6,
    ),
  ice:
    g('<path d="M50 10L86 30L50 50L14 30Z"/>') +
    `<path d="M14 30L50 50V90L14 70Z" fill="currentColor" opacity="0.75"/>` +
    `<path d="M86 30L50 50V90L86 70Z" fill="currentColor" opacity="0.45"/>`,
  salt: holes(
    "M30 44h40v40a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8z" +
      "M28 40c0-16 10-28 22-28s22 12 22 28z" +
      circle(42, 26, 4) +
      circle(58, 26, 4) +
      circle(50, 34, 4),
  ),
  oil: holes(
    "M24 16h52a6 6 0 0 1 6 6v58a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6V22a6 6 0 0 1 6-6Z" +
      "M18 38h64v7H18zM18 58h64v7H18z",
  ),
  popcorn:
    faint('<path d="M24 46h52l-8 44H32z"/>') +
    g(
      '<circle cx="34" cy="38" r="13"/><circle cx="52" cy="30" r="15"/><circle cx="68" cy="40" r="12"/>' +
        '<circle cx="44" cy="18" r="9"/><circle cx="62" cy="16" r="8"/>',
    ),
  fire: holes(
    "M50 6c8 18 30 30 30 56a30 30 0 0 1-60 0c0-14 8-24 14-34 4 10 10 14 14 16 3-12 2-24 2-38z" +
      "M50 92c-9 0-15-7-15-15 0-8 6-14 10-20 2 6 6 8 9 9 1-6 1-11 0-16 7 7 11 16 11 27 0 8-6 15-15 15z",
  ),
  lava:
    g('<path d="M8 90L36 40l9 9h10l9-9 28 50z"/>') +
    faint(
      '<circle cx="50" cy="24" r="9"/><circle cx="32" cy="16" r="6"/><circle cx="68" cy="14" r="6"/>',
    ),
  acid:
    holes(
      "M38 8h24v10h-4v20l24 42a7 7 0 0 1-6 10H20a7 7 0 0 1-6-10l24-42V18h-4z" +
        "M26 76h48l-9-16H35z",
    ) + faint('<circle cx="76" cy="20" r="7"/><circle cx="86" cy="40" r="5"/>'),
  block: holes(
    "M12 14h76v72H12z" +
      "M18 20h28v14H18zM52 20h30v14H52zM18 40h14v16H18zM38 40h30v16H38zM74 40h8v16h-8zM18 62h28v18H18zM52 62h30v18H52z",
  ),
  ramp: g('<path d="M10 88V22l80 66z"/>'),
  bowl: g('<path d="M8 32h20v18a22 22 0 0 0 44 0V32h20v22a42 42 0 0 1-84 0z"/>'),
  platform:
    g('<rect x="6" y="30" width="88" height="18" rx="5"/>') +
    faint('<path d="M18 48h12l-6 32h-6zM70 48h12v32h-6z"/>'),
  geyser:
    g('<path d="M30 92V72h-8V62h56v10h-8v20z"/>') +
    line("M30 46l20-16 20 16", 10) +
    `<g opacity="0.55">${line("M30 26l20-16 20 16", 10)}</g>`,
  fan: holes(
    circle(50, 50, 40) +
      "M50 50C44 36 46 20 58 16c10 4 8 22-8 34zM50 50c15-2 29 6 30 18-7 8-24 2-30-18zM50 50c-9 12-25 16-33 8 1-11 18-14 33-8z" +
      circle(50, 50, 6),
  ),
  heater:
    holes("M14 54h72v34H14z" + "M24 60h8v22h-8zM40 60h8v22h-8zM56 60h8v22h-8zM72 60h8v22h-8z") +
    line("M30 44c-6-8 6-12 0-20M50 44c-6-8 6-12 0-20M70 44c-6-8 6-12 0-20", 7),
  cooler:
    faint('<rect x="10" y="10" width="80" height="80" rx="16"/>') +
    line("M50 22v56M26 36l48 28M26 64l48-28", 8),
  spout:
    g(
      '<path d="M8 30h50a14 14 0 0 1 14 14v12H58v-10H8z"/><rect x="26" y="18" width="14" height="12" rx="3"/>',
    ) + faint(`<path d="${"M65 64C65 64 56 76 56 82a9 9 0 0 0 18 0C74 76 65 64 65 64Z"}"/>`),
  beetle:
    holes(
      "M50 28c20 0 32 16 32 34 0 18-14 30-32 30S18 80 18 62c0-18 12-34 32-34z" +
        circle(36, 58, 6) +
        circle(64, 58, 6) +
        circle(40, 78, 5) +
        circle(60, 78, 5) +
        "M49 30h2v62h-2z",
    ) +
    g('<circle cx="50" cy="22" r="11"/>') +
    line("M38 14l-8-8M62 14l8-8", 5),
  remove:
    holes("M60 10L90 40L50 80H28L10 62Z" + "M42 28L72 58L64 66L34 36Z") +
    faint('<rect x="10" y="84" width="80" height="7" rx="3.5"/>'),
  basics:
    g('<path d="M36 12C36 12 12 42 12 56a24 24 0 0 0 48 0C60 42 36 12 36 12Z"/>') +
    faint('<path d="M44 92c8-18 20-28 30-28s20 10 24 28z"/>'),
  build:
    g(
      '<rect x="12" y="56" width="34" height="32" rx="4"/><rect x="54" y="56" width="34" height="32" rx="4"/>',
    ) + faint('<rect x="32" y="16" width="36" height="34" rx="4"/>'),
  gadgets: holes(
    "M44 8h12l2 12 9 4 10-7 8 8-7 10 4 9 12 2v12l-12 2-4 9 7 10-8 8-10-7-9 4-2 12H44l-2-12-9-4-10 7-8-8 7-10-4-9-12-2V44l12-2 4-9-7-10 8-8 10 7 9-4z" +
      circle(50, 50, 14),
  ),
} as const;

type GlyphId = keyof typeof GLYPHS;

const element = (id: GlyphId, label: string, el: ElementId, danger = false): SwatchDef => ({
  id,
  label,
  choice: { type: "element", element: el },
  danger,
  glyph: GLYPHS[id],
});

const place = (id: GlyphId & PlaceKind, label: string): SwatchDef => ({
  id,
  label,
  choice: { type: "place", place: id },
  danger: false,
  glyph: GLYPHS[id],
});

export const SWATCHES = {
  sand: element("sand", "Sand", E.SAND),
  water: element("water", "Water", E.WATER),
  seed: element("seed", "Seeds", E.SEED),
  snow: element("snow", "Snow", E.SNOW),
  ice: element("ice", "Ice", E.ICE),
  salt: element("salt", "Salt", E.SALT),
  oil: element("oil", "Oil", E.OIL),
  popcorn: element("popcorn", "Popcorn", E.KERNEL),
  fire: element("fire", "Fire", E.FIRE, true),
  lava: element("lava", "Lava", E.LAVA, true),
  acid: element("acid", "Acid", E.ACID, true),
  block: place("block", "Block"),
  ramp: place("ramp", "Ramp"),
  bowl: place("bowl", "Bowl"),
  platform: place("platform", "Shelf"),
  geyser: place("geyser", "Geyser"),
  fan: place("fan", "Fan"),
  heater: place("heater", "Heater"),
  cooler: place("cooler", "Cooler"),
  spout: place("spout", "Spout"),
  beetle: place("beetle", "Beetle"),
  // Remove pours nothing: it clears loose matter and takes away pieces, gadgets and beetles.
  remove: element("remove", "Remove", E.EMPTY),
} satisfies Record<string, SwatchDef>;

const page = (
  id: "basics" | "build" | "gadgets",
  label: string,
  swatches: SwatchDef[],
): PalettePage => ({
  id,
  label,
  glyph: GLYPHS[id],
  swatches,
});

/** What the palette offers. Pages are safe for children; the danger row needs adult reach. */
export const paletteFor = (variant: Variant, set: PaletteSet): PaletteSpec => {
  const s = SWATCHES;
  if (variant === "delta") {
    return {
      pages: [
        page("basics", "Basics", [s.sand, s.water, s.seed, s.ice]),
        page("build", "Build", [s.block, s.ramp, s.platform, s.remove]),
        page("gadgets", "Gadgets", [s.geyser, s.fan, s.spout, s.beetle]),
      ],
      danger: [],
    };
  }
  const basics = [s.sand, s.water, s.seed, s.snow, s.ice, s.salt, s.popcorn];
  const gadgets = [s.geyser, s.fan, s.heater, s.cooler, s.spout, s.beetle];
  const build = page("build", "Build", [s.block, s.ramp, s.bowl, s.platform, s.remove]);
  if (set === "child") {
    return {
      pages: [page("basics", "Basics", basics), build, page("gadgets", "Gadgets", gadgets)],
      danger: [],
    };
  }
  return {
    pages: [
      page("basics", "Basics", [...basics, s.oil]),
      build,
      page("gadgets", "Gadgets", gadgets),
    ],
    danger: [s.fire, s.lava, s.acid],
  };
};

/** Every swatch a palette shows, pages first. */
export const allSwatches = (p: PaletteSpec): SwatchDef[] => [
  ...p.pages.flatMap((pg) => pg.swatches),
  ...p.danger,
];

export const isPourable = (choice: Choice): boolean =>
  choice.type === "element" && isFlowing(choice.element);

/** The Remove choice: its "element" is empty space. */
export const isRemove = (choice: Choice): boolean =>
  choice.type === "element" && choice.element === E.EMPTY;
