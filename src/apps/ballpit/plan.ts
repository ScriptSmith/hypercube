/**
 * Which questions a bank frame shows. The group's leader (the screen, or the first panel when
 * there is no screen) announces the questions it is showing, and the rest of the bank shows the
 * same ones. So a panel whose own options disagree with the screen's still sends its votes to the
 * chart on the screen. A frame that hasn't heard its leader for a while goes back to its own
 * schedule.
 *
 * The announcement holds no words: question ids, when the current period ends (for the reveal),
 * and for a custom question its answer count and pictures. Only signed admin puts text on a
 * screen, and room messages aren't signed. A follower shows a custom question's words only when
 * its own options hold the same question (the id is a hash of the wording); otherwise it draws
 * the answers' colours and pictures alone, and still counts the votes.
 */
import { REVEAL_MS } from "./config";
import { blindQuestion, CUSTOM_SLOTS, isPictureId } from "./custom";
import type { PictureId } from "./pictures";
import { type Question, questionById } from "./questions";
import type { Slot } from "./schedule";

export interface PlanMsg {
  /** Question ids, one per slot. */
  q: string[];
  /** Clock ms the questions change, or 0 when they don't (a fixed question). */
  e: number;
  /** The custom question among `q`: its answer count and each answer's picture ("" for none). */
  c?: { n: number; p: string[] };
}

/** Followers keep to the leader's questions this long after its last announcement. */
export const FOLLOW_MS = 6000;
/** The leader announces at least this often, and at once when its questions change. */
export const PLAN_EVERY_MS = 2000;

const ID = /^[a-z0-9-]{1,40}$/;
const T_MAX = 1e14;
const isCustomId = (id: string) => id.startsWith("custom-");

/** What a leader showing `slot` announces. */
export const planOf = (slot: Slot): PlanMsg => {
  const msg: PlanMsg = { q: slot.questions.map((q) => q.id), e: slot.revealable ? slot.end : 0 };
  const own = slot.questions.find((q) => q.set === "custom");
  if (own) msg.c = { n: own.answers.length, p: own.answers.map((a) => a.pic ?? "") };
  return msg;
};

/** A checked announcement, or null. */
export const decodePlan = (data: unknown): PlanMsg | null => {
  if (typeof data !== "object" || data === null) return null;
  const m = data as { q?: unknown; e?: unknown; c?: unknown };
  if (!Array.isArray(m.q) || m.q.length < 1 || m.q.length > 2) return null;
  if (!m.q.every((id) => typeof id === "string" && ID.test(id))) return null;
  if (typeof m.e !== "number" || !Number.isFinite(m.e) || m.e < 0 || m.e > T_MAX) return null;
  const out: PlanMsg = { q: m.q as string[], e: m.e };
  if (m.c !== undefined) {
    const c = m.c as { n?: unknown; p?: unknown };
    if (typeof c !== "object" || c === null) return null;
    if (typeof c.n !== "number" || !Number.isInteger(c.n) || c.n < 2 || c.n > CUSTOM_SLOTS)
      return null;
    if (!Array.isArray(c.p) || c.p.length !== c.n) return null;
    if (!c.p.every((p) => p === "" || isPictureId(p))) return null;
    out.c = { n: c.n, p: c.p as string[] };
  }
  return out;
};

/**
 * `local`, with the leader's questions in place of this frame's own, and the leader's timing for
 * the reveal. A custom question shows in full only when it is this frame's own (`own`, from its
 * signed options); any other is drawn without words. A slot this frame can't show keeps its own.
 */
export const followSlot = (
  local: Slot,
  plan: PlanMsg,
  clock: number,
  own: Question | null,
): Slot => {
  const questions = local.questions.map((q, i) => {
    const id = plan.q[i];
    if (!id) return q;
    if (!isCustomId(id)) return questionById(id) ?? q;
    if (own && own.id === id) return own;
    if (!plan.c) return q;
    return blindQuestion(
      id,
      plan.c.p.map((p) => (p === "" ? null : (p as PictureId))),
    );
  });
  const reveal = plan.e > 0 && clock < plan.e && plan.e - clock <= REVEAL_MS;
  return { ...local, questions, reveal, revealable: plan.e > 0, end: plan.e || local.end };
};

/** True for a custom question drawn without its words here. */
export const wordless = (q: Question): boolean => q.set === "custom" && q.text === "";
