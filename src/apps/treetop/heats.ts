/**
 * The bank's heat (lobby.ts) on the network. The leader steps it and sends `heat` on every
 * change and once a second; everyone else follows what the leader last sent.
 *
 * A frame that becomes leader carries on from the heat it was following, so a race in flight
 * runs to its end and the new leader opens the next lobby. A frame that becomes leader without
 * having followed anything (a screen that has just loaded) listens to the touch frames' `fly`
 * reports for a moment, which carry the heat each one follows, and picks up from the newest.
 * Only when nobody reports one does it start from attract.
 */
import type { Channel } from "../../core/types";
import { attractHeat, type Heat, heatOrder, stepHeat } from "./lobby";
import { decodeHeat, encodeHeat, TOPIC_HEAT } from "./wire";

export const HEARTBEAT_MS = 1000;
/** How long a new leader with nothing to go on listens before starting from attract. */
export const LISTEN_MS = 1200;
/** After the first heat it hears reported, it listens this much longer to learn the racers. */
const SETTLE_MS = 300;

export interface HeatsDeps {
  net: Channel;
  /** Clock ms. */
  now(): number;
  /** Local monotonic ms. */
  local(): number;
  raceMs: number;
  /** Lanes joined across the bank. */
  joined(): ReadonlySet<number>;
  /** Every one of `lanes` has finished, is out or has left. */
  done(lanes: readonly number[]): boolean;
  /** The attract race on the clock's cadence. */
  attractK(): number;
  /** Lanes the leader has heard racing in race `k`, for picking up a race from reports. */
  racing(k: number): number[];
  /** On the leader, when a race has just ended. */
  onEnd?(h: Heat): void;
}

export interface Heats {
  /**
   * The heat this frame follows, or null before it knows one. While a new leader listens, it is
   * the newest heat reported so far, so the frame can start gathering that race's lanes.
   */
  readonly heat: Heat | null;
  /** This frame steps and sends the heat. */
  readonly leading: boolean;
  /** A heat reported in another frame's `fly`. */
  offer(h: Heat): void;
  tick(): void;
  dispose(): void;
}

export const createHeats = (deps: HeatsDeps): Heats => {
  const { net } = deps;
  let heat: Heat | null = null;
  let leading = false;
  let listenUntil = 0;
  let offered: Heat | null = null;
  let offeredAt = 0;
  let lastSent = -Infinity;

  const isLeader = () => {
    const l = net.leader();
    return l === null || l === net.self;
  };

  const send = () => {
    if (!heat) return;
    lastSent = deps.local();
    net.send(TOPIC_HEAT, encodeHeat(heat));
  };

  const off = net.on(TOPIC_HEAT, (data, from) => {
    if (leading || from !== net.leader()) return;
    const h = decodeHeat(data);
    if (h) heat = h;
  });

  const take = () => {
    const local = deps.local();
    if (offered && local >= Math.min(listenUntil, offeredAt + SETTLE_MS)) {
      heat = offered.phase === "racing" ? { ...offered, lanes: deps.racing(offered.k) } : offered;
    } else if (local >= listenUntil) {
      heat = attractHeat(0, deps.now());
    }
  };

  return {
    get heat() {
      return heat ?? offered;
    },
    get leading() {
      return leading;
    },
    offer(h) {
      if (!leading || heat) return;
      if (!offered) offeredAt = deps.local();
      if (!offered || heatOrder(h) > heatOrder(offered)) offered = h;
    },
    tick() {
      const lead = isLeader();
      if (lead && !leading) {
        leading = true;
        offered = null;
        listenUntil = deps.local() + LISTEN_MS;
      } else if (!lead) {
        leading = false;
      }
      if (!leading) return;
      if (!heat) {
        take();
        if (!heat) return;
        send();
      }
      const next = stepHeat(heat, {
        now: deps.now(),
        joined: deps.joined(),
        done: deps.done,
        raceMs: deps.raceMs,
        attractK: deps.attractK(),
      });
      if (next !== heat) {
        const was = heat;
        heat = next;
        if (was.phase === "racing" && next.phase !== "racing") deps.onEnd?.(was);
        send();
      } else if (deps.local() - lastSent >= HEARTBEAT_MS) {
        send();
      }
    },
    dispose() {
      off();
    },
  };
};
