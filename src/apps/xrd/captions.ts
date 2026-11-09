/**
 * Every word a visitor can read: headlines, captions, "So" lines, the Maths folds, date tags,
 * use tiles and control labels, chapter by chapter.
 *
 * The text rule: headlines are short questions; captions and "So" lines are one sentence each,
 * in sentence case, with no em-dashes. Every factual line carries its sources, textbooks and
 * papers for the physics and the papers and pages behind each history and use line, cited by
 * author or publisher with a URL, DOI or ISBN, never by affiliation.
 *
 * Each chapter's block is self-contained.
 */
import type { ChapterId } from "./ids";

export interface Source {
  cite: string;
  /** A DOI or page; a book without one gives its ISBN instead. */
  url?: string;
  isbn?: string;
}

export interface Line {
  text: string;
  /** The textbooks, papers and pages the line rests on. */
  sources?: readonly Source[];
}

/** One run of a formula; `part` links it to its counterpart in the figure. */
export interface FormulaRun {
  t: string;
  part?: string;
  /** Italic, as for a variable. Default: italic for single Latin letters. */
  italic?: boolean;
  sup?: boolean;
  sub?: boolean;
}

export interface Symbol {
  /** The symbol as it appears in the formula. */
  sym: string;
  part?: string;
  /** What it is, with units. */
  text: string;
}

export interface MathsText {
  formula: readonly FormulaRun[];
  symbols: readonly Symbol[];
  /** At most a couple of extra lines, shown under the symbols. */
  notes?: readonly Line[];
}

export interface UseTile {
  id: string;
  title: string;
  line: Line;
}

export interface ChapterText {
  id: ChapterId;
  number: number;
  headline: string;
  caption: Line;
  so: Line;
  /** The move, in a few words, by the main control: the bank's wayfinding and the ghost hand. */
  verb: string;
  /** Who found it and when. */
  tag?: Line;
  maths: MathsText;
  /** Control labels and other short words the chapter draws. */
  labels: Readonly<Record<string, string>>;
  /** Further sentences the chapter shows at times, one each. */
  more?: Readonly<Record<string, Line>>;
  uses?: readonly UseTile[];
}

/** Words the poster shell uses. */
export const COMMON = {
  title: "X-Ray Diffraction",
  subtitle: "How X-rays show us the atoms inside a crystal",
  maths: "Maths",
  back: "Back",
  next: "Next",
  /** The tag on every map worked out by our own script rather than measured. */
  simulated: "Simulated data",
  /** The screen's headline beside the simulated powder map. */
  mapHeadline: "Rings from a powder of tiny crystals",
  flat: "A flat model",
  /** The machine's parts, named on the screen and the wall's banner. */
  parts: {
    tube: "X-ray tube",
    sample: "Sample",
    stage: "Goniometer",
    detector: "Detector",
    computer: "Computer",
    fibre: "Fibre",
    cards: "Fingerprints",
  },
} as const;

/** Sources, by author or publisher with a URL, DOI or ISBN. History and uses first. */
const SRC = {
  rontgenBio: {
    cite: "Nobel Prize Outreach, Wilhelm Conrad Röntgen: Biographical",
    url: "https://www.nobelprize.org/prizes/physics/1901/rontgen/biographical/",
  },
  rontgenFacts: {
    cite: "Nobel Prize Outreach, Wilhelm Conrad Röntgen: Facts",
    url: "https://www.nobelprize.org/prizes/physics/1901/rontgen/facts/",
  },
  physicsFacts: {
    cite: "Nobel Prize Outreach, Facts on the Nobel Prize in Physics",
    url: "https://www.nobelprize.org/prizes/facts/facts-on-the-nobel-prize-in-physics/",
  },
  braggFacts: {
    cite: "Nobel Prize Outreach, Lawrence Bragg: Facts",
    url: "https://www.nobelprize.org/prizes/physics/1915/wl-bragg/facts/",
  },
  braggBio: {
    cite: "Nobel Prize Outreach, Lawrence Bragg: Biographical",
    url: "https://www.nobelprize.org/prizes/physics/1915/wl-bragg/biographical/",
  },
  bragg1912: {
    cite: "W. L. Bragg (1912), The diffraction of short electromagnetic waves by a crystal, facsimile in A. M. Glazer and J. Jenkin's centenary booklet",
    url: "https://xtal.iqf.csic.es/Cristalografia/archivos_10/Bragg-firstpaper-mini.pdf",
  },
  bragg1913: {
    cite: "W. L. Bragg (1913), The structure of some crystals as indicated by their diffraction of X-rays, Proc. R. Soc. A 89, 248",
    url: "https://doi.org/10.1098/rspa.1913.0083",
  },
  braggDiamond: {
    cite: "W. H. Bragg and W. L. Bragg (1913), The structure of the diamond, Proc. R. Soc. A 89, 277",
    url: "https://doi.org/10.1098/rspa.1913.0084",
  },
  earliest: {
    cite: "Special collections, The earliest determinations of crystal structure",
    url: "https://library.leeds.ac.uk/special-collections/research-spotlight/2062",
  },
  spectrometer: {
    cite: "Special collections, The X-ray spectrometer",
    url: "https://library.leeds.ac.uk/special-collections/research-spotlight/2061",
  },
  laue1912: {
    cite: "W. Friedrich, P. Knipping and M. Laue (1912), Interferenz-Erscheinungen bei Röntgenstrahlen",
    url: "https://publikationen.badw.de/en/003395746/003395746.pdf",
  },
  laueFacts: {
    cite: "Nobel Prize Outreach, Max von Laue: Facts",
    url: "https://www.nobelprize.org/prizes/physics/1914/laue/facts/",
  },
  pietzsch: {
    cite: "J. Pietzsch, X-ray's identity becomes crystal clear",
    url: "https://www.nobelprize.org/prizes/physics/1914/perspectives/",
  },
  braggLecture: {
    cite: "W. L. Bragg (1922), The diffraction of X-rays by crystals, Nobel lecture",
    url: "https://www.nobelprize.org/uploads/2018/06/wl-bragg-lecture.pdf",
  },
  hodgkinFacts: {
    cite: "Nobel Prize Outreach, Dorothy Crowfoot Hodgkin: Facts",
    url: "https://www.nobelprize.org/prizes/chemistry/1964/hodgkin/facts/",
  },
  insulin: {
    cite: "M. J. Adams et al. (1969), Structure of rhombohedral 2 zinc insulin crystals, Nature 224, 491",
    url: "https://doi.org/10.1038/224491a0",
  },
  sutton: {
    cite: "B. Sutton (2023), The story behind Photograph 51",
    url: "https://www.kcl.ac.uk/the-story-behind-photograph-51",
  },
  franklin: {
    cite: "R. E. Franklin and R. G. Gosling (1953), Molecular configuration in sodium thymonucleate, Nature 171, 740",
    url: "https://doi.org/10.1038/171740a0",
  },
  hull: {
    cite: "A. W. Hull (1919), A new method of chemical analysis, J. Am. Chem. Soc. 41, 1168",
    url: "https://doi.org/10.1021/ja02229a003",
  },
  hubbard: {
    cite: "C. R. Hubbard (2017), 100 years since Albert W. Hull's contributions to powder diffraction, Powder Diffraction 32, 1",
    url: "https://doi.org/10.1017/S0885715616000798",
  },
  pdb: {
    cite: "PDB-101, Methods for determining structure",
    url: "https://pdb101.rcsb.org/learn/guide-to-understanding-pdb-data/methods-for-determining-structure",
  },
  hiv: {
    cite: "A. Wlodawer and J. Vondrasek (1998), Inhibitors of HIV-1 protease, Annu. Rev. Biophys. Biomol. Struct. 27, 249",
    url: "https://doi.org/10.1146/annurev.biophys.27.1.249",
  },
  jpl: {
    cite: "NASA JPL (30 October 2012), NASA rover's first soil studies help fingerprint Martian minerals",
    url: "https://www.jpl.nasa.gov/news/nasa-rovers-first-soil-studies-help-fingerprint-martian-minerals/",
  },
  chemin: {
    cite: "PDS Geosciences Node, CheMin help page",
    url: "https://an.rsl.wustl.edu/help/Content/About%20the%20mission/MSL/Instruments/CheMin.htm",
  },
  bish: {
    cite: "D. L. Bish et al. (2013), X-ray diffraction results from Mars Science Laboratory, Science 341, 1238932",
    url: "https://doi.org/10.1126/science.1238932",
  },
  kendall: {
    cite: "O. Kendall et al. (2022), Residual stress measurement techniques for metal joints, metallic coatings and components in the railway industry, Materials 16, 232",
    url: "https://doi.org/10.3390/ma16010232",
  },
  liu: {
    cite: "H. Liu et al. (2014), Capturing metastable structures during high-rate cycling of LiFePO4 nanoparticle electrodes, Science 344, 1252817",
    url: "https://doi.org/10.1126/science.1252817",
  },
  deMeyer: {
    cite: "S. De Meyer et al. (2019), Macroscopic x-ray powder diffraction imaging, Science Advances 5, eaax1975",
    url: "https://doi.org/10.1126/sciadv.aax1975",
  },
  bauer: {
    cite: "J. Bauer et al. (2001), Ritonavir: an extraordinary example of conformational polymorphism, Pharm. Res. 18, 859",
    url: "https://doi.org/10.1023/A:1011052932607",
  },
  stutzman: {
    cite: "P. E. Stutzman, P. Feng and J. W. Bullard (2016), Phase analysis of portland cement, J. Res. NIST 121, 47",
    url: "https://doi.org/10.6028/jres.121.004",
  },
  // Textbooks and papers behind the physics lines.
  cullity: {
    cite: "B. D. Cullity and S. R. Stock (2001), Elements of X-Ray Diffraction, 3rd ed., Prentice Hall",
    isbn: "9780201610918",
  },
  alsNielsen: {
    cite: "J. Als-Nielsen and D. McMorrow (2011), Elements of Modern X-ray Physics, 2nd ed., Wiley",
    url: "https://doi.org/10.1002/9781119998365",
  },
  hecht: {
    cite: "E. Hecht (2017), Optics, 5th ed., Pearson",
    isbn: "9780133977226",
  },
  he2018: {
    cite: "B. B. He (2018), Two-Dimensional X-Ray Diffraction, 2nd ed., Wiley",
    url: "https://doi.org/10.1002/9781119356080",
  },
  busingLevy: {
    cite: "W. R. Busing and H. A. Levy (1967), Angle calculations for 3- and 4-circle X-ray and neutron diffractometers, Acta Cryst. 22, 457",
    url: "https://doi.org/10.1107/S0365110X67000970",
  },
  holzer: {
    cite: "G. Hölzer, M. Fritsch, M. Deutsch, J. Härtwig and E. Förster (1997), Kα1,2 and Kβ1,3 x-ray emission lines of the 3d transition metals, Phys. Rev. A 56, 4554",
    url: "https://doi.org/10.1103/PhysRevA.56.4554",
  },
  cochran: {
    cite: "W. Cochran, F. H. C. Crick and V. Vand (1952), The structure of synthetic polypeptides. I. The transform of atoms on a helix, Acta Cryst. 5, 581",
    url: "https://doi.org/10.1107/S0365110X52001635",
  },
  thompson: {
    cite: "J. Thompson et al. (2018), Rosalind Franklin's X-ray photo of DNA as an undergraduate optical diffraction experiment, Am. J. Phys. 86, 95",
    url: "https://doi.org/10.1119/1.5020051",
  },
  hodgkinB12: {
    cite: "D. C. Hodgkin et al. (1956), Structure of vitamin B12, Nature 178, 64",
    url: "https://doi.org/10.1038/178064a0",
  },
  oppenheim: {
    cite: "A. V. Oppenheim and J. S. Lim (1981), The importance of phase in signals, Proc. IEEE 69, 529",
    url: "https://doi.org/10.1109/PROC.1981.12022",
  },
  flowers: {
    cite: "P. Flowers, K. Theopold, R. Langley and W. R. Robinson (2019), Chemistry 2e, OpenStax, section 2.3",
    url: "https://openstax.org/books/chemistry-2e/pages/2-3-atomic-structure-and-symbolism",
  },
  drenth: {
    cite: "J. Drenth (2007), Principles of Protein X-ray Crystallography, 3rd ed., Springer",
    url: "https://doi.org/10.1007/0-387-33746-6",
  },
} satisfies Record<string, Source>;

export const TEXT: Readonly<Record<ChapterId, ChapterText>> = {
  // ---- 1 -------------------------------------------------------------------------------------
  spectrum: {
    id: "spectrum",
    number: 1,
    headline: "How long is an X-ray?",
    caption: {
      text: "The X-rays used to study crystals are about as long as an atom is wide.",
      sources: [SRC.cullity, SRC.flowers],
    },
    so: {
      text: "Visible light is thousands of times longer than an X-ray, far too long to measure the gaps between atoms.",
      sources: [SRC.hecht, SRC.cullity],
    },
    tag: {
      text: "In 1895 Wilhelm Röntgen discovered X-rays, and in 1901 he won the very first Nobel Prize in Physics.",
      sources: [SRC.rontgenBio, SRC.rontgenFacts, SRC.physicsFacts],
    },
    verb: "Slide the wave",
    maths: {
      formula: [{ t: "E", part: "E" }, { t: " = 12.398 keV·Å / " }, { t: "λ", part: "lam" }],
      symbols: [
        { sym: "E", part: "E", text: "the energy of one X-ray, in keV" },
        { sym: "λ", part: "lam", text: "the wavelength, in Å (copper gives 1.5406 Å)" },
      ],
      notes: [
        {
          text: "In a lab, electrons fired at a metal make X-rays, brightest at a few wavelengths that belong to that metal.",
          sources: [SRC.holzer, SRC.cullity],
        },
      ],
    },
    labels: {
      slider: "Wavelength",
      radio: "Radio",
      microwave: "Microwave",
      microwaveShort: "Micro",
      infrared: "Infrared",
      infraredShort: "IR",
      visible: "Visible light",
      visibleShort: "Light",
      ultraviolet: "Ultraviolet",
      ultravioletShort: "UV",
      xray: "X-rays",
      gamma: "Gamma rays",
      gammaMid: "Gamma",
      gammaShort: "γ",
      house: "A house",
      person: "A person",
      bee: "A bee",
      cell: "A cell",
      virus: "A virus",
      atom: "An atom",
      copper: "Copper",
      cobalt: "Cobalt",
      molybdenum: "Molybdenum",
      tubes: "X-ray tubes",
      atomHere: "An atom, too small to see here",
    },
  },

  // ---- 2 -------------------------------------------------------------------------------------
  interference: {
    id: "interference",
    number: 2,
    headline: "Can light cancel light?",
    caption: {
      text: "Waves in step add up, and waves half a wave apart cancel out.",
      sources: [SRC.hecht],
    },
    so: {
      text: "Moving one wave by just half a wavelength turns bright into dark.",
      sources: [SRC.hecht],
    },
    verb: "Turn the dial",
    maths: {
      formula: [
        { t: "y", part: "y" },
        { t: " = " },
        { t: "A", part: "A" },
        { t: " sin(360° · " },
        { t: "x", part: "x" },
        { t: "/" },
        { t: "λ", part: "lam" },
        { t: " + " },
        { t: "φ", part: "phi" },
        { t: ")" },
      ],
      symbols: [
        { sym: "A", part: "A", text: "how tall the wave is" },
        { sym: "λ", part: "lam", text: "the wavelength" },
        {
          sym: "φ",
          part: "phi",
          text: "how far this wave is pushed along, in degrees (360° is one wave)",
        },
      ],
      notes: [
        {
          text: "Two waves pushed φ apart add up to a wave 2A cos(φ/2) tall.",
          sources: [SRC.hecht],
        },
        {
          text: "A detector sees brightness, which goes as the height squared.",
          sources: [SRC.hecht],
        },
      ],
    },
    labels: {
      dial: "Push the wave",
      wave1: "Wave 1",
      wave2: "Wave 2",
      together: "Together",
      y1: "y₁",
      y2: "y₂",
      sum: "y₁ + y₂",
      slits: "Two slits",
      screen: "Screen",
      lam: "Wavelength",
      bright: "Bright",
      dark: "Dark",
      inStep: "In step",
      halfApart: "Half a wave apart",
    },
  },

  // ---- 3 -------------------------------------------------------------------------------------
  crystal: {
    id: "crystal",
    number: 3,
    headline: "What is a crystal?",
    caption: {
      text: "A crystal is one small group of atoms, called a repeat, copied over and over.",
      sources: [SRC.cullity, SRC.alsNielsen],
    },
    so: {
      text: "Because the pattern repeats, the atoms line up in flat layers that are all the same distance apart.",
      sources: [SRC.cullity],
    },
    tag: {
      text: "In 1913 Lawrence Bragg used X-rays to work out where the atoms sit in salt, and with his father William, in diamond.",
      sources: [SRC.bragg1913, SRC.braggDiamond, SRC.earliest],
    },
    verb: "Pick a crystal",
    maths: {
      formula: [
        { t: "d", part: "d" },
        { t: " = " },
        { t: "a", part: "a" },
        { t: " / √(" },
        { t: "h² + k² + l²", part: "hkl" },
        { t: ")" },
      ],
      symbols: [
        { sym: "d", part: "d", text: "the gap between layers, in Å" },
        { sym: "a", part: "a", text: "the edge of one repeat, in Å" },
        { sym: "(h k l)", part: "hkl", text: "whole numbers that name a family of layers" },
      ],
      notes: [
        {
          text: "This formula is for crystals whose repeat is a cube, like salt, foil and diamond.",
          sources: [SRC.cullity],
        },
      ],
    },
    labels: {
      salt: "Table salt",
      foil: "Foil",
      diamond: "Diamond",
      lead: "Pencil lead",
      ice: "Ice",
      sand: "Sand",
      layers: "Layers",
      repeat: "One repeat",
      gap: "Layer gap",
    },
  },

  // ---- 4 -------------------------------------------------------------------------------------
  bragg: {
    id: "bragg",
    number: 4,
    headline: "Why do crystals flash?",
    caption: {
      text: "Each layer scatters a little, and at just the right angle all the scattered waves add up into a flash.",
      sources: [SRC.cullity, SRC.alsNielsen],
    },
    so: {
      text: "At each flash the extra distance is a whole number of waves, so all the waves are back in step.",
      sources: [SRC.cullity, SRC.alsNielsen],
    },
    tag: {
      text: "Lawrence Bragg, born in Adelaide, worked this out in 1912, and at 25 he shared the 1915 Nobel Prize with his father.",
      sources: [SRC.braggFacts, SRC.braggBio, SRC.bragg1912],
    },
    verb: "Turn the crystal",
    maths: {
      formula: [
        { t: "n", part: "n" },
        { t: "λ", part: "lam" },
        { t: " = " },
        { t: "2", part: "path" },
        { t: "d", part: "d" },
        { t: " sin ", part: "path" },
        { t: "θ", part: "theta" },
      ],
      symbols: [
        { sym: "n", part: "n", text: "a whole number of waves" },
        { sym: "λ", part: "lam", text: "the X-rays' wavelength, in Å" },
        { sym: "d", part: "d", text: "the gap between layers, in Å" },
        { sym: "θ", part: "theta", text: "the angle between the beam and the layers" },
        {
          sym: "2d sin θ",
          part: "path",
          text: "the extra distance the lower layer's wave travels, in Å",
        },
      ],
      notes: [
        {
          text: "The detector's record reads 2θ, the angle between the beam and the flash.",
          sources: [SRC.cullity],
        },
      ],
    },
    more: {
      gap: {
        text: "The angle of each flash tells you the gap between the layers.",
        sources: [SRC.cullity],
      },
    },
    labels: {
      wheel: "Turn the crystal",
      gap: "Layer gap",
      tube: "X-rays",
      copper: "Copper",
      cobalt: "Cobalt",
      molybdenum: "Molybdenum",
      layers: "Layers",
      axis: "Detector angle",
      flash: "Flash!",
      extra: "Extra distance",
      wave: "wave",
      waves: "waves",
    },
  },

  // ---- 5 -------------------------------------------------------------------------------------
  goniometer: {
    id: "goniometer",
    number: 5,
    headline: "How does the machine aim?",
    caption: {
      text: "The machine turns, tilts and spins the crystal, and swings the detector, to catch each flash.",
      sources: [SRC.he2018],
    },
    so: {
      text: "Each new angle brings new flashes into view.",
      sources: [SRC.alsNielsen, SRC.he2018],
    },
    tag: {
      text: "Over the winter of 1912 to 1913 William Henry Bragg designed an X-ray spectrometer, an early machine of this kind.",
      sources: [SRC.spectrometer],
    },
    verb: "Turn the crystal",
    maths: {
      formula: [
        { t: "s", part: "out" },
        { t: "out", part: "out", sub: true },
        { t: " = " },
        { t: "G", part: "G" },
        { t: " + " },
        { t: "s", part: "in" },
        { t: "in", part: "in", sub: true },
      ],
      symbols: [
        { sym: "G", part: "G", text: "a point of the crystal's pattern, in Å⁻¹" },
        { sym: "s in", part: "in", text: "the beam, an arrow 1/λ long" },
        { sym: "s out", part: "out", text: "a flash, which must also be 1/λ long" },
      ],
      notes: [
        {
          text: "Turning ω swings the lattice about the main axis, χ tilts it sideways about a line across its surface, and φ spins it about the sample's own normal.",
          sources: [SRC.he2018, SRC.busingLevy],
        },
      ],
    },
    labels: {
      omega: "Turn",
      chi: "Tilt",
      phi: "Spin",
      arm: "Arm",
      distance: "Distance",
      strip: "Curved strip",
      copper: "Copper",
      cobalt: "Cobalt",
      molybdenum: "Molybdenum",
      unit: "mm",
      plate: "Flat plate",
      nextTube: "Next tube",
      flashAt: "Flash at",
    },
  },

  // ---- 6 -------------------------------------------------------------------------------------
  patterns: {
    id: "patterns",
    number: 6,
    headline: "Spots or rings?",
    caption: {
      text: "One crystal makes spots, and a powder of tiny crystals makes rings.",
      sources: [SRC.cullity, SRC.alsNielsen],
    },
    so: {
      text: "Grinding the crystal to powder smears its spots round their circles into rings.",
      sources: [SRC.cullity, SRC.alsNielsen],
    },
    tag: {
      text: "In 1912 Walter Friedrich, Paul Knipping and Max von Laue shone X-rays through a crystal and got spots, showing that X-rays are waves.",
      sources: [SRC.laue1912, SRC.laueFacts, SRC.pietzsch],
    },
    verb: "Grind it to powder",
    maths: {
      formula: [{ t: "|S|", part: "S" }, { t: " = 1 / " }, { t: "d", part: "d" }],
      symbols: [
        { sym: "|S|", part: "S", text: "how far a ring is from the middle, in Å⁻¹" },
        { sym: "d", part: "d", text: "the gap between layers, in Å" },
      ],
      notes: [
        {
          text: "A ring's radius is the same whichever way the grains face.",
          sources: [SRC.cullity, SRC.alsNielsen],
        },
        {
          text: "A still crystal shows only a few of these spots at a time; turning it brings in the rest.",
          sources: [SRC.alsNielsen, SRC.cullity],
        },
      ],
    },
    labels: {
      crush: "Grind to powder",
      crushShort: "Grind",
      mend: "New crystal",
      line: "Line them up",
      random: "Any way",
      aligned: "All one way",
      map: "Lifelike",
      layers: "One set of layers",
    },
    more: {
      arcs: {
        text: "Grains that mostly face one way, as in kitchen foil, make arcs.",
        sources: [SRC.cullity],
      },
    },
  },

  // ---- 7 -------------------------------------------------------------------------------------
  inverse: {
    id: "inverse",
    number: 7,
    headline: "Why do small things make big patterns?",
    caption: {
      text: "The closer together the atoms, the farther apart the spots.",
      sources: [SRC.alsNielsen, SRC.cullity],
    },
    so: {
      text: "Squash the crystal one way and its pattern stretches the other way.",
      sources: [SRC.alsNielsen],
    },
    verb: "Squash it",
    maths: {
      formula: [{ t: "spacing", part: "S" }, { t: " = 1 / " }, { t: "a", part: "a" }],
      symbols: [
        { sym: "a", part: "a", text: "the gap between atoms, in Å" },
        { sym: "1/a", part: "S", text: "the gap between spots, in Å⁻¹" },
        { sym: "L", text: "the crystal's narrower width, in Å" },
      ],
      notes: [
        {
          text: "A crystal L across makes spots about 1/L wide.",
          sources: [SRC.alsNielsen, SRC.cullity],
        },
        {
          text: "Many books use Q = 2πS instead, which makes every Å⁻¹ number 2π times bigger.",
          sources: [SRC.alsNielsen],
        },
      ],
    },
    more: {
      repeats: {
        text: "A crystal with fewer repeats makes fatter spots.",
        sources: [SRC.alsNielsen, SRC.cullity],
      },
    },
    labels: {
      tall: "Tall",
      square: "Square",
      wide: "Wide",
      repeats: "Repeats",
      layers: "One set of layers",
    },
  },

  // ---- 8 -------------------------------------------------------------------------------------
  absences: {
    id: "absences",
    number: 8,
    headline: "Why are some spots missing?",
    caption: {
      text: "Where the atoms sit inside each repeat decides which spots shine and which vanish.",
      sources: [SRC.cullity],
    },
    so: {
      text: "With a matching atom in the middle of each repeat, every other spot cancels out.",
      sources: [SRC.cullity],
    },
    verb: "Drag an atom in",
    maths: {
      formula: [
        { t: "F", part: "F" },
        { t: " = Σ " },
        { t: "f", part: "f" },
        { t: " exp(2πi(" },
        { t: "hx + ky", part: "pos" },
        { t: "))" },
      ],
      symbols: [
        { sym: "F", part: "F", text: "the arrow sum for one spot; its brightness is |F|²" },
        { sym: "f", part: "f", text: "how strongly one atom scatters, in electrons" },
        { sym: "x, y", part: "pos", text: "where the atom sits in the repeat, as fractions" },
      ],
      notes: [
        {
          text: "In three dimensions, as for aluminium, each spot has three numbers (h k l) and the sum gains lz.",
          sources: [SRC.cullity],
        },
      ],
    },
    more: {
      kcl: {
        text: "Both kinds of atom in potassium chloride have 18 electrons, so its pattern looks like that of a cube half as wide.",
        sources: [SRC.braggLecture, SRC.bragg1913, SRC.cullity],
      },
      aluminium: {
        text: "Aluminium's atoms sit at the corners and the middle of each face, so whole rings go missing.",
        sources: [SRC.cullity],
      },
    },
    labels: {
      mine: "Your atoms",
      mineShort: "Yours",
      aluminium: "Aluminium",
      kcl: "Potassium chloride",
      kclShort: "KCl",
      spot: "Spot",
      empty: "Empty",
      heavy: "Heavy",
      light: "Light",
      potassium: "K",
      chlorine: "Cl",
      layers: "One set of layers",
      computed: "Worked out from its atoms",
    },
  },

  // ---- 9 -------------------------------------------------------------------------------------
  synthesis: {
    id: "synthesis",
    number: 9,
    headline: "Can we turn spots back into atoms?",
    caption: {
      text: "Each spot is a ripple across the crystal, and adding the ripples together makes the atoms appear.",
      sources: [SRC.alsNielsen, SRC.drenth],
    },
    so: {
      text: "The more spots you add, the sharper the atoms become.",
      sources: [SRC.drenth],
    },
    tag: {
      text: "Dorothy Hodgkin used X-rays to find the shapes of penicillin and vitamin B12, won the 1964 Nobel Prize in Chemistry, and solved insulin in 1969.",
      sources: [SRC.hodgkinFacts, SRC.hodgkinB12, SRC.insulin],
    },
    verb: "Add spots",
    maths: {
      formula: [
        { t: "ρ", part: "rho" },
        { t: " = Σ " },
        { t: "|F|", part: "F" },
        { t: " cos(2π(hx + ky) − " },
        { t: "φ", part: "phi" },
        { t: ")" },
      ],
      symbols: [
        { sym: "ρ", part: "rho", text: "how many electrons are at each place" },
        { sym: "|F|", part: "F", text: "how strong one spot's ripple is" },
        {
          sym: "φ",
          part: "phi",
          text: "how far the ripple is pushed along, which the detector never records",
        },
      ],
      notes: [
        {
          text: "The finest detail is the smallest spacing used, 1/|S| of the farthest spot added.",
          sources: [SRC.drenth],
        },
        {
          text: "Ways to find the missing positions include guess and refine, heavy atoms and direct methods.",
          sources: [SRC.drenth],
        },
      ],
    },
    labels: {
      addOne: "Add one",
      addAll: "Add all",
      clear: "Clear",
      swap: "Swap",
      atoms: "Atoms",
      detail: "Finest detail",
      brightness: "Brightness",
      positions: "Positions",
      lorikeet: "Lorikeet",
      turtle: "Turtle",
      layers: "Layers",
    },
    more: {
      swap: {
        text: "The detector only records how bright each spot is, so scientists must work out where each ripple sits.",
        sources: [SRC.drenth],
      },
      soSwap: {
        text: "The new picture follows the ripples' positions, not their brightness.",
        sources: [SRC.oppenheim],
      },
    },
  },

  // ---- 10 ------------------------------------------------------------------------------------
  helix: {
    id: "helix",
    number: 10,
    headline: "What makes an X?",
    caption: {
      text: "A helix, shaped like a spring, scatters X-rays into an X.",
      sources: [SRC.cochran, SRC.thompson],
    },
    so: {
      text: "The X's angle shows how steep the helix is, and the gaps between its rows show how long each turn is.",
      sources: [SRC.cochran, SRC.thompson],
    },
    tag: {
      text: "In May 1952 Rosalind Franklin and Raymond Gosling took Photo 51, an X-ray picture of DNA whose X pointed to a helix.",
      sources: [SRC.sutton, SRC.franklin],
    },
    verb: "Twist it",
    maths: {
      formula: [
        { t: "rows 1/" },
        { t: "P", part: "P" },
        { t: " apart,  tan " },
        { t: "α", part: "alpha" },
        { t: " = " },
        { t: "P", part: "P" },
        { t: " / 2π" },
        { t: "r", part: "r" },
      ],
      symbols: [
        { sym: "P", part: "P", text: "how far the helix rises in one turn, in Å" },
        { sym: "r", part: "r", text: "how far the strand is from the helix's middle, in Å" },
        {
          sym: "α",
          part: "alpha",
          text: "how steeply the strand climbs, which is how far the X's arms lean from upright",
        },
      ],
      notes: [
        {
          text: "The arms reach α only far out; the bright inner spots lean several degrees wider.",
          sources: [SRC.cochran],
        },
      ],
    },
    more: {
      twoStrands: {
        text: "With two strands offset like DNA's, the fourth row cancels out, like a missing spot.",
        sources: [SRC.franklin, SRC.thompson],
      },
    },
    labels: {
      twist: "Twist",
      widen: "Widen",
      one: "One strand",
      two: "Two strands",
    },
  },

  // ---- 11 ------------------------------------------------------------------------------------
  mystery: {
    id: "mystery",
    number: 11,
    headline: "Which crystal is it?",
    caption: {
      text: "Every kind of crystal has its own pattern of rings, like a fingerprint.",
      sources: [SRC.hull, SRC.hubbard],
    },
    so: {
      text: "The positions of the rings are enough to tell which crystal made them.",
      sources: [SRC.hull, SRC.cullity],
    },
    tag: {
      text: "In 1919 Albert Hull showed that the rings from a powder can tell you what it is made of.",
      sources: [SRC.hull, SRC.hubbard],
    },
    verb: "Pick one",
    maths: {
      formula: [{ t: "|S|²", part: "S" }, { t: " ∝ " }, { t: "h² + k² + l²", part: "hkl" }],
      symbols: [
        { sym: "|S|²", part: "S", text: "the square of each ring's radius, in Å⁻²" },
        { sym: "h² + k² + l²", part: "hkl", text: "3, 4, 8, 11, 12 and 16 for aluminium" },
      ],
      notes: [
        {
          text: "This works for crystals whose repeat is a cube.",
          sources: [SRC.cullity],
        },
      ],
    },
    uses: [
      {
        id: "medicines",
        title: "Medicines",
        line: {
          text: "Most of the protein shapes we know came from X-ray patterns, and those shapes help scientists design new medicines.",
          sources: [SRC.pdb, SRC.hiv],
        },
      },
      {
        id: "mars",
        title: "Mars",
        line: {
          text: "A rover on Mars carries an X-ray lab about 25 cm wide that names the minerals in rocks and soil.",
          sources: [SRC.jpl, SRC.chemin, SRC.bish],
        },
      },
      {
        id: "metals",
        title: "Metals",
        line: {
          text: "X-rays can measure hidden stresses near the surface of metal parts, such as railway wheels, without cutting them.",
          sources: [SRC.kendall],
        },
      },
      {
        id: "batteries",
        title: "Batteries",
        line: {
          text: "Scientists shine X-rays into batteries while they charge to watch the crystals inside change.",
          sources: [SRC.liu],
        },
      },
      {
        id: "paintings",
        title: "Paintings",
        line: {
          text: "X-rays can tell which crystals are in old paint without taking even a tiny chip from the painting.",
          sources: [SRC.deMeyer],
        },
      },
      {
        id: "medicineCrystals",
        title: "Medicine crystals",
        line: {
          text: "One medicine can form different crystals that dissolve differently, and X-ray patterns tell them apart.",
          sources: [SRC.bauer],
        },
      },
      {
        id: "cement",
        title: "Cement",
        line: {
          text: "X-ray patterns show which crystals are in cement powder, and how much of each.",
          sources: [SRC.stutzman],
        },
      },
    ],
    labels: {
      corundum: "Corundum",
      foil: "Aluminium foil",
      foilShort: "Foil",
      foilReveal: "Aluminium foil (arcs)",
      zircon: "Zircon",
      silicon: "Silicon",
      salt: "Table salt",
      saltShort: "Salt",
      diamond: "Diamond",
      computed: "Worked out from its atoms",
      hint: "Compare the first rings",
    },
  },
};

export const textOf = (id: ChapterId): ChapterText => TEXT[id];

/** Every visitor line, for the text rule's test. */
export const allLines = (): Line[] => {
  const out: Line[] = [];
  for (const t of Object.values(TEXT)) {
    out.push(t.caption, t.so);
    if (t.tag) out.push(t.tag);
    for (const l of t.maths.notes ?? []) out.push(l);
    for (const l of Object.values(t.more ?? {})) out.push(l);
    for (const u of t.uses ?? []) out.push(u.line);
  }
  return out;
};

/** Lines that are history or use, which must carry sources. */
export const sourcedLines = (): Line[] => {
  const out: Line[] = [];
  for (const t of Object.values(TEXT)) {
    if (t.tag) out.push(t.tag);
    for (const u of t.uses ?? []) out.push(u.line);
    for (const l of Object.values(t.more ?? {})) if (l.sources) out.push(l);
  }
  return out;
};
