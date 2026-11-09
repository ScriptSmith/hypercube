/**
 * The operator's own question, set through admin: text options never come from a URL, and the
 * runtime cleans them against the manifest before mount. The question and up to six answers are
 * text, and each answer may have one of our pictures. Empty answer slots are skipped. A question
 * with no text or fewer than two answers is incomplete, and the frame shows the curated rotation
 * instead.
 *
 * A custom question's id comes from its wording and pictures, so totals are kept per version:
 * editing the question or an answer starts a fresh chart, and an unchanged one carries on.
 *
 * The wording never travels in a room message. In a bank the leader announces the question's id
 * and pictures (plan.ts); a frame shows the words only if its own options hold the same question.
 */
import { cutText } from "../../core/options";
import type { OptionValues } from "../../core/types";
import { PICTURE_IDS, type PictureId } from "./pictures";
import { type Question, rememberCustom } from "./questions";

export const ASK_MAX = 60;
export const LABEL_MAX = 18;
export const CUSTOM_SLOTS = 6;
/** The `p1`...`p6` value for an answer shown as its words alone. */
export const NO_PICTURE = "none";

export interface CustomDef {
  text: string;
  answers: { label: string; pic: PictureId | null }[];
}

export type CustomCheck = { def: CustomDef; why: null } | { def: null; why: string };

const PICTURES = new Set<string>(PICTURE_IDS);
const isPicture = (v: unknown): v is PictureId => typeof v === "string" && PICTURES.has(v);
const textOf = (v: unknown, max: number) => (typeof v === "string" ? cutText(v, max) : "");

const check = (text: string, answers: CustomDef["answers"]): CustomCheck => {
  if (!text) return { def: null, why: "no question text" };
  if (answers.length < 2) return { def: null, why: "fewer than two answers" };
  return { def: { text, answers }, why: null };
};

/** The custom question in a frame's options, or why it can't be shown. */
export const customFromOptions = (o: OptionValues): CustomCheck => {
  const answers: CustomDef["answers"] = [];
  for (let i = 1; i <= CUSTOM_SLOTS; i++) {
    const label = textOf(o[`a${i}`], LABEL_MAX);
    if (label)
      answers.push({ label, pic: isPicture(o[`p${i}`]) ? (o[`p${i}`] as PictureId) : null });
  }
  return check(textOf(o.ask, ASK_MAX), answers);
};

const fnv = (s: string, seed: number) => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

/** An id from the question's content: the same wording and pictures always give the same id. */
export const customId = (def: CustomDef): string => {
  const key = [def.text, ...def.answers.map((a) => `${a.label}\u0001${a.pic ?? ""}`)].join(
    "\u0002",
  );
  return `custom-${fnv(key, 2166136261).toString(36)}${fnv(key, 0x9e3779b9).toString(36)}`;
};

/**
 * The question to show. It goes in the adults' slot of the two-question variant, and is known by
 * id from now on (questions.ts keeps the last few).
 */
export const customQuestion = (def: CustomDef): Question =>
  rememberCustom({
    id: customId(def),
    set: "custom",
    text: def.text,
    audience: "adults",
    answers: def.answers.map((a) => ({ pic: a.pic, label: a.label, bot: 1 })),
  });

/**
 * A custom question known only by its id and shape (how many answers, and their pictures), as a
 * leader announces it. It has no words at all: text reaches the screen only through signed admin,
 * never through a room message. Answers show their colour and picture, or just their colour.
 */
export const blindQuestion = (id: string, pics: readonly (PictureId | null)[]): Question => {
  const q: Question = {
    id,
    set: "custom",
    text: "",
    audience: "adults",
    answers: pics.map((pic) => ({ pic, label: "", bot: 1 })),
  };
  // Known by id, so its votes and totals are counted; the words-free copy is what's drawn.
  rememberCustom(q);
  return q;
};

export const isPictureId = isPicture;
