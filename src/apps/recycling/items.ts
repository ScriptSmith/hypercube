/**
 * What goes in which bin. This is the one place the sorting rules live, so it can be checked
 * line by line. Every item is one whose bin is the same in nearly every Australian council;
 * items councils disagree on are left out (see LEFT_OUT).
 *
 * - `bin`: the right bin.
 * - `tricky`: rides the faster, higher belt (adults) rather than the slow, low one (children).
 * - `simple`: used by the two-bin variant (recycling and rubbish only).
 * - `material`: what a full recycling bin turns into at the plant (see park.ts).
 * - `reason`: why, in one line.
 */

export type BinKind = "recycle" | "compost" | "rubbish" | "dropoff";

export const BIN_KINDS: readonly BinKind[] = ["recycle", "compost", "rubbish", "dropoff"];

export type Material =
  | "metal"
  | "glass"
  | "plastic"
  | "paper"
  | "food"
  | "garden"
  | "battery"
  | "mixed";

export type ItemId =
  | "can"
  | "tin"
  | "jar"
  | "glassBottle"
  | "plasticBottle"
  | "milk"
  | "newspaper"
  | "box"
  | "apple"
  | "banana"
  | "leaves"
  | "bread"
  | "eggshell"
  | "chips"
  | "toy"
  | "foam"
  | "mug"
  | "battery"
  | "phone";

export interface ItemDef {
  id: ItemId;
  bin: BinKind;
  material: Material;
  tricky: boolean;
  simple: boolean;
  reason: string;
}

export const ITEMS: readonly ItemDef[] = [
  // Recycling (yellow lid)
  {
    id: "can",
    bin: "recycle",
    material: "metal",
    tricky: false,
    simple: true,
    reason: "Aluminium drink cans melt down into new cans again and again.",
  },
  {
    id: "tin",
    bin: "recycle",
    material: "metal",
    tricky: true,
    simple: false,
    reason: "Steel food tins are taken by every council's recycling and made into new steel.",
  },
  {
    id: "jar",
    bin: "recycle",
    material: "glass",
    tricky: true,
    simple: false,
    reason: "Glass jars are melted into new jars and bottles.",
  },
  {
    id: "glassBottle",
    bin: "recycle",
    material: "glass",
    tricky: false,
    simple: true,
    reason: "Glass bottles are melted into new bottles and jars.",
  },
  {
    id: "plasticBottle",
    bin: "recycle",
    material: "plastic",
    tricky: false,
    simple: true,
    reason: "Plastic drink bottles are made into new bottles and other plastic things.",
  },
  {
    id: "milk",
    bin: "recycle",
    material: "plastic",
    tricky: true,
    simple: false,
    reason: "Plastic milk bottles are firm plastic that every council's recycling takes.",
  },
  {
    id: "newspaper",
    bin: "recycle",
    material: "paper",
    tricky: false,
    simple: true,
    reason: "Newspaper is pulped and made into new paper.",
  },
  {
    id: "box",
    bin: "recycle",
    material: "paper",
    tricky: false,
    simple: true,
    reason: "Clean, flattened cardboard is pulped and made into new boxes.",
  },
  // Compost (lime green lid)
  {
    id: "apple",
    bin: "compost",
    material: "food",
    tricky: false,
    simple: false,
    reason: "Fruit scraps rot down into compost.",
  },
  {
    id: "banana",
    bin: "compost",
    material: "food",
    tricky: false,
    simple: false,
    reason: "Banana peel rots down into compost.",
  },
  {
    id: "leaves",
    bin: "compost",
    material: "garden",
    tricky: false,
    simple: false,
    reason: "Leaves and twigs from the garden rot down into compost.",
  },
  {
    id: "bread",
    bin: "compost",
    material: "food",
    tricky: true,
    simple: false,
    reason: "Stale bread is food scraps, and food scraps rot down into compost.",
  },
  {
    id: "eggshell",
    bin: "compost",
    material: "food",
    tricky: true,
    simple: false,
    reason: "Eggshells break down in compost and add goodness to the soil.",
  },
  // Rubbish (red lid)
  {
    id: "chips",
    bin: "rubbish",
    material: "mixed",
    tricky: true,
    simple: true,
    reason:
      "Chip packets are plastic and foil stuck together, which kerbside recycling can't take.",
  },
  {
    id: "toy",
    bin: "rubbish",
    material: "mixed",
    tricky: false,
    simple: true,
    reason: "A broken plastic toy is mixed materials that kerbside recycling can't take.",
  },
  {
    id: "foam",
    bin: "rubbish",
    material: "mixed",
    tricky: true,
    simple: true,
    reason: "Kerbside recycling doesn't take polystyrene foam, so it goes in the rubbish.",
  },
  {
    id: "mug",
    bin: "rubbish",
    material: "mixed",
    tricky: true,
    simple: false,
    reason: "A broken mug is ceramic, not glass, and it spoils glass recycling.",
  },
  // Drop-off (blue box)
  {
    id: "battery",
    bin: "dropoff",
    material: "battery",
    tricky: true,
    simple: false,
    reason: "Batteries can start fires in bins and trucks; they go to a battery drop-off.",
  },
  {
    id: "phone",
    bin: "dropoff",
    material: "battery",
    tricky: true,
    simple: false,
    reason: "Phones hold a battery and precious metals; they go to a phone drop-off.",
  },
];

/**
 * Left out because councils disagree, so a child could learn the wrong rule for their own bin.
 * Not used by the game; kept here so the list can be reviewed in one place.
 */
export const LEFT_OUT: readonly { item: string; why: string }[] = [
  { item: "Coffee cups", why: "Most councils say rubbish; some take them in recycling." },
  {
    item: "Pizza boxes",
    why: "Some councils take greasy boxes in recycling or compost, some not.",
  },
  { item: "Milk and juice cartons", why: "Accepted in recycling by many councils but not all." },
  { item: "Aerosol cans", why: "Some councils take empty ones in recycling, others don't." },
  { item: "Soft plastic bags", why: "A few councils now collect them; most say rubbish." },
  { item: "Used tissues", why: "Rubbish in most councils, but food and garden bins take them." },
  { item: "Bottle lids", why: "Councils differ on lids on or off and on small loose lids." },
];

/** Bins a variant uses, left to right where they stand in a row. */
export const binsFor = (variant: "sort" | "simple"): BinKind[] =>
  variant === "simple" ? ["recycle", "rubbish"] : [...BIN_KINDS];

/** Indices into ITEMS that a variant uses. */
export const itemsFor = (variant: "sort" | "simple"): number[] =>
  ITEMS.flatMap((it, i) => (variant === "simple" ? (it.simple ? [i] : []) : [i]));

export const itemIndex = (id: ItemId): number => ITEMS.findIndex((it) => it.id === id);

/** Lid colours follow the usual Australian household bins; the drop-off box is blue. */
export const BIN_LOOK: Record<BinKind, { lid: string; glow: string; body: string }> = {
  recycle: { lid: "#f4cf1f", glow: "#ffe766", body: "#2d3b3f" },
  compost: { lid: "#8fd43a", glow: "#c3f27a", body: "#2d3b3f" },
  rubbish: { lid: "#e2382f", glow: "#ff7a6e", body: "#2d3b3f" },
  dropoff: { lid: "#2f7ff0", glow: "#79b3ff", body: "#1f4f9c" },
};
