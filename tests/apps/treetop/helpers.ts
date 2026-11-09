import { type Body, type FlapConfig, readConfig } from "../../../src/apps/treetop/config";
import type { Course } from "../../../src/apps/treetop/course";
import {
  flap,
  type Flight,
  type FlightEvent,
  type Rules,
  stepFlight,
} from "../../../src/apps/treetop/flight";
import type { Pilot } from "../../../src/apps/treetop/pilot";
import { leaderOf } from "../../../src/core/net/channel";
import type { Channel, PeerInfo, Role } from "../../../src/core/types";

export const DT = 1 / 120;

export const config = (
  over: Record<string, string | number | boolean> = {},
  variant = "race",
): FlapConfig => readConfig(variant, over);

export const rulesOf = (cfg: FlapConfig): Rules => ({
  crash: cfg.crash,
  base: cfg.base,
  race: cfg.race,
});

/** Fly `f` for up to `seconds` (or until it finishes or is out), flapping when `pilot` says. */
export const fly = (
  f: Flight,
  course: Course,
  body: Body,
  rules: Rules,
  pilot: Pilot | null,
  seconds: number,
  start = 0,
  onEvent?: (e: FlightEvent, t: number) => void,
): number => {
  let t = start;
  const end = start + seconds;
  while (t < end - 1e-9) {
    if (pilot?.step(f, course, body, DT)) flap(f, body);
    t += DT;
    stepFlight(f, DT, course, body, rules, t, (e) => onEvent?.(e, t));
    if (f.mode === "finished" || f.mode === "out") break;
  }
  return t;
};

/**
 * A synchronous in-memory bank for channel-level tests: every frame gets a Channel, messages
 * are delivered at once, and the leader follows the platform's rule.
 */
export interface Bus {
  join(frame: string, role: Role, pos: number): Channel;
  leave(frame: string): void;
  sent: { topic: string; from: string; to: string | undefined }[];
}

export const createBus = (): Bus => {
  const peers = new Map<string, PeerInfo>();
  const handlers = new Map<string, Map<string, Set<(data: unknown, from: string) => void>>>();
  const sent: Bus["sent"] = [];
  const deliver = (to: string, topic: string, data: unknown, from: string) => {
    for (const cb of handlers.get(to)?.get(topic) ?? []) cb(JSON.parse(JSON.stringify(data)), from);
  };
  return {
    sent,
    join(frame, role, pos) {
      peers.set(frame, {
        frame,
        app: "treetop",
        group: "main",
        kind: role === "screen" ? "screen" : "panel",
        role,
        pos,
      });
      handlers.set(frame, new Map());
      return {
        online: true,
        self: frame,
        peers: () => [...peers.values()],
        leader: () => leaderOf([...peers.values()]),
        send(topic, data, to) {
          if (!peers.has(frame)) return;
          sent.push({ topic, from: frame, to });
          if (to !== undefined) {
            if (peers.has(to)) deliver(to, topic, data, frame);
            return;
          }
          for (const other of peers.keys()) if (other !== frame) deliver(other, topic, data, frame);
        },
        on(topic, cb) {
          const map = handlers.get(frame)!;
          let set = map.get(topic);
          if (!set) {
            set = new Set();
            map.set(topic, set);
          }
          set.add(cb);
          return () => set.delete(cb);
        },
        onPeers: () => () => {},
      };
    },
    leave(frame) {
      peers.delete(frame);
      handlers.delete(frame);
    },
  };
};
