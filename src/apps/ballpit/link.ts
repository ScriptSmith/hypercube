/**
 * A bank's messages. Every frame broadcasts the votes it takes, so every frame keeps the bank's
 * tally up to date, and the group's leader (the screen when there is one, else the lowest panel)
 * sends the totals so frames that join or missed something catch up. Tallies merge without double
 * counting (tally.ts), so whoever is leader, and however often frames come and go, they converge.
 *
 * - `bp:v`: votes, batched each tick. A vote carries its question, generation, answer and the
 *   sender's new count, plus where and when its ball leaves the sender's top edge, so the screen
 *   can carry it on through its pipes. Only people vote: bots' presses are never sent, and a
 *   message marked as a bot's (`b: 1`, from older pages) is dropped.
 * - `bp:t`: totals for the questions up now, and the admin skip. From the leader on change (at most
 *   twice a second) and every 5 s; from anyone else to a new leader, or to a leader that lacks
 *   something they have.
 * - `bp:h`: a screen's beacon, so the frames below notice within SCREEN_GRACE_MS when it goes.
 * - `bp:q`: the leader's questions (plan.ts), every PLAN_EVERY_MS and at once on a change. Only
 *   the leader's are heeded.
 *
 * Anything that arrives is checked field by field and dropped if out of range, because any page
 * on the public site can join a room it guesses.
 */
import type { Channel } from "../../core/types";
import { BEACON_MS, MAX_QUEUE, SCREEN_GRACE_MS, TOTALS_EVERY_MS, TOTALS_MIN_MS } from "./config";
import { decodePlan, PLAN_EVERY_MS, type PlanMsg } from "./plan";
import { MAX_ANSWERS, questionById } from "./questions";
import type { Skip } from "./schedule";
import { cleanSnapshot, MAX_COUNT, MAX_GEN, type TallySnapshot } from "./tally";

export const TOPIC = { votes: "bp:v", totals: "bp:t", here: "bp:h", plan: "bp:q" } as const;

export interface VoteMsg {
  q: string;
  /** Generation and the sender's new count for this answer. */
  g: number;
  a: number;
  n: number;
  /** Clock ms the ball leaves the sender's top edge. */
  t: number;
  /** Where it leaves: fraction across the sender, and the sender's position in the bank. */
  u: number;
  p: number;
}

export interface TotalsMsg {
  d: string;
  q: Record<string, TallySnapshot>;
  k?: Skip;
}

const MAX_BATCH = 32;
const MAX_SENDS_PER_TICK = 8;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const T_MAX = 1e14;

const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number =>
  num(v, lo, hi) && Number.isInteger(v);

export const decodeVote = (v: unknown): VoteMsg | null => {
  if (typeof v !== "object" || v === null) return null;
  const d = v as Record<string, unknown>;
  if (typeof d.q !== "string") return null;
  const q = questionById(d.q);
  if (!q) return null;
  if (!num(d.g, 0, MAX_GEN) || !int(d.a, 0, Math.min(MAX_ANSWERS, q.answers.length) - 1))
    return null;
  if (!int(d.n, 1, MAX_COUNT) || d.b === 1) return null;
  if (!num(d.t, 0, T_MAX) || !num(d.u, -0.5, 1.5) || !int(d.p, 0, 63)) return null;
  return { q: d.q, g: d.g, a: d.a, n: d.n, t: d.t, u: d.u, p: d.p };
};

export const decodeVotes = (data: unknown): { d: string; v: VoteMsg[] } | null => {
  if (typeof data !== "object" || data === null) return null;
  const m = data as { d?: unknown; v?: unknown };
  if (typeof m.d !== "string" || !DAY.test(m.d) || !Array.isArray(m.v)) return null;
  const v: VoteMsg[] = [];
  for (const item of m.v.slice(0, MAX_BATCH)) {
    const vote = decodeVote(item);
    if (vote) v.push(vote);
  }
  return { d: m.d, v };
};

export const decodeTotals = (data: unknown): TotalsMsg | null => {
  if (typeof data !== "object" || data === null) return null;
  const m = data as { d?: unknown; q?: unknown; k?: unknown };
  if (typeof m.d !== "string" || !DAY.test(m.d)) return null;
  if (typeof m.q !== "object" || m.q === null || Array.isArray(m.q)) return null;
  const q: Record<string, TallySnapshot> = {};
  let count = 0;
  for (const [qid, snap] of Object.entries(m.q as Record<string, unknown>)) {
    if (++count > 4) break;
    const clean = cleanSnapshot(qid, snap);
    if (clean) q[qid] = clean;
  }
  const out: TotalsMsg = { d: m.d, q };
  const k = m.k as { k?: unknown; n?: unknown } | undefined;
  if (k && typeof k === "object" && int(k.k, 0, 1e12) && int(k.n, 0, 1000))
    out.k = { k: k.k, n: k.n };
  return out;
};

export interface LinkDeps {
  net: Channel;
  isScreen: boolean;
  /** Local ms. */
  now(): number;
  day(): string;
  /** Totals for the questions up now, and the skip. */
  totals(): TotalsMsg;
  onVotes(votes: VoteMsg[], from: string): void;
  /** Returns true when this frame has something the sender lacks. */
  onTotals(msg: TotalsMsg, from: string): boolean;
  /** What this frame shows, announced while it leads. */
  plan(): PlanMsg;
  /** The leader's questions. */
  onPlan(msg: PlanMsg, from: string): void;
}

export interface Link {
  /** Queue a vote to go out with the next tick. */
  vote(v: VoteMsg): void;
  /** Something changed that the leader should announce. */
  changed(): void;
  /** Send due messages. Call often (every frame is fine). */
  tick(): void;
  /** The screen heard from lately, or null. */
  screen(): string | null;
  isLeader(): boolean;
  /** Votes waiting for the room to come back. */
  readonly queued: number;
  readonly sent: number;
  readonly received: number;
  dispose(): void;
}

export const createLink = (d: LinkDeps): Link => {
  const { net } = d;
  let batch: VoteMsg[] = [];
  const offline: VoteMsg[] = [];
  const heard = new Map<string, number>();
  let dirty = true;
  let lastTotals = -Infinity;
  let lastBeacon = -Infinity;
  let lastLeader: string | null = null;
  let lastPlan = -Infinity;
  let lastPlanKey = "";
  let owe: string | null = null;
  let oweAt = -Infinity;
  let sent = 0;
  let received = 0;
  let disposed = false;

  const offs = [
    net.on(TOPIC.votes, (data, from) => {
      const m = decodeVotes(data);
      if (!m || m.d !== d.day() || m.v.length === 0) return;
      received += m.v.length;
      d.onVotes(m.v, from);
    }),
    net.on(TOPIC.totals, (data, from) => {
      const m = decodeTotals(data);
      if (!m || m.d !== d.day()) return;
      const ahead = d.onTotals(m, from);
      if (ahead && from === net.leader()) owe = from;
      if (net.leader() === net.self) dirty = true;
    }),
    net.on(TOPIC.plan, (data, from) => {
      if (from !== net.leader() || from === net.self) return;
      const m = decodePlan(data);
      if (m) d.onPlan(m, from);
    }),
    net.on(TOPIC.here, (_data, from) => {
      const peer = net.peers().find((p) => p.frame === from);
      if (!peer || peer.role !== "screen") return;
      heard.set(from, d.now());
      if (heard.size > 8) {
        const first = heard.keys().next().value;
        if (first !== undefined) heard.delete(first);
      }
    }),
  ];

  const sendTotals = (to?: string) => {
    if (!net.online) return;
    net.send(TOPIC.totals, d.totals(), to);
    sent++;
  };

  const flushVotes = () => {
    if (!net.online) {
      offline.push(...batch);
      batch = [];
      while (offline.length > MAX_QUEUE) offline.shift();
      return;
    }
    const out = [...offline, ...batch];
    offline.length = 0;
    batch = [];
    let sends = 0;
    while (out.length > 0 && sends < MAX_SENDS_PER_TICK) {
      net.send(TOPIC.votes, { d: d.day(), v: out.splice(0, MAX_BATCH) });
      sent++;
      sends++;
    }
    // Anything left over goes next tick.
    offline.push(...out);
    while (offline.length > MAX_QUEUE) offline.shift();
  };

  return {
    vote(v) {
      batch.push(v);
      if (batch.length > MAX_QUEUE) batch.shift();
    },
    changed() {
      dirty = true;
    },
    tick() {
      if (disposed) return;
      const t = d.now();
      if (batch.length > 0 || (offline.length > 0 && net.online)) flushVotes();
      if (!net.online) return;
      if (d.isScreen && t - lastBeacon >= BEACON_MS) {
        lastBeacon = t;
        net.send(TOPIC.here, {});
      }
      const leader = net.leader();
      if (leader !== lastLeader) {
        lastLeader = leader;
        // A new leader hears what this frame knows, and a new member hears the leader soon.
        if (leader && leader !== net.self) sendTotals(leader);
        dirty = true;
      }
      if (leader === net.self) {
        const plan = d.plan();
        const key = JSON.stringify(plan);
        if (key !== lastPlanKey || t - lastPlan >= PLAN_EVERY_MS) {
          lastPlanKey = key;
          lastPlan = t;
          net.send(TOPIC.plan, plan);
          sent++;
        }
        if ((dirty && t - lastTotals >= TOTALS_MIN_MS) || t - lastTotals >= TOTALS_EVERY_MS) {
          lastTotals = t;
          dirty = false;
          sendTotals();
        }
      } else if (owe && t - oweAt >= 2000) {
        oweAt = t;
        if (owe === leader) sendTotals(owe);
        owe = null;
      }
    },
    screen() {
      const t = d.now();
      let best: string | null = null;
      let at = -Infinity;
      // Beacons alone decide: the roster can flicker while the room changes hub.
      for (const [frame, when] of heard) {
        if (t - when > SCREEN_GRACE_MS || when <= at) continue;
        best = frame;
        at = when;
      }
      return best;
    },
    isLeader: () => net.leader() === net.self,
    get queued() {
      return offline.length;
    },
    get sent() {
      return sent;
    },
    get received() {
      return received;
    },
    dispose() {
      disposed = true;
      for (const off of offs) off();
      heard.clear();
      batch = [];
      offline.length = 0;
    },
  };
};
