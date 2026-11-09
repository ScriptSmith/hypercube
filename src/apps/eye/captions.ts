/**
 * Every factual sentence a visitor can read (parts, conditions and simulated views,
 * corrections), each line with its published sources. A line that doesn't fit changes the
 * layout, not the words. A line may be one sentence of a longer caption shown on its own
 * (myopia's long-eye line), never a new sentence.
 *
 * Sources are cited by author and year or by publisher and page, with a DOI or URL; never by
 * affiliation. Other visitor text is names, control labels and numbers from the model.
 */

export interface Source {
  cite: string;
  url: string;
}

export interface Line {
  text: string;
  sources: readonly Source[];
}

export type PartId =
  | "whole"
  | "cornea"
  | "tearFilm"
  | "conjunctiva"
  | "sclera"
  | "aqueous"
  | "angle"
  | "iris"
  | "pupil"
  | "ciliary"
  | "zonules"
  | "lens"
  | "vitreous"
  | "retina"
  | "macula"
  | "fovea"
  | "disc"
  | "nerve"
  | "choroid"
  | "muscles"
  | "photoreceptors";

export type ConditionId =
  | "typical"
  | "myopia"
  | "hyperopia"
  | "astigmatism"
  | "presbyopia"
  | "cataract"
  | "glaucoma"
  | "amd"
  | "diabetic"
  | "keratoconus"
  | "cvd";

export interface PartCaption {
  id: PartId;
  name: string;
  /** One or two sentences. */
  main: Line;
  /** Extra lines, behind More. */
  more: readonly Line[];
  /** Lines behind More only while that condition is shown. */
  condition: Partial<Record<ConditionId, readonly Line[]>>;
}

export interface ViewCaption {
  main: Line;
  more: readonly Line[];
  /** Lines that need two pictures side by side (the wall's typical and this eye). */
  paired?: readonly Line[];
}

export interface ConditionCaption {
  id: ConditionId;
  name: string;
  /** Short name on the tiles. */
  tile: string;
  /** Null for the typical eye, which shows the whole eye's caption instead. */
  main: Line | null;
  more: readonly Line[];
  /** Optional or advice-like lines: shown only with the `extras` option. */
  extras: readonly Line[];
  /** Null for the typical eye. */
  view: ViewCaption | null;
}

export type CorrectionId = "glasses" | "contact" | "astigmatism";

// ---- Sources ---------------------------------------------------------------------------------

const S = (cite: string, url: string): Source => ({ cite, url });

const AAO = {
  parts: S("AAO, Parts of the eye (2023)", "https://www.aao.org/eye-health/anatomy/parts-of-eye"),
  cornea: S("AAO, Cornea (2016)", "https://www.aao.org/eye-health/anatomy/cornea-103"),
  tear: S("AAO, Tear film (2017)", "https://www.aao.org/eye-health/anatomy/tear-film-3"),
  conjunctiva: S("AAO, Conjunctiva (2016)", "https://www.aao.org/eye-health/anatomy/conjunctiva-3"),
  aqueous: S("AAO, Aqueous humor (2019)", "https://www.aao.org/eye-health/anatomy/aqueous-humor"),
  iris: S("AAO, Iris (2016)", "https://www.aao.org/eye-health/anatomy/iris-2"),
  pupil: S("AAO, Pupil (2023)", "https://www.aao.org/eye-health/anatomy/pupil"),
  lens: S("AAO, Lens (2016)", "https://www.aao.org/eye-health/anatomy/lens-9"),
  retina: S("AAO, Retina (2020)", "https://www.aao.org/eye-health/anatomy/retina-103"),
  macula: S("AAO, Macula (2016)", "https://www.aao.org/eye-health/anatomy/macula-6"),
  nerve: S("AAO, Optic nerve (2024)", "https://www.aao.org/eye-health/anatomy/optic-nerve-3"),
  rods: S("AAO, Rods", "https://www.aao.org/eye-health/anatomy/rods"),
  color: S(
    "AAO, How humans see in color",
    "https://www.aao.org/eye-health/tips-prevention/how-humans-see-in-color",
  ),
  keratoconus: S(
    "AAO, What is keratoconus",
    "https://www.aao.org/eye-health/diseases/what-is-keratoconus",
  ),
  astigmatism: S("AAO, Astigmatism", "https://www.aao.org/eye-health/astigmatism"),
  glaucoma: S("AAO, Glaucoma", "https://www.aao.org/eye-health/diseases/what-is-glaucoma"),
};

const NEI = {
  myopia: S(
    "NEI, Nearsightedness",
    "https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/nearsightedness-myopia",
  ),
  myopiaLearn: S(
    "NEI, Nearsightedness",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/nearsightedness-myopia",
  ),
  hyperopia: S(
    "NEI, Farsightedness",
    "https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/farsightedness-hyperopia",
  ),
  hyperopiaLearn: S(
    "NEI, Farsightedness",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/farsightedness-hyperopia",
  ),
  astigmatism: S(
    "NEI, Astigmatism",
    "https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/astigmatism",
  ),
  astigmatismLearn: S(
    "NEI, Astigmatism",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/astigmatism",
  ),
  presbyopia: S(
    "NEI, Presbyopia",
    "https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/presbyopia",
  ),
  cataract: S(
    "NEI, Cataracts",
    "https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/cataracts",
  ),
  cataractLearn: S(
    "NEI, Cataracts",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/cataracts",
  ),
  cataractsEye: S(
    "NEI, Cataracts and the eye",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/cataracts/cataracts-and-eye",
  ),
  glaucoma: S(
    "NEI, Glaucoma",
    "https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/glaucoma",
  ),
  glaucomaLearn: S(
    "NEI, Glaucoma",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/glaucoma",
  ),
  glaucomaTypes: S(
    "NEI, Types of glaucoma",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/glaucoma/types-glaucoma",
  ),
  pressure: S(
    "NEI, Glaucoma and eye pressure",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/glaucoma/causes",
  ),
  amd: S(
    "NEI, Age-related macular degeneration",
    "https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/age-related-macular-degeneration",
  ),
  amdLearn: S(
    "NEI, Age-related macular degeneration",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/age-related-macular-degeneration",
  ),
  dr: S(
    "NEI, Diabetic retinopathy",
    "https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/diabetic-retinopathy",
  ),
  drLearn: S(
    "NEI, Diabetic retinopathy",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/diabetic-retinopathy",
  ),
  cvd: S(
    "NEI, Color blindness",
    "https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/color-blindness",
  ),
  cvdLearn: S(
    "NEI, Color blindness",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/color-blindness",
  ),
  howEyesWork: S(
    "NEI, How the eyes work",
    "https://www.nei.nih.gov/learn-about-eye-health/healthy-vision/how-eyes-work",
  ),
  refractive: S(
    "NEI, Refractive errors",
    "https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/refractive-errors",
  ),
};

const WEBVISION = {
  gross: S(
    "Kolb, Gross anatomy of the eye, Webvision",
    "https://www.webvision.pitt.edu/book/part-i-foundations/gross-anatomy-of-the-ey/",
  ),
  simple: S(
    "Kolb, Simple anatomy of the retina, Webvision",
    "https://www.webvision.pitt.edu/book/part-i-foundations/simple-anatomy-of-the-retina/",
  ),
  facts: S(
    "Kolb, Facts and figures, Webvision",
    "https://webvision.med.utah.edu/book/part-xiii-facts-and-figures-concerning-the-human-retina/",
  ),
  photoreceptors: S(
    "Kolb, Photoreceptors, Webvision",
    "https://www.webvision.pitt.edu/book/part-ii-anatomy-and-physiology-of-the-retina/photoreceptors/",
  ),
  rpe: S(
    "Strauss, The retinal pigment epithelium, Webvision",
    "https://www.webvision.pitt.edu/book/part-ii-anatomy-and-physiology-of-the-retina/the-retinal-pigment-epithelium/",
  ),
  lens: S(
    "Aliancy and Mamalis, Crystalline lens and cataract, Webvision",
    "https://www.webvision.pitt.edu/book/part-xvi-anterior-segment/crystalline-lens-and-cataract/",
  ),
  color: S(
    "Kalloniatis and Luu, Color perception, Webvision",
    "https://www.webvision.pitt.edu/book/part-viii-psychophysics-of-vision/color-perception/",
  ),
  amd: S(
    "Hageman and colleagues, AMD, Webvision",
    "https://www.webvision.pitt.edu/book/part-xii-cell-biology-of-retinal-degenerations/age-related-macular-degeneration-amd/",
  ),
};

const EYEWIKI = {
  astigmatism: S(
    "EyeWiki, Physiology of astigmatism",
    "https://eyewiki.org/Physiology_of_Astigmatism",
  ),
  anisocoria: S("EyeWiki, Anisocoria", "https://eyewiki.org/Anisocoria"),
  ubm: S("EyeWiki, Ultrasound biomicroscopy", "https://eyewiki.org/Ultrasound_Biomicroscopy"),
  zonules: S(
    "EyeWiki, Zonulopathy",
    "https://eyewiki.org/Zonulopathy%3A_Evaluation_and_Surgical_Management",
  ),
  pathologicMyopia: S(
    "EyeWiki, Pathologic myopia",
    "https://eyewiki.org/Pathologic_Myopia_%28Myopic_Degeneration%29",
  ),
  myopia: S("EyeWiki, Myopia", "https://eyewiki.org/Myopia"),
  hyperopia: S("EyeWiki, Hyperopia", "https://eyewiki.org/Hyperopia"),
  ga: S("EyeWiki, Geographic atrophy", "https://eyewiki.org/Geographic_Atrophy"),
  dme: S("EyeWiki, Diabetic macular edema", "https://eyewiki.org/Diabetic_Macular_Edema"),
  keratoconus: S("EyeWiki, Keratoconus", "https://eyewiki.org/Keratoconus"),
  color: S("EyeWiki, Color vision", "https://eyewiki.org/Color_Vision"),
};

const PAPER = {
  bekerman: S("Bekerman et al. 2014", "https://doi.org/10.1155/2014/503645"),
  sridhar: S("Sridhar 2018", "https://doi.org/10.4103/ijo.ijo_646_17"),
  vurgese: S("Vurgese et al. 2012", "https://doi.org/10.1371/journal.pone.0029692"),
  goel: S("Goel et al. 2010", "https://doi.org/10.2174/1874364101004010052"),
  lazar: S("Lazar et al. 2024", "https://doi.org/10.1098/rsos.191613"),
  reifeltshammer: S("Reifeltshammer et al. 2026", "https://doi.org/10.1136/bmjophth-2026-002819"),
  lopez: S("López-de la Rosa et al. 2024", "https://doi.org/10.1007/s40123-024-00882-6"),
  avitabile: S("Avitabile et al. 2026", "https://doi.org/10.3390/jfb17060301"),
  urale: S("Urale et al. 2022", "https://doi.org/10.1002/hbm.25996"),
  raman: S("Raman and Sarkar 2016", "https://doi.org/10.1371/journal.pone.0151194"),
  wang: S("Wang et al. 2017", "https://doi.org/10.1038/s41598-017-06580-7"),
  machadoDisc: S("Machado et al. 2022", "https://doi.org/10.5935/0004-2749.20220080"),
  flitcroft: S("Flitcroft 2019", "https://doi.org/10.1167/iovs.18-25957"),
  lawrenson: S("Lawrenson 2025", "https://doi.org/10.1002/14651858.CD014758.pub3"),
  strasburger: S("Strasburger 2018", "https://doi.org/10.1177/2041669518765850"),
  greivenkamp: S(
    "Greivenkamp 2019",
    "https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-22-The-Eye.pdf",
  ),
  iwata: S("Iwata 2025", "https://doi.org/10.1038/s41598-025-27291-4"),
  anderson: S("Anderson 2008", "https://doi.org/10.1167/iovs.07-1492"),
  healthdirectCataract: S("healthdirect, Cataracts", "https://www.healthdirect.gov.au/cataracts"),
  healthdirectKeratoconus: S(
    "healthdirect, Keratoconus",
    "https://www.healthdirect.gov.au/conditions/eye-diseases/keratoconus",
  ),
  reus: S("Reus and van den Berg 2024", "https://doi.org/10.1097/j.jcrs.0000000000001349"),
  keel: S("Keel 2019", "https://doi.org/10.1136/bjophthalmol-2017-311786"),
  crabb: S("Crabb 2013", "https://doi.org/10.1016/j.ophtha.2012.11.043"),
  hu: S("Hu 2014", "https://doi.org/10.1097/MAJ.0000000000000319"),
  nhsAmd: S("NHS, AMD", "https://www.nhs.uk/conditions/age-related-macular-degeneration-amd/"),
  nhsAmdSymptoms: S(
    "NHS, AMD symptoms",
    "https://www.nhs.uk/conditions/age-related-macular-degeneration-amd/symptoms/",
  ),
  taylor: S("Taylor 2018", "https://doi.org/10.1111/opo.12419"),
  fletcher: S("Fletcher 2012", "https://doi.org/10.1097/OPX.0b013e318264cc77"),
  zur: S("Zur and Ullman 2003", "https://doi.org/10.1016/S0042-6989(03)00038-5"),
  chan: S("Chan 2021", "https://doi.org/10.1016/j.ophtha.2020.08.020"),
  swartz: S("Swartz 2025", "https://doi.org/10.1111/opo.70037"),
  machado: S("Machado 2009", "https://doi.org/10.1109/TVCG.2009.113"),
  brettel: S("Brettel 1997", "https://doi.org/10.1364/JOSAA.14.002647"),
};

const L = (text: string, ...sources: Source[]): Line => ({ text, sources });

// ---- Parts -----------------------------------------------------------------------------------

export const PARTS: readonly PartCaption[] = [
  {
    id: "whole",
    name: "Whole eye",
    main: L(
      "An adult eyeball is about 24 mm from front to back and about 24 mm from side to side.",
      WEBVISION.gross,
      PAPER.bekerman,
    ),
    more: [],
    condition: {},
  },
  {
    id: "cornea",
    name: "Cornea",
    main: L(
      "The cornea is the clear front window of your eye. It does about two thirds of the eye's focusing.",
      AAO.cornea,
      PAPER.sridhar,
      AAO.parts,
    ),
    more: [
      L(
        "It has no blood vessels, and gets most of its food from the clear fluid behind it.",
        PAPER.sridhar,
      ),
    ],
    condition: {
      keratoconus: [
        L(
          "In keratoconus, the cornea slowly gets thinner and bulges into a cone shape. This makes things look blurry and stretched.",
          AAO.keratoconus,
          PAPER.healthdirectKeratoconus,
        ),
      ],
      astigmatism: [
        L(
          "With astigmatism, the cornea is curved more in one direction than the other, so light does not focus evenly. Things can look blurry or stretched.",
          AAO.astigmatism,
          EYEWIKI.astigmatism,
          NEI.astigmatism,
        ),
      ],
    },
  },
  {
    id: "tearFilm",
    name: "Tear film",
    main: L(
      "A thin layer of tears, with an oily outside, a watery middle and a mucus layer next to the eye, covers the front of your eye. Every blink spreads a fresh layer.",
      AAO.tear,
      PAPER.sridhar,
    ),
    more: [],
    condition: {},
  },
  {
    id: "conjunctiva",
    name: "Conjunctiva",
    main: L(
      "The conjunctiva is a thin, clear layer over the white of your eye and the inside of your eyelids. It makes the mucus part of your tears.",
      AAO.conjunctiva,
      AAO.parts,
      PAPER.sridhar,
    ),
    more: [],
    condition: {},
  },
  {
    id: "sclera",
    name: "Sclera",
    main: L(
      "The sclera is the tough white outer wall of your eye. It keeps the eye in shape and protects the inside, and your six eye muscles are attached to it.",
      NEI.cataractsEye,
      AAO.parts,
    ),
    more: [],
    condition: {
      myopia: [
        L(
          "In a very short-sighted eye, the eye is longer and the back of the sclera is thinner.",
          PAPER.vurgese,
          NEI.myopia,
        ),
      ],
    },
  },
  {
    id: "aqueous",
    name: "Aqueous humour",
    main: L(
      "Aqueous humour is a clear, watery fluid at the front of your eye that feeds the eye and keeps it firm. New fluid is made all the time, and the same amount drains away.",
      AAO.aqueous,
    ),
    more: [],
    condition: {},
  },
  {
    id: "angle",
    name: "Drainage angle",
    main: L(
      "The space behind the cornea is full of clear fluid. The fluid drains out through a spongy filter where the iris meets the cornea, called the trabecular meshwork.",
      NEI.pressure,
    ),
    more: [],
    condition: {
      glaucoma: [
        L(
          "If the fluid cannot drain well, the pressure inside the eye can rise. High pressure can harm the optic nerve over time.",
          NEI.pressure,
        ),
      ],
    },
  },
  {
    id: "iris",
    name: "Iris",
    main: L(
      "The iris is the coloured part of your eye. Two tiny muscles in it make the pupil bigger or smaller.",
      AAO.iris,
      EYEWIKI.anisocoria,
      AAO.parts,
    ),
    more: [L("Brown eyes have more of a dark brown pigment called melanin.", WEBVISION.gross)],
    condition: {},
  },
  {
    id: "pupil",
    name: "Pupil",
    main: L(
      "The pupil is the hole in the middle of the iris that lets light in. It can shrink to about 2 mm in bright light and open to about 8 mm in the dark.",
      AAO.pupil,
      PAPER.lazar,
    ),
    more: [L("It looks black because the inside of the eye soaks up the light.", WEBVISION.gross)],
    condition: {},
  },
  {
    id: "ciliary",
    name: "Ciliary body",
    main: L(
      "The ciliary body is a ring of tissue behind the iris. Its folds make the clear fluid for the front of the eye, and its muscle helps the lens change shape so you can focus up close.",
      EYEWIKI.ubm,
      WEBVISION.gross,
      PAPER.goel,
      WEBVISION.lens,
    ),
    more: [],
    condition: {},
  },
  {
    id: "zonules",
    name: "Zonules",
    main: L(
      "About 140 bundles of very thin fibres, called zonules, hold the lens in place. When the eye focuses up close, they loosen and the lens becomes rounder.",
      EYEWIKI.zonules,
      AAO.parts,
      WEBVISION.lens,
    ),
    more: [],
    condition: {},
  },
  {
    id: "lens",
    name: "Lens",
    main: L(
      "The lens sits behind the pupil and changes shape to focus on things near and far. In adults it is about 10 mm across and about 4 mm thick.",
      AAO.lens,
      AAO.parts,
      PAPER.reifeltshammer,
      PAPER.lopez,
    ),
    more: [],
    condition: {
      presbyopia: [
        L(
          "As we get older, the lens gets stiffer. After about age 45, most people find it harder to focus on things up close.",
          NEI.presbyopia,
        ),
      ],
      cataract: [
        L(
          "A cataract is a cloudy patch in the lens, and it is very common in older people. Doctors can swap the cloudy lens for a clear artificial one.",
          NEI.cataract,
        ),
        L("Nuclear: the centre of the lens slowly turns yellow or brown.", WEBVISION.lens),
        L("Cortical: white spokes form around the edge of the lens.", WEBVISION.lens),
        L("Posterior subcapsular: a cloudy patch forms at the back of the lens.", WEBVISION.lens),
      ],
    },
  },
  {
    id: "vitreous",
    name: "Vitreous",
    main: L(
      "The vitreous is a clear jelly, more than 98% water, that fills about four fifths of your eye. Light passes straight through it to the retina.",
      PAPER.avitabile,
      AAO.parts,
    ),
    more: [],
    condition: {},
  },
  {
    id: "retina",
    name: "Retina",
    main: L(
      "The retina is a thin layer at the back of your eye that senses light and sends signals to your brain. Light passes through the whole retina before it reaches the light-sensing cells at the back.",
      AAO.retina,
      NEI.howEyesWork,
      WEBVISION.simple,
    ),
    more: [],
    condition: {
      diabetic: [
        L(
          "In diabetic retinopathy, high blood sugar harms the tiny blood vessels in the retina. They can leak, and new weak vessels can grow.",
          NEI.dr,
        ),
      ],
      myopia: [
        L(
          "In a short-sighted eye, the eyeball is often too long, so light focuses in front of the retina. Very long eyes stretch the layers at the back and make them thinner.",
          NEI.myopia,
          EYEWIKI.pathologicMyopia,
        ),
      ],
      hyperopia: [
        L(
          "In a long-sighted eye, the eyeball is often too short, so light focuses behind the retina. Close things look blurry.",
          NEI.hyperopia,
        ),
      ],
    },
  },
  {
    id: "macula",
    name: "Macula",
    main: L(
      "The macula is a small area in the middle of the retina that gives you sharp, detailed vision for faces and reading. A natural yellow pigment gives it a yellowish colour.",
      AAO.macula,
      WEBVISION.simple,
    ),
    more: [],
    condition: {
      amd: [
        L(
          "In age-related macular degeneration, the macula is slowly damaged as people get older. Central vision can become blurry, but side vision usually stays.",
          NEI.amd,
          AAO.parts,
        ),
        L("Drusen: tiny yellow-white deposits under the retina.", WEBVISION.amd),
      ],
    },
  },
  {
    id: "fovea",
    name: "Fovea",
    main: L(
      "The fovea is a tiny dip in the centre of the macula, about 1.5 mm across, packed with cones and with no rods. When you look straight at something, its picture lands here.",
      WEBVISION.facts,
      WEBVISION.simple,
      WEBVISION.gross,
    ),
    more: [],
    condition: {},
  },
  {
    id: "disc",
    name: "Optic disc",
    main: L(
      "This pale spot, where the optic nerve leaves the eye, has no light-sensing cells, so each eye has a small blind spot. Your brain fills in the gap, so you never notice it.",
      AAO.nerve,
      WEBVISION.simple,
      PAPER.urale,
      PAPER.raman,
    ),
    more: [
      L(
        "The blind spot is about 15 degrees to the side of where you look, and about 5 to 6 degrees wide.",
        PAPER.urale,
        PAPER.wang,
      ),
    ],
    condition: {
      glaucoma: [
        L(
          "In glaucoma, the optic nerve is slowly damaged, often with no early signs, and side vision is usually affected first. Some people get it even with normal eye pressure.",
          NEI.glaucoma,
          NEI.glaucomaTypes,
        ),
        L("In glaucoma, the pale cup in the middle of the disc gets bigger.", PAPER.machadoDisc),
      ],
    },
  },
  {
    id: "nerve",
    name: "Optic nerve",
    main: L(
      "The optic nerve carries signals from your eye to your brain. It is a bundle of about 1.2 million nerve fibres.",
      NEI.howEyesWork,
      WEBVISION.facts,
    ),
    more: [],
    condition: {},
  },
  {
    id: "choroid",
    name: "Choroid",
    main: L(
      "The choroid is a layer packed with blood vessels, just behind the retina, that brings food and oxygen to the light-sensing cells. For its size, it gets more blood than the kidneys.",
      WEBVISION.simple,
      WEBVISION.rpe,
    ),
    more: [],
    condition: {},
  },
  {
    id: "muscles",
    name: "Eye muscles",
    main: L(
      "Six muscles move each eye. They turn it up, down, left and right, and twist it a little.",
      AAO.parts,
    ),
    more: [],
    condition: {},
  },
  {
    id: "photoreceptors",
    name: "Rods and cones",
    main: L(
      "Your retina has over 100 million rods and about 6 million cones. Rods help you see in dim light, and cones let you see colour and fine detail.",
      AAO.rods,
      WEBVISION.facts,
      AAO.parts,
    ),
    more: [
      L(
        "There are three kinds of cones, each best at catching blue, green or red light. Your brain compares them to work out colours.",
        WEBVISION.photoreceptors,
        AAO.color,
      ),
    ],
    condition: {
      cvd: [
        L(
          "About 1 in 12 boys and men see some colours differently. Usually one kind of cone works a bit differently, so some reds and greens can look alike.",
          NEI.cvd,
          WEBVISION.color,
          AAO.color,
        ),
      ],
    },
  },
];

// ---- Conditions and simulated views ----------------------------------------------------------

export const CONDITIONS: readonly ConditionCaption[] = [
  {
    id: "typical",
    name: "Typical eye",
    tile: "Typical",
    main: null,
    more: [],
    extras: [],
    view: null,
  },
  {
    id: "myopia",
    name: "Short sight (myopia)",
    tile: "Short sight",
    main: L(
      "In short sight, the eye is usually a little too long. Light from far away focuses in front of the retina, so far things look blurry.",
      NEI.myopiaLearn,
      PAPER.flitcroft,
    ),
    more: [
      L(
        "Short sight usually starts between ages 6 and 14. Children who spend more time outdoors are less likely to become short-sighted.",
        NEI.myopiaLearn,
      ),
    ],
    extras: [
      L(
        "Eye doctors have ways to slow short sight in children, such as special glasses, contact lenses or eye drops.",
        PAPER.lawrenson,
      ),
      L("People with high short sight need regular eye checks.", NEI.myopiaLearn),
    ],
    view: {
      main: L(
        "This is roughly how the scene looks to an eye with this much short sight. The further away something is, the blurrier it looks.",
        EYEWIKI.myopia,
        PAPER.strasburger,
      ),
      more: [
        L(
          "In bright light the pupil is smaller, so the blur is smaller too.",
          PAPER.strasburger,
          PAPER.lazar,
        ),
      ],
    },
  },
  {
    id: "hyperopia",
    name: "Long sight (hyperopia)",
    tile: "Long sight",
    main: L(
      "In long sight, the eye is usually a little too short, so light focuses behind the retina. Close things can look blurry.",
      NEI.hyperopiaLearn,
      EYEWIKI.hyperopia,
    ),
    more: [
      L(
        "Young eyes can often focus harder to make things clear. Many people with long sight were born with it.",
        PAPER.greivenkamp,
        NEI.hyperopiaLearn,
      ),
    ],
    extras: [],
    view: {
      main: L(
        "This eye is focusing hard to see far away, so it has little focus left for close things.",
        PAPER.greivenkamp,
      ),
      more: [],
    },
  },
  {
    id: "astigmatism",
    name: "Astigmatism",
    tile: "Astigmatism",
    main: L(
      "In astigmatism, the front of the eye is curved more in one direction than the other, like a rugby ball instead of a soccer ball. Light does not come to one sharp focus.",
      NEI.astigmatismLearn,
      AAO.astigmatism,
      PAPER.iwata,
    ),
    more: [],
    extras: [],
    view: {
      main: L(
        "Lines going one way can look sharper than lines going the other way.",
        PAPER.greivenkamp,
      ),
      more: [],
    },
  },
  {
    id: "presbyopia",
    name: "Ageing focus (presbyopia)",
    tile: "Ageing focus",
    main: L(
      "As we get older, the lens gets stiffer and cannot change shape as much. After about age 45, most people find it harder to see close up.",
      NEI.presbyopia,
      PAPER.anderson,
    ),
    more: [
      L(
        "Reading glasses help by adding focusing power for close work.",
        PAPER.greivenkamp,
        NEI.presbyopia,
      ),
    ],
    extras: [],
    view: {
      main: L(
        "The book is blurry because the lens can no longer focus this close. Far things still look clear.",
        NEI.presbyopia,
      ),
      more: [],
    },
  },
  {
    id: "cataract",
    name: "Cataract",
    tile: "Cataract",
    main: L(
      "A cataract is a cloudy patch in the lens inside the eye. It cannot spread from one eye to the other.",
      NEI.cataractLearn,
    ),
    more: [
      L("By age 80, most people have a cataract or have had one removed.", NEI.cataractLearn),
      L("Doctors can swap the cloudy lens for a clear artificial one.", PAPER.healthdirectCataract),
    ],
    extras: [],
    view: {
      main: L(
        "With a cataract, things can look blurry, hazy and less colourful.",
        NEI.cataractLearn,
      ),
      more: [
        L(
          "The cloudy lens scatters light, so bright lights spread a glowing haze and can have haloes.",
          PAPER.reus,
          NEI.cataractLearn,
        ),
      ],
    },
  },
  {
    id: "glaucoma",
    name: "Glaucoma",
    tile: "Glaucoma",
    main: L(
      "Glaucoma damages the optic nerve. This nerve is like a cable of over a million tiny wires that carries signals from the eye to the brain.",
      NEI.glaucomaLearn,
      AAO.glaucoma,
      NEI.howEyesWork,
    ),
    more: [
      L(
        "Often fluid inside the eye does not drain well, so the pressure rises. Some people get glaucoma with normal eye pressure.",
        AAO.glaucoma,
        NEI.glaucomaLearn,
      ),
      L(
        "It starts so slowly that people may not notice. About half of people with glaucoma do not know they have it.",
        NEI.glaucomaLearn,
        PAPER.keel,
      ),
    ],
    extras: [],
    view: {
      main: L(
        "People with glaucoma rarely see a black tunnel. Most say parts of their view look blurry or seem to be missing.",
        PAPER.crabb,
        PAPER.hu,
      ),
      more: [
        L(
          "The changes usually begin away from the centre, and the brain may fill in the gaps.",
          NEI.glaucomaLearn,
          PAPER.hu,
        ),
      ],
    },
  },
  {
    id: "amd",
    name: "Macular degeneration",
    tile: "Macular degeneration",
    main: L(
      "Macular degeneration affects the macula, the small part of the retina we use for sharp, straight-ahead vision.",
      NEI.amdLearn,
    ),
    more: [
      L(
        "Tiny yellow deposits called drusen build up under the retina. It mostly affects older people and does not hurt.",
        EYEWIKI.ga,
        PAPER.nhsAmd,
        PAPER.nhsAmdSymptoms,
      ),
    ],
    extras: [],
    view: {
      main: L(
        "People with macular degeneration describe the middle of what they look at as blurry, wavy or with parts missing. Side vision stays.",
        PAPER.taylor,
        PAPER.nhsAmdSymptoms,
      ),
      more: [
        L(
          "Many people do not see a dark spot at all, partly because the brain fills in the gap.",
          PAPER.fletcher,
          PAPER.zur,
        ),
      ],
    },
  },
  {
    id: "diabetic",
    name: "Diabetic retinopathy",
    tile: "Diabetic eye",
    main: L(
      "In diabetes, too much sugar in the blood can damage the tiny blood vessels in the retina. They can leak, get blocked, or grow fragile new vessels.",
      NEI.drLearn,
    ),
    more: [L("In the early stages there are usually no symptoms.", NEI.drLearn)],
    extras: [],
    view: {
      main: L(
        "Changes in vision differ from person to person. Vision can become blurry, and the blur may come and go.",
        NEI.drLearn,
        EYEWIKI.dme,
      ),
      more: [
        L(
          "If a fragile vessel bleeds into the eye, a person may see dark floating spots.",
          NEI.drLearn,
        ),
      ],
    },
  },
  {
    id: "keratoconus",
    name: "Keratoconus",
    tile: "Keratoconus",
    main: L(
      "The cornea is the clear window at the front of the eye. In keratoconus it gets thinner and bulges out like a cone.",
      AAO.keratoconus,
    ),
    more: [
      L(
        "It often starts in the teenage years. A study in Perth found it in about 1 in 84 twenty-year-olds.",
        EYEWIKI.keratoconus,
        PAPER.chan,
      ),
    ],
    extras: [],
    view: {
      main: L(
        "The cone bends light unevenly, so things look blurry and stretched, with faint extra copies that often trail downward.",
        AAO.keratoconus,
        PAPER.swartz,
      ),
      more: [
        L(
          "Bright lights can cause glare. Special hard contact lenses can make vision much sharper.",
          AAO.keratoconus,
          EYEWIKI.keratoconus,
        ),
      ],
    },
  },
  {
    id: "cvd",
    name: "Colour vision deficiency",
    tile: "Colour vision",
    main: L(
      "Most people have three kinds of colour-sensing cells, called cones, at the back of the eye. In colour vision deficiency one kind works differently or does not work, so some colours look alike.",
      PAPER.machado,
      NEI.cvdLearn,
      EYEWIKI.color,
    ),
    more: [
      L(
        "It runs in families and is much more common in boys and men. About 1 in 12 men have it.",
        NEI.cvdLearn,
      ),
    ],
    extras: [],
    view: {
      main: L(
        "This picture shows which colours can look alike to someone with red-green colour vision deficiency. Nobody can know exactly what another person sees.",
        PAPER.brettel,
      ),
      more: [],
      paired: [
        L(
          "If you have red-green colour vision deficiency, the two pictures may look almost the same to you.",
          PAPER.brettel,
        ),
      ],
    },
  },
];

/**
 * The first sentence of myopia's optional line for a very long eye; its second sentence is
 * advice-like and sits in `extras`.
 */
export const LONG_EYE: Line = L(
  "A very long eye stretches the layers at the back.",
  EYEWIKI.pathologicMyopia,
);

// ---- Corrections -----------------------------------------------------------------------------

export const CORRECTIONS: Record<CorrectionId, Line> = {
  glasses: L(
    "Glasses move the focus back onto the retina. Short sight needs a minus lens, and long sight needs a plus lens.",
    PAPER.greivenkamp,
    NEI.refractive,
  ),
  contact: L(
    "Contact lenses sit on the surface of the eye and do the same job as glasses.",
    NEI.refractive,
  ),
  // NEI's line, rather than a textbook line about cylinder lenses with no quoted source.
  astigmatism: L("Glasses or contact lenses can correct astigmatism.", NEI.astigmatismLearn),
};

export const partCaption = (id: PartId): PartCaption => PARTS.find((p) => p.id === id) ?? PARTS[0]!;

export const conditionCaption = (id: ConditionId): ConditionCaption =>
  CONDITIONS.find((c) => c.id === id) ?? CONDITIONS[0]!;

export const PART_IDS: readonly PartId[] = PARTS.map((p) => p.id);
export const CONDITION_IDS: readonly ConditionId[] = CONDITIONS.map((c) => c.id);

/** Every line in the file, for tests and the status of the text rule. */
export const allLines = (): Line[] => {
  const out: Line[] = [];
  for (const p of PARTS) {
    out.push(p.main, ...p.more);
    for (const ls of Object.values(p.condition)) if (ls) out.push(...ls);
  }
  for (const c of CONDITIONS) {
    if (c.main) out.push(c.main);
    out.push(...c.more, ...c.extras);
    if (c.view) out.push(c.view.main, ...c.view.more, ...(c.view.paired ?? []));
  }
  out.push(LONG_EYE, ...Object.values(CORRECTIONS));
  return out;
};
