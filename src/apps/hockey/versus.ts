/**
 * Versus over the app channel: two frames (side 0 and side 1) each hold one end of a long table,
 * side by side, so their open ends meet at the middle of it.
 *
 * - Ownership: the frame a puck is on runs its physics. As a puck's leading edge reaches the
 *   open end the sender sends one handoff (puck id, height, velocity, spin, angle, how far past
 *   the end it is, send time) and forgets it, though it still draws it sliding off (render.ts).
 *   The receiver brings it in at once, where it has got to by now on the shared clock, and
 *   acknowledges. That hides the network delay: up to the time the puck takes to cross the end
 *   (about 80 ms at half speed on a wall) the two frames show it crossing together; a later
 *   handoff slides it in from just outside the end, never into the table (`ENTRY_DEPTH`).
 * - Score: each frame records the goals scored into its own goal and sends its tally; see
 *   `match.ts` for how the tallies merge.
 * - Match: whoever starts a countdown announces it; the other frame adopts it. If both start at
 *   once, the earlier start (then the lower id) wins on both.
 * - Heartbeats (1 Hz) carry the match, the tally, the pucks each frame holds and whether it has
 *   people. They let a reloaded frame rejoin, and let side 0 put back a puck that was lost with
 *   a vanished peer.
 * - Fallback: with no live peer (and always in attract) a phantom plays the far end. Pucks that
 *   leave slide back in after a pause, and in a match the phantom sometimes lets one in.
 */
import type { Channel, Clock, Rng } from "../../core/types";
import { RESPAWN_MS, type Side } from "./config";
import { mergeTheirs, recordGoal } from "./match";
import { CROSS_SPEED, type Puck } from "./physics";
import { countdownMs } from "./seats";
import type { Arrival, Lane, Table } from "./table";

const TOPIC_STATE = "hk:s";
const TOPIC_HANDOFF = "hk:h";
const TOPIC_ACK = "hk:a";
const TOPIC_GOAL = "hk:g";
const TOPIC_END = "hk:x";

const HEARTBEAT_MS = 1000;
/** How often to look for lost pucks. */
const RECOVER_MS = 250;
/** A peer whose heartbeat is older than this is treated as gone. */
const STALE_MS = 3500;
/** A puck nobody has claimed for this long is put back in play by side 0. */
const LOST_MS = 4000;
/** With the other frame gone there is nobody to wait for. */
const LOST_ALONE_MS = 1000;
/**
 * A handoff with no acknowledgement for this long is presumed lost. The puck goes in as soon as
 * the handoff lands, so this is for a peer that vanished mid-handoff; a puck is put back only
 * once the peer counts as gone (STALE_MS).
 */
const ACK_MS = 3000;
/** How long the phantom takes to send a puck back, ms: while playing, and in attract. */
const PHANTOM_MS: Record<"play" | "attract", [number, number]> = {
  play: [800, 2000],
  attract: [500, 1200],
};
/** Finished match ids remembered, so a late heartbeat can't restart one. */
const MAX_FINISHED = 8;
const MAX_ID = 64;

export interface MatchInfo {
  id: string;
  startAt: number;
  endAt: number;
}

export interface StateMsg {
  side: Side;
  keep: boolean;
  match: MatchInfo | null;
  tally: [number, number];
  owned: number[];
  away: number[];
}

export interface HandoffMsg {
  m: string;
  id: number;
  /** Height as a fraction of the lane width. */
  y: number;
  /** How far the centre is past the open end, in puck radii: about -1 as its edge reaches it. */
  d: number;
  /** Velocity as fractions of the lane's puck speed cap; vx is always away from the sender. */
  vx: number;
  vy: number;
  /** Spin (rad/s) and angle, in the sender's lane coordinates. */
  w: number;
  a: number;
  /** Shared clock ms when the puck was at `d`. */
  t: number;
}

const isNum = (v: unknown, lo = -1e15, hi = 1e15): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_ID;
const isSide = (v: unknown): v is Side => v === 0 || v === 1;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const ids = (v: unknown, n: number): number[] | null =>
  Array.isArray(v) && v.length <= n && v.every((x) => isNum(x, 0, n - 1) && Number.isInteger(x))
    ? (v as number[])
    : null;
const tally = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && isNum(v[0], 0, 1000) && isNum(v[1], 0, 1000)
    ? [v[0], v[1]]
    : null;

/** Parse a heartbeat, or null if it is malformed. `pucks` bounds the id lists. */
export const parseState = (v: unknown, pucks: number): StateMsg | null => {
  if (!isObj(v) || !isSide(v.side) || typeof v.keep !== "boolean") return null;
  let match: MatchInfo | null = null;
  if (v.match !== null) {
    const m = v.match;
    if (!isObj(m) || !isId(m.id) || !isNum(m.startAt) || !isNum(m.endAt)) return null;
    match = { id: m.id, startAt: m.startAt, endAt: m.endAt };
  }
  const t = tally(v.tally);
  const owned = ids(v.owned, pucks);
  const away = ids(v.away, pucks);
  if (!t || !owned || !away) return null;
  return { side: v.side, keep: v.keep, match, tally: t, owned, away };
};

export const parseHandoff = (v: unknown, pucks: number): HandoffMsg | null => {
  if (!isObj(v) || !isId(v.m) || !isNum(v.id, 0, pucks - 1) || !Number.isInteger(v.id)) return null;
  if (!isNum(v.y, 0, 1) || !isNum(v.d, -2, 2)) return null;
  if (!isNum(v.vx, 0, 2) || !isNum(v.vy, -2, 2)) return null;
  if (!isNum(v.w, -1000, 1000) || !isNum(v.a, -10, 10) || !isNum(v.t)) return null;
  return { m: v.m, id: v.id, y: v.y, d: v.d, vx: v.vx, vy: v.vy, w: v.w, a: v.a, t: v.t };
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The handoff for a puck leaving `lane` through its open end at clock ms `t`. */
export const handoffFor = (lane: Lane, p: Puck, matchId: string, t: number): HandoffMsg => {
  const { length: L, width: W, puckR: r, maxPuck } = lane.spec.params;
  return {
    m: matchId,
    id: p.id,
    y: clamp(p.y / W, 0, 1),
    d: clamp((p.x - L) / r, -2, 2),
    vx: clamp(Math.abs(p.vx) / maxPuck, CROSS_SPEED, 2),
    vy: clamp(p.vy / maxPuck, -2, 2),
    w: clamp(p.spin, -1000, 1000),
    a: Math.atan2(Math.sin(p.angle), Math.cos(p.angle)),
    t,
  };
};

/**
 * How a handed-off puck comes in to this frame's lane. The two open ends meet, so a puck `d`
 * radii past the sender's end is `d` radii inside this one, at the same height, moving the same
 * way, which is towards this frame's goal. The lanes are mirror images, so the angle and spin
 * are mirrored too. It comes in at once, carrying on from the send time; a sender's clock ahead
 * of this one counts as now, so nothing ever waits on a skewed clock.
 */
export const arrivalFor = (lane: Lane, h: HandoffMsg, now: number): Arrival => {
  const { width: W, puckR: r, maxPuck } = lane.spec.params;
  return {
    id: h.id,
    y: clamp(h.y * W, r, W - r),
    vx: -Math.max(CROSS_SPEED, h.vx) * maxPuck,
    vy: h.vy * maxPuck,
    spin: -h.w,
    slide: { depth: h.d * r, angle: Math.PI - h.a },
    sent: h.t,
    at: Math.min(h.t, now),
  };
};

/** Which of two matches both frames should play: the earlier start, then the lower id. */
export const preferred = (a: MatchInfo, b: MatchInfo): MatchInfo =>
  a.startAt !== b.startAt ? (a.startAt < b.startAt ? a : b) : a.id < b.id ? a : b;

export interface VersusDeps {
  net: Channel;
  table: Table;
  side: Side;
  clock: Clock;
  rng: Rng;
  /** Whether this frame has people or test bots in the match. */
  keeps(): boolean;
  /** The other frame ended the match and nobody here is playing: return to the lobby. */
  onEnded(now: number): void;
  /** The other frame has people mid-match: count it as activity so this frame doesn't idle. */
  poke(): void;
}

export interface VersusLink {
  /** A live peer on the other side. */
  connected(): boolean;
  remoteKeeps(): boolean;
  newMatch(now: number, botsOnly: boolean): { id: string; startAt: number };
  tick(now: number): void;
  dispose(): void;
}

interface Remote {
  frame: string;
  seen: number;
  state: StateMsg;
}

export const createVersusLink = (deps: VersusDeps): VersusLink => {
  const { net, table, side, clock, rng } = deps;
  const lane = table.lanes[0]!;
  const pucks = lane.pucks.length;
  const match = table.match;
  const finished: string[] = [];
  /** Pucks we sent and the other side has not acknowledged: id → clock ms sent. */
  const away = new Map<number, number>();
  /** When each puck id was first seen unaccounted for. */
  const missingSince = new Map<number, number>();
  /** Matches the other frame left; we play them out against the phantom. */
  const deserted = new Set<string>();
  let remote: Remote | null = null;
  let lastBeat = -Infinity;
  let lastRecover = -Infinity;
  let lastPhase = match.phase;
  let lastId = match.id;

  const fresh = (now: number) => remote !== null && now - remote.seen < STALE_MS;
  const inOurMatch = (now: number) =>
    fresh(now) &&
    match.id !== "" &&
    !deserted.has(match.id) &&
    remote!.state.match?.id === match.id;

  const remember = (id: string) => {
    if (!id || finished.includes(id)) return;
    finished.push(id);
    if (finished.length > MAX_FINISHED) finished.shift();
  };

  const info = (): MatchInfo | null =>
    match.phase === "countdown" || match.phase === "play"
      ? { id: match.id, startAt: match.startAt, endAt: match.endAt }
      : null;

  const beat = (now: number) => {
    lastBeat = now;
    const msg: StateMsg = {
      side,
      keep: deps.keeps(),
      match: info(),
      tally: [...match.mine],
      owned: table.owned(),
      away: [...away.keys()],
    };
    net.send(TOPIC_STATE, msg);
  };

  const adopt = (m: MatchInfo, now: number) => {
    // A clock that is still syncing can be far off; never wait long for a start.
    const startAt = Math.min(m.startAt, now + 5000);
    table.countdown(now, m.id, startAt);
    match.endAt = m.endAt;
    away.clear();
    missingSince.clear();
    lastPhase = match.phase;
    lastId = match.id;
  };

  const phantom = (p: Puck, now: number) => {
    const params = lane.spec.params;
    const playing = match.phase === "play";
    const speed = Math.hypot(p.vx, p.vy) / params.maxPuck;
    const lets = playing && rng.next() < Math.min(0.6, 0.12 + 0.55 * speed * speed);
    if (lets) recordGoal(match, side);
    const [lo, hi] = PHANTOM_MS[playing ? "play" : "attract"];
    const hold = (lets ? RESPAWN_MS : 0) + rng.range(lo, hi);
    const { width: W, goalHalf, puckR } = params;
    const y = rng.range(puckR, W - puckR);
    const tempo = playing ? 1 : 0.55;
    let vx: number;
    let vy: number;
    if (params.variant === "paddles") {
      const a = rng.range(-0.5, 0.5);
      vx = -Math.cos(a) * params.baseBall * tempo;
      vy = Math.sin(a) * params.baseBall * tempo;
    } else {
      const s = params.maxPuck * tempo * (lets ? 0.25 : rng.range(0.35, 0.7));
      const aimY = W / 2 + rng.range(-1.4, 1.4) * Math.min(goalHalf, W / 2);
      const dx = -params.length;
      const dy = aimY - y;
      const d = Math.hypot(dx, dy);
      vx = (dx / d) * s;
      vy = (dy / d) * s;
    }
    const at = now + hold;
    const slide = { depth: -params.puckR, angle: p.angle };
    table.arrive(lane, { id: p.id, y, vx, vy, spin: -p.spin, slide, sent: now, at });
  };

  const offTable = table.on((e) => {
    if (e.type === "exit") {
      // Stamped with its step's time, so the other frame knows just where it is.
      const now = e.at;
      if (match.phase === "play" && inOurMatch(now)) {
        net.send(TOPIC_HANDOFF, handoffFor(lane, e.puck, match.id, now), remote!.frame);
        away.set(e.puck.id, now);
      } else if (match.phase === "play" || match.phase === "attract") {
        phantom(e.puck, now);
      }
    } else if (e.type === "goal" && match.phase === "play") {
      net.send(TOPIC_GOAL, { m: match.id, tally: [...match.mine] });
    }
  });

  const offs = [
    net.on(TOPIC_STATE, (data, from) => {
      const s = parseState(data, pucks);
      if (!s || s.side === side) return;
      const now = clock.now();
      remote = { frame: from, seen: now, state: s };
      const theirs = s.match;
      const live = theirs !== null && theirs.endAt > now;
      if (live && !finished.includes(theirs.id) && !deserted.has(theirs.id)) {
        if (theirs.id === match.id) {
          mergeTheirs(match, s.tally);
        } else if (match.phase === "attract") {
          adopt(theirs, now);
          mergeTheirs(match, s.tally);
        } else if (match.phase === "countdown" || match.phase === "play") {
          const mine = info()!;
          if (preferred(mine, theirs) === theirs) {
            adopt(theirs, now);
            mergeTheirs(match, s.tally);
          }
        }
      }
      if (inOurMatch(now)) {
        if (s.keep) deps.poke();
        // A puck both frames think they hold: side 1 lets it go.
        if (side === 1) {
          for (const id of s.owned) {
            const p = lane.pucks[id];
            if (p?.live) p.live = false;
          }
        }
      }
    }),
    net.on(TOPIC_HANDOFF, (data, from) => {
      const h = parseHandoff(data, pucks);
      const now = clock.now();
      if (!h || h.m !== match.id || (match.phase !== "play" && match.phase !== "countdown")) return;
      table.arrive(lane, arrivalFor(lane, h, now));
      net.send(TOPIC_ACK, { m: h.m, id: h.id }, from);
    }),
    net.on(TOPIC_ACK, (data) => {
      if (isObj(data) && data.m === match.id && isNum(data.id)) away.delete(data.id);
    }),
    net.on(TOPIC_GOAL, (data) => {
      if (!isObj(data) || data.m !== match.id) return;
      const t = tally(data.tally);
      if (t) mergeTheirs(match, t);
    }),
    net.on(TOPIC_END, (data) => {
      if (!isObj(data) || !isId(data.m) || data.m !== match.id) return;
      if (deps.keeps()) {
        deserted.add(data.m);
        if (deserted.size > MAX_FINISHED) deserted.delete(deserted.values().next().value!);
      } else {
        remember(data.m);
        deps.onEnded(clock.now());
      }
    }),
  ];

  /** Put back pucks that neither frame has held for a while (lost with a vanished peer). */
  const recover = (now: number) => {
    if (match.phase !== "play") {
      missingSince.clear();
      return;
    }
    for (const [id, sent] of away) {
      if (now - sent > ACK_MS) {
        away.delete(id);
        if (!inOurMatch(now)) table.restore(id, now);
      }
    }
    const linked = inOurMatch(now);
    const held = new Set<number>(table.owned());
    for (const id of away.keys()) held.add(id);
    if (linked && remote) {
      for (const id of remote.state.owned) held.add(id);
      for (const id of remote.state.away) held.add(id);
    }
    for (let id = 0; id < pucks; id++) {
      if (held.has(id)) {
        missingSince.delete(id);
        continue;
      }
      const since = missingSince.get(id) ?? now;
      missingSince.set(id, since);
      if (now - since >= (linked ? LOST_MS : LOST_ALONE_MS) && (side === 0 || !linked)) {
        table.restore(id, now);
        missingSince.delete(id);
      }
    }
  };

  return {
    connected: () => fresh(clock.now()),
    remoteKeeps: () => inOurMatch(clock.now()) && remote!.state.keep,
    newMatch(now, botsOnly) {
      const id = `${side}${Math.floor(now).toString(36)}${rng.int(1296).toString(36)}`;
      return { id, startAt: now + countdownMs(botsOnly) };
    },
    tick(now) {
      // A match this frame left early (nobody playing, or a reset): tell the other frame.
      if (lastId !== "" && match.id !== lastId) {
        if (lastPhase === "countdown" || lastPhase === "play") net.send(TOPIC_END, { m: lastId });
        remember(lastId);
      }
      if (match.phase === "over") remember(match.id);
      const changed = match.phase !== lastPhase || match.id !== lastId;
      lastPhase = match.phase;
      lastId = match.id;
      if (now - lastRecover >= RECOVER_MS) {
        lastRecover = now;
        recover(now);
      }
      if (changed || now - lastBeat >= HEARTBEAT_MS) beat(now);
    },
    dispose() {
      offTable();
      for (const off of offs) off();
      away.clear();
      missingSince.clear();
    },
  };
};
