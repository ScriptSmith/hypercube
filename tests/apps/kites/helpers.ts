import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { Channel, PeerInfo } from "../../../src/core/types";

/** Channels that deliver to each other at once, with a shared roster. */
export const fakeNet = () => {
  const peers: PeerInfo[] = [];
  const handlers = new Map<string, Map<string, Set<(data: unknown, from: string) => void>>>();
  let online = true;
  const sent: { from: string; to: string | undefined; topic: string; data: unknown }[] = [];
  const channel = (info: PeerInfo): Channel => {
    peers.push(info);
    handlers.set(info.frame, new Map());
    return {
      get online() {
        return online;
      },
      self: info.frame,
      peers: () => peers,
      leader: () => peers.find((p) => p.role === "screen")?.frame ?? peers[0]?.frame ?? null,
      send(topic, data, to) {
        if (!online) return;
        sent.push({ from: info.frame, to, topic, data });
        for (const [frame, topics] of handlers) {
          if (frame === info.frame || (to !== undefined && to !== frame)) continue;
          for (const cb of topics.get(topic) ?? [])
            cb(JSON.parse(JSON.stringify(data)), info.frame);
        }
      },
      on(topic, cb) {
        const topics = handlers.get(info.frame)!;
        let set = topics.get(topic);
        if (!set) topics.set(topic, (set = new Set()));
        set.add(cb);
        return () => set.delete(cb);
      },
      onPeers: () => () => {},
    };
  };
  return {
    channel,
    sent,
    peers,
    setOnline(v: boolean) {
      online = v;
    },
    remove(frame: string) {
      const i = peers.findIndex((p) => p.frame === frame);
      if (i >= 0) peers.splice(i, 1);
      handlers.delete(frame);
    },
  };
};

export const peer = (frame: string, role: PeerInfo["role"], pos = 0, side = 0): PeerInfo => ({
  frame,
  app: "kites",
  group: "main",
  kind: role === "screen" ? "screen" : "panel",
  role,
  pos,
  side,
});

/** A kind's default venue size and the tops of adult and child reach on it, venue px. */
export const venueFrame = (kind: "panel" | "pair" | "wall") => {
  const { width, height } = VENUE_SIZE[kind];
  const reach = DEFAULT_REACH[kind];
  return {
    width,
    height,
    reachTop: { adult: height * (1 - reach.adult), child: height * (1 - reach.child) },
  };
};
