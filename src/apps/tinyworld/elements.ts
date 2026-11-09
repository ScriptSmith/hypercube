/**
 * The element table: one source of truth for the CPU (palette, pour rates, tests) and the GPU
 * (the shaders get it as generated GLSL constants, see `glslElementTable`).
 */

export type Kind = "empty" | "gas" | "liquid" | "powder" | "static";

/** Kind codes as the shaders see them. Fluids (empty, gas, liquid) are the codes below 3. */
export const KIND_CODE: Record<Kind, number> = {
  empty: 0,
  gas: 1,
  liquid: 2,
  powder: 3,
  static: 4,
};

/** Element ids. The order is the texture encoding, so append rather than reorder. */
export const E = {
  EMPTY: 0,
  BEDROCK: 1,
  /** Retired (palettes no longer stand in the world); kept so ids stay stable. */
  CABINET: 2,
  SAND: 3,
  SEED: 4,
  SNOW: 5,
  GRAVEL: 6,
  ASH: 7,
  DEBRIS: 8,
  WATER: 9,
  OIL: 10,
  ACID: 11,
  LAVA: 12,
  SILT: 13,
  STEAM: 14,
  SMOKE: 15,
  FIRE: 16,
  PLANT: 17,
  EMBER: 18,
  STONE: 19,
  WOOD: 20,
  GLASS: 21,
  METAL: 22,
  ICE: 23,
  SALT: 24,
  KERNEL: 25,
  POPCORN: 26,
  SPARK: 27,
} as const;

export type ElementKey = keyof typeof E;
export type ElementId = (typeof E)[ElementKey];

export interface PourDef {
  /** Pour rate relative to the base rate, in area per second. */
  rate: number;
  /** Initial life or heat byte range for freshly poured cells. */
  life: [number, number];
  /** "ignite" also sets fire to flammable cells under the finger. */
  mode: "fill" | "ignite";
}

export interface ElementDef {
  key: ElementKey;
  kind: Kind;
  /** Heavier cells sink through lighter fluids. Empty is 0 and gases are negative. */
  density: number;
  /** Chance per pass that a cell sinks into a lighter fluid below it. */
  fall: number;
  /** Chance per pass that a blocked powder or liquid slides to the lower diagonal. */
  slide: number;
  /** Chance per pass that a liquid or gas flows one cell sideways. */
  spread: number;
  /** Chance per pass that a gas rises into empty space above it. */
  rise: number;
  /** Chance per pass that fire, lava or an ember next to it sets it alight. */
  flammable: number;
  /** Chance per pass that acid next to it eats it. */
  dissolves: number;
  /** Dark, base and light colours in sRGB. The per-cell shade byte picks between them. */
  colors: [string, string, string];
  /** Coverage: below 1 for media that let the background through. */
  alpha: number;
  /** Light the cell gives off, feeding the glow passes. */
  glow: number;
  /** Scenery survives the drain. */
  scenery: boolean;
  pour?: PourDef;
}

const base = {
  density: 0,
  fall: 0,
  slide: 0,
  spread: 0,
  rise: 0,
  flammable: 0,
  dissolves: 0,
  alpha: 1,
  glow: 0,
  scenery: false,
};

export const ELEMENTS: readonly ElementDef[] = [
  { ...base, key: "EMPTY", kind: "empty", colors: ["#000000", "#000000", "#000000"], alpha: 0 },
  {
    ...base,
    key: "BEDROCK",
    kind: "static",
    density: 9,
    colors: ["#24252c", "#33353e", "#474a55"],
    scenery: true,
  },
  {
    ...base,
    key: "CABINET",
    kind: "static",
    density: 9,
    colors: ["#0a0d14", "#0a0d14", "#0a0d14"],
    alpha: 0,
    scenery: true,
  },
  {
    ...base,
    key: "SAND",
    kind: "powder",
    density: 3,
    fall: 1,
    slide: 0.85,
    dissolves: 0.12,
    colors: ["#a8814f", "#c9a46a", "#dfc28e"],
    pour: { rate: 1, life: [0, 0], mode: "fill" },
  },
  {
    ...base,
    key: "SEED",
    kind: "powder",
    density: 2.5,
    fall: 1,
    slide: 0.9,
    flammable: 0.25,
    dissolves: 0.2,
    colors: ["#6b5a35", "#8a7444", "#ad9563"],
    pour: { rate: 0.45, life: [0, 0], mode: "fill" },
  },
  {
    ...base,
    key: "SNOW",
    kind: "powder",
    density: 1.5,
    fall: 0.3,
    slide: 0.5,
    dissolves: 0.25,
    colors: ["#c3cfdb", "#dbe3ec", "#eef3f8"],
    pour: { rate: 0.8, life: [0, 0], mode: "fill" },
  },
  {
    ...base,
    key: "GRAVEL",
    kind: "powder",
    density: 3.5,
    fall: 1,
    slide: 0.6,
    dissolves: 0.05,
    colors: ["#34312f", "#4a4542", "#635d58"],
  },
  {
    ...base,
    key: "ASH",
    kind: "powder",
    density: 1.4,
    fall: 0.45,
    slide: 0.6,
    dissolves: 0.3,
    colors: ["#4f4b48", "#67625e", "#807a75"],
  },
  {
    ...base,
    key: "DEBRIS",
    kind: "powder",
    density: 3.2,
    fall: 1,
    slide: 0.7,
    dissolves: 0.08,
    colors: ["#55575c", "#6a6c72", "#808389"],
  },
  {
    ...base,
    key: "WATER",
    kind: "liquid",
    density: 2,
    fall: 1,
    slide: 1,
    spread: 0.95,
    colors: ["#285b8a", "#3874a4", "#5a95c2"],
    alpha: 0.86,
    pour: { rate: 1.2, life: [0, 0], mode: "fill" },
  },
  {
    ...base,
    key: "OIL",
    kind: "liquid",
    density: 1.6,
    fall: 1,
    slide: 1,
    spread: 0.75,
    flammable: 0.5,
    colors: ["#2a2115", "#43341f", "#5f4a2c"],
    alpha: 0.94,
    pour: { rate: 0.9, life: [0, 0], mode: "fill" },
  },
  {
    ...base,
    key: "ACID",
    kind: "liquid",
    density: 2.2,
    fall: 1,
    slide: 1,
    spread: 0.85,
    colors: ["#5f8c34", "#82ad47", "#a8cf66"],
    alpha: 0.88,
    glow: 0.22,
    pour: { rate: 0.6, life: [230, 255], mode: "fill" },
  },
  {
    ...base,
    key: "LAVA",
    kind: "liquid",
    density: 3.3,
    fall: 0.6,
    slide: 0.35,
    spread: 0.18,
    colors: ["#a8361a", "#dd5f28", "#ffa04a"],
    glow: 1,
    pour: { rate: 0.6, life: [200, 255], mode: "ignite" },
  },
  {
    ...base,
    key: "SILT",
    kind: "liquid",
    density: 2.3,
    fall: 0.5,
    slide: 0.8,
    spread: 0.6,
    colors: ["#6f6046", "#8a7856", "#a3906b"],
    alpha: 0.92,
  },
  {
    ...base,
    key: "STEAM",
    kind: "gas",
    density: -3,
    rise: 0.75,
    spread: 0.6,
    colors: ["#b3c0cc", "#c8d3de", "#e0e8ef"],
    alpha: 0.32,
  },
  {
    ...base,
    key: "SMOKE",
    kind: "gas",
    density: -2,
    rise: 0.45,
    spread: 0.5,
    colors: ["#383c43", "#4c5159", "#626872"],
    alpha: 0.55,
  },
  {
    ...base,
    key: "FIRE",
    kind: "gas",
    density: -1,
    rise: 0.55,
    spread: 0.45,
    colors: ["#b8371f", "#ee8338", "#ffd47e"],
    alpha: 0.95,
    glow: 1.15,
    pour: { rate: 1.1, life: [110, 200], mode: "ignite" },
  },
  {
    ...base,
    key: "PLANT",
    kind: "static",
    density: 9,
    flammable: 0.3,
    dissolves: 0.15,
    colors: ["#3c6631", "#4f7b3b", "#6c984b"],
  },
  {
    ...base,
    key: "EMBER",
    kind: "static",
    density: 9,
    colors: ["#5e1f12", "#9c341b", "#d9602b"],
    glow: 0.75,
  },
  { ...base, key: "STONE", kind: "static", density: 9, colors: ["#62656d", "#777a83", "#91959e"] },
  {
    ...base,
    key: "WOOD",
    kind: "static",
    density: 9,
    flammable: 0.04,
    colors: ["#6a4226", "#875833", "#a67347"],
  },
  {
    ...base,
    key: "GLASS",
    kind: "static",
    density: 9,
    colors: ["#6fa6b4", "#9fd0da", "#d8f1f5"],
    alpha: 0.42,
  },
  { ...base, key: "METAL", kind: "static", density: 9, colors: ["#66707b", "#86909c", "#b3bdc8"] },
  {
    ...base,
    key: "ICE",
    kind: "powder",
    density: 1.8,
    fall: 1,
    slide: 0.3,
    dissolves: 0.1,
    colors: ["#86b2c9", "#b2d3e4", "#e0f0f8"],
    alpha: 0.94,
    pour: { rate: 0.8, life: [200, 255], mode: "fill" },
  },
  {
    ...base,
    key: "SALT",
    kind: "powder",
    density: 2.6,
    fall: 1,
    slide: 0.75,
    dissolves: 0.2,
    colors: ["#b3b0a8", "#d6d3cc", "#f2f0ea"],
    pour: { rate: 0.6, life: [0, 0], mode: "fill" },
  },
  {
    ...base,
    key: "KERNEL",
    kind: "powder",
    density: 2.4,
    fall: 1,
    slide: 0.85,
    dissolves: 0.2,
    colors: ["#b5852a", "#d4a43c", "#eec762"],
    pour: { rate: 0.5, life: [0, 0], mode: "fill" },
  },
  {
    ...base,
    key: "POPCORN",
    kind: "powder",
    density: 1.2,
    fall: 0.55,
    slide: 0.5,
    flammable: 0.15,
    dissolves: 0.3,
    colors: ["#ddd1b0", "#f1e8cf", "#fffaf0"],
  },
  {
    ...base,
    key: "SPARK",
    kind: "gas",
    density: -1.5,
    rise: 0.7,
    spread: 0.7,
    colors: ["#ffb347", "#ffd27a", "#fff3c4"],
    glow: 1.3,
  },
];

export const elementDef = (id: ElementId): ElementDef => {
  const def = ELEMENTS[id];
  if (!def) throw new Error(`unknown element ${id}`);
  return def;
};

/** Rule 4: only media that fall, flow or rise straight away may come out of a finger. */
export const isFlowing = (id: ElementId): boolean => {
  const kind = elementDef(id).kind;
  return kind === "powder" || kind === "liquid" || kind === "gas";
};

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Rows of the element property texture, one texel per element per row. */
export const PROPS_ROWS = 6;

/**
 * Element properties as an RGBA32F texture (width = element count), read in the shaders with
 * texelFetch. Rows: (kind, density, fall, slide), (spread, rise, flammable, dissolves),
 * (alpha, glow, scenery, -), then the dark, base and light colours.
 */
export const elementPropsData = (): { width: number; height: number; data: Float32Array } => {
  const width = ELEMENTS.length;
  const data = new Float32Array(width * PROPS_ROWS * 4);
  const put = (row: number, i: number, v: [number, number, number, number]) =>
    data.set(v, (row * width + i) * 4);
  ELEMENTS.forEach((e, i) => {
    put(0, i, [KIND_CODE[e.kind], e.density, e.fall, e.slide]);
    put(1, i, [e.spread, e.rise, e.flammable, e.dissolves]);
    put(2, i, [e.alpha, e.glow, e.scenery ? 1 : 0, 0]);
    e.colors.forEach((hex, k) => put(3 + k, i, [...hexToRgb(hex), 1]));
  });
  return { width, height: PROPS_ROWS, data };
};

/** Texture unit the property texture stays bound to for the life of the context. */
export const PROPS_UNIT = 7;

/**
 * GLSL defines (E_SAND, K_LIQUID, ...) and accessors (KIND(id), DENSITY(id), ...) over the
 * property texture, so the shaders and the CPU never disagree about the table. A texture rather
 * than const arrays: some compilers rebuild a dynamically indexed const array on every use.
 */
export const glslElementTable = (): string => {
  const lines: string[] = [`#define ELEMENT_COUNT ${ELEMENTS.length}`];
  for (const [kind, code] of Object.entries(KIND_CODE)) {
    lines.push(`#define K_${kind.toUpperCase()} ${code}u`);
  }
  ELEMENTS.forEach((e, i) => lines.push(`#define E_${e.key} ${i}u`));
  lines.push(
    "uniform highp sampler2D u_props;",
    "vec4 elementRow(uint id, int row) { return texelFetch(u_props, ivec2(int(id), row), 0); }",
    "#define KIND(id) uint(elementRow(id, 0).x + 0.5)",
    "#define DENSITY(id) elementRow(id, 0).y",
    "#define FALL(id) elementRow(id, 0).z",
    "#define SLIDE(id) elementRow(id, 0).w",
    "#define SPREAD(id) elementRow(id, 1).x",
    "#define RISE(id) elementRow(id, 1).y",
    "#define FLAMMABLE(id) elementRow(id, 1).z",
    "#define DISSOLVES(id) elementRow(id, 1).w",
    "#define ALPHA(id) elementRow(id, 2).x",
    "#define GLOW(id) elementRow(id, 2).y",
    "#define SCENERY(id) (elementRow(id, 2).z > 0.5)",
    "#define COLOR_DARK(id) elementRow(id, 3).rgb",
    "#define COLOR_BASE(id) elementRow(id, 4).rgb",
    "#define COLOR_LIGHT(id) elementRow(id, 5).rgb",
  );
  return lines.join("\n");
};
