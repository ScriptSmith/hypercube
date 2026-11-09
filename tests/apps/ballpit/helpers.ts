import { leaderOf } from "../../../src/core/net/channel";
import type { Channel, PeerInfo } from "../../../src/core/types";

/** A room in miniature: channels on one bus see each other's peers and messages at once. */
export interface Bus {
  join(info: Partial<PeerInfo> & { frame: string }): Channel & { leave(): void };
  readonly log: { topic: string; from: string; to?: string; data: unknown }[];
  online: boolean;
}

export const createBus = (): Bus => {
  const members = new Map<
    string,
    { info: PeerInfo; handlers: Map<string, Set<(d: unknown, f: string) => void>> }
  >();
  const log: Bus["log"] = [];
  const bus: Bus = {
    log,
    online: true,
    join(partial) {
      const info: PeerInfo = {
        app: "ballpit",
        group: "g",
        kind: "panel",
        role: "station",
        pos: 0,
        side: 0,
        ...partial,
      };
      const handlers = new Map<string, Set<(d: unknown, f: string) => void>>();
      members.set(info.frame, { info, handlers });
      const peers = () => [...members.values()].map((m) => m.info);
      return {
        get online() {
          return bus.online;
        },
        self: info.frame,
        peers,
        leader: () => leaderOf(peers()),
        send(topic, data, to) {
          if (!bus.online) return;
          log.push({ topic, from: info.frame, to, data });
          for (const [frame, m] of members) {
            if (frame === info.frame || (to !== undefined && to !== frame)) continue;
            for (const cb of m.handlers.get(topic) ?? []) cb(structuredClone(data), info.frame);
          }
        },
        on(topic, cb) {
          let set = handlers.get(topic);
          if (!set) handlers.set(topic, (set = new Set()));
          set.add(cb);
          return () => set.delete(cb);
        },
        onPeers: () => () => {},
        leave() {
          members.delete(info.frame);
        },
      };
    },
  };
  return bus;
};
