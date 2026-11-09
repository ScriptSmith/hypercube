/**
 * Which puzzle a bank is on. The leader (the screen if there is one, else the lowest position)
 * announces the round every second; every touch frame reports whether it is solved, lit by real
 * light, and idle. The bank is through when the last frame glows from real light (the screen's
 * finale says the same), or when every frame present has been solved for a while although the
 * light can't get through (a frame missing or broken). The leader then cheers, and after the
 * celebration starts the next round. When every frame is idle, the ramp goes back to its start.
 *
 * A frame that hears no round for a few seconds carries on alone, and a new leader first listens
 * to the frames' reports, so it takes up the bank's round instead of starting over.
 */
import type { Channel, PeerInfo } from "../../core/types";
import {
  BANK_ALONE_MS,
  BANK_IDLE_ROUND_MS,
  BANK_CHEER_MS,
  BANK_STUCK_MS,
  LEADER_SETTLE_MS,
  ROUND_BEAT_MS,
  ROUND_SETTLE_MS,
  ROUND_LOST_MS,
} from "./config";
import {
  type StateMsg,
  TOPIC,
  decodeCheer,
  decodeRound,
  decodeState,
  encodeCheer,
  encodeRound,
  encodeState,
} from "./wire";

export interface Round {
  serial: number;
  level: number;
}

export interface OwnState {
  solved: boolean;
  real: boolean;
  idle: boolean;
}

export interface RoundsOptions {
  net: Channel;
  now: () => number;
  side: number;
  /** Touch frames in the bank. */
  count: number;
  rampLength: number;
  /** Ramp index the bank starts at and returns to. */
  start: number;
  /** This frame's own state, or null for the screen. */
  own: () => OwnState | null;
  pos: number;
  onRound(r: Round): void;
  onCheer(serial: number, finale: boolean): void;
}

export interface Rounds {
  readonly round: Round;
  /** Frames (bit per position) solved this round, and lit by real light. */
  readonly solvedMask: number;
  readonly realMask: number;
  readonly leading: boolean;
  /** Cheering until this local time. */
  readonly cheerUntil: number;
  tick(): void;
  /** The screen's crystals are all lit by real light. */
  finale(): void;
  /** Move on to the next puzzle (admin). */
  skip(): void;
  dispose(): void;
}

const STATE_FRESH_MS = 3200;
const sideOf = (p: PeerInfo) => p.side ?? 0;

export const createRounds = (o: RoundsOptions): Rounds => {
  const { net } = o;
  let round: Round = { serial: 0, level: o.start };
  let solvedMask = 0;
  let realMask = 0;
  let heardAt = -Infinity;
  let leaderSince: number | null = null;
  let announcedAt = -Infinity;
  let reportedAt = -Infinity;
  let cheerUntil = -Infinity;
  let pendingCheer: number | null = null;
  let allSolvedSince: number | null = null;
  let idleDone = false;
  let maxHeard: Round | null = null;
  let roundAt = o.now();
  const states = new Map<string, { pos: number; s: StateMsg; at: number }>();

  const touchPeers = () => net.peers().filter((p) => p.role !== "screen" && sideOf(p) === o.side);

  const isLeader = () => {
    const t = o.now();
    if (net.leader() === net.self || !net.online) return true;
    return t - heardAt > ROUND_LOST_MS;
  };

  const set = (r: Round) => {
    if (r.serial === round.serial && r.level === round.level) return;
    round = { ...r };
    roundAt = o.now();
    allSolvedSince = null;
    o.onRound(round);
  };

  const announce = () => {
    net.send(TOPIC.round, encodeRound({ ...round, solved: solvedMask, real: realMask }));
    announcedAt = o.now();
  };

  const next = (level: number) => {
    pendingCheer = null;
    set({ serial: round.serial + 1, level });
    solvedMask = 0;
    realMask = 0;
    if (net.online) announce();
  };

  const complete = (finale: boolean) => {
    if (pendingCheer !== null) return;
    pendingCheer = round.serial;
    cheerUntil = o.now() + BANK_CHEER_MS;
    o.onCheer(round.serial, finale);
    if (net.online) net.send(TOPIC.cheer, encodeCheer({ serial: round.serial, finale }));
  };

  const offs = [
    net.on(TOPIC.round, (data, from) => {
      if (from !== net.leader()) return;
      const m = decodeRound(data);
      if (!m) return;
      heardAt = o.now();
      leaderSince = null;
      solvedMask = m.solved;
      realMask = m.real;
      set({ serial: m.serial, level: m.level });
    }),
    net.on(TOPIC.cheer, (data, from) => {
      const p = net.peers().find((x) => x.frame === from);
      if (!p || (from !== net.leader() && p.role !== "screen")) return;
      const m = decodeCheer(data);
      if (!m || m.serial !== round.serial) return;
      if (cheerUntil > o.now()) return;
      cheerUntil = o.now() + BANK_CHEER_MS;
      if (isLeader()) pendingCheer = round.serial;
      o.onCheer(m.serial, m.finale);
    }),
    net.on(TOPIC.state, (data, from) => {
      const p = touchPeers().find((x) => x.frame === from);
      if (!p) return;
      const s = decodeState(data);
      if (!s) return;
      states.set(from, { pos: p.pos, s, at: o.now() });
      if (states.size > 64) {
        const first = states.keys().next().value;
        if (first !== undefined) states.delete(first);
      }
      if (!maxHeard || s.serial > maxHeard.serial) maxHeard = { serial: s.serial, level: s.level };
    }),
    net.on(TOPIC.skip, (_data, from) => {
      if (!net.peers().some((x) => x.frame === from)) return;
      if (isLeader()) next(nextLevel());
    }),
  ];

  const nextLevel = () => (round.level + 1 >= o.rampLength ? o.start : round.level + 1);

  const lead = (t: number) => {
    if (leaderSince === null) leaderSince = t;
    // A new leader takes up the round the bank is already on.
    if (t - leaderSince < LEADER_SETTLE_MS && net.online && touchPeers().length > 1) return;
    if (maxHeard && maxHeard.serial > round.serial) set(maxHeard);
    maxHeard = null;

    if (pendingCheer !== null) {
      if (t >= cheerUntil) next(nextLevel());
      else if (t - announcedAt >= ROUND_BEAT_MS && net.online) announce();
      return;
    }

    // Who is here and how they are doing.
    const present = new Map<number, OwnState>();
    const own = o.own();
    if (own) present.set(o.pos, own);
    const peers = touchPeers();
    for (const [frame, e] of states) {
      if (t - e.at > STATE_FRESH_MS || !peers.some((p) => p.frame === frame)) {
        if (t - e.at > STATE_FRESH_MS * 4) states.delete(frame);
        continue;
      }
      if (e.s.serial !== round.serial) continue;
      present.set(e.pos, e.s);
    }
    solvedMask = 0;
    realMask = 0;
    for (const [pos, s] of present) {
      if (pos < 0 || pos > 30) continue;
      if (s.solved) solvedMask |= 1 << pos;
      if (s.real) realMask |= 1 << pos;
    }

    const all = [...present.values()];
    // Just after a new round, light from the last one may still be about.
    const settled = t - roundAt >= ROUND_SETTLE_MS;
    // Back to the start once when everyone has gone; again only after someone has played.
    // Frames that haven't reported this round yet say nothing either way.
    if (all.length > 0 && all.every((s) => s.idle)) {
      if (!idleDone) {
        idleDone = true;
        next(o.start);
        return;
      }
    } else if (all.some((s) => !s.idle)) {
      idleDone = false;
    }
    // Nobody playing and the attract hands haven't got the light through: try another puzzle.
    if (all.length > 0 && all.every((s) => s.idle) && t - roundAt >= BANK_IDLE_ROUND_MS) {
      next(nextLevel());
      return;
    }

    // The light got through: the last frame glows from real light, and every frame is solved
    // (so stray light can't count).
    const last = present.get(o.count - 1);
    if (settled && last?.real && last.solved && all.every((s) => s.solved)) {
      complete(false);
      return;
    }
    // Frames in the roster that haven't reported this round yet are still deciding, not missing.
    const listed = peers.length + (own && !peers.some((p) => p.frame === net.self) ? 1 : 0);
    if (all.length > 0 && all.length >= listed && all.every((s) => s.solved)) {
      allSolvedSince ??= t;
      const wait = listed < o.count ? BANK_ALONE_MS : BANK_STUCK_MS;
      if (settled && t - allSolvedSince >= wait) {
        complete(false);
        return;
      }
    } else {
      allSolvedSince = null;
    }
    if (t - announcedAt >= ROUND_BEAT_MS && net.online) announce();
  };

  return {
    get round() {
      return round;
    },
    get solvedMask() {
      return solvedMask;
    },
    get realMask() {
      return realMask;
    },
    get leading() {
      return isLeader();
    },
    get cheerUntil() {
      return cheerUntil;
    },
    tick() {
      const t = o.now();
      if (isLeader()) {
        lead(t);
      } else {
        leaderSince = null;
        pendingCheer = null;
        allSolvedSince = null;
      }
      const own = o.own();
      const to = net.leader();
      if (own && net.online && to && to !== net.self && t - reportedAt >= ROUND_BEAT_MS) {
        net.send(TOPIC.state, encodeState({ ...round, ...own }), to);
        reportedAt = t;
      }
    },
    finale() {
      if (isLeader()) complete(true);
    },
    skip() {
      if (isLeader()) next(nextLevel());
      else {
        const to = net.leader();
        if (to && net.online) net.send(TOPIC.skip, {}, to);
      }
    },
    dispose() {
      for (const off of offs) off();
      states.clear();
    },
  };
};
