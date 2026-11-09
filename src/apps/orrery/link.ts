/**
 * A bank's frames and its leader (the screen when there is one, else the leftmost frame, as
 * `Channel.leader()` says). Frames send their controls' claims to the leader; the leader's keeper
 * decides and it tells everyone the state: up to 15 times a second while it changes, once a
 * second otherwise. A frame that hears no state from its leader for a few seconds decides for
 * itself, so a bank whose screen has gone carries on, each frame from the last state it heard.
 */
import type { Channel } from "../../core/types";
import type { Keeper, KnobId, Shared } from "./keeper";
import { decodeClaim, decodeState, encodeClaim, encodeState, TOPIC } from "./wire";

/** Fastest the leader repeats a changing state, and its heartbeat. */
export const STATE_FAST_MS = 66;
export const STATE_SLOW_MS = 1000;
/** No state from the leader for this long, and a frame decides for itself. */
export const LEADER_GRACE_MS = 3000;
/** A held control repeats its claim this often, and sends moves at most every CLAIM_GAP_MS. */
export const CLAIM_HEARTBEAT_MS = 500;
export const CLAIM_GAP_MS = 66;
/** Fewest ms between two messages of a kind from one frame that are taken. */
const IN_GAP_MS = 20;
const MAX_SENDERS = 64;

export interface LocalClaim {
  knob: KnobId;
  a: number;
  b: number;
  held: boolean;
  since: number;
  bot: boolean;
}

interface Slot extends LocalClaim {
  sentA: number;
  sentB: number;
  sentHeld: boolean;
  sentAt: number;
}

export interface Link {
  /** True while this frame decides: it leads, or hears no leader. */
  deciding(now: number): boolean;
  /** The leader's frame id when it is another frame, else null. */
  leader(): string | null;
  /** A local control's claim, for the leader. Sent by `tick`. */
  claim(c: LocalClaim): void;
  /** Send what is due: claims to the leader, or the state to everyone. */
  tick(now: number, clock: number, keeper: Keeper): void;
  /** States heard, claims heard and messages sent, for tests and status. */
  readonly counts: { states: number; claims: number; sent: number };
  dispose(): void;
}

/** In the tour every frame works the state out from the clock, so only the mode matters. */
const sameSky = (a: Shared, b: Shared): boolean =>
  (a.mode === "tour" && b.mode === "tour") ||
  (a.mode === b.mode &&
    Math.abs(a.sky.day - b.sky.day) < 1e-4 &&
    Math.abs(a.sky.hour - b.sky.hour) < 1e-3 &&
    Math.abs(a.sky.tilt - b.sky.tilt) < 0.01 &&
    a.sky.flat === b.sky.flat &&
    a.sky.speed === b.sky.speed);

export const createLink = (
  net: Channel,
  o: {
    now: () => number;
    clock: () => number;
    /** Days a second time passes by itself in a state (the Moon variant's speed), so a state
     * that only moves on as followers expect isn't repeated fast. */
    rate?: (s: Shared) => number;
    /** The leader's state arrived (followers only). */
    onState(s: Shared, from: string): void;
    /** A claim arrived from another frame (the leader only). */
    onClaim(c: {
      from: string;
      knob: KnobId;
      a: number;
      b: number;
      held: boolean;
      since: number;
      human: boolean;
    }): void;
  },
): Link => {
  const counts = { states: 0, claims: 0, sent: 0 };
  let heardAt = Number.NEGATIVE_INFINITY;
  let heardFrom: string | null = null;
  const slots = new Map<KnobId, Slot>();
  const lastIn = new Map<string, number>();
  let sentShared: Shared | null = null;
  let sentAt = Number.NEGATIVE_INFINITY;

  const leaderId = () => net.leader();
  const gap = (key: string, t: number) => {
    const last = lastIn.get(key);
    if (last !== undefined && t - last < IN_GAP_MS) return false;
    lastIn.delete(key);
    lastIn.set(key, t);
    while (lastIn.size > MAX_SENDERS * 2) {
      const first = lastIn.keys().next().value;
      if (first === undefined) break;
      lastIn.delete(first);
    }
    return true;
  };

  const offs = [
    net.on(TOPIC.state, (data, from) => {
      if (from === net.self || from !== leaderId()) return;
      const t = o.now();
      if (!gap(`s:${from}`, t)) return;
      const m = decodeState(data, o.clock());
      if (!m) return;
      heardAt = t;
      heardFrom = from;
      counts.states++;
      o.onState({ mode: m.mode, sky: m.sky, quiet: m.quiet }, from);
    }),
    net.on(TOPIC.claim, (data, from) => {
      if (from === net.self || leaderId() !== net.self) return;
      if (!net.peers().some((p) => p.frame === from)) return;
      const m = decodeClaim(data, o.clock());
      if (!m) return;
      // Several knobs can move at once (a wheel and the tilt), so pace each on its own.
      if (!gap(`c:${from}:${m.knob}`, o.now())) return;
      counts.claims++;
      o.onClaim({
        from,
        knob: m.knob,
        a: m.a,
        b: m.b,
        held: m.held,
        since: m.since,
        human: !m.bot,
      });
    }),
  ];

  const deciding = (now: number) => {
    if (!net.online) return true;
    const l = leaderId();
    if (l === null || l === net.self) return true;
    return heardFrom !== l || now - heardAt > LEADER_GRACE_MS;
  };

  return {
    deciding,
    leader() {
      const l = leaderId();
      return l === null || l === net.self ? null : l;
    },
    claim(c) {
      const s = slots.get(c.knob);
      if (s) Object.assign(s, c);
      else {
        slots.set(c.knob, {
          ...c,
          sentA: Number.NaN,
          sentB: Number.NaN,
          sentHeld: false,
          sentAt: Number.NEGATIVE_INFINITY,
        });
      }
    },
    tick(now, clock, keeper) {
      if (!net.online) {
        slots.clear();
        return;
      }
      const l = leaderId();
      if (l === net.self) {
        slots.clear();
        const sh = keeper.shared(now, clock);
        let changed = !sentShared;
        if (sentShared) {
          const drift = sh.mode === "manual" ? (o.rate?.(sh) ?? 0) * ((now - sentAt) / 1000) : 0;
          const expect = {
            ...sentShared,
            sky: { ...sentShared.sky, day: sentShared.sky.day + drift },
          };
          changed = !sameSky(sh, expect);
        }
        const due = changed ? now - sentAt >= STATE_FAST_MS : now - sentAt >= STATE_SLOW_MS;
        if (!due) return;
        net.send(TOPIC.state, encodeState(sh, clock));
        counts.sent++;
        sentShared = sh;
        sentAt = now;
        return;
      }
      sentShared = null;
      if (l === null) return;
      for (const [knob, s] of slots) {
        const moved = s.a !== s.sentA || s.b !== s.sentB;
        const due =
          s.held !== s.sentHeld ||
          (moved && now - s.sentAt >= CLAIM_GAP_MS) ||
          (s.held && now - s.sentAt >= CLAIM_HEARTBEAT_MS);
        if (due) {
          net.send(TOPIC.claim, encodeClaim(knob, s.a, s.b, s.held, s.since, clock, s.bot), l);
          counts.sent++;
          s.sentA = s.a;
          s.sentB = s.b;
          s.sentHeld = s.held;
          s.sentAt = now;
        }
        if (!s.held && !s.sentHeld && s.a === s.sentA && s.b === s.sentB) slots.delete(knob);
      }
    },
    get counts() {
      return counts;
    },
    dispose() {
      for (const off of offs) off();
      slots.clear();
      lastIn.clear();
    },
  };
};
