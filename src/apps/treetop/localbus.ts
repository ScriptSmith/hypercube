/**
 * A bank inside one frame. The wall runs the screen's host and one game per column of lanes as
 * members of this bus, so they agree through the same messages as the frames of a real bank,
 * and the lobby, heats and placings are the bank's own code. Messages are delivered at once, in
 * the order they are sent, and nothing leaves the frame.
 */
import { leaderOf } from "../../core/net/channel";
import type { Channel, PeerInfo, Role } from "../../core/types";

type Handler = (data: unknown, from: string) => void;

export interface LocalBus {
  /** A member with its own channel: `role` and `pos` as a frame of a bank would have them. */
  join(frame: string, role: Role, pos: number): Channel;
  dispose(): void;
}

export const createLocalBus = (app: string): LocalBus => {
  const peers = new Map<string, PeerInfo>();
  const handlers = new Map<string, Map<string, Set<Handler>>>();
  let list: PeerInfo[] = [];
  let leader: string | null = null;

  const changed = () => {
    list = [...peers.values()];
    leader = leaderOf(list);
  };

  const deliver = (to: string, topic: string, data: unknown, from: string) => {
    const set = handlers.get(to)?.get(topic);
    if (!set) return;
    for (const cb of set) cb(data, from);
  };

  return {
    join(frame, role, pos) {
      peers.set(frame, {
        frame,
        app,
        group: "wall",
        kind: role === "screen" ? "screen" : "panel",
        role,
        pos,
      });
      const mine = new Map<string, Set<Handler>>();
      handlers.set(frame, mine);
      changed();
      return {
        online: true,
        self: frame,
        peers: () => list,
        leader: () => leader,
        send(topic, data, to) {
          if (!peers.has(frame)) return;
          if (to !== undefined) {
            if (to !== frame) deliver(to, topic, data, frame);
            return;
          }
          for (const other of peers.keys()) if (other !== frame) deliver(other, topic, data, frame);
        },
        on(topic, cb) {
          let set = mine.get(topic);
          if (!set) {
            set = new Set();
            mine.set(topic, set);
          }
          set.add(cb);
          return () => set.delete(cb);
        },
        onPeers: () => () => {},
        close() {
          mine.clear();
        },
      };
    },
    dispose() {
      peers.clear();
      handlers.clear();
      changed();
    },
  };
};
