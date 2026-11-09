/**
 * The fish and how each kind swims, for the bowl and for the wall's tank. Sizes are about ten
 * times life so the fish read from across the room. In the bowl they are in bowl radii and
 * bowl radii a second; in the tank (`FAUNA`) in metres and metres a second.
 */
export type SpeciesId =
  | "goldfish"
  | "fancy"
  | "tetra"
  | "cory"
  | "puffer"
  | "harlequin"
  | "angel"
  | "gourami"
  | "pleco";

export interface Species {
  id: SpeciesId;
  /** Nose to tail tip. */
  length: number;
  /** Half the body's width, as a fraction of its length: how close its centre may come to the glass. */
  halfWidth: number;
  /** Half the body's height, as a fraction of its length. */
  halfHeight: number;
  /** Usual swimming speeds, slow and quick. */
  cruise: readonly [number, number];
  /** Fastest it goes, in a chase or a rush for food. */
  burst: number;
  /** Fastest turn, radians a second. */
  turn: number;
  /** Heights it likes to swim between. */
  depth: readonly [number, number];
  /** Distance from the centre it likes to keep. */
  radius: number;
  /** Tail beats a second when still, and more per body length a second of speed. */
  beat: number;
  beatPerSpeed: number;
}

export const SPECIES: Record<SpeciesId, Species> = {
  goldfish: {
    id: "goldfish",
    length: 0.3,
    halfWidth: 0.08,
    halfHeight: 0.15,
    cruise: [0.09, 0.16],
    burst: 0.42,
    turn: 1.7,
    depth: [-0.5, 0.36],
    radius: 0.8,
    beat: 0.55,
    beatPerSpeed: 1.5,
  },
  fancy: {
    id: "fancy",
    length: 0.3,
    halfWidth: 0.12,
    halfHeight: 0.19,
    cruise: [0.06, 0.11],
    burst: 0.3,
    turn: 1.4,
    depth: [-0.45, 0.32],
    radius: 0.79,
    beat: 0.7,
    beatPerSpeed: 1.8,
  },
  tetra: {
    id: "tetra",
    length: 0.125,
    halfWidth: 0.05,
    halfHeight: 0.11,
    cruise: [0.11, 0.17],
    burst: 0.5,
    turn: 2.8,
    depth: [-0.5, 0.25],
    radius: 0.8,
    beat: 1.1,
    beatPerSpeed: 1.6,
  },
  cory: {
    id: "cory",
    length: 0.19,
    halfWidth: 0.08,
    halfHeight: 0.13,
    cruise: [0.03, 0.07],
    burst: 0.36,
    turn: 1.8,
    depth: [-0.86, -0.7],
    radius: 0.9,
    beat: 0.9,
    beatPerSpeed: 1.6,
  },
  puffer: {
    id: "puffer",
    length: 0.15,
    halfWidth: 0.14,
    halfHeight: 0.17,
    cruise: [0.05, 0.1],
    burst: 0.3,
    turn: 2.2,
    depth: [-0.45, 0.3],
    radius: 0.84,
    beat: 0.8,
    beatPerSpeed: 1.4,
  },
  harlequin: {
    id: "harlequin",
    length: 0.17,
    halfWidth: 0.05,
    halfHeight: 0.16,
    cruise: [0.1, 0.16],
    burst: 0.48,
    turn: 2.6,
    depth: [-0.3, 0.3],
    radius: 0.8,
    beat: 1.1,
    beatPerSpeed: 1.6,
  },
  angel: {
    id: "angel",
    length: 0.34,
    halfWidth: 0.055,
    halfHeight: 0.3,
    cruise: [0.05, 0.1],
    burst: 0.3,
    turn: 1.3,
    depth: [-0.35, 0.3],
    radius: 0.76,
    beat: 0.45,
    beatPerSpeed: 1.2,
  },
  gourami: {
    id: "gourami",
    length: 0.36,
    halfWidth: 0.06,
    halfHeight: 0.17,
    cruise: [0.05, 0.1],
    burst: 0.32,
    turn: 1.5,
    depth: [-0.2, 0.36],
    radius: 0.78,
    beat: 0.5,
    beatPerSpeed: 1.3,
  },
  pleco: {
    id: "pleco",
    length: 0.36,
    halfWidth: 0.12,
    halfHeight: 0.08,
    cruise: [0.03, 0.06],
    burst: 0.3,
    turn: 1.6,
    depth: [-0.86, -0.6],
    radius: 0.9,
    beat: 0.7,
    beatPerSpeed: 1.4,
  },
};

export type Stock = "few" | "many";

/** Who swims in the bowl: the goldfish bowl's cast, or a community of tropical fish. */
export const castOf = (stock: Stock, variant = "bowl"): SpeciesId[] => {
  if (variant === "community") {
    const n = (k: SpeciesId, count: number) => Array.from({ length: count }, () => k);
    return stock === "many"
      ? [
          ...n("angel", 2),
          ...n("gourami", 2),
          ...n("cory", 4),
          ...n("harlequin", 8),
          ...n("tetra", 10),
        ]
      : [
          ...n("angel", 1),
          ...n("gourami", 1),
          ...n("cory", 3),
          ...n("harlequin", 6),
          ...n("tetra", 8),
        ];
  }
  return stock === "many"
    ? [
        "goldfish",
        "goldfish",
        "fancy",
        "cory",
        "cory",
        "puffer",
        ...Array.from({ length: 10 }, () => "tetra" as const),
      ]
    : ["goldfish", "fancy", "cory", "puffer", ...Array.from({ length: 7 }, () => "tetra" as const)];
};

export const snailsOf = (stock: Stock): number => (stock === "many" ? 2 : 1);

/** Most fish of one kind in any cast, for sizing buffers. */
export const MAX_OF_KIND = 10;

// ---- The tank ---------------------------------------------------------------------------------

/** What a kind does besides swimming about, for the habits and the touch reactions. */
export interface Roles {
  /** Comes up to the front glass and works its lips on it. */
  kiss?: boolean;
  /** Chases one of its own kind round the tank. */
  chase?: boolean;
  /** Does a loop-the-loop. */
  loop?: boolean;
  /** Comes to look at a finger on the glass once the fright is over. */
  curious?: number;
  /** Lives on the ground: grazes, naps, dashes up for a gulp of air. */
  bottom?: boolean;
  /** Clings to the glass, wood and stones with its sucker mouth. */
  clinger?: boolean;
  /** Puffs up into a ball when startled. */
  puff?: boolean;
  /** Feels about with long pelvic threads. */
  feelers?: boolean;
}

export interface Fauna {
  id: SpeciesId;
  /** Nose to tail tip, metres. */
  length: number;
  halfWidth: number;
  halfHeight: number;
  /** Metres a second. */
  cruise: readonly [number, number];
  burst: number;
  turn: number;
  /** Share of the water from the ground (0) to the surface (1) it likes to keep to. */
  zone: readonly [number, number];
  /** Metres behind the front glass it likes to swim. */
  near: readonly [number, number];
  beat: number;
  beatPerSpeed: number;
  /** A shoal: spacing between neighbours in body lengths, and how tightly it keeps together. */
  shoal?: { spacing: number; pull: number };
  /** Flakes it eats before it has had its fill. */
  appetite: number;
  /**
   * How it swims: a steady tail beat, kicks of the tail with glides between (small tetras), or
   * rowing with the pectoral fins with the tail held still (angelfish, gouramis).
   */
  swim: "tail" | "kick" | "fins";
  roles: Roles;
}

/** Sizes from adult lengths at ten times life; speeds from body lengths a second. */
export const FAUNA: Record<SpeciesId, Fauna> = {
  tetra: {
    id: "tetra",
    length: 0.36,
    halfWidth: 0.05,
    halfHeight: 0.11,
    cruise: [0.32, 0.55],
    burst: 1.9,
    turn: 3.2,
    zone: [0.28, 0.62],
    near: [0.5, 2.6],
    beat: 1.4,
    beatPerSpeed: 1.5,
    shoal: { spacing: 1.1, pull: 1 },
    appetite: 2,
    swim: "kick",
    roles: { curious: 0.25 },
  },
  harlequin: {
    id: "harlequin",
    length: 0.45,
    halfWidth: 0.05,
    halfHeight: 0.16,
    cruise: [0.3, 0.5],
    burst: 1.7,
    turn: 3,
    zone: [0.45, 0.78],
    near: [0.6, 2.8],
    beat: 1.3,
    beatPerSpeed: 1.5,
    shoal: { spacing: 1.2, pull: 0.85 },
    appetite: 2,
    swim: "kick",
    roles: { curious: 0.2 },
  },
  angel: {
    id: "angel",
    length: 0.95,
    halfWidth: 0.055,
    halfHeight: 0.3,
    cruise: [0.12, 0.3],
    burst: 1.2,
    turn: 1.5,
    zone: [0.38, 0.8],
    near: [0.8, 2.8],
    beat: 0.6,
    beatPerSpeed: 1.1,
    appetite: 4,
    swim: "fins",
    roles: { kiss: true, chase: true, curious: 0.9 },
  },
  gourami: {
    id: "gourami",
    length: 1.0,
    halfWidth: 0.06,
    halfHeight: 0.17,
    cruise: [0.12, 0.28],
    burst: 1.1,
    turn: 1.6,
    zone: [0.6, 0.94],
    near: [0.6, 2.4],
    beat: 0.6,
    beatPerSpeed: 1.2,
    appetite: 4,
    swim: "fins",
    roles: { kiss: true, chase: true, curious: 1, feelers: true },
  },
  cory: {
    id: "cory",
    length: 0.55,
    halfWidth: 0.08,
    halfHeight: 0.13,
    cruise: [0.1, 0.3],
    burst: 1.3,
    turn: 2.2,
    zone: [0, 0.04],
    near: [0.35, 1.8],
    beat: 1.1,
    beatPerSpeed: 1.6,
    appetite: 5,
    swim: "tail",
    roles: { bottom: true, curious: 0.5 },
  },
  pleco: {
    id: "pleco",
    length: 1.0,
    halfWidth: 0.12,
    halfHeight: 0.08,
    cruise: [0.08, 0.2],
    burst: 0.9,
    turn: 1.6,
    zone: [0, 0.3],
    near: [0.1, 2],
    beat: 0.8,
    beatPerSpeed: 1.3,
    appetite: 3,
    swim: "tail",
    roles: { clinger: true, bottom: true },
  },
  goldfish: {
    id: "goldfish",
    length: 0.85,
    halfWidth: 0.08,
    halfHeight: 0.15,
    cruise: [0.2, 0.38],
    burst: 1.2,
    turn: 1.8,
    zone: [0.2, 0.82],
    near: [0.6, 2.6],
    beat: 0.6,
    beatPerSpeed: 1.4,
    appetite: 4,
    swim: "tail",
    roles: { kiss: true, chase: true, loop: true, curious: 1 },
  },
  fancy: {
    id: "fancy",
    length: 0.85,
    halfWidth: 0.12,
    halfHeight: 0.19,
    cruise: [0.14, 0.26],
    burst: 0.8,
    turn: 1.4,
    zone: [0.2, 0.75],
    near: [0.6, 2.4],
    beat: 0.75,
    beatPerSpeed: 1.7,
    appetite: 4,
    swim: "tail",
    roles: { kiss: true, chase: true, curious: 1 },
  },
  puffer: {
    id: "puffer",
    length: 0.38,
    halfWidth: 0.14,
    halfHeight: 0.17,
    cruise: [0.1, 0.22],
    burst: 0.8,
    turn: 2.4,
    zone: [0.3, 0.7],
    near: [0.4, 2],
    beat: 0.8,
    beatPerSpeed: 1.4,
    appetite: 2,
    swim: "fins",
    roles: { puff: true, curious: 1 },
  },
};

export interface TankCast {
  fish: SpeciesId[];
  shrimp: number;
  snails: number;
}

/** Who lives in the tank. Stocking as for a real tank of about 250 litres. */
export const tankCast = (variant: string, stock: Stock): TankCast => {
  const n = (k: SpeciesId, few: number, many: number) =>
    Array.from({ length: stock === "many" ? many : few }, () => k);
  if (variant === "bowl") {
    return {
      fish: [
        ...n("goldfish", 2, 3),
        ...n("fancy", 1, 2),
        ...n("cory", 3, 4),
        ...n("puffer", 1, 1),
        ...n("tetra", 12, 18),
      ],
      shrimp: 0,
      snails: stock === "many" ? 3 : 2,
    };
  }
  return {
    fish: [
      ...n("angel", 2, 3),
      ...n("gourami", 2, 2),
      ...n("pleco", 1, 2),
      ...n("cory", 5, 7),
      ...n("harlequin", 10, 14),
      ...n("tetra", 18, 26),
    ],
    shrimp: stock === "many" ? 6 : 4,
    snails: stock === "many" ? 3 : 2,
  };
};
