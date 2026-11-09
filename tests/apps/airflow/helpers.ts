import type { Channel, PeerInfo } from "../../../src/core/types";

/** Channels that deliver to each other at once (as JSON would), with a shared roster. */
export const fakeNet = () => {
  const peers: PeerInfo[] = [];
  const handlers = new Map<string, Map<string, Set<(data: unknown, from: string) => void>>>();
  let online = true;
  const sent: { from: string; to: string | undefined; topic: string }[] = [];
  const channel = (info: PeerInfo): Channel => {
    peers.push(info);
    handlers.set(info.frame, new Map());
    return {
      get online() {
        return online;
      },
      self: info.frame,
      peers: () => peers,
      leader: () => peers.find((p) => p.role === "screen")?.frame ?? null,
      send(topic, data, to) {
        if (!online) return;
        sent.push({ from: info.frame, to, topic });
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
    setOnline(v: boolean) {
      online = v;
    },
  };
};

export const peer = (frame: string, role: PeerInfo["role"], pos = 0, side = 0): PeerInfo => ({
  frame,
  app: "airflow",
  group: "main",
  kind: role === "screen" ? "screen" : "panel",
  role,
  pos,
  side,
});
