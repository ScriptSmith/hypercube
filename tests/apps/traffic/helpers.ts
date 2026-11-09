import type { Channel, PeerInfo } from "../../../src/core/types";

/**
 * Channels that deliver to each other after `latency` ms of a shared fake clock (0 delivers at
 * once), with a roster that can lose frames. `flush()` delivers what is due.
 */
export const fakeNet = () => {
  const peers: PeerInfo[] = [];
  const handlers = new Map<string, Map<string, Set<(data: unknown, from: string) => void>>>();
  const queue: { at: number; to: string; topic: string; data: unknown; from: string }[] = [];
  const cut = new Set<string>();
  let now = 0;
  let latency = 0;
  let online = true;
  const deliver = (to: string, topic: string, data: unknown, from: string) => {
    if (cut.has(to) || cut.has(from)) return;
    for (const cb of handlers.get(to)?.get(topic) ?? []) cb(JSON.parse(JSON.stringify(data)), from);
  };
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
        if (!online || cut.has(info.frame)) return;
        for (const frame of handlers.keys()) {
          if (frame === info.frame || (to !== undefined && to !== frame)) continue;
          if (latency <= 0) deliver(frame, topic, data, info.frame);
          else queue.push({ at: now + latency, to: frame, topic, data, from: info.frame });
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
    peers,
    setNow(t: number) {
      now = t;
      for (let i = 0; i < queue.length;) {
        const m = queue[i]!;
        if (m.at <= now) {
          queue.splice(i, 1);
          deliver(m.to, m.topic, m.data, m.from);
        } else i++;
      }
    },
    setLatency(ms: number) {
      latency = ms;
    },
    setOnline(v: boolean) {
      online = v;
    },
    /** The frame stops sending and hearing, but stays in the roster (it vanished). */
    silence(frame: string) {
      cut.add(frame);
    },
    /** The frame leaves the roster too. */
    remove(frame: string) {
      cut.add(frame);
      const i = peers.findIndex((p) => p.frame === frame);
      if (i >= 0) peers.splice(i, 1);
      handlers.delete(frame);
    },
  };
};

export const peer = (
  frame: string,
  role: PeerInfo["role"],
  pos = 0,
  kind: PeerInfo["kind"] = role === "screen" ? "screen" : "panel",
): PeerInfo => ({ frame, app: "traffic", group: "main", kind, role, pos, side: 0 });
