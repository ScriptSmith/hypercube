/**
 * Which captions show for an eye: the caption card's pages (its main line, then More's lines one
 * at a time) and the line every simulated view carries. Captions are chosen from what the view
 * really shows, so a corrected eye never carries the uncorrected eye's caption and a typical eye
 * made long by its slider carries short sight's.
 */
import {
  type ConditionId,
  conditionCaption,
  CORRECTIONS,
  type Line,
  LONG_EYE,
  type PartId,
  partCaption,
} from "./captions";
import { type Derived, type EyeState, correctionCaptionId } from "./model";

export interface Page {
  title: string;
  line: Line;
}

/** Refractive error at or above this shows as short or long sight, dioptres. */
export const NOTICE_D = 0.5;
/** High short sight from this axial length, mm (EyeWiki, Myopia). */
export const LONG_EYE_MM = 26.5;

const REFRACTIVE: readonly ConditionId[] = ["typical", "myopia", "hyperopia", "presbyopia"];

/** Which condition's view caption the optics call for, for the refractive conditions. */
const refractiveView = (s: EyeState, d: Derived): ConditionId | null => {
  // Reading glasses make far things blurry on purpose; no short-sight caption for that.
  if (d.lens?.kind === "reading") return null;
  const r = (d.residual.h + d.residual.v) / 2;
  if (r <= -NOTICE_D) return "myopia";
  if (r >= NOTICE_D) return "hyperopia";
  const book = d.layers.near.defocus;
  const bookBlur = Math.max(Math.abs(book.h), Math.abs(book.v));
  if (s.looking === "near" && bookBlur >= NOTICE_D && s.age >= 40) {
    return "presbyopia";
  }
  return null;
};

/** The view's caption line, or null when the view shows a typical or fully corrected eye. */
export const viewLine = (s: EyeState, d: Derived): Line | null => {
  const c = s.condition;
  if (REFRACTIVE.includes(c)) {
    const v = refractiveView(s, d);
    return v ? (conditionCaption(v).view?.main ?? null) : null;
  }
  if (c === "astigmatism") {
    const cyl = Math.abs(d.residual.h - d.residual.v);
    if (cyl >= NOTICE_D) return conditionCaption(c).view?.main ?? null;
    const v = refractiveView(s, d);
    return v ? (conditionCaption(v).view?.main ?? null) : null;
  }
  if (c === "cataract" && s.correction === "newLens") return null;
  // With a rigid lens the tails turn the other way, so the main view line no longer fits.
  if (c === "keratoconus" && s.correction === "hardLens") {
    return conditionCaption(c).view?.more[0] ?? null;
  }
  return conditionCaption(c).view?.main ?? null;
};

export interface PageOptions {
  part: PartId | null;
  /** Show the optional lines (the `extras` option). */
  extras: boolean;
  /** Two pictures side by side (the wall). */
  paired: boolean;
}

/** The caption card's pages: the first is its main line, More steps through the rest. */
export const pages = (s: EyeState, d: Derived, o: PageOptions): Page[] => {
  if (o.part) {
    const p = partCaption(o.part);
    return [p.main, ...p.more, ...(p.condition[s.condition] ?? [])].map((line) => ({
      title: p.name,
      line,
    }));
  }
  const c = conditionCaption(s.condition);
  const out: Page[] = [];
  const add = (title: string, line: Line) => {
    if (!out.some((p) => p.line === line)) out.push({ title, line });
  };
  const fix = correctionCaptionId(s);
  if (fix) add(fix === "contact" ? "Contact lens" : "Glasses", CORRECTIONS[fix]);
  if (s.correction === "reading" && s.condition === "presbyopia" && c.more[0]) {
    add("Reading glasses", c.more[0]);
  }
  if (s.correction === "newLens" && s.condition === "cataract" && c.more[1]) {
    add("New lens", c.more[1]);
  }
  if (!c.main) {
    const w = partCaption("whole");
    add(c.name, w.main);
    return out;
  }
  add(c.name, c.main);
  for (const l of c.more) add(c.name, l);
  if (s.condition === "myopia" && s.length >= LONG_EYE_MM) add(c.name, LONG_EYE);
  if (o.extras) for (const l of c.extras) add(c.name, l);
  const shown = viewLine(s, d);
  for (const l of c.view?.more ?? []) if (l !== shown) add(c.name, l);
  if (o.paired) for (const l of c.view?.paired ?? []) add(c.name, l);
  return out;
};

/**
 * A short label for the view: what the eye has on, or, for a view showing a condition, "One
 * example" with which example. The view captions mostly carry no "roughly" of their own, so
 * the label says it for them.
 */
export const viewTag = (s: EyeState, d: Derived, amdExample: number): string | null => {
  if (d.lens) {
    const names: Record<string, string> = {
      glasses: "With glasses",
      contact: "With a contact lens",
      reading: "With reading glasses",
      hardLens: "With a hard lens",
    };
    return names[d.lens.kind] ?? null;
  }
  if (s.condition === "cataract" && s.correction === "newLens") return "With a new lens";
  if (!viewLine(s, d)) return null;
  const which =
    s.condition === "amd"
      ? (["Blurry", "Wavy", "Parts missing"][amdExample % 3] ?? null)
      : s.condition === "glaucoma"
        ? s.toggle === 1
          ? "Eye test map"
          : "What they notice"
        : s.condition === "cvd"
          ? s.toggle === 1
            ? "Protan"
            : "Deutan"
          : null;
  return which ? `One example: ${which.toLowerCase()}` : "One example";
};
