/**
 * Every factual line a visitor can read, each with its published sources. A line that doesn't
 * fit changes the layout, not the words. The only other text is "Day" and its number.
 *
 * Sources are cited by author or publisher and year with a URL or DOI, never by affiliation.
 */

export interface Source {
  cite: string;
  /** A URL or DOI link, when there is one. */
  url?: string;
}

export interface Line {
  text: string;
  sources: readonly Source[];
}

const S = {
  smith: {
    cite: "Smith, Avian embryo, Mississippi State University Extension",
    url: "https://www.poultry.msstate.edu/pdf/extension/avian_embryo.pdf",
  },
  hamburger: {
    cite: "Hamburger and Hamilton 1951",
    url: "https://doi.org/10.1002/jmor.1050880104",
  },
  illinoisDays: {
    cite: "University of Illinois Extension, Embryonic development times",
    url: "https://extension.illinois.edu/embryonic-development-times",
  },
  illinoisCandling: {
    cite: "University of Illinois Extension, Candling eggs",
    url: "https://extension.illinois.edu/candling-eggs",
  },
  patten: {
    cite: "Patten 1920, The early embryology of the chick",
    url: "https://embryology.med.unsw.edu.au/embryology/index.php/Book_-_The_Early_Embryology_of_the_Chick_10",
  },
  poultryHub: {
    cite: "Poultry Hub Australia, Embryology of the chicken",
    url: "https://www.poultryhub.org/anatomy-and-physiology/body-systems/embryology-of-the-chicken",
  },
  mueller: {
    cite: "Mueller, Burggren and Tazawa 2015, The physiology of the avian embryo, in Sturkie's Avian Physiology, 6th edition, chapter 32",
  },
  alverson: {
    cite: "Alverson 2017, Candling: shining light on the development of the avian egg",
    url: "https://science.sandiegozoo.org/node/18002",
  },
  cartwright: {
    cite: "Cartwright 2000, Incubating and hatching eggs, Texas Agricultural Extension Service",
    url: "https://aggie-horticulture.tamu.edu/wp-content/uploads/sites/12/2011/02/Lee-Cartwright-Incubating-and-hatching-eggs.pdf",
  },
  ucce: {
    cite: "University of California Cooperative Extension, Placer and Nevada Counties, 2020",
    url: "https://www.ccfruitandnuts.ucanr.edu/sites/default/files/2020-01/318171.pdf",
  },
  alabama: {
    cite: "Macklin and others 2019, Chicken embryo development, Alabama Cooperative Extension",
    url: "https://www.aces.edu/blog/topics/poultry/chicken-embryo-development/",
  },
  farnsworth: {
    cite: "Farnsworth, Hadfield and Longmore 2025, Hatching and caring for chicks, Utah State University Extension",
    url: "https://extension.usu.edu/utah4h/research/hatching-and-caring-for-chicks.pdf",
  },
  bekoff: {
    cite: "Bekoff 1999, Development of motor patterns in avian embryos",
    url: "https://internationalornithology.org/PROCEEDINGS_Durban/Symposium/S46/S46.1.htm",
  },
  vt: {
    cite: "Virginia Cooperative Extension, Chick embryo development",
    url: "https://www.sites.ext.vt.edu/virtualfarm/poultry/poultry_development.html",
  },
  birkhead: {
    cite: "Birkhead 2016, The art of hatching an egg, explained, Audubon",
    url: "https://www.audubon.org/magazine/art-hatching-egg-explained",
  },
  illinoisPdf: {
    cite: "University of Illinois Extension, Embryonic development, days 1-21",
    url: "https://extension.illinois.edu/sites/default/files/embryonic_development_days_1-21.pdf",
  },
} as const satisfies Record<string, Source>;

const line = (text: string, ...sources: Source[]): Line => ({ text, sources });

/** One line for each incubation day, 1 to 21. */
export const DAY_LINES: readonly Line[] = [
  line("A tiny embryo starts to form", S.smith, S.hamburger),
  line("The heart starts to beat", S.illinoisDays, S.patten),
  line("Blood vessels spread like a spider", S.illinoisCandling, S.poultryHub, S.mueller),
  line("A dark eye spot appears", S.poultryHub, S.hamburger),
  line("Tiny wings and legs are growing", S.poultryHub, S.hamburger),
  line("You can see it moving", S.poultryHub, S.alverson),
  line("Veins spread under the shell", S.cartwright, S.mueller),
  line("Feathers begin to form", S.ucce, S.illinoisDays),
  line("It starts to look like a bird", S.ucce, S.poultryHub),
  line("The beak starts to harden", S.smith, S.alabama),
  line("The dark shadow keeps growing", S.cartwright),
  line("Veins now line the whole shell", S.mueller),
  line("Scales and claws appear", S.smith, S.poultryHub),
  line("Its head turns to the big end", S.illinoisDays, S.poultryHub),
  line("The egg looks darker now", S.farnsworth, S.alverson),
  line("The egg white is nearly gone", S.illinoisDays, S.poultryHub),
  line("Its beak points to the air pocket", S.illinoisDays, S.smith),
  line("It tucks its head under its right wing", S.poultryHub, S.bekoff, S.ucce),
  line("It draws the yolk into its body", S.illinoisDays, S.smith),
  line("It breathes air for the first time", S.vt, S.illinoisDays),
  line("It is ready to hatch", S.ucce, S.illinoisDays),
];

export type HatchStep = "external" | "rest" | "zip" | "hatched" | "tired" | "drying";

/**
 * Lines for the hatch, shown in the candling variant once the light comes up. Day 20's line
 * stands in for the internal pip.
 */
export const STEP_LINES: Record<HatchStep, Line> = {
  external: line("Its egg tooth makes a tiny hole", S.vt, S.ucce),
  rest: line("The chick rests for a few hours", S.ucce, S.illinoisPdf),
  zip: line("It turns and chips round the shell", S.ucce, S.birkhead),
  hatched: line("It pushes the top off and hatches", S.ucce),
  tired: line("Wet and tired, it rests", S.vt),
  drying: line("Its wet down dries soft and fluffy", S.ucce, S.vt),
};

export const dayLine = (day: number): Line =>
  DAY_LINES[Math.max(1, Math.min(21, Math.floor(day))) - 1]!;
