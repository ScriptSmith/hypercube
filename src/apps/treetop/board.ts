/**
 * What one frame knows about the current race across the bank, and the leader's duties.
 *
 * Every frame records its own lanes here. The leader (the screen, else the lowest-`pos` touch
 * frame, else this frame alone) also hears every other frame's `fly` reports, which say which
 * lanes have joined as well as where the racers are. It sends a `pack` summary twice a second and
 * sends `res` with the placings when a race ends. Other frames learn about the rest of the bank
 * from `pack`, and fall back to placings among the lanes they know when no `res` comes.
 *
 * A bank race (lobby.ts) ends when the leader says so. A race on the clock's cadence (a frame on
 * its own, or attract bots) is ended here: at its time limit, or once nobody is flying.
 */
import type { Channel } from "../../core/types";
import type { Mode } from "./flight";
import { type Entry, placeOf, placings } from "./placing";
import {
  type Ctrl,
  decodeFin,
  decodeFly,
  decodePack,
  decodeRes,
  encodeFin,
  encodeFly,
  encodePack,
  encodeRes,
  type Fly,
  joinedSlot,
  laneId,
  lanePos,
  laneSlot,
  MAX_LANES,
  TOPIC_FIN,
  TOPIC_FLY,
  TOPIC_PACK,
  TOPIC_RES,
} from "./wire";

/** A lane not heard from for this long fades and stops counting as flying. */
export const STALE_MS = 2000;
/** ...and is forgotten after this long. */
export const FORGET_MS = 10_000;
export const PACK_MS = 500;
/**
 * A lane counts as joined while its frame said so this recently. A player who leaves is reported
 * at once, so this only matters when a frame vanishes; it is generous so a frame starved of
 * animation frames for a moment isn't taken for gone.
 */
export const JOINED_MS = 4000;

export type BoardPhase = "countdown" | "racing" | "results" | "lobby";

export interface Known {
  id: number;
  pos: number;
  slot: number;
  /** Lanes on its frame. */
  n: number;
  d: number;
  h: number;
  mode: Mode;
  ctrl: Ctrl;
  adult: boolean;
  fin: number | null;
  gates: number;
  /** Local ms of the last report about it. */
  heard: number;
  /** One of this frame's own lanes. */
  own: boolean;
  /** Heard directly (a `fly` or our own), not only through `pack`. */
  direct: boolean;
}

export interface BoardDeps {
  net: Channel;
  /** Local monotonic ms, for staleness. */
  local(): number;
  /** Called for every lane in every `fly` this frame receives (the screen draws from these). */
  onFly?(fly: Fly, from: string): void;
  /** Called when placings for a race arrive or are worked out here. */
  onPlaces?(k: number): void;
}

export interface Board {
  readonly k: number;
  readonly lanes: ReadonlyMap<number, Known>;
  /** Placings for race `k`, once known. */
  readonly places: ReadonlyMap<number, number> | null;
  /** The leader ended race `k` early, or its placings are in. */
  readonly ended: boolean;
  leader(): boolean;
  /** Start tracking race `k` (clears finishes and placings, keeps the lanes). */
  race(k: number): void;
  /** Record one of this frame's lanes. */
  own(fly: Fly): void;
  /** One of this frame's lanes crossed the line. */
  finished(lane: number, t: number): void;
  /** Live lanes (heard recently), for drawing and pack strips. */
  live(): Known[];
  /** A lane's place now: final if placings are in, otherwise among the lanes known. */
  place(lane: number): number | null;
  /** Lanes joined across the bank (stations playing), as far as this frame has heard. */
  joined(): Set<number>;
  /**
   * Every one of `lanes` has finished, is out or has left. With null: every live lane has
   * finished or is out, and there is at least one.
   */
  done(lanes: readonly number[] | null): boolean;
  /** Work out the placings among `lanes` (or every live lane) and send them. */
  decide(lanes: readonly number[] | null): void;
  /** `auto`: this is a cadence race, so the leader ends it here. */
  tick(phase: BoardPhase, auto: boolean): void;
  dispose(): void;
}

const flyingMode = (m: Mode) => m === "flying" || m === "tumbling";

export const createBoard = (deps: BoardDeps): Board => {
  const { net } = deps;
  const lanes = new Map<number, Known>();
  const joinedAt = new Map<number, number>();
  let k = -1;
  let places: Map<number, number> | null = null;
  let ended = false;
  let resSent = -1;
  let lastPack = -Infinity;

  const isLeader = () => {
    const l = net.leader();
    return l === null || l === net.self;
  };

  const fresh = (now: number) => [...lanes.values()].filter((l) => now - l.heard < STALE_MS);

  /** Lanes still waiting on the start line didn't race, so they get no place. */
  const entries = (list: readonly Known[]): Entry[] =>
    list.filter((l) => l.mode !== "waiting").map((l) => ({ lane: l.id, d: l.d, fin: l.fin }));

  const joinedNow = () => {
    const now = deps.local();
    const out = new Set<number>();
    for (const [id, at] of joinedAt) if (now - at < JOINED_MS) out.add(id);
    return out;
  };

  /** Racers who left without finishing get no place. */
  const racersOf = (ids: readonly number[]): Known[] => {
    const joined = joinedNow();
    const out: Known[] = [];
    for (const id of ids) {
      const l = lanes.get(id);
      if (l && (joined.has(id) || l.fin !== null)) out.push(l);
    }
    return out;
  };

  const done = (ids: readonly number[] | null): boolean => {
    if (ids === null) {
      const live = fresh(deps.local());
      return live.length > 0 && live.every((l) => !flyingMode(l.mode) && l.mode !== "waiting");
    }
    const joined = joinedNow();
    return ids.every((id) => {
      if (!joined.has(id)) return true;
      const m = lanes.get(id)?.mode;
      return m === "finished" || m === "out";
    });
  };

  const ingest = (fly: Fly, own: boolean) => {
    const now = deps.local();
    for (let slot = 0; slot < fly.n; slot++) {
      const id = laneId(fly.pos, slot);
      if (joinedSlot(fly.joined ?? 0, slot)) {
        if (joinedAt.has(id) || joinedAt.size < MAX_LANES) joinedAt.set(id, now);
      } else joinedAt.delete(id);
    }
    if (fly.k !== k) return;
    for (const r of fly.lanes) {
      const id = laneId(fly.pos, r.slot);
      let known = lanes.get(id);
      if (!known) {
        if (lanes.size >= MAX_LANES) continue;
        known = {
          id,
          pos: fly.pos,
          slot: r.slot,
          n: fly.n,
          d: 0,
          h: 0,
          mode: r.mode,
          ctrl: r.ctrl,
          adult: r.adult,
          fin: null,
          gates: 0,
          heard: now,
          own,
          direct: true,
        };
        lanes.set(id, known);
      }
      known.n = fly.n;
      known.d = r.d;
      known.h = r.h;
      known.mode = r.mode;
      known.ctrl = r.ctrl;
      known.adult = r.adult;
      known.gates = r.gates;
      if (r.fin !== null) known.fin = r.fin;
      known.heard = now;
      known.own = own;
      known.direct = true;
    }
  };

  const decide = (ids: readonly number[] | null) => {
    places = placings(entries(ids ? racersOf(ids) : fresh(deps.local())));
    ended = true;
    resSent = k;
    net.send(TOPIC_RES, encodeRes({ k, places: [...places.entries()] }));
    deps.onPlaces?.(k);
  };

  const offs = [
    net.on(TOPIC_FLY, (data, from) => {
      const fly = decodeFly(data);
      if (!fly) return;
      ingest(fly, false);
      deps.onFly?.(fly, from);
    }),
    net.on(TOPIC_FIN, (data) => {
      const fin = decodeFin(data);
      if (!fin || fin.k !== k) return;
      const known = lanes.get(fin.lane);
      if (known) known.fin = fin.t;
    }),
    net.on(TOPIC_PACK, (data) => {
      const pack = decodePack(data);
      if (!pack || pack.k !== k || isLeader()) return;
      const now = deps.local();
      for (const p of pack.lanes) {
        let known = lanes.get(p.lane);
        if (known?.own) continue;
        if (!known) {
          if (lanes.size >= MAX_LANES) continue;
          known = {
            id: p.lane,
            pos: lanePos(p.lane),
            slot: laneSlot(p.lane),
            n: 1,
            d: 0,
            h: 0,
            mode: p.mode,
            ctrl: p.ctrl,
            adult: false,
            fin: null,
            gates: 0,
            heard: now,
            own: false,
            direct: false,
          };
          lanes.set(p.lane, known);
        }
        if (!known.direct || now - known.heard > PACK_MS * 2) {
          known.d = p.d;
          known.mode = p.mode;
          known.ctrl = p.ctrl;
        }
        if (p.fin !== null) known.fin = p.fin;
        known.heard = Math.max(known.heard, now);
      }
      if (pack.ended) ended = true;
    }),
    net.on(TOPIC_RES, (data) => {
      const res = decodeRes(data);
      if (!res || res.k !== k) return;
      places = new Map(res.places);
      ended = true;
      deps.onPlaces?.(k);
    }),
  ];

  return {
    get k() {
      return k;
    },
    lanes,
    get places() {
      return places;
    },
    get ended() {
      return ended;
    },
    leader: isLeader,
    race(next) {
      if (next === k) return;
      k = next;
      places = null;
      ended = false;
      for (const l of lanes.values()) {
        l.fin = null;
        l.d = 0;
        l.gates = 0;
        l.mode = "waiting";
      }
    },
    own(fly) {
      ingest(fly, true);
      if (isLeader()) return;
      const to = net.leader();
      if (to) net.send(TOPIC_FLY, encodeFly(fly), to);
    },
    finished(lane, t) {
      const known = lanes.get(lane);
      if (known) known.fin = t;
      const to = net.leader();
      if (to && !isLeader()) net.send(TOPIC_FIN, encodeFin({ k, lane, t }), to);
    },
    live() {
      return fresh(deps.local());
    },
    place(lane) {
      const final = places?.get(lane);
      if (final !== undefined) return final;
      return placeOf(entries(fresh(deps.local())), lane);
    },
    joined: joinedNow,
    done,
    decide(ids) {
      if (resSent !== k) decide(ids);
    },
    tick(phase, auto) {
      const now = deps.local();
      for (const [id, l] of lanes) if (now - l.heard > FORGET_MS) lanes.delete(id);
      for (const [id, at] of joinedAt) if (now - at > FORGET_MS) joinedAt.delete(id);
      if (!isLeader()) return;
      const live = fresh(now);
      if (auto && resSent !== k) {
        // Everyone has finished or is out: no need to wait for the clock.
        if (phase === "racing" && !ended && done(null)) decide(null);
        else if (phase === "results") decide(null);
      }
      const over = phase === "results" || phase === "lobby";
      if (now - lastPack >= PACK_MS) {
        lastPack = now;
        if (!over || live.length > 0) {
          net.send(
            TOPIC_PACK,
            encodePack({
              k,
              ended,
              lanes: live.map((l) => ({
                lane: l.id,
                d: l.d,
                mode: l.mode,
                ctrl: l.ctrl,
                fin: l.fin,
              })),
            }),
          );
        }
      }
    },
    dispose() {
      for (const off of offs) off();
      lanes.clear();
      joinedAt.clear();
    },
  };
};
