import type { Channel, PeerInfo } from "../../../src/core/types";

/** Channels that deliver to each other at once (as JSON), with a shared roster. */
export const fakeNet = () => {
  const peers: PeerInfo[] = [];
  const handlers = new Map<string, Map<string, Set<(data: unknown, from: string) => void>>>();
  let online = true;
  const sent: { from: string; to: string | undefined; topic: string; bytes: number }[] = [];
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
        const json = JSON.stringify(data);
        sent.push({ from: info.frame, to, topic, bytes: json.length });
        for (const [frame, topics] of handlers) {
          if (frame === info.frame || (to !== undefined && to !== frame)) continue;
          for (const cb of topics.get(topic) ?? []) cb(JSON.parse(json), info.frame);
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
  };
};

export const peer = (frame: string, role: PeerInfo["role"], pos = 0, side = 0): PeerInfo => ({
  frame,
  app: "kaleido",
  group: "main",
  kind: role === "screen" ? "screen" : "panel",
  role,
  pos,
  side,
});

/** A seeded stand-in for ctx.rng, enough for the modules under test. */
export const testRng = (seed = 1) => {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const rng = {
    next,
    int: (n: number) => Math.floor(next() * n),
    range: (a: number, b: number) => a + next() * (b - a),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!,
    fork: () => rng,
  };
  return rng;
};
