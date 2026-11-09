import type { GraphDef, GraphNodeDef } from "../types";
import { ELEMENTS_ICONS } from "./elements.icons";

type Spec = Omit<GraphNodeDef, "pos">;

const elements: Spec[] = [
  {
    id: "h",
    name: "Hydrogen",
    role: "gas",
    icon: "h",
    note: "The lightest element, a gas that burns.",
  },
  {
    id: "c",
    name: "Carbon",
    role: "solid",
    icon: "c",
    note: "Carbon is in diamonds, pencil lead and every living thing.",
  },
  {
    id: "n",
    name: "Nitrogen",
    role: "gas",
    icon: "n",
    note: "Nitrogen is the gas that makes up most of the air.",
  },
  {
    id: "o",
    name: "Oxygen",
    role: "gas",
    icon: "o",
    note: "Oxygen is the gas in air that we breathe.",
  },
  {
    id: "na",
    name: "Sodium",
    role: "metal",
    icon: "na",
    note: "A soft, shiny metal that reacts strongly with water.",
  },
  {
    id: "cl",
    name: "Chlorine",
    role: "gas",
    icon: "cl",
    note: "Chlorine is added to swimming pools to keep them clean.",
  },
  {
    id: "ca",
    name: "Calcium",
    role: "metal",
    icon: "ca",
    note: "Calcium helps build strong bones and teeth.",
  },
  {
    id: "fe",
    name: "Iron",
    role: "metal",
    icon: "fe",
    note: "Iron is a strong metal used to make steel.",
  },
  {
    id: "si",
    name: "Silicon",
    role: "solid",
    icon: "si",
    note: "Silicon is used to make computer chips.",
  },
  {
    id: "s",
    name: "Sulfur",
    role: "solid",
    icon: "s",
    note: "Sulfur is a yellow solid found near volcanoes.",
  },
  {
    id: "al",
    name: "Aluminium",
    role: "metal",
    icon: "al",
    note: "Aluminium is a light metal used for cans and foil.",
  },
  {
    id: "mg",
    name: "Magnesium",
    role: "metal",
    icon: "mg",
    note: "Magnesium is a light metal that burns with a bright white flame.",
  },
  {
    id: "k",
    name: "Potassium",
    role: "metal",
    icon: "k",
    note: "Plants need potassium to grow, and bananas contain plenty.",
  },
];

/** Each compound with the elements it is made of. */
const compounds: (Spec & { made: string[] })[] = [
  {
    id: "water",
    name: "Water",
    role: "thing",
    icon: "water",
    made: ["h", "o"],
    note: "Two hydrogen atoms and one oxygen atom make a water molecule.",
  },
  {
    id: "salt",
    name: "Table salt",
    role: "thing",
    icon: "salt",
    made: ["na", "cl"],
    note: "Salt is made of sodium and chlorine and adds flavour to food.",
  },
  {
    id: "co2",
    name: "Carbon dioxide",
    role: "thing",
    icon: "co2",
    made: ["c", "o"],
    note: "Carbon dioxide is the gas in fizzy drinks and in our breath.",
  },
  {
    id: "methane",
    name: "Methane",
    role: "thing",
    icon: "methane",
    made: ["c", "h"],
    note: "Methane is the main gas in the natural gas used for cooking.",
  },
  {
    id: "ammonia",
    name: "Ammonia",
    role: "thing",
    icon: "ammonia",
    made: ["n", "h"],
    note: "Ammonia is a sharp-smelling gas used to make fertiliser.",
  },
  {
    id: "soda",
    name: "Baking soda",
    role: "thing",
    icon: "soda",
    made: ["na", "h", "c", "o"],
    note: "Baking soda makes cakes rise by making bubbles of gas.",
  },
  {
    id: "limestone",
    name: "Limestone",
    role: "thing",
    icon: "limestone",
    made: ["ca", "c", "o"],
    note: "Limestone and seashells are mostly calcium carbonate.",
  },
  {
    id: "rust",
    name: "Rust",
    role: "thing",
    icon: "rust",
    made: ["fe", "o"],
    note: "Rust forms when iron meets air and water.",
  },
  {
    id: "sand",
    name: "Quartz",
    role: "thing",
    icon: "sand",
    made: ["si", "o"],
    note: "Quartz, the main mineral in sand, is silicon and oxygen.",
  },
  {
    id: "sugar",
    name: "Sugar",
    role: "thing",
    icon: "sugar",
    made: ["c", "h", "o"],
    note: "Table sugar is made of carbon, hydrogen and oxygen.",
  },
  {
    id: "vinegar",
    name: "Acetic acid",
    role: "thing",
    icon: "vinegar",
    made: ["c", "h", "o"],
    note: "Acetic acid gives vinegar its sour taste.",
  },
  {
    id: "peroxide",
    name: "Peroxide",
    role: "thing",
    icon: "peroxide",
    made: ["h", "o"],
    note: "Hydrogen peroxide is a mild disinfectant that can also lighten hair.",
  },
  {
    id: "laughing",
    name: "Laughing gas",
    role: "thing",
    icon: "laughing",
    made: ["n", "o"],
    note: "Nitrous oxide is a gas dentists use to help patients relax.",
  },
  {
    id: "epsom",
    name: "Epsom salt",
    role: "thing",
    icon: "epsom",
    made: ["mg", "s", "o"],
    note: "Epsom salt is magnesium sulfate, sold as bath salts.",
  },
  {
    id: "sapphire",
    name: "Sapphire",
    role: "thing",
    icon: "sapphire",
    made: ["al", "o"],
    note: "Sapphire is aluminium oxide with tiny traces of other elements.",
  },
  {
    id: "stomach",
    name: "Stomach acid",
    role: "thing",
    icon: "stomach",
    made: ["h", "cl"],
    note: "Your stomach makes hydrochloric acid to help digest food.",
  },
  {
    id: "potash",
    name: "Potash",
    role: "thing",
    icon: "potash",
    made: ["k", "cl"],
    note: "The potash farmers use is mostly potassium chloride, a plant fertiliser.",
  },
];

const edges: [string, string][] = compounds.flatMap((c) =>
  c.made.map((e): [string, string] => [c.id, e]),
);

/**
 * Elements zigzag along the middle, ordered so that the compounds made from neighbours sit
 * close; each compound hangs in one of four rows above and below, under the mean position of
 * its elements and nudged sideways until the labels clear each other. Plain arithmetic, the
 * same on every run.
 */
const ORDER = ["k", "cl", "na", "h", "n", "c", "o", "ca", "fe", "si", "al", "mg", "s"];
const GAP = 2.6;
const ROWS = [6.4, -6.4, 10.6, -10.6];
const LABEL_GAP = 5.5;

function layout() {
  const out = new Map<string, { x: number; y: number }>();
  ORDER.forEach((id, i) => out.set(id, { x: i * GAP, y: i % 2 ? -2.2 : 2.2 }));
  const hung = compounds
    .map((c) => ({ id: c.id, x: c.made.reduce((s, e) => s + out.get(e)!.x, 0) / c.made.length }))
    .sort((a, b) => a.x - b.x);
  ROWS.forEach((y, r) => {
    const row = hung.filter((_, i) => i % ROWS.length === r);
    for (let i = 1; i < row.length; i++) row[i]!.x = Math.max(row[i]!.x, row[i - 1]!.x + LABEL_GAP);
    for (const c of row) out.set(c.id, { x: c.x, y });
  });
  return out;
}

const all: Spec[] = [...elements, ...compounds.map(({ made: _made, ...rest }) => rest)];
const pos = layout();

const graph: GraphDef = {
  id: "elements",
  title: "Elements and everyday things",
  blurb: "Which chemical elements make water, salt, rust, sugar and other familiar things.",
  order: 40,
  caption: "Tap an element or a thing",
  directed: false,
  layout: "fixed",
  edgeMeaning: { in: "", out: "Linked to" },
  sources: [
    "IUPAC periodic table and standard chemistry references (element names, symbols, families).",
    "Chemical formulas of the compounds from standard references such as PubChem and the CRC Handbook of Chemistry and Physics.",
  ],
  roles: [
    { id: "gas", title: "Gas", color: "#56b4e9" },
    { id: "metal", title: "Metal", color: "#e69f00" },
    { id: "solid", title: "Non-metal solid", color: "#009e73" },
    { id: "thing", title: "Everyday compound", color: "#cc79a7" },
  ],
  icons: ELEMENTS_ICONS,
  nodes: all.map((n) => ({ ...n, pos: pos.get(n.id)! })),
  edges,
};

export default graph;
