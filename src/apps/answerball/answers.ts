/**
 * The ball's twenty answers, one per face of its die: our own, short, kind and in sentence case.
 * About half say yes, a quarter aren't sure and a quarter say no.
 */
export type AnswerKind = "yes" | "unsure" | "no";

export interface Answer {
  text: string;
  kind: AnswerKind;
}

export const ANSWERS: readonly Answer[] = [
  { text: "Of course", kind: "yes" },
  { text: "Absolutely", kind: "yes" },
  { text: "I think so", kind: "yes" },
  { text: "Oh yes", kind: "yes" },
  { text: "Surely", kind: "yes" },
  { text: "The stars agree", kind: "yes" },
  { text: "Seems so", kind: "yes" },
  { text: "Go for it", kind: "yes" },
  { text: "For sure", kind: "yes" },
  { text: "Naturally", kind: "yes" },
  { text: "Maybe", kind: "unsure" },
  { text: "Who knows?", kind: "unsure" },
  { text: "Not sure yet", kind: "unsure" },
  { text: "Wait and see", kind: "unsure" },
  { text: "Shake me again", kind: "unsure" },
  { text: "Nope", kind: "no" },
  { text: "Not today", kind: "no" },
  { text: "Probably not", kind: "no" },
  { text: "Unlikely", kind: "no" },
  { text: "I doubt it", kind: "no" },
];

export const PROMPT = "Ask a question";
