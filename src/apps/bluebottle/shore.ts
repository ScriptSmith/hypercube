/**
 * The beach as one frame keeps it: the patch in play, the next one, and (in a bank) how the
 * frames agree on them. No drawing here, so it runs under unit tests on an in-memory bus.
 *
 * Modes:
 * - `solo`: a frame on its own plays patches of its own size.
 * - `joining`: a bank frame looking for the bank's patch. It adopts the best patch it hears
 *   about in heartbeats and asks that frame for the log; if nobody has one, the leader among the
 *   frames that are not playing alone starts one.
 * - `shared`: playing the bank's patch. Events go to every frame in the group.
 * - `local`: a bank frame with nobody else around (or no patch it can show) plays a beach of
 *   its own columns, and tries the bank again once nobody has touched it for a while.
 *
 * The leader of the frames holding the shared patch sends the crabs, as events in the log. It
 * also digs, crab by crab, the sand of frames that are missing, so a patch still clears.
 */
import { leaderOf } from "../../core/net/channel";
import type { Channel, PeerInfo, Rng } from "../../core/types";
import {
  type Board,
  comparePatch,
  freshSpec,
  nextSpec,
  regionCount,
  regionOf,
  samePatch,
  type Spec,
} from "./board";
import {
  ABSENT_CRAB_MS,
  ALONE_MS,
  BEAT_LOST_MS,
  BEAT_MS,
  CLEAR_GAP_MS,
  type Config,
  CRAB_CHECK_MS,
  DISAGREE_MS,
  JOIN_GIVE_UP_MS,
  JOIN_WAIT_MS,
  LOG_PER_CELL,
  MAX_EARLY,
  QUIET_MS,
  REJOIN_EVERY_MS,
  REJOIN_IDLE_MS,
  STUCK_MS,
  TIDE_MS,
  WASH_GAP_MS,
} from "./config";
import { crabTarget } from "./crab";
import { generate } from "./generate";
import {
  createPatch,
  DIG,
  type Effect,
  type Ev,
  FLAG,
  HINT,
  type Kind,
  type Patch,
  TIDE,
  UNFLAG,
  visibleOf,
  WASH,
} from "./patch";
import {
  type Beat,
  decodeBeat,
  decodeEv,
  decodeLog,
  decodeSync,
  encodeBeat,
  encodeEv,
  encodeLog,
  encodeSync,
  type Geometry,
  TOPIC_BEAT,
  TOPIC_EV,
  TOPIC_LOG,
  TOPIC_SYNC,
} from "./protocol";
import { solverFor } from "./solver";

export type Mode = "solo" | "joining" | "shared" | "local";

export interface ShoreOptions {
  net: Channel;
  /** Shared-clock ms. */
  now(): number;
  /** Monotonic local ms. */
  local(): number;
  /** Whether `now()` follows the room's clock yet; a shared patch starts on synced clocks. */
  synced?(): boolean;
  /** Part of a bank (otherwise solo). */
  bank: boolean;
  /** The screen above a bank: it holds the patch but has no sand of its own. */
  screen: boolean;
  pos: number;
  count: number;
  /** This frame's beach, or for a screen the beach of one touch frame until it hears one. */
  geom: Geometry;
  cfg: Config;
  rng: Rng;
}

export interface Current {
  spec: Spec;
  patch: Patch;
  shared: boolean;
}

export interface ShoreStatus {
  mode: Mode;
  patch: number;
  dug: number;
  found: number;
  stings: number;
  hints: number;
  leader: boolean;
}

export interface Shore {
  readonly mode: Mode;
  readonly cur: Current | null;
  /** The next patch, once the current one has ended. */
  readonly upcoming: Spec | null;
  /** This frame's columns of the current patch: [c0, c1). */
  columns(): { c0: number; c1: number };
  /** Whether visitors can dig now. */
  playing(): boolean;
  /** Whether this frame sends the crabs. */
  leads(): boolean;
  dig(cell: number, human: boolean): void;
  flag(cell: number, on: boolean, human: boolean): void;
  /** A visitor's or the idle timer's wash; returns false when there is nothing to wash. */
  wash(human: boolean): boolean;
  /** Admin: a wash that is never refused. */
  tide(): void;
  /** A person touched this frame. */
  touched(): void;
  tick(): void;
  onEffect(cb: (e: Effect, cur: Current) => void): () => void;
  onPatch(cb: (cur: Current | null) => void): () => void;
  status(): ShoreStatus;
  dispose(): void;
}

interface Heard {
  beat: Beat;
  at: number;
  /** Heartbeats in a row that showed events this frame lacks. */
  odd: number;
}

const MAX_HEARD = 32;

export const createShore = (o: ShoreOptions): Shore => {
  const { net } = o;
  const self = net.self;
  const touch = !o.screen;
  const count = Math.max(1, o.count);
  const pos = Math.min(count - 1, Math.max(0, o.pos));
  // A bank frame with nobody else in its group yet plays alone at once and joins when it can.
  const company = net.online && net.peers().some((p) => p.frame !== net.self);
  let mode: Mode = !o.bank ? "solo" : company ? "joining" : "local";
  let modeSince = o.local();
  let cur: Current | null = null;
  let upcoming: { spec: Spec; board: Board } | null = null;
  let early: Ev[] = [];
  let seq = Date.now();
  let lastT = 0;
  let lastHuman = -Infinity;
  let lastJoin = -Infinity;
  let aloneSince: number | null = null;
  let disagreeSince: number | null = null;
  let beatAt = -Infinity;
  let crabAt = -Infinity;
  let stuckSince: Float64Array = new Float64Array(0);
  let lastCrab: Float64Array = new Float64Array(0);
  let crabSalt = 0;
  const heard = new Map<string, Heard>();
  const askedAt = new Map<string, number>();
  const answeredAt = new Map<string, number>();
  const effectCbs = new Set<(e: Effect, c: Current) => void>();
  const patchCbs = new Set<(c: Current | null) => void>();
  let disposed = false;

  const geomKnown = (): Geometry | null => {
    if (touch) return o.geom;
    for (const h of heard.values()) if (h.beat.g) return h.beat.g;
    return null;
  };

  const emitPatch = () => {
    for (const cb of patchCbs) cb(cur);
  };
  const fx = (e: Effect) => {
    if (!cur) return;
    for (const cb of effectCbs) cb(e, cur);
  };

  const makeCurrent = (spec: Spec, board: Board, shared: boolean) => {
    const patch = createPatch(
      board,
      { sting: o.cfg.sting, flags: o.cfg.flags },
      {
        start: spec.start,
        rw: spec.rw,
      },
    );
    cur = { spec, patch, shared };
    const regions = regionCount(spec.cols, spec.rw);
    stuckSince = new Float64Array(regions).fill(-1);
    lastCrab = new Float64Array(regions).fill(-Infinity);
    upcoming = null;
    const held = early;
    early = [];
    if (shared && held.length > 0) patch.addMany(held);
    emitPatch();
  };

  const baseSeed = () => Math.floor(o.rng.next() * 2 ** 32) >>> 0;

  /** A patch of this frame's own: its own columns, or for a screen the whole bank. */
  const startLocal = () => {
    const g = geomKnown() ?? o.geom;
    const cols = touch ? o.geom.w : g.w * count;
    const spec = freshSpec({
      b: baseSeed(),
      cols,
      rows: g.r,
      kid: g.k,
      dens: o.cfg.density,
      start: o.now() + TIDE_MS,
    });
    makeCurrent(spec, generate(spec), false);
  };

  const setMode = (m: Mode) => {
    if (m === mode) return;
    mode = m;
    modeSince = o.local();
    disagreeSince = null;
  };

  const goLocal = () => {
    setMode("local");
    startLocal();
  };

  const goJoining = () => {
    setMode("joining");
    lastJoin = o.local();
  };

  const compatible = (spec: Spec): boolean => {
    if (spec.cols % count !== 0) return false;
    if (!touch) return true;
    return spec.cols === count * o.geom.w && spec.rows === o.geom.r;
  };

  const adopt = (spec: Spec, from: string | null) => {
    setMode("shared");
    makeCurrent(spec, generate(spec), true);
    if (from) askSync(from, true);
  };

  const askSync = (to: string, force = false) => {
    const t = o.local();
    if (!force && t - (askedAt.get(to) ?? -Infinity) < 2000) return;
    askedAt.set(to, t);
    if (askedAt.size > MAX_HEARD) askedAt.delete(askedAt.keys().next().value!);
    net.send(TOPIC_SYNC, encodeSync(cur?.spec ?? null), to);
  };

  // ---- Events ---------------------------------------------------------------------------------

  const emit = (k: Kind, c: number, h: boolean) => {
    if (!cur) return;
    const t = Math.max(Math.round(o.now()), lastT);
    lastT = t;
    const ev: Ev = { k, c, t, s: self, q: ++seq, h };
    cur.patch.add(ev, fx);
    if (cur.shared && mode === "shared") net.send(TOPIC_EV, encodeEv(cur.spec.b, cur.spec.n, ev));
  };

  const playing = () => cur !== null && cur.patch.end === null && o.now() >= cur.spec.start;

  // ---- Network --------------------------------------------------------------------------------

  const offs: (() => void)[] = [];
  if (o.bank) {
    offs.push(
      net.on(TOPIC_EV, (data, from) => {
        const d = decodeEv(data, from);
        if (!d) return;
        const ev: Ev = { ...d.ev, s: d.s };
        if (cur?.shared && cur.spec.b === d.b && cur.spec.n === d.n) {
          cur.patch.add(ev, fx);
          return;
        }
        if (upcoming && upcoming.spec.b === d.b && upcoming.spec.n === d.n) {
          if (early.length < MAX_EARLY) early.push(ev);
          return;
        }
        // A frame ahead of this one: catch up from its log.
        const ahead = !cur || comparePatch({ ...cur.spec, b: d.b, n: d.n }, cur.spec) > 0;
        if ((mode === "shared" || mode === "joining") && ahead) askSync(from);
      }),
      net.on(TOPIC_BEAT, (data, from) => {
        const b = decodeBeat(data);
        if (!b || from === self) return;
        // Same patch but different events, twice running (not just events in flight): sync.
        let odd = 0;
        if (mode === "shared" && cur?.shared && b.m === "s" && samePatch(b.p, cur.spec)) {
          const e = cur.patch.events.length;
          if (b.e > e || (b.e === e && b.x !== cur.patch.hash))
            odd = (heard.get(from)?.odd ?? 0) + 1;
        }
        if (odd >= 2) {
          askSync(from);
          odd = 0;
        }
        heard.delete(from);
        heard.set(from, { beat: b, at: o.local(), odd });
        if (heard.size > MAX_HEARD) heard.delete(heard.keys().next().value!);
      }),
      net.on(TOPIC_SYNC, (data, from) => {
        if (decodeSync(data) === null || !cur?.shared || mode !== "shared") return;
        const t = o.local();
        if (t - (answeredAt.get(from) ?? -Infinity) < 1000) return;
        answeredAt.set(from, t);
        if (answeredAt.size > MAX_HEARD) answeredAt.delete(answeredAt.keys().next().value!);
        for (const chunk of encodeLog(cur.spec, cur.patch.events)) net.send(TOPIC_LOG, chunk, from);
      }),
      net.on(TOPIC_LOG, (data) => {
        const chunk = decodeLog(data);
        if (!chunk) return;
        if (cur?.shared && samePatch(cur.spec, chunk.p)) {
          cur.patch.addMany(chunk.events, fx);
          return;
        }
        if (mode !== "shared" && mode !== "joining") return;
        if (!compatible(chunk.p)) return;
        if (cur?.shared && comparePatch(chunk.p, cur.spec) <= 0) return;
        if (mode === "joining" && cur && !cur.shared && lastHuman > modeSince) return;
        adopt(chunk.p, null);
        cur?.patch.addMany(chunk.events, fx);
      }),
    );
  }

  const fresh = (h: Heard) => o.local() - h.at < BEAT_LOST_MS;

  const roster = (): readonly PeerInfo[] => (net.online ? net.peers() : []);

  /** The best shared patch a peer holds, with who holds it. */
  const bestHeard = (): { spec: Spec; from: string; beat: Beat } | null => {
    let best: { spec: Spec; from: string; beat: Beat } | null = null;
    const here = new Set(roster().map((p) => p.frame));
    for (const [from, h] of heard) {
      if (!fresh(h) || !here.has(from) || h.beat.m !== "s" || !h.beat.p) continue;
      if (!compatible(h.beat.p)) continue;
      if (
        !best ||
        comparePatch(h.beat.p, best.spec) > 0 ||
        (comparePatch(h.beat.p, best.spec) === 0 && h.beat.e > best.beat.e)
      )
        best = { spec: h.beat.p, from, beat: h.beat };
    }
    return best;
  };

  /** Frames that hold the shared patch now, this one included when it does. */
  const holders = (): PeerInfo[] => {
    const out: PeerInfo[] = [];
    for (const p of roster()) {
      if (p.frame === self) {
        if (mode === "shared") out.push(p);
        continue;
      }
      const h = heard.get(p.frame);
      if (h && fresh(h) && h.beat.m === "s" && samePatch(h.beat.p, cur?.spec ?? null)) out.push(p);
    }
    return out;
  };

  /** The frame that would start a shared patch: the leader of frames not playing alone. */
  const starter = (): string | null => {
    const out: PeerInfo[] = [];
    for (const p of roster()) {
      if (p.frame === self) {
        out.push(p);
        continue;
      }
      const h = heard.get(p.frame);
      if (h && fresh(h) && h.beat.m === "l") continue;
      out.push(p);
    }
    return leaderOf(out);
  };

  const leads = (): boolean => {
    if (mode === "solo" || mode === "local") return true;
    if (mode !== "shared") return false;
    return leaderOf(holders()) === self;
  };

  const sendBeat = () => {
    const m = mode === "shared" ? "s" : mode === "joining" ? "j" : "l";
    const shared = mode === "shared" && cur?.shared ? cur : null;
    net.send(
      TOPIC_BEAT,
      encodeBeat({
        m,
        g: touch ? o.geom : null,
        p: shared?.spec ?? null,
        e: shared?.patch.events.length ?? 0,
        x: shared?.patch.hash ?? 0,
      }),
    );
  };

  const startShared = () => {
    const g = geomKnown();
    if (!g) return false;
    const spec = freshSpec({
      b: baseSeed(),
      cols: g.w * count,
      rows: g.r,
      kid: g.k,
      dens: o.cfg.density,
      start: o.now() + TIDE_MS,
    });
    adopt(spec, null);
    return true;
  };

  const bankTick = (t: number) => {
    const others = roster().filter((p) => p.frame !== self);
    if (others.length === 0) aloneSince ??= t;
    else aloneSince = null;
    const lonely = aloneSince !== null && t - aloneSince >= ALONE_MS;

    if (mode === "joining") {
      if (lonely || t - modeSince >= JOIN_GIVE_UP_MS) {
        goLocal();
        return;
      }
      const best = bestHeard();
      if (best) adopt(best.spec, best.from);
      else if (
        t - modeSince >= JOIN_WAIT_MS &&
        others.length > 0 &&
        starter() === self &&
        (o.synced?.() ?? true)
      )
        startShared();
    } else if (mode === "shared") {
      if (lonely) {
        goLocal();
        return;
      }
      const best = bestHeard();
      if (best && cur && comparePatch(best.spec, cur.spec) > 0) {
        const ownNext = upcoming !== null && samePatch(upcoming.spec, best.spec);
        disagreeSince ??= t;
        const jump = best.spec.b !== cur.spec.b || best.spec.n > cur.spec.n + 1;
        if (jump || (!ownNext && t - disagreeSince >= DISAGREE_MS)) adopt(best.spec, best.from);
      } else disagreeSince = null;
    } else if (mode === "local") {
      const quiet = t - lastHuman >= REJOIN_IDLE_MS;
      if (others.length > 0 && quiet && t - lastJoin >= REJOIN_EVERY_MS) goJoining();
    }
  };

  // ---- Crabs ----------------------------------------------------------------------------------

  /** Whether the frame that owns region `g` is missing from the bank. */
  const absentRegions = (c: Current): Uint8Array => {
    const regions = regionCount(c.spec.cols, c.spec.rw);
    const out = new Uint8Array(regions);
    // A screen on its own has no visitors: the crabs dig the whole beach as a show.
    if (!touch && mode !== "shared") return out.fill(1);
    if (mode !== "shared") return out;
    const w = c.spec.cols / count;
    const present = new Uint8Array(count);
    for (const p of holders()) {
      if (p.role === "screen" || p.kind === "screen") continue;
      if (p.pos >= 0 && p.pos < count) present[p.pos] = 1;
    }
    for (let g = 0; g < regions; g++) {
      const pos = Math.min(count - 1, Math.floor((g * c.spec.rw) / w));
      if (!present[pos]) out[g] = 1;
    }
    return out;
  };

  const crabTick = (t: number) => {
    const c = cur;
    if (!c || !playing() || !leads()) return;
    const p = c.patch;
    if (p.events.length >= p.board.size * LOG_PER_CELL) {
      emit(TIDE, 0, false);
      return;
    }
    const regions = regionCount(c.spec.cols, c.spec.rw);
    const left = new Int32Array(regions);
    for (let i = 0; i < p.board.size; i++) {
      if (!p.dug[i] && !p.board.bottle[i]) left[regionOf(c.spec.cols, c.spec.rw, i)]! += 1;
    }
    const absent = absentRegions(c);
    const ded = solverFor(c.spec.cols, c.spec.rows).deduce(visibleOf(p)).safe;
    const deducible = new Int32Array(regions);
    for (const i of ded) deducible[regionOf(c.spec.cols, c.spec.rw, i)]! += 1;
    const now = o.now();
    for (let g = 0; g < regions; g++) {
      if (left[g] === 0) {
        stuckSince[g] = -1;
        continue;
      }
      let send = false;
      if (absent[g]) send = t - lastCrab[g]! >= ABSENT_CRAB_MS;
      else if (deducible[g] === 0) {
        if (stuckSince[g]! < 0) stuckSince[g] = t;
        send = t - stuckSince[g]! >= STUCK_MS && t - lastCrab[g]! >= STUCK_MS;
      } else {
        stuckSince[g] = -1;
        send = now - p.progressAt[g]! >= QUIET_MS && t - lastCrab[g]! >= QUIET_MS;
      }
      if (!send) continue;
      const target = crabTarget(p, g, c.spec.rw, ded, crabSalt++);
      if (target < 0) continue;
      lastCrab[g] = t;
      emit(HINT, target, false);
      if (!playing()) return;
    }
  };

  // ---- Patch lifecycle ------------------------------------------------------------------------

  const lifecycle = () => {
    const c = cur;
    if (!c) return;
    const end = c.patch.end;
    if (upcoming && !end) {
      // A replay undid the ending.
      upcoming = null;
      early = [];
    }
    // A frame looking for its bank keeps its finished beach until it finds one or gives up.
    if (mode === "joining") return;
    if (end && !upcoming) {
      const gap = end.why === "clear" ? CLEAR_GAP_MS : WASH_GAP_MS;
      const spec = nextSpec(c.spec, end.t + gap);
      upcoming = { spec, board: generate(spec) };
    }
    if (upcoming && o.now() >= upcoming.spec.start - TIDE_MS) {
      const others = roster().some((p) => p.frame !== self);
      if (mode === "local" && o.bank && others && o.local() - lastHuman >= REJOIN_IDLE_MS / 3) {
        // A natural break: try the bank again rather than start another beach alone.
        upcoming = null;
        early = [];
        goJoining();
        return;
      }
      makeCurrent(upcoming.spec, upcoming.board, c.shared);
    }
  };

  if (mode === "solo" || mode === "local") startLocal();

  return {
    get mode() {
      return mode;
    },
    get cur() {
      return cur;
    },
    get upcoming() {
      return upcoming?.spec ?? null;
    },
    columns() {
      if (!cur) return { c0: 0, c1: touch ? o.geom.w : 0 };
      if (!touch) return { c0: 0, c1: cur.spec.cols };
      if (!cur.shared) return { c0: 0, c1: cur.spec.cols };
      const w = cur.spec.cols / count;
      return { c0: pos * w, c1: pos * w + w };
    },
    playing,
    leads,
    dig(cell, human) {
      if (!playing()) return;
      if (human) this.touched();
      emit(DIG, cell, human);
    },
    flag(cell, on, human) {
      if (!playing()) return;
      if (human) this.touched();
      emit(on ? FLAG : UNFLAG, cell, human);
    },
    wash(human) {
      if (!playing() || !cur) return false;
      if (!human && !cur.patch.touched) return false;
      const { c0 } = this.columns();
      emit(WASH, c0, human);
      return true;
    },
    tide() {
      if (!cur || cur.patch.end) return;
      emit(TIDE, 0, false);
    },
    touched() {
      lastHuman = o.local();
      // Someone is playing the local beach: stop looking for the bank for now.
      if (mode === "joining" && cur && !cur.shared) {
        setMode("local");
        lastJoin = o.local();
      }
    },
    tick() {
      if (disposed) return;
      const t = o.local();
      if (o.bank) {
        if (t - beatAt >= BEAT_MS) {
          beatAt = t;
          sendBeat();
        }
        bankTick(t);
      }
      lifecycle();
      if (t - crabAt >= CRAB_CHECK_MS) {
        crabAt = t;
        crabTick(t);
      }
    },
    onEffect(cb) {
      effectCbs.add(cb);
      return () => effectCbs.delete(cb);
    },
    onPatch(cb) {
      patchCbs.add(cb);
      return () => patchCbs.delete(cb);
    },
    status() {
      const p = cur?.patch;
      return {
        mode,
        patch: cur?.spec.n ?? 0,
        dug: p?.dugSafe ?? 0,
        found: p?.foundCount ?? 0,
        stings: p?.stings ?? 0,
        hints: p?.hints ?? 0,
        leader: leads(),
      };
    },
    dispose() {
      disposed = true;
      for (const off of offs) off();
      effectCbs.clear();
      patchCbs.clear();
      heard.clear();
    },
  };
};
