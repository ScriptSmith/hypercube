/**
 * A bank panel's link to the screen above, which holds the arena. While active it tells the
 * screen who is seated and how they steer (or, in `grid`, which way they last pressed), and it
 * follows the screen's rounds so the stations
 * start playing when the screen's round does. It counts the screen as gone when neither a
 * `round` nor an `alive` has arrived for SCREEN_LOST_MS.
 */
import type { Channel } from "../../core/types";
import type { Phase } from "./match";
import {
  decodeAlive,
  decodeRound,
  encodeAim,
  encodeSeat,
  encodeTurn,
  TOPIC_AIM,
  TOPIC_ALIVE,
  TOPIC_ROUND,
  TOPIC_SEAT,
  TOPIC_TURN,
} from "./protocol";
import type { Seating } from "./seating";

export const SCREEN_LOST_MS = 2500;
export const HEARTBEAT_MS = 500;

export interface ScreenState {
  from: string;
  round: number;
  phase: Phase;
  since: number;
  until: number;
  attract: boolean;
  keys: number[];
  modes: number[];
  alive: number[];
  headings: number[];
  places: number[];
  /** performance.now() of the latest message, and of the latest `alive`. */
  heard: number;
  aliveAt: number;
}

export interface PanelLink {
  readonly screen: ScreenState | null;
  linked(local: number): boolean;
  /** Speak for this frame's stations (linked play), or fall silent (playing locally). */
  setActive(on: boolean): void;
  tick(local: number): void;
  dispose(): void;
}

export interface PanelLinkOptions {
  net: Channel;
  seating: Seating;
  /** Each station's key on the screen. */
  keys: readonly number[];
  /** Direction pads: send presses (`aim`) rather than steering (`turn`). */
  aim: boolean;
}

export const createPanelLink = (opts: PanelLinkOptions): PanelLink => {
  const { net, seating, keys } = opts;
  let screen: ScreenState | null = null;
  let active = false;
  let seq = 0;
  const sentOn = new Int8Array(keys.length).fill(-1);
  const sentDir = new Int8Array(keys.length);
  const sentPresses = new Float64Array(keys.length).fill(-1);
  const sentAt = new Float64Array(keys.length).fill(-Infinity);

  const offs = [
    net.on(TOPIC_ROUND, (data, from) => {
      const m = decodeRound(data);
      if (!m) return;
      const local = performance.now();
      const same = screen && screen.from === from && screen.round === m.r;
      screen = {
        from,
        round: m.r,
        phase: m.p,
        since: m.s,
        until: m.e,
        attract: m.a,
        keys: m.k,
        modes: m.m,
        alive: same && screen ? screen.alive : m.k.map(() => 1),
        headings: same && screen ? screen.headings : m.k.map(() => 192),
        places: same && screen ? screen.places : [],
        heard: local,
        aliveAt: same && screen ? screen.aliveAt : local,
      };
    }),
    net.on(TOPIC_ALIVE, (data, from) => {
      const m = decodeAlive(data);
      if (!m || !screen || screen.from !== from || screen.round !== m.r) return;
      if (m.l.length !== screen.keys.length) return;
      const local = performance.now();
      screen.alive = m.l;
      screen.headings = m.h;
      screen.places = m.pl.length === m.l.length ? m.pl : [];
      screen.heard = local;
      screen.aliveAt = local;
    }),
  ];

  const linked = (local: number) => screen !== null && local - screen.heard < SCREEN_LOST_MS;

  return {
    get screen() {
      return screen;
    },
    linked,
    setActive(on) {
      if (on === active) return;
      active = on;
      // Say everything again from scratch once the screen is listening.
      sentOn.fill(-1);
      sentAt.fill(-Infinity);
      sentPresses.fill(-1);
    },
    tick(local) {
      if (!active || !screen || !linked(local)) return;
      const to = screen.from;
      for (let j = 0; j < keys.length; j++) {
        const seat = seating.seat(j);
        const on = seat !== null ? 1 : 0;
        const bot = seat === "bot";
        if (on !== sentOn[j]) {
          sentOn[j] = on;
          net.send(TOPIC_SEAT, encodeSeat({ k: keys[j]!, on: on === 1, q: ++seq, b: bot }), to);
          sentAt[j] = local;
        }
        if (!on) continue;
        if (opts.aim) {
          const n = bot ? 0 : seating.pads.presses(j);
          if (n !== sentPresses[j] || local - sentAt[j]! >= HEARTBEAT_MS) {
            sentPresses[j] = n;
            sentAt[j] = local;
            const g = bot ? -1 : seating.pads.last(j);
            net.send(TOPIC_AIM, encodeAim({ k: keys[j]!, g, n, q: ++seq, b: bot }), to);
          }
          continue;
        }
        const d = bot ? 0 : (seating.dir(j) as -1 | 0 | 1);
        if (d !== sentDir[j] || local - sentAt[j]! >= HEARTBEAT_MS) {
          sentDir[j] = d;
          sentAt[j] = local;
          net.send(TOPIC_TURN, encodeTurn({ k: keys[j]!, d, q: ++seq, b: bot }), to);
        }
      }
      // The screen's round has begun: seated players start playing.
      if ((screen.phase === "play" || screen.phase === "over") && !screen.attract) {
        if (seating.list.some((s) => s.state === "ready")) seating.startReady();
      }
    },
    dispose() {
      for (const off of offs) off();
    },
  };
};
