/**
 * A bank's shared shape. The leader (the screen when there is one, else the leftmost frame, as
 * `Channel.leader` says) owns the family and the orientation; every frame and the screen run
 * this same object and show what it says.
 *
 * With nobody touching, the bank is on its slow turn, a function of the shared clock, so every
 * frame shows the same orientation without messages. A dial turn, a "first" button or a shape
 * button on any frame goes to the leader as a numbered input; the leader applies it (a bot's
 * only when no person has touched lately), leaves the slow turn, and sends the orientation out.
 * The frame that turned a dial shows its own unconfirmed turns on top of the last orientation
 * it heard, so the dial feels direct, and drops each one when the leader says it is applied.
 *
 * A frame whose leader goes quiet carries on by itself from what it last showed; when another
 * frame becomes leader it continues from there too.
 */
import type { Channel } from "../../core/types";
import { familyAt } from "./config";
import { DIAL_PLANES } from "./layout";
import { ease, restRot, slowTurn, startTurning, type Turning, turningAt } from "./orient";
import { copyMat, distance, fromPair, identity, type Mat4, slerpRot, toPair, turnBy } from "./rot";
import { type Dim, shapeOf } from "./shapes";
import {
  CUT_FLAG,
  type CutMsg,
  decodeCut,
  decodeInput,
  decodeQuat,
  decodeState,
  encodeCut,
  encodeInput,
  encodeQuat,
  encodeState,
  type InputMsg,
  MAX_ACKS,
  MAX_POS,
  quantAngle,
  TOPIC,
  unquantAngle,
  unquantCut,
} from "./wire";

export const LINK = {
  /** State goes out at most this often while it changes, and at least this often. */
  stateGapMs: 66,
  stateHeartbeatMs: 1000,
  /** Dial turns go out at most this often. */
  inputGapMs: 50,
  /** Hand-turned with no input for this long, the bank goes back to its slow turn. */
  liveIdleMs: 30_000,
  /** Bot inputs are ignored this long after a person's. */
  botYieldMs: 15_000,
  /** A leader not heard from for this long has gone quiet. */
  quietMs: 3500,
  /** An unconfirmed input is dropped after this long. */
  pendingMs: 2500,
  /** Easing onto the slow turn, and towards a heard orientation. */
  rejoinMs: 1500,
  followTau: 0.07,
  /** Senders acknowledged in a state message stay listed this long. */
  ackMs: 5000,
} as const;

const MAX_PENDING = 64;

export interface SharedView {
  readonly family: number;
  /** True while the shape is turned by hand rather than on the slow turn. */
  readonly live: boolean;
  /** True while this frame owns the state (it is the leader, or its leader has gone quiet). */
  readonly leading: boolean;
  /** True when it hears a leader other than itself. */
  readonly following: boolean;
}

export interface Shared extends SharedView {
  /** The orientation to draw now, into `out`. */
  orientation(out: Mat4): Mat4;
  turn(dial: number, angle: number, human: boolean): void;
  preset(k: number, human: boolean): void;
  setFamily(f: number, human: boolean): void;
  step(): void;
  /** Back to the slow turn and cubes, as this frame sees it (the runtime's idle). */
  reset(): void;
  readonly stats: {
    sent: number;
    heard: number;
    applied: number;
    ignored: number;
    pending: number;
  };
  dispose(): void;
}

export interface SharedOpts {
  net: Channel;
  /** This frame's place in the bank; -1 for the screen. */
  pos: number;
  dim: Dim;
  /** Shared-clock ms and local ms. */
  clock: () => number;
  now: () => number;
}

interface Pending {
  seq: number;
  dial: number;
  angle: number;
  at: number;
}

export const createShared = (o: SharedOpts): Shared => {
  const { net, dim } = o;
  const planes = DIAL_PLANES[dim];
  let family = 0;
  let live = false;
  /** The leader's orientation while live (heard, or our own when leading). */
  const rot = identity();
  /** What was last drawn, for easing from it. */
  const shown = identity();
  /** A heard orientation being eased towards. */
  const smooth = identity();
  let blendFrom: Mat4 | null = null;
  let blendStart = 0;
  let turning: Turning | null = null;
  let lastInput = Number.NEGATIVE_INFINITY;
  let lastHuman = Number.NEGATIVE_INFINITY;
  let heardAt = Number.NEGATIVE_INFINITY;
  let heardFrom: string | null = null;
  let wasLeading = false;
  // Follower side.
  let seq = 0;
  const pending: Pending[] = [];
  const unsent = [0, 0, 0];
  const unsentHuman = [false, false, false];
  let lastInputSent = Number.NEGATIVE_INFINITY;
  let pendingFamily: { seq: number; f: number; at: number } | null = null;
  // Leader side.
  const acks = new Map<number, { seq: number; at: number }>();
  let dirty = true;
  let sentAt = Number.NEGATIVE_INFINITY;
  const stats = { sent: 0, heard: 0, applied: 0, ignored: 0, pending: 0 };
  const tmp = identity();
  let drawnAt = o.now();

  const shape = () => shapeOf(familyAt(family), dim);

  const designated = (): string | null => (net.online ? net.leader() : null);
  const isLeader = () => {
    const l = designated();
    return l === null || l === net.self;
  };
  const leaderQuiet = () => o.now() - heardAt > LINK.quietMs;
  const leading = () => isLeader() || leaderQuiet();

  /** The orientation the bank would show now with no prediction. */
  const base = (out: Mat4): Mat4 => {
    if (!live) return slowTurn(shape(), o.clock(), out);
    return copyMat(rot, out);
  };

  const enterLive = () => {
    if (live) return;
    // Continue from what everyone sees on the slow turn.
    slowTurn(shape(), o.clock(), rot);
    copyMat(rot, smooth);
    live = true;
    dirty = true;
  };

  /** Apply one input as the owner of the state. */
  const apply = (m: InputMsg, human: boolean): boolean => {
    const t = o.now();
    if (!human && t - lastHuman < LINK.botYieldMs) {
      stats.ignored++;
      return false;
    }
    if (human) lastHuman = t;
    lastInput = t;
    if ("d" in m) {
      enterLive();
      const p = planes[m.d];
      if (p) turnBy(rot, p[0], p[1], unquantAngle(m.a));
      turning = null;
    } else if ("o" in m) {
      enterLive();
      turning = startTurning(shape(), rot, m.o, t);
    } else {
      family = m.f;
      enterLive();
      copyMat(restRot(shape()), rot);
      turning = null;
    }
    stats.applied++;
    dirty = true;
    return true;
  };

  const offInput = net.on(TOPIC.input, (data, from) => {
    if (!leading() || from === net.self) return;
    const m = decodeInput(data);
    if (!m) return;
    const peer = net.peers().find((p) => p.frame === from);
    if (
      !peer ||
      peer.role === "screen" ||
      !Number.isInteger(peer.pos) ||
      peer.pos < 0 ||
      peer.pos > MAX_POS
    )
      return;
    apply(m, m.h === 1);
    acks.set(peer.pos, { seq: m.s, at: o.now() });
    while (acks.size > MAX_ACKS) {
      const first = acks.keys().next().value;
      if (first === undefined) break;
      acks.delete(first);
    }
    dirty = true;
  });

  const offState = net.on(TOPIC.state, (data, from) => {
    if (from === net.self || from !== designated()) return;
    const m = decodeState(data);
    if (!m) return;
    const q = decodeQuat(m.r);
    if (!q) return;
    stats.heard++;
    const t = o.now();
    heardAt = t;
    heardFrom = from;
    const wasLive = live;
    const wasFamily = family;
    family = m.f;
    if (m.m === 1) {
      fromPair(q.a, q.b, rot);
      if (!wasLive || wasFamily !== family) copyMat(rot, smooth);
      live = true;
    } else {
      if (wasLive) {
        blendFrom = copyMat(shown);
        blendStart = t;
      }
      live = false;
    }
    const mine = m.k.find(([p]) => p === o.pos);
    if (mine) {
      while (pending.length > 0 && pending[0]!.seq <= mine[1]) pending.shift();
      if (pendingFamily && pendingFamily.seq <= mine[1]) pendingFamily = null;
    }
  });

  const send = (m: InputMsg) => {
    const to = designated();
    if (!to || to === net.self || !net.online) return false;
    net.send(TOPIC.input, encodeInput(m), to);
    stats.sent++;
    return true;
  };

  const flushTurns = (force: boolean) => {
    const t = o.now();
    if (!force && t - lastInputSent < LINK.inputGapMs) return;
    for (let d = 0; d < 3; d++) {
      const a = unsent[d]!;
      if (a === 0) continue;
      const q = quantAngle(a);
      if (q === 0 && !force) continue;
      const s = ++seq;
      if (send({ s, h: unsentHuman[d] ? 1 : 0, d, a: q })) {
        if (pending.length >= MAX_PENDING) pending.shift();
        pending.push({ seq: s, dial: d, angle: unquantAngle(q), at: t });
      }
      unsent[d] = a - unquantAngle(q);
      unsentHuman[d] = false;
      lastInputSent = t;
    }
  };

  const broadcast = () => {
    const t = o.now();
    const due = (dirty && t - sentAt >= LINK.stateGapMs) || t - sentAt >= LINK.stateHeartbeatMs;
    if (!due || !net.online) return;
    const { a, b } = toPair(live ? rot : base(tmp));
    const k: [number, number][] = [];
    for (const [p, v] of acks) {
      if (t - v.at > LINK.ackMs) acks.delete(p);
      else k.push([p, v.seq]);
    }
    net.send(TOPIC.state, encodeState({ m: live ? 1 : 0, f: family, r: encodeQuat(a, b), k }));
    stats.sent++;
    sentAt = t;
    dirty = false;
  };

  return {
    get family() {
      return pendingFamily ? pendingFamily.f : family;
    },
    get live() {
      return live;
    },
    get leading() {
      return leading();
    },
    get following() {
      return !isLeader() && !leaderQuiet() && heardFrom !== null;
    },
    get stats() {
      stats.pending = pending.length;
      return stats;
    },
    orientation(out) {
      const t = o.now();
      const dt = Math.min(0.1, Math.max(0, (t - drawnAt) / 1000));
      drawnAt = t;
      if (leading()) {
        if (turning && turningAt(turning, t, rot)) turning = null;
        base(out);
      } else if (live) {
        if (pending.length > 0 || unsent.some((a) => a !== 0)) copyMat(rot, smooth);
        else if (distance(smooth, rot) > 1.2) copyMat(rot, smooth);
        else slerpRot(smooth, rot, 1 - Math.exp(-dt / LINK.followTau), smooth);
        copyMat(smooth, out);
        for (const p of pending) {
          const pl = planes[p.dial];
          if (pl) turnBy(out, pl[0], pl[1], p.angle);
        }
        for (let d = 0; d < 3; d++) {
          const pl = planes[d];
          if (pl && unsent[d] !== 0) turnBy(out, pl[0], pl[1], unsent[d]!);
        }
      } else {
        base(out);
      }
      if (blendFrom) {
        const f = (t - blendStart) / LINK.rejoinMs;
        if (f >= 1 || live) blendFrom = null;
        else slerpRot(blendFrom, out, ease(f), out);
      }
      copyMat(out, shown);
      return out;
    },
    turn(dial, angle, human) {
      if (!Number.isFinite(angle) || angle === 0 || !planes[dial]) return;
      if (leading()) {
        const q = quantAngle(angle);
        // As the owner, apply the exact turn; the quantised form is only for the wire.
        if (apply({ s: 0, h: human ? 1 : 0, d: dial, a: q }, human)) {
          const p = planes[dial]!;
          turnBy(rot, p[0], p[1], angle - unquantAngle(q));
        }
        return;
      }
      if (!human && o.now() - lastHuman < LINK.botYieldMs) return;
      if (human) lastHuman = o.now();
      if (!live) {
        // Show the turn at once on top of the slow turn, until the leader's word arrives.
        slowTurn(shape(), o.clock(), rot);
        copyMat(rot, smooth);
        live = true;
      }
      unsent[dial] = unsent[dial]! + angle;
      if (human) unsentHuman[dial] = true;
      flushTurns(false);
    },
    preset(k, human) {
      if (leading()) {
        apply({ s: 0, h: human ? 1 : 0, o: k }, human);
        return;
      }
      if (!human && o.now() - lastHuman < LINK.botYieldMs) return;
      if (human) lastHuman = o.now();
      flushTurns(true);
      send({ s: ++seq, h: human ? 1 : 0, o: k });
    },
    setFamily(f, human) {
      if (leading()) {
        apply({ s: 0, h: human ? 1 : 0, f }, human);
        return;
      }
      if (!human && o.now() - lastHuman < LINK.botYieldMs) return;
      if (human) lastHuman = o.now();
      flushTurns(true);
      const s = ++seq;
      if (send({ s, h: human ? 1 : 0, f })) pendingFamily = { seq: s, f, at: o.now() };
    },
    step() {
      const t = o.now();
      const lead = leading();
      if (lead && !wasLeading) {
        // Taking over: carry on from what this frame was showing, as if just touched.
        if (live) copyMat(shown, rot);
        lastInput = t;
        pending.length = 0;
        unsent.fill(0);
        pendingFamily = null;
        dirty = true;
      }
      wasLeading = lead;
      if (lead) {
        if (turning && turningAt(turning, t, rot)) turning = null;
        if (live && !turning && t - lastInput > LINK.liveIdleMs) {
          live = false;
          blendFrom = copyMat(shown);
          blendStart = t;
          dirty = true;
        }
        if (turning) dirty = true;
        if (isLeader()) broadcast();
        return;
      }
      flushTurns(false);
      while (pending.length > 0 && t - pending[0]!.at > LINK.pendingMs) pending.shift();
      if (pendingFamily && t - pendingFamily.at > LINK.pendingMs) pendingFamily = null;
    },
    reset() {
      // A leader's own idle says nothing about the other frames: reset only a quiet bank.
      if (leading() && o.now() - lastInput > LINK.liveIdleMs) {
        family = 0;
        live = false;
        turning = null;
        dirty = true;
      }
      pending.length = 0;
      unsent.fill(0);
      pendingFamily = null;
      blendFrom = null;
    },
    dispose() {
      offInput();
      offState();
      pending.length = 0;
      acks.clear();
    },
  };
};

// ---- Slices to the screen ---------------------------------------------------------------------

export const CUT_GAP_MS = 66;
export const CUT_HEARTBEAT_MS = 2000;
/** A frame not heard from for this long shows its default slice on the screen. */
export const CUT_STALE_MS = 5000;
const MAX_SENDERS = 64;

/** The screen on this frame's side, if the roster lists one. */
export const screenOf = (net: Channel): string | null =>
  net.online
    ? (net.peers().find((p) => p.role === "screen" && p.frame !== net.self)?.frame ?? null)
    : null;

export interface CutSender {
  /** Say where this frame's slice is; sends what is due. */
  tick(m: CutMsg, now: number): void;
  readonly sent: number;
}

export const createCutSender = (net: Channel): CutSender => {
  let last: CutMsg | null = null;
  let at = Number.NEGATIVE_INFINITY;
  let to: string | null = null;
  let sent = 0;
  return {
    tick(m, now) {
      const screen = screenOf(net);
      if (!screen) {
        to = null;
        return;
      }
      const changed = !last || last.c !== m.c || last.f !== m.f || last.p !== m.p;
      const due =
        screen !== to || (changed && now - at >= CUT_GAP_MS) || now - at >= CUT_HEARTBEAT_MS;
      if (!due) return;
      net.send(TOPIC.cut, encodeCut(m), screen);
      sent++;
      last = { ...m };
      at = now;
      to = screen;
    },
    get sent() {
      return sent;
    },
  };
};

export interface HeardCut {
  frame: string;
  pos: number;
  t: number;
  flags: number;
  at: number;
}

export interface CutInbox {
  get(frame: string): HeardCut | undefined;
  dispose(): void;
}

/** The screen hearing touch frames' slices; positions come from the roster, not the message. */
export const createCutInbox = (net: Channel, now: () => number): CutInbox => {
  const heard = new Map<string, HeardCut>();
  const off = net.on(TOPIC.cut, (data, from) => {
    if (from === net.self) return;
    const peer = net.peers().find((p) => p.frame === from);
    if (
      !peer ||
      peer.role === "screen" ||
      !Number.isInteger(peer.pos) ||
      peer.pos < 0 ||
      peer.pos > MAX_POS
    )
      return;
    const m = decodeCut(data);
    if (!m) return;
    heard.delete(from);
    heard.set(from, { frame: from, pos: peer.pos, t: unquantCut(m.c), flags: m.f, at: now() });
    if (heard.size > MAX_SENDERS) {
      const first = heard.keys().next().value;
      if (first !== undefined) heard.delete(first);
    }
  });
  return {
    get(frame) {
      const h = heard.get(frame);
      if (!h) return undefined;
      if (now() - h.at > 60_000) {
        heard.delete(frame);
        return undefined;
      }
      return now() - h.at <= CUT_STALE_MS ? h : undefined;
    },
    dispose() {
      off();
      heard.clear();
    },
  };
};

export { CUT_FLAG };
